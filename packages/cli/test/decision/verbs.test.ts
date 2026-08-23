import { describe, expect, test } from "bun:test"
import path from "path"
import { CandidateAdd } from "../../src/product/candidate-add"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionVerbs } from "../../src/decision/verbs"
import { isStage } from "../../../engine/ledger/src/domain.ts"
import { parseHiringMarkdown } from "@moks/ledger"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function workspace() {
  return tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
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
      to: "Contacted",
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

  test("commit note --body fills rationale; missing body defaults from last score", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const withBody = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      body: "spoke to HM",
      cwd: tmp.path,
    })
    expect(withBody.changeset.rationale).toBe("spoke to HM")
    expect(withBody.changeset.changes[0].payload).toEqual({ body: "spoke to HM" })

    await CandidateCard.write(tmp.path, {
      id: "cand_priya",
      stage: "Sourced",
      score: 3,
      extra: { name: "Priya Shah" },
      body: "# Priya\n\n## Summary\n- Recommendation: yes\n- One-line rationale: Strong ledger fit.\n",
    })
    const defaulted = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      cwd: tmp.path,
    })
    expect(defaulted.changeset.rationale).toBe("Strong ledger fit.")
  })


  test("advance without --to names --to and the legal next stage", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    await expect(
      DecisionVerbs.commit({
        action: "advance",
        target: { kind: "candidate", id: "cand_priya" },
        reason: "next round",
        cwd: tmp.path,
      }),
    ).rejects.toThrow(/AdvanceStage requires --to \(legal next: Contacted\)/)
  })

  
  test("advance --to Screen names legal next for that id, not another candidate", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    await Bun.write(path.join(tmp.path, "kenji-okada.md"), "# Kenji Okada\n\nStaff.\n")
    await Bun.write(path.join(tmp.path, "nora-voss.md"), "# Nora Voss\n\nStaff.\n")
    await CandidateAdd.addFromFile(tmp.path, "kenji-okada.md")
    await CandidateAdd.addFromFile(tmp.path, "nora-voss.md")
    await expect(
      DecisionVerbs.commit({
        action: "advance",
        target: { kind: "candidate", id: "kenji-okada" },
        to: "Screen",
        reason: "HIRING next",
        cwd: tmp.path,
      }),
    ).rejects.toThrow(/cannot advance kenji-okada: Screen is not a legal next stage from Sourced \(legal next: Contacted\)/)
    try {
      await DecisionVerbs.commit({
        action: "advance",
        target: { kind: "candidate", id: "kenji-okada" },
        to: "Screen",
        reason: "HIRING next",
        cwd: tmp.path,
      })
      throw new Error("expected advance to fail")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain("nora-voss")
      expect(message).not.toContain("try --target-id")
    }
  })

