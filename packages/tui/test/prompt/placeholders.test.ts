import { describe, expect, test } from "bun:test"
import { DEFAULT_PLACEHOLDERS, placeholdersFor } from "../../src/component/prompt/placeholders"

describe("prompt placeholders", () => {
  test("defaults to recruit language, not a verb menu", () => {
    expect(DEFAULT_PLACEHOLDERS.normal).toEqual(["add Maya Chen and Kenji Sato", "get Maya ready", "taste with /review"])
    expect(DEFAULT_PLACEHOLDERS.shell).toEqual(["ls candidates", "pwd"])
  })

  test("points at /open-req until cards exist, plus a pile ask", () => {
    expect(placeholdersFor({ cards: 0 })).toEqual(["Open a req with /open-req", "add Maya Chen and Kenji Sato"])
    expect(placeholdersFor({})).toEqual(["Open a req with /open-req", "add Maya Chen and Kenji Sato"])
    for (const text of placeholdersFor({ cards: 0 })) {
      expect(text).not.toMatch(/score-candidate|draft-outreach|moks commit/i)
    }
  })

  test("offers the full set once cards exist", () => {
    expect(placeholdersFor({ cards: 5 })).toEqual(DEFAULT_PLACEHOLDERS.normal)
  })

  test("focused session placeholder is the next step, not /open-req", () => {
    expect(placeholdersFor({ focused: "staff-platform", next: "review cs_1", cards: 0 })).toEqual(["review cs_1"])
    expect(placeholdersFor({ focused: "staff-platform", next: "score leftover on staff-platform" })[0]).not.toMatch(
      /open-req/,
    )
  })
})
