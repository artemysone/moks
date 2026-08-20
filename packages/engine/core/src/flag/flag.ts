import { Config, Option } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

/** Product env is MOKS_* only. MOKS_* must not leak personal OpenCode into moks. */
function env(name: string): string | undefined {
  return process.env[`MOKS_${name}`]
}

function truthyDual(name: string): boolean {
  return truthy(`MOKS_${name}`)
}

function enabledByExperimental(name: string) {
  return env(name) === undefined ? truthyDual("EXPERIMENTAL") : truthyDual(name)
}

/** Effect Config.TrueValues (case-insensitive). Present-but-invalid → false (no OPENCODE fallthrough). */
function configTruthy(value: string) {
  const v = value.trim().toLowerCase()
  return v === "true" || v === "yes" || v === "on" || v === "1" || v === "y"
}

function dualConfigBoolean(name: string) {
  return Config.option(Config.string(`MOKS_${name}`)).pipe(
    Config.map((value) => (Option.isSome(value) ? configTruthy(value.value) : false)),
  )
}

const copy = env("EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = env("DISABLE_FFF")

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  MOKS_AUTO_HEAP_SNAPSHOT: truthyDual("AUTO_HEAP_SNAPSHOT"),
  MOKS_GIT_BASH_PATH: env("GIT_BASH_PATH"),
  get MOKS_CONFIG() {
    return env("CONFIG")
  },
  get MOKS_CONFIG_CONTENT() {
    return env("CONFIG_CONTENT")
  },
  MOKS_DISABLE_AUTOUPDATE: truthyDual("DISABLE_AUTOUPDATE"),
  MOKS_ALWAYS_NOTIFY_UPDATE: truthyDual("ALWAYS_NOTIFY_UPDATE"),
  MOKS_DISABLE_PRUNE: truthyDual("DISABLE_PRUNE"),
  MOKS_DISABLE_TERMINAL_TITLE: truthyDual("DISABLE_TERMINAL_TITLE"),
  MOKS_SHOW_TTFD: truthyDual("SHOW_TTFD"),
  MOKS_DISABLE_AUTOCOMPACT: truthyDual("DISABLE_AUTOCOMPACT"),
  MOKS_DISABLE_MODELS_FETCH: truthyDual("DISABLE_MODELS_FETCH"),
  MOKS_DISABLE_MOUSE: truthyDual("DISABLE_MOUSE"),
  MOKS_FAKE_VCS: env("FAKE_VCS"),
  MOKS_SERVER_PASSWORD: env("SERVER_PASSWORD"),
  MOKS_SERVER_USERNAME: env("SERVER_USERNAME"),
  MOKS_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthyDual("DISABLE_FFF"),

  // Experimental
  MOKS_EXPERIMENTAL_FILEWATCHER: dualConfigBoolean("EXPERIMENTAL_FILEWATCHER"),
  MOKS_EXPERIMENTAL_DISABLE_FILEWATCHER: dualConfigBoolean("EXPERIMENTAL_DISABLE_FILEWATCHER"),
  MOKS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthyDual("EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  MOKS_MODELS_URL: env("MODELS_URL"),
  MOKS_MODELS_PATH: env("MODELS_PATH"),
  MOKS_DB: env("DB"),

  MOKS_WORKSPACE_ID: env("WORKSPACE_ID"),
  MOKS_EXPERIMENTAL_WORKSPACES: enabledByExperimental("EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get MOKS_DISABLE_PROJECT_CONFIG() {
    return truthyDual("DISABLE_PROJECT_CONFIG")
  },
  get MOKS_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("EXPERIMENTAL_REFERENCES")
  },
  get MOKS_TUI_CONFIG() {
    return env("TUI_CONFIG")
  },
  get MOKS_CONFIG_DIR() {
    return env("CONFIG_DIR")
  },
  get MOKS_PURE() {
    return truthyDual("PURE")
  },
  get MOKS_PERMISSION() {
    return env("PERMISSION")
  },
  get MOKS_PLUGIN_META_FILE() {
    return env("PLUGIN_META_FILE")
  },
  get MOKS_CLIENT() {
    return env("CLIENT") ?? "cli"
  },
}
