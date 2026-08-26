import type { TuiPlugin } from "@moks/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { PacketView } from "./packet-view"

const id = "internal:sidebar-packet"

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content() {
        return <PacketView api={api} />
      },
      home_bottom() {
        return (
          <box width="100%" maxWidth={75} paddingBottom={1} flexShrink={1}>
            <PacketView api={api} />
          </box>
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
