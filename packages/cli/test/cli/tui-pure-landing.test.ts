import { expect, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { isCompanyRoot } from "../../src/product/req-workspace"
import { RECRUIT_COMPOSER_LANDING, selectDefaultInteractiveLaunch, TuiThreadCommand } from "../../src/cli/cmd/tui"

test("default CLI entry is the TUI thread command", () => {
  expect(TuiThreadCommand.command).toBe("$0 [project]")
})

test("--pure default entry in a company folder selects recruit composer, not a no-op", async () => {
  await using company = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "COMPANY.md"), "# Company\n")
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      await mkdir(path.join(dir, "candidates"), { recursive: true })
      await Bun.write(path.join(dir, "candidates", ".gitkeep"), "")
    },
  })
  expect(await isCompanyRoot(company.path)).toBe(true)
  // --pure only skips external plugins (MOKS_PURE). It must not skip the TUI.
  const launch = selectDefaultInteractiveLaunch()
  expect(launch.kind).toBe("tui")
  expect(launch.landing).toBe(RECRUIT_COMPOSER_LANDING)
  expect(launch.agent).toBe("recruit")
})

test("CLI entry registers the OpenTUI Solid preload before any TUI import", async () => {
  const entry = await Bun.file(new URL("../../src/index.ts", import.meta.url)).text()
  expect(entry.startsWith('import "@opentui/solid/preload"')).toBe(true)
})

test("CLI package hoists react so bun --conditions=browser can resolve it", async () => {
  const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json()
  expect(pkg.dependencies.react).toBe("19.2.0")
  expect(pkg.dependencies["react-dom"]).toBe("19.2.0")
  const resolved = await import.meta.resolve("react")
  expect(resolved.includes("react")).toBe(true)
  const fromCli = Bun.spawnSync({
    cmd: [process.execPath, "--conditions=browser", "-e", "console.log(await import.meta.resolve('react'))"],
    cwd: path.join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(fromCli.exitCode).toBe(0)
  expect(fromCli.stdout.toString()).toContain("react")
})
