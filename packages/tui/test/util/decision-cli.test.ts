import { describe, expect, test } from "bun:test"
import {
  commitToastMessage,
  formatDecisionJson,
  formatReceiptLine,
  isDryRun,
  ledgerCounts,
  needsConfirm,
  pushCommandArgs,
  pushToastMessage,
  receiptId,
  reviewCommandArgs,
  reviewToastMessage,
  statusByStatus,
  statusOpen,
} from "../../src/util/decision-cli"

const statusJson = {
  report: {
    changesets: { staged: 2, approved: 1, stale: 0, applied: 4, rejected: 0 },
  },
  open: [
    { id: "cs_staged_1", status: "staged", rationale: "screen Priya\nmore" },
    { id: "cs_staged_2", status: "staged", rationale: "note on Jordan" },
    { id: "cs_approved_1", status: "approved", rationale: "advance Maya" },
  ],
  changesets: [
    { id: "cs_staged_1", status: "staged", rationale: "screen Priya" },
    { id: "cs_applied_1", status: "applied", rationale: "offer terms" },
  ],
  path: "/tmp/fixture",
}

describe("decision-cli ledger parsers", () => {
  test("statusOpen reads open as changesets, not receipts", () => {
    const open = statusOpen(statusJson)
    expect(open.map((row) => ({ id: row.id, status: row.status }))).toEqual([
      { id: "cs_staged_1", status: "staged" },
      { id: "cs_staged_2", status: "staged" },
      { id: "cs_approved_1", status: "approved" },
    ])
    expect(open.every((row) => row.verb === undefined && row.state === undefined)).toBe(true)
  })

  test("statusByStatus splits staged vs approved", () => {
    expect(statusByStatus(statusJson, "staged").map((row) => row.id)).toEqual(["cs_staged_1", "cs_staged_2"])
    expect(statusByStatus(statusJson, "approved").map((row) => row.id)).toEqual(["cs_approved_1"])
  })

  test("receiptId finds changeset.id on commit/review JSON", () => {
    expect(receiptId({ changeset: { id: "cs_new", status: "staged" }, path: "/tmp", adverse: false })).toBe("cs_new")
    expect(receiptId({ id: "top-level" })).toBe("top-level")
    expect(receiptId({ receipt: { id: "legacy" } })).toBe("legacy")
  })

  test("formatReceiptLine shows changeset id, status, and rationale", () => {
    expect(
      formatReceiptLine({ id: "cs_staged_1", status: "staged", rationale: "screen Priya\nmore" }),
    ).toBe("cs_staged_1  staged  screen Priya")
    expect(formatReceiptLine({ id: "cs_approved_1", status: "approved" })).toBe("cs_approved_1  approved")
  })

  test("formatDecisionJson lists open changesets from status JSON", () => {
    const text = formatDecisionJson(statusJson)
    expect(text).toContain("Open changesets")
    expect(text).toContain("cs_staged_1  staged  screen Priya")
    expect(text).toContain("cs_applied_1  applied  offer terms")
    expect(text).not.toContain("dry-run")
    expect(text).not.toContain("execute")
  })

  test("formatDecisionJson formats commit/review changeset payloads", () => {
    expect(
      formatDecisionJson({
        changeset: { id: "cs_new", status: "staged", rationale: "note" },
        path: "/tmp",
        adverse: false,
      }),
    ).toBe("cs_new  staged  note\nrationale  note")
  })

  test("ledgerCounts prefers report.changesets over filtering open", () => {
    expect(ledgerCounts(statusJson)).toEqual({ staged: 2, approved: 1 })
  })

  test("ledgerCounts falls back to open statuses when report is missing", () => {
    expect(ledgerCounts({ open: statusJson.open })).toEqual({ staged: 2, approved: 1 })
  })

  test("isDryRun stays true unless dry_run is exactly false", () => {
    expect(isDryRun({ ok: true, dry_run: true, pushed: [] })).toBe(true)
    expect(isDryRun({ ok: true, dry_run: false, pushed: [] })).toBe(false)
    expect(isDryRun({ ok: true })).toBe(true)
  })

  test("needsConfirm reads push error: needs_confirm", () => {
    expect(needsConfirm({ error: "needs_confirm", message: "adverse action requires --confirm", path: "/tmp" })).toBe(
      true,
    )
    expect(needsConfirm({ ok: true, dry_run: true })).toBe(false)
  })
})

describe("decision-cli push/review args and toasts", () => {
  test("dry-run push omits --execute", () => {
    expect(pushCommandArgs({ id: "cs_approved_1", execute: false })).toEqual([
      "push",
      "--json",
      "--commit-id",
      "cs_approved_1",
    ])
  })

  test("execute path passes --execute and optional --confirm", () => {
    expect(pushCommandArgs({ id: "cs_approved_1", execute: true })).toEqual([
      "push",
      "--json",
      "--commit-id",
      "cs_approved_1",
      "--execute",
    ])
    expect(pushCommandArgs({ id: "cs_approved_1", execute: true, confirm: true })).toEqual([
      "push",
      "--json",
      "--commit-id",
      "cs_approved_1",
      "--execute",
      "--confirm",
    ])
  })

  test("dry-run toast is not Pushed", () => {
    expect(pushToastMessage({ ok: true, dryRun: true })).toBe("Dry-run — no ATS write")
    expect(pushToastMessage({ ok: true, dryRun: true })).not.toContain("Pushed")
    expect(pushToastMessage({ ok: true, dryRun: false })).toBe("Pushed to ATS")
    expect(pushToastMessage({ ok: false, dryRun: true })).toBe("Push failed")
  })

  test("commit toast says Staged, not Committed", () => {
    expect(commitToastMessage({ ok: true, id: "cs_new", target: "priya" })).toBe("Staged cs_new (priya)")
    expect(commitToastMessage({ ok: true, id: "cs_new" })).toBe("Staged cs_new")
    expect(commitToastMessage({ ok: true, id: "cs_new" })).not.toContain("Committed")
  })

  test("review args call moks review --approve|--reject --by", () => {
    expect(reviewCommandArgs({ id: "cs_staged_1", action: "approve", by: "artemys" })).toEqual([
      "review",
      "cs_staged_1",
      "--approve",
      "--by",
      "artemys",
      "--json",
    ])
    expect(reviewCommandArgs({ id: "cs_staged_1", action: "reject", by: "artemys" })).toEqual([
      "review",
      "cs_staged_1",
      "--reject",
      "--by",
      "artemys",
      "--json",
    ])
  })

  test("review toast names the action and id", () => {
    expect(reviewToastMessage({ ok: true, action: "approve", id: "cs_staged_1" })).toBe("Approved cs_staged_1")
    expect(reviewToastMessage({ ok: true, action: "reject", id: "cs_staged_1" })).toBe("Rejected cs_staged_1")
  })

  test("push result copy distinguishes dry-run from applied ledger state", () => {
    expect(
      formatDecisionJson({
        ok: true,
        dry_run: true,
        pushed: [{ id: "cs_approved_1", status: "approved" }],
        path: "/tmp/fixture",
      }),
    ).toContain("Dry-run — no ATS write")
    expect(
      formatDecisionJson({
        ok: true,
        dry_run: false,
        pushed: [{ id: "cs_approved_1", status: "applied" }],
        path: "/tmp/fixture",
      }),
    ).toBe("Pushed to ATS\n  cs_approved_1  applied\n/tmp/fixture")
  })
})
