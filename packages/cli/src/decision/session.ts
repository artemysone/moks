import { ReqWorkspace } from "@/product/req-workspace"

export type LedgerModule = typeof import("@moks/ledger")

export type LedgerHandle = {
  api: LedgerModule
  company: string
  req: string | undefined
  db: ReturnType<LedgerModule["openSqlite"]>
  vault: ReturnType<LedgerModule["openVault"]>
  adapter: ReturnType<LedgerModule["createMockAdapter"]>
  paths: ReturnType<LedgerModule["workspacePaths"]>
  policy: ReturnType<LedgerModule["readWorkspacePolicy"]>
  close: () => void
}

export async function companyCwd(cwd?: string) {
  const opened = cwd ?? process.cwd()
  return (await ReqWorkspace.companyRoot(opened)) ?? opened
}

export async function importLedger(): Promise<LedgerModule> {
  return import("@moks/ledger")
}

export async function ledgerDbExists(cwd?: string) {
  let api: LedgerModule
  try {
    api = await importLedger()
  } catch {
    return false
  }
  const company = await companyCwd(cwd)
  const paths = api.workspacePaths(company)
  return Bun.file(paths.workspaceDb).exists()
}

export async function requireOpenedHiringDir(cwd?: string) {
  const opened = cwd ?? process.cwd()
  if (await ReqWorkspace.isLiveCompany(opened)) {
    return { opened }
  }
  throw new Error(ReqWorkspace.notACompanyDirectory(opened))
}

export async function requireCompanyRoot(cwd?: string) {
  const opened = cwd ?? process.cwd()
  const root = await ReqWorkspace.companyRoot(opened)
  if (!root || !(await ReqWorkspace.isLiveCompany(root))) {
    throw new Error(ReqWorkspace.notACompanyDirectory(opened))
  }
  return { opened, root }
}

/** Fail like status: stub COMPANY.md / leftover ledger is not a live company. */
export async function requireCompanyDirectory(cwd?: string) {
  const { opened, root } = await requireCompanyRoot(cwd)
  const dbExists = await ledgerDbExists(cwd)
  if (!dbExists) {
    throw new Error(
      `no ledger at ${root} — run moks pull --cwd ${root} (or --dir; same flag as moks run --dir)`,
    )
  }
  return { opened, root }
}

export async function withLedger<T>(cwd: string | undefined, fn: (handle: LedgerHandle) => Promise<T>): Promise<T> {
  const handle = await openLedger(cwd)
  try {
    return await fn(handle)
  } finally {
    handle.close()
  }
}

export async function openLedger(cwd?: string): Promise<LedgerHandle> {
  const api = await importLedger()
  const opened = cwd ?? process.cwd()
  const company = (await ReqWorkspace.companyRoot(opened)) ?? opened
  const req = await ReqWorkspace.focusedReq(opened)
  const paths = api.workspacePaths(company)
  api.ensureWorkspaceDir(paths.dir)

  const db = api.openSqlite(paths.workspaceDb)
  api.migrateWorkspace(db)
  const closers: Array<() => void> = [() => db.close()]

  try {
    const mockDb = api.openSqlite(paths.mockAtsDb)
    api.migrateMockAts(mockDb)
    closers.push(() => mockDb.close())
    const adapter = api.createMockAdapter(mockDb, { fixturePath: paths.fixtureFile })
    if (adapter.close) closers.push(() => adapter.close?.())
    const vault = api.openVault(db, paths.vaultKey)
    const policy = readPolicy(api, company, req)
    return {
      api,
      company,
      req,
      db,
      vault,
      adapter,
      paths,
      policy,
      close: () => {
        for (const closer of closers.slice().reverse()) {
          try {
            closer()
          } catch {
            // Best effort; the original error is what the caller needs.
          }
        }
      },
    }
  } catch (error) {
    for (const closer of closers.slice().reverse()) {
      try {
        closer()
      } catch {
        // Best effort; the original error is what the caller needs.
      }
    }
    throw error
  }
}

function readPolicy(api: LedgerModule, company: string, req: string | undefined) {
  return api.readWorkspacePolicy({ cwd: company, reqDir: req })
}
