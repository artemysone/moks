import { describe, expect, test } from "bun:test"
import path from "path"
import { DecisionActivity } from "../../src/decision/activity"
import { DecisionVerbs } from "../../src/decision/verbs"
import { Global } from "@moks/core/global"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function workspace() {
  return tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
    },
  })
}

async function moks(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, entry, ...args, "--json", "--cwd", cwd], {
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
  const out = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  const stdout = out[0]
  const code = out[1]
  const parsed = (() => {
    if (!stdout.trim()) return
    return JSON.parse(stdout) as unknown
  })()
  return { code, stdout, json: parsed }
}

describe("decision/activity", () => {
  test("empty → quiet", async () => {
    await using tmp = await tmpdir()
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7 })
    expect(summary.signal).toBe("quiet")
    expect(summary.commits).toBe(0)
    expect(summary.pushes).toBe(0)
    expect(summary.active_days).toBe(0)
    expect(summary.open_commits).toBe(0)
    expect(summary.days).toBe(7)
    expect(summary.path).toBe(tmp.path)
    expect(summary.real_req_note.length).toBeGreaterThan(0)
  })

  test("commit in window → active", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.pull({ cwd: tmp.path })
    await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "spoke",
      cwd: tmp.path,
    })
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7 })
    expect(summary.signal).toBe("active")
    expect(summary.commits).toBe(1)
    expect(summary.active_days).toBe(1)
    expect(summary.open_commits).toBe(1)
  })

  test("changesets outside the window are ignored", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.pull({ cwd: tmp.path })
    await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "spoke",
      cwd: tmp.path,
    })
    const now = new Date("2020-01-08T12:00:00.000Z")
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7, now })
    expect(summary.signal).toBe("quiet")
    expect(summary.commits).toBe(0)
  })

  test("counts applied pushes and unpushed adverse changesets in window", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.pull({ cwd: tmp.path })
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
    await DecisionVerbs.push({ id: committed.changeset.id, cwd: tmp.path, dry_run: false })
    await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_marcus" },
      reason: "pass",
      cwd: tmp.path,
    })
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7 })
    expect(summary.commits).toBe(2)
    expect(summary.pushes).toBe(1)
    expect(summary.needs_confirm).toBe(1)
    expect(summary.adverse_commits).toBe(1)
    expect(summary.open_commits).toBe(1)
    expect(summary.signal).toBe("active")
  })

  test("activity --json CLI smoke", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.pull({ cwd: tmp.path })
    await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_priya" },
      reason: "spoke",
      cwd: tmp.path,
    })
    const result = await moks(["activity", "--days", "7"], tmp.path)
    expect(result.code).toBe(0)
    const json = result.json as {
      days: number
      commits: number
      signal: string
      path: string
      real_req_note: string
    }
    expect(json.days).toBe(7)
    expect(json.commits).toBe(1)
    expect(json.signal).toBe("active")
    expect(json.path).toBe(tmp.path)
    expect(json.real_req_note).toContain("ATS req")
  })
})
