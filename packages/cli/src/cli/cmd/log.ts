import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const LogCommand = effectCmd({
  command: "log",
  describe: "show the hash-chained decision log",
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
    const result = yield* Effect.promise(() => DecisionVerbs.log({ cwd: args.cwd, compliance: args.compliance }))
    if (args.json || args.compliance) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (!("entries" in result) || !result.entries || !result.chain) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const entries = result.entries
    const chain = result.chain
    if (entries.length === 0) {
      UI.println(`${UI.Style.TEXT_DIM}log empty${UI.Style.TEXT_NORMAL}`)
      UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
      return
    }
    if (!chain.ok) {
      const at = chain.changesetId
      UI.println(
        `${UI.Style.TEXT_WARNING}chain ${chain.reason}${at ? ` at ${at}` : ""}${UI.Style.TEXT_NORMAL}`,
      )
    }
    for (const row of entries) {
      const reviewer = row.reviewed_by ? ` reviewed_by=${row.reviewed_by}` : ""
      const audit = row.audit ? "  sampled for audit" : ""
      UI.println(
        `${row.id}  ${row.status}  ${row.hash.slice(0, 12)}  ${row.author_id}${reviewer}${audit}  ${row.rationale.split("\n")[0]}`,
      )
    }
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
