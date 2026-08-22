import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { ReqWorkspace } from "../../src/product/req-workspace"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function moks(args: string[], cwd: string, home: string, extraEnv: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
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
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    GITHUB_TOKEN: undefined,
    GH_TOKEN: undefined,
    ...extraEnv,
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd,
    env,
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

  test("headless model prompt with a dummy API key and no oauth fails fast", async () => {
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
      ["run", "--agent", "recruit", "--", "Who is the hiring manager"],
      company.path,
      home.path,
      { ANTHROPIC_API_KEY: "moks-verify-dummy-key" },
    )
    const elapsed = Date.now() - started
    expect(result.code).toBe(1)
    expect(result.combined).toMatch(/sign in \/ connect OAuth or ACP/i)
    expect(elapsed).toBeLessThan(15_000)
  }, 20_000)

  test("headless score and draft write onto a pulled card without a model", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    const env = { ANTHROPIC_API_KEY: "" }
    const init = await moks(["run", "--command", "init"], company.path, home.path, env)
    expect(init.code).toBe(0)
    const opened = await moks(["run", "--command", "open-req", "--", "Senior Backend"], company.path, home.path, env)
    expect(opened.code).toBe(0)
    const pulled = await moks(["pull", "--cwd", company.path], company.path, home.path, env)
    expect(pulled.code).toBe(0)
    expect(pulled.combined).toMatch(/5 candidates/)

    const started = Date.now()
    const scored = await moks(
      ["run", "--agent", "recruit", "--", "Score cand_priya"],
      company.path,
      home.path,
      env,
    )
    const draft = await moks(
      ["run", "--agent", "recruit", "--", "Draft outreach for cand_priya"],
      company.path,
      home.path,
      env,
    )
    const elapsed = Date.now() - started
    expect(scored.code).toBe(0)
    expect(draft.code).toBe(0)
    expect(elapsed).toBeLessThan(15_000)
    expect(scored.combined).not.toContain("Unexpected error")
    expect(draft.combined).toContain("not sent")

    const card = await Bun.file(path.join(company.path, "senior-backend", "candidates", "cand-priya.md")).text()
    expect(card).toMatch(/^---[\s\S]*score:\s*\d+/m)
    expect(card).toContain("# Score")
    expect(card).toContain("# Outreach")
    expect(card).toContain("Priya Shah")
    expect(card).not.toContain("Meridian Fleet")
    expect(card).toContain("Never sent")
  }, 20_000)

  async function snapshotCards(company: string) {
    const dir = path.join(company, "senior-backend", "candidates")
    const names = (await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: dir }))).toSorted()
    const files: Record<string, string> = {}
    for (const name of names) {
      files[name] = await Bun.file(path.join(dir, name)).text()
    }
    return files
  }

  test("no-id Score/Draft with 2+ scoreable cards exits 1, names cards, writes nothing", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    const env = { ANTHROPIC_API_KEY: "" }
    expect((await moks(["run", "--command", "init"], company.path, home.path, env)).code).toBe(0)
    expect((await moks(["run", "--command", "open-req", "--", "Senior Backend"], company.path, home.path, env)).code).toBe(0)
    expect((await moks(["pull", "--cwd", company.path], company.path, home.path, env)).code).toBe(0)
    const before = await snapshotCards(company.path)

    const score = await moks(["run", "--", "Score this resume"], company.path, home.path, env)
    expect(score.code).toBe(1)
    expect(score.stderr + score.stdout).toMatch(/no target id — name one of:/)
    expect(score.combined).toMatch(/cand_/)
    expect(score.combined).not.toMatch(/Rejected|cand_amira/)
    expect(score.combined).not.toMatch(/score: wrote/)

    const draft = await moks(["run", "--", "Draft outreach"], company.path, home.path, env)
    expect(draft.code).toBe(1)
    expect(draft.combined).toMatch(/no target id — name one of:/)
    expect(draft.combined).not.toMatch(/draft: wrote/)

    expect(await snapshotCards(company.path)).toEqual(before)
  }, 20_000)

  test("specified missing id Score/Draft exits 1 and does not write another card", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    const env = { ANTHROPIC_API_KEY: "" }
    expect((await moks(["run", "--command", "init"], company.path, home.path, env)).code).toBe(0)
    expect((await moks(["run", "--command", "open-req", "--", "Senior Backend"], company.path, home.path, env)).code).toBe(0)
    expect((await moks(["pull", "--cwd", company.path], company.path, home.path, env)).code).toBe(0)
    const before = await snapshotCards(company.path)

    const score = await moks(["run", "--", "Score cand_nobody"], company.path, home.path, env)
    expect(score.code).toBe(1)
    expect(score.combined).toMatch(/unknown card: cand_nobody/)
    expect(score.combined).not.toMatch(/score: wrote/)

    const draft = await moks(["run", "--", "Draft outreach for cand_nobody"], company.path, home.path, env)
    expect(draft.code).toBe(1)
    expect(draft.combined).toMatch(/unknown card: cand_nobody/)
    expect(draft.combined).not.toMatch(/draft: wrote/)

    expect(await snapshotCards(company.path)).toEqual(before)
  }, 20_000)

  test("run --cwd aliases --dir; status --dir aliases --cwd; review has no Unexpected error prefix", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    await using other = await tmpdir()
    const env = { ANTHROPIC_API_KEY: "" }
    expect((await moks(["run", "--command", "init"], company.path, home.path, env)).code).toBe(0)
    expect((await moks(["run", "--command", "open-req", "--", "Senior Backend"], company.path, home.path, env)).code).toBe(0)
    expect((await moks(["pull", "--dir", company.path], other.path, home.path, env)).code).toBe(0)

    const scored = await moks(
      ["run", "--cwd", company.path, "--agent", "recruit", "--", "Score cand_priya"],
      other.path,
      home.path,
      env,
    )
    expect(scored.code).toBe(0)
    expect(scored.combined).toContain("score:")

    const silent = await moks(
      ["run", "--dir", company.path, "--agent", "recruit", "--", "Score this resume"],
      other.path,
      home.path,
      env,
    )
    expect(silent.code).toBe(1)
    expect(silent.combined).toMatch(/no target id — name one of:/)
    expect(silent.combined).not.toMatch(/score: wrote/)

    const statusDir = await moks(["status", "--dir", company.path, "--json"], other.path, home.path, env)
    expect(statusDir.code).toBe(0)
    expect(statusDir.stdout).toContain(company.path)

    const statusWrong = await moks(["status", "--json"], other.path, home.path, env)
    expect(statusWrong.code).toBe(1)
    expect(statusWrong.combined).toMatch(/not a company directory|no ledger|empty company/)

    const activityWrong = await moks(["activity"], other.path, home.path, env)
    expect(activityWrong.code).toBe(1)
    expect(activityWrong.combined).toMatch(/not a company directory|pass --cwd\/--dir/)
    expect(activityWrong.combined).not.toMatch(/Signal: quiet/)

    const logWrong = await moks(["log"], other.path, home.path, env)
    expect(logWrong.code).toBe(1)
    expect(logWrong.combined).toMatch(/not a company directory|pass --cwd\/--dir/)
    expect(logWrong.combined).not.toMatch(/log empty/)

    const scoreWrong = await moks(
      ["run", "--command", "score", "--", "cand_marcus"],
      other.path,
      home.path,
      env,
    )
    expect(scoreWrong.code).toBe(1)
    expect(scoreWrong.combined).toMatch(/not a company directory|pass --cwd\/--dir/)
    expect(scoreWrong.combined).not.toMatch(/no focused req/)

    const pullWrong = await moks(["pull"], other.path, home.path, env)
    expect(pullWrong.code).toBe(1)
    expect(pullWrong.combined).toMatch(/not a company directory|pass --cwd\/--dir/)
    expect(await Bun.file(path.join(other.path, ".moks", "ledger.sqlite")).exists()).toBe(false)

    const diffWrong = await moks(["diff"], other.path, home.path, env)
    expect(diffWrong.code).toBe(1)
    expect(diffWrong.combined).toMatch(/not a company directory|pass --cwd\/--dir|empty company/)
    expect(diffWrong.combined).not.toMatch(/no staged or approved/)

    const pushWrong = await moks(["push"], other.path, home.path, env)
    expect(pushWrong.code).toBe(1)
    expect(pushWrong.combined).toMatch(/not a company directory|pass --cwd\/--dir|empty company/)
    expect(pushWrong.combined).not.toMatch(/nothing to push/)


    const reviewed = await moks(["review", "not-a-changeset"], company.path, home.path, env)
    expect(reviewed.code).toBe(1)
    const first = reviewed.combined.trim().split(/\n/).find((line) => line.trim())
    expect(first).toBeDefined()
    expect(first).not.toMatch(/Unexpected error/)
    expect(reviewed.combined).toContain("moks review requires --approve or --reject")

    const noted = await moks(
      ["commit", "--action", "note", "--target-id", "cand_priya", "--body", "from score", "--cwd", company.path],
      other.path,
      home.path,
      env,
    )
    expect(noted.code).toBe(0)
    expect(noted.combined).not.toContain("rationale is required")

    const defaultNote = await moks(
      ["commit", "--action", "note", "--target-id", "cand_priya", "--cwd", company.path],
      other.path,
      home.path,
      env,
    )
    expect(defaultNote.code).toBe(0)
    expect(defaultNote.combined).not.toContain("rationale is required")
    expect(defaultNote.combined).not.toContain("AddNote requires")

    const advanced = await moks(
      ["commit", "--action", "advance", "--target-id", "cand_priya", "--reason", "hop", "--cwd", company.path],
      other.path,
      home.path,
      env,
    )
    expect(advanced.code).toBe(1)
    expect(advanced.combined).toMatch(/--to/)
    expect(advanced.combined).toMatch(/legal next/)
    expect(advanced.combined).not.toContain("Unexpected error")

    const pushed = await moks(["push", "--cwd", company.path], other.path, home.path, env)
    expect(pushed.code).toBe(1)
    expect(pushed.combined).toMatch(/0 approved, \d+ staged — review first/)
    expect(pushed.combined).not.toContain("nothing to push")
  }, 30_000)

  test("run --command foobar fails locally without OAuth", async () => {
    await using company = await tmpdir()
    await using home = await tmpdir()
    const started = Date.now()
    const result = await moks(["run", "--command", "foobar"], company.path, home.path, {
      ANTHROPIC_API_KEY: "",
    })
    expect(result.code).toBe(1)
    expect(result.combined).toMatch(/unknown command: foobar/)
    expect(result.combined).toMatch(/init \/ open-req \/ score \/ draft/)
    expect(result.combined).not.toMatch(/sign in \/ connect OAuth or ACP/i)
    expect(Date.now() - started).toBeLessThan(8_000)
  }, 15_000)

})
