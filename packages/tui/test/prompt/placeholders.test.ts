import { describe, expect, test } from "bun:test"
import { DEFAULT_PLACEHOLDERS, placeholdersFor } from "../../src/component/prompt/placeholders"

describe("prompt placeholders", () => {
  test("defaults to the hiring composer examples", () => {
    expect(DEFAULT_PLACEHOLDERS.normal).toEqual([
      "Score this resume against the req",
      "Draft outreach for the shortlist",
      "Open a req with /open-req",
    ])
    expect(DEFAULT_PLACEHOLDERS.shell).toEqual(["moks status", "ls candidates", "pwd"])
  })

  test("points at /open-req until cards exist", () => {
    expect(placeholdersFor({ cards: 0 })).toEqual(["Open a req with /open-req"])
    expect(placeholdersFor({})).toEqual(["Open a req with /open-req"])
    for (const text of placeholdersFor({ cards: 0 })) {
      expect(text).not.toMatch(/score|outreach/i)
    }
  })

  test("offers the full set once cards exist", () => {
    expect(placeholdersFor({ cards: 5 })).toEqual(DEFAULT_PLACEHOLDERS.normal)
  })
})
