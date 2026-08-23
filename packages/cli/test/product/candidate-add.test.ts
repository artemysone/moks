import { expect, test } from "bun:test"
import path from "path"
import { Global } from "@moks/core/global"
import { DecisionVerbs } from "../../src/decision/verbs"
import { CandidateAdd } from "../../src/product/candidate-add"
import { CandidateCard } from "../../src/product/candidate-card"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"
import { withLedger } from "../../src/decision/session"

test("parseAddIntent detects add-candidate command and prose", () => {
  expect(CandidateAdd.parseAddIntent("add-candidate", "sam-chen.md")).toEqual({ file: "sam-chen.md" })
  expect(CandidateAdd.parseAddIntent("add-candidate", "", [" /tmp/resume.md "])).toEqual({ file: "/tmp/resume.md" })
  expect(CandidateAdd.parseAddIntent(undefined, "Add candidate from resumes/sam-chen.md")).toEqual({
    file: "resumes/sam-chen.md",
  })
  expect(CandidateAdd.parseAddIntent(undefined, "Who is the hiring manager")).toBeUndefined()
  expect(CandidateAdd.parseAddIntent("score", "resume.md")).toBeUndefined()
})

test("addFromFile writes a Sourced card from a local resume only", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(
        path.join(dir, "sam-chen-resume.md"),
        ["# Sam Chen", "", "Platform engineer. Owns on-call for payments edge.", "", "- Rust and Go services", ""].join(
          "\n",
        ),
      )
    },
  })
  const result = await CandidateAdd.addFromFile(tmp.path, "sam-chen-resume.md")
  expect(result.id).toBe("sam-chen")
  expect(result.name).toBe("Sam Chen")
  expect(result.stage).toBe("Sourced")
  const packet = path.join(tmp.path, "staff-platform")
  const card = await CandidateCard.read(packet, "sam-chen")
  expect(card?.stage).toBe("Sourced")
  expect(card?.source).toBe("file")
  expect(card?.extra.name).toBe("Sam Chen")
  expect(card?.body).toContain("Platform engineer. Owns on-call for payments edge.")
  expect(card?.body).toContain("Rust and Go services")
  expect(card?.body).not.toContain("Priya")
  expect(card?.body).not.toContain("Meridian Fleet")
  expect(card?.body).not.toContain("Northline")
})

test("addFromFile refuses to invent a name when the file is empty", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
    },
  })
  await expect(CandidateAdd.addFromFile(tmp.path, "missing.md")).rejects.toThrow(/cannot read resume/)
})

test("addFromFile requires a focused req and refuses overwrite", async () => {
  await using empty = await tmpdir()
  await expect(CandidateAdd.addFromFile(empty.path, "resume.md")).rejects.toThrow(/no focused req/)

  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "resume.md"), "# Sam Chen\n\nRust.\n")
    },
  })
  await CandidateAdd.addFromFile(tmp.path, "resume.md")
  await expect(CandidateAdd.addFromFile(tmp.path, "resume.md")).rejects.toThrow(/already exists/)
})

test("addFromFile registers the card id so commit --action note resolves it", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "kenji-okada.md"), "# Kenji Okada\n\nStaff platform engineer.\n")
    },
  })
  const added = await CandidateAdd.addFromFile(tmp.path, "kenji-okada.md")
  expect(added.id).toBe("kenji-okada")
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: added.id },
    reason: "sourced locally",
    cwd: tmp.path,
  })
  expect(committed.changeset.id).toBeDefined()
})

test("pull after add-candidate keeps the local card in status", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "kenji-okada.md"), "# Kenji Okada\n\nStaff platform.\n")
    },
  })
  await CandidateAdd.addFromFile(tmp.path, "kenji-okada.md")
  await DecisionVerbs.pull({ cwd: tmp.path })
  const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
  expect(st.report.candidates).toBeGreaterThanOrEqual(6)
  const packet = path.join(tmp.path, "staff-platform")
  const card = await CandidateCard.read(packet, "kenji-okada")
  expect(card?.id).toBe("kenji-okada")
  expect(card?.body).toContain("Kenji Okada")
})



test("addFromFile seeds mock ATS and inserts the local candidate (not a seed id)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "kenji-okada.md"), "# Kenji Okada\n\nStaff platform.\n")
    },
  })
  await CandidateAdd.addFromFile(tmp.path, "kenji-okada.md")
  await withLedger(tmp.path, async (handle) => {
    const row = handle.mockDb.prepare("SELECT id, name FROM candidates WHERE id = ?").get("kenji-okada") as
      | { id: string; name: string }
      | undefined
    expect(row).toEqual({ id: "kenji-okada", name: "Kenji Okada" })
    const app = handle.mockDb.prepare("SELECT id, candidate_id, stage FROM applications WHERE candidate_id = ?").get(
      "kenji-okada",
    ) as { id: string; candidate_id: string; stage: string } | undefined
    expect(app?.id).toBe("app_kenji-okada")
    expect(app?.stage).toBe("Sourced")
    expect(handle.mockDb.prepare("SELECT id FROM candidates WHERE id = ?").get("cand_jane")).toBeDefined()
  })
})

