import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite, type SqliteDb } from "./db.ts";
import { VaultError } from "./errors.ts";
import { hashChangeset, payloadCipherHash, verifyChain, type CanonicalBody } from "./hash.ts";
import { migrateWorkspace } from "./schema.ts";
import { openVault } from "./vault.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempVaultEnv(): { db: SqliteDb; keyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "mox-vault-shred-"));
  tempDirs.push(dir);
  const db = openSqlite(join(dir, "ledger.sqlite"));
  migrateWorkspace(db);
  return { db, keyPath: join(dir, "vault.key") };
}

function insertPayloadRefChangeset(db: SqliteDb, payloadRef: string): void {
  const body: CanonicalBody = {
    author_kind: "human",
    author_id: "user_1",
    agent_meta: null,
    rationale: "store note payload",
    changes: [
      {
        entity_type: "candidate",
        entity_ref: "cand_1",
        mutation: "AddNote",
        effect_class: "reversible",
        precondition: {},
        payload_ref: payloadRef,
        payload_hash: payloadCipherHash(db, payloadRef),
      },
    ],
  };
  const hash = hashChangeset("", body);
  db.prepare(
    `INSERT INTO changesets (
      id, parent_id, hash, author_kind, author_id, agent_meta, rationale, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?)`,
  ).run("cs_vault", null, hash, body.author_kind, body.author_id, null, body.rationale, 1);
  db.prepare(
    `INSERT INTO changes (
      id, changeset_id, entity_type, entity_ref, mutation, effect_class, precondition, payload_ref, seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "chg_vault",
    "cs_vault",
    body.changes[0]!.entity_type,
    body.changes[0]!.entity_ref,
    body.changes[0]!.mutation,
    body.changes[0]!.effect_class,
    JSON.stringify(body.changes[0]!.precondition),
    payloadRef,
    0,
  );
}

describe("vault put/get/shred", () => {
  test("put then get returns the same payload", () => {
    const { db, keyPath } = tempVaultEnv();
    try {
      const vault = openVault(db, keyPath);
      const payload = { email: "ada@example.com", note: "intro" };
      const ref = vault.put("cand_1", payload);
      expect(vault.get(ref)).toEqual(payload);
    } finally {
      db.close();
    }
  });

  test("shred makes get fail with VaultError", () => {
    const { db, keyPath } = tempVaultEnv();
    try {
      const vault = openVault(db, keyPath);
      const ref = vault.put("cand_1", { email: "ada@example.com" });
      vault.shred("cand_1");
      expect(() => vault.get(ref)).toThrow(VaultError);
    } finally {
      db.close();
    }
  });

  test("verifyChain still succeeds after shred when the changeset stores only payload_ref", () => {
    const { db, keyPath } = tempVaultEnv();
    try {
      const vault = openVault(db, keyPath);
      const ref = vault.put("cand_1", { email: "ada@example.com" });
      insertPayloadRefChangeset(db, ref);
      expect(verifyChain(db)).toEqual({ ok: true });

      vault.shred("cand_1");
      expect(() => vault.get(ref)).toThrow(VaultError);
      expect(verifyChain(db)).toEqual({ ok: true });
    } finally {
      db.close();
    }
  });

  test("swapping vault ciphertext fails verifyChain", () => {
    const { db, keyPath } = tempVaultEnv();
    try {
      const vault = openVault(db, keyPath);
      const ref = vault.put("cand_1", { email: "ada@example.com" });
      insertPayloadRefChangeset(db, ref);
      expect(verifyChain(db)).toEqual({ ok: true });
      const other = vault.put("cand_1", { email: "swapped@example.com" });
      const swapped = db.prepare("SELECT enc_payload FROM pii_vault WHERE ref = ?").get(other) as {
        enc_payload: Uint8Array;
      };
      db.prepare("UPDATE pii_vault SET enc_payload = ? WHERE ref = ?").run(swapped.enc_payload, ref);
      expect(verifyChain(db)).toMatchObject({ ok: false, reason: "hash_mismatch" });
    } finally {
      db.close();
    }
  });
});
