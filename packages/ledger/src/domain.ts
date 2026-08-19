export const APPLICATION_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Screen",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Withdrawn",
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const ACTIVE_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Screen",
  "Interview",
  "Offer",
] as const;

export type ActiveStage = (typeof ACTIVE_STAGES)[number];

export const TERMINAL_STAGES = ["Hired", "Rejected", "Withdrawn"] as const;

export const STAGE_ORDER = [
  "Sourced",
  "Contacted",
  "Replied",
  "Screen",
  "Interview",
  "Offer",
  "Hired",
] as const;

export const JOB_STATUSES = ["open", "closed", "draft"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type AtsId = "mock" | "ashby" | "greenhouse";

export const ENTITY_TYPES = ["job", "candidate", "application"] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const MUTATIONS = [
  "AdvanceStage",
  "Reject",
  "Withdraw",
  "AddNote",
  "AddTag",
  "SendOutreach",
  "ExtendOffer",
] as const;

export type Mutation = (typeof MUTATIONS)[number];

export const EFFECT_CLASSES = ["reversible", "compensable", "irreversible"] as const;

export type EffectClass = (typeof EFFECT_CLASSES)[number];

export const MUTATION_EFFECT_CLASS: Record<Mutation, EffectClass> = {
  AddNote: "reversible",
  AddTag: "reversible",
  AdvanceStage: "compensable",
  Withdraw: "compensable",
  Reject: "irreversible",
  SendOutreach: "irreversible",
  ExtendOffer: "irreversible",
};

export const CHANGESET_STATUSES = ["staged", "approved", "applied", "rejected", "stale"] as const;

export type ChangesetStatus = (typeof CHANGESET_STATUSES)[number];

export const AUTHOR_KINDS = ["human", "agent"] as const;

export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export type Job = {
  id: string;
  remoteId: string;
  title: string;
  team: string;
  location: string;
  status: JobStatus;
};

export type Candidate = {
  id: string;
  remoteId: string;
  name: string;
  email: string;
  headline: string;
};

export type Application = {
  id: string;
  remoteId: string;
  jobId: string;
  candidateId: string;
  stage: ApplicationStage;
};

export type AtsSnapshot = {
  ats: AtsId;
  jobs: Job[];
  candidates: Candidate[];
  applications: Application[];
};

export function isStage(value: string): value is ApplicationStage {
  return (APPLICATION_STAGES as readonly string[]).includes(value);
}

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

export function isMutation(value: string): value is Mutation {
  return (MUTATIONS as readonly string[]).includes(value);
}

export function isEffectClass(value: string): value is EffectClass {
  return (EFFECT_CLASSES as readonly string[]).includes(value);
}

export function isChangesetStatus(value: string): value is ChangesetStatus {
  return (CHANGESET_STATUSES as readonly string[]).includes(value);
}

export function isAuthorKind(value: string): value is AuthorKind {
  return (AUTHOR_KINDS as readonly string[]).includes(value);
}

export function isActiveStage(stage: ApplicationStage): stage is ActiveStage {
  return (ACTIVE_STAGES as readonly string[]).includes(stage);
}

export function nextStage(stage: ApplicationStage): ApplicationStage | null {
  const index = (STAGE_ORDER as readonly string[]).indexOf(stage);
  if (index === -1 || index === STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[index + 1] ?? null;
}

/** Linear advance only. Rejected/Withdrawn are reachable from any active stage via Reject/Withdraw. */
export function isLegalAdvance(from: ApplicationStage, to: ApplicationStage): boolean {
  return nextStage(from) === to;
}

export function canExitToTerminal(from: ApplicationStage): boolean {
  return isActiveStage(from);
}

/** ExtendOffer is only legal from Offer. Interview → Offer is a separate AdvanceStage. */
export function canExtendOffer(from: ApplicationStage): boolean {
  return from === "Offer";
}

export function requiredEffectClass(mutation: Mutation): EffectClass {
  return MUTATION_EFFECT_CLASS[mutation];
}

/** In-memory post-image after a mutation. Notes/tags do not change CAS fields. */
export function nextEntityState(state: unknown, mutation: Mutation, payload: unknown): unknown {
  if (mutation === "AddNote" || mutation === "AddTag" || mutation === "SendOutreach" || mutation === "ExtendOffer") {
    return state;
  }
  if (!state || typeof state !== "object") {
    return state;
  }
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (mutation === "AdvanceStage" && typeof record.to === "string") {
    return { ...state, stage: record.to };
  }
  if (mutation === "Reject") {
    return { ...state, stage: "Rejected" };
  }
  if (mutation === "Withdraw") {
    return { ...state, stage: "Withdrawn" };
  }
  return state;
}
