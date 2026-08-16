export * as SystemContextBuiltIns from "./builtins"

import { dirname, join } from "path"
import { makeLocationNode } from "../effect/app-node"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { FSUtil } from "../fs-util"
import { Global } from "../global"

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const company = yield* companyWorkspace(location.directory, location.project.directory)
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Company workspace: ${company}`,
      `  Git audit: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(environment),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
    ])

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
  }),
)

const companyWorkspace = Effect.fnUntraced(function* (start: string, stop: string) {
  const fs = yield* FSUtil.Service
  let current = start
  while (true) {
    if (yield* fs.existsSafe(join(current, "HIRING.md"))) {
      const parent = dirname(current)
      if (
        parent !== current &&
        FSUtil.contains(stop, parent) &&
        (yield* fs.existsSafe(join(parent, "HIRING.md"))) &&
        (yield* fs.isDir(join(current, "candidates"))) &&
        !(yield* fs.isDir(join(parent, "candidates")))
      ) {
        return parent
      }
      return current
    }
    if (current === stop) return start
    const parent = dirname(current)
    if (parent === current || !FSUtil.contains(stop, parent)) return start
    current = parent
  }
})

export const node = makeLocationNode({
  name: "system-context-builtins",
  layer: builtIns,
  deps: [Location.node, SystemContextRegistry.node, InstructionContext.node, FSUtil.node, Global.node],
})
