import { describe, expect, test } from "bun:test";
import { openSqlite, type SqlBindings } from "./db.ts";
import { migrateWorkspace } from "./schema.ts";

const M1_TABLES = ["remote_mirror", "changesets", "changes", "pii_vault", "vault_keys"] as const;

type NameRow = { name: string };
type VersionRow = { version: number };

function tableNames(db: ReturnType<typeof openSqlite>): string[] {
  return db.prepare<NameRow, SqlBindings>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
}

function migrationVersions(db: ReturnType<typeof openSqlite>): number[] {
  return db.prepare<VersionRow, SqlBindings>("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
}

describe("migrateWorkspace", () => {
  test("fresh database records versions 1-9 and creates all M1 tables", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);

    expect(migrationVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tableNames(db)).toContain("sessions");
    expect(tableNames(db)).toContain("session_messages");
    const names = tableNames(db);
    expect(names).toContain("schema_migrations");
    expect(names).toContain("assessments");
    expect(names).toContain("req_jobs");
    for (const table of M1_TABLES) {
      expect(names).toContain(table);
    }
    const cols = db.prepare<NameRow, SqlBindings>("PRAGMA table_info(changes)").all();
    expect(cols.some((col) => col.name === "seq")).toBe(true);
    const changesetCols = db.prepare<NameRow, SqlBindings>("PRAGMA table_info(changesets)").all();
    expect(changesetCols.some((col) => col.name === "audit")).toBe(true);
    const messageCols = db.prepare<NameRow, SqlBindings>("PRAGMA table_info(session_messages)").all().map((col) => col.name);
    for (const column of ["input_tokens", "output_tokens", "usage_model", "kind", "compacted_by"]) {
      expect(messageCols).toContain(column);
    }
    const sessionCols = db.prepare<NameRow, SqlBindings>("PRAGMA table_info(sessions)").all().map((col) => col.name);
    for (const column of ["parent_id", "agent"]) {
      expect(sessionCols).toContain(column);
    }
    const assessmentCols = db.prepare<NameRow, SqlBindings>("PRAGMA table_info(assessments)").all().map((col) => col.name);
    for (const column of [
      "id",
      "req_ref",
      "candidate_id",
      "scorecard_hash",
      "overall",
      "recommendation",
      "dimensions",
      "created_at",
      "changeset_id",
    ]) {
      expect(assessmentCols).toContain(column);
    }
    const reqJobCols = db.prepare<NameRow, SqlBindings>("PRAGMA table_info(req_jobs)").all().map((col) => col.name);
    for (const column of ["req_slug", "job_id", "title", "created_at"]) {
      expect(reqJobCols).toContain(column);
    }
  });

  test("v8 session tree: children reference parents, top-level rows stay null", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at, job_ref, model, prompt_ref) VALUES ('parent', 1, 1, NULL, 'mock', NULL)",
    ).run();
    db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at, job_ref, model, prompt_ref, parent_id, agent) VALUES ('child', 2, 2, NULL, 'mock', NULL, 'parent', 'sourcer')",
    ).run();
    const rows = db.prepare<{ id: string; parent_id: string | null; agent: string | null }, SqlBindings>(
      "SELECT id, parent_id, agent FROM sessions ORDER BY id",
    ).all();
    expect(rows).toEqual([
      { id: "child", parent_id: "parent", agent: "sourcer" },
      { id: "parent", parent_id: null, agent: null },
    ]);
  });

  test("is idempotent when called a second time", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    migrateWorkspace(db);
    expect(migrationVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    db.prepare("DELETE FROM schema_migrations WHERE version IN (2, 3, 4, 5, 6, 7, 8, 9)").run();
    migrateWorkspace(db);
    expect(migrationVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("rejects a second genesis changeset", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    db.prepare(
      `INSERT INTO changesets (id, parent_id, hash, author_kind, author_id, rationale, status, created_at)
       VALUES ('cs_a', NULL, 'h1', 'human', 'u', 'first', 'applied', 1)`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO changesets (id, parent_id, hash, author_kind, author_id, rationale, status, created_at)
           VALUES ('cs_b', NULL, 'h2', 'human', 'u', 'fork', 'applied', 2)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test("legacy M0 remote_mirror database migrates without dropping mirror rows", () => {
    const db = openSqlite(":memory:");
    db.exec(`
      CREATE TABLE remote_mirror (
        entity_type TEXT NOT NULL,
        entity_ref  TEXT NOT NULL,
        ats         TEXT NOT NULL,
        remote_id   TEXT NOT NULL,
        state       TEXT NOT NULL,
        synced_at   INTEGER NOT NULL,
        PRIMARY KEY (entity_type, entity_ref, ats)
      );
    `);
    db.prepare(
      `INSERT INTO remote_mirror (entity_type, entity_ref, ats, remote_id, state, synced_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("candidate", "cand_legacy", "mock", "C-9", JSON.stringify({ name: "Ada" }), 1_700_000_000);

    expect(tableNames(db)).not.toContain("schema_migrations");

    migrateWorkspace(db);

    expect(migrationVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const names = tableNames(db);
    expect(names).toContain("remote_mirror");
    for (const table of M1_TABLES) {
      expect(names).toContain(table);
    }

    const rows = db
      .prepare<{ entity_type: string; entity_ref: string; ats: string; remote_id: string }, SqlBindings>(
        "SELECT entity_type, entity_ref, ats, remote_id FROM remote_mirror",
      )
      .all();
    expect(rows).toEqual([
      {
        entity_type: "candidate",
        entity_ref: "cand_legacy",
        ats: "mock",
        remote_id: "C-9",
      },
    ]);
  });

  test("rejects duplicate (session_id, seq)", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at, job_ref, model, prompt_ref) VALUES ('sess', 1, 1, NULL, 'mock', NULL)",
    ).run();
    db.prepare(
      "INSERT INTO session_messages (id, session_id, seq, role, content, created_at) VALUES ('m1', 'sess', 0, 'user', '{}', 1)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO session_messages (id, session_id, seq, role, content, created_at) VALUES ('m2', 'sess', 0, 'assistant', '{}', 2)",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
