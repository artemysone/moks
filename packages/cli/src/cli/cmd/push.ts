import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const PushCommand = effectCmd({
  command: "push [id]",
  describe: "apply approved changesets to the ATS (human only; dry-run by default)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "changeset id (default: all approved)",
      })
      .option("commit-id", {
        type: "string",
        describe: "changeset id (same as positional)",
      })
      .option("execute", {
        type: "boolean",
        default: false,
        describe: "write to the ATS (default is dry-run)",
      })
      .option("confirm", {
        type: "boolean",
        default: false,
        describe: "acknowledge adverse action (Reject, ExtendOffer, Hire)",
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
  handler: Effect.fn("Cli.push")(function* (args) {
    const result = yield* Effect.promise(() =>
      DecisionVerbs.push({
        id: args.id ?? args.commitId,
        dry_run: !args.execute,
        confirm: args.confirm,
        source: "cli",
        cwd: args.cwd,
      }),
    )
    if (!result.ok) {
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              error: result.code,
              message: result.message,
              path: result.path,
            },
            null,
            2,
          ),
        )
      }
      return yield* fail(result.message, result.code === "needs_confirm" ? 2 : 1)
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.pushed.length === 0) {
      UI.println(`${UI.Style.TEXT_DIM}nothing to push${UI.Style.TEXT_NORMAL}`)
      UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
      return
    }
    const verb = result.dry_run ? "would push" : "pushed"
    for (const item of result.pushed) {
      const extra = "reason" in item && item.reason ? `: ${item.reason}` : ""
      UI.println(
        `${UI.Style.TEXT_SUCCESS_BOLD}${verb}${UI.Style.TEXT_NORMAL} ${item.id} ${item.status}${extra} dry_run=${result.dry_run}`,
      )
    }
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
