export const TTY_REQUIRED_MESSAGE =
  "moks TUI needs a TTY on stdout. Run `moks` in a real terminal (not a pipe or non-interactive capture)."

export function requireInteractiveTty(stdout: { isTTY?: boolean } = process.stdout) {
  if (stdout.isTTY) return
  throw new Error(TTY_REQUIRED_MESSAGE)
}
