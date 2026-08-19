import { describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@moks/core/effect/layer-node"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { DecisionVerbs } from "../../src/decision/verbs"
import { MessageID, SessionID } from "../../src/session/schema"
import { CommitTool, DiffTool, StatusTool } from "../../src/tool/decision"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("msg_test-message"),
  callID: "test-call",
  agent: "recruit",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

describe("tool.decision", () => {
  it.instance(
    "commit then status shows the changeset",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "HIRING.md"), "# Role\n"))
        yield* Effect.promise(() => DecisionVerbs.pull({ cwd: test.directory }))

        const commitInfo = yield* CommitTool
        const commit = yield* commitInfo.init()
        const committed = yield* commit.execute(
          { action: "advance", target_id: "cand_priya", target_kind: "candidate", reason: "next round" },
          ctx,
        )
        const commitBody = JSON.parse(committed.output)
        expect(commitBody.changeset.changes[0].mutation).toBe("AdvanceStage")
        expect(commitBody.changeset.author_kind).toBe("agent")

        const statusInfo = yield* StatusTool
        const status = yield* statusInfo.init()
        const listed = yield* status.execute({}, ctx)
        const statusBody = JSON.parse(listed.output)
        expect(statusBody.open.some((row: { id: string }) => row.id === commitBody.changeset.id)).toBe(true)
      }),
    90_000,
  )

  it.instance(
    "diff shows the staged mutation",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "HIRING.md"), "# Role\n"))
        yield* Effect.promise(() => DecisionVerbs.pull({ cwd: test.directory }))

        const commitInfo = yield* CommitTool
        const commit = yield* commitInfo.init()
        const committed = yield* commit.execute(
          { action: "note", target_id: "cand_priya", reason: "spoke to HM" },
          ctx,
        )
        const commitBody = JSON.parse(committed.output)

        const diffInfo = yield* DiffTool
        const diff = yield* diffInfo.init()
        const listed = yield* diff.execute({ id: commitBody.changeset.id }, ctx)
        const body = JSON.parse(listed.output)
        expect(body.diffs[0].changes[0].mutation).toBe("AddNote")
      }),
    90_000,
  )
})
