import { expect, test } from "bun:test"
import { run } from "../src"

test("exports the canonical application lifecycle", () => {
  expect(typeof run).toBe("function")
})

test("declares react and react-dom as real TUI dependencies", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json()
  expect(pkg.dependencies.react).toBe("19.2.0")
  expect(pkg.dependencies["react-dom"]).toBe("19.2.0")
  expect(pkg.peerDependencies?.react).toBeUndefined()
  expect(pkg.devDependencies?.react).toBeUndefined()
})
