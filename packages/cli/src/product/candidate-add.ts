import path from "path"
import { CandidateCard, CANDIDATES_DIR } from "./candidate-card"
import { ReqWorkspace } from "./req-workspace"
import { withLedger, type LedgerHandle } from "@/decision/session"

const LOCAL_ATS = "mock"

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
  const taken = handle.api.readMirrorEntity(handle.db, "candidate", input.id)
  const mockJob = handle.mockDb.prepare("SELECT id FROM jobs ORDER BY id ASC LIMIT 1").get() as { id: string } | undefined
  if (taken) {
    if (opts.collide !== "skip") {
      throw new Error(`candidate already in ledger: ${input.id} — pick a name that is not a mock ATS id`)
    }
    const inMock = handle.mockDb.prepare("SELECT id FROM candidates WHERE id = ?").get(input.id) as { id: string } | undefined
    if (!inMock && mockJob) {
      const appId = `app_${input.id}`
      handle.mockDb
        .prepare("INSERT OR IGNORE INTO candidates (id, remote_id, name, email, headline) VALUES (?, ?, ?, ?, ?)")
        .run(input.id, input.id, input.name, "", input.headline)
      handle.mockDb
        .prepare("INSERT OR IGNORE INTO applications (id, remote_id, job_id, candidate_id, stage) VALUES (?, ?, ?, ?, ?)")
        .run(appId, appId, mockJob.id, input.id, "Sourced")
    }
    return
  }
  const now = Date.now()
  const upsert = handle.db.prepare(`
    INSERT INTO remote_mirror (entity_type, entity_ref, ats, remote_id, state, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_ref, ats) DO UPDATE SET
      remote_id = excluded.remote_id,
      state = excluded.state,
      synced_at = excluded.synced_at
  `)
  const jobId = mockJob?.id ?? (
    handle.db
      .prepare("SELECT entity_ref FROM remote_mirror WHERE entity_type = 'job' ORDER BY entity_ref ASC LIMIT 1")
      .get() as { entity_ref: string } | undefined
  )?.entity_ref ?? "job_file"
  const ats = mockJob ? "mock" : "file"
  if (!mockJob) {
    upsert.run(
      "job",
      jobId,
      ats,
      jobId,
      JSON.stringify({ id: jobId, remoteId: jobId, title: "Local", team: "", location: "", status: "open" }),
      now,
    )
  }
  const candidate = { id: input.id, remoteId: input.id, name: input.name, email: "", headline: input.headline }
  const appId = `app_${input.id}`
  const application = { id: appId, remoteId: appId, jobId, candidateId: input.id, stage: "Sourced" }
  upsert.run("candidate", input.id, ats, input.id, JSON.stringify(candidate), now)
  upsert.run("application", appId, ats, appId, JSON.stringify(application), now)
  if (mockJob) {
    handle.mockDb
      .prepare("INSERT OR IGNORE INTO candidates (id, remote_id, name, email, headline) VALUES (?, ?, ?, ?, ?)")
      .run(input.id, input.id, input.name, "", input.headline)
    handle.mockDb
      .prepare("INSERT OR IGNORE INTO applications (id, remote_id, job_id, candidate_id, stage) VALUES (?, ?, ?, ?, ?)")
      .run(appId, appId, mockJob.id, input.id, "Sourced")
  }
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
