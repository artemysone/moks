import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { CardWrite } from "../../src/product/card-write"
import { DecisionVerbs } from "../../src/decision/verbs"
import { CompanyToneFixtures, HiringFixtures } from "../../src/product/fixtures"
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
  expect(outreachEmail(a?.body ?? "")).not.toContain("Written operators")
  expect(outreachEmail(b?.body ?? "")).not.toContain("Ship weekly in public")
  expect(a?.body).not.toContain("Company bar from")
  expect(a?.body).not.toContain("Tone from")
  expect(a?.body).not.toContain("Direct, no fluff")
  expect(b?.body).not.toContain("Warm and specific")
  expect(a?.body).toContain("COMPANY.md")
  expect(a?.body).not.toContain("Acme Corp")
  expect(a?.body).not.toContain("We hire against:")
  expect(b?.body).not.toContain("We hire against:")
})

function outreachEmail(body: string) {
  return (body.split("## Email")[1] ?? "").split("## LinkedIn")[0] ?? ""
}

test("same card + two COMPANY.md tones change greeting, voice, and ask", async () => {
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
      await companyReq(dir, await Bun.file(CompanyToneFixtures.terse).text(), hiring)
    },
  })
  await using second = await tmpdir({
    init: async (dir) => {
      await companyReq(dir, await Bun.file(CompanyToneFixtures.warm).text(), hiring)
    },
  })
  await CardWrite.writeOnCard(first.path, { kind: "draft", hint: "kenji-okada" })
  await CardWrite.writeOnCard(second.path, { kind: "draft", hint: "kenji-okada" })
  const a = await CandidateCard.read(path.join(first.path, "staff-platform"), "kenji-okada")
  const b = await CandidateCard.read(path.join(second.path, "staff-platform"), "kenji-okada")
  const terse = outreachEmail(a?.body ?? "")
  const warm = outreachEmail(b?.body ?? "")
  expect(terse).toContain("Okada,")
  expect(terse).not.toContain("Hi Kenji")
  expect(warm).toContain("Hi Kenji —")
  expect(warm).not.toContain("Okada,")
  expect(terse).toContain("15 minutes on the role. Yes or no is fine.")
  expect(warm).toContain("If a short conversation would be useful, I'm around this week — no pitch deck.")
  expect(terse).not.toContain("Would you be open to a short conversation about the role?")
  expect(warm).not.toContain("Would you be open to a short conversation about the role?")
  expect(terse).toContain("Regards,")
  expect(warm).toContain("Talk soon if that's useful,")
  expect(terse).not.toContain("Talk soon if that's useful,")
  expect(warm).not.toContain("Regards,")
  expect(terse).not.toContain("We hire against")
  expect(warm).not.toContain("We hire against")
  expect(terse).not.toContain("industry-leading")
  expect(warm).not.toContain("industry-leading")
  expect(terse).not.toContain("Bar: Written operators")
  expect(warm).not.toContain("Ship weekly in public")
  expect(terse).not.toBe(warm)
  expect(a?.body).toContain("Payments edge and on-call")
  expect(b?.body).toContain("Payments edge and on-call")
  expect(a?.body).not.toContain("Acme Corp")
  expect(a?.body).not.toContain("Meridian Fleet")
})


