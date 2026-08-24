import path from "path"
import { CandidateCard, type Card } from "./candidate-card"
import { Constitutions } from "./constitutions"
import { COMPANY_FILE, HIRING_FILE, ReqWorkspace } from "./req-workspace"

export type WriteKind = "score" | "draft"

export type WriteIntent = {
  kind: WriteKind
  hint: string
  files?: string[]
}

const SEND_COMMANDS = new Set(["send", "mail", "email", "outreach-for-real"])

export const NEVER_SENT =
  "we don't send. drafts stay in the folder — Draft only. Never sent. recruit never emails. the close stays human"

export function parseSendIntent(command?: string, message = ""): { hint: string } | undefined {
  const hint = message.trim()
  if (command && SEND_COMMANDS.has(command)) return { hint: hint || command }
  const text = command ? `${command} ${hint}`.trim() : hint
  if (!text) return
  if (/\boutreach[- ]for[- ]real\b/i.test(text)) return { hint: text }
  if (/\b(?:actually\s+)?(?:send|mail|email)\b/i.test(text) && /\b(?:for[- ]real|for real|actually)\b/i.test(text)) {
    return { hint: text }
  }
  if (/^(?:please\s+|can you\s+)?(?:\/)?(?:send|mail|email)\b/i.test(text)) return { hint: text }
  if (/\bsend\s+(?:this|it|the\s+)?(?:email|outreach|letter|message)\b/i.test(text)) return { hint: text }
}

const SCORE_COMMANDS = new Set(["score", "score-candidate"])
const DRAFT_COMMANDS = new Set(["draft", "draft-outreach"])
const PLACEHOLDER = /^(tbd|todo|n\/a|none|-)$/i
const STOP = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "their",
  "have",
  "plus",
  "into",
  "over",
  "onto",
  "only",
  "also",
  "using",
  "skill",
  "candidate",
  "resume",
  "card",
  "outreach",
  "email",
  "draft",
  "score",
])

export function parseWriteIntent(command?: string, message = ""): WriteIntent | undefined {
  const hint = message.trim()
  if (command && DRAFT_COMMANDS.has(command)) return { kind: "draft", hint }
  if (command && SCORE_COMMANDS.has(command)) return { kind: "score", hint }
  if (command) return
  if (parseSendIntent(undefined, hint)) return
  if (/^(?:please\s+|can you\s+)?(?:\/)?draft(?:-outreach)?\b/i.test(hint) || /\bdraft-outreach\b/i.test(hint)) {
    return { kind: "draft", hint }
  }
  if (/^(?:please\s+|can you\s+)?(?:\/)?score(?:-candidate)?\b/i.test(hint) || /\bscore-candidate\b/i.test(hint)) {
    return { kind: "score", hint }
  }
}

/** Natural recruit ask: work / get-ready. Named verbs stay on parseWriteIntent. */
export function parseNaturalWorkIntent(
  command?: string,
  message = "",
  agent?: string,
): { hint: string } | undefined {
  if (command) return
  if (agent && agent !== "recruit") return
  const hint = message.trim()
  if (!hint) return
  if (parseSendIntent(undefined, hint)) return
  if (parseWriteIntent(undefined, hint)) return
  if (parseCompareIntent(undefined, hint)) return
  if (/\bready for review\b/i.test(hint)) return { hint }
  if (/^(?:please\s+|can you\s+)?(?:get|make|prep(?:are)?|work)\b/i.test(hint)) return { hint }
}


const COMPARE_COMMANDS = new Set(["compare", "compare-candidates"])

export function parseCompareIntent(command?: string, message = ""): { hint: string } | undefined {
  const hint = message.trim()
  if (command && COMPARE_COMMANDS.has(command)) return { hint: hint || command }
  if (command) return
  if (!hint) return
  if (parseSendIntent(undefined, hint) || parseWriteIntent(undefined, hint)) return
  if (/^(?:please\s+|can you\s+)?(?:\/)?compare(?:-candidates)?\b/i.test(hint)) return { hint }
  if (/\b(?:vs\.?|versus|against)\b/i.test(hint) && splitComparePair(hint)) return { hint }
}

