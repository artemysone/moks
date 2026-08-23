import path from "path"
import { readdir } from "fs/promises"
import { CandidateCard, CANDIDATES_DIR } from "./candidate-card"
import { ReqWorkspace } from "./req-workspace"
import { withLedger, type LedgerHandle } from "@/decision/session"

const LOCAL_ATS = "mock"

const ADD_COMMANDS = new Set(["add-candidate", "add-local-candidate"])

const NAME_LIST_FILLER = new Set([
  "a",
  "an",
  "the",
  "these",
  "those",
  "this",
  "that",
  "candidate",
  "candidates",
  "people",
  "person",
  "names",
  "name",
  "list",
  "from",
  "into",
  "the",
  "req",
  "focused",
  "resumes",
  "resume",
  "files",
  "file",
  "pile",
  "folder",
  "directory",
])

const NAME_BLOCK = /\b(note|score|draft|review|reject|advance|commit|push|work|hire|offer)\b/i
const MODEL_OR_QUESTION = /\b(who|what|why|how|when|where|is|are|was|were|using|brief|skill)\b/i

export type AddIntent = {
  files: string[]
  names: string[]
}

export function parseAddIntent(
  command?: string,
  message = "",
  files: string[] = [],
  agent?: string,
): AddIntent | undefined {
  const attached = files
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => looksLikePath(item) || !/\s/.test(item))
  const hint = message.trim()
  const recruit = !command && agent === "recruit"
  if (command && !ADD_COMMANDS.has(command)) return
  if (command && ADD_COMMANDS.has(command)) {
    const parsed = parsePile(hint, attached)
    if (parsed.files.length || parsed.names.length) return parsed
    return { files: attached.length ? attached : [""], names: [] }
  }
  if (command) return
  if (/^(?:please\s+|can you\s+)?(?:\/)?add(?:-candidate)?\b/i.test(hint)) {
    const parsed = parsePile(hint, attached)
    if (parsed.files.length || parsed.names.length) return parsed
    if (attached.length) return { files: attached, names: [] }
    return
  }
  // Pile only for add / bare --file / name-list. Model prompts keep --file as LLM context.
  if (recruit && attached.length && !hint) return { files: attached, names: [] }
  if (recruit && looksLikeNameList(hint)) {
    const parsed = parsePile(hint, attached)
    if (parsed.files.length || parsed.names.length) return parsed
  }
}

function looksLikeNameList(hint: string) {
  const rest = stripAddPrefix(hint)
  if (!rest || /\?/.test(rest) || MODEL_OR_QUESTION.test(rest)) return false
  const chunks = splitList(rest).map((chunk) => stripQuotes(chunk)).filter(Boolean)
  if (chunks.length === 0) return false
  return chunks.every((token) => looksLikePath(token) || isPersonName(token))
}

function parsePile(hint: string, attached: string[]): AddIntent {
  const files = [...attached]
  const names: string[] = []
  const rest = stripAddPrefix(hint)
  if (!rest) return { files, names }
  const chunks = splitList(rest)
  for (const chunk of chunks) {
    const token = stripQuotes(chunk)
    if (!token) continue
    if (looksLikePath(token)) {
      files.push(token)
      continue
    }
    if (isPersonName(token)) names.push(token)
  }
  return { files: unique(files), names: unique(names) }
}

function stripAddPrefix(hint: string) {
  return hint
    .replace(/^(?:please\s+|can you\s+)?(?:\/)?add(?:-candidate)?(?:\s+candidates?)?(?:\s+from)?\s+/i, "")
    .replace(/^[:\-]+\s*/, "")
    .trim()
}

