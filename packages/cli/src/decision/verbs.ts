import path from "path"
import { CandidateCard } from "@/product/candidate-card"
import { ReqWorkspace } from "@/product/req-workspace"
import { CandidateAdd } from "@/product/candidate-add"
import { requireCompanyDirectory, requireOpenedHiringDir, withLedger, type LedgerHandle } from "./session"
import { HiringSession } from "@/product/hiring-session"

export type CommitChange = {
  entity_type: string
  entity_ref: string
  mutation: string
  effect_class?: string
  payload?: unknown
}

export type CommitInput = {
  rationale?: string
  action?: string
  target?: { kind?: string; id?: string }
  reason?: string
  mutation?: string
  entity?: string
  to?: string
  body?: string
  tag?: string
  terms?: string
  changes?: CommitChange[]
  author_id?: string
  author_kind?: "human" | "agent"
  source?: string
  cwd?: string
  meta?: unknown
}

export type PushInput = {
  id?: string
  dry_run?: boolean
  confirm?: boolean
  source?: string
  cwd?: string
}

export type ReviewInput = {
  id: string
  action: "approve" | "reject"
  by: string
  reason?: string
  excerpt?: string
  cwd?: string
}

export type LogDecision = {
  id: string
  action: string
  target: string
  status: string
  reason: string
  reviewed_by?: string | null
  line: string
}

export type LogResult = {
  decisions: LogDecision[]
  lines: string[]
  next?: string
  focused?: string | null
  path: string
  compliance?: unknown
}

const ADVERSE_MUTATIONS = new Set(["Reject", "ExtendOffer"])
const ACTION_MUTATION: Record<string, string> = {
  note: "AddNote",
  addnote: "AddNote",
  reject: "Reject",
  withdraw: "Withdraw",
  offer: "ExtendOffer",
  extendoffer: "ExtendOffer",
  hire: "AdvanceStage",
  advance: "AdvanceStage",
  advancestage: "AdvanceStage",
  tag: "AddTag",
  addtag: "AddTag",
  outreach: "SendOutreach",
  sendoutreach: "SendOutreach",
}

export function isAdverseMutation(mutation: string, payload?: unknown) {
  if (ADVERSE_MUTATIONS.has(mutation)) return true
  if (mutation !== "AdvanceStage" || !payload || typeof payload !== "object" || Array.isArray(payload)) return false
  return (payload as { to?: unknown }).to === "Hired"
}

export function isAdverseAction(action: string) {
  const normalized = action.trim().toLowerCase()
  return normalized === "reject" || normalized === "offer" || normalized === "hire" || normalized === "extendoffer"
}

export function mutationForAction(action: string) {
  const trimmed = action.trim()
  const mapped = ACTION_MUTATION[trimmed.toLowerCase()]
  if (mapped) return mapped
  return trimmed
}

export function previewMutations(input: {
  action?: string
  mutation?: string
  entity?: string
  changes?: CommitChange[]
}) {
  if (input.changes && input.changes.length > 0) return input.changes.map((change) => change.mutation)
  if (input.mutation) return [input.mutation]
  if (input.action) return [mutationForAction(input.action)]
  return []
}

export function defaultAuthor() {
  return process.env.USER ?? process.env.LOGNAME ?? "human"
}

/** What the human/agent sees after staging. Taste, not a CLI cheat sheet. */
export const COMMIT_TASTE_NEXT = "Taste this on the review pane."

export async function pull(input: { cwd?: string } = {}) {
  await requireOpenedHiringDir(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const result = handle.api.pullMirror(handle.db, handle.adapter)
    const cards = await projectPulledCards(handle)
    await CandidateAdd.adoptLocalCards(handle)
    return { ...result, cards, path: handle.company }
  })
}

