import { expect, test } from "bun:test"
import {
  applyConnectorAction,
  CONNECT_PILLS,
  CONNECT_PILLS_COMMAND,
  connectPillStatus,
  connectPillsRequiredToStart,
  hasCatalogConnector,
  matchConnectPill,
} from "../../src/feature-plugins/home/connect-pills"
import { CONNECT_TIP, INIT_TIP, landingTip, READY_TIP } from "../../src/feature-plugins/home/tips-view"

test("connect catalog is ATS, sourcing, then mail", () => {
  expect(CONNECT_PILLS.map((pill) => [pill.category, pill.label])).toEqual([
    ["ATS", "Ashby"],
    ["ATS", "Greenhouse"],
    ["Sourcing", "Juicebox"],
    ["Sourcing", "Metaview"],
    ["Email & Calendar", "Gmail"],
    ["Email & Calendar", "Outlook"],
  ])
  expect(connectPillsRequiredToStart()).toBe(false)
  expect(CONNECT_PILLS_COMMAND).toBe("connector.connect")
})

test("matchConnectPill maps catalog names onto live MCP keys", () => {
  expect(matchConnectPill({ ashby: {}, Greenhouse: {} }, CONNECT_PILLS[0])).toBe("ashby")
  expect(matchConnectPill({ Greenhouse: {} }, CONNECT_PILLS[1])).toBe("Greenhouse")
  expect(matchConnectPill({ "ashby-mock": {} }, CONNECT_PILLS[0])).toBe("ashby-mock")
  expect(matchConnectPill({ ashbyish: {} }, CONNECT_PILLS[0])).toBeUndefined()
  expect(matchConnectPill({}, CONNECT_PILLS[0])).toBeUndefined()
})

test("hasCatalogConnector is true once any day-tool exists", () => {
  expect(hasCatalogConnector({})).toBe(false)
  expect(hasCatalogConnector({ ashby: { status: "disabled" } })).toBe(true)
})

test("connectPillStatus is off until a matching MCP exists", () => {
  expect(connectPillStatus({}, CONNECT_PILLS[0])).toEqual({ status: "off" })
  expect(connectPillStatus({ ashby: { status: "connected" } }, CONNECT_PILLS[0])).toEqual({
    name: "ashby",
    status: "connected",
  })
  expect(connectPillStatus({ ashby: { status: "needs_auth" } }, CONNECT_PILLS[0])).toEqual({
    name: "ashby",
    status: "needs_auth",
  })
  expect(connectPillStatus({ ashby: { status: "failed" } }, CONNECT_PILLS[0])).toEqual({
    name: "ashby",
    status: "failed",
  })
  expect(connectPillStatus({ ashby: { status: "disabled" } }, CONNECT_PILLS[0])).toEqual({
    name: "ashby",
    status: "disabled",
  })
})

test("applyConnectorAction is per-tool", async () => {
  const seen: string[] = []
  await applyConnectorAction(CONNECT_PILLS[0], {}, {
    addRemote: async (pill) => {
      seen.push(`add:${pill.id}`)
    },
    authorize: async (name) => {
      seen.push(`auth:${name}`)
    },
    toggle: async (name) => {
      seen.push(`toggle:${name}`)
    },
    connect: async (name) => {
      seen.push(`connect:${name}`)
    },
  })
  await applyConnectorAction(CONNECT_PILLS[0], { ashby: { status: "needs_auth" } }, {
    addRemote: async () => {
      seen.push("add")
    },
    authorize: async (name) => {
      seen.push(`auth:${name}`)
    },
    toggle: async () => {
      seen.push("toggle")
    },
    connect: async () => {
      seen.push("connect")
    },
  })
  await applyConnectorAction(CONNECT_PILLS[0], { ashby: { status: "connected" } }, {
    addRemote: async () => {
      seen.push("add")
    },
    authorize: async () => {
      seen.push("auth")
    },
    toggle: async (name) => {
      seen.push(`toggle:${name}`)
    },
    connect: async () => {
      seen.push("connect")
    },
  })
  await applyConnectorAction(CONNECT_PILLS[0], { ashby: { status: "disabled" } }, {
    addRemote: async () => {
      seen.push("add")
    },
    authorize: async () => {
      seen.push("auth")
    },
    toggle: async () => {
      seen.push("toggle")
    },
    connect: async (name) => {
      seen.push(`connect:${name}`)
    },
  })
  expect(seen).toEqual(["add:ashby", "auth:ashby", "toggle:ashby", "connect:ashby"])
})

test("landing tip is init, then connect, then pipeline", () => {
  expect(landingTip({})).toBe(INIT_TIP)
  expect(landingTip({ company: false })).toBe(INIT_TIP)
  expect(landingTip({ company: true, connectors: false })).toBe(CONNECT_TIP)
  expect(landingTip({ company: true, connectors: true })).toBe(READY_TIP)
  expect(INIT_TIP).toContain("/init")
  expect(CONNECT_TIP).toContain("/connect")
  expect(CONNECT_TIP).toContain("Ashby, Greenhouse")
  expect(CONNECT_TIP).toContain("Juicebox, Metaview")
  expect(CONNECT_TIP).toContain("Outlook, Gmail")
  expect(READY_TIP).toContain("Review my pipeline")
})
