import { describe, expect, test } from "bun:test";
import {
  ACTIVE_STAGES,
  TERMINAL_STAGES,
  canExitToTerminal,
  canExtendOffer,
  isLegalAdvance,
  isLegalAdvanceOnPath,
  nextStage,
  nextStageOnPath,
  requiredEffectClass,
  isStage,
} from "./domain.ts";
import { assertMutationLegal } from "./ledger.ts";

describe("nextStage / isLegalAdvance", () => {
  test("Sourced advances to Contacted", () => {
    expect(nextStage("Sourced")).toBe("Contacted");
    expect(isLegalAdvance("Sourced", "Contacted")).toBe(true);
  });

  test("Sourced cannot skip to Screen", () => {
    expect(isLegalAdvance("Sourced", "Screen")).toBe(false);
  });

  test("Hired has no next stage", () => {
    expect(nextStage("Hired")).toBe(null);
  });
});

describe("canExitToTerminal", () => {
  test("is true for every active stage", () => {
    for (const stage of ACTIVE_STAGES) {
      expect(canExitToTerminal(stage)).toBe(true);
    }
  });

  test("is false for Hired, Rejected, and Withdrawn", () => {
    for (const stage of TERMINAL_STAGES) {
      expect(canExitToTerminal(stage)).toBe(false);
    }
  });
});

describe("canExtendOffer", () => {
  test("is true only from Offer", () => {
    expect(canExtendOffer("Offer")).toBe(true);
    expect(canExtendOffer("Interview")).toBe(false);
    expect(canExtendOffer("Sourced")).toBe(false);
    expect(canExtendOffer("Rejected")).toBe(false);
    expect(canExtendOffer("Withdrawn")).toBe(false);
    expect(canExtendOffer("Hired")).toBe(false);
  });
});

describe("requiredEffectClass", () => {
  test("AddNote and AddTag are reversible", () => {
    expect(requiredEffectClass("AddNote")).toBe("reversible");
    expect(requiredEffectClass("AddTag")).toBe("reversible");
  });

  test("AdvanceStage and Withdraw are compensable", () => {
    expect(requiredEffectClass("AdvanceStage")).toBe("compensable");
    expect(requiredEffectClass("Withdraw")).toBe("compensable");
  });

  test("Reject, SendOutreach, and ExtendOffer are irreversible", () => {
    expect(requiredEffectClass("Reject")).toBe("irreversible");
    expect(requiredEffectClass("SendOutreach")).toBe("irreversible");
    expect(requiredEffectClass("ExtendOffer")).toBe("irreversible");
  });
});

describe("nextStageOnPath / isLegalAdvanceOnPath", () => {
  const path = ["Sourced", "Screen", "Offer", "Hired"] as const;

  test("path of length >= 2 uses the req order", () => {
    expect(nextStageOnPath("Sourced", path)).toBe("Screen");
    expect(isLegalAdvanceOnPath("Sourced", "Screen", path)).toBe(true);
    expect(isLegalAdvanceOnPath("Sourced", "Contacted", path)).toBe(false);
  });

  test("missing or short path falls back to the default machine", () => {
    expect(isLegalAdvanceOnPath("Sourced", "Contacted")).toBe(true);
    expect(isLegalAdvanceOnPath("Sourced", "Screen")).toBe(false);
    expect(isLegalAdvanceOnPath("Sourced", "Screen", ["Sourced"])).toBe(false);
  });
});

describe("HIRING path with Phone/Onsite", () => {
  const hiring = ["Sourced", "Screen", "Phone", "Onsite", "Offer", "Hired"] as const;

  test("Screen→Phone and Phone→Onsite are legal; Sourced→Phone is not", () => {
    expect(isLegalAdvanceOnPath("Screen", "Phone", hiring)).toBe(true);
    expect(nextStageOnPath("Screen", hiring)).toBe("Phone");
    expect(isLegalAdvanceOnPath("Phone", "Onsite", hiring)).toBe(true);
    expect(isLegalAdvanceOnPath("Sourced", "Phone", hiring)).toBe(false);
  });

  test("default machine is still Sourced→Contacted; Sourced→Screen is false", () => {
    expect(isLegalAdvance("Sourced", "Contacted")).toBe(true);
    expect(isLegalAdvance("Sourced", "Screen")).toBe(false);
    expect(isLegalAdvanceOnPath("Sourced", "Contacted")).toBe(true);
    expect(isLegalAdvanceOnPath("Sourced", "Screen")).toBe(false);
  });
});

describe("assertMutationLegal HIRING hops", () => {
  const hiring = ["Sourced", "Screen", "Phone", "Onsite", "Offer", "Hired"] as const;
  const app = (stage: string) => ({
    id: "app_1",
    remoteId: "r1",
    jobId: "job_1",
    candidateId: "cand_1",
    stage,
  });

  test("AdvanceStage Sourced→Screen then Screen→Phone succeeds; Phone is a stage", () => {
    expect(isStage("Phone")).toBe(true);
    expect(() =>
      assertMutationLegal("AdvanceStage", "application", app("Sourced"), { to: "Screen" }, [...hiring]),
    ).not.toThrow();
    expect(() =>
      assertMutationLegal("AdvanceStage", "application", app("Screen"), { to: "Phone" }, [...hiring]),
    ).not.toThrow();
  });
});
