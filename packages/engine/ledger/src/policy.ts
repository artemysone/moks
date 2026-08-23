import { isMutation, requiredEffectClass, type ApplicationStage, type Mutation } from "./domain.ts";
import { isStage } from "./domain.ts";

export type Gate = "auto" | "batch" | "always";

export type Policy = {
  autoApprove: Mutation[];
  batchReview: Mutation[];
  alwaysGate: Mutation[];
  rejectSampling: number;
};

export type HiringDoc = {
  role: string;
  bar: string;
  comp: string;
  tone: string;
  policy: Policy;
  /** Recognized ledger stages from ## Process, in order. Empty = use the default machine. */
  stages: ApplicationStage[];
  warnings: string[];
};

const emptyPolicy = (): Policy => ({
  autoApprove: [],
  batchReview: [],
  alwaysGate: [],
  rejectSampling: 0,
});

/** Missing hiring.md fails closed: every mutation is `always`, sampling is off. */
export function failClosedPolicy(): Policy {
  return emptyPolicy();
}

/** Unknown names in policy lists are dropped and recorded on `warnings`. */
export function parseHiringMarkdown(text: string): HiringDoc {
  const sections = parseSections(text);
  const warnings: string[] = [];
  return {
    role: sections.get("role") ?? "",
    bar: sections.get("bar") ?? "",
    comp: sections.get("comp") ?? "",
    tone: findTone(sections),
    policy: parsePolicy(sections.get("policy") ?? "", warnings),
    stages: parseProcessStages(sections.get("process") ?? ""),
    warnings,
  };
}

/** `auto_approve` is reversible-only. Compensable / irreversible never policy-approve. */
function isReversibleAutoApprove(mutation: Mutation): boolean {
  return mutation === "AddNote" || mutation === "AddTag" || requiredEffectClass(mutation) === "reversible";
}

/**
 * Most restrictive listed gate wins. Mutations absent from every list fail closed
 * to `always` so unlisted writes still require a human. `auto_approve` is ignored
 * for non-reversible mutations even if hiring.md lists them.
 */
export function gateFor(mutation: Mutation, policy: Policy): Gate {
  if (policy.alwaysGate.includes(mutation)) return "always";
  if (policy.batchReview.includes(mutation)) return "batch";
  if (policy.autoApprove.includes(mutation) && isReversibleAutoApprove(mutation)) return "auto";
  return "always";
}

/** `true` means flag this reject for human audit. `rng` must return a value in [0, 1). */
export function sampleReject(policy: Policy, rng: () => number): boolean {
  return rng() < policy.rejectSampling;
}

function parseSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  const buf: string[] = [];

  const flush = () => {
    if (current === null) return;
    sections.set(current, buf.join("\n").trim());
  };

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1]!.trim().toLowerCase();
      buf.length = 0;
      continue;
    }
    if (current !== null) buf.push(line);
  }
  flush();
  return sections;
}

function findTone(sections: Map<string, string>): string {
  for (const [name, body] of sections) {
    if (name === "tone" || name.startsWith("tone")) return body;
  }
  return "";
}

const STAGE_ALIAS: Record<string, ApplicationStage> = {
  sourced: "Sourced",
  contacted: "Contacted",
  replied: "Replied",
  screen: "Screen",
  phone: "Phone",
  onsite: "Onsite",
  "on-site": "Onsite",
  interview: "Interview",
  offer: "Offer",
  hire: "Hired",
  hired: "Hired",
};

/** Stages named by the req. HIRING hops (phone, onsite, on-site) map to Phone/Onsite; other unknown tokens are dropped. */
export function parseProcessStages(body: string): ApplicationStage[] {
  const stages: ApplicationStage[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim().replace(/^[-*]\s*/, "");
    const match = line.match(/^stages\s*:\s*(.+)$/i);
    if (!match) continue;
    for (const token of match[1]!.split(/\s*(?:\u2192|->|\|)\s*/)) {
      const key = token.trim().toLowerCase();
      if (!key) continue;
      const mapped = STAGE_ALIAS[key] ?? (isStage(token.trim()) ? token.trim() : undefined);
      if (mapped && !stages.includes(mapped)) stages.push(mapped);
    }
  }
  return stages;
}

function parsePolicy(body: string, warnings: string[]): Policy {
  const policy = emptyPolicy();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const match = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "reject_sampling") {
      policy.rejectSampling = parseRejectSampling(value);
      continue;
    }
    if (key === "auto_approve") {
      policy.autoApprove = parseMutationList(value, "auto_approve", warnings);
      continue;
    }
    if (key === "batch_review") {
      policy.batchReview = parseMutationList(value, "batch_review", warnings);
      continue;
    }
    if (key === "always_gate") {
      policy.alwaysGate = parseMutationList(value, "always_gate", warnings);
    }
  }
  return policy;
}

function parseMutationList(raw: string, field: string, warnings: string[]): Mutation[] {
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const mutations: Mutation[] = [];
  for (const part of inner.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (isMutation(name)) {
      mutations.push(name);
    } else {
      warnings.push(`unknown mutation in ${field}: ${name}`);
    }
  }
  return mutations;
}

function parseRejectSampling(raw: string): number {
  if (raw.endsWith("%")) {
    return clampUnit(Number(raw.slice(0, -1).trim()) / 100);
  }
  return clampUnit(Number(raw));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}
