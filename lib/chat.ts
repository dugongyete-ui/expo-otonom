import { fetch } from "expo/fetch";

/**
 * Stream chat responses from Cerebras AI via SSE.
 * Yields text chunks as they arrive.
 */
export async function* streamChat(
  messages: Array<{ role: string; content: string }>,
  apiUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat request failed: ${response.status} ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          // Handle both direct content and message_chunk format from server
          if (parsed.type === "message_chunk" && parsed.chunk) yield parsed.chunk;
          else if (parsed.type === "message_end") return;
          else if (parsed.content) yield parsed.content;
          if (parsed.type === "error" && parsed.error) throw new Error(parsed.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
}

/**
 * Agent event types from the autonomous AI agent backend.
 * Inspired by ai-manus event system.
 */
export interface AgentPlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  success?: boolean;
  attachments?: string[];
  tools?: AgentEvent[];
}

export interface AgentPlan {
  id: string;
  title: string;
  goal: string;
  language: string;
  steps: AgentPlanStep[];
  message?: string;
  status: string;
}

export interface ToolContent {
  type: "shell" | "search" | "browser" | "file" | "mcp" | "message" | "todo" | "task";
  console?: string;
  command?: string;
  return_code?: number;
  results?: Array<{ title: string; url: string; snippet: string }>;
  query?: string;
  title?: string;
  content?: string;
  url?: string;
  file?: string;
  operation?: string;
  tool?: string;
  result?: string;
  screenshot_b64?: string;
  language?: string;
  // Message-specific fields
  text?: string;
  is_ask?: boolean;
  // Todo-specific fields
  todo_type?: string;
  items?: Array<{ text: string; done: boolean }>;
  total?: number;
  done?: number;
  item?: string;
  // Task-specific fields
  task_type?: string;
  tasks?: Array<{ id?: string; description?: string; status?: string }>;
  task_id?: string;
  // Shell additional fields
  stdout?: string;
  stderr?: string;
  id?: string;
  backend?: string;
  // File additional fields
  filename?: string;
  download_url?: string;
  // Browser additional fields
  save_path?: string;
}

export type AgentEventType =
  | "plan"
  | "step"
  | "tool"
  | "tool_stream"
  | "message"
  | "message_start"
  | "message_chunk"
  | "message_end"
  | "message_correct"
  | "error"
  | "done"
  | "title"
  | "thinking"
  | "wait"
  | "waiting_for_user"
  | "notify"
  | "files"
  | "session"
  | "ask";

export interface AgentEvent {
  type: AgentEventType;
  id?: string;
  timestamp?: number;
  // Plan events
  plan?: AgentPlan;
  status?: string;
  // Step events
  step?: AgentPlanStep;
  // Tool events
  tool_name?: string;
  function_name?: string;
  function_args?: Record<string, unknown>;
  tool_call_id?: string;
  function_result?: string;
  tool_content?: ToolContent;
  // Message events
  message?: string;
  role?: string;
  // Error events
  error?: string;
  // Title events
  title?: string;
  // Thinking events
  thinking?: string;
  content?: string;
  // Wait events
  prompt?: string;
  // Done events
  success?: boolean;
  session_id?: string;
  // Additional details
  details?: string;
  attachments?: string[];
  // Streaming message fields
  chunk?: string;
  text?: string;
  isStreaming?: boolean;
  // Files events
  files?: Array<{ filename: string; download_url: string; mime?: string; path?: string }>;
  // Notify events
  action?: string;
}

/**
 * Stream agent events from the autonomous AI agent backend via SSE.
 * Yields AgentEvent objects as they arrive.
 */
export async function* streamAgent(
  message: string,
  apiUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const response = await fetch(`${apiUrl}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      attachments: [],
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agent request failed: ${response.status} ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed: AgentEvent = JSON.parse(data);
          yield parsed;
        } catch {
          // Skip malformed JSON
          continue;
        }
      }
    }
  }
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "ask";
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  isStreaming?: boolean;
  error?: string;
  // Agent-specific fields
  agentEvent?: AgentEvent;
  eventType?: AgentEventType;
  plan?: AgentPlan;
  step?: AgentPlanStep;
  toolContent?: ToolContent;
  thinking?: string;
}

export interface ChatAttachment {
  uri: string;
  type: "image" | "file";
  name?: string;
  mimeType?: string;
}

export type ChatListItem =
  | { kind: "chat"; data: ChatMessage }
  | { kind: "agent"; data: AgentEvent; id: string }
  | { kind: "plan_view"; id: string }
  | { kind: "tool_card"; data: AgentEvent; id: string }
  | { kind: "computer_view"; id: string };
