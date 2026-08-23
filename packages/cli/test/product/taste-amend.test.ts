import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { CardWrite } from "../../src/product/card-write"
import { DecisionVerbs } from "../../src/decision/verbs"
import { tmpdir } from "../fixture/fixture"

function ledgerBodies(cwd: string) {
  const db = new Database(path.join(cwd, ".moks", "mock-ats.sqlite"), { readonly: true })
  try {
    const notes = db.prepare("SELECT body FROM notes").all() as Array<{ body: string }>
    const outreach = db.prepare("SELECT body FROM outreach").all() as Array<{ body: string }>
    return { notes: notes.map((row) => row.body), outreach: outreach.map((row) => row.body) }
  } finally {
    db.close()
  }
}

test("taste can amend outreach then bless; push writes the edited bytes", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Staff Platform\n")
      await CandidateCard.write(dir, {
        id: "kenji-sato",
        stage: "Sourced",
        extra: { name: "Kenji Sato" },
        body: "# Kenji Sato\n\nStaff platform engineer. Payments edge.\n",
      })
    },
  })

  await CardWrite.writeOnCard(tmp.path, { kind: "draft", hint: "kenji-sato" })
  const listed = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  const draft = listed.rows.find((row) => row.action === "outreach")
  if (!draft) throw new Error("expected staged outreach")
  const before = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: draft.id })
  const original = before.excerpts[0]
  if (typeof original !== "string") throw new Error("draft review missing excerpt")
  const edited = "# Outreach\n\nKenji,\n\n15 minutes Tuesday. Yes or no.\n\n— Sam\n"
  expect(original).not.toBe(edited.trim())

  await DecisionVerbs.review({
    id: draft.id,
    action: "approve",
    by: "reviewer",
    excerpt: edited,
    cwd: tmp.path,
  })
  const afterBless = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: draft.id })
  const blessed = afterBless.excerpts[0]
  if (typeof blessed !== "string") throw new Error("blessed excerpt missing")
  expect(blessed).toBe(edited.trim())
  const card = await CandidateCard.read(tmp.path, "kenji-sato")
  expect(card?.body).toContain("15 minutes Tuesday. Yes or no.")
  expect(card?.body).not.toContain(original.split("\n")[0] === "# Outreach" ? "unused" : original.slice(0, 40))

  const pushed = await DecisionVerbs.push({ cwd: tmp.path, dry_run: false })
  expect(pushed.ok).toBe(true)
  if (!pushed.ok) throw new Error(pushed.message)
  const ats = ledgerBodies(tmp.path)
  expect(ats.outreach).toContain(edited.trim())
  expect(ats.outreach).not.toContain(original)
})

test("taste can amend a score note then bless", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Staff Platform\n")
      await CandidateCard.write(dir, {
        id: "kenji-sato",
        stage: "Sourced",
        extra: { name: "Kenji Sato" },
        body: "# Kenji Sato\n\nStaff platform engineer.\n",
      })
    },
  })
  await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "kenji-sato" })
  const listed = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  const score = listed.rows.find((row) => row.action === "note")
  if (!score) throw new Error("expected staged score")
  const edited = "# Score: Kenji Sato → Staff Platform\n\nHuman edit: ship it.\n"
  await DecisionVerbs.review({
    id: score.id,
    action: "approve",
    by: "reviewer",
    excerpt: edited,
    cwd: tmp.path,
  })
  const blessed = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: score.id })
  const body = blessed.excerpts[0]
  if (typeof body !== "string") throw new Error("score excerpt missing")
  expect(body).toBe(edited.trim())
  const card = await CandidateCard.read(tmp.path, "kenji-sato")
  expect(card?.body).toContain("Human edit: ship it.")
  const pushed = await DecisionVerbs.push({ cwd: tmp.path, dry_run: false })
  expect(pushed.ok).toBe(true)
  if (!pushed.ok) throw new Error(pushed.message)
  expect(ledgerBodies(tmp.path).notes).toContain(edited.trim())
})

test("leftover-ledger and empty cwd still fail loud on amend review", async () => {
  await using empty = await tmpdir()
  await expect(
    DecisionVerbs.review({ id: "cs_x", action: "approve", by: "you", excerpt: "nope", cwd: empty.path }),
  ).rejects.toThrow(/not a company directory/)
  await using leftover = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, ".moks", "ledger.sqlite"), "")
    },
  })
  await expect(
    DecisionVerbs.review({ id: "cs_x", action: "approve", by: "you", excerpt: "nope", cwd: leftover.path }),
  ).rejects.toThrow(/not a company directory/)
})
