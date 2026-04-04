import { getApiUrl } from "./query-client";
import { getMemoryToken, setMemoryToken } from "./token-store";
import { Platform } from "react-native";

/** Safe fallback model used when no model is specified in user prefs or the request. */
export const DEFAULT_MODEL_FALLBACK = "qwen-3-235b-a22b-instruct-2507";

/**
 * Checks whether the fetch Response has a readable body stream.
 * React Native's built-in fetch does NOT expose response.body, so we must
 * fall back to XMLHttpRequest for streaming SSE-style responses.
 */
function hasReadableBody(response: Response): boolean {
  return !!(response.body && typeof response.body.getReader === "function");
}

/**
 * Stream a POST request using XMLHttpRequest with onprogress.
 * This is necessary for React Native where fetch().body is null.
 *
 * @param url       Full request URL
 * @param headers   Request headers (Authorization, Content-Type, etc.)
 * @param body      Request body as JSON string
 * @param onChunk   Called with each new incremental text chunk
 * @param onDone    Called when the request completes
 * @param onError   Called on network or HTTP error
 * @returns cancel  Function to abort the request
 */
function streamWithXHR(
  url: string,
  headers: Record<string, string>,
  body: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): () => void {
  const xhr = new XMLHttpRequest();
  let consumed = 0;
  let aborted = false;

  xhr.open("POST", url, true);
  xhr.responseType = "text";

  Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

  xhr.onprogress = () => {
    if (aborted) return;
    const text = xhr.responseText;
    if (text.length > consumed) {
      onChunk(text.slice(consumed));
      consumed = text.length;
    }
  };

  xhr.onload = () => {
    if (aborted) return;
    // Flush any remaining text
    const text = xhr.responseText;
    if (text.length > consumed) {
      onChunk(text.slice(consumed));
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      onDone();
    } else {
      onError(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
    }
  };

  xhr.onerror = () => {
    if (!aborted) onError(new Error("Network error"));
  };

  xhr.ontimeout = () => {
    if (!aborted) onError(new Error("Request timed out"));
  };

  xhr.send(body);

  return () => {
    aborted = true;
    xhr.abort();
  };
}

/**
 * Stream a GET request using XMLHttpRequest with onprogress.
 * Used for SSE reconnect / Redis stream endpoints.
 */
function streamGetWithXHR(
  url: string,
  headers: Record<string, string>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): () => void {
  const xhr = new XMLHttpRequest();
  let consumed = 0;
  let aborted = false;

  xhr.open("GET", url, true);
  xhr.responseType = "text";

  Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

  xhr.onprogress = () => {
    if (aborted) return;
    const text = xhr.responseText;
    if (text.length > consumed) {
      onChunk(text.slice(consumed));
      consumed = text.length;
    }
  };

  xhr.onload = () => {
    if (aborted) return;
    const text = xhr.responseText;
    if (text.length > consumed) {
      onChunk(text.slice(consumed));
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      onDone();
    } else {
      onError(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
    }
  };

  xhr.onerror = () => {
    if (!aborted) onError(new Error("Network error"));
  };

  xhr.ontimeout = () => {
    if (!aborted) onError(new Error("Request timed out"));
  };

  xhr.send(null);

  return () => {
    aborted = true;
    xhr.abort();
  };
}

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
  screenshot_b64?: string;
  url?: string;
  results?: Array<{ title: string; url: string; snippet?: string; content?: string }>;
  query?: string;
  _streamId?: string;
}

export interface AgentRequest {
  message: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  attachments?: any[];
  session_id?: string;
  is_continuation?: boolean;
  mode?: string;
}

export interface AgentCallbacks {
  onMessage?: (event: AgentEvent) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
}

export interface McpServer {
  name: string;
  url: string;
  has_auth_token?: boolean;
  enabled: boolean;
  description?: string;
  transport?: string;
  created_at?: string;
  updated_at?: string;
}

export interface McpServerInput {
  name: string;
  url: string;
  auth_token?: string;
  description?: string;
  transport?: string;
  enabled?: boolean;
}

export interface UserPrefs {
  model?: string;
  modelProvider?: string;
  searchProvider?: string;
  theme?: string;
  language?: string;
}

export function setSharedMemoryToken(token: string | null) {
  setMemoryToken(token);
}

export function getStoredToken(): string {
  const memToken = getMemoryToken();
  if (memToken) return memToken;
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
    // Use getApiUrl() as single source of truth for URL resolution.
    // Falls back to window.location.origin for web-only environments where
    // getApiUrl() returns a relative/empty string.
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      const resolved = getApiUrl();
      // getApiUrl() always returns a full URL with trailing slash; strip the trailing slash for baseUrl
      this.baseUrl = resolved.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
    }
  }

  chat(
    payload: ChatMessage[] | { messages: ChatMessage[] },
    callbacks: AgentCallbacks = {}
  ): () => void {
    const { onMessage, onError, onDone } = callbacks;
    const messages = Array.isArray(payload) ? payload : payload.messages;
    const url = `${this.baseUrl}/api/chat`;
    const body = JSON.stringify({ messages });
    const hdrs = authHeaders();
    let isClosed = false;
    let buffer = "";

    const processSSELine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) return false;
      const data = trimmed.slice(6).trim();
      if (data === "[DONE]") { if (!isClosed) { isClosed = true; onDone?.(); } return true; }
      try {
        const event: AgentEvent = JSON.parse(data);
        if (event.type === "message_end") { if (!isClosed) { isClosed = true; onDone?.(); } return true; }
        onMessage?.(event);
      } catch (e) {
        console.error("Failed to parse SSE event:", e, "raw data:", data);
      }
      return false;
    };

    const processChunk = (chunk: string) => {
      if (isClosed) return;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (processSSELine(line)) return;
      }
    };

    const flushBuffer = () => {
      if (buffer.trim()) {
        processSSELine(buffer);
        buffer = "";
      }
    };

    const cancel = streamWithXHR(
      url, hdrs, body,
      processChunk,
      () => {
        if (isClosed) return;
        flushBuffer();
        if (!isClosed) { isClosed = true; onDone?.(); }
      },
      (err) => {
        if (!isClosed) { isClosed = true; onError?.(err); }
      }
    );

    return () => { isClosed = true; cancel(); };
  }

  agent(
    request: AgentRequest,
    callbacks: AgentCallbacks = {}
  ): () => void {
    const { onMessage, onError, onDone } = callbacks;
    const url = `${this.baseUrl}/api/agent`;
    let isClosed = false;
    let cancelStream: (() => void) | null = null;

    const startStream = (resolvedModel: string) => {
      if (isClosed) return;
      const bodyObj: Record<string, unknown> = {
        message: request.message,
        messages: request.messages || [],
        model: resolvedModel,
        attachments: request.attachments || [],
        session_id: request.session_id,
        is_continuation: request.is_continuation || false,
      };
      if (request.mode) bodyObj.mode = request.mode;
      const body = JSON.stringify(bodyObj);
      const hdrs = authHeaders();
      let buffer = "";
      let lastSeenId = "";

      const processAgentLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (trimmed.startsWith("id: ")) { lastSeenId = trimmed.slice(4).trim(); return false; }
        if (!trimmed || !trimmed.startsWith("data: ")) return false;
        const data = trimmed.slice(6).trim();
        if (data === "[DONE]") { if (!isClosed) { isClosed = true; onDone?.(); } return true; }
        try {
          const event: AgentEvent = JSON.parse(data);
          if (lastSeenId) event._streamId = lastSeenId;
          onMessage?.(event);
        } catch (e) {
          console.error("Failed to parse SSE event:", e, "raw data:", data);
        }
        return false;
      };

      const processChunk = (chunk: string) => {
        if (isClosed) return;
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (processAgentLine(line)) return;
        }
      };

      const flushBuffer = () => {
        if (buffer.trim()) {
          processAgentLine(buffer);
          buffer = "";
        }
      };

      cancelStream = streamWithXHR(
        url, hdrs, body,
        processChunk,
        () => {
          if (isClosed) return;
          flushBuffer();
          if (!isClosed) { isClosed = true; onDone?.(); }
        },
        (err) => {
          if (!isClosed) { isClosed = true; onError?.(err); }
        }
      );
    };

    // If caller already supplied a model, start streaming immediately.
    // Otherwise, resolve from user prefs first, then fall back to DEFAULT_MODEL_FALLBACK.
    if (request.model) {
      startStream(request.model);
    } else {
      this.getUserPrefs().then((prefs) => {
        startStream(prefs.model || DEFAULT_MODEL_FALLBACK);
      }).catch(() => {
        startStream(DEFAULT_MODEL_FALLBACK);
      });
    }

    return () => { isClosed = true; cancelStream?.(); };
  }

  /**
   * Reconnect to an existing agent session stream without spawning a new agent.
   * Uses GET /api/agent/stream/:sid?replay=true&last_id=<cursor>
   * Safe to call on transient disconnect — will not duplicate the agent run.
   */
  agentStreamReconnect(
    sessionId: string,
    lastEventId: string,
    callbacks: AgentCallbacks = {}
  ): () => void {
    const { onMessage, onError, onDone } = callbacks;
    const url = `${this.baseUrl}/api/agent/stream/${encodeURIComponent(sessionId)}?replay=true&last_id=${encodeURIComponent(lastEventId)}`;
    const hdrs = authHeaders({ Accept: "text/event-stream" });
    let isClosed = false;
    let buffer = "";
    let lastSeenId = "";

    const processLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (trimmed.startsWith("id: ")) { lastSeenId = trimmed.slice(4).trim(); return false; }
      if (!trimmed || !trimmed.startsWith("data: ")) return false;
      const data = trimmed.slice(6).trim();
      if (data === "[DONE]") { if (!isClosed) { isClosed = true; onDone?.(); } return true; }
      try {
        const event: AgentEvent = JSON.parse(data);
        if (lastSeenId) event._streamId = lastSeenId;
        onMessage?.(event);
      } catch {}
      return false;
    };

    const processChunk = (chunk: string) => {
      if (isClosed) return;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (processLine(line)) return;
      }
    };

    const flushBuffer = () => {
      if (buffer.trim()) {
        processLine(buffer);
        buffer = "";
      }
    };

    const cancel = streamGetWithXHR(
      url, hdrs,
      processChunk,
      () => {
        if (isClosed) return;
        flushBuffer();
        if (!isClosed) { isClosed = true; onDone?.(); }
      },
      (err) => {
        if (!isClosed) { isClosed = true; onError?.(err); }
      }
    );

    return () => { isClosed = true; cancel(); };
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
   * Uses Redis XRANGE replay (via /api/agent/stream-redis/:sessionId?last_id=...)
   * Uses XHR-based streaming for React Native compatibility.
   *
   * Returns a stop function. Call it to permanently stop reconnecting.
   */
  connectSessionSSE(
    sessionId: string,
    callbacks: AgentCallbacks & { onReconnect?: (attempt: number) => void } = {},
    initialLastEventId: string = "0"
  ): () => void {
    const { onMessage, onError, onDone, onReconnect } = callbacks;
    let stopped = false;
    let lastEventId = initialLastEventId;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let cancelCurrent: (() => void) | null = null;

    const stop = () => {
      stopped = true;
      cancelCurrent?.();
    };

    const processSSEBuffer = (buffer: string, remaining: string): { buffer: string; done: boolean } => {
      const lines = (buffer + remaining).split("\n");
      const newBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("id: ")) { lastEventId = trimmed.slice(4).trim(); continue; }
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") { onDone?.(); return { buffer: newBuffer, done: true }; }
        try {
          const event: AgentEvent = JSON.parse(data);
          onMessage?.(event);
        } catch {}
      }
      return { buffer: newBuffer, done: false };
    };

    const connect = () => {
      if (stopped) return;

      let buffer = "";
      let isDone = false;
      const url = `${this.baseUrl}/api/agent/stream-redis/${encodeURIComponent(sessionId)}?last_id=${encodeURIComponent(lastEventId)}`;

      cancelCurrent = streamGetWithXHR(
        url,
        authHeaders(),
        (chunk) => {
          if (stopped || isDone) return;
          const result = processSSEBuffer(buffer, chunk);
          buffer = result.buffer;
          if (result.done) { isDone = true; }
        },
        () => {
          if (stopped) return;
          if (!isDone) {
            if (buffer.trim()) processSSEBuffer(buffer, "");
            onDone?.();
          }
        },
        (err: Error) => {
          if (stopped) return;
          const status = (err.message || "").match(/HTTP (\d+)/)?.[1];
          if (status === "404") { onError?.(new Error(`Session ${sessionId} not found`)); return; }
          scheduleReconnect();
        }
      );
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        onError?.(new Error(`SSE: max reconnect attempts (${MAX_RETRIES}) exceeded`));
        return;
      }
      onReconnect?.(retryCount);
      const delay = Math.min(1500 * Math.pow(1.5, retryCount - 1), 30000);
      setTimeout(connect, delay);
    };

    connect();
    return stop;
  }

  /**
   * Get the running status of a session. Calls GET /api/sessions/:sessionId/status.
   * Used on app load to determine whether to reconnect to a live stream.
   */
  async getSessionStatus(sessionId: string): Promise<{
    session_id: string;
    exists: boolean;
    is_running: boolean;
    status: string;
    source?: string;
  }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/status`,
        { headers: authHeaders() }
      );
      if (!res.ok) return { session_id: sessionId, exists: false, is_running: false, status: "error" };
      return res.json();
    } catch {
      return { session_id: sessionId, exists: false, is_running: false, status: "error" };
    }
  }

  /**
   * Share or unshare a session. Calls POST /api/sessions/:sessionId/share.
   * Returns the share URL if is_shared=true, null otherwise.
   */
  async shareSession(sessionId: string, isShared: boolean): Promise<{ is_shared: boolean; share_url: string | null }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/share`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ is_shared: isShared }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Get share status for a session. Calls GET /api/sessions/:sessionId/share.
   */
  async getShareStatus(sessionId: string): Promise<{ is_shared: boolean; share_url: string | null }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/share`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
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

  // ─── MCP Config wrappers ─────────────────────────────────────────────────

  async getMcpConfig(): Promise<{ servers: McpServer[] }> {
    const res = await fetch(`${this.baseUrl}/api/mcp/config`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async addMcpConfig(server: McpServerInput): Promise<{ ok: boolean; server: McpServer }> {
    const res = await fetch(`${this.baseUrl}/api/mcp/config`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(server),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  async updateMcpConfig(name: string, updates: Partial<McpServerInput>): Promise<{ ok: boolean; updated: string }> {
    const res = await fetch(`${this.baseUrl}/api/mcp/config/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  async deleteMcpConfig(name: string): Promise<{ ok: boolean; deleted: string }> {
    const res = await fetch(`${this.baseUrl}/api/mcp/config/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  // ─── User preferences wrappers ───────────────────────────────────────────

  async getUserPrefs(): Promise<UserPrefs> {
    try {
      const res = await fetch(`${this.baseUrl}/api/user/prefs`, { headers: authHeaders() });
      if (!res.ok) return {};
      return res.json();
    } catch {
      return {};
    }
  }

  async updateUserPrefs(prefs: Partial<UserPrefs>): Promise<{ updated: Partial<UserPrefs> }> {
    const res = await fetch(`${this.baseUrl}/api/user/prefs`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(prefs),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  // ─── Agent session pause/resume wrappers ─────────────────────────────────

  async pauseAgentSession(sessionId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/pause`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async resumeAgentSession(sessionId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ─── Session rating wrappers ─────────────────────────────────────────────

  async rateSession(sessionId: string, rating: number): Promise<{ ok: boolean; rating: number }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/rating`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ rating }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getSessionRating(sessionId: string): Promise<{ rating: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/rating`, {
        headers: authHeaders(),
      });
      if (!res.ok) return { rating: 0 };
      return res.json();
    } catch {
      return { rating: 0 };
    }
  }
}

export const apiService = new ApiService();

export function getApiBaseUrl(): string {
  const resolved = getApiUrl();
  return resolved.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
}
