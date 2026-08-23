import { spawn } from "node:child_process"
import path from "node:path"

export type DecisionCliResult = {
  code: number
  stdout: string
  stderr: string
  json: unknown
}

export type ChangesetRow = {
  id?: string
  status?: string
  rationale?: string
  created_at?: number
  author_id?: string
  author_kind?: string
  reviewed_by?: string | null
  dry_run?: boolean
  adverse?: boolean
  // leftover receipt fields — still accepted if an older payload appears
  verb?: string
  action?: string
  state?: string
  reason?: string
  commit_id?: string
  target?: { kind?: string; id?: string }
  meta?: { score?: unknown }
}

/** @deprecated Use ChangesetRow. Ledger changesets replaced receipts. */
export type ReceiptRow = ChangesetRow

export type LedgerCounts = {
  staged: number
  approved: number
}

export function resolveMoksCommand(): { command: string; prefix: string[] } {
  if (process.env.MOKS_BIN) return { command: process.env.MOKS_BIN, prefix: [] }
  const base = path.basename(process.execPath).toLowerCase()
  if (base === "moks" || base === "moks.exe") return { command: process.execPath, prefix: [] }
  const entry = process.env.MOKS_ENTRY
  if (entry) return { command: process.execPath, prefix: [entry] }
  return { command: "moks", prefix: [] }
}

export async function runDecision(args: string[], opts?: { cwd?: string }): Promise<DecisionCliResult> {
  const bin = resolveMoksCommand()
  const full = [...bin.prefix, ...(args.includes("--json") ? args : [...args, "--json"])]

  return new Promise((resolve, reject) => {
    const child = spawn(bin.command, full, {
      cwd: opts?.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8")
      const stderr = Buffer.concat(err).toString("utf8")
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        json: parseJson(stdout),
      })
    })
  })
}

export function needsConfirm(json: unknown) {
  if (!json || typeof json !== "object") return false
  const row = json as Record<string, unknown>
  if (row.error === "needs_confirm") return true
  if (row.code === "needs_confirm") return true
  if (row.needs_confirm === true) return true
  if (row.status === "needs_confirm") return true
  if (row.outcome === "needs_confirm") return true
  if (row.result === "needs_confirm") return true
  if (row.receipt && typeof row.receipt === "object") {
    const receipt = row.receipt as Record<string, unknown>
    if (receipt.state === "needs_confirm") return true
  }
  return false
}

export function confirmMessage(json: unknown) {
  if (!json || typeof json !== "object") return "This decision requires confirmation before push."
  const row = json as Record<string, unknown>
  if (typeof row.message === "string" && row.message.trim()) return row.message.trim()
  if (typeof row.reason === "string" && row.reason.trim()) return row.reason.trim()
  return "This decision requires confirmation before push."
}

export function receiptId(json: unknown) {
  if (!json || typeof json !== "object") return
  const row = json as Record<string, unknown>
  for (const key of ["id", "receipt_id", "commit_id", "receiptId", "commitId"]) {
    const value = row[key]
    if (typeof value === "string" && value) return value
  }
  if (row.changeset && typeof row.changeset === "object") {
    const changeset = row.changeset as Record<string, unknown>
    if (typeof changeset.id === "string" && changeset.id) return changeset.id
  }
  if (row.receipt && typeof row.receipt === "object") {
    const receipt = row.receipt as Record<string, unknown>
    if (typeof receipt.id === "string" && receipt.id) return receipt.id
  }
  return
}

export function statusOpen(json: unknown): ChangesetRow[] {
  if (!json || typeof json !== "object") return []
  const open = (json as { open?: unknown }).open
  if (!Array.isArray(open)) return []
  return open.filter((row): row is ChangesetRow => isChangesetRow(row))
}

export function statusByStatus(json: unknown, status: string): ChangesetRow[] {
  return statusOpen(json).filter((row) => row.status === status)
}

export function ledgerCounts(json: unknown): LedgerCounts | undefined {
  if (!json || typeof json !== "object") return
  const report = (json as { report?: unknown }).report
  if (report && typeof report === "object") {
    const changesets = (report as { changesets?: unknown }).changesets
    if (changesets && typeof changesets === "object") {
      const row = changesets as Record<string, unknown>
      if (typeof row.staged === "number" && typeof row.approved === "number") {
        return { staged: row.staged, approved: row.approved }
      }
    }
  }
  const open = statusOpen(json)
  if (!Array.isArray((json as { open?: unknown }).open)) return
  let staged = 0
  let approved = 0
  for (const row of open) {
    if (row.status === "staged") staged++
    if (row.status === "approved") approved++
  }
  return { staged, approved }
}

export function formatDecisionResult(result: DecisionCliResult) {
  const text = formatDecisionJson(result.json)
  if (text) return text
  const fallback = (result.stderr || result.stdout).trim()
  if (fallback) return fallback
  return `moks exited with code ${result.code}`
}

export function isDryRun(json: unknown) {
  if (!json || typeof json !== "object") return true
  const row = json as Record<string, unknown>
  if (row.dry_run === false) return false
  if (row.receipt && typeof row.receipt === "object") {
    const receipt = row.receipt as Record<string, unknown>
    if (receipt.dry_run === false) return false
  }
  return true
}

