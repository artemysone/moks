import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { DecisionVerbs } from "@/decision/verbs"
import { importLedger } from "@/decision/session"

export const CommitParameters = Schema.Struct({
  action: Schema.optional(Schema.String).annotate({
    description: "Disposition action (advance, reject, offer, hire, note) or a ledger mutation name",
  }),
  mutation: Schema.optional(Schema.String).annotate({
    description: "AdvanceStage | Reject | Withdraw | AddNote | AddTag | SendOutreach | ExtendOffer",
  }),
  entity: Schema.optional(Schema.String).annotate({
    description: "type:id (e.g. application:app_priya_142)",
  }),
  target_id: Schema.optional(Schema.String).annotate({ description: "Candidate or application id" }),
  target_kind: Schema.optional(Schema.String).annotate({ description: "Opaque target kind (usually candidate)" }),
  reason: Schema.optional(Schema.String).annotate({ description: "Human reason for the disposition" }),
  rationale: Schema.optional(Schema.String).annotate({ description: "Changeset rationale; defaults to reason" }),
  to: Schema.optional(Schema.String).annotate({ description: "AdvanceStage target stage" }),
  body: Schema.optional(Schema.String).annotate({ description: "AddNote / SendOutreach body" }),
})

export const StatusParameters = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({ description: "Filter by changeset id" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max changesets to list (default 20)" }),
})

export const DiffParameters = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({
    description: "Changeset id. Omit to diff every staged and approved changeset.",
  }),
})

export const CommitTool = Tool.define("commit", Effect.succeed({
  description:
    "Stage a hiring changeset on the ledger. Same as `moks commit`. Does not write the ATS and cannot approve or push. Prefer this over bash.",
  parameters: CommitParameters,
  execute: (params: Schema.Schema.Type<typeof CommitParameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      const mutations = DecisionVerbs.previewMutations({
        action: params.action,
        mutation: params.mutation,
        entity: params.entity,
      })
      const always = yield* Effect.promise(() => irreversibleMutations(mutations))
      yield* ctx.ask({
        permission: "commit",
        patterns: mutations.length > 0 ? mutations : ["*"],
        always: always.length > 0 ? always : ["*"],
        metadata: { mutations, effect_classes: always },
      })
      const instance = yield* InstanceState.context
      const result = yield* Effect.promise(() =>
        DecisionVerbs.commit({
          action: params.action,
          mutation: params.mutation,
          entity: params.entity,
          target:
            params.target_id || params.target_kind
              ? { kind: params.target_kind ?? "candidate", id: params.target_id }
              : undefined,
          reason: params.reason,
          rationale: params.rationale ?? params.reason,
          to: params.to,
          body: params.body,
          author_kind: "agent",
          source: "tool",
          cwd: instance.directory,
        }),
      )
      const staged = result.changeset.changes.map((change) => change.mutation).join(",")
      return {
        title: `staged ${staged}`,
        output: [`staged ${result.changeset.id} ${result.changeset.status} ${staged}`, result.next].join("\n"),
        metadata: result,
      }
    }).pipe(Effect.orDie),
}))

export const StatusTool = Tool.define("status", Effect.succeed({
  description: "Show mirrored pipeline and changeset counts. Same as `moks status`. Prefer this over bash.",
  parameters: StatusParameters,
  execute: (params: Schema.Schema.Type<typeof StatusParameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      yield* ctx.ask({
        permission: "status",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })
      const instance = yield* InstanceState.context
      const result = yield* Effect.promise(() =>
        DecisionVerbs.status({
          id: params.id,
          limit: params.limit,
          cwd: instance.directory,
        }),
      )
      return {
        title: `${result.open.length} open`,
        output: JSON.stringify(result, null, 2),
        metadata: result,
      }
    }).pipe(Effect.orDie),
}))

export const DiffTool = Tool.define("diff", Effect.succeed({
  description:
    "Show staged ledger mutations versus the current ATS mirror. Same as `moks diff`. Does not write. Prefer this over bash.",
  parameters: DiffParameters,
  execute: (params: Schema.Schema.Type<typeof DiffParameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      yield* ctx.ask({
        permission: "diff",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })
      const instance = yield* InstanceState.context
      const result = yield* Effect.promise(() =>
        DecisionVerbs.diff({
          id: params.id,
          cwd: instance.directory,
        }),
      )
      return {
        title: `${result.diffs.length} changeset${result.diffs.length === 1 ? "" : "s"}`,
        output: JSON.stringify(result, null, 2),
        metadata: result,
      }
    }).pipe(Effect.orDie),
}))

async function irreversibleMutations(mutations: string[]) {
  if (mutations.length === 0) return []
  const api = await importLedger()
  return mutations.filter((name) => api.isMutation(name) && api.MUTATION_EFFECT_CLASS[name] !== "reversible")
}
