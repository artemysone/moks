import { For } from "solid-js"
import { CONNECT_PILLS } from "./connect-pills"

export function ConnectPills(props: {
  theme: { backgroundElement: unknown; text: unknown }
  onOpen: () => void
}) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <For each={[...CONNECT_PILLS]}>
        {(name) => (
          <box
            backgroundColor={props.theme.backgroundElement}
            paddingLeft={1}
            paddingRight={1}
            onMouseUp={props.onOpen}
          >
            <text fg={props.theme.text}>{name}</text>
          </box>
        )}
      </For>
    </box>
  )
}