export function formatDecisionJson(json: unknown) {
  if (json == null || typeof json !== "object") return
  const row = json as Record<string, unknown>
  if (Array.isArray(row.open) || Array.isArray(row.changesets) || Array.isArray(row.receipts) || Array.isArray(row.commits)) {
    return formatStatus(row)
  }
  if (row.ok === true && Array.isArray(row.pushed)) return formatPush(row)
  if (typeof row.error === "string") {
    if (typeof row.message === "string" && row.message.trim()) return row.message.trim()
    return row.error
  }
  const changeset = changesetFrom(row)
  if (!changeset.id && !changeset.status && !changeset.action && !changeset.verb) return
  return formatReceipt(changeset, typeof row.message === "string" ? row.message : undefined)
}

export function pushCommandArgs(input: { id: string; execute: boolean; confirm?: boolean }) {
  const args = ["push", "--json", "--commit-id", input.id]
  if (input.execute) args.push("--execute")
  if (input.confirm) args.push("--confirm")
  return args
}

export function reviewCommandArgs(input: { id: string; action: "approve" | "reject"; by: string; reason?: string; excerpt?: string }) {
  const args = ["review", input.id, input.action === "approve" ? "--approve" : "--reject", "--by", input.by, "--json"]
  if (input.action === "reject" && input.reason?.trim()) args.push("--reason", input.reason.trim())
  if (input.action === "approve" && input.excerpt?.trim()) args.push("--excerpt", input.excerpt.trim())
  return args
}

export function pushToastMessage(input: { ok: boolean; dryRun: boolean }) {
  if (!input.ok) return "Push failed"
  if (input.dryRun) return "Dry-run — no ATS write"
  return "Pushed to ATS"
}

export function commitToastMessage(input: { ok: boolean; id?: string; target?: string }) {
  if (!input.ok) return "Commit failed"
  if (input.id && input.target) return `Staged ${input.id} (${input.target})`
  if (input.id) return `Staged ${input.id}`
  if (input.target) return `Staged ${input.target}`
  return "Staged changeset"
}

export function reviewToastMessage(input: { ok: boolean; action: "approve" | "reject"; id?: string }) {
  if (!input.ok) return "Review failed"
  const verb = input.action === "approve" ? "Approved" : "Rejected"
  return input.id ? `${verb} ${input.id}` : verb
}

function formatStatus(row: Record<string, unknown>) {
  const open = Array.isArray(row.open) ? row.open.filter((item) => isChangesetRow(item)) : []
  const listed = Array.isArray(row.changesets)
    ? row.changesets.filter((item) => isChangesetRow(item))
    : Array.isArray(row.commits)
      ? row.commits.filter((item) => isChangesetRow(item))
      : Array.isArray(row.receipts)
        ? row.receipts.filter((item) => isChangesetRow(item))
        : []
  const lines = ["Open changesets"]
  if (open.length === 0) lines.push("  (none)")
  for (const item of open) lines.push(`  ${formatReceiptLine(item)}`)
  lines.push("", "Changesets")
  if (listed.length === 0) lines.push("  (none)")
  for (const item of listed) lines.push(`  ${formatReceiptLine(item)}`)
  return lines.join("\n")
}

function formatPush(row: Record<string, unknown>) {
  const lines = [row.dry_run === false ? "Pushed to ATS" : "Dry-run — no ATS write"]
  const pushed = Array.isArray(row.pushed) ? row.pushed : []
  for (const item of pushed) {
    if (!isChangesetRow(item)) continue
    lines.push(`  ${formatReceiptLine(item)}`)
  }
  if (typeof row.path === "string" && row.path) lines.push(row.path)
  return lines.join("\n")
}

function formatReceipt(row: ChangesetRow, message?: string) {
  const lines = [formatReceiptLine(row)]
  if (row.rationale) lines.push(`rationale  ${row.rationale}`)
  else if (row.reason) lines.push(`reason  ${row.reason}`)
  if (message) lines.push(message)
  return lines.join("\n")
}

export function formatReceiptLine(row: ChangesetRow) {
  return [row.id ?? "(no id)", row.status ?? row.state, firstLine(row.rationale ?? row.reason)].filter((part) => part).join("  ")
}

function changesetFrom(row: Record<string, unknown>): ChangesetRow {
  if (row.changeset && typeof row.changeset === "object") return row.changeset as ChangesetRow
  if (row.receipt && typeof row.receipt === "object") return row.receipt as ChangesetRow
  return row as ChangesetRow
}

function isChangesetRow(value: unknown): value is ChangesetRow {
  return !!value && typeof value === "object"
}

function firstLine(text?: string) {
  if (!text) return
  const line = text.split("\n")[0]?.trim()
  return line || undefined
}

function parseJson(stdout: string) {
  const trimmed = stdout.trim()
  if (!trimmed) return
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }
  const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return
  try {
    return JSON.parse(match[0]!)
  } catch {
    return
  }
}
