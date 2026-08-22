import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const StatusCommand = effectCmd({
  command: "status",
  describe: "show mirrored pipeline and changeset counts (staged / approved / stale / applied)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "filter by changeset id",
      })
      .option("limit", {
        type: "number",
        default: 20,
        describe: "max changesets to list",
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
  handler: Effect.fn("Cli.status")(function* (args) {
    const result = yield* Effect.tryPromise({
      try: () =>
        DecisionVerbs.status({
          id: args.id,
          limit: args.limit,
          cwd: args.cwd,
        }),
      catch: (error) =>
        new CliError({
          message: error instanceof Error ? error.message : "status failed",
        }),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const report = result.report
    const pipeline = Object.entries(report.pipeline)
      .map(([stage, count]) => `${stage} ${count}`)
      .join(", ")
    UI.println(
      `${UI.Style.TEXT_NORMAL_BOLD}${report.ats}${UI.Style.TEXT_NORMAL}: ${report.jobs} jobs, ${report.candidates} candidates, ${report.applications} applications`,
    )
    if (pipeline) UI.println(pipeline)
    UI.println(
      `changesets: staged ${report.changesets.staged}, approved ${report.changesets.approved}, stale ${report.changesets.stale}, applied ${report.changesets.applied}, rejected ${report.changesets.rejected}`,
    )
    if (result.open.length > 0) {
      UI.println(`${UI.Style.TEXT_NORMAL_BOLD}open${UI.Style.TEXT_NORMAL} (${result.open.length})`)
      for (const row of result.open) {
        UI.println(`  ${row.id}  ${row.status}  ${row.rationale.split("\n")[0]}`)
      }
    }
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