export async function status(input: { cwd?: string; id?: string; limit?: number } = {}) {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const report = handle.api.readStatus(handle.db)
    if (!report.ats) {
      throw new Error(
        `empty company at ${handle.company} — pass --cwd/--dir to the real company, then moks pull`,
      )
    }
    const listed = handle.api.listChangesets(handle.db)
    const filtered = listed.filter((row) => !input.id || row.id === input.id || row.id.startsWith(input.id))
    const limit = input.limit ?? 20
    const open = filtered.filter((row) => row.status === "staged" || row.status === "approved")
    const session = await HiringSession.loadSnapshot(input.cwd)
    return {
      report,
      open,
      session,
      changesets: filtered.slice(0, limit),
      path: handle.company,
    }
  })
}

export async function commit(input: CommitInput) {
  return withLedger(input.cwd, async (handle) => {
    try {
      return await commitWithHandle(handle, input)
    } catch (error) {
      throw new Error(explainCommitError(handle, input, error))
    }
  })
}

async function commitWithHandle(handle: LedgerHandle, input: CommitInput) {
  await CandidateAdd.adoptLocalCards(handle)
  const { api } = handle
  const filled = await fillCommitDefaults(handle, input)
  const changes = resolveChanges(handle, filled)
  if (changes.length === 0) throw new Error("nothing to commit")
  const rationale = (filled.rationale ?? filled.reason ?? filled.body ?? "").trim()
  if (!rationale) throw new Error("rationale is required")
  const authorKind = input.author_kind ?? (input.source === "tool" ? "agent" : "human")
  const changeset = api.commitChangeset(
    handle.db,
    handle.vault,
    {
      rationale,
      author_id: input.author_id ?? (authorKind === "agent" ? "agent" : defaultAuthor()),
      author_kind: authorKind,
      agent_meta: {
        source: input.source,
        req: handle.req ? path.relative(handle.company, handle.req) : null,
        action: input.action,
        ...(input.meta && typeof input.meta === "object" && !Array.isArray(input.meta) ? input.meta : {}),
      },
      changes,
    },
    { policy: handle.policy.policy, stages: handle.policy.stages },
  )
  await projectCard(handle, input, changeset.changes)
  const adverse = changeset.changes.some((change) => isAdverseMutation(change.mutation, change.payload))
  await HiringSession.refreshSnapshot(handle.company)
  return { changeset, path: handle.company, adverse, next: COMMIT_TASTE_NEXT }
}

const TERMINAL_STAGES = new Set(["Hired", "Rejected", "Withdrawn"])

function asciiCommitMessage(text: string) {
  return text.replaceAll("\u2192", "->")
}

export function explainCommitError(handle: LedgerHandle, input: CommitInput, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  const match = raw.match(/^illegal_transition:\s+(\S+)\s+(?:\u2192|->)\s+(\S+)$/)
  if (!match) return asciiCommitMessage(raw)
  const current = match[1] ?? "unknown"
  const wanted = match[2] ?? ""
  const targetId = input.target?.id ?? input.entity ?? "target"
  const mutation = input.mutation ?? (input.action ? mutationForAction(input.action) : undefined)
  const action = input.action ?? mutation ?? "change"
  if (mutation === "AdvanceStage" || action === "advance") {
    const next = legalNextFor(handle, targetId) ?? "none"
    return `cannot ${action} ${targetId}: ${wanted} is not a legal next stage from ${current} (legal next: ${next})`
  }
  const suggested = suggestRejectableTarget(handle, targetId, mutation)
  const lines = [`cannot ${action} ${targetId}: current stage is ${current}`]
  if (suggested) lines.push(`try --target-id ${suggested.id} (stage ${suggested.stage})`)
  return lines.join("\n")
}

function legalNextFor(handle: LedgerHandle, id: string) {
  const applications = handle.api.listApplications(handle.db)
  const row = applications.find((item) => item.candidateId === id || item.id === id)
  if (!row) return
  const from = handle.api.pendingAdvanceStage(handle.db, handle.vault, row.id, row.stage) ?? row.stage
  return nextOnReq(handle, from)
}

