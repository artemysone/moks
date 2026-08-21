import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitPermissionFor,
  effectiveCommitPermission,
  gateFor,
  parseHiringMarkdown,
  permissionFor,
  sampleReject,
  toolPermission,
  type Policy,
} from "./policy.ts";

const hiringTemplate = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../templates/company.md"),
  "utf8",
);

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    autoApprove: [],
    batchReview: [],
    alwaysGate: [],
    rejectSampling: 0,
    permissions: [],
    ...overrides,
  };
}

describe("parseHiringMarkdown", () => {
  test("parses the company-constitution COMPANY.md template", () => {
    const doc = parseHiringMarkdown(hiringTemplate);

    // A company constitution has no Role section; the role lives on each req.
    expect(doc.role).toBe("");
    expect(doc.bar).toContain("Strong fundamentals over framework familiarity");
    expect(doc.bar).toContain("role scorecard");
    expect(doc.comp).toContain("Never state comp in outreach.");
    expect(doc.tone).toContain("Warm, specific, no buzzwords.");
    expect(doc.tone).toContain("Follow-ups: max 2,");

    expect(doc.policy).toEqual({
      autoApprove: ["AddNote", "AddTag"],
      batchReview: ["AdvanceStage"],
      alwaysGate: ["SendOutreach", "Reject", "ExtendOffer"],
      rejectSampling: 0.1,
      permissions: [],
    });
    expect(doc.warnings).toEqual([]);
  });

  test("ignores unknown mutations and records them on warnings", () => {
    const doc = parseHiringMarkdown(`## Policy\nalways_gate: [Reject, NotAMutation]\n`);
    expect(doc.warnings).toEqual(["unknown mutation in always_gate: NotAMutation"]);
    expect(doc.policy.alwaysGate).toEqual(["Reject"]);
  });
});

describe("permissions block parsing", () => {
  test("parses bare keys, mutation patterns, and wildcard args", () => {
    const doc = parseHiringMarkdown(
      [
        "## Policy",
        "auto_approve: [AddNote]",
        "permissions:",
        "  workspace_read: allow",
        "  source_search: deny   # trailing comment",
        "  ledger_commit(AddNote): allow",
        "  ledger_commit(SendOutreach): deny",
        "  ledger_commit(*): ask",
        "reject_sampling: 25%",
      ].join("\n"),
    );
    expect(doc.warnings).toEqual([]);
    expect(doc.policy.permissions).toEqual([
      { tool: "workspace_read", mutation: null, decision: "allow" },
      { tool: "source_search", mutation: null, decision: "deny" },
      { tool: "ledger_commit", mutation: "AddNote", decision: "allow" },
      { tool: "ledger_commit", mutation: "SendOutreach", decision: "deny" },
      { tool: "ledger_commit", mutation: null, decision: "ask" },
    ]);
    // A non-indented line closes the block; keys after it still parse.
    expect(doc.policy.autoApprove).toEqual(["AddNote"]);
    expect(doc.policy.rejectSampling).toBe(0.25);
  });

  test("invalid decisions, unknown tools, and unknown mutations warn and drop", () => {
    const doc = parseHiringMarkdown(
      [
        "## Policy",
        "permissions:",
        "  workspace_read: maybe",
        "  not_a_tool: allow",
        "  ledger_commit(NotAMutation): deny",
        "  workspace_read(AddNote): allow",
        "  just some prose",
        "  ledger_commit: ask",
      ].join("\n"),
    );
    expect(doc.warnings).toEqual([
      "invalid decision in permissions: workspace_read: maybe",
      "unknown tool in permissions: not_a_tool",
      "unknown mutation in permissions: NotAMutation",
      "argument pattern only supported on ledger_commit in permissions: workspace_read(AddNote): allow",
      "invalid permissions entry: just some prose",
    ]);
    expect(doc.policy.permissions).toEqual([{ tool: "ledger_commit", mutation: null, decision: "ask" }]);
  });

  test("inline value on the permissions key warns", () => {
    const doc = parseHiringMarkdown("## Policy\npermissions: ledger_commit=ask\n");
    expect(doc.warnings).toEqual(["permissions must be an indented block, ignored inline value: ledger_commit=ask"]);
    expect(doc.policy.permissions).toEqual([]);
  });

  test("missing permissions section leaves the map empty", () => {
    const doc = parseHiringMarkdown("## Policy\nauto_approve: [AddNote]\n");
    expect(doc.policy.permissions).toEqual([]);
    expect(doc.warnings).toEqual([]);
  });
});

