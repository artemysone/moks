/**
 * Shared chunk shapes for OpenAI Chat / OpenAI-compatible Chat fixture tests.
 * Multiple test files build the same `{ id, choices: [{ delta, finish_reason }], usage }`
 * envelope; consolidating here keeps tool-call event shapes consistent.
 */

const FIXTURE_ID = "chatcmpl_fixture"

export interface ChatDelta {
  readonly role?: string
  readonly content?: string | number
  readonly tool_calls?: ReadonlyArray<{
    readonly index?: number
    readonly id?: string
    readonly function?: { readonly name?: string; readonly arguments?: string }
  }>
}

export interface ChatUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly total_tokens?: number
  readonly prompt_tokens_details?: { readonly cached_tokens?: number }
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number }
}

export const deltaChunk = (delta: ChatDelta, finishReason: string | null = null) => ({
  id: FIXTURE_ID,
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

export const usageChunk = (usage: ChatUsage) => ({
  id: FIXTURE_ID,
  choices: [],
  usage,
})

export const finishChunk = (reason: string) => deltaChunk({}, reason)

export const toolCallChunk = (id: string, name: string, args: string, index = 0) =>
  deltaChunk({
    role: "assistant",
    tool_calls: [{ index, id, function: { name, arguments: args } }],
  })
