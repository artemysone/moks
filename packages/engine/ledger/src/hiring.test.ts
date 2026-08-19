import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateFor } from "./policy.ts";
import { readWorkspacePolicy } from "./hiring.ts";

function tempCompany(): string {
  return mkdtempSync(join(tmpdir(), "moks-hiring-"));
}

function writeHiring(dir: string, policy: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "HIRING.md"), `# HIRING.md\n\n## Policy\n${policy}\n`);
}

describe("readWorkspacePolicy", () => {
  test("req-level HIRING.md wins over company-level HIRING.md", () => {
    const cwd = tempCompany();
    writeHiring(cwd, "auto_approve: [AddNote, AddTag]\nalways_gate: [Reject]\n");
    const reqDir = join(cwd, "reqs", "staff-backend");
    writeHiring(reqDir, "always_gate: [AddNote, AdvanceStage]\n");

    const resolved = readWorkspacePolicy({ cwd, reqDir });
    expect(resolved.missing).toBe(false);
    expect(resolved.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved.policy.alwaysGate).toEqual(["AddNote", "AdvanceStage"]);
    expect(resolved.policy.autoApprove).toEqual([]);
    expect(gateFor("AddNote", resolved.policy)).toBe("always");
  });

  test("company HIRING.md is used when the focused req has none", () => {
    const cwd = tempCompany();
    writeHiring(cwd, "auto_approve: [AddNote, AddTag]\n");
    const reqDir = join(cwd, "reqs", "empty-req");
    mkdirSync(reqDir, { recursive: true });

    const resolved = readWorkspacePolicy({ cwd, reqDir });
    expect(resolved.missing).toBe(false);
    expect(resolved.policy.autoApprove).toEqual(["AddNote", "AddTag"]);
    expect(gateFor("AddNote", resolved.policy)).toBe("auto");
  });

  test("missing both HIRING.md files fails closed to always_gate", () => {
    const cwd = tempCompany();
    const reqDir = join(cwd, "reqs", "uninitialized");
    mkdirSync(reqDir, { recursive: true });

    const resolved = readWorkspacePolicy({ cwd, reqDir });
    expect(resolved.missing).toBe(true);
    expect(resolved.hash).toBeNull();
    expect(resolved.policy).toEqual({
      autoApprove: [],
      batchReview: [],
      alwaysGate: [],
      rejectSampling: 0,
      permissions: [],
    });
    expect(gateFor("AddNote", resolved.policy)).toBe("always");
    expect(gateFor("AdvanceStage", resolved.policy)).toBe("always");
    expect(gateFor("Reject", resolved.policy)).toBe("always");
  });
});
