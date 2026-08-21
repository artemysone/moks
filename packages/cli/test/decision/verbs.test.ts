import { describe, expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionVerbs } from "../../src/decision/verbs"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function workspace() {
  return tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
    },
  })
}

async function companyWorkspace() {
  return tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n")
      const req = path.join(dir, "senior-backend")
      await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
      await CandidateCard.write(req, {
        id: "cand_priya",
        stage: "Sourced",
        extra: { name: "Priya" },
        body: "# Priya\n",
      })
      return req
    },
  })
}

async function pull(cwd: string) {
  return DecisionVerbs.pull({ cwd })
}

describe("decision/verbs", () => {
  test("isAdverseMutation flags Reject, ExtendOffer, and Hire", () => {
    expect(DecisionVerbs.isAdverseMutation("Reject")).toBe(true)
    expect(DecisionVerbs.isAdverseMutation("ExtendOffer")).toBe(true)
    expect(DecisionVerbs.isAdverseMutation("AdvanceStage", { to: "Hired" })).toBe(true)
    expect(DecisionVerbs.isAdverseMutation("AddNote")).toBe(false)
    expect(DecisionVerbs.isAdverseMutation("AdvanceStage", { to: "Screen" })).toBe(false)
  })

  test("commit stages a changeset after pull", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const result = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "spoke to HM",
      cwd: tmp.path,
    })
    expect(result.changeset.status === "staged" || result.changeset.status === "approved").toBe(true)
    expect(result.changeset.id).toMatch(ID)
    expect(result.adverse).toBe(false)
    expect(result.changeset.changes[0].mutation).toBe("AddNote")
  })

  test("commit marks adverse mutations", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const result = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "below bar",
      cwd: tmp.path,
    })
    expect(result.adverse).toBe(true)
    expect(result.changeset.changes[0].mutation).toBe("Reject")
  })

  test("commit fails without mutation or target", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    await expect(DecisionVerbs.commit({ rationale: "empty", cwd: tmp.path })).rejects.toThrow("nothing to commit")
  })

  test("reject of an already-Rejected candidate names the stage and suggests --target-id", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    await expect(
      DecisionVerbs.commit({
        action: "reject",
        target: { kind: "candidate", id: "cand_amira" },
        reason: "already out",
        cwd: tmp.path,
      }),
    ).rejects.toThrow(/cannot reject cand_amira: current stage is Rejected/)
    try {
      await DecisionVerbs.commit({
        action: "reject",
        target: { kind: "candidate", id: "cand_amira" },
        reason: "already out",
        cwd: tmp.path,
      })
      throw new Error("expected reject of cand_amira to fail")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("try --target-id ")
      expect(message).toMatch(/stage (Sourced|Contacted|Replied|Screen|Interview|Offer)/)
      expect(message).not.toContain("\u2192")
      expect(message).not.toContain("Unexpected error")
    }
  })

  test("push adverse without confirm → needs_confirm", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const committed = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "below bar",
      cwd: tmp.path,
    })
    await DecisionVerbs.review({
      id: committed.changeset.id,
      action: "approve",
      by: "you",
      cwd: tmp.path,
    })
    const result = await DecisionVerbs.push({ id: committed.changeset.id, cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("needs_confirm")
  })

  test("push adverse with confirm dry-run does not apply", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const committed = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "below bar",
      cwd: tmp.path,
    })
    await DecisionVerbs.review({
      id: committed.changeset.id,
      action: "approve",
      by: "you",
      cwd: tmp.path,
    })
    const result = await DecisionVerbs.push({
      id: committed.changeset.id,
      cwd: tmp.path,
      confirm: true,
      dry_run: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.dry_run).toBe(true)
    expect(result.pushed[0].id).toBe(committed.changeset.id)
    const st = await DecisionVerbs.status({ cwd: tmp.path })
    expect(st.report.changesets.applied).toBe(0)
    expect(st.report.changesets.approved).toBe(1)
  })

  test("push unknown changeset fails", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const result = await DecisionVerbs.push({
      id: "00000000-0000-0000-0000-000000000000",
      cwd: tmp.path,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("not_found")
  })

  test("push staged without review → review_required", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const committed = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "note",
      cwd: tmp.path,
    })
    if (committed.changeset.status !== "staged") return
    const result = await DecisionVerbs.push({ id: committed.changeset.id, cwd: tmp.path, dry_run: false })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("review_required")
  })

  test("execute push applies and a second push is already_pushed", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const committed = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "note",
      cwd: tmp.path,
    })
    if (committed.changeset.status === "staged") {
      await DecisionVerbs.review({
        id: committed.changeset.id,
        action: "approve",
        by: "you",
        cwd: tmp.path,
      })
    }
    const first = await DecisionVerbs.push({
      id: committed.changeset.id,
      cwd: tmp.path,
      dry_run: false,
    })
    expect(first.ok).toBe(true)
    const second = await DecisionVerbs.push({ id: committed.changeset.id, cwd: tmp.path })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("expected failure")
    expect(second.code).toBe("already_pushed")
  })

  test("status open lists staged and approved, not applied", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const a = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "first",
      cwd: tmp.path,
    })
    if (a.changeset.status === "staged") {
      await DecisionVerbs.review({ id: a.changeset.id, action: "approve", by: "you", cwd: tmp.path })
    }
    await DecisionVerbs.push({ id: a.changeset.id, cwd: tmp.path, dry_run: false })
    const b = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_marcus" },
      reason: "pass",
      cwd: tmp.path,
    })
    const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
    expect(st.open.map((row) => row.id)).toContain(b.changeset.id)
    expect(st.open.map((row) => row.id)).not.toContain(a.changeset.id)
    expect(st.changesets.length).toBeGreaterThanOrEqual(2)
  })

  test("status filters by id", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const a = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "first",
      cwd: tmp.path,
    })
    await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_marcus" },
      reason: "second",
      cwd: tmp.path,
    })
    const byId = await DecisionVerbs.status({ cwd: tmp.path, id: a.changeset.id })
    expect(byId.changesets).toHaveLength(1)
    expect(byId.changesets[0].id).toBe(a.changeset.id)
  })

  test("diff shows the staged mutation", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const committed = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "next round",
      cwd: tmp.path,
    })
    const result = await DecisionVerbs.diff({ cwd: tmp.path, id: committed.changeset.id })
    expect(result.diffs).toHaveLength(1)
    expect(result.diffs[0].changes[0].mutation).toBe("AdvanceStage")
    expect(result.diffs[0].drift).toBe(false)
  })

  test("company-only --target stages on the company ledger without creating candidates/", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "HIRING.md"), "# Acme\n")
      },
    })
    await pull(tmp.path)
    const result = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "pass",
      cwd: tmp.path,
    })
    expect(result.changeset.id).toMatch(ID)
    expect(await Bun.file(path.join(tmp.path, "candidates")).exists()).toBe(false)
  })

  test("commit from a req packet stages against the company ledger", async () => {
    await using tmp = await companyWorkspace()
    await pull(tmp.path)
    const result = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "from req",
      cwd: tmp.extra,
    })
    expect(result.path).toBe(tmp.path)
    expect(result.changeset.id).toMatch(ID)
  })

  test("commit --target writes the card onto the focused req packet", async () => {
    await using tmp = await companyWorkspace()
    await ReqWorkspace.writeFocus(tmp.path, "senior-backend")
    await pull(tmp.path)
    await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "pass",
      cwd: tmp.path,
    })
    expect(await CandidateCard.read(tmp.extra, "cand_priya")).toMatchObject({ stage: "Rejected" })
    expect(await Bun.file(path.join(tmp.path, "candidates")).exists()).toBe(false)
  })

  test("pull projects candidate cards into the focused req", async () => {
    await using tmp = await companyWorkspace()
    await ReqWorkspace.writeFocus(tmp.path, "senior-backend")
    const result = await pull(tmp.path)
    expect(result.cards.dir).toBe(path.join("senior-backend", "candidates"))
    expect(result.cards.created.toSorted()).toEqual(["cand_amira", "cand_devon", "cand_jane", "cand_marcus"])
    expect(await CandidateCard.read(tmp.extra, "cand_jane")).toMatchObject({
      stage: "Screen",
      source: "mock",
      extra: { name: "Jane Ortega" },
    })
    expect(await CandidateCard.read(tmp.extra, "cand_priya")).toMatchObject({
      stage: "Sourced",
      extra: { name: "Priya" },
    })
    expect(await Bun.file(path.join(tmp.path, "candidates")).exists()).toBe(false)
  })

  test("pull without a focused req projects no cards", async () => {
    await using tmp = await companyWorkspace()
    const result = await pull(tmp.path)
    expect(result.cards.dir).toBeNull()
    expect(result.cards.created).toEqual([])
    expect(await CandidateCard.read(tmp.extra, "cand_jane")).toBeUndefined()
  })

  test("pull projects cards into a single-req packet root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
        await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
      },
    })
    const result = await pull(tmp.path)
    expect(result.cards.dir).toBe("candidates")
    expect(result.cards.created).toHaveLength(5)
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })
  })

  test("second pull preserves recruiter edits and syncs stage from the mirror", async () => {
    await using tmp = await companyWorkspace()
    await ReqWorkspace.writeFocus(tmp.path, "senior-backend")
    await pull(tmp.path)
    const card = await CandidateCard.read(tmp.extra, "cand_jane")
    if (!card) throw new Error("expected projected card")
    await CandidateCard.write(tmp.extra, {
      ...card,
      score: 3,
      stage: "Sourced",
      body: "# Jane Ortega\n\nscored notes\n",
    })
    const again = await pull(tmp.path)
    expect(again.cards.created).toEqual([])
    expect(again.cards.updated).toEqual(["cand_jane"])
    expect(await CandidateCard.read(tmp.extra, "cand_jane")).toMatchObject({
      score: 3,
      stage: "Screen",
      body: "# Jane Ortega\n\nscored notes\n",
    })
  })
})
