import { createMemo, For } from "solid-js"
import { useTheme } from "../../context/theme"

type TipPart = { text: string; highlight: boolean }

export const INIT_TIP = "Run {highlight}/init{/highlight} to create your company directory"
export const CONNECT_TIP =
  "Run {highlight}/connect{/highlight} to add your ATS (Ashby, Greenhouse...), Sourcing Agent (Juicebox, Metaview...), Email & Calendar (Outlook, Gmail...)"
export const READY_TIP = "How can Moks help today? Try {highlight}Review my pipeline{/highlight}"

export function landingTip(input: { company?: boolean; connectors?: boolean }) {
  if (input.company !== true) return INIT_TIP
  if (input.connectors !== true) return CONNECT_TIP
  return READY_TIP
}

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips(props: { company?: boolean; connectors?: boolean }) {
  const theme = useTheme().theme
  const tip = createMemo(() => landingTip({ company: props.company, connectors: props.connectors }), INIT_TIP)
  const parts = createMemo(() => parse(tip()), parse(INIT_TIP))

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1} wrapMode="word">
        <For each={parts()}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}
