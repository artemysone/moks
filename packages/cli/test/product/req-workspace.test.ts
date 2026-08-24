import { expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { HiringFixtures } from "../../src/product/fixtures"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("slugify lowercases and hyphenates", () => {
  expect(ReqWorkspace.slugify("Senior Backend Engineer")).toBe("senior-backend-engineer")
  expect(ReqWorkspace.slugify("  staff-ml  ")).toBe("staff-ml")
  expect(ReqWorkspace.slugify("!!!")).toBe("")
})

test("parseReqTitle strips wrapping quotes used by headless run --command", () => {
  expect(ReqWorkspace.parseReqTitle("Founding Engineer")).toBe("Founding Engineer")
  expect(ReqWorkspace.parseReqTitle('"Founding Engineer"')).toBe("Founding Engineer")
  expect(ReqWorkspace.parseReqTitle("'Founding Engineer'")).toBe("Founding Engineer")
  expect(ReqWorkspace.parseReqTitle('"Founding Engineer"\nextra')).toBe("Founding Engineer")
  expect(ReqWorkspace.slugify(ReqWorkspace.parseReqTitle('"Founding Engineer"'))).toBe("founding-engineer")
  expect(ReqWorkspace.stubFor(ReqWorkspace.parseReqTitle('"Founding Engineer"'))).toContain("# Founding Engineer")
  expect(ReqWorkspace.stubFor(ReqWorkspace.parseReqTitle('"Founding Engineer"'))).not.toContain('# "Founding Engineer"')
})

test("parseTalkOpenRole reads a talk-shaped role, not a company name", () => {
  expect(ReqWorkspace.parseTalkOpenRole("open a Staff Platform role")).toBe("Staff Platform")
  expect(ReqWorkspace.parseTalkOpenRole("open a Senior Backend role")).toBe("Senior Backend")
  expect(ReqWorkspace.parseTalkOpenRole("open the req for Founding Engineer")).toBe("Founding Engineer")
  expect(ReqWorkspace.parseTalkOpenRole("Senior Backend")).toBeUndefined()
  expect(ReqWorkspace.parseTalkOpenRole("Northline Analytics")).toBeUndefined()
})

test("openTalkReq scaffolds the req subdirectory from talk", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path, "Northline Analytics")
  const result = await ReqWorkspace.openTalkReq(tmp.path, "Staff Platform")
  expect(result.relative).toBe("staff-platform")
  expect(await Bun.file(path.join(tmp.path, "staff-platform", "HIRING.md")).text()).toBe(
    ReqWorkspace.stubFor("Staff Platform"),
  )
  expect(await Bun.file(path.join(tmp.path, "staff-platform", "candidates", ".gitkeep")).exists()).toBe(true)
  expect(await ReqWorkspace.readFocus(tmp.path)).toBe("staff-platform")
})

test("scaffoldCompany stands up the full company workspace in empty cwd", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(result.created).toEqual(["COMPANY.md", path.join(".moks", "ledger.sqlite"), path.join(".moks", "vault.key")])
  expect(result.relative).toBe(".")
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toBe(ReqWorkspace.COMPANY_STUB)
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "SCORECARD.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, ".moks", "ledger.sqlite")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, ".moks", "vault.key")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, "candidates/.gitkeep")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(true)
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual([])
})

test("scaffoldCompany writes a typed company name into COMPANY.md", async () => {
  await using tmp = await tmpdir()
  const named = await ReqWorkspace.scaffoldCompany(tmp.path, "Northline Analytics")
  expect(named.created).toContain("COMPANY.md")
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toBe(
    ReqWorkspace.companyStub("Northline Analytics"),
  )
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toContain("# Northline Analytics")
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).exists()).toBe(false)

  await using empty = await tmpdir()
  await ReqWorkspace.scaffoldCompany(empty.path)
  expect(await Bun.file(path.join(empty.path, "COMPANY.md")).text()).toBe(ReqWorkspace.COMPANY_STUB)
  expect(await Bun.file(path.join(empty.path, "COMPANY.md")).text()).toBe(ReqWorkspace.companyStub())

  const again = await ReqWorkspace.scaffoldCompany(tmp.path, "Other Co")
  expect(again.skipped).toContain("COMPANY.md")
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toBe(
    ReqWorkspace.companyStub("Northline Analytics"),
  )
})

