const OPEN_REQ = "Open a req with /open-req"

export const DEFAULT_PLACEHOLDERS = {
  normal: ["add Maya Chen and Kenji Sato", "get Maya ready", "taste with /review"],
  shell: ["ls candidates", "pwd"],
}

export function placeholdersFor(input: { cards?: number; focused?: string | null; next?: string }) {
  if (input.focused) return [input.next || `continue ${input.focused}`]
  if (!input.cards) return [OPEN_REQ, "add Maya Chen and Kenji Sato"]
  return DEFAULT_PLACEHOLDERS.normal
}
