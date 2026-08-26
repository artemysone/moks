import { loadPacket, type PacketCandidate } from "../feature-plugins/sidebar/packet-data"
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
  const action = await DialogPrompt.show(input.dialog, "Stage decision", {
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

  const packet = input.cwd ? await loadPacket(input.cwd) : undefined
  const cards = packet?.packet?.candidates ?? []
  const resolved = await resolveCommitTarget(input.dialog, cards)
  if (!resolved) {
    input.toast.show({ message: "Stage cancelled", variant: "info" })
    input.dialog.clear()
    return
  }
  const inferred = resolved.target
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
  await showResult(input.dialog, "Stage result", result)
}

export async function runPushFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const listed = await call(["status", "--json"], input)
  if (listed.code !== 0) {
    input.toast.show({ message: "Failed to list open decisions", variant: "error" })
    await showResult(input.dialog, "Apply to ATS", listed)
    return
  }

  const approved = statusByStatus(listed.json, "approved")
  const commitID = await pickChangeset(input.dialog, "Apply changeset", approved)
  if (commitID === null) return
  if (!commitID) {
    input.toast.show({ message: "No approved changeset to apply", variant: "info" })
    input.dialog.clear()
    return
  }

  const mode = await DialogSelect.show(input.dialog, "Apply mode", [
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
    const ok = await DialogConfirm.show(input.dialog, "Confirm apply", confirmMessage(result.json))
    if (!ok) {
      input.toast.show({ message: "Apply cancelled", variant: "info" })
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
  await showResult(input.dialog, "Apply result", result)
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
  await showResult(input.dialog, "Decisions", result)
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

async function resolveCommitTarget(dialog: DialogContext, cards: PacketCandidate[]) {
  if (cards.length === 1) return { target: commitTarget(cards[0].id) }
  if (cards.length === 0) {
    const ok = await DialogConfirm.show(
      dialog,
      "No candidate target",
      "No candidate card in the focused req. Record this disposition without a target?",
    )
    if (!ok) return
    return {}
  }
  const picked = await DialogSelect.show(
    dialog,
    "Pick candidate",
    cards.map((card) => ({
      title: card.id,
      value: card.id,
      description: [card.stage, card.score !== undefined ? `score ${card.score}` : undefined]
        .filter((part) => part !== undefined)
        .join(" · "),
    })),
  )
  if (picked === null) return
  return { target: commitTarget(picked) }
}

function commitTarget(id: string) {
  return { id, card: `candidates/${id}.md` }
}
