import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const RebaseCommand = effectCmd({
  command: "rebase <id>",
  describe: "re-derive a stale changeset against the current ATS mirror",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "stale changeset id",
        demandOption: true,
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON only",
      })
      .option("cwd", {
        type: "string",
        describe: "working directory override",
      }),
  handler: Effect.fn("Cli.rebase")(function* (args) {
    const result = yield* Effect.promise(() => DecisionVerbs.rebase({ cwd: args.cwd, id: args.id }))
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}rebased${UI.Style.TEXT_NORMAL} ${result.original_id} → ${result.changeset.id}: ${result.explanation}`,
    )
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
