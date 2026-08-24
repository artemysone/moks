import { expect } from "bun:test"
import { LayerNode } from "@moks/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Skill } from "../../src/skill"
import { CrossSpawnSpawner } from "@moks/core/cross-spawn-spawner"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { HiringSkills } from "../../src/product/hiring-skills"
import { HiringFixtures } from "../../src/product/fixtures"
import PROMPT_RECRUIT from "../../src/product/agents/recruit.txt"
import PROMPT_INITIALIZE from "../../src/command/template/initialize.txt"
import PROMPT_OPEN_REQ from "../../src/command/template/open-req.txt"
import { ReqWorkspace } from "../../src/product/req-workspace"
import path from "path"

const node = LayerNode.compile(CrossSpawnSpawner.node)
const it = testEffect(Layer.mergeAll(LayerNode.compile(Skill.node), node, testInstanceStoreLayer))

const HIRING_NAMES = ["req-context", "score-candidate", "draft-outreach", "commit-disposition"] as const

it.effect("HiringSkills exports four named packs with non-empty content", () =>
  Effect.sync(() => {
    expect(HiringSkills.map((s) => s.name)).toEqual([...HIRING_NAMES])
    for (const skill of HiringSkills) {
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.content.length).toBeGreaterThan(0)
    }
  }),
)

it.effect("HiringFixtures paths resolve to on-disk samples", () =>
  Effect.promise(async () => {
    expect(path.basename(HiringFixtures.dir)).toBe("hiring")
    for (const file of [HiringFixtures.hiring, HiringFixtures.card]) {
      expect(await Bun.file(file).exists()).toBe(true)
      expect((await Bun.file(file).text()).length).toBeGreaterThan(0)
    }
  }),
)

