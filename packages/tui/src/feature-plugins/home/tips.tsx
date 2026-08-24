import type { TuiPlugin, TuiPluginApi } from "@moks/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import path from "path"
import { createMemo, createResource, Show } from "solid-js"
import { ConnectPills } from "./connect-pills-view"
import { Tips } from "./tips-view"
import { useTuiPaths } from "../../context/runtime"
import { useBindings } from "../../keymap"

const id = "internal:home-tips"

function View(props: {
  api: TuiPluginApi
  hidden: boolean
  show: boolean
  connected: boolean
  company?: boolean
  sessionNext?: string
}) {
  useBindings(() => ({
    commands: [
      {
        name: "tips.toggle",
        title: props.hidden ? "Show tips" : "Hide tips",
        category: "System",
        namespace: "palette",
        run() {
          props.api.kv.set("tips_hidden", !props.api.kv.get("tips_hidden", false))
          props.api.ui.dialog.clear()
        },
      },
    ],
    bindings: props.api.tuiConfig.keybinds.get("tips.toggle"),
  }))

  return (
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1} gap={1}>
      <ConnectPills api={props.api} />
      <Show when={props.show}>
        <Tips api={props.api} connected={props.connected} company={props.company} sessionNext={props.sessionNext} />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const paths = useTuiPaths()
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const first = createMemo(() => api.state.session.count() === 0)
        const connected = createMemo(() => api.state.provider.length > 0)
        const [company] = createResource(async () => {
          const directory = api.state.path.directory || paths.cwd
          return Bun.file(path.join(directory, "HIRING.md")).exists()
        })
        const [session] = createResource(async () => {
          const directory = api.state.path.directory || paths.cwd
          const raw = await Bun.file(path.join(directory, ".moks", "session.json"))
            .text()
            .catch(() => "")
          if (!raw.trim()) return
          try {
            const parsed = JSON.parse(raw) as { focused?: string | null; next?: string }
            if (!parsed.focused || !parsed.next) return
            return parsed
          } catch {
            return
          }
        })
        const show = createMemo(() => {
          if (company() === false) return true
          if (session()?.next) return true
          return (!first() || !connected()) && !hidden()
        })
        return <View api={api} hidden={hidden()} show={show()} connected={connected()} company={company()} sessionNext={session()?.next} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
