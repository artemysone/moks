import type { TuiPluginApi } from "@moks/plugin/tui"
import path from "node:path"
import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { usePromptRef } from "../../context/prompt"
import { useBindings } from "../../keymap"
import {
  candidateLabel,
  loadPacket,
  movePacketIndex,
  packetRows,
  scorePrompt,
  type PacketData,
  type PacketRow,
} from "./packet-data"

export function PacketView(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const directory = props.api.state.path.directory
  const promptRef = usePromptRef()
  const [data, { refetch }] = createResource(() => directory, (dir) => (dir ? loadPacket(dir) : undefined))
  const [cursor, setCursor] = createSignal(0)
  const rows = createMemo(() => {
    const packet = data()
    if (!packet) return []
    return packetRows(packet)
  })
  const selected = createMemo(() => movePacketIndex(cursor(), 0, rows().length))

  onMount(() => {
    const timer = setInterval(() => void refetch(), 750)
    onCleanup(() => clearInterval(timer))
  })

  const activate = (row: PacketRow | undefined) => {
    const packet = data()
    if (!packet || !row) return
    if (row.kind === "req") {
      void focusReq(packet, row.slug).then(() => refetch())
      return
    }
    promptRef.current?.set({ input: scorePrompt(row.id), parts: [] })
  }

  // Empty composer: up/down/enter pick the slate. Typing disables this so Enter submits.
  useBindings(() => ({
    enabled: () => {
      if (rows().length === 0) return false
      const prompt = promptRef.current
      if (!prompt?.focused) return true
      return prompt.current.input === ""
    },
    bindings: [
      {
        key: "up",
        desc: "Previous req or person",
        group: "Packet",
        cmd: () => setCursor(movePacketIndex(selected(), -1, rows().length)),
      },
      {
        key: "down",
        desc: "Next req or person",
        group: "Packet",
        cmd: () => setCursor(movePacketIndex(selected(), 1, rows().length)),
      },
      {
        key: "return",
        desc: "Focus req or score person",
        group: "Packet",
        cmd: () => activate(rows()[selected()]),
      },
    ],
  }))

  return (
    <Show when={data()}>
      {(packet) => (
        <box gap={1}>
          <box>
            <text fg={theme().text}>
              <b>{packet().companyTitle}</b>
            </text>
            <For each={packet().reqs}>
              {(req, index) => (
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => {
                    setCursor(index())
                    activate({ kind: "req", ...req })
                  }}
                >
                  <text
                    fg={selected() === index() ? theme().primary : req.focused ? theme().text : theme().textMuted}
                    wrapMode="none"
                  >
                    {selected() === index() ? "▸" : " "} {req.focused ? "●" : " "} {req.slug}
                  </text>
                </box>
              )}
            </For>
          </box>
          <Show when={packet().packet}>
            {(focused) => (
              <box>
                <text fg={theme().text}>
                  <b>{focused().title || "People"}</b>
                </text>
                <Show when={focused().candidates.length === 0}>
                  <text fg={theme().textMuted}>  (empty)</text>
                </Show>
                <For each={focused().candidates}>
                  {(card, index) => {
                    const at = () => packet().reqs.length + index()
                    return (
                      <box
                        flexDirection="row"
                        onMouseDown={() => {
                          setCursor(at())
                          activate({ kind: "candidate", ...card })
                        }}
                      >
                        <text fg={selected() === at() ? theme().primary : theme().textMuted} wrapMode="none">
                          {selected() === at() ? "▸" : " "} {candidateLabel(card)}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </Show>
        </box>
      )}
    </Show>
  )
}

async function focusReq(packet: PacketData, slug: string) {
  const safe = path.basename(slug.trim())
  if (!safe || safe === "." || safe === "..") return
  await Bun.write(path.join(packet.company, ".moks", "focus"), safe)
}
