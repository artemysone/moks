import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { CardWrite } from "../../src/product/card-write"
import { HiringFixtures } from "../../src/product/fixtures"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("parseWriteIntent detects score and draft, not other prompts", () => {
  expect(CardWrite.parseWriteIntent(undefined, "Score cand_priya")).toEqual({ kind: "score", hint: "Score cand_priya" })
  expect(CardWrite.parseWriteIntent(undefined, "Score this resume")).toEqual({ kind: "score", hint: "Score this resume" })
  expect(CardWrite.parseWriteIntent("score-candidate", "jordan-lee")).toEqual({ kind: "score", hint: "jordan-lee" })
  expect(CardWrite.parseWriteIntent(undefined, "Draft outreach for cand_priya")).toEqual({
    kind: "draft",
    hint: "Draft outreach for cand_priya",
  })
  expect(CardWrite.parseWriteIntent("draft", "")).toEqual({ kind: "draft", hint: "" })
  expect(CardWrite.parseWriteIntent(undefined, "Who is the hiring manager")).toBeUndefined()
  expect(CardWrite.parseWriteIntent("review", "Score this")).toBeUndefined()
  expect(CardWrite.parseWriteIntent(undefined, "please score this candidate using the score-candidate skill")?.kind).toBe(
    "score",
  )
})

test("writeOnCard scores from card + HIRING.md without inventing jobs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), await Bun.file(HiringFixtures.hiring).text())
      await Bun.write(path.join(dir, "candidates", "jordan-lee.md"), await Bun.file(HiringFixtures.card).text())
    },
  })
  const result = await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "Score jordan-lee" })
  expect(result.id).toBe("jordan-lee")
  const card = await CandidateCard.read(tmp.path, "jordan-lee")
  expect(typeof card?.score).toBe("number")
  expect(card?.score).toBeGreaterThanOrEqual(1)
  expect(card?.score).toBeLessThanOrEqual(5)
  expect(card?.body).toContain("# Score:")
  expect(card?.body).toContain("Meridian Fleet")
  expect(card?.body).toContain("candidates/jordan-lee.md")
  expect(card?.body).toContain("HIRING.md")
  expect(card?.body).not.toContain("Acme Corp")
})

test("writeOnCard draft adds Outreach and never claims send", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), await Bun.file(HiringFixtures.hiring).text())
      await Bun.write(path.join(dir, "candidates", "jordan-lee.md"), await Bun.file(HiringFixtures.card).text())
    },
  })
  await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "jordan-lee" })
  await CardWrite.writeOnCard(tmp.path, { kind: "draft", hint: "Draft outreach for jordan-lee" })
  const card = await CandidateCard.read(tmp.path, "jordan-lee")
  expect(typeof card?.score).toBe("number")
  expect(card?.body).toContain("# Score:")
  expect(card?.body).toContain("# Outreach")
  expect(card?.body).toContain("Draft only. Never sent.")
  expect(card?.body).not.toMatch(/sent the email|message was delivered/i)
})

test("thin pulled card scores without inventing employment history", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), ReqWorkspace.stubFor("Senior Backend"))
      await CandidateCard.write(dir, {
        id: "cand_priya",
        stage: "Sourced",
        source: "mock",
        extra: { name: "Priya Shah" },
        body: "# Priya Shah\n\nBackend engineer, fintech / ledger systems\n",
      })
    },
  })
  await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "Score cand_priya" })
  await CardWrite.writeOnCard(tmp.path, { kind: "draft", hint: "Draft outreach for cand_priya" })
  const card = await CandidateCard.read(tmp.path, "cand_priya")
  expect(typeof card?.score).toBe("number")
  expect(card?.body).toContain("# Score:")
  expect(card?.body).toContain("# Outreach")
  expect(card?.body).toContain("fintech / ledger systems")
  expect(card?.body).not.toContain("Meridian Fleet")
  expect(card?.body).not.toContain("Brightpaper")
  expect(card?.body).toContain("Never sent")
  expect(card?.body).toContain("Backend engineer, fintech / ledger systems")
  expect(card?.body).not.toContain('Your card notes: "| Senior')
})

test("writeOnCard without a target id refuses to pick the first card", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      await CandidateCard.write(dir, {
        id: "cand_priya",
        stage: "Sourced",
        extra: { name: "Priya Shah" },
        body: "# Priya\n",
      })
      await CandidateCard.write(dir, {
        id: "cand_amira",
        stage: "Rejected",
        extra: { name: "Amira" },
        body: "# Amira\n",
      })
      await CandidateCard.write(dir, {
        id: "cand_jordan",
        stage: "Screen",
        extra: { name: "Jordan" },
        body: "# Jordan\n",
      })
    },
  })
  await expect(CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "Score this resume" })).rejects.toThrow(
    /no target id — name one of: cand_jordan, cand_priya/,
  )
  await expect(CardWrite.writeOnCard(tmp.path, { kind: "draft", hint: "Draft outreach" })).rejects.toThrow(
    /no target id — name one of:/,
  )
  const priya = await CandidateCard.read(tmp.path, "cand_priya")
  expect(priya?.body).not.toContain("# Score:")
})

