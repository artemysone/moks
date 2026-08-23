import { expect, test } from "bun:test"
import path from "path"
import { CandidateAdd } from "../../src/product/candidate-add"
import { CandidateCard } from "../../src/product/candidate-card"
import { CardWrite } from "../../src/product/card-write"
import { DecisionVerbs } from "../../src/decision/verbs"
import { HiringSession } from "../../src/product/hiring-session"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

const MARKER = "SECRET-ACME-BAR"
const CARD = "cand_kenji_iso"

async function seedCompany(dir: string, name: string, bar: string) {
  await Bun.write(
    path.join(dir, "COMPANY.md"),
    `# ${name}\n\n## Bar\n- ${bar}\n`,
  )
  const req = path.join(dir, "founding-engineer")
  await Bun.write(path.join(req, "HIRING.md"), `# Founding Engineer\n`)
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  return req
}

test("companyRoot does not inherit a parent or sibling COMPANY.md", async () => {
  await using parent = await tmpdir({ git: true })
  const a = path.join(parent.path, "acme")
  const b = path.join(parent.path, "bravo")
  await seedCompany(a, "Acme", MARKER)
  await Bun.write(path.join(parent.path, "COMPANY.md"), `# Parent leak\n`)
  expect(await ReqWorkspace.companyRoot(a)).toBe(a)
  expect(await ReqWorkspace.companyRoot(path.join(a, "founding-engineer"))).toBe(a)
  expect(await ReqWorkspace.companyRoot(b)).toBeUndefined()

  await seedCompany(b, "Bravo", "bravo-bar")
  expect(await ReqWorkspace.companyRoot(b)).toBe(b)
  expect(await ReqWorkspace.companyRoot(path.join(b, "founding-engineer"))).toBe(b)
  expect(await ReqWorkspace.companyRoot(b)).not.toBe(a)
})

test("two company folders: B does not see A's COMPANY.md, cards, or ledger", async () => {
  await using parent = await tmpdir({ git: true })
  const a = path.join(parent.path, "acme")
  const b = path.join(parent.path, "bravo")
  const reqA = await seedCompany(a, "Acme", MARKER)
  await seedCompany(b, "Bravo", "bravo-only-bar")
  await Bun.write(path.join(parent.path, "COMPANY.md"), `# Parent should not leak\n`)

  await ReqWorkspace.writeFocus(a, "founding-engineer")
  await CandidateAdd.addPile(a, { files: [], names: ["Kenji Iso"] })
  const cardsA = await CandidateCard.list(reqA)
  expect(cardsA.length).toBeGreaterThan(0)
  const id = cardsA[0]?.id ?? CARD
  await CardWrite.writeOnCard(a, { kind: "score", hint: id })
  await DecisionVerbs.pull({ cwd: a })
  await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id },
    reason: "acme-only note",
    cwd: a,
  })

  const statusA = await DecisionVerbs.status({ cwd: a })
  expect(statusA.path).toBe(a)
  expect(JSON.stringify(statusA)).toContain("acme-only note")
  const slateA = await ReqWorkspace.slateBlock(a)
  expect(slateA).toContain(id)
  const logA = await DecisionVerbs.log({ cwd: a })
  expect(logA.lines.join("\n")).toContain("acme-only note")

  await expect(DecisionVerbs.status({ cwd: b })).rejects.toThrow(/no ledger|not a company directory|empty company/)
  await expect(DecisionVerbs.log({ cwd: b })).rejects.toThrow(/no ledger|not a company directory|empty company|leftover/)

  await DecisionVerbs.pull({ cwd: b })
  const statusB = await DecisionVerbs.status({ cwd: b })
  const dumped = JSON.stringify(statusB)
  expect(statusB.path).toBe(b)
  expect(dumped).not.toContain(id)
  expect(dumped).not.toContain(MARKER)
  expect(dumped).not.toContain("acme-only")
  expect(dumped).not.toContain(a)

  const logB = await DecisionVerbs.log({ cwd: b })
  const logText = `${logB.lines.join("\n")}\n${JSON.stringify(logB)}`
  expect(logB.path).toBe(b)
  expect(logText).not.toContain(id)
  expect(logText).not.toContain(MARKER)
  expect(logText).not.toContain("acme-only")

  const slateB = await ReqWorkspace.slateBlock(b)
  expect(slateB ?? "").not.toContain(id)
  expect(slateB ?? "").not.toContain("Kenji")

  const snapB = await HiringSession.loadSnapshot(b)
  expect(JSON.stringify(snapB)).not.toContain(id)
  expect(JSON.stringify(snapB)).not.toContain(MARKER)
  expect(await Bun.file(path.join(b, "COMPANY.md")).text()).toContain("bravo-only-bar")
  expect(await Bun.file(path.join(b, "COMPANY.md")).text()).not.toContain(MARKER)
  expect(await Bun.file(path.join(a, "COMPANY.md")).text()).toContain(MARKER)
})

test("leftover-ledger and empty-cwd stay fail-loud and do not read the sibling company", async () => {
  await using parent = await tmpdir({ git: true })
  const a = path.join(parent.path, "acme")
  const empty = path.join(parent.path, "empty")
  const leftover = path.join(parent.path, "leftover")
  await seedCompany(a, "Acme", MARKER)
  await DecisionVerbs.pull({ cwd: a })
  await Bun.write(path.join(empty, "keep.txt"), "x")
  await Bun.write(path.join(leftover, "COMPANY.md"), ReqWorkspace.COMPANY_STUB)
  await Bun.write(path.join(leftover, ".moks", "ledger.sqlite"), "")

  expect(await ReqWorkspace.companyRoot(empty)).toBeUndefined()
  expect(await ReqWorkspace.companyRoot(leftover)).toBe(leftover)
  expect(await ReqWorkspace.isLiveCompany(leftover)).toBe(false)

  await expect(DecisionVerbs.status({ cwd: empty })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  await expect(DecisionVerbs.log({ cwd: empty })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  await expect(DecisionVerbs.status({ cwd: leftover })).rejects.toThrow(/not a company directory|leftover|pass --cwd\/--dir/)
  await expect(DecisionVerbs.log({ cwd: leftover })).rejects.toThrow(/not a company directory|leftover|pass --cwd\/--dir/)
})
