/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { CONNECT_PILLS, CONNECT_PILLS_COMMAND, connectPillsRequiredToStart } from "../../src/feature-plugins/home/connect-pills"
import { ConnectPills } from "../../src/feature-plugins/home/connect-pills-view"

const theme = {
  backgroundElement: RGBA.fromHex("#333333"),
  text: RGBA.fromHex("#ffffff"),
}

test("landing connect pills list the six day-power names; none required to start", () => {
  expect([...CONNECT_PILLS]).toEqual(["Ashby", "Greenhouse", "Juicebox", "Metaview", "Google", "Outlook"])
  expect(connectPillsRequiredToStart()).toBe(false)
  expect(CONNECT_PILLS_COMMAND).toBe("provider.connect")
})

test("landing view renders the six connect pill labels", async () => {
  const app = await testRender(() => <ConnectPills theme={theme} onOpen={() => {}} />, { width: 80, height: 4 })
  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    for (const name of CONNECT_PILLS) {
      expect(frame).toContain(name)
    }
  } finally {
    app.renderer.destroy()
  }
})
