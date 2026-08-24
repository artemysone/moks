import { describe, expect, test } from "bun:test"
import type { QuestionRequest } from "@moks/sdk/v2"
import {
  createQuestionBodyState,
  questionConfirm,
  questionIsFreeText,
  questionReject,
  questionSave,
  questionSelect,
  questionSetSelected,
  questionStoreCustom,
  questionSubmit,
  questionSync,
} from "@/cli/cmd/run/question.shared"

function req(input: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Mode?",
        header: "Mode",
        options: [{ label: "chunked", description: "Incremental output" }],
        multiple: false,
      },
    ],
    ...input,
  }
}

describe("run question shared", () => {
  test("replies immediately for a single-select question", () => {
    const out = questionSelect(createQuestionBodyState("question-1"), req())

    expect(out.reply).toEqual({
      requestID: "question-1",
      answers: [["chunked"]],
    })
  })

  test("advances multi-question flows and submits from confirm", () => {
    const ask = req({
      questions: [
        {
          question: "Mode?",
          header: "Mode",
          options: [{ label: "chunked", description: "Incremental output" }],
          multiple: false,
        },
        {
          question: "Output?",
          header: "Output",
          options: [
            { label: "yes", description: "Show tool output" },
            { label: "no", description: "Hide tool output" },
          ],
          multiple: false,
        },
      ],
    })

    let state = questionSelect(createQuestionBodyState("question-1"), ask).state
    expect(state.tab).toBe(1)

    state = questionSetSelected(state, 1)
    state = questionSelect(state, ask).state
    expect(questionConfirm(ask, state)).toBe(true)
    expect(questionSubmit(ask, state)).toEqual({
      requestID: "question-1",
      answers: [["chunked"], ["no"]],
    })
  })

  test("toggles answers for multiple-choice questions", () => {
    const ask = req({
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
        },
      ],
    })

    let state = questionSelect(createQuestionBodyState("question-1"), ask).state
    expect(state.answers).toEqual([["bug"]])

    state = questionSelect(state, ask).state
    expect(state.answers).toEqual([[]])
  })

  test("stores and submits custom answers", () => {
    let state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    let next = questionSelect(state, req())
    expect(next.state.editing).toBe(true)

    state = questionStoreCustom(next.state, 0, "  custom mode  ")
    next = questionSave(state, req())
    expect(next.reply).toEqual({
      requestID: "question-1",
      answers: [["custom mode"]],
    })
  })

  test("submits a typed string from the question itself when options are empty", () => {
    const ask = req({
      questions: [
        {
          question: "What band?",
          header: "Band",
          options: [],
          custom: true,
        },
      ],
    })

    expect(questionIsFreeText(ask.questions[0])).toBe(true)

    let state = createQuestionBodyState("question-1", ask)
    expect(state.editing).toBe(true)

    state = questionStoreCustom(state, 0, "Talking Heads")
    const next = questionSave(state, ask)
    expect(next.reply).toEqual({
      requestID: "question-1",
      answers: [["Talking Heads"]],
    })
  })

  test("resets state when the request id changes and builds reject payloads", () => {
    const state = questionSetSelected(createQuestionBodyState("question-1"), 1)

    expect(questionSync(state, "question-1")).toBe(state)
    expect(questionSync(state, "question-2")).toEqual(createQuestionBodyState("question-2"))
    expect(questionReject(req())).toEqual({
      requestID: "question-1",
    })
  })
})