test("Kenji Sato + COMPANY constitution does not paste bar or slogan into the draft", async () => {
  const hiring = [
    "# Staff Platform",
    "",
    "## Scorecard",
    "| Dimension | Bar | Notes |",
    "|-----------|-----|-------|",
    "| Systems design | owns a service | |",
    "",
  ].join("\n")
  const constitution = [
    "# Company",
    "",
    "## About",
    "- Payments infra",
    "",
    "## Bar",
    "- Written operators who leave a paper trail",
    "",
    "## Tone",
    "- Short. Concrete. No theater.",
    "- Draft only. Never sent.",
    "- Warm and specific",
    "",
    "## Policy",
    "- Draft only. Never sent.",
    "",
  ].join("\n")
  await using first = await tmpdir({
    init: async (dir) => {
      await companyReq(dir, constitution, hiring)
    },
  })
  await using second = await tmpdir({
    init: async (dir) => {
      await companyReq(
        dir,
        "# Company\n\n## Tone\n- Terse, formal\n- Direct, no fluff\n\n## Bar\n- Ship weekly in public\n",
        hiring,
      )
    },
  })
  await CandidateCard.write(path.join(first.path, "staff-platform"), {
    id: "kenji-sato",
    stage: "Sourced",
    extra: { name: "Kenji Sato" },
    body: "# Kenji Sato\n\nStaff platform engineer. Payments edge and on-call.\n",
  })
  await CandidateCard.write(path.join(second.path, "staff-platform"), {
    id: "kenji-sato",
    stage: "Sourced",
    extra: { name: "Kenji Sato" },
    body: "# Kenji Sato\n\nStaff platform engineer. Payments edge and on-call.\n",
  })
  await CardWrite.writeOnCard(first.path, { kind: "draft", hint: "kenji-sato" })
  await CardWrite.writeOnCard(second.path, { kind: "draft", hint: "kenji-sato" })
  const warm = await CandidateCard.read(path.join(first.path, "staff-platform"), "kenji-sato")
  const terse = await CandidateCard.read(path.join(second.path, "staff-platform"), "kenji-sato")
  const warmMail = outreachEmail(warm?.body ?? "")
  const terseMail = outreachEmail(terse?.body ?? "")
  expect(warm?.body).toContain("Draft only. Never sent.")
  expect(terse?.body).toContain("Draft only. Never sent.")
  expect(warmMail).not.toContain("Short. Concrete. No theater.")
  expect(terseMail).not.toContain("Short. Concrete. No theater.")
  expect(warm?.body).not.toContain("Short. Concrete. No theater.")
  expect(warm?.body).not.toContain("Company bar from")
  expect(warm?.body).not.toContain("## Bar")
  expect(warmMail).not.toContain("Written operators")
  expect(terseMail).not.toContain("Ship weekly in public")
  expect(warmMail).toContain("Hi Kenji —")
  expect(terseMail).toContain("Sato,")
  expect(warmMail).toContain("If a short conversation would be useful, I'm around this week — no pitch deck.")
  expect(terseMail).toContain("15 minutes on the role. Yes or no is fine.")
  expect(warmMail).not.toBe(terseMail)
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

test("Score named id on another req points at that req, not pull", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n")
      await Bun.write(path.join(dir, "founding-engineer", "HIRING.md"), "# Founding Engineer\n")
      await CandidateCard.write(path.join(dir, "founding-engineer"), {
        id: "kenji-okada",
        stage: "Sourced",
        extra: { name: "Kenji Okada" },
        body: "# Kenji Okada\n\nStaff.\n",
      })
      await Bun.write(path.join(dir, "staff-recruiter", "HIRING.md"), "# Staff Recruiter\n")
      await Bun.write(path.join(dir, "staff-recruiter", "candidates", ".gitkeep"), "")
      await ReqWorkspace.writeFocus(dir, "staff-recruiter")
    },
  })
  await expect(CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "Score kenji-okada" })).rejects.toThrow(
    /card kenji-okada is on founding-engineer — focus that req \(open-req founding-engineer\)/,
  )
  try {
    await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "Score kenji-okada" })
    throw new Error("expected score to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).not.toMatch(/run moks pull/)
  }
})
test("parseNaturalWorkIntent catches work/get-ready, not verbs or questions", () => {
  expect(CardWrite.parseNaturalWorkIntent(undefined, "get kenji ready for review")).toEqual({
    hint: "get kenji ready for review",
  })
  expect(CardWrite.parseNaturalWorkIntent(undefined, "work this candidate")?.hint).toBe("work this candidate")
  expect(CardWrite.parseNaturalWorkIntent(undefined, "work kenji-okada")?.hint).toBe("work kenji-okada")
  expect(CardWrite.parseNaturalWorkIntent(undefined, "Score cand_priya")).toBeUndefined()
  expect(CardWrite.parseNaturalWorkIntent("score", "kenji")).toBeUndefined()
  expect(CardWrite.parseNaturalWorkIntent(undefined, "Who is the hiring manager")).toBeUndefined()
  expect(CardWrite.parseNaturalWorkIntent(undefined, "get kenji ready for review", "plan")).toBeUndefined()
  expect(CardWrite.parseNaturalWorkIntent(undefined, "get kenji ready for review", "recruit")?.hint).toBe(
    "get kenji ready for review",
  )
})

test("resolveCard maps kenji / this candidate and refuses a silent pick", () => {
  const kenji = {
    id: "kenji-okada",
    stage: "Sourced",
    extra: { name: "Kenji Okada" },
    body: "# Kenji\n",
  }
  const priya = {
    id: "cand_priya",
    stage: "Sourced",
    extra: { name: "Priya Shah" },
    body: "# Priya\n",
  }
  expect(CardWrite.resolveCard([kenji], "get kenji ready for review").id).toBe("kenji-okada")
  expect(CardWrite.resolveCard([kenji], "work this candidate").id).toBe("kenji-okada")
  expect(CardWrite.resolveCard([kenji], "work kenji-okada").id).toBe("kenji-okada")
  expect(() => CardWrite.resolveCard([kenji, priya], "work this candidate")).toThrow(/no target id/)
  expect(() => CardWrite.resolveCard([kenji, priya], "get nobody ready for review")).toThrow(/no target id/)
})

