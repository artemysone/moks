import { expect, test } from "bun:test"
import { firstCliToken, unknownCliFailure } from "../../src/cli/unknown-token"

test("unknown verb plus --cwd/--dir is unknown command, not unknown argument cwd", () => {
  for (const argv of [
    ["foobar", "--cwd", "/tmp/acme"],
    ["foobar", "--dir", "/tmp/acme"],
  ]) {
    const failure = unknownCliFailure({
      argv,
      message: "Unknown argument: cwd",
    })
    expect(firstCliToken(argv)).toBe("foobar")
    expect(failure).toEqual({ kind: "command", name: "foobar" })
  }
})

test("known verb still reports unknown argument", () => {
  const failure = unknownCliFailure({
    argv: ["run", "--not-a-real-flag"],
    message: "Unknown argument: not-a-real-flag",
  })
  expect(failure).toEqual({ kind: "argument", names: "not-a-real-flag" })
})

test("send/mail/outreach-for-real is never-sent, not unknown command", () => {
  for (const token of ["send", "mail", "email", "outreach-for-real"]) {
    expect(unknownCliFailure({ argv: [token] })).toEqual({ kind: "never-sent", name: token })
  }
})
