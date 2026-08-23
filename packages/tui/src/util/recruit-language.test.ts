import { expect, test } from "bun:test"
import { isPileAsk, isRecruitLanguage, isSendAsk, isWorkAsk, isWriteAsk, recruitLanguageArgs, recruitLanguageToast } from "./recruit-language"

test("recruit language is pile / get-ready / draft, not a question", () => {
  expect(isPileAsk("add Maya Chen and Kenji Sato")).toBe(true)
  expect(isPileAsk("Maya Chen, Kenji Sato")).toBe(true)
  expect(isPileAsk("", ["/tmp/maya.pdf"])).toBe(true)
  expect(isWorkAsk("get Maya ready")).toBe(true)
  expect(isWorkAsk("get Maya ready for review")).toBe(true)
  expect(isWriteAsk("draft outreach for Maya")).toBe(true)
  expect(isSendAsk("send this to Maya")).toBe(true)
  expect(isRecruitLanguage("who is the hiring manager")).toBe(false)
  expect(isWorkAsk("send this to Maya")).toBe(false)
})

test("recruit language args stay on run --agent recruit", () => {
  expect(recruitLanguageArgs("get Maya ready")).toEqual(["run", "--agent", "recruit", "--", "get Maya ready"])
  expect(recruitLanguageArgs("add these", ["/tmp/a.pdf"])).toEqual([
    "run",
    "--agent",
    "recruit",
    "--file",
    "/tmp/a.pdf",
    "--",
    "add these",
  ])
})

test("toast prefers the first honest line", () => {
  expect(recruitLanguageToast({ ok: false, stdout: "", stderr: "Draft only. Never sent." })).toContain("Draft only")
  expect(recruitLanguageToast({ ok: true, stdout: "ready: maya-chen scored and drafted", stderr: "" })).toContain("maya-chen")
})