it.effect("score-candidate writes a score file path; commit-disposition cites it", () =>
  Effect.promise(async () => {
    const score = HiringSkills.find((s) => s.name === "score-candidate")
    const commit = HiringSkills.find((s) => s.name === "commit-disposition")
    expect(score?.content).toContain("candidates/<id>.md")
    expect(score?.content).toContain("You are not done until the file is written")
    expect(commit?.content).toContain("--target-id")
    expect(commit?.content).toContain("--meta")
    expect(commit?.content).toContain('{"card":"candidates/<id>.md"}')
    expect(PROMPT_RECRUIT).toContain("candidates/<id>.md")
    expect(PROMPT_RECRUIT).toContain("HIRING.md")
    expect(PROMPT_RECRUIT).toContain("--meta")
    expect(PROMPT_RECRUIT).toContain("Keep asking")
    expect(PROMPT_RECRUIT).toContain("question tool")
    const coreLoop = PROMPT_RECRUIT.split("## Skills")[0] ?? ""
    expect(coreLoop).not.toMatch(/3\.\s*Score/)
    expect(coreLoop).not.toContain("score-candidate")
    expect(coreLoop).toMatch(/talk \/ taste \/ commit/)
    expect(PROMPT_RECRUIT).not.toMatch(/Keep asking[\s\S]{0,80}score-candidate/)
    expect(PROMPT_RECRUIT).toMatch(/Folder-only is complete/)
    expect(PROMPT_RECRUIT).not.toMatch(/connect Ashby first|MCP required/i)
    expect(PROMPT_INITIALIZE).not.toMatch(/connect Ashby first|MCP required/i)
    expect(PROMPT_OPEN_REQ).not.toMatch(/connect Ashby first|MCP required/i)
    expect(PROMPT_RECRUIT).not.toContain("packages/moks/src/product/fixtures/hiring/")
    expect(PROMPT_INITIALIZE).toContain("HIRING.md")
    expect(PROMPT_INITIALIZE).toContain("Do not overwrite non-empty user content")
    expect(PROMPT_INITIALIZE).toContain("Do not treat a company name as a req")
    expect(PROMPT_INITIALIZE).toContain("The company workspace was already scaffolded")
    expect(PROMPT_INITIALIZE).toContain("`.moks/` ledger")
    expect(PROMPT_INITIALIZE).not.toContain("/open-req <title>")
    expect(PROMPT_INITIALIZE).toContain("talking in this chat")
    expect(PROMPT_INITIALIZE).toContain("scaffold the req directory")
    expect(PROMPT_INITIALIZE).toContain("The ledger is the audit log")
    expect(PROMPT_INITIALIZE).not.toContain("taking a req from a hiring manager")
    expect(PROMPT_INITIALIZE).not.toContain("${title}")
    expect(PROMPT_INITIALIZE).not.toContain("Git is the audit log")
    expect(PROMPT_INITIALIZE).not.toContain("ask once")
    expect(PROMPT_INITIALIZE).toContain("write `# <name>` as the COMPANY.md title")
    expect(PROMPT_INITIALIZE).toContain("type-your-own")
    expect(PROMPT_INITIALIZE).toContain('never a yes/no "want a working name on the constitution"')
    expect(PROMPT_INITIALIZE).not.toContain("dossier")
    expect(PROMPT_INITIALIZE).toContain("website")
    expect(PROMPT_INITIALIZE).toContain("public profile")
    expect(PROMPT_INITIALIZE).toContain(ReqWorkspace.INIT_FIRST_QUESTION.question)
    expect(PROMPT_INITIALIZE).toContain("## About from that (not TBD)")
    expect(PROMPT_INITIALIZE).toContain("Do not invent a constitution from nothing")
    expect(ReqWorkspace.INIT_FIRST_QUESTIONS[0]?.question).toMatch(/website|profile/i)
    expect(ReqWorkspace.INIT_FIRST_QUESTION.custom).toBe(true)
    expect(PROMPT_RECRUIT).not.toContain("A human runs `moks review`")
    expect(PROMPT_RECRUIT).not.toContain("Human only: `moks review`")
    expect(PROMPT_RECRUIT).toMatch(/taste|review pane/)
    expect(PROMPT_RECRUIT).not.toContain("dossier")
    expect(PROMPT_RECRUIT).not.toContain("/open-req <title>")
    expect(PROMPT_RECRUIT).toContain("ask for a role in language")
    expect(PROMPT_RECRUIT).toContain("scaffold the req directory")
    expect(PROMPT_RECRUIT).toContain("company constitution")
    const commandIndex = await Bun.file(path.join(import.meta.dir, "../../src/command/index.ts")).text()
    expect(commandIndex).toContain('description: "write or update the company constitution (COMPANY.md)"')
    expect(commandIndex).not.toContain("dossier")
    expect(commit?.content).not.toContain("A human runs `moks review`")
    expect(commit?.content).not.toContain("A human then:")
    expect(commit?.content).not.toContain("moks review <id>")
    expect(commit?.content).toMatch(/taste|review pane/)
    expect(PROMPT_OPEN_REQ).toContain("HIRING.md")
    expect(PROMPT_OPEN_REQ).toContain("candidates/<id>.md")
    expect(PROMPT_OPEN_REQ).toContain("Do not overwrite non-empty user content")
    expect(PROMPT_OPEN_REQ).toContain("Keep going until title, level, team/HM, location, and must-haves are real")
    expect(PROMPT_OPEN_REQ).toContain("Do not nest a second req")
    expect(PROMPT_OPEN_REQ).toContain("The ledger is the audit log")
  }),
)

it.live("built-in skills include hiring packs", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const list = yield* skill.all()
        const builtIn = list.filter((s) => s.location === "<built-in>")
        for (const name of HIRING_NAMES) {
          const item = builtIn.find((s) => s.name === name)
          expect(item).toBeDefined()
          if (!item) continue
          expect(item.description?.length ?? 0).toBeGreaterThan(0)
          expect(item.content.length).toBeGreaterThan(0)
        }
      }),
    { git: true },
  ),
)
