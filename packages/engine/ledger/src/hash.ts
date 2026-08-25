import type { SqlBindings, SqliteDb } from "./db.ts";
import { parseAgentMeta, parseCasField, type AgentMeta, type AuthorKind, type CasField } from "./domain.ts";
import { isJsonNumber, isJsonObject, isJsonString, parseJsonText, type Json } from "./json.ts";

export type CanonicalChange = {
  entity_type: string;
  entity_ref: string;
  mutation: string;
  effect_class: string;
  precondition: CasField;
  payload_ref: string;
  payload_hash: string;
};

export type CanonicalBody = {
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: AgentMeta | null;
  rationale: string;
  changes: CanonicalChange[];
};

export const GENESIS_PARENT_HASH = "";

export function canonicalJson(value: Json): string {
  if (value === null || value === true || value === false) return JSON.stringify(value);
  if (isJsonString(value) || isJsonNumber(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isJsonObject(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

export function hashChangeset(parentHash: string, body: CanonicalBody): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(parentHash);
  hasher.update(canonicalJson(parseJsonText(JSON.stringify(body))));
  return hasher.digest("hex");
}

type VaultCipherRow = { enc_payload: Uint8Array };

export function payloadCipherHash(db: SqliteDb, payloadRef: string): string {
  const row = db.prepare<VaultCipherRow, SqlBindings>("SELECT enc_payload FROM pii_vault WHERE ref = ?").get(payloadRef);
  if (row == null || row.enc_payload == null) {
    return "";
  }
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(row.enc_payload);
  return hasher.digest("hex");
}

type ChangesetRow = {
  id: string;
  parent_id: string | null;
  hash: string;
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: string | null;
  rationale: string;
};

type ChangeRow = {
  changeset_id: string;
  entity_type: string;
  entity_ref: string;
  mutation: string;
  effect_class: string;
  precondition: string;
  payload_ref: string;
};

export type ChainVerification = { ok: true } | { ok: false; reason: string; changesetId?: string };

function fail(reason: string, changesetId?: string): ChainVerification {
  return changesetId === undefined ? { ok: false, reason } : { ok: false, reason, changesetId };
}

function parseBody(db: SqliteDb, cs: ChangesetRow, changeRows: ChangeRow[]): CanonicalBody {
  return {
    author_kind: cs.author_kind,
    author_id: cs.author_id,
    agent_meta: cs.agent_meta === null ? null : parseAgentMeta(parseJsonText(cs.agent_meta)),
    rationale: cs.rationale,
    changes: changeRows.map((change) => ({
      entity_type: change.entity_type,
      entity_ref: change.entity_ref,
      mutation: change.mutation,
      effect_class: change.effect_class,
      precondition: parseCasField(parseJsonText(change.precondition)),
      payload_ref: change.payload_ref,
      payload_hash: payloadCipherHash(db, change.payload_ref),
    })),
  };
}

export function verifyChain(db: SqliteDb): ChainVerification {
  const changesets = db
    .prepare<ChangesetRow, SqlBindings>("SELECT id, parent_id, hash, author_kind, author_id, agent_meta, rationale FROM changesets")
    .all();
  const changeRows = db
    .prepare<ChangeRow, SqlBindings>(
      "SELECT changeset_id, entity_type, entity_ref, mutation, effect_class, precondition, payload_ref FROM changes ORDER BY changeset_id, seq ASC, id ASC",
    )
    .all();

  const changesByCs = new Map<string, ChangeRow[]>();
  for (const row of changeRows) {
    const list = changesByCs.get(row.changeset_id) ?? [];
    list.push(row);
    changesByCs.set(row.changeset_id, list);
  }

  if (changesets.length === 0) {
    return { ok: true };
  }

  const genesis = changesets.filter((cs) => cs.parent_id === null);
  if (genesis.length === 0) {
    return fail("missing_genesis", changesets[0]?.id);
  }
  if (genesis.length > 1) {
    return fail("multiple_genesis", genesis[1]?.id);
  }

  const childrenOf = new Map<string, ChangesetRow[]>();
  for (const cs of changesets) {
    if (cs.parent_id === null) {
      continue;
    }
    const list = childrenOf.get(cs.parent_id) ?? [];
    list.push(cs);
    childrenOf.set(cs.parent_id, list);
  }

  const visited = new Set<string>();
  let current: ChangesetRow | undefined = genesis[0];
  let parentHash = GENESIS_PARENT_HASH;

  while (current) {
    if (visited.has(current.id)) {
      return { ok: false, reason: "cycle", changesetId: current.id };
    }
    visited.add(current.id);

    let body: CanonicalBody;
    try {
      body = parseBody(db, current, changesByCs.get(current.id) ?? []);
    } catch {
      return { ok: false, reason: "invalid_json", changesetId: current.id };
    }

    const expected = hashChangeset(parentHash, body);
    if (expected !== current.hash) {
      return { ok: false, reason: "hash_mismatch", changesetId: current.id };
    }

    const children: ChangesetRow[] = childrenOf.get(current.id) ?? [];
    if (children.length > 1) {
      return fail("branch", children[1]?.id);
    }
    parentHash = current.hash;
    current = children[0];
  }

  if (visited.size !== changesets.length) {
    const orphan = changesets.find((cs) => !visited.has(cs.id));
    return fail("orphan", orphan?.id);
  }

  return { ok: true };
}
