import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { countCards, formatReqStatus, readReqTitle } from "../../src/component/prompt/req-status"
import { ledgerCounts } from "../../src/util/decision-cli"

describe("req-status", () => {
  test("reads the first HIRING.md H1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Senior Backend Engineer\n\n## Role\n")
    expect(await readReqTitle(dir)).toBe("Senior Backend Engineer")
  })

  test("falls back to the directory name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    expect(await readReqTitle(dir)).toBe(path.basename(dir))
  })

  test("counts candidate cards and skips .gitkeep", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    await mkdir(path.join(dir, "candidates"))
    await writeFile(path.join(dir, "candidates", "jordan-lee.md"), "")
    await writeFile(path.join(dir, "candidates", "alex.md"), "")
    await writeFile(path.join(dir, "candidates", ".gitkeep"), "")
    expect(await countCards(dir)).toBe(2)
  })

  test("counts cards from the focused req at a COMPANY.md root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    await writeFile(path.join(dir, "COMPANY.md"), "# Co\n")
    await mkdir(path.join(dir, ".moks"), { recursive: true })
    await writeFile(path.join(dir, ".moks", "focus"), "founding-engineer")
    await mkdir(path.join(dir, "founding-engineer", "candidates"), { recursive: true })
    await writeFile(path.join(dir, "founding-engineer", "HIRING.md"), "# Founding Engineer\n")
    await writeFile(path.join(dir, "founding-engineer", "candidates", "cand-jane.md"), "")
    expect(await countCards(dir)).toBe(1)
    expect(await readReqTitle(dir)).toBe("Founding Engineer")
  })

  test("formats staged and approved counts from the ledger", () => {
    expect(
      formatReqStatus({ title: "Senior Backend Engineer", cards: 3, staged: 2, approved: 1, agent: "recruit" }),
    ).toBe("Senior Backend Engineer · 3 cards · 2 staged · 1 approved · recruit")
    expect(formatReqStatus({ title: "Senior Backend Engineer", cards: 3, agent: "recruit" })).toBe(
      "Senior Backend Engineer · 3 cards · recruit",
    )
    expect(formatReqStatus({ title: "Senior Backend Engineer", cards: 1, staged: 0, approved: 0, agent: "recruit" })).toBe(
      "Senior Backend Engineer · 1 card · 0 staged · 0 approved · recruit",
    )
  })

  test("reads staged/approved from status --json report.changesets, not receipts", () => {
    expect(
      ledgerCounts({
        report: {
          changesets: { staged: 2, approved: 1, stale: 0, applied: 3, rejected: 0 },
        },
        open: [
          { id: "cs_1", status: "staged", rationale: "screen" },
          { id: "cs_2", status: "approved", rationale: "advance" },
        ],
        path: "/tmp/fixture",
      }),
    ).toEqual({ staged: 2, approved: 1 })
  })
})
