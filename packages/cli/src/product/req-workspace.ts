import { readdir } from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { CandidateCard, CANDIDATES_DIR } from "./candidate-card"

export const HIRING_FILE = "HIRING.md"
export const COMPANY_FILE = "COMPANY.md"

export const HIRING_STUB = `# <role title>

## Role
- Team: TBD
- Level: TBD
- Location: TBD

## Must-haves
- TBD

## Nice-to-haves
- TBD

## Scorecard
Scale 1–4: 1 well below, 2 below, 3 at bar, 4 above. Bar is 3 on every required dimension. Advance only with no 1s and an average ≥ 3.

| Dimension | Bar (what a 3 looks like) | Notes |
|-----------|---------------------------|-------|
| TBD | TBD | |

## Process
- Stages: sourced → screen → phone → onsite → offer → hire
- Owners: TBD
`

export const COMPANY_STUB = `# Company

## About
- TBD

## How we hire
- Stages: TBD
- Reqs live in subdirectories. Each req has HIRING.md + candidates/. Open one with /open-req.

## Bar
- TBD

## Tone
- TBD

## Policy
- TBD
`

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
}

export function hiringPath(dirpath: string) {
  return path.join(dirpath, HIRING_FILE)
}

export function companyPath(dirpath: string) {
  return path.join(dirpath, COMPANY_FILE)
}

export async function hasCompanyFile(dirpath: string) {
  return Bun.file(companyPath(dirpath)).exists()
}

export async function isReqDir(dirpath: string) {
  return Bun.file(hiringPath(dirpath)).exists()
}

export function isHiringFile(filepath: string) {
  return path.basename(filepath) === HIRING_FILE
}

export function isReqMaterial(filepath: string) {
  return isHiringFile(filepath) || CandidateCard.isCardPath(filepath)
}

export async function hasCandidatesDir(dir: string) {
  return Filesystem.isDir(path.join(dir, CANDIDATES_DIR))
}

export async function isPacket(dir: string) {
  return (await isReqDir(dir)) && (await hasCandidatesDir(dir))
}

// COMPANY.md is a company. candidates/ is a company even without COMPANY.md.
// Bare HIRING.md alone is not.
export async function isCompanyRoot(dir: string) {
  return (await hasCompanyFile(dir)) || (await isPacket(dir)) || (await hasCandidatesDir(dir))
}

/** Stub COMPANY.md or leftover ledger without reqs/candidates is not live. */
export async function isLiveCompany(dir: string) {
  return (
    (await isPacket(dir)) ||
    (await hasCandidatesDir(dir)) ||
    (await isReqDir(dir)) ||
    (await listReqs(dir)).length > 0
  )
}

export function notACompanyDirectory(opened: string) {
  return `not a company directory: ${opened} — pass --cwd/--dir to the company (same as moks run --dir)`
}

