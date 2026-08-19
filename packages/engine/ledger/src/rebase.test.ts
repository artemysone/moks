import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite } from "./db.ts";
import { LedgerError } from "./errors.ts";
import { parseHiringMarkdown } from "./policy.ts";
import { rebaseChangeset } from "./rebase.ts";
import { openVault } from "./vault.ts";
import { openWorkspace, type Workspace } from "./temp-ledger.ts";

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), "mox-rebase-"));
}

function openTemp(): Workspace {
  return openWorkspace(tempCwd());
}

function withLedger<T>(ws: Workspace, fn: (db: ReturnType<typeof openSqlite>, vault: ReturnType<typeof openVault>) => T): T {
  const db = openSqlite(ws.paths.workspaceDb);
  const vault = openVault(db, ws.paths.vaultKey);
  try {
    return fn(db, vault);
  } finally {
    db.close();
  }
}

function advancePriya(ws: Workspace) {
  return ws.commit({
    rationale: "Reached out to Priya",
    author_id: "recruiter",
    author_kind: "human",
    changes: [
      {
        entity_type: "application",
        entity_ref: "app_priya_142",
        mutation: "AdvanceStage",
        effect_class: "compensable",
        payload: { to: "Contacted" },
      },
    ],
  });
}

function markStaleByRemoteId(ws: Workspace, remoteId = "A-DRIFT"): void {
  const mock = openSqlite(ws.paths.mockAtsDb);
  mock.prepare("UPDATE applications SET remote_id = ? WHERE id = 'app_priya_142'").run(remoteId);
  mock.close();
  ws.pull();
}

function markStaleByStage(ws: Workspace, stage: string): void {
  const mock = openSqlite(ws.paths.mockAtsDb);
  mock.prepare("UPDATE applications SET stage = ? WHERE id = 'app_priya_142'").run(stage);
  mock.close();
  ws.pull();
}

