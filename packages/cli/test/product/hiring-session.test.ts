import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionVerbs } from "../../src/decision/verbs"
import { HiringSession } from "../../src/product/hiring-session"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("nextStep is review when staged, else leftover score/draft/commit", () => {
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: ["cs_1", "cs_2"] })).toBe("review cs_1")
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: [], leftover: "score" })).toBe(
    "score leftover on staff-platform",
  )
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: [], leftover: "draft" })).toBe(
    "draft leftover on staff-platform",
  )
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: [], leftover: "commit" })).toBe(
    "commit leftover on staff-platform",
  )
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: [], leftover: null })).toBe(
    "nothing left on staff-platform",
  )
})

test("leftover-ledger and empty cwd fail loud and do not write session.json", async () => {
  await using empty = await tmpdir()
  await expect(HiringSession.loadSnapshot(empty.path)).rejects.toThrow(/not a company directory/)
  expect(await Bun.file(path.join(empty.path, ".moks", "session.json")).exists()).toBe(false)

  await using stub = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), ReqWorkspace.COMPANY_STUB)
      await Bun.write(path.join(dir, ".moks", "ledger.sqlite"), "")
    },
  })
  await expect(HiringSession.loadSnapshot(stub.path)).rejects.toThrow(/not a company directory/)
  expect(await Bun.file(path.join(stub.path, ".moks", "session.json")).exists()).toBe(false)
})

test("new process in a mid-req folder reads focused + staged + next without /open-req", async () => {
  await using company = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n")
      const req = path.join(dir, "staff-platform")
      await Bun.write(path.join(req, "HIRING.md"), "# Staff Platform\n")
      await CandidateCard.write(req, {
        id: "kenji-okada",
        stage: "Sourced",
        extra: { name: "Kenji" },
        body: "# Kenji Okada\n\nStaff platform engineer. Payments edge.\n",
      })
    },
  })
  await ReqWorkspace.writeFocus(company.path, "staff-platform")
  await DecisionVerbs.pull({ cwd: company.path })
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "kenji-okada" },
    reason: "mid-req note",
    cwd: company.path,
  })

  const file = path.join(company.path, ".moks", "session.json")
  expect(await Bun.file(file).exists()).toBe(true)
  expect(file.startsWith(company.path)).toBe(true)
  expect(file).not.toContain(process.env.HOME ?? "no-home-sentinel")

  const status = await DecisionVerbs.status({ cwd: company.path })
  expect(status.session.focused).toBe("staff-platform")
  expect(status.session.staged.count).toBeGreaterThan(0)
  expect(status.session.staged.ids).toContain(committed.changeset.id)
  expect(status.session.next).toBe(`review ${committed.changeset.id}`)
  expect(HiringSession.formatSnapshot(status.session).join("\n")).not.toMatch(/open-req/)

  const later = await HiringSession.readSnapshot(company.path)
  const resumed = await HiringSession.loadSnapshot(company.path)
  expect(later?.focused).toBe("staff-platform")
  expect(resumed.next).toBe(`review ${committed.changeset.id}`)
  expect(resumed.staged.ids).toEqual(status.session.staged.ids)
})

test("reviewer leaving and coming back gets the real next step", async () => {
  await using company = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n")
      const req = path.join(dir, "staff-platform")
      await Bun.write(path.join(req, "HIRING.md"), "# Staff Platform\n")
      await CandidateCard.write(req, {
        id: "kenji-okada",
        stage: "Sourced",
        extra: { name: "Kenji" },
        body: "# Kenji Okada\n\nStaff platform engineer. Payments edge.\n",
      })
    },
  })
  await ReqWorkspace.writeFocus(company.path, "staff-platform")
  await DecisionVerbs.pull({ cwd: company.path })
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "kenji-okada" },
    reason: "stage for reviewer",
    cwd: company.path,
  })
  expect((await HiringSession.loadSnapshot(company.path)).next).toBe(`review ${committed.changeset.id}`)

  await DecisionVerbs.review({
    id: committed.changeset.id,
    action: "approve",
    by: "reviewer",
    cwd: company.path,
  })
  const after = await HiringSession.loadSnapshot(company.path)
  expect(after.focused).toBe("staff-platform")
  expect(after.staged.count).toBe(0)
  expect(after.next).toMatch(/score leftover on staff-platform|draft leftover on staff-platform|commit leftover on staff-platform|nothing left/)
  expect(after.next).not.toMatch(/open-req/)
})
