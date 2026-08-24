import { describe, expect, test } from "bun:test"
import {
  archiveExt,
  assetCandidates,
  assetFileName,
  isAllowedAssetName,
  isAllowedDownloadUrl,
  releaseRepo,
} from "../../src/installation/asset"

describe("release assets", () => {
  test("names match build.ts archives", () => {
    expect(assetFileName({ os: "darwin", arch: "arm64" })).toBe("moks-darwin-arm64.zip")
    expect(assetFileName({ os: "linux", arch: "x64", musl: true, baseline: true })).toBe(
      "moks-linux-x64-baseline-musl.tar.gz",
    )
    expect(assetFileName({ os: "windows", arch: "x64" })).toBe("moks-windows-x64.zip")
    expect(archiveExt("linux")).toBe("tar.gz")
  })

  test("prefers native then baseline then musl, like postinstall", () => {
    expect(assetCandidates({ os: "linux", arch: "x64", musl: false, avx2: true })).toEqual([
      "moks-linux-x64.tar.gz",
      "moks-linux-x64-baseline.tar.gz",
      "moks-linux-x64-musl.tar.gz",
      "moks-linux-x64-baseline-musl.tar.gz",
    ])
  })

  test("accepts only moks platform archives", () => {
    expect(isAllowedAssetName("moks-darwin-arm64.zip")).toBe(true)
    expect(isAllowedAssetName("opencode-darwin-arm64.zip")).toBe(false)
    expect(isAllowedAssetName("moks-darwin-arm64.zip.exe")).toBe(false)
  })

  test("refuses an OpenCode release repo", () => {
    const prev = process.env.MOKS_RELEASE_REPO
    process.env.MOKS_RELEASE_REPO = "anomalyco/opencode"
    try {
      expect(() => releaseRepo()).toThrow(/foreign release repo/)
    } finally {
      if (prev === undefined) delete process.env.MOKS_RELEASE_REPO
      else process.env.MOKS_RELEASE_REPO = prev
    }
  })

  test("refuses OpenCode download hosts", () => {
    expect(isAllowedDownloadUrl("https://github.com/artemysone/moks/releases/download/v1.0.0/moks-darwin-arm64.zip")).toBe(
      true,
    )
    expect(isAllowedDownloadUrl("https://opencode.ai/install")).toBe(false)
    expect(isAllowedDownloadUrl("https://github.com/anomalyco/opencode/releases/download/v1.0.0/opencode-darwin-arm64.zip")).toBe(
      false,
    )
  })
})
