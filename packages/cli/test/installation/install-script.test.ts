import { expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { packReleaseBinary, serveGithubRelease } from "./github-fixture"

const install = path.resolve(import.meta.dir, "../../../../install")

test("install downloads the GitHub asset into MOKS_INSTALL_DIR", async () => {
  await using dest = await tmpdir()
  const packed = await packReleaseBinary("#!/bin/sh\necho moks-script\n")
  await using server = await serveGithubRelease({ tag: "v9.9.9", assets: { [packed.name]: packed.bytes } })
  const result = await $`bash ${install} -v 9.9.9 --no-modify-path`.env({
    ...process.env,
    MOKS_RELEASE_API: server.url,
    MOKS_INSTALL_DIR: dest.path,
  })
  expect(result.exitCode).toBe(0)
  const bin = path.join(dest.path, "moks")
  expect(await Bun.file(bin).text()).toContain("moks-script")
})

test("install refuses an OpenCode download URL", async () => {
  await using dest = await tmpdir()
  const packed = await packReleaseBinary("#!/bin/sh\necho no\n")
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.includes("/releases/")) {
        return Response.json({
          tag_name: "v9.9.9",
          assets: [{ name: packed.name, browser_download_url: "https://opencode.ai/install" }],
        })
      }
      return new Response("no", { status: 404 })
    },
  })
  const result = await $`bash ${install} -v 9.9.9 --no-modify-path`.env({
    ...process.env,
    MOKS_RELEASE_API: server.url.origin,
    MOKS_INSTALL_DIR: dest.path,
  }).nothrow()
  await server.stop(true)
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("refusing")
})
