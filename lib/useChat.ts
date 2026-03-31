import { useState, useCallback, useRef } from "react";
import { apiService, ChatMessage, ChatResponse, AgentEvent } from "./api-service";
import { getToolActionVerb } from "./tool-constants";
import {
  processAgentEvent,
  applyEventToFlatMessages,
  FlatMessage,
  FlatChatReducerCallbacks,
} from "./agent-event-processor";

// Re-export FlatMessage as Message for backward-compat with existing consumers.
export type Message = FlatMessage;

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
    (text: string) => {
      return new Promise<void>((resolve, reject) => {
        const chatMessages: ChatMessage[] = [
          ...messages
            .filter((m) => m.type === "user" || m.type === "assistant")
            .map((m) => ({
              role: m.type === "user" ? ("user" as const) : ("assistant" as const),
              content: m.content,
            })),
          { role: "user" as const, content: text },
        ];

        const msgId = `msg-${Date.now()}`;
        let assistantContent = "";

        const onMessage = (event: AgentEvent) => {
          const chunkText = event.chunk || (event.type === "message_chunk" ? event.content : null);
          if (event.type === "message_chunk" && chunkText) {
            assistantContent += chunkText;
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === msgId);
              if (existing) {
                return prev.map((m) =>
                  m.id === msgId ? { ...m, content: assistantContent } : m
                );
              }
              return [...prev, {
                id: msgId,
                type: "assistant" as const,
                content: assistantContent,
                timestamp: new Date(),
              }];
            });
          } else if (event.type === "message_start") {
            assistantContent = "";
          }
        };

        const onDone = () => {
          if (assistantContent) {
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === msgId);
              if (!existing && assistantContent) {
                return [...prev, {
                  id: msgId,
                  type: "assistant" as const,
                  content: assistantContent,
                  timestamp: new Date(),
                }];
              }
              return prev;
            });
          }
          resolve();
        };

        const onError = (error: Error) => {
          reject(error);
        };

        apiService.chat(chatMessages, { onMessage, onDone, onError }).then((cancel) => {
          cancelRef.current = cancel;
        }).catch(reject);
      });
    },
    [messages, setMessages]
  );

  // Build the callbacks for the shared reducer once, stable via useCallback
  const reducerCallbacks = useCallback((): FlatChatReducerCallbacks => ({
    onSessionId: (id) => { sessionIdRef.current = id; setSessionId(id); },
    onWaitingForUser: () => { setIsWaitingForUser(true); setIsLoading(false); },
    onPlan: (plan) => {
      if (plan) {
        setAgentPlan({
          title: plan.title,
          steps: (plan.steps || []).map((s: any) => ({ id: s.id, title: s.title || s.description || "", status: s.status })),
          status: plan.status,
        });
      }
    },
    onVncUrl: (vncUrl, sandboxId, e2bSessionId) => {
      onVncUrl?.({ vncUrl, sandboxId, e2bSessionId });
    },
    onScreenshot: (screenshotB64, url, title) => {
      onBrowserEvent?.({ screenshot_b64: screenshotB64, url: url || "", title: title || "" });
    },
    onFiles: (files) => {
      const newFiles: AgentFile[] = files.map((f) => ({ name: f.filename || "", path: f.sandbox_path || "", mime_type: f.mime, download_url: f.download_url || "" }));
      setAgentFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        return [...prev, ...newFiles.filter((f) => !existing.has(f.path))];
      });
    },
    onError: (message) => setError(message),
  }), [onVncUrl, onBrowserEvent]);

  // Dispatch one agent event through the shared flat-message reducer
  const handleNormalizedEvent = useCallback(
    (ev: ReturnType<typeof processAgentEvent>) => {
      setMessages((prev) => applyEventToFlatMessages(prev, ev, streamingMsgIdRef, getToolActionVerb, reducerCallbacks()));
    },
    [reducerCallbacks]
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
