import { useState, useCallback, useRef, useEffect } from "react";
import { apiService, ChatMessage, ChatResponse, AgentEvent, getStoredToken } from "./api-service";
import { getToolActionVerb } from "./tool-constants";
import {
  processAgentEvent,
  applyEventToFlatMessages,
  FlatMessage,
  FlatChatReducerCallbacks,
  AgentPhase,
} from "./agent-event-processor";

// Re-export FlatMessage as Message for backward-compat with existing consumers.
export type Message = FlatMessage;
export type { AgentPhase };

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
  initialSessionId?: string,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentFiles, setAgentFiles] = useState<AgentFile[]>([]);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("IDLE");
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const currentStepIdRef = useRef<string | null>(null);
  const historyLoadedForSessionRef = useRef<string | null>(null);
  const liveStartedRef = useRef<boolean>(false);

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

        cancelRef.current = apiService.chat(chatMessages, { onMessage, onDone, onError });
      });
    },
    [messages, setMessages]
  );

  // Stable callbacks ref — updated on every render so callbacks always close over fresh state setters.
  // Using a ref avoids stale closures while keeping applyEventToFlatMessages call stable (no dep array churn).
  const reducerCallbacksRef = useRef<FlatChatReducerCallbacks>({});
  reducerCallbacksRef.current = {
    onSessionId: (id) => { sessionIdRef.current = id; setSessionId(id); },
    onWaitingForUser: () => { setIsWaitingForUser(true); setIsLoading(false); },
    onPlan: (plan, status) => {
      if (plan) {
        setAgentPlan({
          title: plan.title,
          steps: (plan.steps || []).map((s: any) => ({ id: s.id, title: s.title || s.description || "", status: s.status })),
          status: plan.status || status,
        });
      }
      if (status === "created") {
        setAgentPhase("PLANNING");
      } else if (status === "updated") {
        setAgentPhase("UPDATING");
      } else if (status === "completed") {
        setAgentPhase("IDLE");
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
    onError: (message) => {
      setError(message);
      setIsLoading(false);
      setAgentPhase("IDLE");
    },
    onDone: () => {
      setIsLoading(false);
      setAgentPhase("IDLE");
      setAgentPlan(prev => {
        if (!prev) return prev;
        const allDone = prev.steps.every(s => s.status === "completed" || s.status === "failed");
        if (allDone) return prev;
        return {
          ...prev,
          status: "completed",
          steps: prev.steps.map(s =>
            s.status !== "completed" && s.status !== "failed"
              ? { ...s, status: "completed" }
              : s
          ),
        };
      });
    },
    onPhaseChange: (phase) => {
      setAgentPhase(phase);
    },
    onSummarize: () => {
      setAgentPhase("SUMMARIZING");
    },
  };

  // Dispatch one agent event through the shared flat-message reducer.
  // Uses reducerCallbacksRef so it always reads the latest callbacks without re-creating handleNormalizedEvent.
  const handleNormalizedEvent = useCallback(
    (ev: ReturnType<typeof processAgentEvent>) => {
      setMessages((prev) => applyEventToFlatMessages(prev, ev, streamingMsgIdRef, getToolActionVerb, reducerCallbacksRef.current, currentStepIdRef));
    },
    [] // stable — reducerCallbacksRef always points to current callbacks
  );

  const handleAgentChat = useCallback(
    async (text: string, existingSessionId?: string, isContinuation?: boolean, attachments?: any[], currentMessages?: Message[]) => {
      return new Promise<void>((resolve, reject) => {
        liveStartedRef.current = true;
        setAgentPhase("PLANNING");

        const onEvent = (event: AgentEvent) => {
          handleNormalizedEvent(processAgentEvent(event));
        };

        const onError = (error: Error) => {
          setError(error.message);
          setIsLoading(false);
          setAgentPhase("IDLE");
          reject(error);
        };

        const onComplete = () => {
          setIsLoading(false);
          setAgentPhase("IDLE");
          resolve();
        };

        try {
          const historyMessages = (currentMessages || [])
            .filter((m) => m.type === "user" || m.type === "assistant")
            .map((m) => ({
              role: m.type === "user" ? ("user" as const) : ("assistant" as const),
              content: m.content,
            }));

          cancelRef.current = apiService.agent(
            {
              message: text,
              messages: historyMessages,
              attachments: attachments || [],
              session_id: existingSessionId || undefined,
              is_continuation: isContinuation || false,
            },
            { onMessage: onEvent, onError, onDone: onComplete }
          );
        } catch (error) {
          reject(error);
        }
      });
    },
    [handleNormalizedEvent]
  );

  /**
   * Load historical messages for an existing session from the backend.
   * Call this when reopening a session. Will not conflict with live events since
   * it sets messages before any SSE stream is started.
   */
  const loadSessionHistory = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const baseUrl = apiService["baseUrl"] as string;
      const token = getStoredToken();
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sid)}/messages`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        historyLoadedForSessionRef.current = sid;
        setIsHistoryLoaded(true);
        return;
      }
      const data = await res.json();
      historyLoadedForSessionRef.current = sid;
      setIsHistoryLoaded(true);
      // Guard: if live streaming or user interaction has started, don't overwrite live state
      if (liveStartedRef.current) return;
      if (!Array.isArray(data.messages) || data.messages.length === 0) return;
      const restored: Message[] = data.messages
        .filter((m: any) => m.role && m.content)
        .map((m: any) => ({
          id: m.id || `hist-${Date.now()}-${Math.random()}`,
          type: (m.role === "user" ? "user" : "assistant") as Message["type"],
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          isLoading: false,
        }));
      if (restored.length > 0 && !liveStartedRef.current) {
        sessionIdRef.current = sid;
        setSessionId(sid);
        setMessages(prev => (prev.length === 0 ? restored : prev));
      }
    } catch {
      historyLoadedForSessionRef.current = sid;
      setIsHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!initialSessionId || historyLoadedForSessionRef.current === initialSessionId) return;
    loadSessionHistory(initialSessionId);
  }, [initialSessionId, loadSessionHistory]);

  const sendMessage = useCallback(
    async (text: string, useAgent: boolean = false, attachments: any[] = []) => {
      if (!text.trim() && attachments.length === 0) return;

      liveStartedRef.current = true;
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
    currentStepIdRef.current = null;
    setIsLoading(false);
    setAgentPhase("IDLE");
  }, []);

  const clear = useCallback(() => {
    streamingMsgIdRef.current = null;
    currentStepIdRef.current = null;
    historyLoadedForSessionRef.current = null;
    liveStartedRef.current = false;
    setMessages([]);
    setError(null);
    setAgentPlan(null);
    setAgentFiles([]);
    setAgentPhase("IDLE");
    setIsHistoryLoaded(false);
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
    agentPhase,
    isHistoryLoaded,
    loadSessionHistory,
  };
}
