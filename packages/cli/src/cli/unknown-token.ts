import { CardWrite } from "@/product/card-write"

/** Top-level verbs registered on the root yargs in start.ts (plus completion/help). */
export const KNOWN_CLI_VERBS = new Set([
  "activity",
  "add-candidate",
  "agent",
  "attach",
  "commit",
  "completion",
  "db",
  "debug",
  "diff",
  "export",
  "help",
  "import",
  "log",
  "mcp",
  "models",
  "plugin",
  "providers",
  "pull",
  "push",
  "rebase",
  "review",
  "run",
  "serve",
  "session",
  "stats",
  "status",
  "uninstall",
  "upgrade",
])

export function firstCliToken(argv: string[]) {
  for (const token of argv) {
    if (token === "--") break
    if (token.startsWith("-")) continue
    return token
  }
}

export function unknownCliFailure(input: { argv: string[]; message?: string }) {
  const token = firstCliToken(input.argv)
  if (token && CardWrite.parseSendIntent(token, "")) {
    return { kind: "never-sent" as const, name: token }
  }
  if (token && !KNOWN_CLI_VERBS.has(token)) {
    return { kind: "command" as const, name: token }
  }
  if (input.message?.startsWith("Unknown argument")) {
    const names = input.message.replace(/^Unknown arguments?:\s*/i, "").trim()
    return { kind: "argument" as const, names }
  }
}
