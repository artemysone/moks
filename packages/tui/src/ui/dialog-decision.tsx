import { readdir } from "node:fs/promises"
import path from "node:path"
import type { DialogContext } from "./dialog"
import { DialogAlert } from "./dialog-alert"
import { DialogConfirm } from "./dialog-confirm"
import { DialogPrompt } from "./dialog-prompt"
import { DialogSelect } from "./dialog-select"
import {
  commitToastMessage,
  confirmMessage,
  formatDecisionResult,
  formatReceiptLine,
  isDryRun,
  needsConfirm,
  pushCommandArgs,
  pushToastMessage,
  receiptId,
  reviewCommandArgs,
  reviewToastMessage,
  runDecision,
  statusByStatus,
  type ChangesetRow,
  type DecisionCliResult,
} from "../util/decision-cli"

type Toast = {
  show(input: { message: string; variant?: "info" | "success" | "error" | "warning"; duration?: number }): void
  error(error: unknown): void
}

export async function runCommitFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const action = await DialogPrompt.show(input.dialog, "Commit decision", {
    placeholder: "action (e.g. note, reject, offer, hire)",
  })
  if (action === null) return
  const trimmedAction = action.trim()
  if (!trimmedAction) {
    input.toast.show({ message: "Action is required", variant: "error" })
    input.dialog.clear()
    return
  }

  const reasonRaw = await DialogPrompt.show(input.dialog, "Reason", {
    placeholder: "why this decision (required)",
  })
  if (reasonRaw === null) return
  const reason = reasonRaw.trim()
  if (!reason) {
    input.toast.show({ message: "Reason is required", variant: "error" })
    input.dialog.clear()
    return
  }

  const inferred = input.cwd ? await singleCandidate(input.cwd) : undefined
  const args = ["commit", "--json", "--action", trimmedAction, "--reason", reason]
  if (inferred) {
    args.push("--target-kind", "candidate", "--target-id", inferred.id)
    args.push("--meta", JSON.stringify({ card: inferred.card }))
  }

  const result = await call(args, input)
  const id = receiptId(result.json)
  const ok = result.code === 0
  input.toast.show({
    message: commitToastMessage({ ok, id, target: inferred?.id }),
    variant: ok ? "success" : "error",
  })
  await showResult(input.dialog, "Commit result", result)
}

export async function runPushFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const listed = await call(["status", "--json"], input)
  if (listed.code !== 0) {
    input.toast.show({ message: "Failed to list open decisions", variant: "error" })
    await showResult(input.dialog, "Push decision", listed)
    return
  }

  const approved = statusByStatus(listed.json, "approved")
  const commitID = await pickChangeset(input.dialog, "Push changeset", approved)
  if (commitID === null) return
  if (!commitID) {
    input.toast.show({ message: "No approved changeset to push", variant: "info" })
    input.dialog.clear()
    return
  }

  const mode = await DialogSelect.show(input.dialog, "Push mode", [
    {
      title: "Dry-run",
      value: "dry-run" as const,
      description: "Preview only, no ATS write",
    },
    {
      title: "Write to ATS",
      value: "execute" as const,
      description: "Apply this changeset to the ATS",
    },
  ])
  if (mode === null) return
  const execute = mode === "execute"

  let result = await call(pushCommandArgs({ id: commitID, execute }), input)
  if (needsConfirm(result.json)) {
    const ok = await DialogConfirm.show(input.dialog, "Confirm push", confirmMessage(result.json))
    if (!ok) {
      input.toast.show({ message: "Push cancelled", variant: "info" })
      input.dialog.clear()
      return
    }
    result = await call(pushCommandArgs({ id: commitID, execute, confirm: true }), input)
  }

  const ok = result.code === 0
  input.toast.show({
    message: pushToastMessage({ ok, dryRun: isDryRun(result.json) }),
    variant: ok ? "success" : "error",
  })
  await showResult(input.dialog, "Push result", result)
}

export async function runReviewFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const listed = await call(["status", "--json"], input)
  if (listed.code !== 0) {
    input.toast.show({ message: "Failed to list staged changesets", variant: "error" })
    await showResult(input.dialog, "Review changeset", listed)
    return
  }

  const staged = statusByStatus(listed.json, "staged")
  const commitID = await pickChangeset(input.dialog, "Review changeset", staged)
  if (commitID === null) return
  if (!commitID) {
    input.toast.show({ message: "No staged changeset to review", variant: "info" })
    input.dialog.clear()
    return
  }

  const action = await DialogSelect.show(input.dialog, "Review action", [
    { title: "Approve", value: "approve" as const, description: "Mark staged changeset approved" },
    { title: "Reject", value: "reject" as const, description: "Reject this changeset" },
  ])
  if (action === null) return

  const whoRaw = await DialogPrompt.show(input.dialog, "Reviewer", {
    placeholder: "who is reviewing",
    value: process.env.USER ?? process.env.LOGNAME ?? "human",
  })
  if (whoRaw === null) return
  const who = whoRaw.trim()
  if (!who) {
    input.toast.show({ message: "Reviewer is required", variant: "error" })
    input.dialog.clear()
    return
  }

  const result = await call(reviewCommandArgs({ id: commitID, action, by: who }), input)
  const id = receiptId(result.json) ?? commitID
  const ok = result.code === 0
  input.toast.show({
    message: reviewToastMessage({ ok, action, id }),
    variant: ok ? "success" : "error",
  })
  await showResult(input.dialog, "Review result", result)
}

export async function runDecisionsFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const result = await call(["status", "--json"], input)
  if (result.code !== 0) {
    input.toast.show({ message: "Failed to list decisions", variant: "error" })
  }
  await showResult(input.dialog, "Decision commits", result)
}

async function call(args: string[], input: { toast: Toast; cwd?: string }) {
  try {
    return await runDecision(args, { cwd: input.cwd })
  } catch (error) {
    input.toast.error(error)
    return {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      json: undefined,
    } satisfies DecisionCliResult
  }
}

async function showResult(dialog: DialogContext, title: string, result: DecisionCliResult) {
  const message = formatDecisionResult(result)
  await DialogAlert.show(dialog, title, message.length > 4000 ? `${message.slice(0, 4000)}\n…` : message)
}

async function pickChangeset(dialog: DialogContext, title: string, open: ChangesetRow[]) {
  if (open.length === 0) return ""
  if (open.length === 1 && open[0].id) return open[0].id
  return DialogSelect.show(
    dialog,
    title,
    open.flatMap((row) => {
      if (!row.id) return []
      return [
        {
          title: row.id,
          value: row.id,
          description: formatReceiptLine(row),
        },
      ]
    }),
  )
}

async function singleCandidate(cwd: string) {
  const names = await readdir(path.join(cwd, "candidates"), { withFileTypes: true })
    .then((entries) =>
      entries.flatMap((entry) =>
        entry.isFile() && entry.name.endsWith(".md") && entry.name !== ".gitkeep" ? [entry.name] : [],
      ),
    )
    .catch(() => [] as string[])
  if (names.length !== 1) return
  const name = names[0]
  return {
    id: path.basename(name, ".md"),
    card: `candidates/${name}`,
  }
}
