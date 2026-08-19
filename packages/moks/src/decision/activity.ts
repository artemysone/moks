import { activityRows } from "./verbs"

export type ActivitySummary = {
  days: number
  path: string
  commits: number
  pushes: number
  needs_confirm: number
  adverse_commits: number
  active_days: number
  open_commits: number
  signal: "active" | "quiet"
  real_req_note: string
}

const REAL_REQ_NOTE = "Ledger history does not prove a live ATS req; confirm in the TUI."

export async function summarizeActivity(
  input: {
    days?: number
    cwd?: string
    now?: Date
  } = {},
): Promise<ActivitySummary> {
  const days = input.days ?? 7
  const now = input.now ?? new Date()
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  const { path: company, rows } = await activityRows({ cwd: input.cwd, days, now })
  const windowed = rows.filter((row) => row.ts >= cutoff && row.ts <= now.getTime())
  const commits = windowed.length
  const pushes = windowed.filter((row) => row.status === "applied").length
  const needs_confirm = windowed.filter((row) => row.status === "staged" && row.adverse).length
  const adverse_commits = windowed.filter((row) => row.adverse).length
  const active_days = new Set(windowed.map((row) => new Date(row.ts).toISOString().slice(0, 10))).size
  const open_commits = rows.filter((row) => row.status === "staged" || row.status === "approved").length
  return {
    days,
    path: company,
    commits,
    pushes,
    needs_confirm,
    adverse_commits,
    active_days,
    open_commits,
    signal: commits > 0 ? "active" : "quiet",
    real_req_note: REAL_REQ_NOTE,
  }
}

export * as DecisionActivity from "./activity"
