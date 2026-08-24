import { createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import {
  applyConnectorAction,
  CONNECT_PILLS,
  connectPillStatus,
  type ConnectPill,
} from "../feature-plugins/home/connect-pills"

function failMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function useConnector() {
  const dialog = useDialog()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  async function refresh() {
    const status = await sdk.client.mcp.status()
    if (status.data) sync.set("mcp", status.data)
  }

  async function addRemote(pill: ConnectPill) {
    const url = await DialogPrompt.show(dialog, `Connect ${pill.label}`, {
      placeholder: "https://example.com/mcp",
      description: () => <text fg={theme.textMuted}>Remote MCP URL. Written to this company's moks.json.</text>,
    })
    if (url === null) return
    const trimmed = url.trim()
    if (!trimmed || !URL.canParse(trimmed)) {
      toast.show({ variant: "error", message: "Enter a valid MCP URL" })
      return
    }
    const config = { type: "remote" as const, url: trimmed }
    const persisted = await sdk.client.config.update({ config: { mcp: { [pill.id]: config } } })
    if (persisted.error) {
      toast.show({ variant: "error", message: failMessage(persisted.error) })
      return
    }
    const added = await sdk.client.mcp.add({ name: pill.id, config })
    if (added.error) {
      toast.show({ variant: "error", message: failMessage(added.error) })
      return
    }
    await refresh()
    const next = connectPillStatus(sync.data.mcp, pill)
    if (next.name && next.status === "needs_auth") {
      await authorize(next.name)
      return
    }
    toast.show({ variant: "success", message: `Connected ${pill.label}` })
  }

  async function authorize(name: string) {
    toast.show({ variant: "info", message: `Authorize ${name} in your browser` })
    const result = await sdk.client.mcp.auth.authenticate({ name })
    if (result.error) {
      toast.show({ variant: "error", message: failMessage(result.error) })
      return
    }
    await refresh()
  }

  async function open(pill: ConnectPill) {
    await applyConnectorAction(pill, sync.data.mcp, {
      addRemote,
      authorize,
      async toggle(name) {
        await local.mcp.toggle(name)
        await refresh()
      },
      async connect(name) {
        const result = await sdk.client.mcp.connect({ name })
        if (result.error) {
          toast.show({ variant: "error", message: failMessage(result.error) })
          return
        }
        await refresh()
      },
    })
  }

  return { open }
}

function Status(props: { status: ReturnType<typeof connectPillStatus>["status"] }) {
  const { theme } = useTheme()
  if (props.status === "connected") {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>Connected</span>
  }
  if (props.status === "needs_auth") {
    return <span style={{ fg: theme.warning }}>Needs auth</span>
  }
  if (props.status === "failed") {
    return <span style={{ fg: theme.error }}>Failed</span>
  }
  if (props.status === "disabled") {
    return <span style={{ fg: theme.textMuted }}>Off</span>
  }
  return <span style={{ fg: theme.textMuted }}>Not configured</span>
}

export function DialogConnect() {
  const sync = useSync()
  const connector = useConnector()
  const dialog = useDialog()

  const options = createMemo(() =>
    CONNECT_PILLS.map((pill) => {
      const current = connectPillStatus(sync.data.mcp, pill)
      return {
        value: pill.id,
        title: pill.label,
        category: pill.category,
        description: current.name && current.name !== pill.id ? current.name : undefined,
        footer: <Status status={current.status} />,
      }
    }),
  )

  return (
    <DialogSelect
      title="Connect"
      options={options()}
      onSelect={(option) => {
        const pill = CONNECT_PILLS.find((item) => item.id === option.value)
        dialog.clear()
        if (!pill) return
        void connector.open(pill)
      }}
    />
  )
}
