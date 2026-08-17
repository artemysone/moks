#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "util"

const KEEP = new Set(["main", "dev"])

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    execute: { type: "boolean", default: false },
    tags: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun script/git-cleanup.ts [options]

Dry-run (default) lists leftover refs that are safe to delete.
Keeps origin/main and origin/dev (GitHub default until an admin switches).

Options:
      --execute   Delete listed refs on origin (irreversible)
      --tags      Operate on tags instead of branches
  -h, --help      Show this help message
`)
  process.exit(0)
}

const remoteHeads = await $`git ls-remote --heads origin`.text()
const remoteTags = await $`git ls-remote --tags origin`.text()

function names(text: string, prefix: string) {
  return text
    .split("\n")
    .map((line) => line.split("\t")[1] ?? "")
    .filter((ref) => ref.startsWith(prefix))
    .map((ref) => ref.slice(prefix.length))
    .filter((name) => name && !name.endsWith("^{}"))
}

const branches = names(remoteHeads, "refs/heads/")
const tags = names(remoteTags, "refs/tags/")
const keep = branches.filter((name) => KEEP.has(name))
const deleteBranches = branches.filter((name) => !KEEP.has(name))
const targets = values.tags ? tags : deleteBranches

console.log(`origin heads: ${branches.length}`)
console.log(`keep: ${keep.join(", ") || "(none)"}`)
console.log(`delete branches: ${deleteBranches.length}`)
console.log(`origin tags: ${tags.length}`)
console.log(`${values.tags ? "tag" : "branch"} targets this run: ${targets.length}`)

if (!values.execute) {
  for (const name of targets.slice(0, 40)) console.log(`  ${name}`)
  if (targets.length > 40) console.log(`  … ${targets.length - 40} more`)
  console.log("\nDry-run only. Re-run with --execute after protecting origin/main.")
  process.exit(0)
}

if (targets.length === 0) {
  console.log("Nothing to delete.")
  process.exit(0)
}

const chunk = 50
for (let i = 0; i < targets.length; i += chunk) {
  const batch = targets.slice(i, i + chunk)
  await $`git push origin --delete ${batch}`
  console.log(`deleted ${Math.min(i + chunk, targets.length)}/${targets.length}`)
}
