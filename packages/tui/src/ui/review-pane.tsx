/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "../keymap"
import { useTheme } from "../context/theme"
import { useToast } from "./toast"
import { useProject } from "../context/project"
import { useSDK } from "../context/sdk"
import {
  canMergePush,
  canTaste,
  formatQueueLine,
  inspectReviewCommandArgs,
  listReviewCommandArgs,
  mergeBlockedReason,
  parseInspectReview,
  parseStagedReviews,
  rejectReasonFromTaste,
  reviewDecisionArgs,
  reviewPushArgs,
  type StagedReviewRow,
  type TasteSurface,
} from "../util/review-queue"
import { confirmMessage, isDryRun, needsConfirm, pushToastMessage, reviewToastMessage, runDecision } from "../util/decision-cli"

const PANE_WIDTH = 42

export function ReviewPane(props: { onClose: () => void }) {
  const theme = useTheme().theme
  const toast = useToast()
  const project = useProject()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const cwd = createMemo(() => project.instance.directory() || sdk.directory || undefined)
  const [selected, setSelected] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const [listed] = createResource(
    () => ({ cwd: cwd(), tick: tick() }),
    async (input) => {
      const result = await runDecision(listReviewCommandArgs(), { cwd: input.cwd })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || "review list failed")
      }
      return parseStagedReviews(result.json)
    },
  )

  const rows = createMemo(() => listed() ?? [])
  const current = createMemo(() => {
    const list = rows()
    if (list.length === 0) return
    const index = Math.min(Math.max(selected(), 0), list.length - 1)
    return list[index]
  })

  const [inspected] = createResource(
    () => ({ id: current()?.id, cwd: cwd(), tick: tick() }),
    async (input) => {
      if (!input.id) return undefined
      const result = await runDecision(inspectReviewCommandArgs(input.id), { cwd: input.cwd })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || "review inspect failed")
      }
      return parseInspectReview(result.json)
    },
  )

  createEffect(() => {
    const list = rows()
    if (selected() >= list.length) setSelected(Math.max(0, list.length - 1))
  })

  const bless = async (action: "approve" | "reject") => {
    const row = current()
    if (!row) return
    const taste = inspected()
    const status = taste?.status ?? row.status
    if (!canTaste(status)) {
      toast.show({ message: "Only staged changesets can be blessed", variant: "warning" })
      return
    }
    const reason = action === "reject" ? rejectReasonFromTaste(taste) : ""
    if (action === "reject" && !reason) {
      toast.show({
        message: "review --reject needs --reason (or inspect body already on the changeset)",
        variant: "error",
      })
      return
    }
    const result = await runDecision(reviewDecisionArgs({ id: row.id, action, reason: reason || undefined }), { cwd: cwd() })
    const ok = result.code === 0
    toast.show({
      message: reviewToastMessage({ ok, action, id: row.id }),
      variant: ok ? "success" : "error",
    })
    if (ok) setTick((value) => value + 1)
  }

  const mergePush = async () => {
    const row = current()
    if (!row) return
    const taste = inspected()
    const status = taste?.status ?? row.status
    if (!canMergePush(status)) {
      toast.show({
        message: mergeBlockedReason(status) ?? "Approve first — push applies only after bless",
        variant: "warning",
      })
      return
    }
    const result = await runDecision(reviewPushArgs(row.id), { cwd: cwd() })
    const ok = result.code === 0
    toast.show({
      message: needsConfirm(result.json)
        ? confirmMessage(result.json)
        : pushToastMessage({ ok, dryRun: isDryRun(result.json) }),
      variant: ok ? "success" : "error",
    })
    if (ok) setTick((value) => value + 1)
  }

  useBindings(() => ({
    enabled: true,
    bindings: [
      { key: "escape", desc: "Close review pane", cmd: props.onClose },
      { key: "j,down", desc: "Next staged changeset", cmd: () => setSelected((value) => value + 1) },
      { key: "k,up", desc: "Previous staged changeset", cmd: () => setSelected((value) => Math.max(0, value - 1)) },
      { key: "y,a", desc: "Approve (bless)", cmd: () => void bless("approve") },
      { key: "n,r", desc: "Reject", cmd: () => void bless("reject") },
      { key: "p,m", desc: "Push (merge after bless)", cmd: () => void mergePush() },
    ],
  }))

  const left = createMemo(() => Math.max(0, dimensions().width - PANE_WIDTH))

  return (
    <box
      position="absolute"
      zIndex={2400}
      left={left()}
      top={0}
      width={PANE_WIDTH}
      height={dimensions().height}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.border}
      padding={1}
      flexDirection="column"
    >
      <text fg={theme.text}>Taste</text>
      <text fg={theme.textMuted}>y bless · n reject · p push after bless</text>
      <box height={1} />
      <Show when={listed.error}>
        <text fg={theme.error}>{String(listed.error)}</text>
      </Show>
      <Show when={!listed.loading && rows().length === 0 && !listed.error}>
        <text fg={theme.textMuted}>no staged or approved changesets</text>
      </Show>
      <For each={rows()}>
        {(row, index) => <QueueRow row={row} active={index() === selected()} />}
      </For>
      <box height={1} />
      <TasteBody taste={inspected()} loading={inspected.loading} error={inspected.error} />
    </box>
  )
}

function QueueRow(props: { row: StagedReviewRow; active: boolean }) {
  const theme = useTheme().theme
  return (
    <text fg={props.active ? theme.primary : theme.text}>
      {props.active ? "▸ " : "  "}
      {formatQueueLine(props.row)}
    </text>
  )
}

function TasteBody(props: { taste?: TasteSurface; loading?: boolean; error?: unknown }) {
  const theme = useTheme().theme
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <Show when={props.loading}>
        <text fg={theme.textMuted}>inspecting…</text>
      </Show>
      <Show when={props.error}>
        <text fg={theme.error}>{String(props.error)}</text>
      </Show>
      <Show when={props.taste}>
        {(taste) => (
          <>
            <text fg={theme.text}>what</text>
            <For each={taste().what}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
            <box height={1} />
            <text fg={theme.text}>why</text>
            <text fg={theme.textMuted}>{taste().why || "(no rationale)"}</text>
            <box height={1} />
            <text fg={theme.text}>bless</text>
            <text fg={theme.textMuted}>{taste().bless}</text>
          </>
        )}
      </Show>
    </box>
  )
}
