import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { DecisionVerbs, defaultAuthor } from "@/decision/verbs"
import { UI } from "../ui"

export const ReviewCommand = effectCmd({
  command: "review <id>",
  describe: "approve or reject a staged changeset (human only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "changeset id",
        demandOption: true,
      })
      .option("approve", {
        type: "boolean",
        default: false,
        describe: "approve the changeset",
      })
      .option("reject", {
        type: "boolean",
        default: false,
        describe: "reject the changeset",
      })
      .option("by", {
        type: "string",
        describe: "reviewer identity",
        default: defaultAuthor(),
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON only",
      })
      .option("cwd", {
        type: "string",
        describe: "working directory override",
      })
      .check((argv) => {
        if (argv.approve === argv.reject) throw new Error("moks review requires --approve or --reject")
        return true
      }),
  handler: Effect.fn("Cli.review")(function* (args) {
    const result = yield* Effect.promise(() =>
      DecisionVerbs.review({
        id: args.id,
        action: args.approve ? "approve" : "reject",
        by: args.by,
        cwd: args.cwd,
      }),
    )
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}reviewed${UI.Style.TEXT_NORMAL} ${result.changeset.id} ${result.changeset.status} by ${result.changeset.reviewed_by}`,
    )
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
