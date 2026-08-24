import type { TuiPluginApi } from "@moks/plugin/tui"
import { For } from "solid-js"
import { CONNECT_PILLS, CONNECT_PILLS_COMMAND } from "./connect-pills"

export function ConnectPills(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const open = () => props.api.keymap.dispatchCommand(CONNECT_PILLS_COMMAND)

  return (
    <box flexDirection="row" gap={1} flexShrink={0} paddingBottom={1}>
      <For each={[...CONNECT_PILLS]}>
        {(name) => (
          <box
            backgroundColor={theme().backgroundElement}
            paddingLeft={1}
            paddingRight={1}
            onMouseUp={open}
          >
            <text fg={theme().textMuted}>{name}</text>
          </box>
        )}
      </For>
    </box>
  )
}