test("writeOnCard Score cand_nobody does not fall through to another card", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      await CandidateCard.write(dir, {
        id: "cand_priya",
        stage: "Sourced",
        extra: { name: "Priya Shah" },
        body: "# Priya\n",
      })
    },
  })
  await expect(CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "Score cand_nobody" })).rejects.toThrow(
    /unknown card: cand_nobody/,
  )
  const priya = await CandidateCard.read(tmp.path, "cand_priya")
  expect(priya?.body).not.toContain("# Score:")
})


test("writeOnCard outside a company directory points at --cwd/--dir", async () => {
  await using empty = await tmpdir()
  await expect(CardWrite.writeOnCard(empty.path, { kind: "score", hint: "cand_marcus" })).rejects.toThrow(
    /not a company directory.*--cwd\/--dir/,
  )
})

test("writeOnCard on a COMPANY.md stub points at --cwd/--dir", async () => {
  await using stub = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), ReqWorkspace.COMPANY_STUB)
    },
  })
  await expect(CardWrite.writeOnCard(stub.path, { kind: "score", hint: "cand_marcus" })).rejects.toThrow(
    /not a company directory.*--cwd\/--dir/,
  )
})

async function companyReq(dir: string, companyMd: string, hiringMd: string) {
  await Bun.write(path.join(dir, "COMPANY.md"), companyMd)
  const req = path.join(dir, "staff-platform")
  await Bun.write(path.join(req, "HIRING.md"), hiringMd)
  await CandidateCard.write(req, {
    id: "kenji-okada",
    stage: "Sourced",
    extra: { name: "Kenji Okada" },
    body: "# Kenji Okada\n\nStaff platform engineer. Payments edge and on-call.\n",
  })
  await ReqWorkspace.writeFocus(dir, "staff-platform")
}

test("same card + two COMPANY.md bars change score and draft", async () => {
  const hiring = [
    "# Staff Platform",
    "",
    "## Scorecard",
    "| Dimension | Bar | Notes |",
    "|-----------|-----|-------|",
    "| Systems design | owns a service | |",
    "",
  ].join("\n")
  await using first = await tmpdir({
    init: async (dir) => {
      await companyReq(
        dir,
        "# Acme\n\n## Bar\n- Written operators\n\n## Tone & outreach\n- Direct, no fluff\n\n## About\n- Payments infra\n",
        hiring,
      )
    },
  })
  await using second = await tmpdir({
    init: async (dir) => {
      await companyReq(
        dir,
        "# Acme\n\n## Bar\n- Ship weekly in public\n\n## Tone & outreach\n- Warm and specific\n\n## About\n- Consumer apps\n",
        hiring,
      )
    },
  })
  await CardWrite.writeOnCard(first.path, { kind: "score", hint: "kenji-okada" })
  await CardWrite.writeOnCard(first.path, { kind: "draft", hint: "kenji-okada" })
  await CardWrite.writeOnCard(second.path, { kind: "score", hint: "kenji-okada" })
  await CardWrite.writeOnCard(second.path, { kind: "draft", hint: "kenji-okada" })
  const a = await CandidateCard.read(path.join(first.path, "staff-platform"), "kenji-okada")
  const b = await CandidateCard.read(path.join(second.path, "staff-platform"), "kenji-okada")
  expect(a?.body).toContain("Written operators")
  expect(a?.body).not.toContain("Ship weekly in public")
  expect(b?.body).toContain("Ship weekly in public")
  expect(b?.body).not.toContain("Written operators")
  expect(a?.body).toContain("Direct, no fluff")
  expect(b?.body).toContain("Warm and specific")
  expect(a?.body).toContain("COMPANY.md")
  expect(a?.body).not.toContain("Acme Corp")
})

test("same card + two HIRING.md tables change score rows", async () => {
  const company = "# Acme\n\n## Bar\n- TBD\n"
  await using first = await tmpdir({
    init: async (dir) => {
      await companyReq(
        dir,
        company,
        [
          "# Staff Platform",
          "",
          "## Scorecard",
          "| Dimension | Bar | Notes |",
          "|-----------|-----|-------|",
          "| Ledger depth | designs a ledger | |",
          "",
        ].join("\n"),
      )
    },
  })
  await using second = await tmpdir({
    init: async (dir) => {
      await companyReq(
        dir,
        company,
        [
          "# Staff Platform",
          "",
          "## Scorecard",
          "| Dimension | Bar | Notes |",
          "|-----------|-----|-------|",
          "| Frontend craft | ships UI | |",
          "",
        ].join("\n"),
      )
    },
  })
  await CardWrite.writeOnCard(first.path, { kind: "score", hint: "kenji-okada" })
  await CardWrite.writeOnCard(second.path, { kind: "score", hint: "kenji-okada" })
  const a = await CandidateCard.read(path.join(first.path, "staff-platform"), "kenji-okada")
  const b = await CandidateCard.read(path.join(second.path, "staff-platform"), "kenji-okada")
  expect(a?.body).toContain("Ledger depth")
  expect(a?.body).not.toContain("Frontend craft")
  expect(b?.body).toContain("Frontend craft")
  expect(b?.body).not.toContain("Ledger depth")
  expect(a?.body).toContain("not on the card")
})
