import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Option, Schema } from "effect"
import {
  assetCandidates,
  hostArch,
  hostOs,
  installDir,
  isAllowedAssetName,
  isAllowedDownloadUrl,
  normalizeVersion,
  releaseApi,
  releaseRepo,
  releaseTag,
} from "./asset"

const Release = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      browser_download_url: Schema.String,
    }),
  ),
})

const decodeRelease = Schema.decodeUnknownOption(Release)

export async function fetchLatestVersion() {
  const release = await githubRelease(`${releaseApi()}/repos/${releaseRepo()}/releases/latest`)
  return normalizeVersion(release.tag_name)
}

export async function installRelease(version: string) {
  const release = await githubRelease(`${releaseApi()}/repos/${releaseRepo()}/releases/tags/${releaseTag(version)}`)
  const names = assetCandidates(await detectHost())
  const asset = names.map((name) => release.assets.find((item) => item.name === name)).find((item) => item !== undefined)
  if (!asset) throw new Error(`no release asset for this platform (tried ${names.join(", ")})`)
  if (!isAllowedAssetName(asset.name)) throw new Error(`refusing unexpected asset ${asset.name}`)
  if (!isAllowedDownloadUrl(asset.browser_download_url)) {
    throw new Error(`refusing download ${asset.browser_download_url}`)
  }

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "moks-install-"))
  await using _ = {
    async [Symbol.asyncDispose]() {
      await fs.rm(scratch, { recursive: true, force: true })
    },
  }

  const archive = path.join(scratch, asset.name)
  await Bun.write(archive, await download(asset.browser_download_url))
  const unpacked = path.join(scratch, "out")
  await fs.mkdir(unpacked)
  if (asset.name.endsWith(".tar.gz")) await $`tar -xzf ${archive} -C ${unpacked}`.quiet()
  else await $`unzip -o ${archive} -d ${unpacked}`.quiet()

  const binaryName = process.platform === "win32" ? "moks.exe" : "moks"
  const found = path.join(unpacked, binaryName)
  if (!(await Bun.file(found).exists())) throw new Error(`archive missing ${binaryName}`)

  const destDir = installDir()
  await fs.mkdir(destDir, { recursive: true })
  const dest = path.join(destDir, binaryName)
  const staged = `${dest}.new`
  await fs.copyFile(found, staged)
  await fs.chmod(staged, 0o755)
  await fs.rename(staged, dest)
}

async function githubRelease(url: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "moks-install",
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`)
  const parsed = decodeRelease(await response.json())
  if (!Option.isSome(parsed)) throw new Error("invalid GitHub release payload")
  return parsed.value
}

async function download(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "moks-install" }, redirect: "follow" })
  if (!response.ok) throw new Error(`download failed (${response.status})`)
  if (!isAllowedDownloadUrl(response.url)) throw new Error(`refusing download ${response.url}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function detectHost() {
  return {
    os: hostOs(),
    arch: hostArch(),
    musl: await detectMusl(),
    avx2: await detectAvx2(),
  }
}

async function detectMusl() {
  if (process.platform !== "linux") return false
  if (await Bun.file("/etc/alpine-release").exists()) return true
  const proc = Bun.spawn(["ldd", "--version"], { stdout: "pipe", stderr: "pipe" })
  const text = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text())
  await proc.exited
  return text.toLowerCase().includes("musl")
}

async function detectAvx2() {
  if (hostArch() !== "x64") return true
  if (process.platform === "linux") {
    if (!(await Bun.file("/proc/cpuinfo").exists())) return false
    const cpu = await Bun.file("/proc/cpuinfo").text()
    return /(^|\s)avx2(\s|$)/i.test(cpu)
  }
  if (process.platform === "darwin") {
    const proc = Bun.spawn(["sysctl", "-n", "hw.optional.avx2_0"], { stdout: "pipe", stderr: "pipe" })
    const text = (await new Response(proc.stdout).text()).trim()
    await proc.exited
    return text === "1"
  }
  return true
}
