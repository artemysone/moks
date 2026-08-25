import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite, type SqlBindings } from "./db.ts";
import { openWorkspace, type Workspace } from "./temp-ledger.ts";
import { markChangesetStatus, type CommitChangeInput } from "./ledger.ts";

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), "moks-ledger-"));
}

function openTemp(): Workspace {
  return openWorkspace(tempCwd());
}

function advancePriya(ws: Workspace, extras: Partial<CommitChangeInput> = {}) {
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
        ...extras,
      },
    ],
  });
}

describe("ledger", () => {
  test("hash chain: parent linkage + tamper detection", () => {
    const ws = openTemp();
    ws.pull();
    const first = advancePriya(ws);
    const second = ws.commit({
      rationale: "Add a note",
      author_id: "recruiter",
      author_kind: "human",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "Intro sent" },
        },
      ],
    });

    expect(first.parent_id).toBeNull();
    expect(second.parent_id).toBe(first.id);
    expect(ws.verifyChain()).toEqual({ ok: true });

    const db = openSqlite(ws.paths.workspaceDb);
    db.prepare("UPDATE changesets SET rationale = 'tampered' WHERE id = ?").run(first.id);
    db.close();
    expect(ws.verifyChain()).toMatchObject({ ok: false, reason: "hash_mismatch", changesetId: first.id });
    ws.close();
  });

  test("illegal stage transition rejected at commit", () => {
    const ws = openTemp();
    ws.pull();
    expect(() =>
      ws.commit({
        rationale: "skip ahead",
        author_id: "recruiter",
        changes: [
          {
            entity_type: "application",
            entity_ref: "app_priya_142",
            mutation: "AdvanceStage",
            effect_class: "compensable",
            payload: { to: "Interview" },
          },
        ],
      }),
    ).toThrow("illegal_transition: Sourced → Interview");
    ws.close();
  });

  test("wrong effect class rejected", () => {
    const ws = openTemp();
    ws.pull();
    expect(() =>
      ws.commit({
        rationale: "reject Priya",
        author_id: "recruiter",
        changes: [
          {
            entity_type: "application",
            entity_ref: "app_priya_142",
            mutation: "Reject",
            effect_class: "compensable",
            payload: {},
          },
        ],
      }),
    ).toThrow("effect_class_mismatch: Reject requires irreversible");
    ws.close();
  });

  test("PII shredding: decrypt fails after shred; hash still verifies", () => {
    const ws = openTemp();
    ws.pull();
    const staged = ws.commit({
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
    expect(staged.changes[0]?.payload).toEqual({ body: "Compensation expectation $210k" });
    expect(staged.changes[0]?.payload_redacted).toBe(false);

    ws.shred("cand_priya");
    const after = ws.getChangeset(staged.id);
    expect(after.changes[0]?.payload).toBeNull();
    expect(after.changes[0]?.payload_redacted).toBe(true);
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });

  test("review required: push of staged changeset fails", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);
    expect(() => ws.push(staged.id)).toThrow("review_required");
    expect(ws.getChangeset(staged.id).status).toBe("staged");
    ws.close();
  });

  test("CAS: mutate mock ATS under an approved changeset → push marks stale", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);
    ws.review(staged.id, { action: "approve", reviewer_id: "hiring_manager" });

    const mock = openSqlite(ws.paths.mockAtsDb);
    mock.prepare("UPDATE applications SET stage = 'Replied' WHERE id = 'app_priya_142'").run();
    mock.close();

    const result = ws.push(staged.id);
    expect(result.pushed).toEqual([{ id: staged.id, status: "stale", reason: "precondition_failed" }]);
    expect(ws.getChangeset(staged.id).status).toBe("stale");

    const still = openSqlite(ws.paths.mockAtsDb);
    const app = still.prepare<{ stage: string }, SqlBindings>("SELECT stage FROM applications WHERE id = 'app_priya_142'").get();
    if (!app) throw new Error("expected application");
    expect(app.stage).toBe("Replied");
    still.close();
    ws.close();
  });

  test("happy path: pull → commit AdvanceStage → review → push updates mock ATS + mirror", () => {
    const ws = openTemp();
    const pulled = ws.pull();
    expect(pulled.upserted.applications).toBe(5);

    const staged = advancePriya(ws);
    expect(staged.status).toBe("staged");
    expect(ws.status().changesets).toEqual({ staged: 1, approved: 0, stale: 0, applied: 0, rejected: 0 });

    const reviewed = ws.review(staged.id, { action: "approve", reviewer_id: "hiring_manager" });
    expect(reviewed.status).toBe("approved");
    expect(reviewed.reviewed_by).toBe("hiring_manager");
    expect(ws.status().changesets.approved).toBe(1);

    const pushed = ws.push(staged.id);
    expect(pushed.pushed).toEqual([{ id: staged.id, status: "applied" }]);

    const mock = openSqlite(ws.paths.mockAtsDb);
    const app = mock.prepare<{ stage: string }, SqlBindings>("SELECT stage FROM applications WHERE id = 'app_priya_142'").get();
    if (!app) throw new Error("expected application");
    expect(app.stage).toBe("Contacted");
    mock.close();

    const status = ws.status();
    expect(status.pipeline.Contacted).toBe(2);
    expect(status.pipeline.Sourced ?? 0).toBe(0);
    expect(status.changesets).toEqual({ staged: 0, approved: 0, stale: 0, applied: 1, rejected: 0 });
    expect(ws.log()[0]?.status).toBe("applied");
    ws.close();
  });

  test("status counts reflect real changeset statuses", () => {
    const ws = openTemp();
    ws.pull();
    const a = advancePriya(ws);
    const b = ws.commit({
      rationale: "Tag Priya",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddTag",
          effect_class: "reversible",
          payload: { tag: "priority" },
        },
      ],
    });
    ws.review(a.id, { action: "approve", reviewer_id: "hm" });
    ws.review(b.id, { action: "reject", reviewer_id: "hm" });
    expect(ws.status().changesets).toEqual({ staged: 0, approved: 1, stale: 0, applied: 0, rejected: 1 });
    ws.close();
  });

  test("stored precondition is a PII-free CAS token", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);
    const names = ["Priya Shah", "Jane Ortega", "Marcus Chen", "Devon Hale", "Amira Hassan"];
    const stored = JSON.stringify(staged.changes[0]?.precondition);
    expect(stored).not.toContain("@");
    for (const name of names) {
      expect(stored).not.toContain(name);
    }
    expect(staged.changes[0]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-2003",
      stage: "Sourced",
    });

    const note = ws.commit({
      rationale: "Candidate note",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "candidate",
          entity_ref: "cand_priya",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "hello" },
        },
      ],
    });
    expect(JSON.stringify(note.changes[0]?.precondition)).not.toContain("@");
    expect(note.changes[0]?.precondition).toEqual({ id: "cand_priya", remoteId: "C-1003" });
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });

  test("empty precondition is rejected at commit", () => {
    const ws = openTemp();
    ws.pull();
    expect(() => advancePriya(ws, { precondition: {} })).toThrow("empty_precondition");
    ws.close();
  });

  test("caller precondition is an extra assertion on the CAS token", () => {
    const ws = openTemp();
    ws.pull();
    const ok = advancePriya(ws, { precondition: { stage: "Sourced" } });
    expect(ok.changes[0]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-2003",
      stage: "Sourced",
    });
    expect(() =>
      ws.commit({
        rationale: "wrong assertion",
        author_id: "recruiter",
        changes: [
          {
            entity_type: "application",
            entity_ref: "app_priya_142",
            mutation: "AddNote",
            effect_class: "reversible",
            precondition: { stage: "Interview" },
            payload: { body: "nope" },
          },
        ],
      }),
    ).toThrow("precondition_mismatch");
    ws.close();
  });

  test("AdvanceStage + AddNote in one changeset commits and pushes", () => {
    const ws = openTemp();
    ws.pull();
    const staged = ws.commit({
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
    expect(staged.changes[0]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-2003",
      stage: "Sourced",
    });
    expect(staged.changes[1]?.precondition).toEqual({
      id: "app_priya_142",
      remoteId: "A-2003",
      stage: "Contacted",
    });
    ws.review(staged.id, { action: "approve", reviewer_id: "hm" });
    expect(ws.push(staged.id).pushed).toEqual([{ id: staged.id, status: "applied" }]);

    const mock = openSqlite(ws.paths.mockAtsDb);
    const app = mock.prepare<{ stage: string }, SqlBindings>("SELECT stage FROM applications WHERE id = 'app_priya_142'").get();
    const notes = mock.prepare<{ body: string }, SqlBindings>("SELECT body FROM notes").all();
    if (!app) throw new Error("expected application");
    expect(app.stage).toBe("Contacted");
    expect(notes).toEqual([{ body: "Intro sent" }]);
    mock.close();
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });

  test("job AddNote commits and applies", () => {
    const ws = openTemp();
    ws.pull();
    const staged = ws.commit({
      rationale: "Note on the req",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "job",
          entity_ref: "job_req142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "Comp band approved" },
        },
      ],
    });
    expect(staged.changes[0]?.precondition).toEqual({
      id: "job_req142",
      remoteId: "REQ-142",
      status: "open",
    });
    ws.review(staged.id, { action: "approve", reviewer_id: "hm" });
    expect(ws.push(staged.id).pushed).toEqual([{ id: staged.id, status: "applied" }]);
    const mock = openSqlite(ws.paths.mockAtsDb);
    const notes = mock.prepare("SELECT entity_type, entity_ref, body FROM notes").all();
    expect(notes).toEqual([{ entity_type: "job", entity_ref: "job_req142", body: "Comp band approved" }]);
    mock.close();
    ws.close();
  });

  test("pull marks a conflicting staged changeset stale without diff", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);
    const mock = openSqlite(ws.paths.mockAtsDb);
    mock.prepare("UPDATE applications SET stage = 'Replied' WHERE id = 'app_priya_142'").run();
    mock.close();
    ws.pull();
    expect(ws.getChangeset(staged.id).status).toBe("stale");
    ws.close();
  });

  test("push of one changeset marks a conflicting sibling stale", () => {
    const ws = openTemp();
    ws.pull();
    const first = advancePriya(ws);
    const sibling = ws.commit({
      rationale: "Also note Priya",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "will go stale" },
        },
      ],
    });
    ws.review(first.id, { action: "approve", reviewer_id: "hm" });
    expect(ws.push(first.id).pushed).toEqual([{ id: first.id, status: "applied" }]);
    expect(ws.getChangeset(sibling.id).status).toBe("stale");
    ws.close();
  });

  test("ExtendOffer is only legal from Offer", () => {
    const ws = openTemp();
    ws.pull();
    const mock = openSqlite(ws.paths.mockAtsDb);
    mock.prepare("UPDATE applications SET stage = 'Withdrawn' WHERE id = 'app_devon_142'").run();
    mock.prepare("UPDATE applications SET stage = 'Hired' WHERE id = 'app_jane_142'").run();
    mock.prepare("UPDATE applications SET stage = 'Offer' WHERE id = 'app_marcus_142'").run();
    mock.close();
    ws.pull();

    const extend = (entity_ref: string) =>
      ws.commit({
        rationale: "Extend offer",
        author_id: "recruiter",
        changes: [
          {
            entity_type: "application",
            entity_ref,
            mutation: "ExtendOffer",
            effect_class: "irreversible",
            payload: { terms: "185k + equity" },
          },
        ],
      });

    expect(() => extend("app_priya_142")).toThrow("illegal_transition: Sourced → ExtendOffer");
    expect(() => extend("app_amira_142")).toThrow("illegal_transition: Rejected → ExtendOffer");
    expect(() => extend("app_devon_142")).toThrow("illegal_transition: Withdrawn → ExtendOffer");
    expect(() => extend("app_jane_142")).toThrow("illegal_transition: Hired → ExtendOffer");

    const staged = extend("app_marcus_142");
    expect(staged.status).toBe("staged");
    expect(staged.changes[0]?.mutation).toBe("ExtendOffer");
    ws.close();
  });

  test("SendOutreach requires body, applies outreach, and CAS-fails to stale", () => {
    const ws = openTemp();
    ws.pull();
    expect(() =>
      ws.commit({
        rationale: "empty outreach",
        author_id: "recruiter",
        changes: [
          {
            entity_type: "application",
            entity_ref: "app_priya_142",
            mutation: "SendOutreach",
            effect_class: "irreversible",
            payload: {},
          },
        ],
      }),
    ).toThrow("invalid_payload: SendOutreach requires body");

    const applied = ws.commit({
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
    expect(applied.status).toBe("staged");
    expect(applied.changes[0]?.mutation).toBe("SendOutreach");
    ws.review(applied.id, { action: "approve", reviewer_id: "hm" });
    expect(ws.push(applied.id).pushed).toEqual([{ id: applied.id, status: "applied" }]);
    const afterApply = openSqlite(ws.paths.mockAtsDb);
    const outreach = afterApply.prepare("SELECT entity_ref, body FROM outreach").all();
    expect(outreach).toEqual([{ entity_ref: "app_priya_142", body: "Hi Priya, interested in a chat?" }]);
    afterApply.close();

    const stale = ws.commit({
      rationale: "Follow-up email",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "SendOutreach",
          effect_class: "irreversible",
          payload: { body: "will go stale" },
        },
      ],
    });
    ws.review(stale.id, { action: "approve", reviewer_id: "hm" });
    const mock = openSqlite(ws.paths.mockAtsDb);
    mock.prepare("UPDATE applications SET stage = 'Replied' WHERE id = 'app_priya_142'").run();
    mock.close();
    expect(ws.push(stale.id).pushed).toEqual([{ id: stale.id, status: "stale", reason: "precondition_failed" }]);
    expect(ws.getChangeset(stale.id).status).toBe("stale");
    ws.close();
  });

  test("ExtendOffer requires terms and apply writes an offers row", () => {
    const ws = openTemp();
    ws.pull();
    const mock = openSqlite(ws.paths.mockAtsDb);
    mock.prepare("UPDATE applications SET stage = 'Offer' WHERE id = 'app_marcus_142'").run();
    mock.close();
    ws.pull();

    expect(() =>
      ws.commit({
        rationale: "empty offer",
        author_id: "recruiter",
        changes: [
          {
            entity_type: "application",
            entity_ref: "app_marcus_142",
            mutation: "ExtendOffer",
            effect_class: "irreversible",
            payload: {},
          },
        ],
      }),
    ).toThrow("invalid_payload: ExtendOffer requires terms");

    const staged = ws.commit({
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
    expect(staged.status).toBe("staged");
    ws.review(staged.id, { action: "approve", reviewer_id: "hm" });
    expect(ws.push(staged.id).pushed).toEqual([{ id: staged.id, status: "applied" }]);

    const after = openSqlite(ws.paths.mockAtsDb);
    const offers = after.prepare("SELECT entity_ref, terms FROM offers").all();
    expect(offers).toEqual([{ entity_ref: "app_marcus_142", terms: "185k + equity" }]);
    after.close();
    ws.close();
  });

  test("lifecycle: skipping and backwards status transitions rejected", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);

    const db = openSqlite(ws.paths.workspaceDb);
    expect(() => markChangesetStatus(db, staged.id, "applied")).toThrow("illegal_lifecycle: staged → applied");
    expect(() => markChangesetStatus(db, staged.id, "staged")).toThrow("illegal_lifecycle: staged → staged");
    expect(() => markChangesetStatus(db, "missing", "stale")).toThrow("changeset_not_found");

    markChangesetStatus(db, staged.id, "stale");
    expect(ws.getChangeset(staged.id).status).toBe("stale");
    expect(() => markChangesetStatus(db, staged.id, "staged")).toThrow("illegal_lifecycle: stale → staged");

    const approved = advancePriya(ws);
    ws.review(approved.id, { action: "approve", reviewer_id: "hm" });
    expect(ws.push(approved.id).pushed).toEqual([{ id: approved.id, status: "applied" }]);
    expect(() => markChangesetStatus(db, approved.id, "stale")).toThrow("illegal_lifecycle: applied → stale");
    db.close();
    ws.close();
  });

  test("review rejects empty and whitespace reviewer_id", () => {
    const ws = openTemp();
    ws.pull();
    const staged = advancePriya(ws);
    expect(() => ws.review(staged.id, { action: "approve", reviewer_id: "" })).toThrow("reviewer_id_required");
    expect(() => ws.review(staged.id, { action: "approve", reviewer_id: "   " })).toThrow("reviewer_id_required");
    expect(ws.getChangeset(staged.id).status).toBe("staged");
    ws.close();
  });

  test("same-ms sequential commits still verify", () => {
    const ws = openTemp();
    ws.pull();
    const first = advancePriya(ws);
    const second = ws.commit({
      rationale: "Note",
      author_id: "recruiter",
      changes: [
        {
          entity_type: "application",
          entity_ref: "app_priya_142",
          mutation: "AddNote",
          effect_class: "reversible",
          payload: { body: "same ms" },
        },
      ],
    });
    const db = openSqlite(ws.paths.workspaceDb);
    db.prepare("UPDATE changesets SET created_at = 1").run();
    db.close();
    expect(second.parent_id).toBe(first.id);
    expect(ws.verifyChain()).toEqual({ ok: true });
    ws.close();
  });
});