test("push dry-run with staged and zero approved names review first", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "one",
      cwd: tmp.path,
    })
    await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_marcus" },
      reason: "two",
      cwd: tmp.path,
    })
    const result = await DecisionVerbs.push({ cwd: tmp.path, dry_run: true })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.message).toMatch(/0 approved, 2 staged — review first/)
    expect(result.message).not.toBe("nothing to push")
  })

  test("status without a company directory fails instead of looking empty-healthy", async () => {
    await using empty = await tmpdir()
    await expect(DecisionVerbs.status({ cwd: empty.path })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  })

  test("log without a company directory fails instead of looking empty", async () => {
    await using empty = await tmpdir()
    await expect(DecisionVerbs.log({ cwd: empty.path })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  })

  test("COMPANY.md stub without reqs is not a live company", async () => {
    await using stub = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "COMPANY.md"), ReqWorkspace.COMPANY_STUB)
      },
    })
    await expect(DecisionVerbs.status({ cwd: stub.path })).rejects.toThrow(/not a company directory|no ledger|pass --cwd\/--dir/)
    await expect(DecisionVerbs.log({ cwd: stub.path })).rejects.toThrow(/not a company directory|no ledger|pass --cwd\/--dir/)
    await expect(DecisionVerbs.diff({ cwd: stub.path })).rejects.toThrow(/not a company directory|no ledger|pass --cwd\/--dir|empty company/)
    await expect(DecisionVerbs.push({ cwd: stub.path })).rejects.toThrow(/not a company directory|no ledger|pass --cwd\/--dir|empty company/)
  })


  test("pull without a company directory fails and does not write a ledger", async () => {
    await using empty = await tmpdir()
    await expect(DecisionVerbs.pull({ cwd: empty.path })).rejects.toThrow(/not a company directory|pass --cwd\/--dir/)
    expect(await Bun.file(path.join(empty.path, ".moks", "ledger.sqlite")).exists()).toBe(false)
  })

  test("activity without a company directory fails instead of looking quiet", async () => {
    await using empty = await tmpdir()
    await expect(DecisionVerbs.activityRows({ cwd: empty.path })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  })

  test("diff without a company directory fails instead of looking empty-healthy", async () => {
    await using empty = await tmpdir()
    await expect(DecisionVerbs.diff({ cwd: empty.path })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  })

  test("push without a company directory fails instead of nothing to push", async () => {
    await using empty = await tmpdir()
    await expect(DecisionVerbs.push({ cwd: empty.path, dry_run: true })).rejects.toThrow(/not a company directory|no ledger|empty company/)
  })


  test("staged AdvanceStage keeps card and status on applied stage until push", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "HIRING.md"),
          "# Role\n## Process\n- Stages: sourced → screen → phone → onsite → offer → hire\n",
        )
        await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
      },
    })
    await pull(tmp.path)
    const before = await DecisionVerbs.status({ cwd: tmp.path })
    expect(before.report.pipeline.Sourced).toBe(1)
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })

    const committed = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Screen",
      reason: "HIRING next",
      cwd: tmp.path,
    })
    expect(committed.changeset.changes[0].payload).toEqual(expect.objectContaining({ to: "Screen" }))
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })
    const stagedStatus = await DecisionVerbs.status({ cwd: tmp.path })
    expect(stagedStatus.report.pipeline.Sourced).toBe(1)
    expect(stagedStatus.report.pipeline.Screen).toBe(before.report.pipeline.Screen)

    const inspected = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: committed.changeset.id })
    expect(inspected.changeset.changes[0].payload).toEqual(expect.objectContaining({ to: "Screen" }))
    expect(inspected.cards[0]).toMatchObject({ id: "cand_priya", stage: "Sourced" })

    if (committed.changeset.status === "staged") {
      await DecisionVerbs.review({
        id: committed.changeset.id,
        action: "approve",
        by: "you",
        cwd: tmp.path,
      })
    }
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })

  })

  test("applied AdvanceStage moves card and status together", async () => {
    await using tmp = await workspace()
    await pull(tmp.path)
    const before = await DecisionVerbs.status({ cwd: tmp.path })
    expect(before.report.pipeline.Sourced).toBe(1)
    const committed = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Contacted",
      reason: "next hop",
      cwd: tmp.path,
    })
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })
    const stagedStatus = await DecisionVerbs.status({ cwd: tmp.path })
    expect(stagedStatus.report.pipeline.Sourced).toBe(1)
    if (committed.changeset.status === "staged") {
      await DecisionVerbs.review({
        id: committed.changeset.id,
        action: "approve",
        by: "you",
        cwd: tmp.path,
      })
    }
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })
    const pushed = await DecisionVerbs.push({
      id: committed.changeset.id,
      cwd: tmp.path,
      dry_run: false,
    })
    expect(pushed.ok).toBe(true)
    if (pushed.ok) {
      expect(pushed.pushed[0]?.status).toBe("applied")
    }
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Contacted" })
    const after = await DecisionVerbs.status({ cwd: tmp.path })
    expect(after.report.pipeline.Sourced ?? 0).toBe(0)
    expect(after.report.pipeline.Contacted).toBe((before.report.pipeline.Contacted ?? 0) + 1)
  })

  test("HIRING Process path makes Sourced → Screen legal and reviewable", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "HIRING.md"),
          "# Role\n## Process\n- Stages: sourced → screen → phone → onsite → offer → hire\n",
        )
        await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
      },
    })
    await pull(tmp.path)
    const committed = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Screen",
      reason: "HIRING next",
      cwd: tmp.path,
    })
    expect(committed.changeset.status === "staged" || committed.changeset.status === "approved").toBe(true)
    expect(committed.changeset.changes[0].mutation).toBe("AdvanceStage")
    const listed = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
    if (committed.changeset.status === "staged") {
      expect(listed.rows.map((row) => row.id)).toContain(committed.changeset.id)
      const inspected = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: committed.changeset.id })
      expect(inspected.changeset.id).toBe(committed.changeset.id)
      const approved = await DecisionVerbs.review({
        id: committed.changeset.id,
        action: "approve",
        by: "you",
        cwd: tmp.path,
      })
      expect(approved.changeset.status).toBe("approved")
    } else {
      const inspected = await DecisionVerbs.inspectReview({ cwd: tmp.path, id: committed.changeset.id })
      expect(inspected.changeset.id).toBe(committed.changeset.id)
    }
    const hiringDoc = parseHiringMarkdown(
      "# Role\n## Process\n- Stages: sourced \u2192 screen \u2192 phone \u2192 onsite \u2192 offer \u2192 hire\n",
    )
    expect(hiringDoc.stages).toEqual(["Sourced", "Screen", "Phone", "Onsite", "Offer", "Hired"])
    expect(isStage("Phone")).toBe(true)
    const phoneHop = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Phone",
      reason: "HIRING next",
      cwd: tmp.path,
    })
    expect(phoneHop.changeset.changes[0].mutation).toBe("AdvanceStage")
    expect(phoneHop.changeset.changes[0].payload).toEqual(expect.objectContaining({ to: "Phone" }))
  })

  test("HIRING staged Screen hop makes --to Phone legal at commit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "HIRING.md"),
          "# Role\n## Process\n- Stages: sourced → screen → phone → onsite → offer → hire\n",
        )
        await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
      },
    })
    await pull(tmp.path)
    const screen = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Screen",
      reason: "HIRING next",
      cwd: tmp.path,
    })
    expect(screen.changeset.status).toBe("staged")
    const phone = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Phone",
      reason: "HIRING next",
      cwd: tmp.path,
    })
    expect(phone.changeset.status === "staged" || phone.changeset.status === "approved").toBe(true)
    expect(phone.changeset.changes[0].mutation).toBe("AdvanceStage")
    expect(phone.changeset.changes[0].payload).toEqual(expect.objectContaining({ to: "Phone" }))
  })

  test("approved HIRING Screen hop applies on push; card and status become Screen", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "HIRING.md"),
          "# Role\n## Process\n- Stages: sourced → screen → phone → onsite → offer → hire\n",
        )
        await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
      },
    })
    await pull(tmp.path)
    const before = await DecisionVerbs.status({ cwd: tmp.path })
    expect(before.report.pipeline.Sourced).toBe(1)
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })

    const committed = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_priya" },
      to: "Screen",
      reason: "HIRING next",
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
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })

    const pushed = await DecisionVerbs.push({
      id: committed.changeset.id,
      cwd: tmp.path,
      dry_run: false,
    })
    expect(pushed.ok).toBe(true)
    if (pushed.ok) {
      const item = pushed.pushed[0]
      expect(item?.status).toBe("applied")
      if (item && (item.status === "stale" || "reason" in item)) {
        expect(item.reason).not.toBe("illegal_transition")
      }
    }
    expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Screen" })
    const after = await DecisionVerbs.status({ cwd: tmp.path })
    expect(after.report.pipeline.Sourced ?? 0).toBe(0)
    expect(after.report.pipeline.Screen).toBe((before.report.pipeline.Screen ?? 0) + 1)
  })
})
