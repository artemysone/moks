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

test("review excerpt and push apply the same blessed score and outreach", async () => {
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

  const scored = await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "kenji-sato" })
  const drafted = await CardWrite.writeOnCard(tmp.path, { kind: "draft", hint: "kenji-sato" })
  const card = await CandidateCard.read(tmp.path, "kenji-sato")
  expect(card?.body).toContain("# Score:")
  expect(card?.body).toContain("# Outreach")
  expect(card?.stage).toBe("Sourced")

  const listed = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(listed.rows.map((row) => row.action).sort()).toEqual(["note", "outreach"])
  expect(listed.rows.every((row) => row.action !== "advance")).toBe(true)

  const scoreRow = listed.rows.find((row) => row.action === "note")
  const draftRow = listed.rows.find((row) => row.action === "outreach")
  if (!scoreRow || !draftRow) throw new Error("expected score note and draft outreach")

  const scoreReview = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: scoreRow.id })
  const draftReview = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: draftRow.id })
  const scoreBody = (scoreReview.changeset.changes[0].payload as { body?: string }).body
  const draftBody = (draftReview.changeset.changes[0].payload as { body?: string }).body
  expect(scoreBody).toContain("# Score:")
  expect(scoreBody).toContain(String(scored.score ?? card?.score))
  expect(draftBody).toContain("# Outreach")
  expect(draftBody).toContain("Draft only. Never sent.")
  expect(scoreReview.excerpts[0]).toBe(scoreBody)
  expect(draftReview.excerpts[0]).toBe(draftBody)
  expect(card?.body).toContain(scoreBody)
  expect(card?.body).toContain(draftBody)

  await DecisionVerbs.review({ id: scoreRow.id, action: "approve", by: "reviewer", cwd: tmp.path })
  await DecisionVerbs.review({ id: draftRow.id, action: "approve", by: "reviewer", cwd: tmp.path })
  const pushed = await DecisionVerbs.push({ cwd: tmp.path, dry_run: false })
  expect(pushed.ok).toBe(true)
  if (!pushed.ok) throw new Error(pushed.message)
  expect(pushed.pushed.every((item) => item.status === "applied")).toBe(true)

  const ats = ledgerBodies(tmp.path)
  expect(ats.notes).toContain(scoreBody)
  expect(ats.outreach).toContain(draftBody)
  expect(ats.notes.some((body) => body === `score ${scored.score} on kenji-sato`)).toBe(false)
  expect(ats.outreach.some((body) => body === "draft outreach for kenji-sato")).toBe(false)

  const after = await CandidateCard.read(tmp.path, "kenji-sato")
  expect(after?.stage).toBe("Sourced")
  expect(after?.body).toContain(scoreBody ?? "")
  expect(after?.score).toBe(drafted.score ?? scored.score)
})

test("leftover-ledger and empty cwd still fail loud", async () => {
  await using empty = await tmpdir()
  await expect(CardWrite.writeOnCard(empty.path, { kind: "score", hint: "kenji" })).rejects.toThrow(
    /not a company directory/,
  )
  await using leftover = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, ".moks", "ledger.sqlite"), "")
    },
  })
  await expect(CardWrite.writeOnCard(leftover.path, { kind: "draft", hint: "kenji" })).rejects.toThrow(
    /not a company directory/,
  )
})
