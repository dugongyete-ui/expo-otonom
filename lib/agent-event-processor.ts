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
  WAIT: "wait",
  ASK: "ask",
  NOTIFY: "notify",
  FILES: "files",
  TITLE: "title",
  THINKING: "thinking",
  VNC_STREAM_URL: "vnc_stream_url",
  SCREENSHOT: "screenshot",
  BROWSER_SCREENSHOT: "browser_screenshot",
  DESKTOP_SCREENSHOT: "desktop_screenshot",
  ERROR: "error",
  DONE: "done",
  SUMMARIZE: "summarize",
  TODO_UPDATE: "todo_update",
  TASK_UPDATE: "task_update",
  SEARCH_RESULTS: "search_results",
  SHELL_OUTPUT: "shell_output",
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
  stepId?: string;
}

export interface NormalizedSummarizeEvent {
  kind: "summarize";
  text?: string;
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

export interface NormalizedTodoUpdateEvent {
  kind: "todo_update";
  items: Array<{ id: string; text: string; status: string; [key: string]: any }>;
  sessionId?: string;
}

export interface NormalizedTaskUpdateEvent {
  kind: "task_update";
  task: { id?: string; title?: string; status?: string; description?: string; [key: string]: any };
}

export interface NormalizedSearchResultsEvent {
  kind: "search_results";
  results: Array<{ title: string; url: string; snippet?: string; [key: string]: any }>;
  query?: string;
}

export interface NormalizedShellOutputEvent {
  kind: "shell_output";
  output: string;
  callId?: string;
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
  | NormalizedSummarizeEvent
  | NormalizedTodoUpdateEvent
  | NormalizedTaskUpdateEvent
  | NormalizedSearchResultsEvent
  | NormalizedShellOutputEvent
  | NormalizedUnknownEvent;

// ─── Flat message model (shared by useChat and any flat-chat consumers) ─────

export interface FlatMessage {
  id: string;
  type: "user" | "assistant" | "tool" | "step" | "thinking" | "title";
  content: string;
  timestamp: Date;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolCallId?: string;
  toolStatus?: "calling" | "called" | "error";
  isLoading?: boolean;
  stepId?: string;
}

export type AgentPhase = "IDLE" | "PLANNING" | "EXECUTING" | "UPDATING" | "SUMMARIZING";

export interface FlatChatReducerCallbacks {
  onSessionId?: (id: string) => void;
  onPlan?: (plan: any, status?: string) => void;
  onVncUrl?: (vncUrl: string, sandboxId: string, e2bSessionId: string) => void;
  onScreenshot?: (screenshotB64: string, url?: string, title?: string) => void;
  onFiles?: (files: Array<{ filename: string; download_url: string; mime?: string; sandbox_path?: string }>) => void;
  onError?: (message: string) => void;
  onWaitingForUser?: () => void;
  onDone?: () => void;
  onPhaseChange?: (phase: AgentPhase) => void;
  onSummarize?: (text?: string) => void;
}

/**
 * Pure reducer: apply one NormalizedEvent to a FlatMessage[] array.
 * Returns the new array (or the same reference if unchanged).
 * Side-effects (session id, plan, vnc, files, errors) are routed via callbacks.
 *
 * Used by useChat.ts so the flat-message state-update logic lives here —
 * not duplicated in each consumer.
 */
export function applyEventToFlatMessages(
  prev: FlatMessage[],
  ev: NormalizedEvent,
  streamingIdRef: { current: string | null },
  getToolLabel: (functionName: string) => string,
  callbacks: FlatChatReducerCallbacks = {},
  currentStepIdRef?: { current: string | null },
): FlatMessage[] {
  switch (ev.kind) {
    case "session": {
      callbacks.onSessionId?.(ev.sessionId);
      return prev;
    }

    case "done": {
      callbacks.onPhaseChange?.("IDLE");
      callbacks.onDone?.();
      if (currentStepIdRef) currentStepIdRef.current = null;
      const hasLoadingItems = prev.some(m => m.isLoading);
      if (hasLoadingItems) {
        return prev.map(m => m.isLoading ? { ...m, isLoading: false } : m);
      }
      return prev;
    }

    case "waiting_for_user": {
      callbacks.onPhaseChange?.("IDLE");
      callbacks.onWaitingForUser?.();
      return prev;
    }

    case "message_start": {
      const id = `msg-${Date.now()}`;
      streamingIdRef.current = id;
      return [...prev, { id, type: "assistant", content: ev.content, timestamp: new Date(), isLoading: true }];
    }

    case "message": {
      return [...prev, { id: `msg-${Date.now()}`, type: "assistant", content: ev.content, timestamp: new Date(), isLoading: false }];
    }

    case "message_chunk": {
      if (!ev.chunk) return prev;
      const sid = streamingIdRef.current;
      const idx = sid ? prev.findIndex(m => m.id === sid) : -1;
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], content: updated[idx].content + ev.chunk, isLoading: true };
        return updated;
      }
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].type === "assistant") {
        const updated = [...prev];
        updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + ev.chunk, isLoading: true };
        return updated;
      }
      return prev;
    }

    case "message_end": {
      const sid = streamingIdRef.current;
      streamingIdRef.current = null;
      const idx = sid ? prev.findIndex(m => m.id === sid) : -1;
      let next = [...prev];
      if (idx >= 0) {
        next[idx] = { ...next[idx], isLoading: false };
      } else {
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx].type === "assistant") {
          next[lastIdx] = { ...next[lastIdx], isLoading: false };
        }
      }
      const finalIdx = idx >= 0 ? idx : next.length - 1;
      const finalMsg = finalIdx >= 0 ? next[finalIdx] : null;
      if (finalMsg && finalMsg.type === "assistant" && finalMsg.content && finalMsg.content.trim().length > 30) {
        const trimmed = finalMsg.content.trim();
        next = next.filter(m =>
          m.id === finalMsg.id ||
          m.type !== "assistant" ||
          !m.content ||
          m.content.trim() !== trimmed
        );
      }
      return next;
    }

    case "message_correct": {
      if (!ev.text) return prev;
      const lastAssistantIdx = [...prev].reverse().findIndex(m => m.type === "assistant");
      if (lastAssistantIdx < 0) return prev;
      const idx = prev.length - 1 - lastAssistantIdx;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], content: ev.text, isLoading: false };
      return updated;
    }

    case "tool": {
      const label = getToolLabel(ev.functionName);
      const activeStepId = currentStepIdRef?.current ?? undefined;
      const existingIdx = prev.findIndex(m => m.id === ev.callId);
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        const updated = [...prev];
        updated[existingIdx] = {
          ...existing,
          content: label,
          toolName: ev.functionName,
          toolArgs: ev.args ?? existing.toolArgs,
          toolCallId: ev.callId,
          toolStatus: ev.status,
          isLoading: ev.status === "calling",
          stepId: existing.stepId ?? activeStepId,
        };
        return updated;
      }
      const toolMsg: FlatMessage = {
        id: ev.callId,
        type: "tool",
        content: label,
        timestamp: new Date(),
        toolName: ev.functionName,
        toolArgs: ev.args,
        toolCallId: ev.callId,
        toolStatus: ev.status,
        isLoading: ev.status === "calling",
        stepId: activeStepId,
      };
      return [...prev, toolMsg];
    }

    case "tool_stream": {
      if (!ev.callId) return prev;
      const idx = prev.findIndex(m => m.id === ev.callId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], content: updated[idx].content + ev.chunk, isLoading: true };
        return updated;
      }
      return prev;
    }

    case "step": {
      const stepContent = ev.step?.description || ev.step?.title || "Processing...";
      const stepId = ev.step?.id || ev.stepId;
      const stepStatus = ev.status;
      if (stepStatus === "running" || stepStatus === "started") {
        callbacks.onPhaseChange?.("EXECUTING");
        if (currentStepIdRef && stepId) currentStepIdRef.current = stepId;
        return [...prev, { id: `msg-step-${stepId || Date.now()}`, type: "step", content: stepContent, timestamp: new Date(), isLoading: true, stepId }];
      } else if (stepStatus === "completed" || stepStatus === "failed") {
        if (currentStepIdRef) currentStepIdRef.current = null;
        const stepMsgId = `msg-step-${stepId || ""}`;
        const existing = prev.find(m => m.id === stepMsgId);
        if (existing) {
          return prev.map(m => m.id === stepMsgId ? { ...m, isLoading: false } : m);
        }
        return prev;
      }
      return [...prev, { id: `msg-step-${stepId || Date.now()}`, type: "step", content: stepContent, timestamp: new Date(), isLoading: true, stepId }];
    }

    case "thinking": {
      return [...prev, { id: `msg-thinking-${Date.now()}`, type: "thinking", content: ev.text, timestamp: new Date(), isLoading: true }];
    }

    case "title": {
      if (!ev.title) return prev;
      return [...prev, { id: `msg-title-${Date.now()}`, type: "title", content: ev.title, timestamp: new Date() }];
    }

    case "notify": {
      if (!ev.text) return prev;
      const notifyTrimmed = ev.text.trim();
      if (notifyTrimmed.length > 30) {
        const recentAssistant = [...prev].reverse().find(m => m.type === "assistant" && m.content && m.content.trim().length > 0);
        if (recentAssistant && recentAssistant.content.trim() === notifyTrimmed) {
          return prev;
        }
      }
      return [...prev, { id: `msg-notify-${Date.now()}`, type: "assistant", content: ev.text, timestamp: new Date() }];
    }

    case "plan": {
      if (ev.status === "created" || ev.status === "updated") {
        callbacks.onPhaseChange?.(ev.status === "updated" ? "UPDATING" : "PLANNING");
      } else if (ev.status === "completed") {
        callbacks.onPhaseChange?.("IDLE");
      }
      callbacks.onPlan?.(ev.plan, ev.status);
      return prev;
    }

    case "summarize": {
      callbacks.onPhaseChange?.("SUMMARIZING");
      callbacks.onSummarize?.(ev.text);
      if (ev.text) {
        const SUMMARIZE_ID = "msg-summarize-current";
        const existingIdx = prev.findIndex(m => m.id === SUMMARIZE_ID);
        const summaryMsg: FlatMessage = {
          id: SUMMARIZE_ID,
          type: "assistant" as const,
          content: ev.text,
          timestamp: new Date(),
          isLoading: false,
        };
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = summaryMsg;
          return updated;
        }
        return [...prev, summaryMsg];
      }
      return prev;
    }

    case "vnc_stream_url": {
      callbacks.onVncUrl?.(ev.vncUrl, ev.sandboxId, ev.e2bSessionId);
      return prev;
    }

    case "screenshot": {
      callbacks.onScreenshot?.(ev.screenshotB64, ev.url, ev.title);
      return prev;
    }

    case "files": {
      callbacks.onFiles?.(ev.files);
      return prev;
    }

    case "error": {
      callbacks.onPhaseChange?.("IDLE");
      if (currentStepIdRef) currentStepIdRef.current = null;
      callbacks.onError?.(ev.message);
      return [...prev, {
        id: `msg-error-${Date.now()}`,
        type: "assistant" as const,
        content: `⚠️ ${ev.message}`,
        timestamp: new Date(),
        isLoading: false,
      }];
    }

    case "todo_update": {
      if (ev.items && ev.items.length > 0) {
        const summary = ev.items
          .map((item: any) => `• [${item.status || "?"}] ${item.text}`)
          .join("\n");
        return [...prev, {
          id: `msg-todo-${Date.now()}`,
          type: "assistant" as const,
          content: `Todo list updated:\n${summary}`,
          timestamp: new Date(),
        }];
      }
      return prev;
    }

    case "task_update": {
      if (ev.task) {
        const label = ev.task.title || ev.task.description || "";
        const status = ev.task.status ? ` [${ev.task.status}]` : "";
        return [...prev, {
          id: `msg-task-${Date.now()}`,
          type: "assistant" as const,
          content: label ? `Task${status}: ${label}` : `Task updated${status}`,
          timestamp: new Date(),
        }];
      }
      return prev;
    }

    case "search_results": {
      if (ev.results && ev.results.length > 0) {
        const lines = ev.results.map((r: any) => `• [${r.title}](${r.url})`).join("\n");
        const queryLabel = ev.query ? `Results for "${ev.query}":\n` : "Search results:\n";
        return [...prev, {
          id: `msg-search-${Date.now()}`,
          type: "assistant" as const,
          content: queryLabel + lines,
          timestamp: new Date(),
        }];
      }
      return prev;
    }

    case "shell_output": {
      if (ev.output) {
        return [...prev, {
          id: `msg-shell-${ev.callId || Date.now()}`,
          type: "tool" as const,
          content: ev.output,
          timestamp: new Date(),
          toolName: "shell",
          toolCallId: ev.callId,
          toolStatus: "called" as const,
        }];
      }
      return prev;
    }

    case "unknown":
    default:
      return prev;
  }
}

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
    case AGENT_EVENT_TYPES.WAIT:
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
        stepId: event.step?.id,
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

    case AGENT_EVENT_TYPES.SCREENSHOT:
    case AGENT_EVENT_TYPES.BROWSER_SCREENSHOT:
    case AGENT_EVENT_TYPES.DESKTOP_SCREENSHOT: {
      const raw = event.screenshot_b64 || "";
      const normalized = raw && !raw.startsWith("data:")
        ? `data:image/png;base64,${raw}`
        : raw;
      const source: "browser" | "desktop" =
        type === AGENT_EVENT_TYPES.DESKTOP_SCREENSHOT ? "desktop" : "browser";
      return {
        kind: "screenshot",
        source,
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

    case AGENT_EVENT_TYPES.SUMMARIZE:
      return { kind: "summarize", text: event.text || event.content || event.message || "" };

    case AGENT_EVENT_TYPES.TODO_UPDATE:
      return {
        kind: "todo_update",
        items: Array.isArray(event.items) ? event.items : (event.todo_items || []),
        sessionId: event.session_id,
      };

    case AGENT_EVENT_TYPES.TASK_UPDATE:
      return {
        kind: "task_update",
        task: event.task || { status: event.status, title: event.title },
      };

    case AGENT_EVENT_TYPES.SEARCH_RESULTS:
      return {
        kind: "search_results",
        results: Array.isArray(event.results) ? event.results : [],
        query: event.query || event.search_query || "",
      };

    case AGENT_EVENT_TYPES.SHELL_OUTPUT:
      return {
        kind: "shell_output",
        output: event.output || event.content || "",
        callId: event.tool_call_id,
      };

    default:
      return { kind: "unknown", rawType: type };
  }
}
