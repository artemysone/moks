import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite, type SqliteDb } from "./db.ts";
import { canonicalJson, hashChangeset, verifyChain, type CanonicalBody } from "./hash.ts";
import { migrateWorkspace } from "./schema.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempWorkspace(): { dir: string; db: SqliteDb } {
  const dir = mkdtempSync(join(tmpdir(), "mox-hash-chain-"));
  tempDirs.push(dir);
  const db = openSqlite(join(dir, "ledger.sqlite"));
  migrateWorkspace(db);
  return { dir, db };
}

function sampleBody(overrides: Partial<CanonicalBody> = {}): CanonicalBody {
  return {
    author_kind: "human",
    author_id: "user_1",
    agent_meta: null,
    rationale: "advance to contacted",
    changes: [
      {
        entity_type: "application",
        entity_ref: "app_1",
        mutation: "AdvanceStage",
        effect_class: "compensable",
        precondition: { stage: "Sourced" },
        payload_ref: "payload_a",
        payload_hash: "",
      },
    ],
    ...overrides,
  };
}

function insertChangeset(
  db: SqliteDb,
  opts: {
    id: string;
    parentId: string | null;
    parentHash: string;
    body: CanonicalBody;
    createdAt: number;
  },
): string {
  const hash = hashChangeset(opts.parentHash, opts.body);
  db.prepare(
    `INSERT INTO changesets (
      id, parent_id, hash, author_kind, author_id, agent_meta, rationale, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?)`,
  ).run(
    opts.id,
    opts.parentId,
    hash,
    opts.body.author_kind,
    opts.body.author_id,
    opts.body.agent_meta === null ? null : JSON.stringify(opts.body.agent_meta),
    opts.body.rationale,
    opts.createdAt,
  );
  for (const [seq, change] of opts.body.changes.entries()) {
    db.prepare(
      `INSERT INTO changes (
        id, changeset_id, entity_type, entity_ref, mutation, effect_class, precondition, payload_ref, seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      opts.id,
      change.entity_type,
      change.entity_ref,
      change.mutation,
      change.effect_class,
      JSON.stringify(change.precondition),
      change.payload_ref,
      seq,
    );
  }
  return hash;
}

describe("hashChangeset", () => {
  test("is deterministic for the same parent and body", () => {
    const body = sampleBody();
    expect(hashChangeset("", body)).toBe(hashChangeset("", body));
  });

  test("changes when rationale differs", () => {
    const a = hashChangeset("", sampleBody({ rationale: "first" }));
    const b = hashChangeset("", sampleBody({ rationale: "second" }));
    expect(a).not.toBe(b);
  });

  test("changes when payload_ref differs", () => {
    const a = hashChangeset("", sampleBody());
    const b = hashChangeset(
      "",
      sampleBody({
        changes: [
          {
            ...sampleBody().changes[0]!,
            payload_ref: "payload_b",
            payload_hash: "",
          },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe("canonicalJson", () => {
  test("sorts object keys", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: true })).toBe('{"a":true,"z":{"x":2,"y":1}}');
  });
});

describe("verifyChain", () => {
  test("accepts an empty migrated database", () => {
    const { db } = tempWorkspace();
    try {
      expect(verifyChain(db)).toEqual({ ok: true });
    } finally {
      db.close();
    }
  });

  test("detects a tampered hash after two linked changesets", () => {
    const { db } = tempWorkspace();
    try {
      const firstHash = insertChangeset(db, {
        id: "cs_1",
        parentId: null,
        parentHash: "",
        body: sampleBody({ rationale: "first" }),
        createdAt: 1,
      });
      insertChangeset(db, {
        id: "cs_2",
        parentId: "cs_1",
        parentHash: firstHash,
        body: sampleBody({ rationale: "second" }),
        createdAt: 2,
      });
      expect(verifyChain(db)).toEqual({ ok: true });

      db.prepare("UPDATE changesets SET hash = ? WHERE id = ?").run("deadbeef", "cs_2");
      expect(verifyChain(db)).toEqual({
        ok: false,
        reason: "hash_mismatch",
        changesetId: "cs_2",
      });
    } finally {
      db.close();
    }
  });

  test("walks parent links when same-ms UUID ids sort opposite the chain", () => {
    const { db } = tempWorkspace();
    try {
      const firstHash = insertChangeset(db, {
        id: "cs_zzz",
        parentId: null,
        parentHash: "",
        body: sampleBody({ rationale: "first" }),
        createdAt: 1000,
      });
      insertChangeset(db, {
        id: "cs_aaa",
        parentId: "cs_zzz",
        parentHash: firstHash,
        body: sampleBody({ rationale: "second" }),
        createdAt: 1000,
      });
      expect(verifyChain(db)).toEqual({ ok: true });
    } finally {
      db.close();
    }
  });

  test("returns invalid_json instead of throwing on corrupt precondition", () => {
    const { db } = tempWorkspace();
    try {
      insertChangeset(db, {
        id: "cs_1",
        parentId: null,
        parentHash: "",
        body: sampleBody(),
        createdAt: 1,
      });
      db.prepare("UPDATE changes SET precondition = ? WHERE changeset_id = ?").run("not-json", "cs_1");
      expect(verifyChain(db)).toEqual({ ok: false, reason: "invalid_json", changesetId: "cs_1" });
    } finally {
      db.close();
    }
  });

  test("VACUUM does not break verifyChain when seq is stored", () => {
    const { db } = tempWorkspace();
    try {
      insertChangeset(db, {
        id: "cs_1",
        parentId: null,
        parentHash: "",
        body: sampleBody({
          changes: [
            { ...sampleBody().changes[0]!, payload_ref: "p1", payload_hash: "" },
            { ...sampleBody().changes[0]!, mutation: "AddNote", effect_class: "reversible", payload_ref: "p2", payload_hash: "" },
          ],
        }),
        createdAt: 1,
      });
      db.exec("VACUUM");
      expect(verifyChain(db)).toEqual({ ok: true });
    } finally {
      db.close();
    }
  });
});
