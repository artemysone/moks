import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpConfig } from "../config.ts";
import { McpError } from "../mcp/errors.ts";
import { openSyncMcpClientCount } from "../mcp/sync-client.ts";
import { openWorkspace } from "../test-workspace.ts";
import { createMcpAtsAdapter, createMcpSourcingAdapter } from "./mcp.ts";

const FIXTURE_SERVER = fileURLToPath(new URL("../../fixtures/mock-mcp-ats.ts", import.meta.url));
const SERVER_COMMAND = ["bun", FIXTURE_SERVER];

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), "moks-mcp-"));
}

function writeConfig(cwd: string, mcp: McpConfig): void {
  mkdirSync(join(cwd, ".moks"), { recursive: true });
  writeFileSync(join(cwd, ".moks", "config.json"), JSON.stringify({ mcp }, null, 2));
}

function expectMcpError(fn: () => void): McpError {
  try {
    fn();
  } catch (cause) {
    if (cause instanceof McpError) return cause;
    throw cause;
  }
  throw new Error("expected McpError");
}

describe("McpAtsAdapter", () => {
  test("pull returns the adapter snapshot shape", () => {
    const adapter = createMcpAtsAdapter({ command: SERVER_COMMAND, timeoutMs: 8_000 }, { id: "ashby" });
    try {
      const snapshot = adapter.pull();
      expect(snapshot.ats).toBe("ashby");
      expect(snapshot.jobs).toHaveLength(1);
      expect(snapshot.jobs[0]).toEqual({
        id: "job_req200",
        remoteId: "ASH-200",
        title: "Senior Backend Engineer",
        team: "Payments",
        location: "Remote (US)",
        status: "open",
      });
      expect(snapshot.candidates).toHaveLength(3);
      expect(snapshot.applications.map((application) => application.stage)).toEqual([
        "Screen",
        "Screen",
        "Sourced",
      ]);
    } finally {
      adapter.close?.();
    }
  });

  test("apply happy path then CAS conflict on stale precondition", () => {
    const adapter = createMcpAtsAdapter({ command: SERVER_COMMAND, timeoutMs: 8_000 }, { id: "ashby" });
    try {
      const change = {
        entityType: "application" as const,
        entityRef: "app_lena_200",
        mutation: "AdvanceStage" as const,
        precondition: { id: "app_lena_200", remoteId: "AA-4001", stage: "Screen" as const },
        payload: { to: "Interview" as const },
      };
      const applied = adapter.apply(change);
      expect(applied).toEqual({
        ok: true,
        remoteResult: {
          id: "app_lena_200",
          remoteId: "AA-4001",
          jobId: "job_req200",
          candidateId: "cand_lena",
          stage: "Interview",
        },
      });

      const pulled = adapter.pull();
      expect(pulled.applications.find((application) => application.id === "app_lena_200")?.stage).toBe("Interview");

      // Same precondition again: the remote stage moved, so CAS must fail structurally.
      expect(adapter.apply(change)).toEqual({ ok: false, reason: "precondition_failed" });
    } finally {
      adapter.close?.();
    }
  });

  test("snapshot claiming a different ats is rejected as a bad response", () => {
    const adapter = createMcpAtsAdapter({ command: SERVER_COMMAND, timeoutMs: 8_000 }, { id: "greenhouse" });
    try {
      const error = expectMcpError(() => adapter.pull());
      expect(error.code).toBe("mcp_bad_response");
    } finally {
      adapter.close?.();
    }
  });
});

describe("MCP sourcing adapter", () => {
  test("search returns ranked candidates and honors limit", () => {
    const adapter = createMcpSourcingAdapter({ command: SERVER_COMMAND, timeoutMs: 8_000 });
    try {
      expect(adapter.id).toBe("juicebox");
      const all = adapter.search({ role: "Senior Backend" });
      expect(all.map((candidate) => candidate.id)).toEqual(["mcp_ada", "mcp_ravi", "mcp_nora"]);

      const limited = adapter.search({ role: "Senior Backend", limit: 2 });
      expect(limited).toHaveLength(2);

      expect(adapter.search({ role: "zzzz" })).toEqual([]);
    } finally {
      adapter.close?.();
    }
  });
});

