import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { ledgerCounts, runDecision, type LedgerCounts } from "../../util/decision-cli"

export async function packetDir(dir: string) {
  let current = dir
  let seenReq = false
  for (const _ of [0, 1, 2, 3, 4]) {
    const hiring = await Bun.file(path.join(current, "HIRING.md")).exists()
    const packet = hiring && (await isDir(path.join(current, "candidates")))
    if (hiring || packet) seenReq = true
    if (packet) return current
    const companyMd = await Bun.file(path.join(current, "COMPANY.md")).exists()
    if (hiring || (companyMd && (current === dir || seenReq))) {
      const slug = await readFocus(current)
      if (slug) return path.join(current, slug)
      return current
    }
    if (companyMd && current !== dir && !seenReq) return dir
    const parent = path.dirname(current)
    if (parent === current) return dir
    current = parent
  }
  return dir
}

export async function readReqTitle(dir: string) {
  const packet = await packetDir(dir)
  const text = await Bun.file(path.join(packet, "HIRING.md"))
    .text()
    .catch(() => undefined)
  const title = text ? firstHeading(text) : undefined
  if (title) return title
  return path.basename(packet)
}

export async function countCards(dir: string) {
  const packet = await packetDir(dir)
  return readdir(path.join(packet, "candidates"), { withFileTypes: true })
    .then(
      (entries) =>
        entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== ".gitkeep").length,
    )
    .catch(() => 0)
}

export async function countChangesets(dir: string): Promise<LedgerCounts | undefined> {
  const result = await runDecision(["status", "--json"], { cwd: dir }).catch(() => undefined)
  if (!result || result.code !== 0) return
  return ledgerCounts(result.json)
}

// Cheap change detector for the company ledger so the footer only re-runs the
// CLI (`moks status --json` costs ~1s of CPU) when the ledger actually moved.
export async function ledgerStamp(dir: string) {
  let current = dir
  for (const _ of [0, 1, 2, 3, 4]) {
    const companyMd = await Bun.file(path.join(current, "COMPANY.md")).exists()
    const ledger = path.join(current, ".moks", "ledger.sqlite")
    if (await Bun.file(ledger).exists()) {
      if (current !== dir && companyMd && (await Bun.file(path.join(dir, "COMPANY.md")).exists())) return
      const stats = await Promise.all(
        [ledger, `${ledger}-wal`].map((file) => stat(file).catch(() => undefined)),
      )
      return stats.map((item) => (item ? `${item.mtimeMs}:${item.size}` : "")).join("|")
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
  return
}

export function formatReqStatus(input: {
  title: string
  cards?: number
  staged?: number
  approved?: number
  agent: string
}) {
  return [
    input.title,
    input.cards === undefined ? undefined : `${input.cards} ${input.cards === 1 ? "card" : "cards"}`,
    input.staged === undefined ? undefined : `${input.staged} staged`,
    input.approved === undefined ? undefined : `${input.approved} approved`,
    input.agent,
  ]
    .filter((part) => part)
    .join(" · ")
}

async function readFocus(company: string) {
  const slug = await Bun.file(path.join(company, ".moks", "focus"))
    .text()
    .then((text) => text.trim())
    .catch(() => "")
  if (!slug || slug.includes("..") || path.isAbsolute(slug) || slug.includes("/") || slug.includes("\\")) return
  return slug
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
