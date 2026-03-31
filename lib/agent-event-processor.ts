/**
 * Shared agent event parser — single source of truth for AgentEvent → NormalizedEvent conversion.
 * Both useChat.ts (flat message model) and ChatPage.tsx (rich plan/tool model) call
 * processAgentEvent() and switch on ev.kind instead of duplicating raw field access.
 */

import { AgentEvent } from "./api-service";

// ─── Canonical event-type constants ─────────────────────────────────────────

export const AGENT_EVENT_TYPES = {
  SESSION: "session",
  PLAN: "plan",
  STEP: "step",
  TOOL: "tool",
  TOOL_STREAM: "tool_stream",
  MESSAGE_START: "message_start",
  MESSAGE_CHUNK: "message_chunk",
  MESSAGE_END: "message_end",
  MESSAGE: "message",
  MESSAGE_CORRECT: "message_correct",
  WAITING_FOR_USER: "waiting_for_user",
  ASK: "ask",
  NOTIFY: "notify",
  FILES: "files",
  TITLE: "title",
  THINKING: "thinking",
  VNC_STREAM_URL: "vnc_stream_url",
  BROWSER_SCREENSHOT: "browser_screenshot",
  DESKTOP_SCREENSHOT: "desktop_screenshot",
  ERROR: "error",
  DONE: "done",
  TODO_UPDATE: "todo_update",
  TASK_UPDATE: "task_update",
  SEARCH_RESULTS: "search_results",
} as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[keyof typeof AGENT_EVENT_TYPES];

// ─── Normalised event payloads ───────────────────────────────────────────────

export interface NormalizedSessionEvent {
  kind: "session";
  sessionId: string;
}

export interface NormalizedMessageStartEvent {
  kind: "message_start";
  role: "assistant" | "ask";
  content: string;
}

export interface NormalizedMessageChunkEvent {
  kind: "message_chunk";
  chunk: string;
}

export interface NormalizedMessageEndEvent {
  kind: "message_end";
}

export interface NormalizedMessageEvent {
  kind: "message";
  role: "assistant" | "user";
  content: string;
}

export interface NormalizedMessageCorrectEvent {
  kind: "message_correct";
  text: string;
}

export interface NormalizedWaitingForUserEvent {
  kind: "waiting_for_user";
}

export interface NormalizedToolEvent {
  kind: "tool";
  toolName: string;
  functionName: string;
  callId: string;
  status: "calling" | "called" | "error";
  args?: Record<string, any>;
  result?: string;
  toolContent?: Record<string, any>;
}

export interface NormalizedToolStreamEvent {
  kind: "tool_stream";
  callId: string;
  chunk: string;
}

export interface NormalizedPlanEvent {
  kind: "plan";
  plan: any;
  status?: string;
}

export interface NormalizedStepEvent {
  kind: "step";
  step: any;
  status?: string;
}

export interface NormalizedNotifyEvent {
  kind: "notify";
  text: string;
  attachments?: Array<{ filename: string; download_url: string; sandbox_path?: string }>;
}

export interface NormalizedFilesEvent {
  kind: "files";
  files: Array<{ filename: string; download_url: string; mime?: string; sandbox_path?: string }>;
}

export interface NormalizedTitleEvent {
  kind: "title";
  title: string;
}

export interface NormalizedThinkingEvent {
  kind: "thinking";
  text: string;
}

export interface NormalizedVncEvent {
  kind: "vnc_stream_url";
  vncUrl: string;
  sandboxId: string;
  e2bSessionId: string;
}

export interface NormalizedScreenshotEvent {
  kind: "screenshot";
  source: "browser" | "desktop";
  screenshotB64: string;
  callId?: string;
  url?: string;
  title?: string;
}

export interface NormalizedErrorEvent {
  kind: "error";
  message: string;
}

export interface NormalizedDoneEvent {
  kind: "done";
}

export interface NormalizedUnknownEvent {
  kind: "unknown";
  rawType: string;
}

export type NormalizedEvent =
  | NormalizedSessionEvent
  | NormalizedMessageStartEvent
  | NormalizedMessageChunkEvent
  | NormalizedMessageEndEvent
  | NormalizedMessageEvent
  | NormalizedMessageCorrectEvent
  | NormalizedWaitingForUserEvent
  | NormalizedToolEvent
  | NormalizedToolStreamEvent
  | NormalizedPlanEvent
  | NormalizedStepEvent
  | NormalizedNotifyEvent
  | NormalizedFilesEvent
  | NormalizedTitleEvent
  | NormalizedThinkingEvent
  | NormalizedVncEvent
  | NormalizedScreenshotEvent
  | NormalizedErrorEvent
  | NormalizedDoneEvent
  | NormalizedUnknownEvent;

