import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { ReqWorkspace } from "../../src/product/req-workspace"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function moks(args: string[], cwd: string, home: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd,
    env: {
      ...process.env,
      MOKS_PURE: "1",
      MOKS_DISABLE_PROJECT_CONFIG: "1",
      MOKS_DISABLE_AUTOUPDATE: "1",
      MOKS_DISABLE_AUTOCOMPACT: "1",
      MOKS_DISABLE_MODELS_FETCH: "1",
      MOKS_TEST_HOME: home,
      HOME: home,
      PWD: cwd,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local/share"),
      XDG_STATE_HOME: path.join(home, ".local/state"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      ...extraEnv,
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

describe("cli dogfood", () => {
  test("run --command init on an empty folder scaffolds and exits", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    const started = Date.now()
    const result = await moks(["run", "--command", "init"], company.path, home.path)
    const elapsed = Date.now() - started
    expect(result.code).toBe(0)
    expect(result.combined).not.toContain("Unexpected error")
    expect(await Bun.file(path.join(company.path, "COMPANY.md")).text()).toBe(ReqWorkspace.COMPANY_STUB)
    expect(await Bun.file(path.join(company.path, ".moks", "ledger.sqlite")).exists()).toBe(true)
    expect(await Bun.file(path.join(company.path, "HIRING.md")).exists()).toBe(false)
    expect(elapsed).toBeLessThan(15_000)
  }, 20_000)

  test("run --command open-req with a quoted title writes HIRING.md without wrapping quotes", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    const result = await moks(["run", "--command", "open-req", "--", '"Founding Engineer"'], company.path, home.path)
    expect(result.code).toBe(0)
    const hiring = await Bun.file(path.join(company.path, "founding-engineer", "HIRING.md")).text()
    expect(hiring.startsWith("# Founding Engineer\n")).toBe(true)
    expect(hiring).not.toContain('# "Founding Engineer"')
    expect(await Bun.file(path.join(company.path, "COMPANY.md")).exists()).toBe(true)
    expect(await ReqWorkspace.readFocus(company.path)).toBe("founding-engineer")
  }, 20_000)

  test("commit --action reject on an already-Rejected candidate names the stage", async () => {
    await using company = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      },
    })
    await using home = await tmpdir()
    const pulled = await moks(["pull", "--cwd", company.path], company.path, home.path)
    expect(pulled.code).toBe(0)

    const rejected = await moks(
      ["commit", "--action", "reject", "--target-id", "cand_amira", "--reason", "already out", "--cwd", company.path],
      company.path,
      home.path,
    )
    expect(rejected.code).toBe(1)
    expect(rejected.combined).toContain("cannot reject cand_amira: current stage is Rejected")
    expect(rejected.combined).toContain("try --target-id ")
    expect(rejected.combined).toMatch(/--target-id cand_[a-z]+ \(stage /)
    expect(rejected.combined).not.toContain("Unexpected error")
    expect(rejected.combined).not.toContain("\u2192")
  }, 20_000)

  test("headless score with a dummy API key and no oauth fails fast", async () => {
    await using company = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "COMPANY.md"), "# Co\n")
        await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
        await Bun.write(path.join(dir, "candidates", "jordan-lee.md"), "# Jordan Lee\n")
      },
    })
    await using home = await tmpdir()
    const started = Date.now()
    const result = await moks(
      ["run", "--agent", "recruit", "--", "Score this resume"],
      company.path,
      home.path,
      { ANTHROPIC_API_KEY: "moks-verify-dummy-key" },
    )
    const elapsed = Date.now() - started
    expect(result.code).toBe(1)
    expect(result.combined).toMatch(/sign in \/ connect OAuth or ACP/i)
    expect(elapsed).toBeLessThan(15_000)
  }, 20_000)
})