export function splitComparePair(hint: string): [string, string] | undefined {
  const cleaned = hint
    .replace(/^(?:please\s+|can you\s+)?(?:\/)?compare(?:-candidates)?\b/i, "")
    .replace(/\b(?:these|those|the|candidates?|cards?|people|two)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  const parts = cleaned
    .split(/\s+(?:vs\.?|versus|against|and)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
  const pair = parts.length === 2 ? parts : cleaned.split(/\s+/).filter(Boolean)
  if (pair.length !== 2) return
  if (pair[0]!.toLowerCase() === pair[1]!.toLowerCase()) return
  return [pair[0]!, pair[1]!]
}

const NAME_FILLER =
  /\b(?:this|the|a|an|candidate|resume|card|outreach|email|linkedin|for|using|skill|draft|score|get|make|prep|prepare|ready|review|work|please|can|you)\b/gi

function stripCardPunctuation(token: string) {
  return token
    .split(/\s+/)
    .map((part) => part.replace(/[.!?]+$/g, ""))
    .filter(Boolean)
    .join(" ")
}

function stripHintName(hint: string) {
  return stripCardPunctuation(
    hint
      .replace(/^(?:please\s+|can you\s+)?/i, "")
      .replace(/^(?:\/)?(?:score(?:-candidate)?|draft(?:-outreach)?)\b/i, "")
      .replace(NAME_FILLER, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
}

export async function writeOnCard(cwd: string, intent: WriteIntent) {
  const root = await ReqWorkspace.companyRoot(cwd)
  if (!root || !(await ReqWorkspace.isLiveCompany(root))) {
    throw new Error(ReqWorkspace.notACompanyDirectory(cwd))
  }
  const packet = (await ReqWorkspace.focusedReq(cwd)) ?? ((await ReqWorkspace.isPacket(cwd)) ? cwd : undefined)
  if (!packet) throw new Error(ReqWorkspace.notACompanyDirectory(cwd))
  const hiring = await Bun.file(path.join(packet, HIRING_FILE))
    .text()
    .catch(() => "")
  if (!hiring.trim()) throw new Error(`missing ${HIRING_FILE} in the focused req`)
  const companyMd = await Bun.file(path.join(root, COMPANY_FILE))
    .text()
    .catch(() => "")
  const cards = await CandidateCard.list(packet)
  const hint = [intent.hint, ...(intent.files ?? [])].filter(Boolean).join(" ")
  const named = cardIdsFromMention(hint, intent.files)[0] ?? namedCardId(hint)
  if (named) {
    const here = cards.find((card) => card.id.toLowerCase() === named.toLowerCase())
    if (!here) {
      const elsewhere = await findCardReq(root, named)
      if (elsewhere) {
        throw new Error(
          `card ${named} is on ${elsewhere} — focus that req (open-req ${elsewhere}) or pass --cwd/--dir to it`,
        )
      }
    }
  }
  const card = resolveCard(cards, hint)
  const req = parseReq(hiring, companyMd)
  const next =
    intent.kind === "score"
      ? scored(card, req, packet, Constitutions.fingerprintsOf(companyMd, hiring))
      : drafted(card, req, packet)
  const file = await CandidateCard.write(packet, next)
  await stageCardWrite(cwd, intent.kind, next)
  return { kind: intent.kind, id: next.id, file, score: next.score, relative: path.relative(cwd, file) || file }
}

function writeExcerpt(kind: WriteKind, card: Card) {
  const heading = kind === "score" ? "Score" : "Outreach"
  const match = card.body.match(new RegExp(`(?:^|\\n)(# ${heading}\\b[\\s\\S]*?)(?=\\n# (?!${heading})|$)`))
  if (match?.[1]?.trim()) return match[1].trim()
  if (kind === "score") {
    return typeof card.score === "number" ? `score ${card.score} on ${card.id}` : `score ${card.id}`
  }
  return `draft outreach for ${card.id}`
}

async function stageCardWrite(cwd: string, kind: WriteKind, card: Card) {
  const { DecisionVerbs } = await import("@/decision/verbs")
  const body = writeExcerpt(kind, card)
  const rationale =
    kind === "score"
      ? typeof card.score === "number"
        ? `score ${card.score} on ${card.id}`
        : `score ${card.id}`
      : `draft outreach for ${card.id}`
  await DecisionVerbs.pull({ cwd })
  await DecisionVerbs.commit({
    action: kind === "draft" ? "outreach" : "note",
    target: { kind: "candidate", id: card.id },
    rationale,
    reason: rationale,
    body,
    source: kind,
    cwd,
  })
}


export function idFromCardPath(token: string) {
  const raw = token.replace(/^@/, "").replace(/^["'`]+|[,"'`;]+$/g, "").trim()
  if (!raw) return
  const normalized = raw.replaceAll("\\", "/")
  const base = path.basename(normalized)
  if (!base.toLowerCase().endsWith(".md") || base === ".gitkeep") return
  if (normalized.includes("/") && !/\/candidates\//i.test(`/${normalized}`)) return
  const id = CandidateCard.safeId(base.replace(/\.md$/i, ""))
  return id || undefined
}

export function cardIdsFromMention(hint: string, files: string[] = []) {
  const tokens = [
    ...files,
    ...[...hint.matchAll(/@([^\s]+)/g)].map((match) => match[1]!),
    ...[...hint.matchAll(/(?:^|[\s"'`])((?:\.\.\/|\.\/|[\w.-]+\/)*candidates\/[\w.-]+\.md)/gi)].map((match) => match[1]!),
    ...[...hint.matchAll(/(?:^|[\s"'`])([\w.-]+\.md)\b/gi)].map((match) => match[1]!),
  ]
  const ids: string[] = []
  for (const token of tokens) {
    const id = idFromCardPath(token)
    if (id && !ids.some((item) => item.toLowerCase() === id.toLowerCase())) ids.push(id)
  }
  return ids
}

function namedCardId(hint: string) {
  const cand = hint.match(/\b(cand[_-][a-z0-9]+)\b/i)
  if (cand) return cand[1]
  const stripped = stripHintName(hint)
  if (!stripped) return
  if (/^(cand[_-][a-z0-9]+|[a-z0-9]+-[a-z0-9-]+)$/i.test(stripped)) return stripped
}

async function findCardReq(root: string, id: string) {
  for (const slug of await ReqWorkspace.listReqs(root)) {
    const dir = path.join(root, slug)
    const cards = await CandidateCard.list(dir)
    if (cards.some((card) => card.id.toLowerCase() === id.toLowerCase())) return slug
  }
  if (await ReqWorkspace.isPacket(root)) {
    const cards = await CandidateCard.list(root)
    if (cards.some((card) => card.id.toLowerCase() === id.toLowerCase())) return path.basename(root)
  }
}

function isRejected(card: Card) {
  return (card.stage ?? "").trim().toLowerCase() === "rejected"
}

function scoreableCards(cards: Card[]) {
  return cards.filter((card) => !isRejected(card))
}

function listed(cards: Card[]) {
  return cards.map((card) => (card.stage ? `${card.id} (${card.stage})` : card.id)).join(", ")
}

export function resolveCard(cards: Card[], hint: string, files: string[] = []): Card {
  if (cards.length === 0) throw new Error("no candidate cards — run moks pull in a focused req")
  const mentioned = cardIdsFromMention(hint, files)
  const ids = [
    ...mentioned.map((id) => id.toLowerCase()),
    ...[...hint.matchAll(/\b(cand[_-][a-z0-9]+)\b/gi)].map((match) => match[1].toLowerCase()),
  ]
  const named = stripHintName(hint).toLowerCase()
  const scoreable = scoreableCards(cards)
  const byId = cards.find((card) => ids.includes(card.id.toLowerCase()))
  if (byId) {
    if (isRejected(byId)) {
      const others = scoreable.map((card) => card.id).join(", ")
      throw new Error(`${byId.id} is Rejected` + (others ? ` — scoreable cards: ${others}` : ""))
    }
    return byId
  }
  if (ids.length > 0) {
    const named = ids[0]
    throw new Error(`unknown card: ${named} — name one of: ${scoreable.map((card) => card.id).toSorted().join(", ")}`)
  }
  const byName =
    scoreable.find((card) => named && (card.extra.name ?? "").toLowerCase().includes(named)) ??
    scoreable.find((card) => named && card.id.toLowerCase().includes(named.replace(/\s+/g, "-")))
  if (byName) return byName
  if (scoreable.length === 1) return scoreable[0]
  if (scoreable.length === 0) {
    throw new Error(`no scoreable cards (skipped Rejected): ${listed(cards)}`)
  }
  throw new Error(`no target id — name one of: ${scoreable.map((card) => card.id).toSorted().join(", ")}`)
}

function parseReq(hiring: string, companyMd = "") {
  const title = hiring.match(/^#\s+(.+)$/m)?.[1]?.trim() || "the role"
  const company = hiring.match(/^\s*-\s*Company:\s*(.+)$/m)?.[1]?.trim()
  const location = hiring.match(/^\s*-\s*Location:\s*(.+)$/m)?.[1]?.trim()
  const musts = sectionItems(hiring, "Must-haves").filter((item) => !PLACEHOLDER.test(item))
  const scorecard = scorecardBars(hiring)
  const dimensions = scorecard.map((row) => row.label)
  const labels = dimensions.length > 0 ? dimensions : musts.length > 0 ? musts : titleWords(title)
  const bars =
    scorecard.length > 0
      ? scorecard
      : labels.map((label) => ({ label, bar: label, file: HIRING_FILE }))
  const companyBar = sectionItems(companyMd, "Bar").filter((item) => !PLACEHOLDER.test(item))
  const toneHeading = sectionItems(companyMd, "Tone & outreach")
  const tone = (toneHeading.length > 0 ? toneHeading : sectionItems(companyMd, "Tone")).filter(
    (item) => !PLACEHOLDER.test(item),
  )
  const about = sectionItems(companyMd, "About").filter((item) => !PLACEHOLDER.test(item))
  return {
    title,
    company: company && !PLACEHOLDER.test(company) ? company : undefined,
    location: location && !PLACEHOLDER.test(location) ? location : undefined,
    labels,
    bars,
    companyBar,
    tone,
    about,
  }
}

function sectionItems(text: string, heading: string) {
  const match = text.match(new RegExp(`^## ${heading}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$)`, "im"))
  if (!match) return []
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line && !line.startsWith("|") && !line.startsWith("#"))
}

function tableCells(row: string) {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

function scorecardBars(hiring: string) {
  const block = hiring.match(/^## Scorecard\b[^\n]*\n([\s\S]*?)(?=\n## |\s*$)/i)?.[1] ?? hiring
  const lines = block.split(/\r?\n/).filter((line) => line.trim().startsWith("|"))
  if (lines.length < 2) return [] as { label: string; bar: string; file: typeof HIRING_FILE }[]
  const headers = tableCells(lines[0]!).map((cell) => cell.toLowerCase())
  const dimI = headers.findIndex((cell) => /dimension/.test(cell))
  if (dimI < 0) return []
  const barI = headers.findIndex((cell) => /\bbar\b/.test(cell) || cell === "3")
  const out: { label: string; bar: string; file: typeof HIRING_FILE }[] = []
  for (const line of lines.slice(1)) {
    const cells = tableCells(line)
    if (cells.every((cell) => /^[-:\s]+$/.test(cell))) continue
    const label = cells[dimI]?.trim()
    if (!label || /^dimension$/i.test(label) || PLACEHOLDER.test(label)) continue
    const barCell = barI >= 0 ? cells[barI]?.trim() : ""
    const bar = barCell && !PLACEHOLDER.test(barCell) ? barCell : label
    out.push({ label, bar, file: HIRING_FILE })
  }
  return out
}

function titleWords(title: string) {
  const words = tokens(title).filter((word) => !STOP.has(word) && word.length > 3)
  return words.length > 0 ? words.map((word) => word[0].toUpperCase() + word.slice(1)) : ["Fit"]
}

function tokens(text: string) {
  return (text.toLowerCase().match(/[a-z][a-z0-9+.#/-]{2,}/g) ?? []).filter((word) => !STOP.has(word))
}

function quoteFor(card: Card, keywords: string[]) {
  const material = card.body.split(/^# (?:Score|Outreach)\b/m)[0] ?? ""
  const lines = material
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("---") && !line.startsWith("|"))
  for (const key of keywords) {
    const hit = lines.find((line) => line.toLowerCase().includes(key))
    if (hit) return hit.replace(/^[-*]\s+/, "").slice(0, 160)
  }
  return
}

function scoreRows(
  card: Card,
  bars: { label: string; bar: string; file: string }[],
  source: string,
) {
  return bars.map((item) => {
    const keys = [...tokens(item.label), ...tokens(item.bar)]
    const evidence = quoteFor(card, keys)
    if (!evidence) {
      return { ...item, score: "N/A", evidence: "not on the card", source }
    }
    return { ...item, score: "3", evidence, source }
  })
}

function citeRow(row: {
  label: string
  bar: string
  file: string
  evidence: string
  source: string
  score: string
}) {
  const bar = row.bar === row.label ? row.label : `${row.label} bar: "${row.bar}"`
  const card = row.score === "N/A" ? `not on the card` : `card: "${row.evidence}" (${row.source})`
  return `${row.file} ${bar} — ${card}`
}

function scored(
  card: Card,
  req: ReturnType<typeof parseReq>,
  packet: string,
  fingerprints: { company_hash: string; hiring_hash: string },
) {
  const source = path.relative(packet, CandidateCard.filePath(packet, card.id)).replaceAll(path.sep, "/")
  const companyBars = req.companyBar.map((bar) => ({ label: bar, bar, file: COMPANY_FILE }))
  const rows = [...scoreRows(card, req.bars, source), ...scoreRows(card, companyBars, source)]
  const numeric = rows.filter((row) => row.score !== "N/A")
  const overall = numeric.length === 0 ? 2 : 3
  const recommendation = numeric.length === 0 ? "mixed" : numeric.length === rows.length ? "yes" : "mixed"
  const name = card.extra.name || card.id
  const rationale =
    numeric.length === 0
      ? `${overall} — no card line matches a COMPANY.md / HIRING.md bar; do not invent employment history.`
      : `${overall} because ${numeric.length}/${rows.length} bar lines have card evidence; unmatched stay N/A.`
  const strengths = numeric.map((row) => citeRow(row))
  const gaps = rows.filter((row) => row.score === "N/A").map((row) => citeRow(row))
  const table = [
    "| Dimension | Score (1-5) | Bar | Evidence | Source |",
    "|-----------|-------------|-----|----------|--------|",
    ...rows.map((row) => `| ${row.label} | ${row.score} | ${row.bar} | ${row.evidence} | ${row.source} / ${row.file} |`),
  ]
  const section = [
    `# Score: ${name} → ${req.title}`,
    "",
    "## Summary",
    `- Recommendation: ${recommendation}`,
    `- One-line rationale: ${rationale}`,
    "",
    `## Why ${overall}`,
    ...(rows.length ? rows.map((row) => `- ${citeRow(row)}`) : ["- No bar to cite"]),
    "",
    "## Dimension scores",
    ...table,
    "",
    "## Strengths",
    ...(strengths.length ? strengths.map((line) => `- ${line}`) : ["- None quoted from the card"]),
    "",
    "## Risks / gaps",
    ...(gaps.length ? gaps.map((line) => `- ${line}`) : ["- No unknown dimensions"]),
    "",
    "## Interview focus",
    ...(gaps.length
      ? gaps.map((line) => `- Probe ${line.split(":")[0]} using only materials they provide`)
      : ["- Walk ownership stories already on the card"]),
    "",
    "## Sources",
    `- ${source}`,
    `- ${HIRING_FILE}`,
    ...(req.companyBar.length ? [`- ${COMPANY_FILE}`] : []),
    "",
  ].join("\n")
  return {
    ...card,
    score: overall,
    extra: { ...card.extra, ...fingerprints },
    body: upsertSection(card.body, "Score", section),
  }
}

const SEND_POLICY = /draft only\.?\s*never sent/i

function voiceLines(tone: string[]) {
  return tone.filter((line) => !SEND_POLICY.test(line))
}

function voiceOf(tone: string[]): "warm" | "terse" | "plain" {
  const voice = voiceLines(tone)
  if (voice.length === 0) return "plain"
  const blob = voice.join(" ").toLowerCase()
  const terse = /\b(terse|formal|direct|crisp|brief|no fluff|no-fluff)\b/.test(blob)
  const warm = /\b(warm|specific|friendly|personal|human)\b/.test(blob)
  if (terse && !warm) return "terse"
  if (warm && !terse) return "warm"
  if (terse) return "terse"
  return "warm"
}

function letter(card: Card, req: ReturnType<typeof parseReq>) {
  const name = card.extra.name || card.id
  const parts = name.split(/\s+/).filter(Boolean)
  const first = parts[0] ?? name
  const last = parts.length > 1 ? parts[parts.length - 1]! : undefined
  const hook = quoteFor(card, tokens(`${card.extra.name ?? ""} ${req.title}`)) ?? quoteFor(card, tokens(card.body))
  const where = req.location ? ` (${req.location})` : ""
  const who = req.company ? `${req.company} is hiring` : "We're hiring"
  const voice = voiceOf(req.tone)
  if (voice === "plain") {
    return {
      greeting: `Hi ${first},`,
      opening: hook ? `${who} a ${req.title}${where}. Your card notes: "${hook}"` : `${who} a ${req.title}${where}.`,
      ask: "Would you be open to a short conversation about the role?",
      close: "Best,",
      linkedin: `Hi ${first} — ${who.toLowerCase()} a ${req.title}${where}. Open to a quick chat?`,
      hook,
    }
  }
  if (voice === "warm") {
    const opening = hook
      ? `I keep coming back to this on your card: "${hook}"`
      : `${who} a ${req.title}${where}.`
    return {
      greeting: `Hi ${first} —`,
      opening,
      ask: "If a short conversation would be useful, I'm around this week — no pitch deck.",
      close: "Talk soon if that's useful,",
      linkedin: `Hi ${first} — your card stuck with me. Open to a real conversation about ${req.title}?`,
      hook,
    }
  }
  const opening = hook
    ? `${req.company ?? "We"}: ${req.title}${where}. "${hook}"`
    : `${req.company ?? "We"}: ${req.title}${where}.`
  return {
    greeting: last ? `${last},` : `${first},`,
    opening,
    ask: "15 minutes on the role. Yes or no is fine.",
    close: "Regards,",
    linkedin: `${last ?? first} — ${req.title}${where}. 15 minutes?`,
    hook,
  }
}

function drafted(card: Card, req: ReturnType<typeof parseReq>, packet: string) {
  const source = path.relative(packet, CandidateCard.filePath(packet, card.id)).replaceAll(path.sep, "/")
  const name = card.extra.name || card.id
  const copy = letter(card, req)
  const emailNote = /@/.test(card.body) ? "Recipient email is on the card; do not send." : "Recipient email is unset; draft only."
  const section = [
    `# Outreach`,
    "",
    "Draft only. Never sent.",
    "",
    "## Email",
    `Subject: ${req.title} — ${name}`,
    "",
    "Body:",
    copy.greeting,
    "",
    copy.opening,
    "",
    copy.ask,
    "",
    copy.close,
    "",
    "## LinkedIn",
    copy.linkedin,
    "",
    "## Personalization hooks",
    copy.hook ? `- "${copy.hook}" (${source})` : `- No extra facts on ${source} beyond the name`,
    `- Role title from ${HIRING_FILE}: ${req.title}`,
    "",
    "## Open questions",
    `- ${emailNote}`,
    "",
  ].join("\n")
  return { ...card, body: upsertSection(card.body, "Outreach", section) }
}

function upsertSection(body: string, heading: string, section: string) {
  const block = section.trim() + "\n"
  const re = new RegExp(`(?:^|\\n)# ${heading}\\b[^\\n]*\\n[\\s\\S]*?(?=\\n# |$)`)
  if (re.test(body)) {
    return body.replace(re, (match) => `${match.startsWith("\n") ? "\n" : ""}${block}`)
  }
  return `${body.replace(/\s*$/, "\n\n")}${block}`
}



export async function compareOnCards(cwd: string, hint: string, files: string[] = []) {
  const root = await ReqWorkspace.companyRoot(cwd)
  if (!root || !(await ReqWorkspace.isLiveCompany(root))) {
    throw new Error(ReqWorkspace.notACompanyDirectory(cwd))
  }
  const packet = (await ReqWorkspace.focusedReq(cwd)) ?? ((await ReqWorkspace.isPacket(cwd)) ? cwd : undefined)
  if (!packet) throw new Error(ReqWorkspace.notACompanyDirectory(cwd))
  const hiring = await Bun.file(path.join(packet, HIRING_FILE))
    .text()
    .catch(() => "")
  if (!hiring.trim()) throw new Error(`missing ${HIRING_FILE} in the focused req`)
  const companyMd = await Bun.file(path.join(root, COMPANY_FILE))
    .text()
    .catch(() => "")
  const mentioned = cardIdsFromMention(hint, files)
  const pair = mentioned.length >= 2 ? [mentioned[0]!, mentioned[1]!] : splitComparePair(hint)
  if (!pair) throw new Error("compare needs two cards in this req — name both")
  const cards = await CandidateCard.list(packet)
  const left = resolveCard(cards, pair[0])
  const right = resolveCard(cards, pair[1])
  if (left.id === right.id) throw new Error("compare needs two different cards in this req")
  const req = parseReq(hiring, companyMd)
  const leftSrc = path.relative(packet, CandidateCard.filePath(packet, left.id)).replaceAll(path.sep, "/")
  const rightSrc = path.relative(packet, CandidateCard.filePath(packet, right.id)).replaceAll(path.sep, "/")
  const companyBars = req.companyBar.map((bar) => ({ label: bar, bar, file: COMPANY_FILE }))
  const bars = [...req.bars, ...companyBars]
  const leftRows = scoreRows(left, bars, leftSrc)
  const rightRows = scoreRows(right, bars, rightSrc)
  const ids = [left.id, right.id].toSorted()
  const file = path.join(packet, "compare", `${ids[0]}-vs-${ids[1]}.md`)
  const barLines = bars.map((item) => `- ${item.file} ${item.bar === item.label ? item.label : `${item.label} bar: "${item.bar}"`}`)
  const body = [
    `# Compare: ${left.extra.name || left.id} vs ${right.extra.name || right.id} → ${req.title}`,
    "",
    "Human picks. This is a take, not a hire.",
    "",
    "## Bar",
    ...(barLines.length ? barLines : [`- ${HIRING_FILE}`]),
    "",
    "## On the cards",
    `### ${left.id} (${leftSrc})`,
    ...leftRows.map((row) => `- ${citeRow(row)}`),
    "",
    `### ${right.id} (${rightSrc})`,
    ...rightRows.map((row) => `- ${citeRow(row)}`),
    "",
    "## Take",
    "Same bar. Different evidence. The human still picks.",
    "",
    "## Sources",
    `- ${leftSrc}`,
    `- ${rightSrc}`,
    `- ${HIRING_FILE}`,
    ...(req.companyBar.length ? [`- ${COMPANY_FILE}`] : []),
    "",
  ].join("\n")
  await Bun.write(file, body)
  return {
    left: left.id,
    right: right.id,
    file,
    relative: path.relative(cwd, file) || file,
    pick: null,
  }
}

export async function workOnCard(cwd: string, hint: string) {
  if (parseSendIntent(undefined, hint)) throw new Error(NEVER_SENT)
  const scored = await writeOnCard(cwd, { kind: "score", hint })
  const drafted = await writeOnCard(cwd, { kind: "draft", hint })
  const card = CandidateCard.parse(await Bun.file(scored.file).text())
  const fromCard =
    (card ? CandidateCard.readReason(card) : undefined) ||
    card?.body.match(/One-line rationale:\s*(.+)/i)?.[1]?.trim() ||
    (card?.score !== undefined ? `score ${card.score} on ${scored.id}` : undefined)
  return {
    id: scored.id,
    score: drafted.score ?? scored.score,
    relative: drafted.relative,
    rationale: fromCard || hint.trim() || `note on ${scored.id}`,
  }
}

export * as CardWrite from "./card-write"
