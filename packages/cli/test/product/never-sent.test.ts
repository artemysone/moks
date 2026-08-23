import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { CardWrite } from "../../src/product/card-write"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function moks(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd,
    env: {
      ...process.env,
      MOKS_PURE: "1",
      MOKS_DISABLE_PROJECT_CONFIG: "1",
      MOKS_DISABLE_AUTOUPDATE: "1",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, combined: stdout + stderr }
}

test("parseSendIntent catches send/mail/outreach-for-real, not draft", () => {
  expect(CardWrite.parseSendIntent("send", "kenji")).toEqual({ hint: "kenji" })
  expect(CardWrite.parseSendIntent("mail", "")?.hint).toBe("mail")
  expect(CardWrite.parseSendIntent(undefined, "send this to kenji")?.hint).toMatch(/send this/)
  expect(CardWrite.parseSendIntent(undefined, "email kenji the outreach")?.hint).toMatch(/email kenji/)
  expect(CardWrite.parseSendIntent(undefined, "outreach for real")?.hint).toMatch(/outreach for real/)
  expect(CardWrite.parseSendIntent(undefined, "please send the email")).toBeDefined()
  expect(CardWrite.parseSendIntent(undefined, "draft outreach for kenji")).toBeUndefined()
  expect(CardWrite.parseSendIntent(undefined, "get kenji ready")).toBeUndefined()
  expect(CardWrite.parseNaturalWorkIntent(undefined, "send this to kenji", "recruit")).toBeUndefined()
  expect(CardWrite.parseWriteIntent(undefined, "send this email")).toBeUndefined()
})

test("recruit send exits loud and does not claim a send", async () => {
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
  const before = await CandidateCard.read(tmp.path, "kenji-sato")
  const result = await moks(["run", "--agent", "recruit", "--", "send this to kenji"], tmp.path)
  expect(result.code).toBe(1)
  expect(result.combined).toContain("Draft only. Never sent.")
  expect(result.combined).toMatch(/we don't send|recruit never emails/i)
  expect(result.combined).not.toMatch(/sent the email|message was delivered|mailed/i)
  expect(result.combined).not.toMatch(/sign in \/ connect OAuth or ACP/i)
  const after = await CandidateCard.read(tmp.path, "kenji-sato")
  expect(after?.body).toBe(before?.body)
  expect(after?.body).not.toMatch(/sent the email|message was delivered/i)
})

test("moks send and mail fail loud", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
    },
  })
  for (const verb of ["send", "mail", "outreach-for-real"]) {
    const result = await moks([verb], tmp.path)
    expect(result.code).toBe(1)
    expect(result.combined).toContain("Draft only. Never sent.")
    expect(result.combined).not.toMatch(/unknown command: /)
  }
})

test("leftover-ledger and empty cwd still fail loud on send", async () => {
  await using empty = await tmpdir()
  const emptyRun = await moks(["run", "--agent", "recruit", "--", "send this"], empty.path)
  expect(emptyRun.code).toBe(1)
  expect(emptyRun.combined).toMatch(/not a company directory/)
  await using leftover = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, ".moks", "ledger.sqlite"), "")
    },
  })
  const leftoverRun = await moks(["run", "--agent", "recruit", "--", "email kenji"], leftover.path)
  expect(leftoverRun.code).toBe(1)
  expect(leftoverRun.combined).toMatch(/not a company directory/)
})
