import type { AtsAdapter } from "./adapters/types.ts";
import { openSqlite } from "./db.ts";
import { verifyChain, type ChainVerification } from "./hash.ts";
import {
  commitChangeset,
  getChangeset,
  readLog,
  reviewChangeset,
  type AuditEntry,
  type ChangesetDetail,
  type CommitInput,
} from "./ledger.ts";
import { ensureWorkspaceDir, workspacePaths, type WorkspacePaths } from "./paths.ts";
import { migrateMockAts, migrateWorkspace } from "./schema.ts";
import {
  pullMirror,
  pushApproved,
  readStatus,
  refreshAfterPush,
  type PullResult,
  type PushResult,
  type StatusReport,
} from "./sync.ts";
import { createMockAdapter } from "./adapters/mock.ts";
import { openVault } from "./vault.ts";

/** Test-only stand-in for the moks workspace facade. Not exported from the package. */
export type Workspace = {
  paths: WorkspacePaths;
  pull(): PullResult;
  status(): StatusReport;
  commit(input: CommitInput): ChangesetDetail;
  getChangeset(id: string): ChangesetDetail;
  review(id: string, input: { action: string; reviewer_id: string }): ChangesetDetail;
  push(id?: string): PushResult;
  log(): AuditEntry[];
  shred(candidateRef: string): void;
  verifyChain(): ChainVerification;
  close(): void;
};

export function openWorkspace(cwd: string): Workspace {
  const paths = workspacePaths(cwd);
  ensureWorkspaceDir(paths.dir);

  const workspaceDb = openSqlite(paths.workspaceDb);
  migrateWorkspace(workspaceDb);
  const mockDb = openSqlite(paths.mockAtsDb);
  migrateMockAts(mockDb);
  const adapter: AtsAdapter = createMockAdapter(mockDb, { fixturePath: paths.fixtureFile });
  const vault = openVault(workspaceDb, paths.vaultKey);

  return {
    paths,
    pull: () => pullMirror(workspaceDb, adapter),
    status: () => readStatus(workspaceDb),
    commit: (input) => commitChangeset(workspaceDb, vault, input),
    getChangeset: (id) => getChangeset(workspaceDb, vault, id),
    review: (id, input) => reviewChangeset(workspaceDb, vault, id, input),
    push: (id) => {
      const result = pushApproved(workspaceDb, adapter, vault, id);
      refreshAfterPush(workspaceDb, adapter, result);
      return result;
    },
    log: () => readLog(workspaceDb),
    shred: (candidateRef) => vault.shred(candidateRef),
    verifyChain: () => verifyChain(workspaceDb),
    close: () => {
      mockDb.close();
      workspaceDb.close();
    },
  };
}
