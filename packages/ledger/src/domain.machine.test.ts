import { describe, expect, test } from "bun:test";
import {
  ACTIVE_STAGES,
  TERMINAL_STAGES,
  canExitToTerminal,
  canExtendOffer,
  isLegalAdvance,
  nextStage,
  requiredEffectClass,
} from "./domain.ts";

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
