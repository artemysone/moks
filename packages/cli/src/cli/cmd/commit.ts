import { Effect } from "effect"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { DecisionVerbs, defaultAuthor, type CommitChange } from "@/decision/verbs"
import { UI } from "../ui"

export const CommitCommand = effectCmd({
  command: "commit",
  describe: "stage typed hiring mutations on the ledger (does not write the ATS)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("action", {
        type: "string",
        describe: "recruiter action (note, advance, reject, offer, hire) or a ledger mutation name",
      })
      .option("mutation", {
        type: "string",
        describe: "AdvanceStage | Reject | Withdraw | AddNote | AddTag | SendOutreach | ExtendOffer",
      })
      .option("entity", {
        type: "string",
        describe: "type:id (e.g. application:app_priya_142)",
      })
      .option("target-kind", {
        type: "string",
        describe: "opaque target kind (usually candidate)",
      })
      .option("target-id", {
        type: "string",
        describe: "candidate or application id; resolved against the mirror after pull",
      })
      .option("reason", {
        type: "string",
        describe: "human reason (also used as AddNote body / ExtendOffer terms)",
      })
      .option("rationale", {
        type: "string",
        describe: "commit message; defaults to --reason",
      })
      .option("to", {
        type: "string",
        describe: "AdvanceStage target (Sourced, Screen, Interview, Offer, Hired, …)",
      })
      .option("body", {
        type: "string",
        describe: "AddNote / SendOutreach body",
      })
      .option("tag", {
        type: "string",
        describe: "AddTag value",
      })
      .option("terms", {
        type: "string",
        describe: "ExtendOffer terms",
      })
      .option("change", {
        type: "array",
        string: true,
        describe: "repeatable raw change JSON object",
      })
      .option("author", {
        alias: "by",
        type: "string",
        describe: "author id (defaults to $USER)",
      })
      .option("meta", {
        type: "string",
        describe: "JSON object metadata",
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
      })
      .check((argv) => {
        if (!argv.action && !argv.mutation && !(argv.change && argv.change.length > 0)) {
          throw new Error("moks commit needs --action, --mutation, or --change")
        }
        return true
      }),
  handler: Effect.fn("Cli.commit")(function* (args) {
    let meta: unknown
    if (args.meta) {
      try {
        meta = JSON.parse(args.meta)
      } catch {
        return yield* fail("invalid --meta JSON")
      }
    }
    const parsedChanges: CommitChange[] = []
    for (const raw of args.change ?? []) {
      try {
        const value = JSON.parse(raw) as unknown
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return yield* fail("moks --change requires a JSON object")
        }
        parsedChanges.push(value as { entity_type: string; entity_ref: string; mutation: string; payload?: unknown })
      } catch {
        return yield* fail("moks --change requires a JSON object")
      }
    }
    const target =
      args.targetKind || args.targetId ? { kind: args.targetKind ?? "candidate", id: args.targetId } : undefined
    const result = yield* Effect.tryPromise({
      try: () =>
        DecisionVerbs.commit({
          action: args.action,
          mutation: args.mutation,
          entity: args.entity,
          target,
          reason: args.reason,
          rationale: args.rationale ?? args.reason ?? args.body,
          to: args.to,
          body: args.body,
          tag: args.tag,
          terms: args.terms,
          changes: parsedChanges,
          author_id: args.author ?? defaultAuthor(),
          author_kind: "human",
          meta,
          source: "cli",
          cwd: args.cwd,
        }),
      catch: (error) =>
        new CliError({
          message: error instanceof Error ? error.message : "commit failed",
        }),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const mutations = result.changeset.changes.map((change) => change.mutation).join(",")
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}staged${UI.Style.TEXT_NORMAL} ${result.changeset.id} ${result.changeset.status} ${mutations}`,
    )
    UI.println(result.next)
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
