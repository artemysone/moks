import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { failClosedPolicy, parseHiringMarkdown, type Policy } from "./policy.ts";
import type { ApplicationStage } from "./domain.ts";
import { workspacePaths } from "./paths.ts";

export type HiringResolveOptions = {
  cwd: string;
  /** Focused req directory. Its HIRING.md wins over the company constitution. */
  reqDir?: string;
};

// Order: focused req HIRING.md, then a single-req root's HIRING.md, then COMPANY.md.
function hiringCandidates(options: HiringResolveOptions): string[] {
  const paths = workspacePaths(options.cwd);
  const company = [paths.hiringFile, paths.companyFile];
  if (options.reqDir) {
    return [join(options.reqDir, "HIRING.md"), ...company];
  }
  return company;
}

function firstExisting(files: string[]): string | undefined {
  return files.find((file) => existsSync(file));
}

export type WorkspacePolicy = {
  policy: Policy;
  stages: ApplicationStage[];
  hash: string | null;
  missing: boolean;
};

/**
 * Commit-time policy. Focused req HIRING.md wins, then the company
 * constitution (root HIRING.md for a single-req workspace, else COMPANY.md).
 * Missing all fails closed (`always_gate` via empty lists). No template fallback.
 */
export function readWorkspacePolicy(options: HiringResolveOptions): WorkspacePolicy {
  const file = firstExisting(hiringCandidates(options));
  if (!file) {
    return { policy: failClosedPolicy(), stages: [], hash: null, missing: true };
  }
  const text = readFileSync(file, "utf8");
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  const doc = parseHiringMarkdown(text);
  return {
    policy: doc.policy,
    stages: doc.stages,
    hash: hasher.digest("hex"),
    missing: false,
  };
}