// ─── Core parser — single source of truth ───────────────────────────────────

/**
 * Normalize a raw AgentEvent from the SSE stream into a typed NormalizedEvent.
 * Consumers (useChat, ChatPage) call this once and switch on `result.kind`
 * instead of duplicating the raw-field access logic.
 */
export function processAgentEvent(event: AgentEvent): NormalizedEvent {
  const { type } = event;

  switch (type) {
    case AGENT_EVENT_TYPES.SESSION:
      return { kind: "session", sessionId: event.session_id || "" };

    case AGENT_EVENT_TYPES.MESSAGE_START:
      return {
        kind: "message_start",
        role: event.role === "ask" ? "ask" : "assistant",
        content: event.content || event.message || "",
      };

    case AGENT_EVENT_TYPES.MESSAGE_CHUNK:
      return {
        kind: "message_chunk",
        chunk: event.chunk || event.content || "",
      };

    case AGENT_EVENT_TYPES.MESSAGE_END:
      return { kind: "message_end" };

    case AGENT_EVENT_TYPES.MESSAGE:
      return {
        kind: "message",
        role: (event.role as "assistant" | "user") || "assistant",
        content: event.content || event.message || "",
      };

    case AGENT_EVENT_TYPES.MESSAGE_CORRECT:
      return {
        kind: "message_correct",
        text: event.text || event.content || "",
      };

    case AGENT_EVENT_TYPES.WAITING_FOR_USER:
    case AGENT_EVENT_TYPES.ASK:
      return { kind: "waiting_for_user" };

    case AGENT_EVENT_TYPES.TOOL: {
      const toolName = event.tool_name || event.function_name || "tool";
      const functionName = event.function_name || event.tool_name || "";
      const callId = event.tool_call_id || `tool_${Date.now()}`;
      const status = (event.status as "calling" | "called" | "error") || "calling";
      return {
        kind: "tool",
        toolName,
        functionName,
        callId,
        status,
        args: event.function_args,
        result: event.function_result,
        toolContent: event.tool_content,
      };
    }

    case AGENT_EVENT_TYPES.TOOL_STREAM:
      return {
        kind: "tool_stream",
        callId: event.tool_call_id || "",
        chunk: event.chunk || event.content || "",
      };

    case AGENT_EVENT_TYPES.PLAN:
      return {
        kind: "plan",
        plan: event.plan,
        status: event.status,
      };

    case AGENT_EVENT_TYPES.STEP:
      return {
        kind: "step",
        step: event.step,
        status: event.status,
      };

    case AGENT_EVENT_TYPES.NOTIFY:
      return {
        kind: "notify",
        text: event.text || event.message || event.content || "",
        attachments: event.attachments as NormalizedNotifyEvent["attachments"],
      };

    case AGENT_EVENT_TYPES.FILES: {
      const files = Array.isArray(event.files) ? event.files : [];
      return { kind: "files", files };
    }

    case AGENT_EVENT_TYPES.TITLE:
      return { kind: "title", title: event.title || "" };

    case AGENT_EVENT_TYPES.THINKING:
      return { kind: "thinking", text: event.thinking || event.content || "" };

    case AGENT_EVENT_TYPES.VNC_STREAM_URL:
      return {
        kind: "vnc_stream_url",
        vncUrl: event.vnc_url || "",
        sandboxId: event.sandbox_id || "",
        e2bSessionId: event.e2b_session_id || "",
      };

    case AGENT_EVENT_TYPES.BROWSER_SCREENSHOT:
    case AGENT_EVENT_TYPES.DESKTOP_SCREENSHOT: {
      const raw = event.screenshot_b64 || "";
      const normalized = raw && !raw.startsWith("data:")
        ? `data:image/png;base64,${raw}`
        : raw;
      return {
        kind: "screenshot",
        source: type === AGENT_EVENT_TYPES.BROWSER_SCREENSHOT ? "browser" : "desktop",
        screenshotB64: normalized,
        callId: event.tool_call_id,
        url: event.url || "",
        title: event.title || "",
      };
    }

    case AGENT_EVENT_TYPES.ERROR:
      return { kind: "error", message: event.error || "Unknown error" };

    case AGENT_EVENT_TYPES.DONE:
      return { kind: "done" };

    default:
      return { kind: "unknown", rawType: type };
  }
}
