import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPLIANCE_SCHEMA } from "./compliance.ts";
import { openSqlite } from "./db.ts";
import { openWorkspace, type Workspace } from "./test-workspace.ts";

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), "moks-m3-"));
}

function writeHiring(cwd: string, policy: string): void {
  writeFileSync(join(cwd, "HIRING.md"), `# HIRING.md\n\n## Policy\n${policy}\n`);
}

function addNote(ws: Workspace, extras: Record<string, unknown> = {}) {
  return ws.commit({
    rationale: "Screen note",
    author_id: "recruiter",
    author_kind: "human",
    changes: [
      {
        entity_type: "application",
        entity_ref: "app_priya_142",
        mutation: "AddNote",
        effect_class: "reversible",
        payload: { body: "Strong systems answers" },
        ...extras,
      },
    ],
  });
}

function rejectPriya(ws: Workspace, authorKind: "human" | "agent") {
  return ws.commit({
    rationale: "Not a fit",
    author_id: authorKind === "agent" ? "sess_1" : "recruiter",
    author_kind: authorKind,
    agent_meta:
      authorKind === "agent" ? { model: "mock", sessionId: "sess_1", promptRef: "hiring" } : undefined,
    changes: [
      {
        entity_type: "application",
        entity_ref: "app_priya_142",
        mutation: "Reject",
        effect_class: "irreversible",
        payload: {},
      },
    ],
  });
}

describe("MOKS_ATS=greenhouse", () => {
  test("pull + status report greenhouse", () => {
    const ws = openWorkspace(tempCwd(), { ats: "greenhouse" });
    expect(ws.ats).toBe("greenhouse");
    const pulled = ws.pull();
    expect(pulled.ats).toBe("greenhouse");
    expect(pulled.upserted).toEqual({ jobs: 1, candidates: 3, applications: 3 });
    expect(existsSync(ws.paths.greenhouseAtsDb)).toBe(true);

    const status = ws.status();
    expect(status.ats).toBe("greenhouse");
    expect(status.applications).toBe(3);
    expect(status.pipeline.Screen).toBe(1);
    ws.close();
  });

  test("approved SendOutreach push applies and does not go stale", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "always_gate: [SendOutreach]\n");
    const ws = openWorkspace(cwd, { ats: "greenhouse" });
    ws.pull();
    const staged = ws.commit({
      rationale: "Intro email",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_gh_elena",
          mutation: "SendOutreach",
          effect_class: "irreversible",
          payload: { body: "Hi Elena, interested in a chat?" },
        },
      ],
    });
    expect(staged.status).toBe("staged");
    ws.review(staged.id, { action: "approve", reviewer_id: "hiring_manager" });
    const pushed = ws.push(staged.id);
    expect(pushed.pushed).toEqual([{ id: staged.id, status: "applied" }]);
    expect(ws.getChangeset(staged.id).status).toBe("applied");
    ws.close();
  });
});

describe("Juicebox sourcing", () => {
  test("search returns ranked candidates when configured", () => {
    const ws = openWorkspace(tempCwd(), { sourcing: "juicebox" });
    try {
      const result = ws.search({ role: "Senior Backend", limit: 2 });
      expect(result.source).toBe("juicebox");
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]?.id).toBe("jb_kenji");
      expect(result.candidates.every((candidate) => candidate.source === "juicebox")).toBe(true);
    } finally {
      ws.close();
    }
  });

  test("search throws sourcing_disabled when unset", () => {
    const ws = openWorkspace(tempCwd());
    expect(ws.sourcing).toBeNull();
    expect(() => ws.search({ role: "Senior Backend" })).toThrow("sourcing_disabled");
    ws.close();
  });
});

function openMock(cwd: string = tempCwd()): Workspace {
  return openWorkspace(cwd, { ats: "mock" });
}