function suggestRejectableTarget(handle: LedgerHandle, failedId: string, mutation?: string) {
  const applications = handle.api.listApplications(handle.db)
  const rejectLike = mutation === "Reject" || mutation === "Withdraw" || !mutation
  const row = applications.find((item) => {
    if (item.candidateId === failedId || item.id === failedId) return false
    if (rejectLike) return !TERMINAL_STAGES.has(item.stage)
    return true
  })
  if (!row) return
  return { id: row.candidateId, stage: row.stage }
}

export async function diff(input: { cwd?: string; id?: string } = {}) {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const { api } = handle
    if (input.id) {
      return { diffs: [api.diffChangeset(handle.db, handle.vault, input.id)], path: handle.company }
    }
    const listed = api.listChangesets(handle.db)
    const diffs = listed
      .filter((row) => row.status === "staged" || row.status === "approved")
      .map((row) => api.diffChangeset(handle.db, handle.vault, row.id))
    return { diffs, path: handle.company }
  })
}

export async function listStagedReviews(input: { cwd?: string } = {}) {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const staged = handle.api.listChangesets(handle.db, "staged")
    const approved = handle.api.listChangesets(handle.db, "approved")
    const rows = [...staged, ...approved].map((row) => {
      const detail = handle.api.getChangeset(handle.db, handle.vault, row.id)
      const change = detail.changes[0]
      const meta = detail.agent_meta && typeof detail.agent_meta === "object" ? (detail.agent_meta as { action?: string }) : {}
      return {
        id: row.id,
        action: meta.action ?? change?.mutation ?? "change",
        target: change?.entity_ref ?? "",
        rationale: row.rationale.split(/\n/)[0] ?? "",
        status: row.status,
      }
    })
    return { rows, path: handle.company }
  })
}

export async function inspectReview(input: { cwd?: string; id: string }) {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    let changeset: ReturnType<typeof handle.api.getChangeset>
    try {
      changeset = handle.api.getChangeset(handle.db, handle.vault, input.id)
    } catch {
      const listed = handle.api.listChangesets(handle.db)
      const hit = listed.find((row) => row.id === input.id || row.id.startsWith(input.id))
      if (!hit) throw new Error(`changeset not found: ${input.id}`)
      changeset = handle.api.getChangeset(handle.db, handle.vault, hit.id)
    }
    const packet = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
    const cards = await Promise.all(
      changeset.changes.map(async (change) => {
        let id = change.entity_ref
        if (change.entity_type === "application") {
          const hit = handle.api.listApplications(handle.db).find((row) => row.id === change.entity_ref)
          if (hit) id = hit.candidateId
        }
        if (!packet) return { id, stage: undefined as string | undefined, score: undefined as number | undefined }
        const card = await CandidateCard.read(packet, id)
        return { id, stage: card?.stage, score: card?.score }
      }),
    )
    const excerpts = changeset.changes.map((change) => {
      const payload = change.payload && typeof change.payload === "object" ? (change.payload as Record<string, unknown>) : {}
      if (typeof payload.body === "string") return payload.body
      if (typeof payload.to === "string") return `${change.mutation} to ${payload.to}`
      return change.mutation
    })
    return { changeset, cards, excerpts, path: handle.company }
  })
}

export async function review(input: ReviewInput) {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const current = handle.api.getChangeset(handle.db, handle.vault, input.id)
    const reason = (input.reason ?? "").trim() || (input.action === "reject" ? current.rationale.trim() : "")
    if (input.action === "reject" && !reason) {
      throw new Error("review --reject needs --reason")
    }
    const excerpt = (input.excerpt ?? "").trim()
    if (excerpt && input.action !== "approve") {
      throw new Error("review --excerpt is only for --approve")
    }
    const changeset = handle.api.reviewChangeset(handle.db, handle.vault, input.id, {
      action: input.action,
      reviewer_id: input.by,
      reason: input.action === "reject" ? reason : undefined,
      excerpt: excerpt || undefined,
    })
    if (input.action === "reject") {
      await persistRejectReasonOnCards(handle, changeset, reason)
    }
    if (excerpt) {
      await persistExcerptOnCards(handle, changeset, excerpt)
    }
    await HiringSession.refreshSnapshot(handle.company)
    return { changeset, path: handle.company }
  })
}

