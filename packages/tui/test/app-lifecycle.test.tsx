import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@moks/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Global } from "@moks/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

function withTty<T>(fn: () => Promise<T>) {
  const stdout = process.stdout as { isTTY?: boolean }
  const previous = stdout.isTTY
  stdout.isTTY = true
  return fn().finally(() => {
    stdout.isTTY = previous
  })
}

test("SIGHUP clears title and disposes scoped resources once", async () => withTty(async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const titles: string[] = []
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    setTitle(title)
  }
  const listeners = new Set(process.listeners("SIGHUP"))
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposes = 0

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start() {
            started()
          },
          async dispose() {
            disposes++
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready
    process.emit("SIGHUP")
    await task

    expect(setup.renderer.isDestroyed).toBe(true)
    expect(titles.at(-1)).toBe("")
    expect(disposes).toBe(1)
    expect(process.listeners("SIGHUP").every((listener) => listeners.has(listener))).toBe(true)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}))

test("app.exit prints the session epilogue after scoped cleanup", async () => withTty(async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const demo = {
    id: "dummy",
    title: "Demo session",
    slug: "dummy",
    projectID: "project",
    directory,
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  let sessionHydrated!: () => void
  const hydrated = new Promise<void>((resolve) => {
    sessionHydrated = resolve
  })
  const calls = createFetch((url) => {
    if (url.pathname === "/session") {
      queueMicrotask(sessionHydrated)
      return json([demo])
    }
    if (url.pathname === "/session/dummy") {
      queueMicrotask(sessionHydrated)
      return json(demo)
    }
  })
  const originalWrite = process.stdout.write.bind(process.stdout)
  let stdout = ""
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    await hydrated
    await new Promise((resolve) => setTimeout(resolve, 0))
    while (calls.inflight > 0) await new Promise((resolve) => setTimeout(resolve, 0))
    await setup.renderOnce()
    await setup.renderOnce()
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stdout).toContain("Demo session")
    expect(stdout).toContain("moks -s dummy")
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}))
