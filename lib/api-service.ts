export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  type: string;
  content?: string;
  session_id?: string;
  timestamp?: string;
  error?: string;
}

export interface AgentEvent {
  type: string;
  content?: string;
  chunk?: string;
  session_id?: string;
  tool_name?: string;
  function_name?: string;
  function_args?: Record<string, any>;
  function_result?: string;
  tool_content?: Record<string, any>;
  tool_call_id?: string;
  timestamp?: string;
  error?: string;
  plan?: any;
  step?: any;
  status?: string;
  thinking?: string;
  title?: string;
  role?: string;
  message?: string;
  success?: boolean;
  vnc_ws_port?: number;
  vnc_url?: string;
  sandbox_id?: string;
  e2b_session_id?: string;
  files?: Array<{ filename: string; download_url: string; mime?: string; sandbox_path?: string }>;
  text?: string;
  attachments?: Array<{ filename: string; download_url: string; sandbox_path?: string }>;
}

export interface AgentRequest {
  message: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  attachments?: any[];
  session_id?: string;
  is_continuation?: boolean;
}

export interface AgentCallbacks {
  onMessage?: (event: AgentEvent) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
}

export function getStoredToken(): string {
  try {
    const { getMemoryAccessToken } = require("./auth-service");
    const memToken = getMemoryAccessToken();
    if (memToken) return memToken;
  } catch {}
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return localStorage.getItem("dzeck_access_token") || "";
    }
  } catch {}
  return "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getStoredToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  }

  async chat(
    payload: ChatMessage[] | { messages: ChatMessage[] },
    callbacks: AgentCallbacks = {}
  ): Promise<() => void> {
    const { onMessage, onError, onDone } = callbacks;
    let isClosed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const messages = Array.isArray(payload) ? payload : payload.messages;
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      reader = response.body?.getReader() || null;
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const processSSELine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) return false;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          isClosed = true;
          onDone?.();
          return true;
        }

        try {
          const event: AgentEvent = JSON.parse(data);
          if (event.type === "message_end") {
            isClosed = true;
            onDone?.();
            return true;
          }
          onMessage?.(event);
        } catch (e) {
          console.error("Failed to parse SSE event:", e);
        }
        return false;
      };

      const processStream = async () => {
        try {
          while (!isClosed) {
            const { done, value } = await reader!.read();

            if (done) {
              // Process any remaining fragment in buffer (stream ended without trailing newline)
              if (buffer.trim()) {
                processSSELine(buffer);
                buffer = "";
              }
              if (!isClosed) {
                isClosed = true;
                onDone?.();
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (processSSELine(line)) break;
            }
          }
        } catch (error) {
          if (!isClosed) {
            isClosed = true;
            onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        }
      };

      processStream();

      return () => {
        isClosed = true;
        reader?.cancel().catch(() => {});
      };
    } catch (error) {
      console.error("Chat API error:", error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return () => { isClosed = true; };
    }
  }

  async agent(
    request: AgentRequest,
    callbacks: AgentCallbacks = {}
  ): Promise<() => void> {
    const { onMessage, onError, onDone } = callbacks;
    let isClosed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const response = await fetch(`${this.baseUrl}/api/agent`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          message: request.message,
          messages: request.messages || [],
          model: request.model || "qwen-3-235b-a22b-instruct-2507",
          attachments: request.attachments || [],
          session_id: request.session_id,
          is_continuation: request.is_continuation || false,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      reader = response.body?.getReader() || null;
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const processAgentLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) return false;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          isClosed = true;
          onDone?.();
          return true;
        }

        try {
          const event: AgentEvent = JSON.parse(data);
          onMessage?.(event);
        } catch (e) {
          console.error("Failed to parse SSE event:", e);
        }
        return false;
      };

      const processStream = async () => {
        try {
          while (!isClosed) {
            const { done, value } = await reader!.read();

            if (done) {
              // Process any remaining fragment (stream ended without trailing newline)
              if (buffer.trim()) {
                processAgentLine(buffer);
                buffer = "";
              }
              if (!isClosed) {
                isClosed = true;
                onDone?.();
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (processAgentLine(line)) break;
            }
          }
        } catch (error) {
          if (!isClosed) {
            isClosed = true;
            onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        }
      };

      processStream();

      return () => {
        isClosed = true;
        reader?.cancel().catch(() => {});
      };
    } catch (error) {
      console.error("Agent API error:", error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return () => { isClosed = true; };
    }
  }

  async test(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/test`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Test API error:", error);
      throw error;
    }
  }

  async getSessions(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions`, {
        headers: authHeaders(),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.sessions || [];
    } catch {
      return [];
    }
  }

  /**
   * Connect to an existing agent session SSE stream with automatic reconnect.
   * Uses Redis XRANGE replay (via /api/sessions/:sessionId/stream?last_event_id=...)
   * to replay missed events after a disconnection.
   *
   * Returns a stop function. Call it to permanently stop reconnecting.
   */
  connectSessionSSE(
    sessionId: string,
    callbacks: AgentCallbacks & { onReconnect?: (attempt: number) => void } = {}
  ): () => void {
    const { onMessage, onError, onDone, onReconnect } = callbacks;
    let stopped = false;
    let lastEventId = "0";
    let retryDelay = 1500;
    let retryCount = 0;
    const MAX_RETRIES = 10;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const stop = () => {
      stopped = true;
      reader?.cancel().catch(() => {});
    };

    const connect = async () => {
      if (stopped) return;

      try {
        // Use the Redis-backed stream endpoint which supports last_id for replay
        const url = `${this.baseUrl}/api/agent/stream-redis/${encodeURIComponent(sessionId)}?last_id=${encodeURIComponent(lastEventId)}`;
        const response = await fetch(url, { headers: authHeaders() });

        if (!response.ok) {
          if (response.status === 404) {
            onError?.(new Error(`Session ${sessionId} not found`));
            return;
          }
          throw new Error(`HTTP ${response.status}`);
        }

        retryCount = 0;
        retryDelay = 1500;
        reader = response.body?.getReader() || null;
        if (!reader) throw new Error("Response body not readable");

        const decoder = new TextDecoder();
        let buffer = "";
        let isClosed = false;

        while (!stopped && !isClosed) {
          const { done, value } = await reader.read();

          if (done) {
            if (buffer.trim()) {
              processLine(buffer);
              buffer = "";
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith("id: ")) {
              lastEventId = trimmed.slice(4).trim();
              continue;
            }

            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            if (data === "[DONE]") {
              isClosed = true;
              onDone?.();
              return;
            }

            processLine(trimmed);
          }
        }
      } catch (err: any) {
        if (stopped) return;
        reader = null;
      }

      if (!stopped) {
        retryCount++;
        if (retryCount > MAX_RETRIES) {
          onError?.(new Error(`SSE: max reconnect attempts (${MAX_RETRIES}) exceeded for session ${sessionId}`));
          return;
        }
        onReconnect?.(retryCount);
        const delay = Math.min(retryDelay * Math.pow(1.5, retryCount - 1), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        connect();
      }
    };

    function processLine(line: string) {
      const trimmed = line.startsWith("data: ") ? line.slice(6) : line;
      try {
        const event: AgentEvent = JSON.parse(trimmed);
        onMessage?.(event);
      } catch {}
    }

    connect();
    return stop;
  }

  /**
   * Health check: fetch /api/health and return parsed result.
   */
  async health(): Promise<{ status: string; services: Record<string, any> }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);
      return await res.json();
    } catch (err: any) {
      return { status: "error", services: { error: { status: "error", message: err.message } } };
    }
  }
}

export const apiService = new ApiService();

export function getApiBaseUrl(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}