describe("workspace wiring (MOKS_ATS=ashby over MCP)", () => {
  test("pull lands the mirror, push applies and goes stale on CAS conflict", () => {
    const cwd = tempCwd();
    writeConfig(cwd, { ats: { command: SERVER_COMMAND }, sourcing: { command: SERVER_COMMAND } });
    writeFileSync(join(cwd, "HIRING.md"), "# HIRING.md\n\n## Policy\nalways_gate: [AdvanceStage]\n");

    const ws = openWorkspace(cwd, { ats: "ashby", sourcing: "mcp" });
    try {
      expect(ws.ats).toBe("ashby");
      expect(ws.sourcing).toBe("juicebox");

      const pulled = ws.pull();
      expect(pulled.ats).toBe("ashby");
      expect(pulled.upserted).toEqual({ jobs: 1, candidates: 3, applications: 3 });

      const status = ws.status();
      expect(status.ats).toBe("ashby");
      expect(status.pipeline.Screen).toBe(2);

      const advance = (rationale: string, to: string) =>
        ws.commit({
          rationale,
          author_id: "recruiter",
          author_kind: "human",
          changes: [
            {
              entity_type: "application",
              entity_ref: "app_lena_200",
              mutation: "AdvanceStage",
              effect_class: "compensable",
              payload: { to },
            },
          ],
        });

      // Pending hops block a second Screen→Interview; Offer is the legal next hop. Both still capture Screen on the mirror, so the second CAS-fails after the first apply.
      const first = advance("Advance Lena", "Interview");
      const second = advance("Advance Lena again", "Offer");
      expect(first.status).toBe("staged");
      ws.review(first.id, { action: "approve", reviewer_id: "hiring_manager" });
      ws.review(second.id, { action: "approve", reviewer_id: "hiring_manager" });

      const pushed = ws.push();
      expect(pushed.pushed).toEqual([
        { id: first.id, status: "applied" },
        { id: second.id, status: "stale", reason: "precondition_failed" },
      ]);
      expect(ws.getChangeset(first.id).status).toBe("applied");
      expect(ws.getChangeset(second.id).status).toBe("stale");

      // refreshAfterPush re-pulls: the remote stage change is mirrored.
      expect(ws.status().pipeline.Interview).toBe(1);
    } finally {
      ws.close();
    }
  });

  test("partial multi-change push persists landed results, re-pulls, and a rebase replay dedupes", () => {
    const cwd = tempCwd();
    writeConfig(cwd, { ats: { command: SERVER_COMMAND } });

    const ws = openWorkspace(cwd, { ats: "ashby" });
    try {
      ws.pull();

      const ensureApproved = (id: string) => {
        if (ws.getChangeset(id).status === "staged") {
          ws.review(id, { action: "approve", reviewer_id: "hiring_manager" });
        }
      };

      // First hop Screen→Interview. Sibling Omar advance is the pending Offer hop;
      // both still capture Screen on the mirror, so CAS fails after the first apply.
      const advanceOmar = ws.commit({
        rationale: "Advance Omar",
        author_id: "recruiter",
        author_kind: "human",
        changes: [
          {
            entity_type: "application",
            entity_ref: "app_omar_200",
            mutation: "AdvanceStage",
            effect_class: "compensable",
            payload: { to: "Interview" },
          },
        ],
      });
      const notePlusAdvance = ws.commit({
        rationale: "Note Lena, advance Omar",
        author_id: "recruiter",
        author_kind: "human",
        changes: [
          {
            entity_type: "candidate",
            entity_ref: "cand_lena",
            mutation: "AddNote",
            effect_class: "reversible",
            payload: { body: "Intro call went well" },
          },
          {
            entity_type: "application",
            entity_ref: "app_omar_200",
            mutation: "AdvanceStage",
            effect_class: "compensable",
            payload: { to: "Offer" },
          },
        ],
      });
      ensureApproved(advanceOmar.id);
      ensureApproved(notePlusAdvance.id);

      const pushed = ws.push();
      expect(pushed.pushed).toEqual([
        { id: advanceOmar.id, status: "applied" },
        { id: notePlusAdvance.id, status: "stale", reason: "precondition_failed" },
      ]);

      // The note landed remotely before the CAS failure; its remoteResult is
      // recorded on the stale changeset (append-only), the advance is not.
      const stale = ws.getChangeset(notePlusAdvance.id);
      expect(stale.status).toBe("stale");
      const noteResult = stale.changes[0]?.remote_result;
      if (!noteResult || !("noteId" in noteResult)) throw new Error("expected note remote result");
      expect(noteResult.noteId).toEqual(expect.any(String));
      expect(stale.changes[1]?.remote_result).toBeNull();
      // The mirror was re-pulled and reflects the partially applied remote.
      expect(ws.status().pipeline.Interview).toBe(1);

      // Rebase keeps the note and the still-legal Offer hop against the Interview
      // mirror. Replaying the note uses the idempotency key (no second note).
      const rebased = ws.rebase(notePlusAdvance.id);
      expect(rebased.changeset.changes.map((change) => change.mutation)).toEqual([
        "AddNote",
        "AdvanceStage",
      ]);
      expect(rebased.changeset.changes[1]?.payload).toEqual({ to: "Offer" });
      ensureApproved(rebased.changeset.id);
      const repushed = ws.push(rebased.changeset.id);
      expect(repushed.pushed).toEqual([{ id: rebased.changeset.id, status: "applied" }]);
      const replayed = ws.getChangeset(rebased.changeset.id);
      expect(replayed.changes[0]?.remote_result).toEqual({ noteId: noteResult.noteId });
      const advanced = replayed.changes[1]?.remote_result;
      expect(advanced && "stage" in advanced ? advanced.stage : undefined).toBe("Offer");
    } finally {
      ws.close();
    }
  });

  test("openWorkspace failure after the MCP ATS adapter exists closes its bridge worker", () => {
    const cwd = tempCwd();
    // Valid MCP ATS config, but sourcing "mcp" has no server configured, so
    // openWorkspace throws after the ATS adapter (and its worker) was created.
    writeConfig(cwd, { ats: { command: SERVER_COMMAND } });
    const before = openSyncMcpClientCount();
    expect(() => openWorkspace(cwd, { ats: "ashby", sourcing: "mcp" })).toThrow("sourcing_unavailable: mcp");
    expect(openSyncMcpClientCount()).toBe(before);
  });

  test("MCP sourcing search flows through workspace.search", () => {
    const cwd = tempCwd();
    writeConfig(cwd, { sourcing: { command: SERVER_COMMAND } });
    const ws = openWorkspace(cwd, { sourcing: "mcp" });
    try {
      const result = ws.search({ role: "backend payments", limit: 2 });
      expect(result.source).toBe("juicebox");
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(["mcp_ada", "mcp_ravi"]);
    } finally {
      ws.close();
    }
  });

  test("ashby without MCP config fails closed with ats_unavailable", () => {
    expect(() => openWorkspace(tempCwd(), { ats: "ashby" })).toThrow("ats_unavailable: ashby");
  });

  test("MCP sourcing without config fails closed with sourcing_unavailable", () => {
    expect(() => openWorkspace(tempCwd(), { sourcing: "mcp" })).toThrow("sourcing_unavailable: mcp");
  });

  test("invalid MCP config fails closed at open", () => {
    const cwd = tempCwd();
    writeConfig(cwd, { ats: { command: SERVER_COMMAND, url: "http://127.0.0.1:9/mcp" } });
    expect(() => openWorkspace(cwd, { ats: "ashby" })).toThrow("mcp_config_invalid");
  });

  test("unreachable MCP server surfaces a structured error on pull", () => {
    const cwd = tempCwd();
    writeConfig(cwd, { ats: { command: ["bun", "-e", "process.exit(0)"], timeoutMs: 3000 } });
    const ws = openWorkspace(cwd, { ats: "ashby" });
    try {
      const error = expectMcpError(() => ws.pull());
      expect(error.code).toBe("mcp_connect_failed");
    } finally {
      ws.close();
    }
  });
});
