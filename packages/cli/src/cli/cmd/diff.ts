import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const DiffCommand = effectCmd({
  command: "diff [id]",
  describe: "show staged ledger mutations versus the current ATS mirror",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "changeset id (default: all staged and approved)",
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
  handler: Effect.fn("Cli.diff")(function* (args) {
    const result = yield* Effect.tryPromise({
      try: () => DecisionVerbs.diff({ cwd: args.cwd, id: args.id }),
      catch: (error) =>
        new CliError({
          message: error instanceof Error ? error.message : "diff failed",
        }),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.diffs.length === 0) {
      UI.println(`${UI.Style.TEXT_DIM}no staged or approved changesets${UI.Style.TEXT_NORMAL}`)
      UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
      return
    }
    for (const plan of result.diffs) {
      UI.println(
        `${UI.Style.TEXT_NORMAL_BOLD}changeset${UI.Style.TEXT_NORMAL} ${plan.id} ${plan.status}${plan.drift ? " DRIFT" : ""}`,
      )
      for (const change of plan.changes) {
        const target =
          change.payload && typeof change.payload === "object" && "to" in change.payload
            ? ` → ${(change.payload as { to: string }).to}`
            : ""
        const from =
          change.current && typeof change.current === "object" && "stage" in change.current
            ? ` ${(change.current as { stage: string }).stage}`
            : ""
        UI.println(
          `  ${change.entity_type}:${change.entity_ref}  ${change.mutation}${from}${target}${change.drift ? "  (drift)" : ""}`,
        )
      }
    }
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
