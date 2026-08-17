import { Schema } from "effect"
import { NamedError } from "@moks/core/util/error"
import { IdeEvent } from "@moks/schema/ide-event"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

export const Event = IdeEvent

export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", {})

export const InstallFailedError = NamedError.create("InstallFailedError", {
  stderr: Schema.String,
})

export function ide() {
  if (process.env["TERM_PROGRAM"] === "vscode") {
    const v = process.env["GIT_ASKPASS"]
    for (const ide of SUPPORTED_IDES) {
      if (v?.includes(ide.name)) return ide.name
    }
  }
  return "unknown"
}

function caller() {
  return process.env["MOKS_CALLER"] ?? process.env["OPENCODE_CALLER"]
}

export function alreadyInstalled() {
  return caller() === "vscode" || caller() === "vscode-insiders"
}

export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
  if (!SUPPORTED_IDES.find((i) => i.name === ide)) throw new Error(`Unknown IDE: ${ide}`)
  throw new InstallFailedError({
    stderr: "moks has no published editor extension yet. Do not install sst-dev.opencode.",
  })
}

export * as Ide from "."
