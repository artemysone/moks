import { openAtsAdapter, openSourcingAdapter } from "./adapters/resolve.ts";
import type { SourcedCandidate } from "./adapters/sourcing.ts";
import { readComplianceLog, type ComplianceExport } from "./compliance.ts";
import { boundSourceLimit, resolveAtsId, resolveSourcingId, type SourcingId } from "./config.ts";
import { openSqlite } from "./db.ts";
import type { AtsId } from "./domain.ts";
import { LedgerError } from "./errors.ts";
import { verifyChain, type ChainVerification } from "./hash.ts";
import { readWorkspacePolicy } from "./hiring.ts";
import {
  commitChangeset,
  getChangeset,
  reviewChangeset,
  type ChangesetDetail,
  type CommitInput,
} from "./ledger.ts";
import { ensureWorkspaceDir, workspacePaths, type WorkspacePaths } from "./paths.ts";
import { rebaseChangeset } from "./rebase.ts";
import { migrateWorkspace } from "./schema.ts";
import {
  pullMirror,
  pushApproved,
  readStatus,
  refreshAfterPush,
  type PullResult,
  type PushResult,
  type StatusReport,
} from "./sync.ts";
import { openVault } from "./vault.ts";

/** Test-only stand-in for Mox's workspace facade. Not exported from the package. */
export type SourceSearchResult = {
  source: SourcingId;
  candidates: SourcedCandidate[];
};

export type OpenWorkspaceOptions = {
  ats?: AtsId;
  sourcing?: SourcingId | "off";
};

export type Workspace = {
  paths: WorkspacePaths;
  ats: AtsId;
  sourcing: SourcingId | null;
  pull(): PullResult;
  status(): StatusReport;
  commit(input: CommitInput): ChangesetDetail;
  getChangeset(id: string): ChangesetDetail;
  review(id: string, input: { action: string; reviewer_id: string }): ChangesetDetail;
  rebase(id: string): ReturnType<typeof rebaseChangeset>;
  push(id?: string): PushResult;
  complianceLog(): ComplianceExport;
  search(query: { role: string; limit?: number }): SourceSearchResult;
  verifyChain(): ChainVerification;
  close(): void;
};

export function openWorkspace(cwd: string = process.cwd(), options: OpenWorkspaceOptions = {}): Workspace {
  const paths = workspacePaths(cwd);
  ensureWorkspaceDir(paths.dir);

  const ats = options.ats ?? resolveAtsId();
  const sourcingId = options.sourcing === "off" ? null : (options.sourcing ?? resolveSourcingId());

  const workspaceDb = openSqlite(paths.workspaceDb);
  migrateWorkspace(workspaceDb);

  const closers: Array<() => void> = [() => workspaceDb.close()];
  let adapter;
  let sourcing;
  let vault;
  try {
    adapter = openAtsAdapter(ats, paths, closers);
    sourcing = openSourcingAdapter(sourcingId, paths, closers);
    vault = openVault(workspaceDb, paths.vaultKey);
  } catch (error) {
    for (const closer of [...closers].reverse()) {
      try {
        closer();
      } catch {
        // Best effort; the original error is what the caller needs to see.
      }
    }
    throw error;
  }

  const policyOpts = () => ({ policy: readWorkspacePolicy({ cwd: paths.cwd }).policy });

  return {
    paths,
    ats,
    sourcing: sourcing?.id ?? null,
    pull: () => pullMirror(workspaceDb, adapter),
    status: () => readStatus(workspaceDb),
    commit: (input) => commitChangeset(workspaceDb, vault, input, policyOpts()),
    getChangeset: (id) => getChangeset(workspaceDb, vault, id),
    review: (id, input) => reviewChangeset(workspaceDb, vault, id, input),
    rebase: (id) => rebaseChangeset(workspaceDb, vault, id, policyOpts()),
    push: (id) => {
      const result = pushApproved(workspaceDb, adapter, vault, id);
      refreshAfterPush(workspaceDb, adapter, result);
      return result;
    },
    complianceLog: () => readComplianceLog(workspaceDb, readWorkspacePolicy({ cwd: paths.cwd }).hash),
    search: (query) => {
      if (!sourcing) {
        throw new LedgerError("sourcing_disabled");
      }
      const role = query.role.trim();
      if (role.length === 0) {
        throw new LedgerError("role_required");
      }
      sourcing.prepare?.();
      return {
        source: sourcing.id,
        candidates: sourcing.search({ role, limit: boundSourceLimit(query.limit) }),
      };
    },
    verifyChain: () => verifyChain(workspaceDb),
    close: () => {
      for (const closer of closers) {
        closer();
      }
    },
  };
}
