import type { SqlBindings, SqliteDb } from "./db.ts";
import { parseAgentMeta, type AgentMeta, type AuthorKind, type ChangesetStatus, type EffectClass, type EntityType, type Mutation } from "./domain.ts";
import { parseJsonText } from "./json.ts";

export const COMPLIANCE_SCHEMA = "mox.compliance.ll144.v1";

export type ComplianceChange = {
  id: string;
  entity_type: EntityType;
  entity_ref: string;
  mutation: Mutation;
  effect_class: EffectClass;
  payload_ref: string;
  payload_redacted: true;
};

export type ComplianceChangeset = {
  id: string;
  parent_id: string | null;
  hash: string;
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: AgentMeta | null;
  reviewed_by: string | null;
  rationale: string;
  status: ChangesetStatus;
  created_at: number;
  applied_at: number | null;
  audit: boolean;
  mutations: Mutation[];
  effect_classes: EffectClass[];
  changes: ComplianceChange[];
};

export type ComplianceExport = {
  schema: typeof COMPLIANCE_SCHEMA;
  generated_at: number;
  policy_hash: string | null;
  changesets: ComplianceChangeset[];
};

type ChangesetRow = {
  id: string;
  parent_id: string | null;
  hash: string;
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: string | null;
  rationale: string;
  status: ChangesetStatus;
  created_at: number;
  reviewed_by: string | null;
  applied_at: number | null;
  audit: number;
};

type ChangeRow = {
  id: string;
  changeset_id: string;
  entity_type: EntityType;
  entity_ref: string;
  mutation: Mutation;
  effect_class: EffectClass;
  payload_ref: string;
};

/** LL144 / AI-Act-shaped export. Never decrypts the vault. */
export function readComplianceLog(db: SqliteDb, policyHash: string | null): ComplianceExport {
  const changesets = db
    .prepare<ChangesetRow, SqlBindings>(
      "SELECT id, parent_id, hash, author_kind, author_id, agent_meta, rationale, status, created_at, reviewed_by, applied_at, audit FROM changesets ORDER BY created_at ASC, id ASC",
    )
    .all();
  const changeRows = db
    .prepare<ChangeRow, SqlBindings>(
      "SELECT id, changeset_id, entity_type, entity_ref, mutation, effect_class, payload_ref FROM changes ORDER BY seq ASC, id ASC",
    )
    .all();

  const byCs = new Map<string, ChangeRow[]>();
  for (const row of changeRows) {
    const list = byCs.get(row.changeset_id) ?? [];
    list.push(row);
    byCs.set(row.changeset_id, list);
  }

  return {
    schema: COMPLIANCE_SCHEMA,
    generated_at: Date.now(),
    policy_hash: policyHash,
    changesets: changesets.map((row) => {
      const changes = (byCs.get(row.id) ?? []).map(
        (change): ComplianceChange => ({
          id: change.id,
          entity_type: change.entity_type,
          entity_ref: change.entity_ref,
          mutation: change.mutation,
          effect_class: change.effect_class,
          payload_ref: change.payload_ref,
          payload_redacted: true,
        }),
      );
      return {
        id: row.id,
        parent_id: row.parent_id,
        hash: row.hash,
        author_kind: row.author_kind,
        author_id: row.author_id,
        agent_meta: row.agent_meta === null ? null : parseAgentMeta(parseJsonText(row.agent_meta)),
        reviewed_by: row.reviewed_by,
        rationale: row.rationale,
        status: row.status,
        created_at: row.created_at,
        applied_at: row.applied_at,
        audit: row.audit === 1,
        mutations: changes.map((change) => change.mutation),
        effect_classes: changes.map((change) => change.effect_class),
        changes,
      };
    }),
  };
}
