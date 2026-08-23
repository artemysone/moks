import { expect, test } from "bun:test"
import path from "path"
import { Global } from "@moks/core/global"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionVerbs } from "../../src/decision/verbs"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function workspace() {
  return tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
    },
  })
}

async function moks(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, entry, ...args, "--cwd", cwd], {
    cwd,
    env: {
      ...process.env,
      MOKS_PURE: "1",
      MOKS_DISABLE_PROJECT_CONFIG: "1",
      MOKS_TEST_HOME: Global.Path.home,
      HOME: Global.Path.home,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr, combined: stdout + stderr }
}

test("review with no staged changesets is an honest empty", async () => {
  await using tmp = await workspace()
  await DecisionVerbs.pull({ cwd: tmp.path })
  const listed = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(listed.rows).toEqual([])
  const cli = await moks(["review"], tmp.path)
  expect(cli.code).toBe(0)
  expect(cli.combined).toContain("no staged changesets")
  expect(cli.combined).not.toMatch(/reviewed /)
})

test("review lists a staged note and inspect does not mutate", async () => {
  await using tmp = await workspace()
  await DecisionVerbs.pull({ cwd: tmp.path })
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "cand_priya" },
    reason: "tasting the PR",
    cwd: tmp.path,
  })
  const listed = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(listed.rows.some((row) => row.id === committed.changeset.id)).toBe(true)
  expect(listed.rows[0]?.rationale).toContain("tasting the PR")

  const shown = await DecisionVerbs.inspectReview({ id: committed.changeset.id, cwd: tmp.path })
  expect(shown.changeset.status).toBe("staged")
  expect(shown.changeset.rationale).toContain("tasting the PR")
  expect(shown.changeset.changes[0]?.mutation).toBe("AddNote")

  const cli = await moks(["review", committed.changeset.id], tmp.path)
  expect(cli.code).toBe(0)
  expect(cli.combined).toContain("tasting the PR")
  expect(cli.combined).toContain("AddNote")
  expect(cli.combined).toContain("approve will bless")
  expect(cli.combined).not.toMatch(/reviewed /)

  const after = await DecisionVerbs.inspectReview({ id: committed.changeset.id, cwd: tmp.path })
  expect(after.changeset.status).toBe("staged")
})

test("review --approve still applies", async () => {
  await using tmp = await workspace()
  await DecisionVerbs.pull({ cwd: tmp.path })
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "cand_priya" },
    reason: "bless this",
    cwd: tmp.path,
  })
  const cli = await moks(["review", committed.changeset.id, "--approve", "--by", "you"], tmp.path)
  expect(cli.code).toBe(0)
  expect(cli.combined).toMatch(/reviewed/)
  expect(cli.combined).toContain("approved")
  const shown = await DecisionVerbs.inspectReview({ id: committed.changeset.id, cwd: tmp.path })
  expect(shown.changeset.status).toBe("approved")
})

test("review shows AdvanceStage hop without rewriting the card", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "HIRING.md"),
        "# Role\n## Process\n- Stages: sourced → screen → phone → onsite → offer → hire\n",
      )
      await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
    },
  })
  await DecisionVerbs.pull({ cwd: tmp.path })
  const committed = await DecisionVerbs.commit({
    action: "advance",
    target: { kind: "candidate", id: "cand_priya" },
    to: "Screen",
    reason: "HIRING next",
    cwd: tmp.path,
  })
  expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })
  const shown = await DecisionVerbs.inspectReview({ id: committed.changeset.id, cwd: tmp.path })
  expect(shown.changeset.changes[0]?.mutation).toBe("AdvanceStage")
  expect(shown.changeset.changes[0]?.payload).toEqual(expect.objectContaining({ to: "Screen" }))
  expect(shown.cards[0]).toMatchObject({ id: "cand_priya", stage: "Sourced" })

  const cli = await moks(["review", committed.changeset.id], tmp.path)
  expect(cli.code).toBe(0)
  expect(cli.combined).toContain("AdvanceStage")
  expect(cli.combined).toContain("to Screen")
  expect(cli.combined).toContain("stage=Sourced")
  expect(cli.combined).toContain("approve will bless")
  expect(await CandidateCard.read(tmp.path, "cand_priya")).toMatchObject({ stage: "Sourced" })
})
