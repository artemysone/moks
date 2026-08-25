import { LedgerError } from "./errors.ts";
import { isJsonObject, jsonString, type Json } from "./json.ts";

export const APPLICATION_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Screen",
  "Phone",
  "Onsite",
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
  "Phone",
  "Onsite",
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

export const MUTATION_EFFECT_CLASS = {
  AddNote: "reversible",
  AddTag: "reversible",
  AdvanceStage: "compensable",
  Withdraw: "compensable",
  Reject: "irreversible",
  SendOutreach: "irreversible",
  ExtendOffer: "irreversible",
} satisfies { [K in Mutation]: EffectClass };

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

export type EntityState = Application | Candidate | Job;

export type AtsSnapshot = {
  ats: AtsId;
  jobs: Job[];
  candidates: Candidate[];
  applications: Application[];
};

export type EmptyPayload = Record<never, never>;

export type AdvanceStagePayload = { to: ApplicationStage };
export type AddNotePayload = { body: string };
export type AddTagPayload = { tag: string };
export type SendOutreachPayload = { body: string; channel?: string };
export type ExtendOfferPayload = { terms: string };

export type MutationPayload =
  | AdvanceStagePayload
  | AddNotePayload
  | AddTagPayload
  | SendOutreachPayload
  | ExtendOfferPayload
  | EmptyPayload;

export type ApplicationCas = {
  id: string;
  remoteId: string;
  stage: ApplicationStage;
};

export type JobCas = {
  id: string;
  remoteId: string;
  status: JobStatus;
};

export type CandidateCas = {
  id: string;
  remoteId: string;
};

export type CasProjection = ApplicationCas | JobCas | CandidateCas;

export type CasField = {
  id?: string;
  remoteId?: string;
  stage?: ApplicationStage;
  status?: JobStatus;
};

export type AgentMeta = {
  model?: string;
  sessionId?: string;
  promptRef?: string;
  review_reason?: string;
  source?: string;
  req?: string;
  action?: string;
  local_card?: boolean;
};

export type NoteApplied = { noteId: string };
export type TagApplied = { tag: string };
export type OutreachApplied = { outreachId: string; channel: string };
export type OfferApplied = { offerId: string };
export type RemoteResult = Application | NoteApplied | TagApplied | OutreachApplied | OfferApplied;

function includesLiteral<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value);
}

export function isStage(value: string): value is ApplicationStage {
  return includesLiteral(APPLICATION_STAGES, value);
}

export function isJobStatus(value: string): value is JobStatus {
  return includesLiteral(JOB_STATUSES, value);
}

export function isEntityType(value: string): value is EntityType {
  return includesLiteral(ENTITY_TYPES, value);
}

export function isMutation(value: string): value is Mutation {
  return includesLiteral(MUTATIONS, value);
}

export function isEffectClass(value: string): value is EffectClass {
  return includesLiteral(EFFECT_CLASSES, value);
}

export function isChangesetStatus(value: string): value is ChangesetStatus {
  return includesLiteral(CHANGESET_STATUSES, value);
}

export function isAuthorKind(value: string): value is AuthorKind {
  return includesLiteral(AUTHOR_KINDS, value);
}

export function isActiveStage(stage: ApplicationStage): stage is ActiveStage {
  return includesLiteral(ACTIVE_STAGES, stage);
}

export function isApplication(state: EntityState): state is Application {
  return "jobId" in state && "stage" in state;
}

export function isCandidate(state: EntityState): state is Candidate {
  return "name" in state && "email" in state;
}

export function isJob(state: EntityState): state is Job {
  return "status" in state && "title" in state;
}

export function isAdvanceStagePayload(payload: MutationPayload): payload is AdvanceStagePayload {
  return "to" in payload;
}

export function isAddNotePayload(payload: MutationPayload): payload is AddNotePayload {
  return "body" in payload && !("terms" in payload) && !("channel" in payload);
}

export function isAddTagPayload(payload: MutationPayload): payload is AddTagPayload {
  return "tag" in payload;
}

export function isSendOutreachPayload(payload: MutationPayload): payload is SendOutreachPayload {
  return "body" in payload && !("terms" in payload);
}

export function isExtendOfferPayload(payload: MutationPayload): payload is ExtendOfferPayload {
  return "terms" in payload;
}

export function nextStage(stage: ApplicationStage): ApplicationStage | null {
  const path: readonly ApplicationStage[] = STAGE_ORDER;
  const index = path.indexOf(stage);
  if (index === -1 || index === path.length - 1) {
    return null;
  }
  return path[index + 1] ?? null;
}

