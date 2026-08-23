import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"
import { DecisionVerbs, defaultAuthor } from "@/decision/verbs"
import { UI } from "../ui"

export const ReviewCommand = effectCmd({
  command: "review [id]",
  describe: "taste staged changesets; approve or reject one",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "changeset id (omit to list staged)",
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
        alias: ["dir"],
        type: "string",
        describe: "company directory (alias: --dir; same as moks run --dir)",
      }),
  handler: Effect.fn("Cli.review")(function* (args) {
    if (args.approve && args.reject) {
      return yield* Effect.fail(new CliError({ message: "moks review accepts only one of --approve or --reject" }))
    }
    if (!args.id && (args.approve || args.reject)) {
      return yield* Effect.fail(new CliError({ message: "moks review --approve/--reject needs a changeset id" }))
    }
    if (!args.id) {
      const listed = yield* Effect.tryPromise({
        try: () => DecisionVerbs.listStagedReviews({ cwd: args.cwd }),
        catch: (error) => new CliError({ message: error instanceof Error ? error.message : "review failed" }),
      })
      if (args.json) {
        console.log(JSON.stringify(listed, null, 2))
        return
      }
      if (listed.rows.length === 0) {
        UI.println("no staged changesets")
        UI.println(`${UI.Style.TEXT_DIM}${listed.path}${UI.Style.TEXT_NORMAL}`)
        return
      }
      for (const row of listed.rows) {
        UI.println(`${row.id}  ${row.action}  ${row.target}  ${row.rationale}`)
      }
      UI.println(`${UI.Style.TEXT_DIM}${listed.path}${UI.Style.TEXT_NORMAL}`)
      return
    }
    if (!args.approve && !args.reject) {
      const shown = yield* Effect.tryPromise({
        try: () => DecisionVerbs.inspectReview({ id: args.id, cwd: args.cwd }),
        catch: (error) => new CliError({ message: error instanceof Error ? error.message : "review failed" }),
      })
      if (args.json) {
        console.log(JSON.stringify(shown, null, 2))
        return
      }
      const { changeset, cards } = shown
      UI.println(`changeset ${changeset.id}  ${changeset.status}`)
      UI.println(`why  ${changeset.rationale}`)
      for (const change of changeset.changes) {
        const payload = change.payload && typeof change.payload === "object" ? (change.payload as Record<string, unknown>) : {}
        const extra = typeof payload.body === "string" ? payload.body : typeof payload.to === "string" ? `to ${payload.to}` : ""
        UI.println(`${change.mutation}  ${change.entity_ref}${extra ? `  ${extra}` : ""}`)
      }
      for (const card of cards) {
        const score = card.score === undefined ? "none" : String(card.score)
        UI.println(`card  ${card.id}  stage=${card.stage ?? "unknown"}  score=${score}`)
      }
      UI.println("approve will bless this changeset (not apply, not push)")
      UI.println(`${UI.Style.TEXT_DIM}${shown.path}${UI.Style.TEXT_NORMAL}`)
      return
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        DecisionVerbs.review({
          id: args.id,
          action: args.approve ? "approve" : "reject",
          by: args.by,
          cwd: args.cwd,
        }),
      catch: (error) => new CliError({ message: error instanceof Error ? error.message : "review failed" }),
    })
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