function splitList(text: string) {
  return text
    .split(/\s*(?:,|;|\band\b|\n)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

function looksLikePath(token: string) {
  return /[\\/]/.test(token) || /\.(md|txt|html|pdf|docx|rst)$/i.test(token)
}

function isPersonName(token: string) {
  if (NAME_BLOCK.test(token)) return false
  const parts = token.split(/\s+/).filter((part) => !NAME_LIST_FILLER.has(part.toLowerCase()))
  if (parts.length === 0 || parts.length > 4) return false
  return parts.every((part) => /^[A-Za-z][A-Za-z.'-]*$/.test(part))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export async function addPile(cwd: string, intent: AddIntent) {
  const files = await expandResumePaths(cwd, intent.files)
  const added: Array<Awaited<ReturnType<typeof addFromFile>>> = []
  for (const file of files) added.push(await addFromFile(cwd, file))
  for (const name of intent.names) added.push(await addFromName(cwd, name))
  if (added.length === 0) throw new Error("add-candidate requires a local resume path or a name")
  return added
}

async function expandResumePaths(cwd: string, files: string[]) {
  const out: string[] = []
  for (const file of files) {
    const trimmed = file.trim()
    if (!trimmed) throw new Error("add-candidate requires a local resume path")
    const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed)
    let entries: import("fs").Dirent[] | undefined
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      out.push(trimmed)
      continue
    }
    const resumes = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isResumeFile(entry.name))
      .map((entry) => path.join(trimmed, entry.name))
      .toSorted()
    if (resumes.length === 0) throw new Error(`no resumes in directory: ${trimmed}`)
    out.push(...resumes)
  }
  return out
}

function isResumeFile(name: string) {
  return /\.(md|txt|html)$/i.test(name)
}

export async function addFromName(cwd: string, rawName: string) {
  const packet = (await ReqWorkspace.focusedReq(cwd)) ?? ((await ReqWorkspace.isPacket(cwd)) ? cwd : undefined)
  if (!packet) throw new Error("no focused req — run /open-req")
  const name = rawName.trim()
  if (!name) throw new Error("add-candidate requires a name")
  const id = CandidateCard.safeId(name)
  if (!id) throw new Error("could not derive a candidate id from the name")
  if (await CandidateCard.read(packet, id)) throw new Error(`candidate card already exists: ${id}`)
  await Bun.write(path.join(packet, CANDIDATES_DIR, ".gitkeep"), "")
  const body = `# ${name}\n`
  const card = {
    id,
    stage: "Sourced",
    source: "name",
    extra: { name },
    body,
  }
  const written = await CandidateCard.write(packet, card)
  await withLedger(cwd, async (handle) => {
    registerLocalCandidate(handle, { id, name, headline: name, stage: card.stage })
  })
  return { id, name, file: written, relative: path.relative(cwd, written) || written, stage: card.stage }
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
  const headline = headlineFromBody(card.body)
  await withLedger(cwd, async (handle) => {
    registerLocalCandidate(handle, { id, name, headline, stage: card.stage })
  })
  return { id, name, file: written, relative: path.relative(cwd, written) || written, stage: card.stage }
}

function headlineFromBody(body: string) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^[-*#]\s*/, "").trim()
    if (!trimmed || trimmed.startsWith("---") || trimmed.startsWith("|")) continue
    return trimmed.slice(0, 160)
  }
  return ""
}

export function registerLocalCandidate(
  handle: LedgerHandle,
  input: { id: string; name: string; headline: string; stage: string },
  opts: { collide?: "throw" | "skip" } = {},
) {
  handle.adapter.prepare?.()
  const mockJob = handle.mockDb.prepare("SELECT id FROM jobs ORDER BY id ASC LIMIT 1").get() as { id: string } | undefined
  if (!mockJob) {
    throw new Error("mock ATS has no jobs — pull or seed before add-candidate")
  }
  const taken = handle.api.readMirrorEntity(handle.db, "candidate", input.id)
  const inMock = handle.mockDb.prepare("SELECT id FROM candidates WHERE id = ?").get(input.id) as { id: string } | undefined
  if (inMock && taken) {
    if (opts.collide !== "skip") {
      throw new Error(`candidate already in ledger: ${input.id} — pick a name that is not a mock ATS id`)
    }
    return
  }
  if (inMock && !taken) {
    if (opts.collide !== "skip") {
      throw new Error(`candidate already in ledger: ${input.id} — pick a name that is not a mock ATS id`)
    }
    return
  }
  if (taken && opts.collide !== "skip") {
    throw new Error(`candidate already in ledger: ${input.id} — pick a name that is not a mock ATS id`)
  }
  insertLocalIntoMockAts(handle, input, mockJob.id)
}

function insertLocalIntoMockAts(
  handle: LedgerHandle,
  input: { id: string; name: string; headline: string; stage: string },
  jobId: string,
) {
  const appId = `app_${input.id}`
  handle.mockDb
    .prepare("INSERT OR IGNORE INTO candidates (id, remote_id, name, email, headline) VALUES (?, ?, ?, ?, ?)")
    .run(input.id, input.id, input.name, "", input.headline)
  handle.mockDb
    .prepare("INSERT OR IGNORE INTO applications (id, remote_id, job_id, candidate_id, stage) VALUES (?, ?, ?, ?, ?)")
    .run(appId, appId, jobId, input.id, input.stage || "Sourced")
  const now = Date.now()
  const upsert = handle.db.prepare(`
    INSERT INTO remote_mirror (entity_type, entity_ref, ats, remote_id, state, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_ref, ats) DO UPDATE SET
      remote_id = excluded.remote_id,
      state = excluded.state,
      synced_at = excluded.synced_at
  `)
  const candidate = { id: input.id, remoteId: input.id, name: input.name, email: "", headline: input.headline }
  const application = { id: appId, remoteId: appId, jobId, candidateId: input.id, stage: input.stage || "Sourced" }
  upsert.run("candidate", input.id, LOCAL_ATS, input.id, JSON.stringify(candidate), now)
  upsert.run("application", appId, LOCAL_ATS, appId, JSON.stringify(application), now)
  handle.db.prepare("DELETE FROM remote_mirror WHERE entity_type = 'candidate' AND entity_ref = ? AND ats != ?").run(input.id, LOCAL_ATS)
  handle.db.prepare("DELETE FROM remote_mirror WHERE entity_type = 'application' AND entity_ref = ? AND ats != ?").run(appId, LOCAL_ATS)
}

export async function adoptLocalCards(handle: LedgerHandle) {
  const packet = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
  if (!packet) return
  for (const card of await CandidateCard.list(packet)) {
    registerLocalCandidate(
      handle,
      {
        id: card.id,
        name: card.extra.name || card.id,
        headline: headlineFromBody(card.body),
        stage: card.stage || "Sourced",
      },
      { collide: "skip" },
    )
  }
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
