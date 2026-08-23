import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionVerbs } from "../../src/decision/verbs"
import { CardWrite } from "../../src/product/card-write"
import { HiringSession } from "../../src/product/hiring-session"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("nextStep is review when staged, else leftover score/draft/commit", () => {
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: ["cs_1", "cs_2"] })).toBe("review cs_1")
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: [], leftover: "score" })).toBe(
    "score leftover on staff-platform",
  )
  expect(HiringSession.nextStep({ focused: "staff-platform", stagedIds: [], leftover: "rescore" })).toBe(
    "rescore leftover on staff-platform",
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
  expect(HiringSession.nextStep({ focused: null, stagedIds: ["cs_1"], reviewReq: "founding-engineer" })).toBe(
    "review founding-engineer",
  )
  expect(
    HiringSession.nextStep({
      focused: "founding-engineer",
      stagedIds: [],
      leftover: "rescore",
      leftoverReq: "staff-recruiter",
    }),
  ).toBe("rescore leftover on staff-recruiter")
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

test("come back after a second req still names the last focused req and its staged", async () => {
  await using company = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n")
    },
  })
  await ReqWorkspace.scaffoldReq(company.path, "Staff Platform")
  await CandidateCard.write(path.join(company.path, "staff-platform"), {
    id: "kenji-okada",
    stage: "Sourced",
    extra: { name: "Kenji" },
    body: "# Kenji Okada\n\nStaff platform engineer. Payments edge.\n",
  })
  await ReqWorkspace.writeFocus(company.path, "staff-platform")
  await DecisionVerbs.pull({ cwd: company.path })
  const onA = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "kenji-okada" },
    reason: "note on A",
    cwd: company.path,
  })

  await ReqWorkspace.scaffoldReq(company.path, "Senior Backend")
  await CandidateCard.write(path.join(company.path, "senior-backend"), {
    id: "priya-shah",
    stage: "Sourced",
    extra: { name: "Priya" },
    body: "# Priya Shah\n\nBackend. Payments.\n",
  })
  await ReqWorkspace.writeFocus(company.path, "senior-backend")
  const onB = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "priya-shah" },
    reason: "note on B",
    cwd: company.path,
  })

  const whileB = await HiringSession.loadSnapshot(company.path)
  expect(whileB.focused).toBe("senior-backend")
  expect(whileB.staged.ids).toContain(onB.changeset.id)
  expect(whileB.staged.ids).toContain(onA.changeset.id)
  expect(whileB.next).toMatch(/^review (senior-backend|staff-platform)$/)
  expect(await Bun.file(path.join(company.path, "staff-platform", "HIRING.md")).exists()).toBe(true)
  expect(await Bun.file(path.join(company.path, "staff-platform", "candidates", "kenji-okada.md")).exists()).toBe(true)
  expect(await Bun.file(path.join(company.path, "COMPANY.md")).text()).toBe("# Acme\n")

  await ReqWorkspace.writeFocus(company.path, "staff-platform")
  const back = await HiringSession.loadSnapshot(company.path)
  expect(back.focused).toBe("staff-platform")
  expect(back.staged.ids).toContain(onA.changeset.id)
  expect(back.staged.ids).toContain(onB.changeset.id)
  expect(back.next).toMatch(/^review (senior-backend|staff-platform)$/)
  expect(HiringSession.formatSnapshot(back).join("\n")).toContain("staff-platform")
  expect(HiringSession.formatSnapshot(back).join("\n")).toContain(onA.changeset.id)
  expect(await Bun.file(path.join(company.path, "senior-backend", "HIRING.md")).exists()).toBe(true)
  expect(await Bun.file(path.join(company.path, "senior-backend", "candidates", "priya-shah.md")).exists()).toBe(true)
})

