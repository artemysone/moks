import type { Argv } from "yargs"
import { Installation } from "../../installation"
import { UI } from "../ui"

function installMethod(value: unknown): Installation.Method | undefined {
  switch (value) {
    case "curl":
    case "npm":
    case "pnpm":
    case "bun":
    case "brew":
    case "choco":
    case "scoop":
      return value
  }
}

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade moks to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    const method = installMethod(args.method) ?? (await Installation.method())
    if (method === "unknown") {
      UI.error("Not a curl install.")
      UI.println("curl -fsSL https://raw.githubusercontent.com/artemysone/moks/main/install | bash")
      process.exitCode = 1
      return
    }
    const target = args.target ?? (await Installation.latest(method))
    await Installation.upgrade(method, target)
    UI.println(`Upgraded to ${target}`)
  },
}
