import { useState, useCallback, useRef } from "react";
import { apiService, ChatMessage, ChatResponse, AgentEvent } from "./api-service";

export interface Message {
  id: string;
  type: "user" | "assistant" | "tool" | "step";
  content: string;
  timestamp: Date;
  toolName?: string;
  toolArgs?: Record<string, any>;
  isLoading?: boolean;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    async (text: string, useAgent: boolean = false) => {
      if (!text.trim()) return;

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
          await handleAgentChat(text, sessionIdRef.current, true);
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
          await handleAgentChat(text);
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
    async (text: string, existingSessionId?: string, isContinuation?: boolean) => {
      return new Promise<void>((resolve, reject) => {
        const onEvent = (event: AgentEvent) => {
          if (event.type === "session") {
            if (event.session_id) {
              sessionIdRef.current = event.session_id;
            }
            console.log("Session:", event.session_id);
          } else if (event.type === "done" && event.session_id) {
            sessionIdRef.current = event.session_id;
          } else if (event.type === "waiting_for_user") {
            setIsWaitingForUser(true);
            setIsLoading(false);
          } else if (event.type === "message") {
            const assistantMessage: Message = {
              id: `msg-${Date.now()}`,
              type: "assistant",
              content: event.content || "",
              timestamp: new Date(event.timestamp || new Date()),
            };
            addMessage(assistantMessage);
          } else if (event.type === "tool") {
            const toolMessage: Message = {
              id: `msg-${Date.now()}`,
              type: "tool",
              content: event.tool_name || "Tool",
              timestamp: new Date(event.timestamp || new Date()),
              toolName: event.tool_name,
              toolArgs: event.function_args,
              isLoading: true,
            };
            addMessage(toolMessage);
          } else if (event.type === "step") {
            const stepMessage: Message = {
              id: `msg-${Date.now()}`,
              type: "step",
              content: event.content || "Processing...",
              timestamp: new Date(event.timestamp || new Date()),
              isLoading: true,
            };
            addMessage(stepMessage);
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
  };
}