describe("permission lookup and precedence", () => {
  const parsed = parseHiringMarkdown(
    [
      "## Policy",
      "permissions:",
      "  source_search: deny",
      "  ledger_commit(AddNote): allow",
      "  ledger_commit(SendOutreach): deny",
      "  ledger_commit: ask",
    ].join("\n"),
  ).policy;

  test("bare tool keys resolve; unlisted tools return null", () => {
    expect(permissionFor("source_search", parsed)).toBe("deny");
    expect(permissionFor("workspace_read", parsed)).toBeNull();
  });

  test("specific mutation pattern beats the bare wildcard fallback", () => {
    expect(commitPermissionFor("AddNote", parsed)).toBe("allow");
    expect(commitPermissionFor("SendOutreach", parsed)).toBe("deny");
    expect(commitPermissionFor("AdvanceStage", parsed)).toBe("ask");
  });

  test("later duplicate rules override earlier ones", () => {
    const doc = parseHiringMarkdown(
      ["## Policy", "permissions:", "  ledger_commit(AddNote): deny", "  ledger_commit(AddNote): allow"].join("\n"),
    ).policy;
    expect(commitPermissionFor("AddNote", doc)).toBe("allow");
  });

  test("allow only takes effect for reversible mutations, else degrades to ask", () => {
    const open = parseHiringMarkdown("## Policy\npermissions:\n  ledger_commit: allow\n").policy;
    expect(effectiveCommitPermission("AddNote", open)).toBe("allow");
    expect(effectiveCommitPermission("AddTag", open)).toBe("allow");
    expect(effectiveCommitPermission("AdvanceStage", open)).toBe("ask");
    expect(effectiveCommitPermission("SendOutreach", open)).toBe("ask");
    expect(effectiveCommitPermission("ExtendOffer", open)).toBe("ask");
    expect(effectiveCommitPermission("Reject", open)).toBe("ask");
  });

  test("deny is never degraded", () => {
    expect(effectiveCommitPermission("SendOutreach", parsed)).toBe("deny");
  });
});

describe("toolPermission", () => {
  const parsed = parseHiringMarkdown(
    [
      "## Policy",
      "permissions:",
      "  source_search: deny",
      "  workspace_read: allow",
      "  ledger_commit(AddNote): allow",
      "  ledger_commit(AddTag): allow",
      "  ledger_commit(SendOutreach): deny",
    ].join("\n"),
  ).policy;

  test("read tools: deny, allow, and unmatched proceed", () => {
    expect(toolPermission("source_search", [], parsed)).toEqual({ action: "deny", denied: ["source_search"] });
    expect(toolPermission("workspace_read", [], parsed)).toEqual({ action: "allow" });
    expect(toolPermission("ledger_status", [], parsed)).toEqual({ action: "proceed" });
  });

  test("deny wins over allow in a multi-mutation commit", () => {
    expect(toolPermission("ledger_commit", ["AddNote", "SendOutreach"], parsed)).toEqual({
      action: "deny",
      denied: ["SendOutreach"],
    });
  });

  test("all-reversible allow commits skip the gate", () => {
    expect(toolPermission("ledger_commit", ["AddNote", "AddTag"], parsed)).toEqual({ action: "allow" });
  });

  test("a commit with an unmatched mutation proceeds with existing behavior", () => {
    expect(toolPermission("ledger_commit", ["AddNote", "AdvanceStage"], parsed)).toEqual({ action: "proceed" });
  });

  test("wildcard fallback resolves every mutation; non-reversible allow asks", () => {
    const open = parseHiringMarkdown("## Policy\npermissions:\n  ledger_commit: allow\n").policy;
    expect(toolPermission("ledger_commit", ["AddNote", "AddTag"], open)).toEqual({ action: "allow" });
    expect(toolPermission("ledger_commit", ["AddNote", "AdvanceStage"], open)).toEqual({ action: "ask" });
    expect(toolPermission("ledger_commit", ["NotAMutation"], open)).toEqual({ action: "ask" });
  });

  test("bare deny denies commits with unknown mutation names too", () => {
    const closed = parseHiringMarkdown("## Policy\npermissions:\n  ledger_commit: deny\n").policy;
    expect(toolPermission("ledger_commit", ["NotAMutation"], closed)).toEqual({
      action: "deny",
      denied: ["NotAMutation"],
    });
    expect(toolPermission("ledger_commit", [], closed)).toEqual({ action: "deny", denied: [""] });
  });

  test("empty permissions map proceeds everywhere", () => {
    const empty = policy();
    expect(toolPermission("workspace_read", [], empty)).toEqual({ action: "proceed" });
    expect(toolPermission("ledger_commit", ["AddNote"], empty)).toEqual({ action: "proceed" });
  });
});

