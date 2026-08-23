import path from "path"
import { CandidateCard, type Card } from "./candidate-card"
import { COMPANY_FILE, HIRING_FILE, ReqWorkspace } from "./req-workspace"

export type WriteKind = "score" | "draft"

export type WriteIntent = {
  kind: WriteKind
  hint: string
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
  if (/^(?:please\s+|can you\s+)?(?:\/)?draft(?:-outreach)?\b/i.test(hint) || /\bdraft-outreach\b/i.test(hint)) {
    return { kind: "draft", hint }
  }
  if (/^(?:please\s+|can you\s+)?(?:\/)?score(?:-candidate)?\b/i.test(hint) || /\bscore-candidate\b/i.test(hint)) {
    return { kind: "score", hint }
  }
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
  const named = namedCardId(intent.hint)
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
  const card = resolveCard(cards, intent.hint)
  const req = parseReq(hiring, companyMd)
  const next = intent.kind === "score" ? scored(card, req, packet) : drafted(card, req, packet)
  const file = await CandidateCard.write(packet, next)
  return { kind: intent.kind, id: next.id, file, score: next.score, relative: path.relative(cwd, file) || file }
}

function namedCardId(hint: string) {
  const cand = hint.match(/\b(cand[_-][a-z0-9]+)\b/i)
  if (cand) return cand[1]
  const stripped = hint
    .replace(/^(?:please\s+|can you\s+)?/i, "")
    .replace(/^(?:\/)?(?:score(?:-candidate)?|draft(?:-outreach)?)\b/i, "")
    .replace(/\b(?:this|the|a|an|candidate|resume|card|outreach|email|linkedin|for|using|skill|draft)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!stripped) return
  if (/^[a-z0-9][a-z0-9_-]+$/i.test(stripped)) return stripped
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

export function resolveCard(cards: Card[], hint: string): Card {
  if (cards.length === 0) throw new Error("no candidate cards — run moks pull in a focused req")
  const ids = [...hint.matchAll(/\b(cand[_-][a-z0-9]+)\b/gi)].map((match) => match[1].toLowerCase())
  const named = hint
    .replace(/^(?:please\s+|can you\s+)?/i, "")
    .replace(/^(?:\/)?(?:score(?:-candidate)?|draft(?:-outreach)?)\b/i, "")
    .replace(/\b(?:this|the|a|an|candidate|resume|card|outreach|email|linkedin|for|using|skill|draft)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
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
  const dimensions = scorecardDimensions(hiring)
  const labels = dimensions.length > 0 ? dimensions : musts.length > 0 ? musts : titleWords(title)
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

function scorecardDimensions(hiring: string) {
  const rows = hiring.match(/^\|\s*(?![-:|])([^|\n]+)\|/gm) ?? []
  return rows
    .map((row) => row.replace(/^\|\s*/, "").replace(/\s*\|.*$/, "").trim())
    .filter((cell) => cell && !/^dimension$/i.test(cell) && !PLACEHOLDER.test(cell))
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

function scoreRows(card: Card, labels: string[], source: string) {
  return labels.map((label) => {
    const keys = tokens(label)
    const evidence = quoteFor(card, keys)
    if (!evidence) {
      return { label, score: "N/A", evidence: "not on the card", source }
    }
    return { label, score: "3", evidence, source }
  })
}

function scored(card: Card, req: ReturnType<typeof parseReq>, packet: string) {
  const source = path.relative(packet, CandidateCard.filePath(packet, card.id)).replaceAll(path.sep, "/")
  const rows = [
    ...scoreRows(card, req.labels, source),
    ...scoreRows(card, req.companyBar, source).map((row) => ({ ...row, fromCompany: true })),
  ]
  const numeric = rows.filter((row) => row.score !== "N/A").map(() => 3)
  const overall = numeric.length === 0 ? 2 : 3
  const recommendation = numeric.length === 0 ? "mixed" : numeric.length === rows.length ? "yes" : "mixed"
  const name = card.extra.name || card.id
  const rationale =
    numeric.length === 0
      ? "Card has no overlapping evidence for the req dimensions; do not invent employment history."
      : `Evidence on the card covers ${numeric.length}/${rows.length} dimensions; gaps stay N/A.`
  const strengths = rows.filter((row) => row.score !== "N/A").map((row) => `${row.label}: "${row.evidence}" (${row.source})`)
  const gaps = rows.filter((row) => row.score === "N/A").map((row) => `${row.label}: not evidenced on ${row.source}`)
  const table = [
    "| Dimension | Score (1-5) | Evidence | Source |",
    "|-----------|-------------|----------|--------|",
    ...rows.map((row) => `| ${row.label} | ${row.score} | ${row.evidence} | ${row.source} / ${"fromCompany" in row && row.fromCompany ? COMPANY_FILE : HIRING_FILE} |`),
  ]
  const section = [
    `# Score: ${name} → ${req.title}`,
    "",
    "## Summary",
    `- Recommendation: ${recommendation}`,
    `- One-line rationale: ${rationale}`,
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
  return { ...card, score: overall, body: upsertSection(card.body, "Score", section) }
}

function drafted(card: Card, req: ReturnType<typeof parseReq>, packet: string) {
  const source = path.relative(packet, CandidateCard.filePath(packet, card.id)).replaceAll(path.sep, "/")
  const name = card.extra.name || card.id
  const first = name.split(/\s+/)[0] ?? name
  const hook = quoteFor(card, tokens(`${card.extra.name ?? ""} ${req.title}`)) ?? quoteFor(card, tokens(card.body))
  const where = req.location ? ` (${req.location})` : ""
  const who = req.company ? `${req.company} is hiring` : "We're hiring"
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
    `Hi ${first},`,
    "",
    hook ? `${who} a ${req.title}${where}. Your card notes: "${hook}"` : `${who} a ${req.title}${where}.`,
    ...(req.companyBar.length ? ["", `We hire against: ${req.companyBar.join(", ")}.`] : []),
    ...(req.tone.length ? ["", req.tone[0]] : []),
    "",
    "Would you be open to a short conversation about the role?",
    "",
    "## LinkedIn",
    `Hi ${first} — ${who.toLowerCase()} a ${req.title}${where}. Open to a quick chat?`,
    "",
    "## Personalization hooks",
    hook ? `- "${hook}" (${source})` : `- No extra facts on ${source} beyond the name`,
    `- Role title from ${HIRING_FILE}: ${req.title}`,
    ...(req.companyBar.length ? [`- Company bar from ${COMPANY_FILE}: ${req.companyBar.join("; ")}`] : []),
    ...(req.tone.length ? [`- Tone from ${COMPANY_FILE}: ${req.tone.join("; ")}`] : []),
    ...(req.about.length ? [`- About from ${COMPANY_FILE}: ${req.about.join("; ")}`] : []),
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

export * as CardWrite from "./card-write"
