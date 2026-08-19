import type { SqliteDb } from "./db.ts";
import type { AuthorKind } from "./domain.ts";

export type CanonicalChange = {
  entity_type: string;
  entity_ref: string;
  mutation: string;
  effect_class: string;
  precondition: unknown;
  payload_ref: string;
  payload_hash: string;
};

export type CanonicalBody = {
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: unknown;
  rationale: string;
  changes: CanonicalChange[];
};

export const GENESIS_PARENT_HASH = "";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashChangeset(parentHash: string, body: CanonicalBody): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(parentHash);
  hasher.update(canonicalJson(body));
  return hasher.digest("hex");
}

export function payloadCipherHash(db: SqliteDb, payloadRef: string): string {
  const row = db.prepare("SELECT enc_payload FROM pii_vault WHERE ref = ?").get(payloadRef) as
    | { enc_payload: Uint8Array }
    | undefined
    | null;
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
    agent_meta: cs.agent_meta === null ? null : (JSON.parse(cs.agent_meta) as unknown),
    rationale: cs.rationale,
    changes: changeRows.map((change) => ({
      entity_type: change.entity_type,
      entity_ref: change.entity_ref,
      mutation: change.mutation,
      effect_class: change.effect_class,
      precondition: JSON.parse(change.precondition) as unknown,
      payload_ref: change.payload_ref,
      payload_hash: payloadCipherHash(db, change.payload_ref),
    })),
  };
}

export function verifyChain(db: SqliteDb): ChainVerification {
  const changesets = db
    .prepare("SELECT id, parent_id, hash, author_kind, author_id, agent_meta, rationale FROM changesets")
    .all() as ChangesetRow[];
  const changeRows = db
    .prepare(
      "SELECT changeset_id, entity_type, entity_ref, mutation, effect_class, precondition, payload_ref FROM changes ORDER BY changeset_id, seq ASC, id ASC",
    )
    .all() as ChangeRow[];

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