export function explainRebaseError(id: string, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw === "rebase_not_stale") {
    return `cannot rebase ${id}: it is not stale (the ATS has not moved under it). Run moks status — review or push what is already open`
  }
  if (raw === "rebase_not_found" || raw === "changeset_not_found") {
    return `cannot rebase ${id}: no changeset with that id. Run moks status and copy a stale changeset id`
  }
  if (raw === "rebase_empty") {
    return `cannot rebase ${id}: nothing left that still applies. Run moks status; drop or recommit the change`
  }
  return raw
}

export async function rebase(input: { cwd?: string; id: string }) {
  return withLedger(input.cwd, async (handle) => {
    try {
      const result = handle.api.rebaseChangeset(handle.db, handle.vault, input.id, {
        policy: handle.policy.policy,
      })
      return { ...result, path: handle.company }
    } catch (error) {
      throw new Error(explainRebaseError(input.id, error))
    }
  })
}

export async function push(input: PushInput) {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const { api } = handle
    const dry_run = input.dry_run ?? true
    const id = input.id
    if (id) {
      let changeset: ReturnType<typeof api.getChangeset>
      try {
        changeset = api.getChangeset(handle.db, handle.vault, id)
      } catch (error) {
        return failPush(handle.company, "not_found", ledgerMessage(error, `changeset not found: ${id}`))
      }
      if (changeset.status === "applied") {
        return failPush(handle.company, "already_pushed", `changeset already applied: ${id}`)
      }
      if (changeset.status === "staged") {
        return failPush(handle.company, "review_required", `review changeset ${id} before push`)
      }
      if (changeset.status !== "approved") {
        return failPush(handle.company, "cannot_push", `cannot push: ${changeset.status}`)
      }
      const adverse = changeset.changes.some((change) => isAdverseMutation(change.mutation, change.payload))
      if (adverse && !input.confirm) {
        return failPush(handle.company, "needs_confirm", `adverse action requires --confirm`, true)
      }
      if (dry_run) {
        return {
          ok: true as const,
          dry_run: true,
          pushed: [{ id, status: "approved" as const }],
          path: handle.company,
          adverse,
        }
      }
      const result = api.pushApproved(handle.db, handle.adapter, handle.vault, id)
      api.refreshAfterPush(handle.db, handle.adapter, result)
      await projectPulledCards(handle)
      return { ok: true as const, dry_run: false, pushed: result.pushed, path: handle.company, adverse }
    }

    const approved = api.listChangesets(handle.db, "approved")
    if (approved.length === 0) {
      const staged = api.listChangesets(handle.db, "staged")
      if (staged.length > 0) {
        return failPush(
          handle.company,
          "review_required",
          `0 approved, ${staged.length} staged — review first`,
        )
      }
      return failPush(handle.company, "nothing_to_push", "nothing to push — there is no approved changeset. Review a staged one (moks review <id> --approve), then push")
    }
    const details = approved.map((row) => api.getChangeset(handle.db, handle.vault, row.id))
    const adverse = details.some((row) =>
      row.changes.some((change) => isAdverseMutation(change.mutation, change.payload)),
    )
    if (adverse && !input.confirm) {
      return failPush(handle.company, "needs_confirm", "adverse action requires --confirm", true)
    }
    if (dry_run) {
      return {
        ok: true as const,
        dry_run: true,
        pushed: approved.map((row) => ({ id: row.id, status: "approved" as const })),
        path: handle.company,
        adverse,
      }
    }
    const result = api.pushApproved(handle.db, handle.adapter, handle.vault)
    api.refreshAfterPush(handle.db, handle.adapter, result)
    await projectPulledCards(handle)
    return { ok: true as const, dry_run: false, pushed: result.pushed, path: handle.company, adverse }
  })
}

function reqSlugFromMeta(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return
  const req = (meta as { req?: unknown }).req
  if (typeof req !== "string") return
  const slug = path.basename(req.trim())
  if (!slug || slug === "." || slug === "..") return
  return slug
}