test("scaffoldCompany ledger works for moks commands after /init", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const { openSqlite, migrateWorkspace } = await import("@moks/ledger")
  const db = openSqlite(path.join(tmp.path, ".moks", "ledger.sqlite"))
  migrateWorkspace(db)
  const versions = db.prepare("SELECT version FROM schema_migrations").all()
  db.close()
  expect(versions.length).toBeGreaterThan(0)
})

test("scaffoldCompany rerun converges: everything skipped, nothing rewritten", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const key = await Bun.file(path.join(tmp.path, ".moks", "vault.key")).text()
  const result = await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(result.created).toEqual([])
  expect(result.skipped).toEqual(["COMPANY.md", path.join(".moks", "ledger.sqlite"), path.join(".moks", "vault.key")])
  expect(await Bun.file(path.join(tmp.path, ".moks", "vault.key")).text()).toBe(key)
})

test("scaffoldCompany never creates a req dir, even after a title-shaped edit", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const company = path.join(tmp.path, "COMPANY.md")
  await Bun.write(company, "# Northline Analytics\n")
  const result = await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(await Bun.file(company).text()).toBe("# Northline Analytics\n")
  expect(result.skipped).toContain("COMPANY.md")
  expect(result.relative).toBe(".")
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual([])
})

test("scaffoldCompany on a single-req packet does not add a COMPANY.md", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  await Bun.write(path.join(tmp.path, "candidates", ".gitkeep"), "")
  const result = await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(result.skipped).toContain("HIRING.md")
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).text()).toBe("# Req\n")
})

test("scaffoldReq does not overwrite non-empty COMPANY.md", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const company = path.join(tmp.path, "COMPANY.md")
  await Bun.write(company, "# Northline Analytics\n")
  const result = await ReqWorkspace.scaffoldReq(tmp.path, "Other Title")
  expect(await Bun.file(company).text()).toBe("# Northline Analytics\n")
  expect(result.relative).toBe("other-title")
  expect(await Bun.file(path.join(tmp.path, "other-title", "HIRING.md")).exists()).toBe(true)
})

test("scaffoldCompany creates .gitignore with .moks/ when absent", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(await Bun.file(gi).text()).toBe(".moks/\n")
})

test("scaffoldCompany appends .moks/ to an existing .gitignore without a newline at EOF", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  await Bun.write(gi, "node_modules/")
  await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(await Bun.file(gi).text()).toBe("node_modules/\n.moks/\n")
})

test("scaffoldCompany rerun is idempotent: no duplicate .moks/ entries", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const before = await Bun.file(gi).text()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(await Bun.file(gi).text()).toBe(before)
})

test("scaffoldCompany treats whitespace and slash variants of .moks as already ignored", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  for (const entry of ["  .moks ", "\t.moks/\n"]) {
    await Bun.write(gi, `node_modules/\n${entry}`)
    await ReqWorkspace.scaffoldCompany(tmp.path)
    expect(await Bun.file(gi).text()).toBe(`node_modules/\n${entry}`)
  }
})

test("resolve walks up to the company constitution", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const nested = path.join(tmp.path, "notes", "nested")
  await Bun.write(path.join(nested, "keep.txt"), "x")
  expect(await ReqWorkspace.resolve(nested, tmp.path)).toBe(tmp.path)
  expect(await ReqWorkspace.resolve(tmp.path, tmp.path)).toBe(tmp.path)
})

test("resolve returns undefined when no constitution is found", async () => {
  await using tmp = await tmpdir()
  expect(await ReqWorkspace.resolve(tmp.path, tmp.path)).toBeUndefined()
})

test("companyRoot is undefined without a constitution", async () => {
  await using tmp = await tmpdir({ git: true })
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBeUndefined()
})

test("companyRoot of a git-less tmp without a constitution is undefined", async () => {
  await using tmp = await tmpdir()
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBeUndefined()
})

