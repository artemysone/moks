import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const productPkgPath = path.resolve(import.meta.dir, "../../moks/package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const productPkg = await Bun.file(productPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  CHANNEL: process.env["MOKS_CHANNEL"],
  BUMP: process.env["MOKS_BUMP"],
  VERSION: process.env["MOKS_VERSION"],
  RELEASE: process.env["MOKS_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.CHANNEL) return env.CHANNEL
  if (env.BUMP) return "latest"
  if (env.VERSION && !env.VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.VERSION) return env.VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = typeof productPkg.version === "string" ? productPkg.version : "0.0.0"
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  if (t === "patch") return `${major}.${minor}.${patch + 1}`
  return version
})()

const bot = ["actions-user", "moks", "moks-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const teamFile = Bun.file(teamPath)
const team = [
  ...((await teamFile.exists())
    ? await teamFile
        .text()
        .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
        .then((x) => x.filter((x) => x && !x.startsWith("#")))
    : []),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.RELEASE
  },
  get team() {
    return team
  },
}
console.log(`moks script`, JSON.stringify(Script, null, 2))
