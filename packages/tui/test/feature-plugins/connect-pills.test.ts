import { expect, test } from "bun:test"
import { CONNECT_PILLS, CONNECT_PILLS_COMMAND, connectPillsRequiredToStart } from "../../src/feature-plugins/home/connect-pills"

test("landing connect pills list the six day-power names; none required to start", () => {
  expect([...CONNECT_PILLS]).toEqual(["Ashby", "Greenhouse", "Juicebox", "Metaview", "Google", "Outlook"])
  expect(connectPillsRequiredToStart()).toBe(false)
  expect(CONNECT_PILLS_COMMAND).toBe("provider.connect")
})