test("resolveCard strips trailing .!? from the card-name token", () => {
  const kenji = {
    id: "kenji-sato",
    stage: "Sourced",
    extra: { name: "Kenji Sato" },
    body: "# Kenji\n",
  }
  expect(CardWrite.resolveCard([kenji], "get kenji-sato ready.").id).toBe("kenji-sato")
  expect(CardWrite.resolveCard([kenji], "work kenji-sato!").id).toBe("kenji-sato")
  expect(CardWrite.resolveCard([kenji], "get kenji-sato ready?").id).toBe("kenji-sato")
})

test("workOnCard outside a company fails loud", async () => {
  await using empty = await tmpdir()
  await expect(CardWrite.workOnCard(empty.path, "get kenji ready for review")).rejects.toThrow(
    /not a company directory.*--cwd\/--dir/,
  )
})


test("score persists COMPANY.md and HIRING.md fingerprints", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await companyReq(
        dir,
        "# Acme\n\n## Bar\n- Written operators\n",
        [
          "# Staff Platform",
          "",
          "## Scorecard",
          "| Dimension | Bar | Notes |",
          "|-----------|-----|-------|",
          "| Systems design | owns a service | |",
          "",
        ].join("\n"),
      )
    },
  })
  await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "kenji-okada" })
  const card = await CandidateCard.read(path.join(tmp.path, "staff-platform"), "kenji-okada")
  expect(card?.extra.company_hash).toMatch(/^[0-9a-f]{64}$/)
  expect(card?.extra.hiring_hash).toMatch(/^[0-9a-f]{64}$/)
  expect(card?.extra.company_hash).not.toBe(card?.extra.hiring_hash)
})

test("score then draft leave a staged changeset for review", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await companyReq(dir, "# Acme\n\n## Bar\n- Written operators\n", "# Staff Platform\n")
    },
  })
  await DecisionVerbs.pull({ cwd: tmp.path })
  const before = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(before.rows).toEqual([])
  await CardWrite.writeOnCard(tmp.path, { kind: "score", hint: "kenji-okada" })
  const afterScore = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(afterScore.rows.length).toBeGreaterThan(0)
  expect(afterScore.rows.some((row) => row.target.includes("kenji-okada"))).toBe(true)
  expect(afterScore.rows.every((row) => row.status === "staged")).toBe(true)
  expect(afterScore.rows.every((row) => row.action === "note")).toBe(true)
  await CardWrite.writeOnCard(tmp.path, { kind: "draft", hint: "kenji-okada" })
  const afterDraft = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(afterDraft.rows.length).toBeGreaterThan(afterScore.rows.length)
  expect(afterDraft.rows.some((row) => row.action === "outreach")).toBe(true)
  expect(afterDraft.rows.every((row) => row.action !== "advance")).toBe(true)
  expect(afterDraft.rows.some((row) => row.status === "staged")).toBe(true)
})



test("get Maya ready scores maya-chen and does not invent get-maya-ready", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Acme\n")
      const req = path.join(dir, "staff-platform")
      await Bun.write(path.join(req, "HIRING.md"), "# Staff Platform\n")
      await CandidateCard.write(req, {
        id: "maya-chen",
        stage: "Sourced",
        extra: { name: "Maya Chen" },
        body: "# Maya Chen\n\nStaff platform engineer.\n",
      })
      await ReqWorkspace.writeFocus(dir, "staff-platform")
    },
  })
  expect(CardWrite.parseNaturalWorkIntent(undefined, "get Maya ready", "recruit")?.hint).toBe("get Maya ready")
  expect(CardWrite.resolveCard([
    {
      id: "maya-chen",
      stage: "Sourced",
      extra: { name: "Maya Chen" },
      body: "# Maya Chen\n",
    },
  ], "get Maya ready").id).toBe("maya-chen")
  expect(CardWrite.resolveCard([
    {
      id: "maya-chen",
      stage: "Sourced",
      extra: { name: "Maya Chen" },
      body: "# Maya Chen\n",
    },
  ], "work this candidate").id).toBe("maya-chen")
  const worked = await CardWrite.workOnCard(tmp.path, "get Maya ready")
  expect(worked.id).toBe("maya-chen")
  expect(await CandidateCard.read(path.join(tmp.path, "staff-platform"), "get-maya-ready")).toBeUndefined()
  const card = await CandidateCard.read(path.join(tmp.path, "staff-platform"), "maya-chen")
  expect(card?.body).toContain("# Score:")
  expect(card?.body).toContain("# Outreach")
  const staged = await DecisionVerbs.listStagedReviews({ cwd: tmp.path })
  expect(staged.rows.some((row) => row.status === "staged" && row.action !== "note")).toBe(true)
  expect(staged.rows.every((row) => !row.target.includes("get-maya-ready"))).toBe(true)
})
