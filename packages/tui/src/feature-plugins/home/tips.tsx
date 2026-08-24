import type { TuiPlugin, TuiPluginApi } from "@moks/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import path from "path"
import { createMemo, createResource, Show } from "solid-js"
import { Tips } from "./tips-view"
import { useTuiPaths } from "../../context/runtime"
import { useBindings } from "../../keymap"
import { hasCatalogConnector } from "./connect-pills"

const id = "internal:home-tips"

function View(props: {
  api: TuiPluginApi
  hidden: boolean
  show: boolean
  company?: boolean
  connectors?: boolean
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
      <Show when={props.show}>
        <Tips company={props.company} connectors={props.connectors} />
      </Show>
    </box>
  )
}

async function hasCompany(directory: string) {
  if (await Bun.file(path.join(directory, "COMPANY.md")).exists()) return true
  return Bun.file(path.join(directory, "HIRING.md")).exists()
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const paths = useTuiPaths()
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const [company] = createResource(async () => {
          const directory = api.state.path.directory || paths.cwd
          return hasCompany(directory)
        })
        const connectors = createMemo(() => {
          const mcp = Object.fromEntries(api.state.mcp().map((item) => [item.name, item]))
          return hasCatalogConnector(mcp)
        })
        const show = createMemo(() => {
          if (company() === false) return true
          if (!connectors()) return true
          return !hidden()
        })
        return (
          <View
            api={api}
            hidden={hidden()}
            show={show()}
            company={company()}
            connectors={connectors()}
          />
        )
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