function focusedReqSlug(handle: LedgerHandle) {
  if (!handle.req) return
  const slug = path.basename(handle.req)
  if (!slug || slug === "." || handle.req === handle.company) return
  return slug
}

function logTargetId(handle: LedgerHandle, change: { entity_type: string; entity_ref: string } | undefined) {
  if (!change) return ""
  if (change.entity_type !== "application") return change.entity_ref
  const hit = handle.api.listApplications(handle.db).find((row) => row.id === change.entity_ref)
  return hit?.candidateId ?? change.entity_ref
}

function logReason(row: { rationale: string; agent_meta: unknown }) {
  const meta = row.agent_meta && typeof row.agent_meta === "object" && !Array.isArray(row.agent_meta)
    ? (row.agent_meta as { review_reason?: unknown })
    : {}
  const review = typeof meta.review_reason === "string" ? meta.review_reason.trim() : ""
  if (review) return review
  return (row.rationale.split(/\n/)[0] ?? "").trim()
}

export function formatDecisionLine(row: {
  action: string
  target: string
  status: string
  reason: string
  reviewed_by?: string | null
}) {
  const bless =
    row.status === "rejected"
      ? row.reviewed_by
        ? `rejected by ${row.reviewed_by}`
        : "rejected"
      : row.status === "approved" || row.status === "applied"
        ? row.reviewed_by
          ? `blessed by ${row.reviewed_by}`
          : row.status
        : row.status
  const reason = row.reason ? `  ${row.reason}` : ""
  return `${row.action}  ${row.target}  ${bless}${reason}`
}

export async function log(input: { cwd?: string; compliance?: boolean; limit?: number } = {}): Promise<LogResult> {
  await requireCompanyDirectory(input.cwd)
  return withLedger(input.cwd, async (handle) => {
    const { api } = handle
    if (input.compliance) {
      return { compliance: api.readComplianceLog(handle.db, handle.policy.hash), path: handle.company, decisions: [], lines: [] }
    }
    const focused = focusedReqSlug(handle)
    const listed = api.listChangesets(handle.db)
    const scoped = listed.filter((row) => {
      if (!focused) return true
      const slug = reqSlugFromMeta(row.agent_meta)
      return !slug || slug === focused
    })
    const limit = input.limit ?? 20
    const decisions = scoped.slice(0, limit).map((row) => {
      const detail = api.getChangeset(handle.db, handle.vault, row.id)
      const change = detail.changes[0]
      const meta =
        detail.agent_meta && typeof detail.agent_meta === "object" && !Array.isArray(detail.agent_meta)
          ? (detail.agent_meta as { action?: string; review_reason?: string })
          : {}
      const action = meta.action ?? change?.mutation ?? "change"
      const target = logTargetId(handle, change)
      const reason = logReason(detail)
      return {
        id: row.id,
        action,
        target,
        status: row.status,
        reason,
        reviewed_by: row.reviewed_by,
        line: formatDecisionLine({
          action,
          target,
          status: row.status,
          reason,
          reviewed_by: row.reviewed_by,
        }),
      }
    })
    const session = await HiringSession.loadSnapshot(input.cwd)
    return {
      decisions,
      lines: decisions.map((row) => row.line),
      next: session.next,
      focused: session.focused,
      path: handle.company,
    }
  })
}

export async function activityRows(input: { cwd?: string; days?: number; now?: Date } = {}) {
  const days = input.days ?? 7
  const { root: company } = await requireCompanyDirectory(input.cwd)
  const rows = await withLedger(input.cwd, (handle) => Promise.resolve(loadActivityRows(handle)))
  return { days, path: company, rows }
}

function loadActivityRows(handle: LedgerHandle) {
  return handle.api.listChangesets(handle.db).map((row) => {
    const detail = handle.api.getChangeset(handle.db, handle.vault, row.id)
    return {
      id: row.id,
      ts: row.created_at,
      status: row.status,
      rationale: row.rationale,
      adverse: detail.changes.some((change) => isAdverseMutation(change.mutation, change.payload)),
    }
  })
}


