const OPEN_REQ = "open a req"

export const DEFAULT_PLACEHOLDERS = {
  normal: ["add names or files", "get this candidate ready", "taste what's staged"],
  shell: ["ls candidates", "pwd"],
}

export function placeholdersFor(input: { cards?: number; focused?: string | null; next?: string }) {
  if (input.focused) return [input.next || `continue ${input.focused}`]
  if (!input.cards) return [OPEN_REQ, "add names or files"]
  return DEFAULT_PLACEHOLDERS.normal
}