test("score then COMPANY bar or HIRING table change marks status come-back stale + rescore", async () => {
  const hiring = [
    "# Staff Platform",
    "",
    "## Scorecard",
    "| Dimension | Bar | Notes |",
    "|-----------|-----|-------|",
    "| Systems design | owns a service | |",
    "",
  ].join("\n")
  await using company = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n\n## Bar\n- Written operators\n")
      const req = path.join(dir, "staff-platform")
      await Bun.write(path.join(req, "HIRING.md"), hiring)
      await CandidateCard.write(req, {
        id: "kenji-okada",
        stage: "Sourced",
        extra: { name: "Kenji" },
        body: "# Kenji Okada\n\nStaff platform engineer. Payments edge and on-call.\n",
      })
    },
  })
  await ReqWorkspace.writeFocus(company.path, "staff-platform")
  await DecisionVerbs.pull({ cwd: company.path })
  await CardWrite.writeOnCard(company.path, { kind: "score", hint: "kenji-okada" })
  await CardWrite.writeOnCard(company.path, { kind: "draft", hint: "kenji-okada" })
  const live = await DecisionVerbs.status({ cwd: company.path })
  expect(live.session.next).not.toMatch(/rescore/)
  expect(live.session.leftover).not.toBe("rescore")
  const card = await CandidateCard.read(path.join(company.path, "staff-platform"), "kenji-okada")
  expect(card?.score).toBeDefined()

  await Bun.write(path.join(company.path, "COMPANY.md"), "# Acme\n\n## Bar\n- Ship weekly in public\n")
  const afterBar = await DecisionVerbs.status({ cwd: company.path })
  expect(afterBar.session.leftover).toBe("rescore")
  expect(afterBar.session.next).toBe("rescore leftover on staff-platform")
  expect(afterBar.session.next).not.toMatch(/^(score leftover|nothing left|commit leftover)/)
  const comeBack = await HiringSession.loadSnapshot(company.path)
  expect(comeBack.next).toBe("rescore leftover on staff-platform")
  expect(comeBack.leftover).toBe("rescore")
  const still = await CandidateCard.read(path.join(company.path, "staff-platform"), "kenji-okada")
  expect(still?.score).toBe(card?.score)
  expect(HiringSession.formatSnapshot(afterBar.session).join("\n")).toContain("rescore leftover")
  expect(HiringSession.formatSnapshot(afterBar.session).join("\n")).not.toMatch(/score=\d/)

  await CardWrite.writeOnCard(company.path, { kind: "score", hint: "kenji-okada" })
  await Bun.write(
    path.join(company.path, "staff-platform", "HIRING.md"),
    [
      "# Staff Platform",
      "",
      "## Scorecard",
      "| Dimension | Bar | Notes |",
      "|-----------|-----|-------|",
      "| Frontend craft | ships UI | |",
      "",
    ].join("\n"),
  )
  const afterHiring = await DecisionVerbs.status({ cwd: company.path })
  expect(afterHiring.session.leftover).toBe("rescore")
  expect(afterHiring.session.next).toBe("rescore leftover on staff-platform")
})

test("company-root status names the req: staged A, stale B", async () => {
  const hiring = [
    "# Staff Recruiter",
    "",
    "## Scorecard",
    "| Dimension | Bar | Notes |",
    "|-----------|-----|-------|",
    "| Sourcing | owns a pipeline | |",
    "",
  ].join("\n")
  await using company = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n\n## Bar\n- Written operators\n")
      await Bun.write(path.join(dir, "founding-engineer", "HIRING.md"), "# Founding Engineer\n")
      await CandidateCard.write(path.join(dir, "founding-engineer"), {
        id: "kenji-okada",
        stage: "Sourced",
        extra: { name: "Kenji" },
        body: "# Kenji Okada\n\nFounding engineer. Payments edge.\n",
      })
      await Bun.write(path.join(dir, "staff-recruiter", "HIRING.md"), hiring)
      await CandidateCard.write(path.join(dir, "staff-recruiter"), {
        id: "priya-shah",
        stage: "Sourced",
        extra: { name: "Priya" },
        body: "# Priya Shah\n\nStaff recruiter. High-volume sourcing.\n",
      })
    },
  })
  expect(await ReqWorkspace.listReqs(company.path)).toEqual(["founding-engineer", "staff-recruiter"])
  await DecisionVerbs.pull({ cwd: company.path })

  await ReqWorkspace.writeFocus(company.path, "founding-engineer")
  const staged = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "kenji-okada" },
    reason: "taste founding",
    cwd: company.path,
  })

  await ReqWorkspace.writeFocus(company.path, "staff-recruiter")
  await CardWrite.writeOnCard(company.path, { kind: "score", hint: "priya-shah" })
  await CardWrite.writeOnCard(company.path, { kind: "draft", hint: "priya-shah" })
  await Bun.write(path.join(company.path, "COMPANY.md"), "# Acme\n\n## Bar\n- Ship weekly in public\n")

  const status = await DecisionVerbs.status({ cwd: company.path })
  expect(status.session.next).toBe("review founding-engineer")
  expect(status.session.staged.ids).toContain(staged.changeset.id)
  expect(status.session.leftover).toBe("rescore")
  expect(HiringSession.formatSnapshot(status.session).join("\n")).toContain("founding-engineer")

  const listed = await DecisionVerbs.listStagedReviews({ cwd: company.path })
  expect(listed.rows.map((row) => row.id)).toContain(staged.changeset.id)
  expect(listed.rows.some((row) => row.rationale.includes("taste founding"))).toBe(true)

  const insideA = await HiringSession.loadSnapshot(path.join(company.path, "founding-engineer"))
  expect(insideA.next).toBe(`review ${staged.changeset.id}`)

  await DecisionVerbs.review({
    id: staged.changeset.id,
    action: "approve",
    by: "reviewer",
    cwd: company.path,
  })
  const after = await DecisionVerbs.status({ cwd: company.path })
  expect(after.session.next).toMatch(/rescore.*staff-recruiter/)
  expect(after.session.leftover).toBe("rescore")
  expect(after.session.staged.count).toBe(0)

  const sibling = path.join(path.dirname(company.path), "other-co")
  await Bun.write(path.join(sibling, "COMPANY.md"), "# Other\n\n## Bar\n- SECRET-SIBLING\n")
  await Bun.write(path.join(sibling, "founding-engineer", "HIRING.md"), "# Other Founding\n")
  await Bun.write(path.join(sibling, "founding-engineer", "candidates", ".gitkeep"), "")
  const dumped = JSON.stringify(after)
  expect(dumped).not.toContain("SECRET-SIBLING")
  expect(dumped).not.toContain(sibling)
})
