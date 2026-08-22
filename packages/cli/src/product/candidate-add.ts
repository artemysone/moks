import path from "path"
import { CandidateCard, CANDIDATES_DIR } from "./candidate-card"
import { ReqWorkspace } from "./req-workspace"

const ADD_COMMANDS = new Set(["add-candidate", "add-local-candidate"])

export function parseAddIntent(command?: string, message = "", files: string[] = []): { file: string } | undefined {
  const attached = files[0]?.trim()
  const hint = message.trim()
  if (command && ADD_COMMANDS.has(command)) {
    const fromHint = lastPathToken(hint)
    const file = attached || fromHint
    if (!file) return { file: "" }
    return { file }
  }
  if (command) return
  const match = hint.match(/^(?:please\s+|can you\s+)?(?:\/)?add(?:-candidate)?(?:\s+candidate)?(?:\s+from)?\s+(\S.+)$/i)
  if (match) return { file: stripQuotes(match[1].trim()) }
  if (attached && /^(?:please\s+|can you\s+)?(?:\/)?add(?:-candidate)?\b/i.test(hint)) return { file: attached }
}

export async function addFromFile(cwd: string, resumePath: string) {
  const packet = (await ReqWorkspace.focusedReq(cwd)) ?? ((await ReqWorkspace.isPacket(cwd)) ? cwd : undefined)
  if (!packet) throw new Error("no focused req — run /open-req")
  const file = resumePath.trim()
  if (!file) throw new Error("add-candidate requires a local resume path")
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file)
  const text = await Bun.file(abs)
    .text()
    .catch(() => "")
  if (!text.trim()) throw new Error(`cannot read resume: ${file}`)
  const parsed = CandidateCard.parse(text)
  const rawBody = parsed?.body ?? stripBom(text)
  const name = (parsed?.extra.name ?? nameFromBody(rawBody) ?? path.basename(abs, path.extname(abs))).trim()
  if (!name) throw new Error("could not derive a candidate name from the file")
  const id = parsed?.id || CandidateCard.safeId(name)
  if (!id) throw new Error("could not derive a candidate id from the file")
  if (await CandidateCard.read(packet, id)) throw new Error(`candidate card already exists: ${id}`)
  await Bun.write(path.join(packet, CANDIDATES_DIR, ".gitkeep"), "")
  const card = {
    id,
    stage: "Sourced",
    source: parsed?.source ?? "file",
    extra: { ...(parsed?.extra ?? {}), name },
    body: bodyFromFile(parsed, rawBody, name),
  }
  const written = await CandidateCard.write(packet, card)
  return { id, name, file: written, relative: path.relative(cwd, written) || written, stage: card.stage }
}

function lastPathToken(hint: string) {
  if (!hint) return
  const quoted = hint.match(/["']([^"']+)["']\s*$/)
  if (quoted) return quoted[1]
  return hint.split(/\s+/).filter(Boolean).at(-1)
}

function stripQuotes(value: string) {
  if (value.length >= 2) {
    const q = value[0]
    if ((q === '"' || q === "'") && value.endsWith(q)) return value.slice(1, -1)
  }
  return value
}

function stripBom(text: string) {
  return text.replace(/^\uFEFF/, "")
}

function nameFromBody(text: string) {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading && !/^score\b/i.test(heading) && !/^outreach$/i.test(heading)) return heading
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, "").trim()
    if (!trimmed || trimmed.startsWith("---") || trimmed.startsWith("|")) continue
    return trimmed
  }
}

function bodyFromFile(parsed: ReturnType<typeof CandidateCard.parse>, rawBody: string, name: string) {
  if (parsed) return parsed.body
  const trimmed = rawBody.replace(/^\s+/, "")
  if (/^#\s+/m.test(trimmed)) return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`
  return `# ${name}\n\n${trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`}`
}

export * as CandidateAdd from "./candidate-add"
