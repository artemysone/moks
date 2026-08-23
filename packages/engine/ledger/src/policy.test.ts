import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateFor,
  parseHiringMarkdown,
  sampleReject,
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
    });
    expect(doc.warnings).toEqual([]);
  });

  test("ignores unknown mutations and records them on warnings", () => {
    const doc = parseHiringMarkdown(`## Policy\nalways_gate: [Reject, NotAMutation]\n`);
    expect(doc.warnings).toEqual(["unknown mutation in always_gate: NotAMutation"]);
    expect(doc.policy.alwaysGate).toEqual(["Reject"]);
  });

  test("parse Process stages drops unknown tokens and keeps ledger order", () => {
    const doc = parseHiringMarkdown(`## Process
- Stages: sourced → screen → phone → onsite → offer → hire
`);
    expect(doc.stages).toEqual(["Sourced", "Screen", "Offer", "Hired"]);
  });

  test("no Process section yields empty stages", () => {
    const doc = parseHiringMarkdown(`# Role\n`);
    expect(doc.stages).toEqual([]);
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
