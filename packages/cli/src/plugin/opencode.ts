import type { Hooks, PluginInput } from "@moks/plugin"
import { OAUTH_DUMMY_KEY } from "../auth"
import { InstallationVersion } from "@moks/core/installation/version"

const SERVER = "https://console.opencode.ai"
const CLIENT_ID = "opencode-cli"
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": `moks/${InstallationVersion}`,
  }
}

async function post<T>(url: string, body: Record<string, string>, ok = true): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  })
  if (ok && !response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`OpenCode auth failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<T>
}

function positiveSecondsToMs(value: unknown, defaultMs: number) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

async function pollDevice(device: DeviceCodeResponse) {
  const deadline = Date.now() + positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS)
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  )

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
    const result = await post<TokenResponse & { error?: string }>(
      `${SERVER}/auth/device/token`,
      {
        grant_type: DEVICE_CODE_GRANT,
        device_code: device.device_code,
        client_id: CLIENT_ID,
      },
      false,
    )
    if ("access_token" in result && result.access_token) return result
    if (result.error === "authorization_pending") continue
    if (result.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
      continue
    }
    throw new Error(result.error ?? "Device authorization failed")
  }
  throw new Error("Device authorization timed out")
}

export async function OpencodeAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "opencode",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        let refreshPromise: Promise<{ access: string; refresh: string; expires: number }> | undefined

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            let current = await getAuth()
            if (current.type !== "oauth") return fetch(requestInput, init)

            const expiresSoon = !current.expires || current.expires - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS
            if (expiresSoon && current.refresh) {
              if (!refreshPromise) {
                const refreshToken = current.refresh
                refreshPromise = post<TokenResponse>(`${SERVER}/auth/device/token`, {
                  grant_type: "refresh_token",
                  refresh_token: refreshToken,
                  client_id: CLIENT_ID,
                })
                  .then(async (tokens) => {
                    const expires = Date.now() + tokens.expires_in * 1000
                    const refresh = tokens.refresh_token || refreshToken
                    await input.client.auth
                      .set({
                        path: { id: "opencode" },
                        body: {
                          type: "oauth",
                          access: tokens.access_token,
                          refresh,
                          expires,
                        },
                      })
                      .catch(() => {})
                    return { access: tokens.access_token, refresh, expires }
                  })
                  .finally(() => {
                    refreshPromise = undefined
                  })
              }
              const refreshed = await refreshPromise
              current = { ...current, ...refreshed }
            }

            const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
            if (init?.headers) {
              const entries =
                init.headers instanceof Headers
                  ? init.headers.entries()
                  : Array.isArray(init.headers)
                    ? init.headers
                    : Object.entries(init.headers as Record<string, string | undefined>)
              for (const [key, value] of entries) {
                if (value !== undefined) headers.set(key, String(value))
              }
            }
            headers.set("authorization", `Bearer ${current.access}`)
            headers.set("User-Agent", `moks/${InstallationVersion}`)
            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          label: "OpenCode subscription",
          type: "oauth",
          authorize: async () => {
            const device = await post<DeviceCodeResponse>(`${SERVER}/auth/device/code`, { client_id: CLIENT_ID })
            return {
              url: `${SERVER}${device.verification_uri_complete}`,
              instructions: `Enter code: ${device.user_code}`,
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await pollDevice(device)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + tokens.expires_in * 1000,
                  }
                } catch {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: "API key",
          type: "api",
        },
      ],
    },
  }
}
