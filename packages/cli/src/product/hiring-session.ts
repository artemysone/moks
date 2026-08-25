import path from "path"
import { CandidateCard, type Card } from "./candidate-card"
import { Constitutions } from "./constitutions"
import { ReqWorkspace } from "./req-workspace"
import { importLedger } from "@/decision/session"

export const SESSION_FILE = path.join(".moks", "session.json")

export type LeftoverKind = "score" | "rescore" | "draft" | "commit"

export type SessionCard = {
  id: string
  file: string
  stage?: string
  score?: number
}

export type SessionSnapshot = {
  v: 1
  focused: string | null
  staged: { count: number; ids: string[] }
  leftover: LeftoverKind | null
  cards: SessionCard[]
  next: string
}

export function nextStep(input: {
  focused: string | null
  stagedIds: string[]
  leftover?: LeftoverKind | null
  reason?: string
  reviewReq?: string | null
  leftoverReq?: string | null
}) {
  if (input.reviewReq) return `review ${input.reviewReq}`
  if (input.stagedIds.length > 0) return `review ${input.stagedIds[0]}`
  let next = ""
  const leftoverOn = input.leftoverReq ?? input.focused
  if (input.leftover === "score") next = leftoverOn ? `talk leftover on ${leftoverOn}` : "talk leftover"
  else if (input.leftover === "rescore") next = leftoverOn ? `rescore leftover on ${leftoverOn}` : "rescore leftover"
  else if (input.leftover === "draft") next = leftoverOn ? `draft leftover on ${leftoverOn}` : "draft leftover"
  else if (input.leftover === "commit") next = leftoverOn ? `commit leftover on ${leftoverOn}` : "commit leftover"
  else if (input.focused) next = `nothing left on ${input.focused}`
  else next = "open a role"
  const reason = input.reason?.trim()
  return reason ? `${next} — ${reason}` : next
}