export async function listReqs(company: string) {
  if (!(await Filesystem.isDir(company))) return []
  const names: string[] = []
  for (const entry of await readdir(company, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (await isReqDir(path.join(company, entry.name))) names.push(entry.name)
  }
  return names.toSorted()
}

export const FOCUS_FILE = ".moks/focus"

export async function readFocus(company: string) {
  const slug = await Bun.file(path.join(company, FOCUS_FILE))
    .text()
    .then((text) => text.trim())
    .catch(() => "")
  if (!slug || slug.includes("..") || path.isAbsolute(slug) || slug.includes("/") || slug.includes("\\")) return
  return slug
}

export async function writeFocus(company: string, slug: string) {
  const safe = path.basename(slug.trim())
  if (!safe || safe === "." || safe === "..") return
  await Bun.write(path.join(company, FOCUS_FILE), safe)
  const { HiringSession } = await import("./hiring-session")
  await HiringSession.refreshSnapshot(company)
}

export async function focusedReq(opened: string) {
  const company = await companyRoot(opened)
  if (!company) return
  let current = path.resolve(opened)
  const limit = path.resolve(company)
  while (true) {
    if (await isPacket(current)) return current
    if (current === limit) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  const slug = await readFocus(company)
  if (slug && (await isPacket(path.join(company, slug)))) return path.join(company, slug)
}

export async function workspaceEnv(dir: string) {
  const company = (await companyRoot(dir)) ?? dir
  const focused = await focusedReq(dir)
  const constitution = (await isPacket(company))
    ? `${HIRING_FILE} (single-req)`
    : (await hasCompanyFile(company))
      ? COMPANY_FILE
      : "missing"
  return {
    company,
    focused: !focused ? "none" : focused === company ? "same as company" : focused,
    candidates: focused ? path.join(focused, CANDIDATES_DIR) : "none",
    constitution,
  }
}

const SLATE_CAP = 20

export async function slateBlock(dir: string) {
  const focused = await focusedReq(dir)
  if (focused && (await isPacket(focused))) {
    const cards = (await CandidateCard.list(focused)).slice(0, SLATE_CAP)
    if (cards.length === 0) return
    return [
      "<slate>",
      ...cards.map((card) => {
        const fields = [card.id]
        if (card.stage) fields.push(`stage=${card.stage}`)
        if (card.score !== undefined) fields.push(`score=${card.score}`)
        fields.push(
          `path=${path.relative(focused, CandidateCard.filePath(focused, card.id)).replaceAll(path.sep, "/")}`,
        )
        return `  ${fields.join("  ")}`
      }),
      "</slate>",
    ].join("\n")
  }
  const company = await companyRoot(dir)
  if (company) {
    const reqs = await listReqs(company)
    if (reqs.length === 0) return
    return ["<reqs>", ...reqs.map((name) => `  ${name}`), "</reqs>"].join("\n")
  }
}

export async function resolve(directory: string, stop?: string) {
  const start = path.resolve(directory)
  const limit = stop === undefined ? undefined : path.resolve(stop)
  let current = start
  while (true) {
    if ((await hasCompanyFile(current)) || (await isReqDir(current)) || (await hasCandidatesDir(current))) return current
    if (limit && current === limit) return
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

export async function companyRoot(opened: string) {
  const top = await gitToplevel(opened)
  const stop = top ?? path.resolve(opened, "..", "..", "..", "..")
  const nearest = await resolve(opened, stop)
  if (!nearest) return
  if (await hasCompanyFile(nearest)) return nearest
  const parent = path.dirname(nearest)
  if (parent !== nearest && (await hasCompanyFile(parent))) return parent
  if ((await isPacket(nearest)) || (await hasCandidatesDir(nearest))) return nearest
}

export function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

/** First-line title for /open-req and `run --command`. Strips wrapping quotes. */
export function parseReqTitle(raw: string) {
  const first = (raw.split("\n")[0] ?? "").trim()
  if (first.length >= 2) {
    const quote = first[0]
    if ((quote === '"' || quote === "'") && first.endsWith(quote)) {
      return first.slice(1, -1).trim()
    }
  }
  return first
}

export function stubFor(title?: string) {
  if (!title) return HIRING_STUB
  return HIRING_STUB.replaceAll("<role title>", title)
}

export async function scaffoldCompany(cwd: string) {
  const created: string[] = []
  const skipped: string[] = []
  // A packet root is a single-req workspace; its HIRING.md is already the constitution.
  const packet = await isPacket(cwd)
  const existing = Bun.file(companyPath(cwd))
  const present = packet || ((await existing.exists()) && (await existing.text()).trim().length > 0)

  if (present) {
    skipped.push(packet ? HIRING_FILE : COMPANY_FILE)
  } else {
    await Bun.write(companyPath(cwd), COMPANY_STUB)
    created.push(COMPANY_FILE)
  }
  await ensureLedger(cwd, created, skipped)
  const git = await gitInitIfNeeded(cwd, !present)
  return { created, skipped, relative: ".", git }
}

export async function scaffoldReq(cwd: string, title?: string) {
  // A root that already has HIRING.md + candidates/ is the req itself; never nest.
  const packet = await isPacket(cwd)
  const company = await scaffoldCompany(cwd)
  const created = [...company.created]
  const skipped = [...company.skipped]

  if (packet) {
    const gitkeep = path.join(CANDIDATES_DIR, ".gitkeep")
    if (await Bun.file(path.join(cwd, gitkeep)).exists()) {
      skipped.push(gitkeep)
    } else {
      await Bun.write(path.join(cwd, gitkeep), "")
      created.push(gitkeep)
    }
    return { created, skipped, title, relative: ".", git: company.git }
  }

  const slug = title ? slugify(title) : ""
  if (!slug) return { created, skipped, title, relative: ".", git: company.git }

  const reqHiring = path.join(slug, HIRING_FILE)
  const reqKeep = path.join(slug, CANDIDATES_DIR, ".gitkeep")
  const reqFile = Bun.file(path.join(cwd, reqHiring))
  if ((await reqFile.exists()) && (await reqFile.text()).trim().length > 0) {
    skipped.push(reqHiring)
  } else {
    await Bun.write(path.join(cwd, reqHiring), stubFor(title))
    created.push(reqHiring)
  }
  if (await Bun.file(path.join(cwd, reqKeep)).exists()) {
    skipped.push(reqKeep)
  } else {
    await Bun.write(path.join(cwd, reqKeep), "")
    created.push(reqKeep)
  }
  return { created, skipped, title, relative: slug, git: company.git }
}

async function ensureLedger(cwd: string, created: string[], skipped: string[]) {
  const { workspacePaths, openSqlite, migrateWorkspace, openVault } = await import("@moks/ledger")
  const paths = workspacePaths(cwd)
  const hadDb = await Bun.file(paths.workspaceDb).exists()
  const hadKey = await Bun.file(paths.vaultKey).exists()
  const db = openSqlite(paths.workspaceDb)
  migrateWorkspace(db)
  openVault(db, paths.vaultKey)
  db.close()
  ;(hadDb ? skipped : created).push(path.join(".moks", "ledger.sqlite"))
  ;(hadKey ? skipped : created).push(path.join(".moks", "vault.key"))
  await ignoreMoksDir(cwd)
}

// vault.key is a plaintext AES master key for candidate PII; it must never be committable.
async function ignoreMoksDir(cwd: string) {
  const file = Bun.file(path.join(cwd, ".gitignore"))
  const text = await file.text().catch(() => "")
  const ignored = text.split("\n").some((line) => {
    const trimmed = line.trim()
    return trimmed === ".moks" || trimmed === ".moks/"
  })
  if (ignored) return
  const separator = text.length > 0 && !text.endsWith("\n") ? "\n" : ""
  await Bun.write(file, `${text}${separator}.moks/\n`)
}

async function gitToplevel(dir: string) {
  let cwd = path.resolve(dir)
  while (!(await Filesystem.isDir(cwd))) {
    const parent = path.dirname(cwd)
    if (parent === cwd) return
    cwd = parent
  }
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const root = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  if (proc.exitCode !== 0 || !root) return
  return Filesystem.resolve(root)
}

async function gitInitIfNeeded(cwd: string, create = true) {
  const root = await gitToplevel(cwd)
  if (root && root === path.resolve(cwd)) return "existing"
  if (!create) return "existing"

  const init = Bun.spawn(["git", "init"], { cwd, stdout: "pipe", stderr: "pipe" })
  await init.exited
  if (init.exitCode !== 0) return "failed"
  return "created"
}

export * as ReqWorkspace from "./req-workspace"
