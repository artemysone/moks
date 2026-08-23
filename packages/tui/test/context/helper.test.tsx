/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSimpleContext } from "../../src/context/helper"

test("providers paint children even when leftover ready is still false", async () => {
  const { provider: Gate, use } = createSimpleContext({
    name: "Gate",
    init: () => ({
      get ready() {
        return false
      },
      label: "recruit composer",
    }),
  })

  const Probe = () => {
    const gate = use()
    return <text>{gate.label}</text>
  }

  const app = await testRender(() => (
    <Gate>
      <Probe />
    </Gate>
  ))
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("recruit composer")
  } finally {
    app.renderer.destroy()
  }
})
