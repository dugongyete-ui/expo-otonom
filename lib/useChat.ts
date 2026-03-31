import { useState, useCallback, useRef } from "react";
import { apiService, ChatMessage, ChatResponse, AgentEvent } from "./api-service";
import { getToolActionVerb } from "./tool-constants";
import { processAgentEvent, NormalizedEvent } from "./agent-event-processor";

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

export interface AgentPlan {
  title?: string;
  steps: Array<{ id?: string; title: string; status?: string }>;
  status?: string;
}

export interface AgentFile {
  name: string;
  path: string;
  size?: number;
  mime_type?: string;
  download_url?: string;
}

export interface VncInfo {
  vncUrl: string;
  sandboxId: string;
  e2bSessionId: string;
}

export interface BrowserEventInfo {
  screenshot_b64?: string;
  url?: string;
  title?: string;
}

export function useChat(
  onVncUrl?: (info: VncInfo) => void,
  onBrowserEvent?: (info: BrowserEventInfo) => void,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentFiles, setAgentFiles] = useState<AgentFile[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  }, []);

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

  /**
   * handleNormalizedEvent — processes a NormalizedEvent (from processAgentEvent)
   * and updates useChat state accordingly.
   * This is the single source of truth for event → state mapping in this hook.
   */
  const handleNormalizedEvent = useCallback(
    (ev: NormalizedEvent) => {
      switch (ev.kind) {
        case "session": {
          if (ev.sessionId) {
            sessionIdRef.current = ev.sessionId;
            setSessionId(ev.sessionId);
          }
          break;
        }

        case "done": {
          // session_id may be in the done event — already handled by session event
          break;
        }

        case "waiting_for_user": {
          setIsWaitingForUser(true);
          setIsLoading(false);
          break;
        }

        case "message_start": {
          const newMsgId = `msg-${Date.now()}`;
          streamingMsgIdRef.current = newMsgId;
          const assistantMessage: Message = {
            id: newMsgId,
            type: "assistant",
            content: ev.content,
            timestamp: new Date(),
            isLoading: true,
          };
          addMessage(assistantMessage);
          break;
        }

        case "message": {
          const assistantMessage: Message = {
            id: `msg-${Date.now()}`,
            type: "assistant",
            content: ev.content,
            timestamp: new Date(),
            isLoading: false,
          };
          addMessage(assistantMessage);
          break;
        }

        case "message_chunk": {
          const chunk = ev.chunk;
          if (chunk) {
            const currentId = streamingMsgIdRef.current;
            setMessages((prev) => {
              if (currentId) {
                const idx = prev.findIndex((m) => m.id === currentId);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    content: updated[idx].content + chunk,
                    isLoading: true,
                  };
                  return updated;
                }
              }
              const lastIdx = prev.length - 1;
              if (lastIdx >= 0 && prev[lastIdx].type === "assistant") {
                const updated = [...prev];
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + chunk,
                  isLoading: true,
                };
                return updated;
              }
              return prev;
            });
          }
          break;
        }

        case "message_end": {
          const currentId = streamingMsgIdRef.current;
          streamingMsgIdRef.current = null;
          setMessages((prev) => {
            if (currentId) {
              const idx = prev.findIndex((m) => m.id === currentId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], isLoading: false };
                return updated;
              }
            }
            const lastIdx = prev.length - 1;
            if (lastIdx >= 0 && prev[lastIdx].type === "assistant") {
              const updated = [...prev];
              updated[lastIdx] = { ...updated[lastIdx], isLoading: false };
              return updated;
            }
            return prev;
          });
          break;
        }

        case "tool": {
          const label = getToolActionVerb(ev.functionName);
          const toolMessage: Message = {
            id: ev.callId,
            type: "tool",
            content: label,
            timestamp: new Date(),
            toolName: ev.functionName,
            toolArgs: ev.args,
            toolCallId: ev.callId,
            toolStatus: ev.status,
            isLoading: ev.status === "calling",
          };
          setMessages((prev) => {
            const existingIdx = prev.findIndex((m) => m.id === ev.callId);
            if (existingIdx >= 0) {
              const updated = [...prev];
              updated[existingIdx] = { ...updated[existingIdx], ...toolMessage };
              return updated;
            }
            return [...prev, toolMessage];
          });
          break;
        }

        case "tool_stream": {
          if (ev.callId) {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === ev.callId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  content: updated[idx].content + ev.chunk,
                  isLoading: true,
                };
                return updated;
              }
              return prev;
            });
          }
          break;
        }

        case "step": {
          const stepContent =
            ev.step?.description ||
            ev.step?.title ||
            "Processing...";
          const stepMessage: Message = {
            id: `msg-${Date.now()}`,
            type: "step",
            content: stepContent,
            timestamp: new Date(),
            isLoading: true,
          };
          addMessage(stepMessage);
          break;
        }

        case "thinking": {
          const thinkingMessage: Message = {
            id: `msg-thinking-${Date.now()}`,
            type: "thinking",
            content: ev.text,
            timestamp: new Date(),
            isLoading: true,
          };
          addMessage(thinkingMessage);
          break;
        }

        case "title": {
          if (ev.title) {
            const titleMessage: Message = {
              id: `msg-title-${Date.now()}`,
              type: "title",
              content: ev.title,
              timestamp: new Date(),
            };
            addMessage(titleMessage);
          }
          break;
        }

        case "notify": {
          const notifyMessage: Message = {
            id: `msg-notify-${Date.now()}`,
            type: "assistant",
            content: ev.text,
            timestamp: new Date(),
          };
          addMessage(notifyMessage);
          break;
        }

        case "vnc_stream_url": {
          if (onVncUrl && ev.vncUrl) {
            onVncUrl({ vncUrl: ev.vncUrl, sandboxId: ev.sandboxId, e2bSessionId: ev.e2bSessionId });
          }
          break;
        }

        case "screenshot": {
          if (onBrowserEvent && ev.screenshotB64) {
            onBrowserEvent({
              screenshot_b64: ev.screenshotB64,
              url: ev.url || "",
              title: ev.title || "",
            });
          }
          break;
        }

        case "plan": {
          if (ev.plan) {
            setAgentPlan({
              title: ev.plan.title,
              steps: (ev.plan.steps || []).map((s: any) => ({
                id: s.id,
                title: s.title || s.description || "",
                status: s.status,
              })),
              status: ev.status || ev.plan.status,
            });
          }
          break;
        }

        case "message_correct": {
          if (ev.text) {
            setMessages((prev) => {
              const lastAssistantIdx = [...prev].reverse().findIndex((m) => m.type === "assistant");
              if (lastAssistantIdx >= 0) {
                const idx = prev.length - 1 - lastAssistantIdx;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], content: ev.text, isLoading: false };
                return updated;
              }
              return prev;
            });
          }
          break;
        }

        case "files": {
          if (ev.files.length > 0) {
            const newFiles: AgentFile[] = ev.files.map((f) => ({
              name: f.filename || "",
              path: f.sandbox_path || "",
              mime_type: f.mime,
              download_url: f.download_url || "",
            }));
            setAgentFiles((prev) => {
              const existingPaths = new Set(prev.map((f) => f.path));
              const unique = newFiles.filter((f) => !existingPaths.has(f.path));
              return [...prev, ...unique];
            });
          }
          break;
        }

        case "error": {
          setError(ev.message);
          break;
        }

        case "unknown":
        default:
          break;
      }
    },
    [addMessage, onVncUrl, onBrowserEvent]
  );

  const handleAgentChat = useCallback(
    async (text: string, existingSessionId?: string, isContinuation?: boolean, attachments?: any[], currentMessages?: Message[]) => {
      return new Promise<void>((resolve, reject) => {
        const onEvent = (event: AgentEvent) => {
          handleNormalizedEvent(processAgentEvent(event));
        };

        const onError = (error: Error) => {
          setError(error.message);
          reject(error);
        };

        const onComplete = () => {
          resolve();
        };

        try {
          const historyMessages = (currentMessages || [])
            .filter((m) => m.type === "user" || m.type === "assistant")
            .map((m) => ({
              role: m.type === "user" ? ("user" as const) : ("assistant" as const),
              content: m.content,
            }));

          apiService.agent(
            {
              message: text,
              messages: historyMessages,
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
    [handleNormalizedEvent]
  );

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
          await handleAgentChat(text, sessionIdRef.current, true, attachments, messages);
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
          await handleAgentChat(text, undefined, false, attachments, messages);
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
    [addMessage, isWaitingForUser, messages, handleAgentChat, handleSimpleChat]
  );

  const stop = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    streamingMsgIdRef.current = null;
    setIsLoading(false);
  }, []);

  const clear = useCallback(() => {
    streamingMsgIdRef.current = null;
    setMessages([]);
    setError(null);
    setAgentPlan(null);
    setAgentFiles([]);
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
    agentPlan,
    agentFiles,
  };
}
