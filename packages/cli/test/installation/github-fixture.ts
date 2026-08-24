import { $ } from "bun"
import path from "path"
import { assetCandidates, hostArch, hostOs } from "../../src/installation/asset"
import { tmpdir } from "../fixture/fixture"

export function currentAssetName() {
  return assetCandidates({ os: hostOs(), arch: hostArch(), musl: false, avx2: true })[0]
}

export async function packReleaseBinary(content: string) {
  await using tmp = await tmpdir()
  const binary = process.platform === "win32" ? "moks.exe" : "moks"
  await Bun.write(path.join(tmp.path, binary), content)
  if (process.platform !== "win32") await $`chmod +x ${binary}`.cwd(tmp.path).quiet()
  const name = currentAssetName()
  if (name.endsWith(".tar.gz")) await $`tar -czf ${name} ${binary}`.cwd(tmp.path).quiet()
  else await $`zip -q ${name} ${binary}`.cwd(tmp.path).quiet()
  return { name, bytes: await Bun.file(path.join(tmp.path, name)).bytes() }
}

export async function serveGithubRelease(input: { tag: string; assets: Record<string, Uint8Array> }) {
  const tag = input.tag.startsWith("v") ? input.tag : `v${input.tag}`
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.endsWith("/releases/latest") || url.pathname.includes("/releases/tags/")) {
        return Response.json({
          tag_name: tag,
          assets: Object.keys(input.assets).map((name) => ({
            name,
            browser_download_url: `${url.origin}/download/${name}`,
          })),
        })
      }
      if (url.pathname.startsWith("/download/")) {
        const name = decodeURIComponent(url.pathname.slice("/download/".length))
        const body = input.assets[name]
        if (!body) return new Response("missing", { status: 404 })
        return new Response(Buffer.from(body))
      }
      return new Response("no", { status: 404 })
    },
  })
  return {
    url: server.url.origin,
    [Symbol.asyncDispose]: async () => {
      await server.stop(true)
    },
  }
}
