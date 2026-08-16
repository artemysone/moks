import { readdir } from "node:fs/promises"
import path from "node:path"
import { runDecision, statusOpen } from "../../util/decision-cli"

export async function packetDir(dir: string) {
  let current = dir
  for (const _ of [0, 1, 2, 3, 4]) {
    const hiring = await Bun.file(path.join(current, "HIRING.md")).exists()
    const packet = hiring && (await isDir(path.join(current, "candidates")))
    if (packet) return current
    if (hiring) {
      const slug = await readFocus(current)
      if (slug) return path.join(current, slug)
      return current
    }
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

export async function countUnpushed(dir: string) {
  const result = await runDecision(["status", "--json"], { cwd: dir }).catch(() => undefined)
  if (!result || result.code !== 0) return
  if (!result.json || typeof result.json !== "object") return
  return statusOpen(result.json).length
}

export function formatReqStatus(input: { title: string; cards?: number; unpushed?: number; agent: string }) {
  return [
    input.title,
    input.cards === undefined ? undefined : `${input.cards} ${input.cards === 1 ? "card" : "cards"}`,
    input.unpushed === undefined ? undefined : `${input.unpushed} unpushed`,
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