/** Linear advance only. Rejected/Withdrawn are reachable from any active stage via Reject/Withdraw. */
export function isLegalAdvance(from: ApplicationStage, to: ApplicationStage): boolean {
  return nextStage(from) === to;
}

export function nextStageOnPath(
  stage: ApplicationStage,
  path: readonly ApplicationStage[],
): ApplicationStage | null {
  const index = path.indexOf(stage);
  if (index === -1 || index >= path.length - 1) return null;
  return path[index + 1] ?? null;
}

export function isLegalAdvanceOnPath(
  from: ApplicationStage,
  to: ApplicationStage,
  path?: readonly ApplicationStage[],
): boolean {
  if (path && path.length >= 2) return nextStageOnPath(from, path) === to;
  return isLegalAdvance(from, to);
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

export function parseApplication(input: Json): Application | undefined {
  if (!isJsonObject(input)) return undefined;
  const id = jsonString(input.id);
  const remoteId = jsonString(input.remoteId);
  const jobId = jsonString(input.jobId);
  const candidateId = jsonString(input.candidateId);
  const stage = jsonString(input.stage);
  if (id === undefined || remoteId === undefined || jobId === undefined || candidateId === undefined || stage === undefined || !isStage(stage)) {
    return undefined;
  }
  return { id, remoteId, jobId, candidateId, stage };
}

export function parseCandidate(input: Json): Candidate | undefined {
  if (!isJsonObject(input)) return undefined;
  const id = jsonString(input.id);
  const remoteId = jsonString(input.remoteId);
  const name = jsonString(input.name);
  const email = jsonString(input.email);
  const headline = jsonString(input.headline);
  if (id === undefined || remoteId === undefined || name === undefined || email === undefined || headline === undefined) {
    return undefined;
  }
  return { id, remoteId, name, email, headline };
}

export function parseJob(input: Json): Job | undefined {
  if (!isJsonObject(input)) return undefined;
  const id = jsonString(input.id);
  if (id === undefined) return undefined;
  const remoteId = jsonString(input.remoteId) ?? id;
  const title = jsonString(input.title) ?? "";
  const team = jsonString(input.team) ?? "";
  const location = jsonString(input.location) ?? "";
  const status = jsonString(input.status);
  if (status !== undefined && !isJobStatus(status)) return undefined;
  return { id, remoteId, title, team, location, status: status ?? "open" };
}

export function parseEntityState(entityType: EntityType, input: Json): EntityState | undefined {
  if (entityType === "application") return parseApplication(input);
  if (entityType === "candidate") return parseCandidate(input);
  return parseJob(input);
}

export function parseMutationPayload(mutation: Mutation, input: Json): MutationPayload {
  if (!isJsonObject(input)) {
    throw new LedgerError("invalid_payload");
  }
  switch (mutation) {
    case "AdvanceStage": {
      const to = jsonString(input.to);
      if (to === undefined || !isStage(to)) {
        throw new LedgerError("invalid_payload: AdvanceStage requires to");
      }
      return { to };
    }
    case "AddNote": {
      const body = jsonString(input.body);
      if (body === undefined || body.length === 0) {
        throw new LedgerError("invalid_payload: AddNote requires body");
      }
      return { body };
    }
    case "AddTag": {
      const tag = jsonString(input.tag);
      if (tag === undefined || tag.length === 0) {
        throw new LedgerError("invalid_payload: AddTag requires tag");
      }
      return { tag };
    }
    case "SendOutreach": {
      const body = jsonString(input.body);
      if (body === undefined || body.length === 0) {
        throw new LedgerError("invalid_payload: SendOutreach requires body");
      }
      const channel = jsonString(input.channel);
      if (channel === undefined || channel.length === 0) {
        return { body };
      }
      return { body, channel };
    }
    case "ExtendOffer": {
      const terms = jsonString(input.terms);
      if (terms === undefined || terms.length === 0) {
        throw new LedgerError("invalid_payload: ExtendOffer requires terms");
      }
      return { terms };
    }
    case "Reject":
    case "Withdraw":
      return {};
  }
  return {};
}

export function parseCasField(input: Json): CasField {
  if (!isJsonObject(input)) {
    throw new LedgerError("invalid_precondition");
  }
  const field: CasField = {};
  const id = jsonString(input.id);
  if (id !== undefined) field.id = id;
  const remoteId = jsonString(input.remoteId);
  if (remoteId !== undefined) field.remoteId = remoteId;
  const stage = jsonString(input.stage);
  if (stage !== undefined) {
    if (!isStage(stage)) throw new LedgerError("invalid_precondition");
    field.stage = stage;
  }
  const status = jsonString(input.status);
  if (status !== undefined) {
    if (!isJobStatus(status)) throw new LedgerError("invalid_precondition");
    field.status = status;
  }
  return field;
}

export function parseAgentMeta(input: Json | null): AgentMeta | null {
  if (input === null) return null;
  if (!isJsonObject(input)) {
    throw new LedgerError("invalid_agent_meta");
  }
  const meta: AgentMeta = {};
  const model = jsonString(input.model);
  if (model !== undefined) meta.model = model;
  const sessionId = jsonString(input.sessionId);
  if (sessionId !== undefined) meta.sessionId = sessionId;
  const promptRef = jsonString(input.promptRef);
  if (promptRef !== undefined) meta.promptRef = promptRef;
  const reviewReason = jsonString(input.review_reason);
  if (reviewReason !== undefined) meta.review_reason = reviewReason;
  const source = jsonString(input.source);
  if (source !== undefined) meta.source = source;
  const req = jsonString(input.req);
  if (req !== undefined) meta.req = req;
  const action = jsonString(input.action);
  if (action !== undefined) meta.action = action;
  if (input.local_card === true) meta.local_card = true;
  return meta;
}

export function parseRemoteResult(input: Json | undefined): RemoteResult | undefined {
  if (input === undefined || input === null) return undefined;
  const application = parseApplication(input);
  if (application) return application;
  if (!isJsonObject(input)) return undefined;
  const noteId = jsonString(input.noteId);
  if (noteId !== undefined) return { noteId };
  const tag = jsonString(input.tag);
  if (tag !== undefined) return { tag };
  const outreachId = jsonString(input.outreachId);
  const channel = jsonString(input.channel);
  if (outreachId !== undefined && channel !== undefined) return { outreachId, channel };
  const offerId = jsonString(input.offerId);
  if (offerId !== undefined) return { offerId };
  return undefined;
}

export function parseAtsId(value: string): AtsId | undefined {
  if (value === "mock" || value === "ashby" || value === "greenhouse") return value;
  return undefined;
}

export type AtsFixtureFile = {
  jobs: Job[];
  candidates: Candidate[];
  applications: Application[];
};

export function parseAtsFixture(input: Json): AtsFixtureFile {
  if (!isJsonObject(input) || !Array.isArray(input.jobs) || !Array.isArray(input.candidates) || !Array.isArray(input.applications)) {
    throw new Error("Invalid fixture: expected jobs, candidates, applications");
  }
  const jobs: Job[] = [];
  for (const item of input.jobs) {
    const job = parseJob(item);
    if (!job) {
      const status = isJsonObject(item) ? jsonString(item.status) : undefined;
      if (status !== undefined && !isJobStatus(status)) {
        throw new Error(`Invalid fixture job status: ${status}`);
      }
      throw new Error("Invalid fixture job");
    }
    jobs.push(job);
  }
  const candidates: Candidate[] = [];
  for (const item of input.candidates) {
    const candidate = parseCandidate(item);
    if (!candidate) throw new Error("Invalid fixture candidate");
    candidates.push(candidate);
  }
  const applications: Application[] = [];
  for (const item of input.applications) {
    const application = parseApplication(item);
    if (!application) {
      const stage = isJsonObject(item) ? jsonString(item.stage) : undefined;
      if (stage !== undefined && !isStage(stage)) {
        throw new Error(`Invalid fixture stage: ${stage}`);
      }
      throw new Error("Invalid fixture application");
    }
    applications.push(application);
  }
  return { jobs, candidates, applications };
}

/** In-memory post-image after a mutation. Notes/tags do not change CAS fields. */
export function nextEntityState(state: EntityState, mutation: Mutation, payload: MutationPayload): EntityState {
  if (mutation === "AddNote" || mutation === "AddTag" || mutation === "SendOutreach" || mutation === "ExtendOffer") {
    return state;
  }
  if (!isApplication(state)) {
    return state;
  }
  if (mutation === "AdvanceStage" && isAdvanceStagePayload(payload)) {
    return { ...state, stage: payload.to };
  }
  if (mutation === "Reject") {
    return { ...state, stage: "Rejected" };
  }
  if (mutation === "Withdraw") {
    return { ...state, stage: "Withdrawn" };
  }
  return state;
}
