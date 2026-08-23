import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const LogCommand = effectCmd({
  command: "log",
  describe: "show recent decisions on the focused req",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("compliance", {
        type: "boolean",
        default: false,
        describe: "LL144/AI-Act-shaped export (no vault plaintext)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON only",
      })
      .option("cwd", {
        alias: ["dir"],
        type: "string",
        describe: "company directory (alias: --dir; same as moks run --dir)",
      }),
  handler: Effect.fn("Cli.log")(function* (args) {
    const result = yield* Effect.tryPromise({
      try: () => DecisionVerbs.log({ cwd: args.cwd, compliance: args.compliance }),
      catch: (error) =>
        new CliError({
          message: error instanceof Error ? error.message : "log failed",
        }),
    })
    if (args.json || args.compliance) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if ("compliance" in result) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (!("lines" in result) || !result.lines) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.lines.length === 0) {
      UI.println(`${UI.Style.TEXT_DIM}no decisions on ${result.focused ?? "this req"}${UI.Style.TEXT_NORMAL}`)
    } else {
      for (const line of result.lines) {
        UI.println(line)
      }
    }
    if (result.next) {
      UI.println(`${UI.Style.TEXT_DIM}next: ${result.next}${UI.Style.TEXT_NORMAL}`)
    }
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