describe("rebaseChangeset", () => {
  test("stale AdvanceStage rebases onto current mirror precondition", () => {
    const ws = openTemp();
    ws.pull();
    const original = advancePriya(ws);
    expect(original.changes[0]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-2003",
      stage: "Sourced",
    });

    markStaleByRemoteId(ws);
    expect(ws.getChangeset(original.id).status).toBe("stale");

    const result = withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id));
    expect(result.original_id).toBe(original.id);
    expect(result.changeset.id).not.toBe(original.id);
    expect(result.changeset.status).toBe("staged");
    expect(result.changeset.parent_id).toBe(original.id);
    expect(result.changeset.changes).toHaveLength(1);
    expect(result.changeset.changes[0]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-DRIFT",
      stage: "Sourced",
    });
    expect(result.changeset.changes[0]?.payload).toEqual({ to: "Contacted" });
    expect(result.skipped).toEqual([]);
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.explanation).toContain("app_priya_142");
    expect(result.changeset.rationale).toContain(original.rationale);
    expect(result.changeset.rationale).toContain(`Rebased from ${original.id}: ${result.explanation}`);

    expect(ws.getChangeset(original.id).status).toBe("stale");
    expect(ws.getChangeset(original.id).rationale).toBe(original.rationale);
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });

  test("AdvanceStage already at target is skipped; sole change is rebase_empty", () => {
    const ws = openTemp();
    ws.pull();
    const original = advancePriya(ws);
    markStaleByStage(ws, "Contacted");
    expect(ws.getChangeset(original.id).status).toBe("stale");

    expect(() => withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id))).toThrow(
      new LedgerError("rebase_empty"),
    );
    expect(ws.getChangeset(original.id).status).toBe("stale");
    ws.close();
  });

  test("illegal AdvanceStage is skipped when a sibling change remains legal", () => {
    const ws = openTemp();
    ws.pull();
    const original = ws.commit({
      rationale: "Reach out and note it",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AdvanceStage",
          effect_class: "compensable",
          payload: { to: "Contacted" },
        },
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "Intro sent" },
        },
      ],
    });
    markStaleByStage(ws, "Contacted");

    const result = withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id));
    expect(result.changeset.changes).toHaveLength(1);
    expect(result.changeset.changes[0]?.mutation).toBe("AddNote");
    expect(result.changeset.changes[0]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-2003",
      stage: "Contacted",
    });
    expect(result.skipped).toEqual([
      { change_id: original.changes[0]!.id, reason: "illegal_transition: Contacted → Contacted" },
    ]);
    expect(result.explanation).toContain("app_priya_142");
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });

  test("non-stale staged, approved, and applied throw rebase_not_stale", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);
    expect(() => withLedger(ws, (db, vault) => rebaseChangeset(db, vault, staged.id))).toThrow(
      new LedgerError("rebase_not_stale"),
    );

    const approved = ws.commit({
      rationale: "Note Priya",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "still staged sibling" },
        },
      ],
    });
    ws.review(approved.id, { action: "approve", reviewer_id: "hm" });
    expect(() => withLedger(ws, (db, vault) => rebaseChangeset(db, vault, approved.id))).toThrow(
      new LedgerError("rebase_not_stale"),
    );

    const applied = ws.push(approved.id).pushed[0];
    expect(applied?.status).toBe("applied");
    expect(() => withLedger(ws, (db, vault) => rebaseChangeset(db, vault, approved.id))).toThrow(
      new LedgerError("rebase_not_stale"),
    );
    ws.close();
  });

  test("unknown id throws rebase_not_found", () => {
    const ws = openTemp();
    ws.pull();
    expect(() => withLedger(ws, (db, vault) => rebaseChangeset(db, vault, "cs_missing"))).toThrow(
      new LedgerError("rebase_not_found"),
    );
    ws.close();
  });

  test("explanation is non-empty and includes the entity ref", () => {
    const ws = openTemp();
    ws.pull();
    const original = advancePriya(ws);
    markStaleByRemoteId(ws);
    const result = withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id));
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.explanation).toContain("application:app_priya_142");
    expect(result.explanation).toContain("A-2003");
    expect(result.explanation).toContain("A-DRIFT");
    ws.close();
  });

  test("SendOutreach rebase stays staged under always_gate", () => {
    const ws = openTemp();
    ws.pull();
    const original = ws.commit({
      rationale: "Intro email",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "SendOutreach",
          effect_class: "irreversible",
          payload: { body: "Hi Priya, interested in a chat?" },
        },
      ],
    });
    expect(original.status).toBe("staged");
    markStaleByRemoteId(ws);
    const policy = parseHiringMarkdown("## Policy\nauto_approve: [SendOutreach]\n").policy;
    const result = withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id, { policy }));
    expect(result.changeset.status).toBe("staged");
    expect(result.changeset.reviewed_by).toBeNull();
    expect(result.changeset.changes[0]?.mutation).toBe("SendOutreach");
    expect(result.changeset.changes[0]?.payload).toEqual({ body: "Hi Priya, interested in a chat?" });
    expect(ws.getChangeset(original.id).status).toBe("stale");
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });

  test("redacted payload is skipped as payload_unavailable", () => {
    const ws = openTemp();
    ws.pull();
    const original = ws.commit({
      rationale: "Private note",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "Compensation expectation $210k" },
        },
      ],
    });
    markStaleByRemoteId(ws);
    ws.shred("cand_priya");
    expect(() => withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id))).toThrow(
      new LedgerError("rebase_empty"),
    );
    ws.close();
  });

  test("agent-authored rebase keeps author_kind and agent_meta", () => {
    const ws = openTemp();
    ws.pull();
    const meta = { model: "mock", sessionId: "sess_1", promptRef: "hiring" };
    const original = ws.commit({
      rationale: "Agent screen",
      author_id: "sess_1",
      author_kind: "agent",
      agent_meta: meta,
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AdvanceStage",
          effect_class: "compensable",
          payload: { to: "Contacted" },
        },
      ],
    });
    markStaleByRemoteId(ws);
    const result = withLedger(ws, (db, vault) => rebaseChangeset(db, vault, original.id));
    expect(result.changeset.author_kind).toBe("agent");
    expect(result.changeset.agent_meta).toEqual(meta);
    expect(ws.getChangeset(original.id).status).toBe("stale");
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });
});
