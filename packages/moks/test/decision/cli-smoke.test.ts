import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@moks/core/global"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
  const out = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  const stdout = out[0]
  const stderr = out[1]
  const code = out[2]
  const parsed = (() => {
    if (!stdout.trim()) return
    return JSON.parse(stdout) as unknown
  })()
  return { code, stdout, stderr, json: parsed }
}

describe("decision cli smoke", () => {
  test("pull → commit → review → push adverse needs confirm → push with confirm", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      },
    })

    const pulled = await moks(["pull"], tmp.path)
    expect(pulled.code).toBe(0)

    const committed = await moks(
      ["commit", "--action", "reject", "--target-id", "cand_priya", "--reason", "fit"],
      tmp.path,
    )
    expect(committed.code).toBe(0)
    const commitId = (committed.json as { changeset: { id: string } }).changeset.id
    expect(commitId).toMatch(ID)

    const reviewed = await moks(["review", commitId, "--approve", "--by", "you"], tmp.path)
    expect(reviewed.code).toBe(0)

    const blocked = await moks(["push", "--commit-id", commitId], tmp.path)
    expect(blocked.code).toBe(2)
    expect((blocked.json as { error: string }).error).toBe("needs_confirm")

    const pushed = await moks(["push", "--commit-id", commitId, "--confirm", "--execute"], tmp.path)
    expect(pushed.code).toBe(0)
    expect((pushed.json as { ok: boolean; dry_run: boolean }).ok).toBe(true)
    expect((pushed.json as { dry_run: boolean }).dry_run).toBe(false)

    const status = await moks(["status", "--limit", "10"], tmp.path)
    expect(status.code).toBe(0)
    expect((status.json as { report: { changesets: { applied: number } } }).report.changesets.applied).toBe(1)
    expect((status.json as { open: unknown[] }).open).toEqual([])
  }, 30_000)
})
