import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"
import { CandidateAdd } from "@/product/candidate-add"
import { UI } from "../ui"

export const AddCandidateCommand = effectCmd({
  command: "add-candidate [file..]",
  aliases: ["add-local-candidate"],
  describe: "write Sourced card(s) from local resumes into the focused req",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        array: true,
        describe: "local resume, markdown path, or directory of resumes",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON only",
      }),
  handler: Effect.fn("Cli.add-candidate")(function* (args) {
    const files = Array.isArray(args.file) ? args.file : args.file ? [args.file] : []
    const added = yield* Effect.tryPromise({
      try: () => CandidateAdd.addPile(process.cwd(), { files: files.length ? files : [""], names: [] }),
      catch: (error) =>
        new CliError({ message: error instanceof Error ? error.message : String(error) }),
    })
    if (args.json) {
      const first = added[0]
      console.log(
        JSON.stringify(
          added.length === 1 ? { command: "add-candidate", ...first, added } : { command: "add-candidate", added },
          null,
          2,
        ),
      )
      return
    }
    for (const result of added) {
      UI.println(`add-candidate: wrote ${result.relative} (${result.id}, stage ${result.stage})`)
    }
  }),
})
