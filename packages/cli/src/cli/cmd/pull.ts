import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const PullCommand = effectCmd({
  command: "pull",
  describe: "sync the ATS snapshot into the local ledger mirror",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON only",
      })
      .option("cwd", {
        type: "string",
        describe: "working directory override",
      }),
  handler: Effect.fn("Cli.pull")(function* (args) {
    const result = yield* Effect.promise(() => DecisionVerbs.pull({ cwd: args.cwd }))
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const seed = result.seeded ? " (seeded mock ATS)" : ""
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}pulled${UI.Style.TEXT_NORMAL} ${result.ats}${seed}: ${result.upserted.jobs} jobs, ${result.upserted.candidates} candidates, ${result.upserted.applications} applications`,
    )
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
