import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateFor } from "./policy.ts";
import { readWorkspacePolicy } from "./hiring.ts";

function tempCompany(): string {
  return mkdtempSync(join(tmpdir(), "moks-hiring-"));
}

function writeConstitution(dir: string, file: string, policy: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `# ${file}\n\n## Policy\n${policy}\n`);
}

describe("readWorkspacePolicy", () => {
  test("req-level HIRING.md wins over COMPANY.md", () => {
    const cwd = tempCompany();
    writeConstitution(cwd, "COMPANY.md", "auto_approve: [AddNote, AddTag]\nalways_gate: [Reject]\n");
    const reqDir = join(cwd, "reqs", "staff-backend");
    writeConstitution(reqDir, "HIRING.md", "always_gate: [AddNote, AdvanceStage]\n");

    const resolved = readWorkspacePolicy({ cwd, reqDir });
    expect(resolved.missing).toBe(false);
    expect(resolved.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved.policy.alwaysGate).toEqual(["AddNote", "AdvanceStage"]);
    expect(resolved.policy.autoApprove).toEqual([]);
    expect(gateFor("AddNote", resolved.policy)).toBe("always");
  });

  test("COMPANY.md is used when the focused req has no HIRING.md", () => {
    const cwd = tempCompany();
    writeConstitution(cwd, "COMPANY.md", "auto_approve: [AddNote, AddTag]\n");
    const reqDir = join(cwd, "reqs", "empty-req");
    mkdirSync(reqDir, { recursive: true });

    const resolved = readWorkspacePolicy({ cwd, reqDir });
    expect(resolved.missing).toBe(false);
    expect(resolved.policy.autoApprove).toEqual(["AddNote", "AddTag"]);
    expect(gateFor("AddNote", resolved.policy)).toBe("auto");
  });

  test("a single-req root HIRING.md wins over COMPANY.md", () => {
    const cwd = tempCompany();
    writeConstitution(cwd, "COMPANY.md", "auto_approve: [AddTag]\n");
    writeConstitution(cwd, "HIRING.md", "auto_approve: [AddNote]\n");

    const resolved = readWorkspacePolicy({ cwd });
    expect(resolved.missing).toBe(false);
    expect(resolved.policy.autoApprove).toEqual(["AddNote"]);
  });

  test("missing every constitution fails closed to always_gate", () => {
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
