import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Effect } from "effect"
import path from "path"
import { Installation } from "../../src/installation"
import { InstallationVersion } from "@moks/core/installation/version"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"
import { currentAssetName, packReleaseBinary, serveGithubRelease } from "./github-fixture"

const it = testEffect(AppNodeBuilder.build(Installation.node))

function setEnv(key: string, value: string | undefined) {
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  return () => {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

describe("installation", () => {
  describe("latest", () => {
    it.effect("returns the local version without calling a remote installer", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("unknown")
        expect(result).toBe(InstallationVersion)
      }),
    )

    it.live("reads the GitHub latest tag for curl installs", () =>
      Effect.gen(function* () {
        const packed = yield* Effect.promise(() => packReleaseBinary("#!/bin/sh\necho ok\n"))
        const server = yield* Effect.promise(() =>
          serveGithubRelease({ tag: "v9.9.9", assets: { [packed.name]: packed.bytes } }),
        )
        const restore = setEnv("MOKS_RELEASE_API", server.url)
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            restore()
            await server[Symbol.asyncDispose]()
          }),
        )
        const result = yield* Installation.use.latest("curl")
        expect(result).toBe("9.9.9")
      }),
    )
  })

  describe("method", () => {
    it.effect("returns curl only for ~/.moks/bin, never an OpenCode package manager", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.method()
        if (process.execPath.includes(path.join(".moks", "bin"))) {
          expect(result).toBe("curl")
          return
        }
        expect(result).toBe("unknown")
      }),
    )
  })

  describe("upgrade", () => {
    it.effect("rejects npm — that channel is not shipped", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("moks has no npm release channel; use curl install.")
        expect(error.message).toBe(error.stderr)
      }),
    )

    it.live("refuses a download that points at OpenCode", () =>
      Effect.gen(function* () {
        const name = currentAssetName()
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            const url = new URL(req.url)
            if (url.pathname.includes("/releases/")) {
              return Response.json({
                tag_name: "v9.9.9",
                assets: [{ name, browser_download_url: "https://opencode.ai/install" }],
              })
            }
            return new Response("no", { status: 404 })
          },
        })
        const restore = setEnv("MOKS_RELEASE_API", server.url.origin)
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            restore()
            await server.stop(true)
          }),
        )
        const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toContain("refusing")
      }),
    )

    it.live("installs the GitHub asset into MOKS_INSTALL_DIR", () =>
      Effect.gen(function* () {
        const dest = yield* Effect.promise(() => tmpdir())
        const packed = yield* Effect.promise(() => packReleaseBinary("#!/bin/sh\necho moks-fixture\n"))
        const server = yield* Effect.promise(() =>
          serveGithubRelease({ tag: "v9.9.9", assets: { [packed.name]: packed.bytes } }),
        )
        const restoreApi = setEnv("MOKS_RELEASE_API", server.url)
        const restoreDir = setEnv("MOKS_INSTALL_DIR", dest.path)
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            restoreApi()
            restoreDir()
            await server[Symbol.asyncDispose]()
            await dest[Symbol.asyncDispose]()
          }),
        )
        yield* Installation.use.upgrade("curl", "v9.9.9")
        const bin = path.join(dest.path, process.platform === "win32" ? "moks.exe" : "moks")
        const text = yield* Effect.promise(() => Bun.file(bin).text())
        expect(text).toContain("moks-fixture")
      }),
    )
  })
})
