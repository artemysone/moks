/** Landing connect pills. They power the day. None is required to start. */
export const CONNECT_PILLS = ["Ashby", "Greenhouse", "Juicebox", "Metaview", "Google", "Outlook"] as const

export const CONNECT_PILLS_REQUIRED = false

export const CONNECT_PILLS_COMMAND = "provider.connect"

export function connectPillsRequiredToStart() {
  return CONNECT_PILLS_REQUIRED
}
