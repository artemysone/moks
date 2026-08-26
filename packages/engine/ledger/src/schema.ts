import type { SqlBindings, SqliteDb } from "./db.ts";

type Migration = {
  version: number;
  apply: (db: SqliteDb) => void;
};

const WORKSPACE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS remote_mirror (
          entity_type TEXT NOT NULL,
          entity_ref  TEXT NOT NULL,
          ats         TEXT NOT NULL,
          remote_id   TEXT NOT NULL,
          state       TEXT NOT NULL,
          synced_at   INTEGER NOT NULL,
          PRIMARY KEY (entity_type, entity_ref, ats)
        );
      `);
    },
  },
  {
    version: 2,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS changesets (
          id          TEXT PRIMARY KEY,
          parent_id   TEXT,
          hash        TEXT NOT NULL,
          author_kind TEXT NOT NULL,
          author_id   TEXT NOT NULL,
          agent_meta  TEXT,
          rationale   TEXT NOT NULL,
          status      TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          reviewed_by TEXT,
          applied_at  INTEGER
        );

        CREATE TABLE IF NOT EXISTS changes (
          id            TEXT PRIMARY KEY,
          changeset_id  TEXT NOT NULL REFERENCES changesets(id),
          entity_type   TEXT NOT NULL,
          entity_ref    TEXT NOT NULL,
          mutation      TEXT NOT NULL,
          effect_class  TEXT NOT NULL,
          precondition  TEXT NOT NULL,
          payload_ref   TEXT NOT NULL,
          remote_result TEXT,
          seq           INTEGER
        );

        CREATE TABLE IF NOT EXISTS pii_vault (
          ref         TEXT PRIMARY KEY,
          enc_payload BLOB NOT NULL,
          key_id      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vault_keys (
          key_id        TEXT PRIMARY KEY,
          candidate_ref TEXT NOT NULL UNIQUE,
          key_material  BLOB NOT NULL,
          created_at    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS changes_changeset_id ON changes(changeset_id);
        CREATE INDEX IF NOT EXISTS changesets_status ON changesets(status);
        CREATE INDEX IF NOT EXISTS changesets_created_at ON changesets(created_at);
      `);
    },
  },
  {
    version: 3,
    apply(db) {
      const cols = db.prepare<SqliteColumnInfo, SqlBindings>("PRAGMA table_info(changes)").all();
      if (!cols.some((col) => col.name === "seq")) {
        db.exec("ALTER TABLE changes ADD COLUMN seq INTEGER");
      }
      db.exec("UPDATE changes SET seq = rowid WHERE seq IS NULL");
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS changesets_parent_unique
          ON changesets(parent_id) WHERE parent_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS changesets_single_root
          ON changesets((1)) WHERE parent_id IS NULL;
      `);
    },
  },
  {
    version: 4,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          job_ref    TEXT,
          model      TEXT NOT NULL,
          prompt_ref TEXT
        );

        CREATE TABLE IF NOT EXISTS session_messages (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          seq        INTEGER NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS session_messages_session_seq
          ON session_messages(session_id, seq);
      `);
    },
  },
  {
    version: 5,
    apply(db) {
      db.exec(`
        DROP INDEX IF EXISTS session_messages_session_seq;
        CREATE UNIQUE INDEX IF NOT EXISTS session_messages_session_seq
          ON session_messages(session_id, seq);
      `);
    },
  },
  {
    version: 6,
    apply(db) {
      const cols = db.prepare<SqliteColumnInfo, SqlBindings>("PRAGMA table_info(changesets)").all();
      if (!cols.some((col) => col.name === "audit")) {
        db.exec("ALTER TABLE changesets ADD COLUMN audit INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    // M5 usage tracking + compaction. Token usage lands on the assistant row that
    // produced it; compaction rows are flagged with kind='compaction' and the rows
    // they summarize point at them via compacted_by (append-only: nothing is deleted).
    version: 7,
    apply(db) {
      const cols = db.prepare<SqliteColumnInfo, SqlBindings>("PRAGMA table_info(session_messages)").all();
      const names = new Set(cols.map((col) => col.name));
      const add = (column: string, type: string) => {
        if (!names.has(column)) {
          db.exec(`ALTER TABLE session_messages ADD COLUMN ${column} ${type}`);
        }
      };
      add("input_tokens", "INTEGER");
      add("output_tokens", "INTEGER");
      add("usage_model", "TEXT");
      add("kind", "TEXT");
      add("compacted_by", "TEXT");
    },
  },
  {
    // M5 sub-agents: child sessions spawned by the task tool. parent_id points at
    // the spawning session; agent records the agent-definition name the child ran as.
    version: 8,
    apply(db) {
      const cols = db.prepare<SqliteColumnInfo, SqlBindings>("PRAGMA table_info(sessions)").all();
      const names = new Set(cols.map((col) => col.name));
      if (!names.has("parent_id")) {
        db.exec("ALTER TABLE sessions ADD COLUMN parent_id TEXT REFERENCES sessions(id)");
      }
      if (!names.has("agent")) {
        db.exec("ALTER TABLE sessions ADD COLUMN agent TEXT");
      }
      db.exec("CREATE INDEX IF NOT EXISTS sessions_parent_id ON sessions(parent_id)");
    },
  },
  {
    version: 9,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assessments (
          id TEXT PRIMARY KEY,
          req_ref TEXT NOT NULL,
          candidate_id TEXT NOT NULL,
          scorecard_hash TEXT NOT NULL,
          overall REAL,
          recommendation TEXT NOT NULL,
          dimensions TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          changeset_id TEXT
        );

        CREATE INDEX IF NOT EXISTS assessments_req_ref_candidate_id_created_at
          ON assessments(req_ref, candidate_id, created_at);

        CREATE TABLE IF NOT EXISTS req_jobs (
          req_slug TEXT PRIMARY KEY,
          job_id TEXT,
          title TEXT,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
];

type SqliteColumnInfo = { name: string };
type SchemaVersionRow = { version: number };
type TableExistsRow = { ok: number };

function tableExists(db: SqliteDb, name: string): boolean {
  // bun:sqlite .get() returns null (not undefined) when there is no row.
  const row = db
    .prepare<TableExistsRow, SqlBindings>("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row != null;
}

export function migrateWorkspace(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(db.prepare<SchemaVersionRow, SqlBindings>("SELECT version FROM schema_migrations").all().map((row) => row.version));

  // M0 databases created remote_mirror without schema_migrations.
  if (tableExists(db, "remote_mirror") && !applied.has(1)) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(Date.now());
    applied.add(1);
  }

  for (const migration of WORKSPACE_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    const apply = db.transaction(() => {
      migration.apply(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now(),
      );
    });
    apply();
  }
}

export function migrateMockAts(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      remote_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      team TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      remote_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      headline TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      remote_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      stage TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_ref, tag)
    );

    CREATE TABLE IF NOT EXISTS outreach (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      channel TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      entity_ref TEXT NOT NULL,
      terms TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