test("add-candidate refuses a mock seed id", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(
        path.join(dir, "jane.md"),
        ["---", "id: cand_jane", "name: Jane Clone", "---", "", "# Jane Clone", ""].join("\n"),
      )
    },
  })
  await expect(CandidateAdd.addFromFile(tmp.path, "jane.md")).rejects.toThrow(/not a mock ATS id/)
})

test("Reviewer path: add-candidate then HIRING Screen hop push apply", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "HIRING.md"),
        "# Role\n## Process\n- Stages: sourced → screen → phone → onsite → offer → hire\n",
      )
      await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
      await Bun.write(path.join(dir, "kenji-okada.md"), "# Kenji Okada\n\nStaff platform.\n")
    },
  })
  const added = await CandidateAdd.addFromFile(tmp.path, "kenji-okada.md")
  expect(added.id).toBe("kenji-okada")
  const committed = await DecisionVerbs.commit({
    action: "advance",
    target: { kind: "candidate", id: "kenji-okada" },
    to: "Screen",
    reason: "HIRING next",
    cwd: tmp.path,
  })
  expect(await CandidateCard.read(tmp.path, "kenji-okada")).toMatchObject({ stage: "Sourced" })
  if (committed.changeset.status === "staged") {
    await DecisionVerbs.review({
      id: committed.changeset.id,
      action: "approve",
      by: "you",
      cwd: tmp.path,
    })
  }
  expect(await CandidateCard.read(tmp.path, "kenji-okada")).toMatchObject({ stage: "Sourced" })
  const pushed = await DecisionVerbs.push({
    id: committed.changeset.id,
    cwd: tmp.path,
    dry_run: false,
  })
  expect(pushed.ok).toBe(true)
  if (pushed.ok) {
    expect(pushed.pushed[0]?.status).toBe("applied")
    if (pushed.pushed[0] && "reason" in pushed.pushed[0]) {
      expect(pushed.pushed[0].reason).not.toMatch(/unknown_entity/)
    }
  }
  expect(await CandidateCard.read(tmp.path, "kenji-okada")).toMatchObject({ stage: "Screen" })
  const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
  expect(st.report.pipeline.Screen).toBeGreaterThanOrEqual(1)
  await DecisionVerbs.pull({ cwd: tmp.path })
  expect(await CandidateCard.read(tmp.path, "kenji-okada")).toMatchObject({
    id: "kenji-okada",
    stage: "Screen",
  })
})

test("add-candidate after pull registers nora-voss for commit", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "nora-voss.md"), "# Nora Voss\n\nPlatform engineer.\n")
    },
  })
  await DecisionVerbs.pull({ cwd: tmp.path })
  const added = await CandidateAdd.addFromFile(tmp.path, "nora-voss.md")
  expect(added.id).toBe("nora-voss")
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "nora-voss" },
    reason: "sourced locally",
    cwd: tmp.path,
  })
  expect(committed.changeset.id).toBeDefined()
  const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
  expect(st.report.candidates).toBeGreaterThanOrEqual(6)
})

test("pull adopts a disk card so commit --target-id matches Score", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await CandidateCard.write(path.join(dir, "staff-platform"), {
        id: "kenji-okada",
        stage: "Sourced",
        extra: { name: "Kenji Okada" },
        body: "# Kenji Okada\n\nStaff platform.\n",
      })
    },
  })
  await DecisionVerbs.pull({ cwd: tmp.path })
  const committed = await DecisionVerbs.commit({
    action: "note",
    target: { kind: "candidate", id: "kenji-okada" },
    reason: "on disk",
    cwd: tmp.path,
  })
  expect(committed.changeset.id).toBeDefined()
  const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
  expect(st.report.candidates).toBeGreaterThanOrEqual(6)
})

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function moks(args: string[], cwd: string) {
  const flags = args[0] === "add-candidate" ? ["--json"] : ["--json", "--cwd", cwd]
  const proc = Bun.spawn([process.execPath, entry, ...args, ...flags], {
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

test("headless add-candidate then commit --action note --target-id exits 0", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await ReqWorkspace.scaffoldReq(dir, "Staff Platform")
      await ReqWorkspace.writeFocus(dir, "staff-platform")
      await Bun.write(path.join(dir, "kenji-okada.md"), "# Kenji Okada\n\nStaff platform.\n")
    },
  })
  const added = await moks(["add-candidate", "kenji-okada.md"], tmp.path)
  expect(added.code).toBe(0)
  expect(added.stdout + added.stderr).toContain("kenji-okada")
  const committed = await moks(
    ["commit", "--action", "note", "--target-id", "kenji-okada", "--reason", "sourced locally"],
    tmp.path,
  )
  expect(committed.code).toBe(0)
  expect(committed.combined).not.toMatch(/unknown entity/)
  const pulled = await moks(["pull"], tmp.path)
  expect(pulled.code).toBe(0)
  const status = await moks(["status", "--json"], tmp.path)
  expect(status.code).toBe(0)
  const json = JSON.parse(status.stdout) as { report: { candidates: number } }
  expect(json.report.candidates).toBeGreaterThanOrEqual(6)
}, 20_000)
