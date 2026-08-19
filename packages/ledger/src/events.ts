export type PermissionGate = "auto" | "batch" | "always";
export type PermissionResponse = "allow" | "deny";

export type ServerConnectedEvent = {
  type: "server.connected";
};

export type SessionCreatedEvent = {
  type: "session.created";
  properties: {
    session_id: string;
    model: string;
    job_ref: string | null;
    prompt_ref: string | null;
    /** Present for sub-agent child sessions spawned by the task tool. */
    parent_id?: string | null;
    /** Agent-definition name for sub-agent child sessions. */
    agent?: string | null;
  };
};

export type SessionUpdatedEvent = {
  type: "session.updated";
  properties: {
    session_id: string;
    prompt_ref: string | null;
    updated_at: number;
  };
};

export type MessageDeltaEvent = {
  type: "message.delta";
  properties: {
    session_id: string;
    text: string;
  };
};

export type MessageCompleteEvent = {
  type: "message.complete";
  properties: {
    session_id: string;
    role: string;
    content: string;
  };
};

export type ToolCallEvent = {
  type: "tool.call";
  properties: {
    session_id: string;
    tool_call_id: string;
    name: string;
    input: unknown;
  };
};

export type ToolResultEvent = {
  type: "tool.result";
  properties: {
    session_id: string;
    tool_call_id: string;
    name: string;
    output: unknown;
  };
};

export type PermissionAskedEvent = {
  type: "permission.asked";
  properties: {
    session_id: string;
    permission_id: string;
    mutations: string[];
    effect_classes: string[];
    gate: PermissionGate;
    summary: string;
  };
};

export type PermissionResolvedEvent = {
  type: "permission.resolved";
  properties: {
    session_id: string;
    permission_id: string;
    response: PermissionResponse;
  };
};

export type ChangesetEvent = {
  type: "changeset.staged" | "changeset.approved" | "changeset.applied" | "changeset.stale" | "changeset.rejected";
  properties: {
    changeset_id: string;
    status: string;
  };
};

export type SyncUpdatedEvent = {
  type: "sync.updated";
  properties: {
    ats: string;
  };
};

export type SessionErrorEvent = {
  type: "session.error";
  properties: {
    session_id: string;
    error: string;
  };
};

export type PluginWarningEvent = {
  type: "plugin.warning";
  properties: {
    plugin: string;
    hook: string;
    message: string;
  };
};

export type SessionAbortedEvent = {
  type: "session.aborted";
  properties: {
    session_id: string;
  };
};

export type SessionCompactedEvent = {
  type: "session.compacted";
  properties: {
    session_id: string;
    /** Id of the compaction summary row that now leads the replayed context. */
    summary_message_id: string;
    /** How many earlier messages the summary replaced in the replayed context. */
    compacted_messages: number;
    /** Recent messages kept verbatim after the summary. */
    kept_messages: number;
  };
};

export type SessionCompactionFailedEvent = {
  type: "session.compaction_failed";
  properties: {
    session_id: string;
    /** One-line failure reason; the run fell back to the uncompacted turn. */
    reason: string;
  };
};

export type MoxEvent =
  | ServerConnectedEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionErrorEvent
  | SessionAbortedEvent
  | SessionCompactedEvent
  | SessionCompactionFailedEvent
  | MessageDeltaEvent
  | MessageCompleteEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionAskedEvent
  | PermissionResolvedEvent
  | ChangesetEvent
  | SyncUpdatedEvent
  | PluginWarningEvent;

export type EventListener = (event: MoxEvent) => void;

export type EventBus = {
  subscribe(listener: EventListener): () => void;
  publish(event: MoxEvent): void;
  size(): number;
};

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    size() {
      return listeners.size;
    },
  };
}

export function encodeSse(event: MoxEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export type PermissionAsk = {
  session_id: string;
  mutations: string[];
  effect_classes: string[];
  gate: PermissionGate;
  summary: string;
};

export type PermissionGateHandle = {
  ask(request: PermissionAsk, timeoutMs: number): Promise<PermissionResponse>;
  resolve(permissionId: string, response: PermissionResponse, sessionId?: string): boolean;
  pending(): PermissionAskedEvent[];
  clear(): void;
};

export function createPermissionGate(bus: EventBus): PermissionGateHandle {
  const pending = new Map<
    string,
    {
      request: PermissionAsk;
      resolve: (response: PermissionResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  function askedEvent(permissionId: string, request: PermissionAsk): PermissionAskedEvent {
    return {
      type: "permission.asked",
      properties: {
        session_id: request.session_id,
        permission_id: permissionId,
        mutations: request.mutations,
        effect_classes: request.effect_classes,
        gate: request.gate,
        summary: request.summary,
      },
    };
  }

  return {
    ask(request, timeoutMs) {
      const permission_id = crypto.randomUUID();
      bus.publish(askedEvent(permission_id, request));
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.delete(permission_id)) {
            return;
          }
          bus.publish({
            type: "permission.resolved",
            properties: {
              session_id: request.session_id,
              permission_id,
              response: "deny",
            },
          });
          resolve("deny");
        }, timeoutMs);
        pending.set(permission_id, { request, resolve, timer });
      });
    },
    resolve(permissionId, response, sessionId) {
      const current = pending.get(permissionId);
      if (!current) {
        return false;
      }
      if (sessionId !== undefined && current.request.session_id !== sessionId) {
        return false;
      }
      pending.delete(permissionId);
      clearTimeout(current.timer);
      bus.publish({
        type: "permission.resolved",
        properties: {
          session_id: current.request.session_id,
          permission_id: permissionId,
          response,
        },
      });
      current.resolve(response);
      return true;
    },
    pending() {
      return [...pending.entries()].map(([permissionId, current]) => askedEvent(permissionId, current.request));
    },
    clear() {
      for (const current of pending.values()) {
        clearTimeout(current.timer);
        current.resolve("deny");
      }
      pending.clear();
    },
  };
}