test("companyRoot does not walk more than 4 ancestors without git", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Far\n")
  const leaf = path.join(tmp.path, "a", "b", "c", "d", "e")
  await Bun.write(path.join(leaf, "keep.txt"), "x")
  expect(await ReqWorkspace.companyRoot(leaf)).toBeUndefined()
})

test("companyRoot returns a single-req packet", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  await Bun.write(path.join(tmp.path, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBe(tmp.path)
  expect(await ReqWorkspace.companyRoot(path.join(tmp.path, "candidates"))).toBe(tmp.path)
})

test("companyRoot ignores a bare HIRING.md without candidates or COMPANY.md", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Stray\n")
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBeUndefined()
})

test("companyRoot returns company-only and lifts a nested req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  const req = path.join(tmp.path, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBe(tmp.path)
  expect(await ReqWorkspace.companyRoot(req)).toBe(tmp.path)
})

test("companyRoot does not walk past the company into a parent constitution", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Software\n")
  const company = path.join(tmp.path, "acme")
  await Bun.write(path.join(company, "COMPANY.md"), "# Acme\n")
  const req = path.join(company, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.companyRoot(req)).toBe(company)
  expect(await ReqWorkspace.companyRoot(company)).toBe(company)
})

test("git init happens when cwd is not a repo", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(result.git).toBe("created")
  expect((await $`git rev-parse --is-inside-work-tree`.cwd(tmp.path).text()).trim()).toBe("true")
  expect((await $`git rev-parse --verify HEAD`.cwd(tmp.path).quiet().nothrow()).exitCode).not.toBe(0)
})

test("isReqMaterial includes HIRING.md and candidates/*.md", () => {
  expect(ReqWorkspace.isReqMaterial("HIRING.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("staff-ml/HIRING.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("candidates/jordan-lee.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("staff-ml/candidates/jordan-lee.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("jd.md")).toBe(false)
  expect(ReqWorkspace.isReqMaterial("src/foo.ts")).toBe(false)
})

test("git init is skipped when already a repo", async () => {
  await using tmp = await tmpdir({ git: true })
  const before = (await $`git rev-list --count HEAD`.cwd(tmp.path).text()).trim()
  const result = await ReqWorkspace.scaffoldCompany(tmp.path)
  expect(result.git).toBe("existing")
  expect((await $`git rev-list --count HEAD`.cwd(tmp.path).text()).trim()).toBe(before)
})

test("isCompanyRoot needs COMPANY.md or a full packet", async () => {
  await using tmp = await tmpdir()
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(false)
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(false)
  await Bun.write(path.join(tmp.path, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(true)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(true)
})

test("isCompanyRoot accepts COMPANY.md without any req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(true)
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
})

test("listReqs returns sorted child dirs with HIRING.md", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), "# SP\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await Bun.write(path.join(tmp.path, "notes", "keep.txt"), "x")
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual(["senior-backend", "staff-platform"])
})

test("workspaceEnv treats a packet cwd as company and req", async () => {
  const env = await ReqWorkspace.workspaceEnv(HiringFixtures.dir)
  expect(env).toEqual({
    company: HiringFixtures.dir,
    focused: "same as company",
    candidates: path.join(HiringFixtures.dir, "candidates"),
    constitution: "HIRING.md (single-req)",
  })
})

test("workspaceEnv treats company-only cwd as unfocused", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  expect(await ReqWorkspace.workspaceEnv(tmp.path)).toEqual({
    company: tmp.path,
    focused: "none",
    candidates: "none",
    constitution: "COMPANY.md",
  })
})

test("workspaceEnv treats a nested packet as focused req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  const req = path.join(tmp.path, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.workspaceEnv(req)).toEqual({
    company: tmp.path,
    focused: req,
    candidates: path.join(req, "candidates"),
    constitution: "COMPANY.md",
  })
})

test("slateBlock lists fixture cards without body", async () => {
  const block = await ReqWorkspace.slateBlock(HiringFixtures.dir)
  expect(block).toBe(["<slate>", "  jordan-lee  stage=sourced  path=candidates/jordan-lee.md", "</slate>"].join("\n"))
  expect(block).not.toContain("score=")
  expect(block).not.toContain("Meridian Fleet")
})

