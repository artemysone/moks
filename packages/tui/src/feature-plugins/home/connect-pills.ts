export const CONNECT_PILLS = [
  { id: "ashby", label: "Ashby", category: "ATS" },
  { id: "greenhouse", label: "Greenhouse", category: "ATS" },
  { id: "juicebox", label: "Juicebox", category: "Sourcing" },
  { id: "metaview", label: "Metaview", category: "Sourcing" },
  { id: "google", label: "Gmail", category: "Email & Calendar" },
  { id: "outlook", label: "Outlook", category: "Email & Calendar" },
] as const

export type ConnectPill = (typeof CONNECT_PILLS)[number]
export type ConnectPillStatus = "off" | "disabled" | "needs_auth" | "connected" | "failed"

export const CONNECT_PILLS_REQUIRED = false

export const CONNECT_PILLS_COMMAND = "connector.connect"

export function connectPillsRequiredToStart() {
  return CONNECT_PILLS_REQUIRED
}

export function matchConnectPill(mcp: Record<string, unknown>, pill: { id: string; label: string }) {
  const keys = Object.keys(mcp)
  const id = pill.id.toLowerCase()
  const label = pill.label.toLowerCase()
  const exact = keys.find((key) => {
    const name = key.toLowerCase()
    return name === id || name === label
  })
  if (exact) return exact
  return keys.find((key) => {
    const name = key.toLowerCase()
    if (!name.startsWith(id) || name.length === id.length) return false
    return !/[a-z0-9]/.test(name[id.length] ?? "")
  })
}

export function hasCatalogConnector(mcp: Record<string, unknown>) {
  return CONNECT_PILLS.some((pill) => matchConnectPill(mcp, pill))
}

export function connectPillStatus(
  mcp: Record<string, { status: string }>,
  pill: { id: string; label: string },
): { name?: string; status: ConnectPillStatus } {
  const name = matchConnectPill(mcp, pill)
  if (!name) return { status: "off" }
  const item = mcp[name]
  if (item.status === "connected") return { name, status: "connected" }
  if (item.status === "needs_auth" || item.status === "needs_client_registration") return { name, status: "needs_auth" }
  if (item.status === "failed") return { name, status: "failed" }
  return { name, status: "disabled" }
}

export async function applyConnectorAction(
  pill: ConnectPill,
  mcp: Record<string, { status: string }>,
  actions: {
    addRemote: (pill: ConnectPill) => Promise<void>
    authorize: (name: string) => Promise<void>
    toggle: (name: string) => Promise<void>
    connect: (name: string) => Promise<void>
  },
) {
  const current = connectPillStatus(mcp, pill)
  if (!current.name) {
    await actions.addRemote(pill)
    return
  }
  if (current.status === "needs_auth") {
    await actions.authorize(current.name)
    return
  }
  if (current.status === "connected") {
    await actions.toggle(current.name)
    return
  }
  await actions.connect(current.name)
}
