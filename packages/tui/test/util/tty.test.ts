import { expect, test } from "bun:test"
import { requireInteractiveTty, TTY_REQUIRED_MESSAGE } from "../../src/util/tty"

test("allows a TTY stdout", () => {
  expect(() => requireInteractiveTty({ isTTY: true })).not.toThrow()
})

test("fails loud when stdout is not a TTY", () => {
  expect(() => requireInteractiveTty({ isTTY: false })).toThrow(TTY_REQUIRED_MESSAGE)
  expect(() => requireInteractiveTty({})).toThrow(TTY_REQUIRED_MESSAGE)
})
