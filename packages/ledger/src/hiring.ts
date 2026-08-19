import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { failClosedPolicy, parseHiringMarkdown, type HiringDoc, type Policy } from "./policy.ts";
import { workspacePaths } from "./paths.ts";

export type HiringResolveOptions = {
  cwd: string;
  /** Focused req directory. Its HIRING.md / SCORECARD.md win over the company files. */
  reqDir?: string;
};

export type HiringFiles = {
  hiring: string;
  scorecard: string;
  hiringPath: string;
  scorecardPath: string;
  fromTemplate: { hiring: boolean; scorecard: boolean };
  doc: HiringDoc;
};

export function promptRefFor(hiring: string, scorecard: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(hiring);
  hasher.update("\n");
  hasher.update(scorecard);
  return hasher.digest("hex").slice(0, 16);
}

function hiringCandidates(options: HiringResolveOptions): string[] {
  const company = workspacePaths(options.cwd).hiringFile;
  if (options.reqDir) {
    return [join(options.reqDir, "HIRING.md"), company];
  }
  return [company];
}

function scorecardCandidates(options: HiringResolveOptions): string[] {
  const company = workspacePaths(options.cwd).scorecardFile;
  if (options.reqDir) {
    return [join(options.reqDir, "SCORECARD.md"), company];
  }
  return [company];
}

function firstExisting(files: string[]): string | undefined {
  return files.find((file) => existsSync(file));
}

export function readHiringFiles(options: HiringResolveOptions): HiringFiles {
  const hiringPath = firstExisting(hiringCandidates(options)) ?? hiringCandidates(options)[0]!;
  const scorecardPath = firstExisting(scorecardCandidates(options)) ?? scorecardCandidates(options)[0]!;
  const hiring = existsSync(hiringPath) ? readFileSync(hiringPath, "utf8") : "";
  const scorecard = existsSync(scorecardPath) ? readFileSync(scorecardPath, "utf8") : "";
  return {
    hiring,
    scorecard,
    hiringPath,
    scorecardPath,
    fromTemplate: { hiring: false, scorecard: false },
    doc: parseHiringMarkdown(hiring),
  };
}

export type WorkspacePolicy = {
  policy: Policy;
  hash: string | null;
  missing: boolean;
};

/**
 * Commit-time policy. Focused req HIRING.md wins, then company HIRING.md.
 * Missing both fails closed (`always_gate` via empty lists). No template fallback.
 */
export function readWorkspacePolicy(options: HiringResolveOptions): WorkspacePolicy {
  const file = firstExisting(hiringCandidates(options));
  if (!file) {
    return { policy: failClosedPolicy(), hash: null, missing: true };
  }
  const text = readFileSync(file, "utf8");
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return {
    policy: parseHiringMarkdown(text).policy,
    hash: hasher.digest("hex"),
    missing: false,
  };
}
