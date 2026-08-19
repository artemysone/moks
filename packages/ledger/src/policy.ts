import { isMutation, requiredEffectClass, type Mutation } from "./domain.ts";

export type Gate = "auto" | "batch" | "always";

export const AGENT_TOOL_NAMES = [
  "workspace_read",
  "list_applications",
  "ledger_status",
  "ledger_list",
  "ledger_diff",
  "ledger_commit",
  "sync_pull",
  "source_search",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const PERMISSION_DECISIONS = ["allow", "ask", "deny"] as const;

export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

/**
 * One entry from the `permissions:` block. `mutation` is null for a bare tool key
 * (the wildcard fallback) and set for a `ledger_commit(Mutation)` pattern.
 */
export type PermissionRule = {
  tool: AgentToolName;
  mutation: Mutation | null;
  decision: PermissionDecision;
};

export type Policy = {
  autoApprove: Mutation[];
  batchReview: Mutation[];
  alwaysGate: Mutation[];
  rejectSampling: number;
  permissions: PermissionRule[];
};

export type HiringDoc = {
  role: string;
  bar: string;
  comp: string;
  tone: string;
  policy: Policy;
  warnings: string[];
};

const emptyPolicy = (): Policy => ({
  autoApprove: [],
  batchReview: [],
  alwaysGate: [],
  rejectSampling: 0,
  permissions: [],
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

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}

export function isPermissionDecision(value: string): value is PermissionDecision {
  return (PERMISSION_DECISIONS as readonly string[]).includes(value);
}

/** Bare-key rule for a tool (`ledger_commit: ask`). Later duplicates override earlier ones. */
export function permissionFor(tool: string, policy: Policy): PermissionDecision | null {
  let found: PermissionDecision | null = null;
  for (const rule of policy.permissions) {
    if (rule.tool === tool && rule.mutation === null) {
      found = rule.decision;
    }
  }
  return found;
}

/** Most specific wins: `ledger_commit(Mutation)` beats the bare `ledger_commit` fallback. */
export function commitPermissionFor(mutation: Mutation, policy: Policy): PermissionDecision | null {
  let specific: PermissionDecision | null = null;
  for (const rule of policy.permissions) {
    if (rule.tool === "ledger_commit" && rule.mutation === mutation) {
      specific = rule.decision;
    }
  }
  return specific ?? permissionFor("ledger_commit", policy);
}

/**
 * Effect classes are the floor: `allow` only takes effect for reversible mutations
 * (the same hard gate as `auto_approve`); on compensable/irreversible mutations it
 * degrades to `ask`. `deny` and `ask` pass through untouched.
 */
export function effectiveCommitPermission(mutation: Mutation, policy: Policy): PermissionDecision | null {
  const decision = commitPermissionFor(mutation, policy);
  if (decision === "allow" && !isReversibleAutoApprove(mutation)) {
    return "ask";
  }
  return decision;
}

export type ToolPermission =
  | { action: "proceed" }
  | { action: "allow" }
  | { action: "ask" }
  | { action: "deny"; denied: string[] };

/**
 * Combined decision for one agent tool call. `mutations` is only meaningful for
 * `ledger_commit` (the mutation names of the staged changes).
 *
 * - `deny` on any matched key wins outright.
 * - `proceed` (no rule matched, or a commit with an unmatched mutation) keeps the
 *   existing effect-class + policy-list behavior untouched.
 * - `allow` is only returned for commits when every mutation resolves to an
 *   effective `allow` (i.e. all reversible); otherwise the call must `ask`.
 * - Mutation names that are not valid mutations fall back to the bare
 *   `ledger_commit` rule, with `allow` degraded to `ask` since reversibility
 *   cannot be verified.
 */
export function toolPermission(toolName: string, mutations: string[], policy: Policy): ToolPermission {
  if (toolName !== "ledger_commit") {
    const decision = permissionFor(toolName, policy);
    if (decision === null) return { action: "proceed" };
    if (decision === "deny") return { action: "deny", denied: [toolName] };
    return { action: decision };
  }
  const names = mutations.length > 0 ? mutations : [""];
  const decisions = names.map((name) => commitDecisionForName(name, policy));
  const denied = names.filter((_, index) => decisions[index] === "deny");
  if (denied.length > 0) {
    return { action: "deny", denied };
  }
  if (decisions.some((decision) => decision === null)) {
    return { action: "proceed" };
  }
  if (decisions.every((decision) => decision === "allow")) {
    return { action: "allow" };
  }
  return { action: "ask" };
}

function commitDecisionForName(name: string, policy: Policy): PermissionDecision | null {
  if (isMutation(name)) {
    return effectiveCommitPermission(name, policy);
  }
  const bare = permissionFor("ledger_commit", policy);
  return bare === "allow" ? "ask" : bare;
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

function parsePolicy(body: string, warnings: string[]): Policy {
  const policy = emptyPolicy();
  let inPermissions = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const stripped = stripComment(rawLine);
    const line = stripped.trim();
    if (!line) continue;
    // Indented lines under `permissions:` are block entries; the first
    // non-indented line closes the block.
    if (inPermissions && /^[ \t]/.test(stripped)) {
      parsePermissionEntry(line, policy.permissions, warnings);
      continue;
    }
    inPermissions = false;
    const match = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "permissions") {
      if (value) {
        warnings.push(`permissions must be an indented block, ignored inline value: ${value}`);
      }
      inPermissions = true;
      continue;
    }
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

/** `tool: decision` or `ledger_commit(Mutation): decision`. Invalid entries warn and drop. */
function parsePermissionEntry(line: string, rules: PermissionRule[], warnings: string[]): void {
  const match = line.match(/^([a-z_]+)\s*(?:\(\s*([^)]*?)\s*\))?\s*:\s*(.+)$/i);
  if (!match) {
    warnings.push(`invalid permissions entry: ${line}`);
    return;
  }
  const tool = match[1]!.toLowerCase();
  const arg = match[2]?.trim() ?? null;
  const value = match[3]!.trim().toLowerCase();
  if (!isAgentToolName(tool)) {
    warnings.push(`unknown tool in permissions: ${tool}`);
    return;
  }
  if (!isPermissionDecision(value)) {
    warnings.push(`invalid decision in permissions: ${tool}: ${value}`);
    return;
  }
  let mutation: Mutation | null = null;
  if (arg !== null && arg !== "" && arg !== "*") {
    if (tool !== "ledger_commit") {
      warnings.push(`argument pattern only supported on ledger_commit in permissions: ${line}`);
      return;
    }
    if (!isMutation(arg)) {
      warnings.push(`unknown mutation in permissions: ${arg}`);
      return;
    }
    mutation = arg;
  }
  rules.push({ tool, mutation, decision: value });
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
