/** Recruit language on the landing — pile / score / draft / get-ready / send. Not a verb menu. */

export function isSendAsk(text: string) {
  const hint = text.trim()
  if (!hint) return false
  if (/\boutreach[- ]for[- ]real\b/i.test(hint)) return true
  if (/\b(?:actually\s+)?(?:send|mail|email)\b/i.test(hint) && /\b(?:for[- ]real|for real|actually)\b/i.test(hint)) {
    return true
  }
  if (/^(?:please\s+|can you\s+)?(?:\/)?(?:send|mail|email)\b/i.test(hint)) return true
  if (/\bsend\s+(?:this|it|the\s+)?(?:email|outreach|letter|message)\b/i.test(hint)) return true
  return false
}

export function isWriteAsk(text: string) {
  const hint = text.trim()
  if (!hint || isSendAsk(hint)) return false
  if (/^(?:please\s+|can you\s+)?(?:\/)?draft(?:-outreach)?\b/i.test(hint) || /\bdraft-outreach\b/i.test(hint)) return true
  if (/^(?:please\s+|can you\s+)?(?:\/)?score(?:-candidate)?\b/i.test(hint) || /\bscore-candidate\b/i.test(hint)) return true
  return false
}

export function isTakeAsk(text: string) {
  const hint = text.trim()
  if (!hint || isSendAsk(hint) || isWriteAsk(hint)) return false
  if (/(?:hm|hiring[ -]?manager)\s+take\b/i.test(hint)) return true
  if (/^(?:please\s+|can you\s+)?(?:\/)?(?:hm-take|hiring-manager-take)\b/i.test(hint)) return true
  return /^(?:please\s+|can you\s+)?(?:\/)?take\s+(?:on|for)\b/i.test(hint)
}

export function isCompareAsk(text: string) {
  const hint = text.trim()
  if (!hint || isSendAsk(hint) || isWriteAsk(hint) || isTakeAsk(hint)) return false
  if (/^(?:please\s+|can you\s+)?(?:\/)?compare(?:-candidates)?\b/i.test(hint)) return true
  return /\b(?:vs\.?|versus|against)\b/i.test(hint)
}

export function isWorkAsk(text: string) {
  const hint = text.trim()
  if (!hint || isSendAsk(hint) || isWriteAsk(hint) || isTakeAsk(hint) || isCompareAsk(hint)) return false
  if (/\bready for review\b/i.test(hint)) return true
  if (/^(?:please\s+|can you\s+)?(?:get|make|prep(?:are)?|work)\b/i.test(hint)) return true
  return false
}

export function isPileAsk(text: string, files: string[] = []) {
  const hint = text.trim()
  if (isSendAsk(hint) || isWriteAsk(hint) || isWorkAsk(hint) || isTakeAsk(hint) || isCompareAsk(hint)) return false
  if (files.some((item) => item.trim())) return true
  if (/^(?:please\s+|can you\s+)?(?:\/)?add(?:-candidate)?\b/i.test(hint)) return true
  if (/^(?:please\s+|can you\s+)?(?:ingest|drop|here(?:'s| is)?)\b/i.test(hint)) return true
  return looksLikeNameList(hint)
}

function looksLikeNameList(hint: string) {
  if (!hint || /\?/.test(hint)) return false
  if (/\b(who|what|why|how|when|where|using|skill|model)\b/i.test(hint)) return false
  const chunks = hint
    .split(/,|\band\b|\n|;/i)
    .map((chunk) => chunk.replace(/^(?:please\s+|can you\s+)?(?:add|these|those|the|people|candidates|names)\b/i, "").trim())
    .filter(Boolean)
  if (chunks.length < 2) return false
  return chunks.every((token) => /[a-z]{2,}/i.test(token) && token.split(/\s+/).length <= 4)
}

export function isRecruitLanguage(text: string, files: string[] = []) {
  return isSendAsk(text) || isWriteAsk(text) || isWorkAsk(text) || isTakeAsk(text) || isCompareAsk(text) || isPileAsk(text, files)
}

export function recruitLanguageArgs(text: string, files: string[] = []) {
  const args = ["run", "--agent", "recruit"]
  for (const file of files.map((item) => item.trim()).filter(Boolean)) {
    args.push("--file", file)
  }
  args.push("--", text.trim())
  return args
}

export function recruitLanguageToast(input: { ok: boolean; stdout: string; stderr: string }) {
  const text = `${input.stdout}\n${input.stderr}`.trim()
  const line = text.split(/\r?\n/).map((item) => item.replace(/\x1b\[[0-9;]*m/g, "").trim()).find(Boolean) ?? ""
  if (!input.ok) return line || "recruit could not do that"
  return line || "done"
}
