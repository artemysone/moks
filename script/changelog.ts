#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { parseArgs } from "util"

const root = path.resolve(import.meta.dir, "..")
const file = path.join(root, "UPCOMING_CHANGELOG.md")
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    from: { type: "string", short: "f" },
    to: { type: "string", short: "t" },
    print: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun script/changelog.ts [options]

Writes UPCOMING_CHANGELOG.md from git history via script/raw-changelog.ts.
Does not invoke the OpenCode CLI.

Options:
  -f, --from <version>   Starting version (default: latest non-draft GitHub release)
  -t, --to <ref>         Ending ref (default: HEAD)
      --print            Print the generated file after success
  -h, --help             Show this help message
`)
  process.exit(0)
}

const args = []
if (values.from) args.push("--from", values.from)
if (values.to) args.push("--to", values.to)

const text = await $`bun script/raw-changelog.ts ${args}`.cwd(root).text()
await Bun.write(file, text.endsWith("\n") ? text : `${text}\n`)
if (values.print) process.stdout.write(await Bun.file(file).text())