test("slateBlock at company root lists req names not cards", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), "# SP\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await CandidateCard.write(path.join(tmp.path, "senior-backend"), {
    id: "jordan-lee",
    stage: "sourced",
    extra: {},
    body: "Meridian Fleet\n",
  })
  expect(await ReqWorkspace.slateBlock(tmp.path)).toBe(
    ["<reqs>", "  senior-backend", "  staff-platform", "</reqs>"].join("\n"),
  )
})

test("empty tmp then /open-req Senior Backend creates a req dir", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const company = await Bun.file(path.join(tmp.path, "COMPANY.md")).text()
  expect(company).toBe(ReqWorkspace.COMPANY_STUB)
  expect(await Bun.file(path.join(tmp.path, "candidates")).exists()).toBe(false)
  const result = await ReqWorkspace.scaffoldReq(tmp.path, "Senior Backend")
  expect(result.relative).toBe("senior-backend")
  expect(result.created).toEqual(["senior-backend/HIRING.md", "senior-backend/candidates/.gitkeep"])
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toBe(company)
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "HIRING.md")).text()).toBe(
    ReqWorkspace.stubFor("Senior Backend"),
  )
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "candidates", ".gitkeep")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "SCORECARD.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual(["senior-backend"])
  expect(await ReqWorkspace.isPacket(path.join(tmp.path, "senior-backend"))).toBe(true)
})

test("/open-req on an empty folder scaffolds the company first", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffoldReq(tmp.path, "Staff ML")
  expect(result.relative).toBe("staff-ml")
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toBe(ReqWorkspace.COMPANY_STUB)
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "candidates")).exists()).toBe(false)
  expect(await ReqWorkspace.isPacket(path.join(tmp.path, "staff-ml"))).toBe(true)
})

test("/open-req on an existing req focuses without recreating", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldReq(tmp.path, "Senior Backend")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# Senior Backend (edited)\n")
  const result = await ReqWorkspace.scaffoldReq(tmp.path, "Senior Backend")
  expect(result.relative).toBe("senior-backend")
  expect(result.skipped).toContain(path.join("senior-backend", "HIRING.md"))
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "HIRING.md")).text()).toBe("# Senior Backend (edited)\n")
})

test("fixture layout /open-req does not nest a second req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  await Bun.write(path.join(tmp.path, "candidates", ".gitkeep"), "")
  const result = await ReqWorkspace.scaffoldReq(tmp.path, "Other")
  expect(result.relative).toBe(".")
  expect(await Bun.file(path.join(tmp.path, "other", "HIRING.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).text()).toBe("# Req\n")
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
})

test("/open-req without a title does not invent a slug", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffoldCompany(tmp.path)
  const result = await ReqWorkspace.scaffoldReq(tmp.path)
  expect(result.relative).toBe(".")
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual([])
})

test("focusedReq of a fixture is the fixture dir", async () => {
  expect(await ReqWorkspace.focusedReq(HiringFixtures.dir)).toBe(HiringFixtures.dir)
})

test("focusedReq walks from candidates to the req packet", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  const req = path.join(tmp.path, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.focusedReq(path.join(req, "candidates"))).toBe(req)
  expect(await ReqWorkspace.focusedReq(path.join(req, "notes"))).toBe(req)
})

test("focusedReq of fixture candidates is the fixture dir", async () => {
  expect(await ReqWorkspace.focusedReq(path.join(HiringFixtures.dir, "candidates"))).toBe(HiringFixtures.dir)
})

test("writeFocus persists a slug and focusedReq reads it back", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  const req = path.join(tmp.path, "staff-platform")
  await Bun.write(path.join(req, "HIRING.md"), "# SP\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.focusedReq(tmp.path)).toBeUndefined()
  await ReqWorkspace.writeFocus(tmp.path, "staff-platform")
  expect(await Bun.file(path.join(tmp.path, ReqWorkspace.FOCUS_FILE)).text()).toBe("staff-platform")
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
  expect(await ReqWorkspace.focusedReq(tmp.path)).toBe(req)
  expect(await ReqWorkspace.readFocus(tmp.path)).toBe("staff-platform")
})

