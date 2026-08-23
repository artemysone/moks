import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@moks/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@moks/sdk/v2"
import type { EventSource } from "@moks/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { ServerAuth } from "@/server/auth"
import { validateSession } from "../tui/validate-session"
import { win32InstallCtrlCGuard } from "@moks/tui/terminal-win32"
import { requireInteractiveTty } from "@moks/tui/util/tty"
import { DecisionVerbs } from "@/decision/verbs"
import { withCompanyDirOption } from "@/cli/cmd/agent"
import { isLiveCompany } from "@/product/req-workspace"

declare global {
  const MOKS_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function ensureMoksEntry() {
  if (process.env.MOKS_BIN || process.env.MOKS_ENTRY) return
  const entry = process.argv[1]
  if (entry) process.env.MOKS_ENTRY = entry
}

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof MOKS_WORKER_PATH !== "undefined") return MOKS_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = Filesystem.resolve(envPWD ?? cwd)
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  return Filesystem.resolve(cwd)
}


export const RECRUIT_COMPOSER_LANDING = "recruit-composer"

function tuiLanding(input: { headless: boolean; liveCompany: boolean; leftoverOrEmpty: boolean }) {
  if (input.headless && input.leftoverOrEmpty) return "fail-loud" as const
  if (input.liveCompany) return "composer-recruit" as const
  return "composer" as const
}

export const RESERVED_TUI_PROJECTS = new Set([
  "review",
  "status",
  "commit",
  "push",
  "pull",
  "diff",
  "log",
  "activity",
  "run",
  "rebase",
])

/** Bare tokens on `$0` are commands, not project paths — fail before TUI/react. */
export function looksLikeProjectPath(token: string) {
  if (!token) return false
  if (token === "." || token === ".." || token.startsWith("./") || token.startsWith("../")) return true
  if (token.startsWith("~") || token.includes("/") || token.includes("\\")) return true
  return path.isAbsolute(token)
}

export function unknownDefaultToken(input: { project?: string; exists?: boolean }) {
  const project = input.project?.trim()
  if (!project) return
  if (RESERVED_TUI_PROJECTS.has(project)) return
  if (looksLikeProjectPath(project)) return
  if (input.exists) return
  return project
}

/** Default `moks --pure` in a company folder is the TUI recruit composer, not a no-op. */
export function selectDefaultInteractiveLaunch(
  input: {
    agent?: string
    mini?: boolean
    headless?: boolean
    liveCompany?: boolean
    leftoverOrEmpty?: boolean
  } = {},
) {
  if (input.mini) {
    return { kind: "mini" as const, landing: undefined, agent: input.agent }
  }
  const landing = tuiLanding({
    headless: Boolean(input.headless),
    liveCompany: input.liveCompany ?? true,
    leftoverOrEmpty: Boolean(input.leftoverOrEmpty),
  })
  if (landing === "fail-loud") {
    return { kind: "fail-loud" as const, landing, agent: input.agent }
  }
  return {
    kind: "tui" as const,
    landing: RECRUIT_COMPOSER_LANDING,
    agent: input.agent ?? "recruit",
  }
}