describe("policy gates", () => {
  test("missing HIRING.md fails closed — AddNote stays staged", () => {
    const ws = openMock();
    ws.pull();
    const staged = addNote(ws);
    expect(staged.status).toBe("staged");
    expect(staged.reviewed_by).toBeNull();
    expect(staged.audit).toBe(false);
    ws.close();
  });

  test("auto_approve AddNote becomes approved without human", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [AddNote, AddTag]\n");
    const ws = openMock(cwd);
    ws.pull();
    const committed = addNote(ws);
    expect(committed.status).toBe("approved");
    expect(committed.reviewed_by).toBe("policy");
    expect(ws.getChangeset(committed.id).status).toBe("approved");
    expect(ws.status().changesets).toEqual({
      staged: 0,
      approved: 1,
      stale: 0,
      applied: 0,
      rejected: 0,
    });
    ws.close();
  });

  test("auto_approve SendOutreach and ExtendOffer stay staged", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [SendOutreach, ExtendOffer]\n");
    const ws = openMock(cwd);
    ws.pull();
    const outreach = ws.commit({
      rationale: "Intro email",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "SendOutreach",
          effect_class: "irreversible",
          payload: { body: "Hi Priya" },
        },
      ],
    });
    expect(outreach.status).toBe("staged");
    expect(outreach.reviewed_by).not.toBe("policy");
    expect(outreach.reviewed_by).toBeNull();

    const mock = openSqlite(ws.paths.mockAtsDb);
    mock.prepare("UPDATE applications SET stage = 'Offer' WHERE id = 'app_marcus_142'").run();
    mock.close();
    ws.pull();
    const offer = ws.commit({
      rationale: "Extend offer",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_marcus_142",
          mutation: "ExtendOffer",
          effect_class: "irreversible",
          payload: { terms: "185k + equity" },
        },
      ],
    });
    expect(offer.status).toBe("staged");
    expect(offer.reviewed_by).not.toBe("policy");
    expect(offer.reviewed_by).toBeNull();
    ws.close();
  });

  test("auto_approve Reject stays staged and is not policy-reviewed", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [Reject]\n");
    const ws = openMock(cwd);
    ws.pull();
    const staged = rejectPriya(ws, "human");
    expect(staged.status).toBe("staged");
    expect(staged.reviewed_by).not.toBe("policy");
    expect(staged.reviewed_by).toBeNull();
    ws.close();
  });

  test("auto_approve [AddNote, Reject] approves AddNote-only; Reject-only stays staged", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [AddNote, Reject]\n");
    const ws = openMock(cwd);
    ws.pull();
    const noted = addNote(ws);
    expect(noted.status).toBe("approved");
    expect(noted.reviewed_by).toBe("policy");
    const rejected = rejectPriya(ws, "human");
    expect(rejected.status).toBe("staged");
    expect(rejected.reviewed_by).not.toBe("policy");
    expect(rejected.reviewed_by).toBeNull();
    ws.close();
  });

  test("batch_review AdvanceStage stays staged", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [AddNote]\nbatch_review: [AdvanceStage]\n");
    const ws = openMock(cwd);
    ws.pull();
    const staged = ws.commit({
      rationale: "Reach out",
      author_id: "recruiter",
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
    expect(staged.status).toBe("staged");
    expect(staged.reviewed_by).toBeNull();
    ws.close();
  });

  test("mixed auto_approve + always_gate stays staged", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [AddNote]\nalways_gate: [AdvanceStage]\n");
    const ws = openMock(cwd);
    ws.pull();
    const staged = ws.commit({
      rationale: "Reach out and note",
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
    expect(staged.status).toBe("staged");
    ws.close();
  });

  test("Reject sampling 100% flags audit; 0% does not", () => {
    const sampled = tempCwd();
    writeHiring(sampled, "always_gate: [Reject]\nreject_sampling: 100%\n");
    const ws100 = openMock(sampled);
    ws100.pull();
    const flagged = rejectPriya(ws100, "agent");
    expect(flagged.audit).toBe(true);
    expect(flagged.status).toBe("staged");
    expect(ws100.getChangeset(flagged.id).audit).toBe(true);
    ws100.close();

    const none = tempCwd();
    writeHiring(none, "always_gate: [Reject]\nreject_sampling: 0%\n");
    const ws0 = openMock(none);
    ws0.pull();
    const clean = rejectPriya(ws0, "agent");
    expect(clean.audit).toBe(false);
    ws0.close();
  });

  test("human Reject is not sampled even at 100%", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "always_gate: [Reject]\nreject_sampling: 100%\n");
    const ws = openMock(cwd);
    ws.pull();
    const human = rejectPriya(ws, "human");
    expect(human.audit).toBe(false);
    ws.close();
  });
});

describe("compliance export", () => {
  test("has hashes, agent_meta, and no emails", () => {
    const cwd = tempCwd();
    writeHiring(cwd, "auto_approve: [AddNote]\n");
    const ws = openMock(cwd);
    ws.pull();
    const committed = ws.commit({
      rationale: "Private screen note",
      author_id: "sess_1",
      author_kind: "agent",
      agent_meta: { model: "mock", sessionId: "sess_1", promptRef: "abc123" },
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "Contact priya.shah@example.com about comp" },
        },
      ],
    });

    const exportDoc = ws.complianceLog();
    expect(exportDoc.schema).toBe(COMPLIANCE_SCHEMA);
    expect(exportDoc.policy_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(exportDoc.changesets).toHaveLength(1);
    const row = exportDoc.changesets[0]!;
    expect(row.id).toBe(committed.id);
    expect(row.hash).toBe(committed.hash);
    expect(row.parent_id).toBeNull();
    expect(row.author_kind).toBe("agent");
    expect(row.agent_meta).toEqual({ model: "mock", sessionId: "sess_1", promptRef: "abc123" });
    expect(row.reviewed_by).toBe("policy");
    expect(row.mutations).toEqual(["AddNote"]);
    expect(row.effect_classes).toEqual(["reversible"]);
    expect(row.changes[0]?.payload_ref).toBe(committed.changes[0]?.payload_ref);
    expect(row.changes[0]?.payload_redacted).toBe(true);
    expect(JSON.stringify(exportDoc)).not.toContain("priya.shah@example.com");
    expect(JSON.stringify(exportDoc)).not.toContain("@example.com");
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });
});