describe("gateFor", () => {
  const fromTemplate = parseHiringMarkdown(hiringTemplate).policy;

  test("AddNote and AddTag are auto", () => {
    expect(gateFor("AddNote", fromTemplate)).toBe("auto");
    expect(gateFor("AddTag", fromTemplate)).toBe("auto");
  });

  test("AdvanceStage is batch", () => {
    expect(gateFor("AdvanceStage", fromTemplate)).toBe("batch");
  });

  test("Reject, SendOutreach, and ExtendOffer are always", () => {
    expect(gateFor("Reject", fromTemplate)).toBe("always");
    expect(gateFor("SendOutreach", fromTemplate)).toBe("always");
    expect(gateFor("ExtendOffer", fromTemplate)).toBe("always");
  });

  test("unlisted mutations fail closed to always", () => {
    expect(gateFor("Withdraw", fromTemplate)).toBe("always");
  });

  test("always_gate wins when a mutation is listed more than once", () => {
    const overlapping = policy({
      autoApprove: ["Reject"],
      batchReview: ["Reject"],
      alwaysGate: ["Reject"],
    });
    expect(gateFor("Reject", overlapping)).toBe("always");
  });

  test("auto_approve of irreversible or compensable is ignored", () => {
    const open = policy({
      autoApprove: ["Reject", "SendOutreach", "ExtendOffer", "AdvanceStage", "Withdraw", "AddNote"],
    });
    expect(gateFor("Reject", open)).toBe("always");
    expect(gateFor("SendOutreach", open)).toBe("always");
    expect(gateFor("ExtendOffer", open)).toBe("always");
    expect(gateFor("AdvanceStage", open)).toBe("always");
    expect(gateFor("Withdraw", open)).toBe("always");
    expect(gateFor("AddNote", open)).toBe("auto");
  });
});

describe("sampleReject", () => {
  test("0% never flags", () => {
    const none = policy({ rejectSampling: 0 });
    expect(sampleReject(none, () => 0)).toBe(false);
    expect(sampleReject(none, () => 0.5)).toBe(false);
    expect(sampleReject(none, () => 0.999)).toBe(false);
  });

  test("100% always flags", () => {
    const all = policy({ rejectSampling: 1 });
    expect(sampleReject(all, () => 0)).toBe(true);
    expect(sampleReject(all, () => 0.5)).toBe(true);
    expect(sampleReject(all, () => 0.999)).toBe(true);
  });

  test("10% uses the rng threshold", () => {
    const ten = policy({ rejectSampling: 0.1 });
    expect(sampleReject(ten, () => 0.09)).toBe(true);
    expect(sampleReject(ten, () => 0.1)).toBe(false);
  });
});
