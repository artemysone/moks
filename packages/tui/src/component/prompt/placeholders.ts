const OPEN_REQ = "Open a req with /open-req"

export const DEFAULT_PLACEHOLDERS = {
  normal: ["Score this resume against the req", "Draft outreach for the shortlist", OPEN_REQ],
  shell: ["moks status", "ls candidates", "pwd"],
}

export function placeholdersFor(input: { cards?: number }) {
  if (!input.cards) return [OPEN_REQ]
  return DEFAULT_PLACEHOLDERS.normal
}