async function runHeadlessReview(id?: string) {
  if (!id) {
    const listed = await DecisionVerbs.listStagedReviews({})
    if (listed.rows.length === 0) {
      UI.println("no staged changesets")
      UI.println(listed.path)
      return
    }
    for (const row of listed.rows) {
      UI.println(`${row.id}  ${row.action}  ${row.target}  ${row.rationale}`)
    }
    UI.println(listed.path)
    return
  }
  const shown = await DecisionVerbs.inspectReview({ id })
  UI.println(`changeset ${shown.changeset.id}  ${shown.changeset.status}`)
  UI.println(`why  ${shown.changeset.rationale}`)
  for (const change of shown.changeset.changes) {
    UI.println(`${change.mutation}  ${change.entity_ref}`)
  }
  UI.println("approve will bless this changeset (not apply, not push)")
  UI.println(shown.path)
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start moks tui",
  builder: (yargs) =>
    withCompanyDirOption(withNetworkOptions(yargs))
      .positional("project", {
        type: "string",
        describe: "path to start moks in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("mini", {
        type: "boolean",
        describe: "start the minimal interactive interface",
        default: false,
      })
      .option("replay", {
        type: "boolean",
        hidden: true,
      })
      .option("no-replay", {
        type: "boolean",
        describe: "disable mini session history replay on resume and after resize",
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible mini replay to the newest N messages",
      })
      .option("demo", {
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    ensureMoksEntry()
    const unknown = unknownDefaultToken({
      project: args.project,
      exists: args.project ? await Filesystem.exists(resolveThreadDirectory(args.project)) : false,
    })
    if (unknown) {
      UI.error(`unknown command: ${unknown}`)
      process.exitCode = 1
      return
    }
    if (args.project && RESERVED_TUI_PROJECTS.has(args.project)) {
      if (args.project === "review") {
        const extra = (args._ ?? []).map(String).filter((item) => item !== "review" && item !== "$0")
        try {
          await runHeadlessReview(extra[0])
        } catch (error) {
          UI.error(error instanceof Error ? error.message : "review failed")
          process.exitCode = 1
        }
        return
      }
      UI.error(`${args.project} is a moks command, not a project path`)
      process.exitCode = 1
      return
    }
    if (args.replay === true) {
      UI.error("--replay is not supported; replay is enabled by default")
      process.exitCode = 1
      return
    }
    const noReplay = args.replay === false || args.noReplay === true
    const unsupported = [
      ["--no-replay", noReplay],
      ["--replay-limit", args.replayLimit !== undefined],
      ["--demo", args.demo !== undefined],
    ].find((entry) => entry[1])?.[0]
    if (!args.mini && unsupported) {
      UI.error(`${unsupported} requires --mini`)
      process.exitCode = 1
      return
    }

    const directoryGuess = resolveThreadDirectory(args.project)
    const liveCompany = await isLiveCompany(directoryGuess)
    const leftoverOrEmpty = !liveCompany
    const launch = selectDefaultInteractiveLaunch({
      agent: args.agent,
      mini: args.mini,
      headless: !process.stdout.isTTY,
      liveCompany,
      leftoverOrEmpty,
    })
    if (launch.kind === "fail-loud") {
      UI.error("leftover ledger or empty cwd — pass --cwd/--dir to a live company")
      process.exitCode = 1
      return
    }
    if (launch.kind === "mini") {
      const network = ["--port", "--hostname", "--mdns", "--no-mdns", "--mdns-domain", "--cors"].find((option) =>
        process.argv.some((arg) => arg === option || arg.startsWith(option + "=")),
      )
      if (network) {
        UI.error(`${network} cannot be used with --mini`)
        process.exitCode = 1
        return
      }

      const { runMini } = await import("./run")
      await runMini({
        directory: resolveThreadDirectory(args.project),
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        model: args.model,
        agent: args.agent,
        prompt: args.prompt,
        replay: noReplay ? false : undefined,
        replayLimit: args.replayLimit,
        demo: args.demo,
      })
      return
    }

    requireInteractiveTty()
    const unguard = win32InstallCtrlCGuard()
    try {
      const { TuiConfig } = await import("@/config/tui")
      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const worker = new Worker(file, {
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      })
      const client = Rpc.client<typeof rpc>(worker)
      const reload = () => {
        client.call("reload", undefined).catch(() => {})
      }
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch(() => {})
        worker.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await TuiConfig.get()

      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true

      const headers = external ? ServerAuth.headers() : undefined

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
            headers,
          }
        : {
            url: "http://opencode.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      try {
        await validateSession({
          url: transport.url,
          sessionID: args.session,
          directory: cwd,
          fetch: transport.fetch,
          headers,
        })
      } catch (error) {
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      try {
        const { Effect } = await import("effect")
        const { run } = await import("../tui/layer")
        const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
        await Effect.runPromise(
          run({
            url: transport.url,
            async onSnapshot() {
              const tui = writeHeapSnapshot("tui.heapsnapshot")
              const server = await client.call("snapshot", undefined)
              return [tui, server]
            },
            config,
            pluginHost: createLegacyTuiPluginHost(),
            directory: cwd,
            fetch: transport.fetch,
            headers: transport.headers,
            events: transport.events,
            args: {
              continue: args.continue,
              sessionID: args.session,
              agent: launch.agent,
              model: args.model,
              prompt,
              fork: args.fork,
              auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
            },
          }),
        )
      } finally {
        await stop()
      }
    } finally {
      try {
        unguard?.()
      } catch {}
    }
    process.exit(0)
  },
})
// scratch
