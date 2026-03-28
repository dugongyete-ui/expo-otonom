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

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  }

  async chat(payload: ChatMessage[] | { messages: ChatMessage[] }): Promise<ChatResponse> {
    try {
      const messages = Array.isArray(payload) ? payload : payload.messages;
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Chat API error:", error);
      throw error;
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: request.message,
          messages: request.messages || [],
          model: request.model || "@cf/meta/llama-3.1-70b-instruct",
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

      const processStream = async () => {
        try {
          while (!isClosed) {
            const { done, value } = await reader!.read();

            if (done) {
              isClosed = true;
              onDone?.();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;

              const data = trimmed.slice(6);
              if (data === "[DONE]") {
                isClosed = true;
                onDone?.();
                return;
              }

              try {
                const event: AgentEvent = JSON.parse(data);
                onMessage?.(event);
              } catch (e) {
                console.error("Failed to parse SSE event:", e);
              }
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
      const response = await fetch(`${this.baseUrl}/api/sessions`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.sessions || [];
    } catch {
      return [];
    }
  }
}

export const apiService = new ApiService();
