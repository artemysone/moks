import { expect, test } from "bun:test"
import yargs from "yargs"
import { withCompanyDirOption } from "../../../src/cli/cmd/agent"

test("agent list accepts --cwd and --dir like other company verbs", () => {
  const viaCwd = withCompanyDirOption(yargs(["--cwd", "/tmp/acme"])).parseSync()
  expect(viaCwd.cwd).toBe("/tmp/acme")
  const viaDir = withCompanyDirOption(yargs(["--dir", "/tmp/acme"])).parseSync()
  expect(viaDir.cwd).toBe("/tmp/acme")
  const viaDirEq = withCompanyDirOption(yargs(["--dir=/tmp/acme"])).parseSync()
  expect(viaDirEq.cwd).toBe("/tmp/acme")
})
