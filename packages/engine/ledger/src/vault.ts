import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDb } from "./db.ts";
import { VaultError } from "./errors.ts";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type Vault = {
  put(candidateRef: string, payload: unknown): string;
  get(ref: string): unknown;
  shred(candidateRef: string): void;
};

function loadOrCreateMasterKey(path: string): Buffer {
  if (existsSync(path)) {
    const hex = readFileSync(path, "utf8").trim();
    const key = Buffer.from(hex, "hex");
    if (key.length !== KEY_BYTES) {
      throw new VaultError("invalid_vault_key");
    }
    return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(path, `${key.toString("hex")}\n`, { mode: 0o600 });
  return key;
}

function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decrypt(key: Buffer, packed: Buffer): Buffer {
  if (packed.length < IV_BYTES + TAG_BYTES) {
    throw new VaultError("invalid_ciphertext");
  }
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new VaultError("decrypt_failed");
  }
}

function asBlob(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  throw new VaultError("invalid_ciphertext");
}

export function openVault(db: SqliteDb, masterKeyPath: string): Vault {
  const masterKey = loadOrCreateMasterKey(masterKeyPath);

  function unwrapDataKey(keyMaterial: unknown): Buffer {
    return decrypt(masterKey, asBlob(keyMaterial));
  }

  function getOrCreateDataKey(candidateRef: string): { keyId: string; dataKey: Buffer } {
    const existing = db
      .prepare("SELECT key_id, key_material FROM vault_keys WHERE candidate_ref = ?")
      .get(candidateRef) as { key_id: string; key_material: unknown } | undefined;
    if (existing) {
      return { keyId: existing.key_id, dataKey: unwrapDataKey(existing.key_material) };
    }
    const keyId = crypto.randomUUID();
    const dataKey = randomBytes(KEY_BYTES);
    db.prepare("INSERT INTO vault_keys (key_id, candidate_ref, key_material, created_at) VALUES (?, ?, ?, ?)").run(
      keyId,
      candidateRef,
      encrypt(masterKey, dataKey),
      Date.now(),
    );
    return { keyId, dataKey };
  }

  return {
    put(candidateRef, payload) {
      const { keyId, dataKey } = getOrCreateDataKey(candidateRef);
      const ref = crypto.randomUUID();
      const enc = encrypt(dataKey, Buffer.from(JSON.stringify(payload), "utf8"));
      db.prepare("INSERT INTO pii_vault (ref, enc_payload, key_id) VALUES (?, ?, ?)").run(ref, enc, keyId);
      return ref;
    },
    get(ref) {
      const row = db.prepare("SELECT enc_payload, key_id FROM pii_vault WHERE ref = ?").get(ref) as
        | { enc_payload: unknown; key_id: string }
        | undefined;
      if (!row) {
        throw new VaultError("vault_ref_not_found");
      }
      const keyRow = db.prepare("SELECT key_material FROM vault_keys WHERE key_id = ?").get(row.key_id) as
        | { key_material: unknown }
        | undefined;
      if (!keyRow) {
        throw new VaultError("decrypt_failed");
      }
      const plaintext = decrypt(unwrapDataKey(keyRow.key_material), asBlob(row.enc_payload));
      return JSON.parse(plaintext.toString("utf8")) as unknown;
    },
    shred(candidateRef) {
      db.prepare("DELETE FROM vault_keys WHERE candidate_ref = ?").run(candidateRef);
    },
  };
}
