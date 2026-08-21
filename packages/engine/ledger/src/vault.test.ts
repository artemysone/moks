import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite } from "./db.ts";
import { migrateWorkspace } from "./schema.ts";
import { openVault } from "./vault.ts";
import { VaultError } from "./errors.ts";

describe("pii vault", () => {
  test("encrypts payloads and shredding makes them unreadable", () => {
    const dir = mkdtempSync(join(tmpdir(), "moks-vault-"));
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    const vault = openVault(db, join(dir, "vault.key"));

    const ref = vault.put("cand_priya", { body: "secret note", email: "priya.shah@example.com" });
    expect(vault.get(ref)).toEqual({ body: "secret note", email: "priya.shah@example.com" });

    vault.shred("cand_priya");
    expect(() => vault.get(ref)).toThrow(VaultError);
    expect(() => vault.get(ref)).toThrow("decrypt_failed");
  });
});
