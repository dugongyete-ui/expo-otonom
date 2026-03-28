import { EventEmitter } from "events";

export interface AgentMessage {
  type:
    | "message"
    | "message_start"
    | "message_chunk"
    | "message_end"
    | "tool"
    | "tool_stream"
    | "step"
    | "thinking"
    | "title"
    | "plan"
    | "error"
    | "session"
    | "done"
    | "notify"
    | "vnc_stream_url"
    | "todo_update"
    | "task_update"
    | "waiting_for_user"
    | "ask";
  content?: string;
  chunk?: string;
  title?: string;
  thinking?: string;
  steps?: Array<{
    id: string;
    description: string;
    status: "pending" | "running" | "completed" | "failed";
  }>;
  tool_name?: string;
  function_name?: string;
  function_args?: any;
  tool_call_id?: string;
  tool_args?: any;
  tool_result?: any;
  status?: "pending" | "running" | "completed" | "failed" | "calling" | "called";
  step_id?: string;
  error?: string;
  session_id?: string;
  timestamp?: string;
  message?: string;
  vnc_url?: string;
  sandbox_id?: string;
  e2b_session_id?: string;
  todo_items?: Array<{ text: string; completed: boolean }>;
  tasks?: Array<{ id: string; description: string; status: string; result?: string }>;
}

export interface AgentRequest {
  message: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  attachments?: any[];
}

export interface AgentOptions {
  onMessage?: (message: AgentMessage) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
  onClose?: () => void;
}

export class AgentService extends EventEmitter {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    super();
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async runAgent(
    request: AgentRequest,
    options: AgentOptions = {}
  ): Promise<() => void> {
    const controller = new AbortController();

    try {
      const response = await fetch(`${this.apiUrl}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle SSE
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const processSSEMessage = (line: string): boolean => {
        if (!line.startsWith("data: ")) return false;
        const data = line.slice(6);
        if (data === "[DONE]") {
          options.onDone?.();
          return true;
        }
        try {
          const message = JSON.parse(data) as AgentMessage;
          options.onMessage?.(message);
          this.emit("message", message);
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
        return false;
      };

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // Process any remaining fragment in buffer
              if (buffer.trim()) {
                processSSEMessage(buffer.trim());
                buffer = "";
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            let stopped = false;
            for (const line of lines) {
              if (processSSEMessage(line)) { stopped = true; break; }
            }
            if (stopped) break;
          }
        } catch (error) {
          if (error instanceof Error && error.name !== "AbortError") {
            options.onError?.(error.message);
            this.emit("error", error);
          }
        } finally {
          options.onClose?.();
          this.emit("close");
        }
      };

      processStream();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      options.onError?.(errorMessage);
      this.emit("error", error);
    }

    // Return cancel function
    return () => {
      controller.abort();
    };
  }

  async chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<{ content: string; timestamp: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.content,
        timestamp: data.timestamp,
      };
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Failed to send message");
    }
  }

  async getSessions(): Promise<Array<{ session_id: string; title: string }>> {
    try {
      const response = await fetch(`${this.apiUrl}/api/sessions`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.sessions || [];
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
      return [];
    }
  }

  async getSession(sessionId: string): Promise<any> {
    try {
      const response = await fetch(`${this.apiUrl}/api/sessions/${sessionId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to fetch session:", error);
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }

  async deleteAllSessions(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/api/sessions`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to delete all sessions:", error);
    }
  }
}

// Export singleton instance
let agentService: AgentService | null = null;

export function initAgentService(apiUrl: string, apiKey: string) {
  agentService = new AgentService(apiUrl, apiKey);
  return agentService;
}

export function getAgentService(): AgentService {
  if (!agentService) {
    throw new Error("AgentService not initialized");
  }
  return agentService;
}