test("readFocus ignores empty slugs and path traversal", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, ".moks/focus"), "   \n")
  expect(await ReqWorkspace.readFocus(tmp.path)).toBeUndefined()
  await Bun.write(path.join(tmp.path, ".moks/focus"), "../staff-platform\n")
  expect(await ReqWorkspace.readFocus(tmp.path)).toBeUndefined()
  await Bun.write(path.join(tmp.path, ".moks/focus"), "/tmp/staff-platform\n")
  expect(await ReqWorkspace.readFocus(tmp.path)).toBeUndefined()
})

test("slateBlock at a focused company lists that packet only", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "COMPANY.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), "# SP\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await CandidateCard.write(path.join(tmp.path, "staff-platform"), {
    id: "alex-kim",
    stage: "sourced",
    extra: {},
    body: "Harbor Logistics\n",
  })
  await CandidateCard.write(path.join(tmp.path, "senior-backend"), {
    id: "jordan-lee",
    stage: "sourced",
    extra: {},
    body: "Meridian Fleet\n",
  })
  await ReqWorkspace.writeFocus(tmp.path, "staff-platform")
  expect(await ReqWorkspace.slateBlock(tmp.path)).toBe(
    ["<slate>", "  alex-kim  stage=sourced  path=candidates/alex-kim.md", "</slate>"].join("\n"),
  )
  expect(await ReqWorkspace.workspaceEnv(tmp.path)).toEqual({
    company: tmp.path,
    focused: path.join(tmp.path, "staff-platform"),
    candidates: path.join(tmp.path, "staff-platform", "candidates"),
    constitution: "COMPANY.md",
  })
  expect(await Bun.file(path.join(tmp.path, ".moks/focus")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
})

test("slateBlock caps cards at 20 and omits body", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  for (const n of Array.from({ length: 21 }, (_, i) => i + 1)) {
    const id = `c${String(n).padStart(2, "0")}`
    await CandidateCard.write(tmp.path, { id, stage: "sourced", extra: {}, body: "Meridian Fleet\n" })
  }
  const block = await ReqWorkspace.slateBlock(tmp.path)
  expect(block).toContain("c01")
  expect(block).toContain("c20")
  expect(block).not.toContain("c21")
  expect(block).not.toContain("Meridian Fleet")
  expect(block?.split("\n").filter((line) => line.startsWith("  ")).length).toBe(20)
})

test("/open-req B leaves A's HIRING.md, candidates, and company-wide COMPANY.md", async () => {
  await using tmp = await tmpdir()
  const first = await ReqWorkspace.scaffoldReq(tmp.path, "Staff Platform")
  expect(first.relative).toBe("staff-platform")
  const hiringA = "# Staff Platform (edited)\n"
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), hiringA)
  await CandidateCard.write(path.join(tmp.path, "staff-platform"), {
    id: "kenji-okada",
    stage: "sourced",
    extra: {},
    body: "Payments edge\n",
  })
  await ReqWorkspace.writeFocus(tmp.path, "staff-platform")
  const company = await Bun.file(path.join(tmp.path, "COMPANY.md")).text()

  const second = await ReqWorkspace.scaffoldReq(tmp.path, "Senior Backend")
  expect(second.relative).toBe("senior-backend")
  await ReqWorkspace.writeFocus(tmp.path, "senior-backend")

  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual(["senior-backend", "staff-platform"])
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "COMPANY.md")).text()).toBe(company)
  expect(await Bun.file(path.join(tmp.path, "staff-platform", "HIRING.md")).text()).toBe(hiringA)
  expect(await Bun.file(path.join(tmp.path, "staff-platform", "candidates", "kenji-okada.md")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "HIRING.md")).text()).toBe(
    ReqWorkspace.stubFor("Senior Backend"),
  )
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "candidates", ".gitkeep")).exists()).toBe(true)
  expect(await ReqWorkspace.readFocus(tmp.path)).toBe("senior-backend")
  expect(await ReqWorkspace.focusedReq(tmp.path)).toBe(path.join(tmp.path, "senior-backend"))
  expect(await Bun.file(path.join(tmp.path, ".moks", "ledger.sqlite")).exists()).toBe(true)
})