export function leftoverOnCard(
  card: Card,
  current?: { company_hash: string; hiring_hash: string },
): LeftoverKind | null {
  const stage = (card.stage ?? "").trim().toLowerCase()
  if (stage === "rejected" || stage === "withdrawn" || stage === "hired") return null
  if (card.score === undefined && !/^# Score\b/m.test(card.body)) return "score"
  if (current && Constitutions.scoreIsStale(card, current)) return "rescore"
  if (!/^# Outreach\b/m.test(card.body)) return "draft"
  return "commit"
}

export function formatSnapshot(snap: SessionSnapshot) {
  const ids = snap.staged.ids.length > 0 ? `  ${snap.staged.ids.join(", ")}` : ""
  const cards = snap.cards ?? []
  const tree = ["candidates/"]
  if (cards.length === 0) tree.push("  (empty)")
  else {
    for (const card of cards) {
      const bits = [card.file, card.stage, card.score !== undefined ? String(card.score) : ""].filter(Boolean)
      tree.push(`  ${bits.join("  ")}`)
    }
  }
  return [`focused ${snap.focused ?? "none"}`, `staged ${snap.staged.count}${ids}`, ...tree, `next: ${snap.next}`]
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
    return { ...parsed, cards: parsed.cards ?? [] }
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
  const reqs = await ReqWorkspace.listReqs(company)
  const atCompanyRoot =
    path.resolve(opened) === path.resolve(company) &&
    reqs.length >= 2 &&
    !(await ReqWorkspace.isPacket(company))
  if (atCompanyRoot) return computeCompanyRootSnapshot(company, reqs)

  const packet = await ReqWorkspace.focusedReq(opened)
  const slug = packet ? path.basename(packet) : ((await ReqWorkspace.readFocus(company)) ?? null)
  const focused = slug && slug !== "." ? slug : null
  const stagedIds = await listStagedIds(company, focused)
  const leftover = packet ? await leftoverOnPacket(packet) : null
  const reason = packet ? await firstCardReason(packet) : undefined
  return {
    v: 1,
    focused,
    staged: { count: stagedIds.length, ids: stagedIds },
    leftover,
    cards: packet ? await listSessionCards(packet) : [],
    next: nextStep({ focused, stagedIds, leftover, reason }),
  }
}

async function computeCompanyRootSnapshot(company: string, reqs: string[]): Promise<SessionSnapshot> {
  const stagedByReq = await listStagedByReq(company)
  const stagedIds = reqs.flatMap((slug) => stagedByReq.get(slug) ?? [])
  const leftovers: { slug: string; kind: LeftoverKind }[] = []
  for (const slug of reqs) {
    const kind = await leftoverOnPacket(path.join(company, slug))
    if (kind) leftovers.push({ slug, kind })
  }
  const leftoverPick =
    leftovers.find((row) => row.kind === "rescore") ??
    leftovers.find((row) => row.kind === "score") ??
    leftovers.find((row) => row.kind === "draft") ??
    leftovers.find((row) => row.kind === "commit")
  const reviewReq = reqs.find((slug) => (stagedByReq.get(slug) ?? []).length > 0) ?? null
  const leftover = leftoverPick?.kind ?? null
  const leftoverReq = leftoverPick?.slug ?? null
  const focus = await ReqWorkspace.readFocus(company)
  const focused = focus && focus !== "." ? focus : null
  return {
    v: 1,
    focused,
    staged: { count: stagedIds.length, ids: stagedIds },
    leftover,
    cards: await listCompanyCards(company, reqs),
    next: nextStep({ focused, stagedIds, leftover, reviewReq, leftoverReq }),
  }
}

async function listStagedByReq(company: string) {
  const map = new Map<string, string[]>()
  let api: Awaited<ReturnType<typeof importLedger>>
  try {
    api = await importLedger()
  } catch {
    return map
  }
  const paths = api.workspacePaths(company)
  if (!(await Bun.file(paths.workspaceDb).exists())) return map
  const db = api.openSqlite(paths.workspaceDb)
  try {
    api.migrateWorkspace(db)
    for (const row of api.listChangesets(db, "staged")) {
      const slug = stagedReqSlug(row.agent_meta)
      if (!slug) continue
      const list = map.get(slug) ?? []
      list.push(row.id)
      map.set(slug, list)
    }
    return map
  } finally {
    db.close()
  }
}

async function firstCardReason(packet: string) {
  const cards = await CandidateCard.list(packet)
  for (const card of cards) {
    const reason = CandidateCard.readReason(card)
    if (reason) return reason
  }
}


async function listSessionCards(packet: string): Promise<SessionCard[]> {
  const cards = await CandidateCard.list(packet)
  return cards.map((card) => ({
    id: card.id,
    file: `${CandidateCard.CANDIDATES_DIR}/${CandidateCard.fileName(card.id)}`,
    stage: card.stage,
    score: card.score,
  }))
}

async function listCompanyCards(company: string, reqs: string[]): Promise<SessionCard[]> {
  const out: SessionCard[] = []
  for (const slug of reqs) {
    for (const card of await listSessionCards(path.join(company, slug))) {
      out.push({ ...card, file: `${slug}/${card.file}` })
    }
  }
  return out
}

async function leftoverOnPacket(packet: string): Promise<LeftoverKind | null> {
  const cards = await CandidateCard.list(packet)
  const root = (await ReqWorkspace.companyRoot(packet)) ?? packet
  const current = await Constitutions.fingerprintsAt(root, packet)
  const kinds = new Set(cards.map((card) => leftoverOnCard(card, current)).filter(Boolean))
  for (const kind of ["rescore", "score", "draft", "commit"] as const) {
    if (kinds.has(kind)) return kind
  }
  return null
}

function stagedReqSlug(meta: { req?: string } | null | undefined) {
  if (!meta?.req) return
  const slug = path.basename(meta.req.trim())
  if (!slug || slug === "." || slug === "..") return
  return slug
}

async function listStagedIds(company: string, focused: string | null) {
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
    return api.listChangesets(db, "staged").flatMap((row) => {
      if (!focused) return [row.id]
      const slug = stagedReqSlug(row.agent_meta)
      if (slug && slug !== focused) return []
      return [row.id]
    })
  } finally {
    db.close()
  }
}

export * as HiringSession from "./hiring-session"
