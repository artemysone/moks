import { LayerNode } from "@moks/core/effect/layer-node"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Effect, Layer, Schema, Context } from "effect"
import { serviceUse } from "@moks/core/effect/service-use"
import path from "path"
import { makeRuntime } from "@moks/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@moks/core/installation/version"
import { InstallationEvent } from "@moks/schema/installation-event"
import { fetchLatestVersion, installRelease } from "./github"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `moks/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string, UpgradeFailedError>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@moks/Installation") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: InstallationVersion,
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".moks", "bin"))) return "curl" as Method
        return "unknown" as Method
      }),
      latest: Effect.fn("Installation.latest")(function* (installMethod?: Method) {
        if (installMethod !== "curl") return InstallationVersion
        return yield* Effect.tryPromise({
          try: () => fetchLatestVersion(),
          catch: (error) => new UpgradeFailedError({ stderr: error instanceof Error ? error.message : String(error) }),
        })
      }),
      upgrade: Effect.fn("Installation.upgrade")(function* (method: Method, target: string) {
        if (method !== "curl") {
          return yield* new UpgradeFailedError({ stderr: `moks has no ${method} release channel; use curl install.` })
        }
        return yield* Effect.tryPromise({
          try: () => installRelease(target),
          catch: (error) => new UpgradeFailedError({ stderr: error instanceof Error ? error.message : String(error) }),
        })
      }),
    }

    return Service.of(result)
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export * as Installation from "."
