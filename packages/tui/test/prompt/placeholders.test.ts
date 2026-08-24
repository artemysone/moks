import { describe, expect, test } from "bun:test"
import { DEFAULT_PLACEHOLDERS, placeholdersFor } from "../../src/component/prompt/placeholders"

const SLASH_HOMEWORK = /\/[a-z]/i

describe("prompt placeholders", () => {
  test("defaults to recruit language, not a verb menu", () => {
    expect(DEFAULT_PLACEHOLDERS.normal).toEqual(["add names or files", "talk this candidate", "taste what's staged"])
    expect(DEFAULT_PLACEHOLDERS.shell).toEqual(["ls candidates", "pwd"])
    for (const text of [...DEFAULT_PLACEHOLDERS.normal, ...DEFAULT_PLACEHOLDERS.shell]) {
      expect(text).not.toMatch(SLASH_HOMEWORK)
      expect(text).not.toMatch(/score-candidate|score leftover|get (?:this candidate|Maya) ready/i)
    }
  })

  test("points at opening a req until cards exist, plus a pile ask", () => {
    expect(placeholdersFor({ cards: 0 })).toEqual(["open a req", "add names or files"])
    expect(placeholdersFor({})).toEqual(["open a req", "add names or files"])
    for (const text of placeholdersFor({ cards: 0 })) {
      expect(text).not.toMatch(/score-candidate|draft-outreach|moks commit/i)
      expect(text).not.toMatch(SLASH_HOMEWORK)
    }
  })

  test("offers the full set once cards exist", () => {
    expect(placeholdersFor({ cards: 5 })).toEqual(DEFAULT_PLACEHOLDERS.normal)
  })

  test("focused session placeholder is the next step, not a slash command", () => {
    expect(placeholdersFor({ focused: "staff-platform", next: "review leftover cards", cards: 0 })).toEqual([
      "review leftover cards",
    ])
    expect(placeholdersFor({ focused: "staff-platform", next: "talk leftover on staff-platform" })[0]).not.toMatch(
      SLASH_HOMEWORK,
    )
  })
})
