import path from "path"
import { CandidateCard, type Card } from "./candidate-card"
import { ReqWorkspace } from "./req-workspace"
import { importLedger } from "@/decision/session"

export const SESSION_FILE = path.join(".moks", "session.json")

export type LeftoverKind = "score" | "draft" | "commit"

export type SessionSnapshot = {
  v: 1
  focused: string | null
  staged: { count: number; ids: string[] }
  leftover: LeftoverKind | null
  next: string
}

export function nextStep(input: {
  focused: string | null
  stagedIds: string[]
  leftover?: LeftoverKind | null
}) {
  if (input.stagedIds.length > 0) return `review ${input.stagedIds[0]}`
  if (input.leftover === "score") return input.focused ? `score leftover on ${input.focused}` : "score leftover"
  if (input.leftover === "draft") return input.focused ? `draft leftover on ${input.focused}` : "draft leftover"
  if (input.leftover === "commit") return input.focused ? `commit leftover on ${input.focused}` : "commit leftover"
  if (input.focused) return `nothing left on ${input.focused}`
  return "open-req"
}

export function leftoverOnCard(card: Card): LeftoverKind | null {
  const stage = (card.stage ?? "").trim().toLowerCase()
  if (stage === "rejected" || stage === "withdrawn" || stage === "hired") return null
  if (card.score === undefined && !/^# Score\b/m.test(card.body)) return "score"
  if (!/^# Outreach\b/m.test(card.body)) return "draft"
  return "commit"
}

export function formatSnapshot(snap: SessionSnapshot) {
  const ids = snap.staged.ids.length > 0 ? `  ${snap.staged.ids.join(", ")}` : ""
  return [`focused ${snap.focused ?? "none"}`, `staged ${snap.staged.count}${ids}`, `next: ${snap.next}`]
}

export async function readSnapshot(company: string): Promise<SessionSnapshot | undefined> {
  const raw = await Bun.file(path.join(company, SESSION_FILE))
    .text()
    .catch(() => "")
  if (!raw.trim()) return
  try {
    const parsed = JSON.parse(raw) as SessionSnapshot
    if (parsed?.v !== 1) return
    if (typeof parsed.next !== "string") return
    return parsed
  } catch {
    return
  }
}

export async function writeSnapshot(company: string, snap: SessionSnapshot) {
  await Bun.write(path.join(company, SESSION_FILE), `${JSON.stringify(snap, null, 2)}\n`)
}

export async function loadSnapshot(cwd?: string): Promise<SessionSnapshot> {
  const opened = cwd ?? process.cwd()
  const company = (await ReqWorkspace.companyRoot(opened)) ?? opened
  if (!(await ReqWorkspace.isLiveCompany(company)) && !(await ReqWorkspace.isLiveCompany(opened))) {
    throw new Error(ReqWorkspace.notACompanyDirectory(opened))
  }
  const root = (await ReqWorkspace.companyRoot(opened)) ?? opened
  const snap = await computeSnapshot(root, opened)
  await writeSnapshot(root, snap)
  return snap
}

export async function refreshSnapshot(cwd?: string) {
  try {
    return await loadSnapshot(cwd)
  } catch {
    return
  }
}

async function computeSnapshot(company: string, opened: string): Promise<SessionSnapshot> {
  const packet = await ReqWorkspace.focusedReq(opened)
  const slug = packet ? path.basename(packet) : ((await ReqWorkspace.readFocus(company)) ?? null)
  const focused = slug && slug !== "." ? slug : null
  const stagedIds = await listStagedIds(company)
  const leftover = packet ? await leftoverOnPacket(packet) : null
  return {
    v: 1,
    focused,
    staged: { count: stagedIds.length, ids: stagedIds },
    leftover,
    next: nextStep({ focused, stagedIds, leftover }),
  }
}

async function leftoverOnPacket(packet: string): Promise<LeftoverKind | null> {
  const cards = await CandidateCard.list(packet)
  for (const card of cards) {
    const leftover = leftoverOnCard(card)
    if (leftover) return leftover
  }
  return null
}

async function listStagedIds(company: string) {
  let api: Awaited<ReturnType<typeof importLedger>>
  try {
    api = await importLedger()
  } catch {
    return [] as string[]
  }
  const paths = api.workspacePaths(company)
  if (!(await Bun.file(paths.workspaceDb).exists())) return []
  const db = api.openSqlite(paths.workspaceDb)
  try {
    api.migrateWorkspace(db)
    return api.listChangesets(db, "staged").map((row) => row.id)
  } finally {
    db.close()
  }
}

export * as HiringSession from "./hiring-session"
