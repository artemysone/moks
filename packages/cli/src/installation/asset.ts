import os from "os"
import path from "path"

export const RELEASE_REPO = "artemysone/moks"

export function releaseRepo() {
  const repo = process.env.MOKS_RELEASE_REPO ?? RELEASE_REPO
  if (isForeignRepo(repo)) throw new Error(`refusing foreign release repo: ${repo}`)
  return repo
}

export function releaseApi() {
  return process.env.MOKS_RELEASE_API ?? "https://api.github.com"
}

export function installDir() {
  return process.env.MOKS_INSTALL_DIR ?? path.join(os.homedir(), ".moks", "bin")
}

export function normalizeVersion(input: string) {
  return input.trim().replace(/^v/i, "")
}

export function releaseTag(input: string) {
  return `v${normalizeVersion(input)}`
}

export function hostOs(platform = process.platform) {
  if (platform === "win32") return "windows"
  if (platform === "darwin") return "darwin"
  if (platform === "linux") return "linux"
  return platform
}

export function hostArch(arch = process.arch) {
  if (arch === "x64") return "x64"
  if (arch === "arm64") return "arm64"
  return arch
}

export function archiveExt(osName: string) {
  if (osName === "linux") return "tar.gz"
  return "zip"
}

export function assetBase(input: { os: string; arch: string; baseline?: boolean; musl?: boolean }) {
  return ["moks", input.os, input.arch, input.baseline ? "baseline" : undefined, input.musl ? "musl" : undefined]
    .filter(Boolean)
    .join("-")
}

export function assetFileName(input: { os: string; arch: string; baseline?: boolean; musl?: boolean }) {
  return `${assetBase(input)}.${archiveExt(input.os)}`
}

export function assetCandidates(input: { os: string; arch: string; musl?: boolean; avx2?: boolean }) {
  const baseline = input.arch === "x64" && input.avx2 === false
  if (input.os === "linux") {
    if (input.musl) {
      if (input.arch === "x64") {
        if (baseline) {
          return [
            assetFileName({ os: "linux", arch: "x64", baseline: true, musl: true }),
            assetFileName({ os: "linux", arch: "x64", musl: true }),
            assetFileName({ os: "linux", arch: "x64", baseline: true }),
            assetFileName({ os: "linux", arch: "x64" }),
          ]
        }
        return [
          assetFileName({ os: "linux", arch: "x64", musl: true }),
          assetFileName({ os: "linux", arch: "x64", baseline: true, musl: true }),
          assetFileName({ os: "linux", arch: "x64" }),
          assetFileName({ os: "linux", arch: "x64", baseline: true }),
        ]
      }
      return [assetFileName({ os: "linux", arch: input.arch, musl: true }), assetFileName({ os: "linux", arch: input.arch })]
    }
    if (input.arch === "x64") {
      if (baseline) {
        return [
          assetFileName({ os: "linux", arch: "x64", baseline: true }),
          assetFileName({ os: "linux", arch: "x64" }),
          assetFileName({ os: "linux", arch: "x64", baseline: true, musl: true }),
          assetFileName({ os: "linux", arch: "x64", musl: true }),
        ]
      }
      return [
        assetFileName({ os: "linux", arch: "x64" }),
        assetFileName({ os: "linux", arch: "x64", baseline: true }),
        assetFileName({ os: "linux", arch: "x64", musl: true }),
        assetFileName({ os: "linux", arch: "x64", baseline: true, musl: true }),
      ]
    }
    return [assetFileName({ os: "linux", arch: input.arch }), assetFileName({ os: "linux", arch: input.arch, musl: true })]
  }
  if (input.arch === "x64") {
    if (baseline) {
      return [assetFileName({ os: input.os, arch: "x64", baseline: true }), assetFileName({ os: input.os, arch: "x64" })]
    }
    return [assetFileName({ os: input.os, arch: "x64" }), assetFileName({ os: input.os, arch: "x64", baseline: true })]
  }
  return [assetFileName({ os: input.os, arch: input.arch })]
}

export function isAllowedAssetName(name: string) {
  return /^moks-(darwin|linux|windows)-(arm64|x64)(?:-baseline)?(?:-musl)?\.(?:zip|tar\.gz)$/.test(name)
}

export function isForeignRepo(repo: string) {
  return /opencode|anomalyco/i.test(repo)
}

export function isAllowedDownloadUrl(href: string) {
  if (/opencode|anomalyco/i.test(href)) return false
  const url = URL.parse(href)
  if (!url) return false
  if (url.protocol !== "https:" && url.protocol !== "http:") return false
  const host = url.hostname
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1"
  if (loopback) return true
  if (url.protocol !== "https:") return false
  if (host === "github.com" || host === "objects.githubusercontent.com") return true
  const api = URL.parse(releaseApi())
  return api?.hostname === host
}
