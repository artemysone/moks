import { reviewCommandArgs } from "./decision-cli"

export type StagedReviewRow = {
  id: string
  action: string
  target: string
  rationale: string
  status: string
}

export type InspectedChange = {
  mutation: string
  entity_ref: string
  extra?: string
}

export type InspectedCard = {
  id: string
  stage?: string
  score?: number
}

export type TasteSurface = {
  id: string
  status: string
  what: string[]
  why: string
  bless: string
}

export function defaultTuiAgent(agent?: string) {
  return agent?.trim() || "recruit"
}

export function tuiLanding(input: { headless: boolean; liveCompany: boolean; leftoverOrEmpty: boolean }) {
  if (input.headless && input.leftoverOrEmpty) return "fail-loud" as const
  if (input.liveCompany) return "composer-recruit" as const
  return "composer" as const
}

export function listReviewCommandArgs() {
  return ["review", "--json"]
}

export function inspectReviewCommandArgs(id: string) {
  return ["review", id, "--json"]
}

export function parseStagedReviews(json: unknown): StagedReviewRow[] {
  if (!json || typeof json !== "object") return []
  const rows = (json as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return []
    const item = row as Record<string, unknown>
    if (typeof item.id !== "string" || !item.id) return []
    return [
      {
        id: item.id,
        action: typeof item.action === "string" ? item.action : "change",
        target: typeof item.target === "string" ? item.target : "",
        rationale: typeof item.rationale === "string" ? item.rationale.split(/\n/)[0] ?? "" : "",
        status: typeof item.status === "string" ? item.status : "staged",
      },
    ]
  })
}

export function parseInspectReview(json: unknown): TasteSurface | undefined {
  if (!json || typeof json !== "object") return
  const changeset = (json as { changeset?: unknown }).changeset
  if (!changeset || typeof changeset !== "object") return
  const row = changeset as Record<string, unknown>
  if (typeof row.id !== "string" || !row.id) return
  const cards = Array.isArray((json as { cards?: unknown }).cards) ? ((json as { cards: unknown[] }).cards) : []
  const changes = Array.isArray(row.changes) ? row.changes : []
  const what: string[] = []
  for (const change of changes) {
    if (!change || typeof change !== "object") continue
    const item = change as Record<string, unknown>
    const mutation = typeof item.mutation === "string" ? item.mutation : "change"
    const entity = typeof item.entity_ref === "string" ? item.entity_ref : ""
    const payload = item.payload && typeof item.payload === "object" ? (item.payload as Record<string, unknown>) : {}
    const extra = typeof payload.body === "string" ? payload.body : typeof payload.to === "string" ? `to ${payload.to}` : ""
    what.push([mutation, entity, extra].filter(Boolean).join("  "))
  }
  for (const card of cards) {
    if (!card || typeof card !== "object") continue
    const item = card as Record<string, unknown>
    if (typeof item.id !== "string") continue
    const score = item.score === undefined ? "none" : String(item.score)
    what.push(`card  ${item.id}  stage=${typeof item.stage === "string" ? item.stage : "unknown"}  score=${score}`)
  }
  const why = typeof row.rationale === "string" ? row.rationale : ""
  const status = typeof row.status === "string" ? row.status : "staged"
  return {
    id: row.id,
    status,
    what: what.length > 0 ? what : ["(no changes)"],
    why,
    bless: status === "staged" ? "approve will bless this changeset (not apply, not push)" : `status ${status} — approve/reject only when staged`,
  }
}

export function formatQueueLine(row: StagedReviewRow) {
  return [row.id, row.action, row.target, row.rationale].filter(Boolean).join("  ")
}

export function reviewDecisionArgs(input: { id: string; action: "approve" | "reject"; by?: string }) {
  return reviewCommandArgs({
    id: input.id,
    action: input.action,
    by: input.by ?? process.env.USER ?? process.env.LOGNAME ?? "human",
  })
}

export function matchSlashCommand<T extends { display: string; aliases?: string[] }>(
  input: string,
  slashes: ReadonlyArray<T>,
): T | undefined {
  const token = input.trim().split(/\s/)[0] ?? ""
  if (!token.startsWith("/")) return
  return slashes.find((item) => item.display.trim() === token || item.aliases?.some((alias) => alias === token))
}
