import { useState, useCallback, useRef } from "react";
import { apiService, ChatMessage, ChatResponse, AgentEvent } from "./api-service";
import { getToolActionVerb } from "./tool-constants";

export interface Message {
  id: string;
  type: "user" | "assistant" | "tool" | "step" | "thinking" | "title";
  content: string;
  timestamp: Date;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolCallId?: string;
  toolStatus?: "calling" | "called" | "error";
  isLoading?: boolean;
}

export interface VncInfo {
  vncUrl: string;
  sandboxId: string;
  e2bSessionId: string;
}

export function useChat(onVncUrl?: (info: VncInfo) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  }, []);

  const sendMessage = useCallback(
    async (text: string, useAgent: boolean = false, attachments: any[] = []) => {
      if (!text.trim() && attachments.length === 0) return;

      setError(null);

      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        type: "user",
        content: text,
        timestamp: new Date(),
      };
      addMessage(userMessage);

      if (isWaitingForUser && sessionIdRef.current) {
        setIsWaitingForUser(false);
        setIsLoading(true);
        try {
          await handleAgentChat(text, sessionIdRef.current, true, attachments);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          setError(errorMsg);
          console.error("Chat error:", err);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);

      try {
        if (useAgent) {
          await handleAgentChat(text, undefined, false, attachments);
        } else {
          await handleSimpleChat(text);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        console.error("Chat error:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [addMessage, isWaitingForUser]
  );

  const handleSimpleChat = useCallback(
    async (text: string) => {
      const chatMessages: ChatMessage[] = [
        ...messages
          .filter((m) => m.type === "user" || m.type === "assistant")
          .map((m) => ({
            role: m.type === "user" ? ("user" as const) : ("assistant" as const),
            content: m.content,
          })),
        { role: "user" as const, content: text },
      ];

      try {
        const response = await apiService.chat(chatMessages);

        if (response.type === "message" && response.content) {
          const assistantMessage: Message = {
            id: `msg-${Date.now()}`,
            type: "assistant",
            content: response.content,
            timestamp: new Date(response.timestamp || new Date()),
          };
          addMessage(assistantMessage);
        }
      } catch (error) {
        throw error;
      }
    },
    [messages, addMessage]
  );

  const handleAgentChat = useCallback(
    async (text: string, existingSessionId?: string, isContinuation?: boolean, attachments?: any[]) => {
      return new Promise<void>((resolve, reject) => {
        const onEvent = (event: AgentEvent) => {
          if (event.type === "session") {
            if (event.session_id) {
              sessionIdRef.current = event.session_id;
              setSessionId(event.session_id);
            }
          } else if (event.type === "done" && event.session_id) {
            sessionIdRef.current = event.session_id;
            setSessionId(event.session_id);
          } else if (event.type === "waiting_for_user" || event.type === "ask") {
            setIsWaitingForUser(true);
            setIsLoading(false);
          } else if (event.type === "message" || event.type === "message_start") {
            const assistantMessage: Message = {
              id: `msg-${Date.now()}`,
              type: "assistant",
              content: event.content || event.message || "",
              timestamp: new Date(event.timestamp || new Date()),
              isLoading: event.type === "message_start",
            };
            addMessage(assistantMessage);
          } else if (event.type === "message_chunk") {
            // Append chunk to the last assistant message
            setMessages((prev) => {
              const lastIdx = prev.length - 1;
              if (lastIdx >= 0 && prev[lastIdx].type === "assistant") {
                const updated = [...prev];
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + (event.chunk || event.content || ""),
                  isLoading: true,
                };
                return updated;
              }
              return prev;
            });
          } else if (event.type === "message_end") {
            // Mark last assistant message as done streaming
            setMessages((prev) => {
              const lastIdx = prev.length - 1;
              if (lastIdx >= 0 && prev[lastIdx].type === "assistant") {
                const updated = [...prev];
                updated[lastIdx] = { ...updated[lastIdx], isLoading: false };
                return updated;
              }
              return prev;
            });
          } else if (event.type === "tool") {
            const fnName = event.function_name || event.tool_name || "";
            const label = getToolActionVerb(fnName);
            const toolStatus = (event.status as "calling" | "called" | "error") || "calling";
            const toolMessage: Message = {
              id: event.tool_call_id || `msg-${Date.now()}`,
              type: "tool",
              content: label,
              timestamp: new Date(event.timestamp || new Date()),
              toolName: fnName,
              toolArgs: event.function_args,
              toolCallId: event.tool_call_id,
              toolStatus,
              isLoading: toolStatus === "calling",
            };
            // If this tool_call_id already exists, update instead of adding
            if (event.tool_call_id) {
              setMessages((prev) => {
                const existingIdx = prev.findIndex((m) => m.id === event.tool_call_id);
                if (existingIdx >= 0) {
                  const updated = [...prev];
                  updated[existingIdx] = {
                    ...updated[existingIdx],
                    ...toolMessage,
                  };
                  return updated;
                }
                return [...prev, toolMessage];
              });
            } else {
              addMessage(toolMessage);
            }
          } else if (event.type === "tool_stream") {
            // Update the corresponding tool message with streaming content
            if (event.tool_call_id) {
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === event.tool_call_id);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    content: event.content || updated[idx].content,
                    isLoading: true,
                  };
                  return updated;
                }
                return prev;
              });
            }
          } else if (event.type === "step") {
            const stepMessage: Message = {
              id: `msg-${Date.now()}`,
              type: "step",
              content: event.content || "Processing...",
              timestamp: new Date(event.timestamp || new Date()),
              isLoading: true,
            };
            addMessage(stepMessage);
          } else if (event.type === "thinking") {
            const thinkingMessage: Message = {
              id: `msg-thinking-${Date.now()}`,
              type: "thinking",
              content: event.thinking || event.content || "",
              timestamp: new Date(event.timestamp || new Date()),
              isLoading: true,
            };
            addMessage(thinkingMessage);
          } else if (event.type === "title") {
            // Title events can be used for display purposes
            if (event.title) {
              const titleMessage: Message = {
                id: `msg-title-${Date.now()}`,
                type: "title",
                content: event.title,
                timestamp: new Date(event.timestamp || new Date()),
              };
              addMessage(titleMessage);
            }
          } else if (event.type === "notify") {
            const notifyMessage: Message = {
              id: `msg-notify-${Date.now()}`,
              type: "assistant",
              content: event.content || event.message || "",
              timestamp: new Date(event.timestamp || new Date()),
            };
            addMessage(notifyMessage);
          } else if (event.type === "vnc_stream_url") {
            if (onVncUrl && event.vnc_url) {
              onVncUrl({
                vncUrl: event.vnc_url,
                sandboxId: event.sandbox_id || "",
                e2bSessionId: event.e2b_session_id || "",
              });
            }
          } else if (event.type === "todo_update") {
            // todo_update events are informational — no UI message needed,
            // frontend can poll /api/sessions/:id/todos for the latest state
          } else if (event.type === "task_update") {
            // task_update events are informational — no UI message needed,
            // frontend can poll /api/sessions/:id/tasks for the latest state
          } else if (event.type === "error") {
            setError(event.error || "An error occurred");
          }
        };

        const onError = (error: Error) => {
          setError(error.message);
          reject(error);
        };

        const onComplete = () => {
          resolve();
        };

        try {
          apiService.agent(
            {
              message: text,
              messages: [],
              attachments: attachments || [],
              session_id: existingSessionId || undefined,
              is_continuation: isContinuation || false,
            },
            { onMessage: onEvent, onError, onDone: onComplete }
          ).then((cancel) => {
            cancelRef.current = cancel;
          });
        } catch (error) {
          reject(error);
        }
      });
    },
    [addMessage]
  );

  const stop = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    isWaitingForUser,
    error,
    sendMessage,
    stop,
    clear,
    addMessage,
    updateMessage,
    sessionId,
  };
}