async function fillCommitDefaults(handle: LedgerHandle, input: CommitInput): Promise<CommitInput> {
  const mutation = input.mutation ?? (input.action ? mutationForAction(input.action) : undefined)
  if (mutation !== "AddNote") {
    return {
      ...input,
      rationale: input.rationale ?? input.reason ?? input.body,
    }
  }
  const note = input.body ?? input.reason ?? input.rationale ?? (await defaultNoteFromCard(handle, input))
  return {
    ...input,
    body: input.body ?? note,
    reason: input.reason ?? note,
    rationale: input.rationale ?? input.reason ?? input.body ?? note,
  }
}

async function defaultNoteFromCard(handle: LedgerHandle, input: CommitInput) {
  const id = input.target?.id
  if (!id || id.includes(":")) return
  const dir = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
  if (!dir) return `note on ${id}`
  const card = await CandidateCard.read(dir, id)
  if (!card) return `note on ${id}`
  const rejection = CandidateCard.readReason(card)
  if (rejection) return rejection
  const rationale = card.body.match(/One-line rationale:\s*(.+)/i)?.[1]?.trim()
  if (rationale) return rationale
  const recommendation = card.body.match(/Recommendation:\s*(.+)/i)?.[1]?.trim()
  if (recommendation) return `score ${card.score ?? "?"}: ${recommendation}`
  if (/^# Outreach\b/m.test(card.body)) return `draft outreach for ${card.extra.name || id} (not sent)`
  if (card.score !== undefined) return `score ${card.score} on ${id}`
  return `note on ${id}`
}

function resolveChanges(handle: LedgerHandle, input: CommitInput) {
  const { api } = handle
  const changes: Array<{
    entity_type: string
    entity_ref: string
    mutation: string
    effect_class: string
    payload: unknown
  }> = []

  for (const change of input.changes ?? []) {
    changes.push(normalizeChange(api, change))
  }

  const mutation = input.mutation ?? (input.action ? mutationForAction(input.action) : undefined)
  if (mutation) {
    if (!api.isMutation(mutation)) throw new Error(`unknown mutation: ${mutation}`)
    const target = resolveEntity(handle, input, mutation)
    changes.push(
      normalizeChange(api, {
        entity_type: target.entity_type,
        entity_ref: target.entity_ref,
        mutation,
        payload: payloadFor(handle, mutation, input, target.entity_ref),
      }),
    )
  }

  return changes
}

function normalizeChange(api: LedgerHandle["api"], change: CommitChange) {
  if (!api.isMutation(change.mutation)) throw new Error(`unknown mutation: ${change.mutation}`)
  return {
    entity_type: change.entity_type,
    entity_ref: change.entity_ref,
    mutation: change.mutation,
    effect_class: change.effect_class ?? api.MUTATION_EFFECT_CLASS[change.mutation],
    payload: change.payload ?? {},
  }
}

function parseEntity(value: string) {
  const split = value.indexOf(":")
  if (split <= 0) throw new Error("entity requires type:id (e.g. application:app_priya_142)")
  const entity_type = value.slice(0, split)
  const entity_ref = value.slice(split + 1)
  if (entity_type !== "job" && entity_type !== "candidate" && entity_type !== "application") {
    throw new Error(`unknown entity type: ${entity_type}`)
  }
  if (!entity_ref) throw new Error("entity requires type:id (e.g. application:app_priya_142)")
  return { entity_type, entity_ref }
}

function resolveEntity(handle: LedgerHandle, input: CommitInput, mutation: string) {
  if (input.entity) return parseEntity(input.entity)
  const id = input.target?.id
  if (!id) throw new Error("commit needs --entity or --target-id")
  if (id.includes(":")) return parseEntity(id)

  const applications = handle.api.listApplications(handle.db)
  const asApp = applications.find((row) => row.id === id)
  if (asApp) return { entity_type: "application" as const, entity_ref: asApp.id }
  const forCandidate = applications.find((row) => row.candidateId === id)
  if (forCandidate) {
    if (mutation === "AddNote" || mutation === "AddTag" || mutation === "SendOutreach") {
      return { entity_type: "candidate" as const, entity_ref: id }
    }
    return { entity_type: "application" as const, entity_ref: forCandidate.id }
  }
  const piled = handle.api.readMirrorEntity(handle.db, "candidate", id)
  if (piled && (mutation === "AddNote" || mutation === "AddTag" || mutation === "SendOutreach")) {
    return { entity_type: "candidate" as const, entity_ref: id }
  }
  throw new Error(`unknown entity: ${id} — run moks pull and check the id`)
}

function payloadFor(handle: LedgerHandle, mutation: string, input: CommitInput, entityRef: string) {
  if (mutation === "AdvanceStage") {
    const hire = input.action?.trim().toLowerCase() === "hire"
    if (hire) return { to: input.to ?? "Hired" }
    if (!input.to) {
      const next = nextStageFor(handle, entityRef)
      // Tool callers omit --to; hop the legal next stage. CLI argv still errors.
      if ((input.source === "tool" || input.source === "score" || input.source === "draft" || input.source === "run") && next) return { to: next }
      throw new Error(
        next ? `AdvanceStage requires --to (legal next: ${next})` : "AdvanceStage requires --to",
      )
    }
    return { to: input.to }
  }
  if (mutation === "AddNote") {
    const body = input.body ?? input.reason ?? input.rationale
    if (!body) throw new Error("AddNote requires --body or --reason")
    return { body }
  }
  if (mutation === "AddTag") {
    if (!input.tag) throw new Error("AddTag requires --tag")
    return { tag: input.tag }
  }
  if (mutation === "SendOutreach") {
    const body = input.body ?? input.reason ?? input.rationale
    if (!body) throw new Error("SendOutreach requires --body or --reason")
    return { body }
  }
  if (mutation === "ExtendOffer") {
    const terms = input.terms ?? input.reason ?? input.rationale
    if (!terms) throw new Error("ExtendOffer requires --terms or --reason")
    return { terms }
  }
  return {}
}

function nextStageFor(handle: LedgerHandle, entityRef: string) {
  const application = handle.api.listApplications(handle.db).find((row) => row.id === entityRef)
  if (!application) return
  const from = handle.api.pendingAdvanceStage(handle.db, handle.vault, application.id, application.stage) ?? application.stage
  return nextOnReq(handle, from)
}

function nextOnReq(handle: LedgerHandle, stage: string) {
  if (!handle.api.isStage(stage)) return undefined
  const path = handle.policy.stages
  if (path.length >= 2) return handle.api.nextStageOnPath(stage, path) ?? undefined
  return handle.api.nextStage(stage) ?? undefined
}

// The folder is the pile. Pull never invents people from the mock ATS.
// Existing cards take stage from the mirror; score/notes/body stay local.
async function projectPulledCards(handle: LedgerHandle) {
  const dir = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
  if (!dir) return { dir: null, created: [] as string[], updated: [] as string[] }
  const created: string[] = []
  const updated: string[] = []
  for (const listing of handle.api.listApplications(handle.db)) {
    const existing = await CandidateCard.read(dir, listing.candidateId)
    if (!existing) continue
    if (existing.stage === listing.stage) continue
    await CandidateCard.write(dir, { ...existing, stage: listing.stage })
    updated.push(listing.candidateId)
  }
  return { dir: path.relative(handle.company, path.join(dir, CandidateCard.CANDIDATES_DIR)), created, updated }
}

async function projectCard(
  handle: LedgerHandle,
  input: CommitInput,
  changes: Array<{ mutation: string; entity_ref: string; payload: unknown }>,
) {
  const id = input.target?.id
  if (!id || id.includes(":")) return
  const dir = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
  if (!dir) return

  const stage = stageFromChanges(changes)
  const rejectReason = rejectReasonFrom(input, changes)
  const existing = await CandidateCard.read(dir, id)
  if (!existing) {
    if (!stage && !rejectReason) return
    const created = CandidateCard.parse(CandidateCard.stub(id, { stage }))
    if (!created) throw new Error(`failed to create candidate card: ${id}`)
    const next = rejectReason ? CandidateCard.persistReason({ ...created, stage: stage ?? created.stage }, rejectReason) : created
    await CandidateCard.write(dir, next)
    return
  }
  let next = existing
  if (stage && stage !== existing.stage) next = { ...next, stage }
  if (rejectReason) next = CandidateCard.persistReason(next, rejectReason)
  if (next === existing) return
  await CandidateCard.write(dir, next)
}

// AdvanceStage stays on the changeset until apply/push. Card + status
// keep the applied/mirror stage so review can show the bless hop without
// rewriting the file.
function stageFromChanges(changes: Array<{ mutation: string; payload: unknown }>) {
  for (const change of changes) {
    if (change.mutation === "Reject") return "Rejected"
    if (change.mutation === "Withdraw") return "Withdrawn"
  }
}

function rejectReasonFrom(input: CommitInput, changes: Array<{ mutation: string }>) {
  if (!changes.some((change) => change.mutation === "Reject")) return
  const reason = (input.rationale ?? input.reason ?? input.body ?? "").trim()
  return reason || undefined
}

async function persistExcerptOnCards(
  handle: LedgerHandle,
  changeset: { changes: Array<{ mutation: string; entity_type: string; entity_ref: string }> },
  excerpt: string,
) {
  const dir = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
  if (!dir) return
  for (const change of changeset.changes) {
    if (change.mutation !== "AddNote" && change.mutation !== "SendOutreach") continue
    let id = change.entity_ref
    if (change.entity_type === "application") {
      const hit = handle.api.listApplications(handle.db).find((row) => row.id === change.entity_ref)
      if (hit) id = hit.candidateId
    }
    const existing = await CandidateCard.read(dir, id)
    if (!existing) continue
    const heading = change.mutation === "SendOutreach" || /^# Outreach\b/m.test(excerpt) ? "Outreach" : /^# Score\b/m.test(excerpt) ? "Score" : "Score"
    await CandidateCard.write(dir, { ...existing, body: upsertCardSection(existing.body, heading, excerpt) })
  }
}

function upsertCardSection(body: string, heading: string, section: string) {
  const block = section.trim() + "\n"
  const re = new RegExp(`(?:^|\\n)# ${heading}\\b[^\\n]*\\n[\\s\\S]*?(?=\\n# |$)`)
  if (re.test(body)) {
    return body.replace(re, (match) => `${match.startsWith("\n") ? "\n" : ""}${block}`)
  }
  return `${body.replace(/\s*$/, "\n\n")}${block}`
}

async function persistRejectReasonOnCards(
  handle: LedgerHandle,
  changeset: { changes: Array<{ entity_type: string; entity_ref: string }> },
  reason: string,
) {
  const dir = handle.req ?? ((await ReqWorkspace.isPacket(handle.company)) ? handle.company : undefined)
  if (!dir) return
  for (const change of changeset.changes) {
    let id = change.entity_ref
    if (change.entity_type === "application") {
      const hit = handle.api.listApplications(handle.db).find((row) => row.id === change.entity_ref)
      if (hit) id = hit.candidateId
    }
    const existing = await CandidateCard.read(dir, id)
    if (!existing) continue
    await CandidateCard.write(dir, CandidateCard.persistReason(existing, reason))
  }
}

function failPush(
  path: string,
  code: "needs_confirm" | "not_found" | "review_required" | "already_pushed" | "nothing_to_push" | "cannot_push",
  message: string,
  adverse = false,
) {
  return { ok: false as const, code, message, path, adverse }
}

function ledgerMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    if (error.message === "changeset_not_found") return fallback
    return error.message
  }
  return fallback
}

export * as DecisionVerbs from "./verbs"
