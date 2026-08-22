import { Effect } from "effect"
import { CliError, effectCmd } from "../effect-cmd"
import { CandidateAdd } from "@/product/candidate-add"
import { UI } from "../ui"

export const AddCandidateCommand = effectCmd({
  command: "add-candidate <file>",
  aliases: ["add-local-candidate"],
  describe: "write a Sourced card from a local resume into the focused req",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "local resume or markdown path",
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
  handler: Effect.fn("Cli.add-candidate")(function* (args) {
    const result = yield* Effect.tryPromise({
      try: () => CandidateAdd.addFromFile(args.cwd ?? process.cwd(), args.file),
      catch: (error) =>
        new CliError({ message: error instanceof Error ? error.message : String(error) }),
    })
    if (args.json) {
      console.log(JSON.stringify({ command: "add-candidate", ...result }, null, 2))
      return
    }
    UI.println(`add-candidate: wrote ${result.relative} (${result.id}, stage ${result.stage})`)
  }),
})
