import { createHash } from "crypto"
import path from "path"
import type { Card } from "./candidate-card"
const COMPANY_FILE = "COMPANY.md"
const HIRING_FILE = "HIRING.md"

export const COMPANY_HASH_KEY = "company_hash"
export const HIRING_HASH_KEY = "hiring_hash"

export function hashText(text: string) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex")
}

export function fingerprintsOf(companyMd: string, hiringMd: string) {
  return {
    [COMPANY_HASH_KEY]: hashText(companyMd),
    [HIRING_HASH_KEY]: hashText(hiringMd),
  }
}

export function scoreIsStale(card: Card, current: { company_hash: string; hiring_hash: string }) {
  if (card.score === undefined && !/^# Score\b/m.test(card.body)) return false
  return card.extra[COMPANY_HASH_KEY] !== current.company_hash || card.extra[HIRING_HASH_KEY] !== current.hiring_hash
}

export async function fingerprintsAt(root: string, packet?: string) {
  const companyMd = await Bun.file(path.join(root, COMPANY_FILE))
    .text()
    .catch(() => "")
  const hiringMd = packet
    ? await Bun.file(path.join(packet, HIRING_FILE))
        .text()
        .catch(() => "")
    : await Bun.file(path.join(root, HIRING_FILE))
        .text()
        .catch(() => "")
  return fingerprintsOf(companyMd, hiringMd)
}

export * as Constitutions from "./constitutions"
