import { readdir } from "node:fs/promises"
import path from "node:path"

export type PacketCandidate = {
  id: string
  name: string
  stage?: string
  score?: number
}

export type PacketReq = {
  slug: string
  title: string
  focused: boolean
}

export type PacketData = {
  company: string
  companyTitle: string
  reqs: PacketReq[]
  packet?: {
    slug: string
    title: string
    candidates: PacketCandidate[]
  }
}

export type PacketRow = ({ kind: "req" } & PacketReq) | ({ kind: "candidate" } & PacketCandidate)

export async function loadPacket(dir: string) {
  const start = await nearestRoot(dir)
  if (!start) return
  if (await isPacket(start)) {
    const parent = path.dirname(start)
    if (parent !== start && (await isCompanyOf(parent))) return packetOf(parent, start)
    return packetOf(start, start)
  }
  const slug = await readFocus(start)
  if (slug && (await isPacket(path.join(start, slug)))) return packetOf(start, path.join(start, slug))
  return packetOf(start)
}

export function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

export function candidateLabel(card: PacketCandidate) {
  const parts = [card.name]
  if (card.stage) parts.push(card.stage)
  if (card.score !== undefined) parts.push(String(card.score))
  return parts.join("  ")
}

export function packetRows(packet: PacketData): PacketRow[] {
  return [
    ...packet.reqs.map((req): PacketRow => ({ kind: "req", ...req })),
    ...(packet.packet?.candidates.map((card): PacketRow => ({ kind: "candidate", ...card })) ?? []),
  ]
}

export function movePacketIndex(index: number, delta: number, length: number) {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, index + delta))
}

export function scorePrompt(id: string) {
  return `Score ${id}`
}

async function packetOf(company: string, focused?: string) {
  const implicit = focused === company
  return {
    company,
    companyTitle: await readCompanyTitle(company),
    reqs: await Promise.all(
      (implicit ? [path.basename(company)] : await listReqSlugs(company)).map(async (slug) => ({
        slug,
        title: await readTitle(implicit ? company : path.join(company, slug)),
        focused: slug === (focused ? path.basename(focused) : undefined),
      })),
    ),
    packet: focused
      ? {
          slug: path.basename(focused),
          title: await readTitle(focused),
          candidates: await listCandidates(focused),
        }
      : undefined,
  } satisfies PacketData
}

async function listReqSlugs(company: string) {
  const entries = await readdir(company, { withFileTypes: true }).catch(() => [])
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (await hasHiring(path.join(company, entry.name))) names.push(entry.name)
  }
  return names.toSorted()
}

async function listCandidates(dir: string) {
  const entries = await readdir(path.join(dir, "candidates"), { withFileTypes: true }).catch(() => [])
  const cards: PacketCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === ".gitkeep") continue
    const text = await Bun.file(path.join(dir, "candidates", entry.name))
      .text()
      .catch(() => "")
    const card = parseCard(text)
    if (card) cards.push(card)
  }
  return cards.toSorted((a, b) => a.id.localeCompare(b.id))
}

function parseCard(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return
  let id = ""
  let stage: string | undefined
  let score: number | undefined
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const sep = trimmed.indexOf(":")
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    if (key === "id") {
      id = value
      continue
    }
    if (key === "stage") {
      stage = value
      continue
    }
    if (key !== "score") continue
    const n = Number(value)
    if (!Number.isNaN(n)) score = n
  }
  if (!id) return
  const body = text.slice(match[0].length)
  return { id, name: firstHeading(body) || titleFromSlug(id), stage, score }
}

async function readCompanyTitle(dir: string) {
  if (!(await hasCompanyFile(dir))) return readTitle(dir)
  const text = await Bun.file(path.join(dir, "COMPANY.md"))
    .text()
    .catch(() => "")
  return firstHeading(text) || path.basename(dir)
}

async function readTitle(dir: string) {
  const text = await Bun.file(path.join(dir, "HIRING.md"))
    .text()
    .catch(() => "")
  return firstHeading(text) || path.basename(dir)
}

async function nearestRoot(dir: string, depth = 0) {
  if ((await hasCompanyFile(dir)) || (await hasHiring(dir))) return dir
  if (depth >= 4) return
  const parent = path.dirname(dir)
  if (parent === dir) return
  return nearestRoot(parent, depth + 1)
}

async function readFocus(company: string) {
  const slug = await Bun.file(path.join(company, ".moks", "focus"))
    .text()
    .then((text) => text.trim())
    .catch(() => "")
  if (!slug || slug.includes("..") || path.isAbsolute(slug) || slug.includes("/") || slug.includes("\\")) return
  return slug
}

async function isCompanyOf(dir: string) {
  if (await hasCompanyFile(dir)) return true
  return (await hasHiring(dir)) && !(await isDir(path.join(dir, "candidates")))
}

async function isPacket(dir: string) {
  return (await hasHiring(dir)) && (await isDir(path.join(dir, "candidates")))
}

async function hasCompanyFile(dir: string) {
  return Bun.file(path.join(dir, "COMPANY.md")).exists()
}

async function hasHiring(dir: string) {
  return Bun.file(path.join(dir, "HIRING.md")).exists()
}

async function isDir(dir: string) {
  return readdir(dir)
    .then(() => true)
    .catch(() => false)
}

function firstHeading(text: string) {
  const match = text.match(/^#\s+(.+)$/m)
  if (!match) return
  return match[1].trim()
}
