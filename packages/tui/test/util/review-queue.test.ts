import { describe, expect, test } from "bun:test"
import {
  defaultTuiAgent,
  formatQueueLine,
  inspectReviewCommandArgs,
  listReviewCommandArgs,
  matchSlashCommand,
  parseInspectReview,
  parseStagedReviews,
  reviewDecisionArgs,
  tuiLanding,
} from "../../src/util/review-queue"

const listed = {
  rows: [
    { id: "cs_1", action: "note", target: "priya-shah", rationale: "screen Priya", status: "staged" },
    { id: "cs_2", action: "advance", target: "jordan-lee", rationale: "ready for screen", status: "staged" },
  ],
  path: "/tmp/company",
}

const inspected = {
  changeset: {
    id: "cs_1",
    status: "staged",
    rationale: "screen Priya\nmore",
    changes: [{ mutation: "AddNote", entity_ref: "priya-shah", payload: { body: "strong systems" } }],
  },
  cards: [{ id: "priya-shah", stage: "screen", score: 4 }],
  path: "/tmp/company",
}

describe("TUI landing", () => {
  test("company folder is recruit composer, not a verb splash", () => {
    expect(tuiLanding({ headless: false, liveCompany: true, leftoverOrEmpty: false })).toBe("composer-recruit")
    expect(defaultTuiAgent(undefined)).toBe("recruit")
    expect(defaultTuiAgent("plan")).toBe("plan")
  })

  test("leftover-ledger and empty-cwd stay fail-loud for headless", () => {
    expect(tuiLanding({ headless: true, liveCompany: false, leftoverOrEmpty: true })).toBe("fail-loud")
    expect(tuiLanding({ headless: false, liveCompany: true, leftoverOrEmpty: false })).not.toBe("fail-loud")
  })
})

describe("review queue + taste surface", () => {
  test("parses listStagedReviews JSON into the right-hand queue", () => {
    const rows = parseStagedReviews(listed)
    expect(rows.map((row) => row.id)).toEqual(["cs_1", "cs_2"])
    expect(formatQueueLine(rows[0])).toBe("cs_1  note  priya-shah  screen Priya")
  })

  test("inspectReview JSON is what/why/bless — no merge or push", () => {
    const taste = parseInspectReview(inspected)
    expect(taste?.what).toContain("AddNote  priya-shah  strong systems")
    expect(taste?.what).toContain("card  priya-shah  stage=screen  score=4")
    expect(taste?.why).toContain("screen Priya")
    expect(taste?.bless).toContain("not apply, not push")
    expect(taste?.bless).not.toMatch(/\bmerge\b/i)
  })

  test("/review reuses list + inspect + approve/reject only", () => {
    expect(listReviewCommandArgs()).toEqual(["review", "--json"])
    expect(inspectReviewCommandArgs("cs_1")).toEqual(["review", "cs_1", "--json"])
    const approve = reviewDecisionArgs({ id: "cs_1", action: "approve", by: "reviewer" })
    expect(approve).toEqual(["review", "cs_1", "--approve", "--by", "reviewer", "--json"])
    expect(approve.join(" ")).not.toContain("push")
    expect(approve.join(" ")).not.toContain("merge")
    expect(reviewDecisionArgs({ id: "cs_1", action: "reject", by: "reviewer" })).toContain("--reject")
  })

  test("composer /review is the local pane slash, not a second app", () => {
    const hit = matchSlashCommand("/review", [
      { display: "/review", aliases: [] },
      { display: "/commit", aliases: [] },
    ])
    expect(hit?.display).toBe("/review")
    expect(matchSlashCommand("work this candidate", [{ display: "/review" }])).toBeUndefined()
  })
})
