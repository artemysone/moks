import { expect, test } from "bun:test"
import path from "path"
import { CandidateAdd } from "../../src/product/candidate-add"
import { CandidateCard } from "../../src/product/candidate-card"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("parseAddIntent detects add-candidate command and prose", () => {
  expect(CandidateAdd.parseAddIntent("add-candidate", "sam-chen.md")).toEqual({ file: "sam-chen.md" })
  expect(CandidateAdd.parseAddIntent("add-candidate", "", [" /tmp/resume.md "])).toEqual({ file: "/tmp/resume.md" })
  expect(CandidateAdd.parseAddIntent(undefined, "Add candidate from resumes/sam-chen.md")).toEqual({
    file: "resumes/sam-chen.md",
  })
  expect(CandidateAdd.parseAddIntent(undefined, "Who is the hiring manager")).toBeUndefined()
  expect(CandidateAdd.parseAddIntent("score", "resume.md")).toBeUndefined()
})

test("addFromFile writes a Sourced card from a local resume only", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(
        path.join(dir, "sam-chen-resume.md"),
        ["# Sam Chen", "", "Platform engineer. Owns on-call for payments edge.", "", "- Rust and Go services", ""].join(
          "\n",
        ),
      )
    },
  })
  const result = await CandidateAdd.addFromFile(tmp.path, "sam-chen-resume.md")
  expect(result.id).toBe("sam-chen")
  expect(result.name).toBe("Sam Chen")
  expect(result.stage).toBe("Sourced")
  const packet = path.join(tmp.path, "staff-platform")
  const card = await CandidateCard.read(packet, "sam-chen")
  expect(card?.stage).toBe("Sourced")
  expect(card?.source).toBe("file")
  expect(card?.extra.name).toBe("Sam Chen")
  expect(card?.body).toContain("Platform engineer. Owns on-call for payments edge.")
  expect(card?.body).toContain("Rust and Go services")
  expect(card?.body).not.toContain("Priya")
  expect(card?.body).not.toContain("Meridian Fleet")
  expect(card?.body).not.toContain("Northline")
})

test("addFromFile refuses to invent a name when the file is empty", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
    },
  })
  await expect(CandidateAdd.addFromFile(tmp.path, "missing.md")).rejects.toThrow(/cannot read resume/)
})

test("addFromFile requires a focused req and refuses overwrite", async () => {
  await using empty = await tmpdir()
  await expect(CandidateAdd.addFromFile(empty.path, "resume.md")).rejects.toThrow(/no focused req/)

  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "resume.md"), "# Sam Chen\n\nRust.\n")
    },
  })
  await CandidateAdd.addFromFile(tmp.path, "resume.md")
  await expect(CandidateAdd.addFromFile(tmp.path, "resume.md")).rejects.toThrow(/already exists/)
})
