import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  candidateLabel,
  loadPacket,
  movePacketIndex,
  packetRows,
  scorePrompt,
  titleFromSlug,
} from "../../src/feature-plugins/sidebar/packet-data"

const hiringFixture = path.resolve(import.meta.dir, "../../../cli/src/product/fixtures/hiring")

describe("loadPacket", () => {
  test("lists both reqs at a company root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Northline\n")
    await mkdir(path.join(dir, "senior-backend"), { recursive: true })
    await mkdir(path.join(dir, "staff-platform"), { recursive: true })
    await writeFile(path.join(dir, "senior-backend", "HIRING.md"), "# Senior Backend\n")
    await writeFile(path.join(dir, "staff-platform", "HIRING.md"), "# Staff Platform\n")

    const packet = await loadPacket(dir)
    expect(packet?.companyTitle).toBe("Northline")
    expect(packet?.reqs.map((req) => req.slug)).toEqual(["senior-backend", "staff-platform"])
    expect(packet?.reqs.every((req) => !req.focused)).toBe(true)
    expect(packet?.packet).toBeUndefined()
  })

  test("hiring fixture shows Jordan Lee as sourced", async () => {
    const packet = await loadPacket(hiringFixture)
    expect(packet?.companyTitle).toBe("Senior Backend Engineer")
    expect(packet?.reqs).toEqual([
      { slug: "hiring", title: "Senior Backend Engineer", focused: true },
    ])
    expect(packet?.packet?.title).toBe("Senior Backend Engineer")
    expect(packet?.packet?.candidates[0]?.id).toBe("jordan-lee")
    expect(packet?.packet?.candidates[0]?.name).toBe("Jordan Lee")
    expect(packet?.packet?.candidates[0]?.stage).toBe("sourced")
  })

  test("empty focused req has no candidates", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Northline\n")
    await mkdir(path.join(dir, "new-req", "candidates"), { recursive: true })
    await writeFile(path.join(dir, "new-req", "HIRING.md"), "# New Role\n")
    await writeFile(path.join(dir, "new-req", "candidates", ".gitkeep"), "")
    await mkdir(path.join(dir, ".moks"), { recursive: true })
    await writeFile(path.join(dir, ".moks", "focus"), "new-req\n")

    const packet = await loadPacket(dir)
    expect(packet?.reqs.map((req) => ({ slug: req.slug, focused: req.focused }))).toEqual([
      { slug: "new-req", focused: true },
    ])
    expect(packet?.packet?.title).toBe("New Role")
    expect(packet?.packet?.candidates).toEqual([])
  })

  test("cwd inside candidates/ still loads the packet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Northline\n")
    await mkdir(path.join(dir, "staff-platform", "candidates"), { recursive: true })
    await writeFile(path.join(dir, "staff-platform", "HIRING.md"), "# Staff Platform\n")
    await writeFile(
      path.join(dir, "staff-platform", "candidates", "alex-kim.md"),
      "---\nid: alex-kim\nstage: sourced\n---\n\n# Alex\n",
    )

    const packet = await loadPacket(path.join(dir, "staff-platform", "candidates"))
    expect(packet?.companyTitle).toBe("Northline")
    expect(packet?.packet?.slug).toBe("staff-platform")
    expect(packet?.packet?.title).toBe("Staff Platform")
    expect(packet?.packet?.candidates).toEqual([{ id: "alex-kim", name: "Alex", stage: "sourced" }])
  })

  test("COMPANY.md company lists reqs without root HIRING.md", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "COMPANY.md"), "# Northline\n")
    await mkdir(path.join(dir, "senior-backend", "candidates"), { recursive: true })
    await mkdir(path.join(dir, "staff-platform", "candidates"), { recursive: true })
    await writeFile(path.join(dir, "senior-backend", "HIRING.md"), "# Senior Backend\n")
    await writeFile(path.join(dir, "staff-platform", "HIRING.md"), "# Staff Platform\n")
    await writeFile(
      path.join(dir, "staff-platform", "candidates", "alex-kim.md"),
      "---\nid: alex-kim\nstage: sourced\nscore: 3\n---\n\n# Alex Kim\n",
    )

    const packet = await loadPacket(dir)
    expect(packet?.companyTitle).toBe("Northline")
    expect(packet?.reqs.map((req) => req.slug)).toEqual(["senior-backend", "staff-platform"])
    expect(packet?.reqs.every((req) => !req.focused)).toBe(true)
    expect(packet?.packet).toBeUndefined()

    const nested = await loadPacket(path.join(dir, "staff-platform", "candidates"))
    expect(nested?.companyTitle).toBe("Northline")
    expect(nested?.packet?.slug).toBe("staff-platform")
    expect(nested?.packet?.title).toBe("Staff Platform")
    expect(nested?.packet?.candidates).toEqual([{ id: "alex-kim", name: "Alex Kim", stage: "sourced", score: 3 }])
  })

  test("COMPANY.md without H1 uses directory name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "COMPANY.md"), "About us\n")
    await mkdir(path.join(dir, "staff-platform"), { recursive: true })
    await writeFile(path.join(dir, "staff-platform", "HIRING.md"), "# Staff Platform\n")

    const packet = await loadPacket(dir)
    expect(packet?.companyTitle).toBe(path.basename(dir))
    expect(packet?.reqs.map((req) => req.slug)).toEqual(["staff-platform"])
  })

  test("card heading wins, then title-cased id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Role\n")
    await mkdir(path.join(dir, "candidates"), { recursive: true })
    await writeFile(path.join(dir, "candidates", "sam-ortiz.md"), "---\nid: sam-ortiz\nstage: phone\n---\n")

    const packet = await loadPacket(dir)
    expect(packet?.packet?.candidates).toEqual([{ id: "sam-ortiz", name: "Sam Ortiz", stage: "phone" }])
  })
})

describe("packet rows", () => {
  test("title-cases slugs and formats people without .md", () => {
    expect(titleFromSlug("jordan-lee")).toBe("Jordan Lee")
    expect(candidateLabel({ id: "jordan-lee", name: "Jordan Lee", stage: "sourced", score: 4 })).toBe(
      "Jordan Lee  sourced  4",
    )
    expect(scorePrompt("jordan-lee")).toBe("Score jordan-lee")
  })

  test("flattens reqs then people and clamps movement", () => {
    const rows = packetRows({
      company: "/tmp/co",
      companyTitle: "Northline",
      reqs: [
        { slug: "senior-backend", title: "Senior Backend", focused: false },
        { slug: "staff-platform", title: "Staff Platform", focused: true },
      ],
      packet: {
        slug: "staff-platform",
        title: "Staff Platform",
        candidates: [{ id: "alex-kim", name: "Alex Kim", stage: "sourced" }],
      },
    })
    expect(rows.map((row) => row.kind)).toEqual(["req", "req", "candidate"])
    expect(movePacketIndex(0, -1, rows.length)).toBe(0)
    expect(movePacketIndex(0, 1, rows.length)).toBe(1)
    expect(movePacketIndex(2, 1, rows.length)).toBe(2)
    expect(movePacketIndex(0, 1, 0)).toBe(0)
  })
})
