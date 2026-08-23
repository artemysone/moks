import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
  auto?: boolean
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args & { value?: Args }) => {
    const value = props.value
    if (value) return value
    return {
      model: props.model,
      agent: props.agent,
      prompt: props.prompt,
      continue: props.continue,
      sessionID: props.sessionID,
      fork: props.fork,
      auto: props.auto,
    }
  },
})
