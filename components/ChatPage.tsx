import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ChatMessage as MessageComponent } from "./ChatMessage";
import { ChatBox } from "./ChatBox";
import { AgentThinking } from "./AgentThinking";
import { apiService, AgentEvent, ChatMessage as ApiChatMessage } from "../lib/api-service";
import { randomUUID } from "expo-crypto";

interface AgentPlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

interface AgentPlan {
  title: string;
  steps: AgentPlanStep[];
  status: "pending" | "running" | "completed" | "failed";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "ask";
  content: string;
  timestamp: number;
  plan?: AgentPlan;
  isStreaming?: boolean;
  error?: string;
  attachments?: any[];
}

export interface VncSessionInfo {
  sandboxId: string;
  vncUrl: string;
  e2bSessionId?: string;
}

interface ChatPageProps {
  sessionId?: string;
  isLeftPanelShow?: boolean;
  onToggleLeftPanel?: () => void;
  onToolsChange?: (tools: any[]) => void;
  onVncSessionChange?: (info: VncSessionInfo | null) => void;
}

export function ChatPage({
  sessionId: externalSessionId,
  isLeftPanelShow,
  onToggleLeftPanel,
  onToolsChange,
  onVncSessionChange,
}: ChatPageProps = {}) {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  const isAgentMode = mode === "agent";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [thinking, setThinking] = useState({ active: false, label: "", stepLabel: "" as string | undefined });
  const [tools, setTools] = useState<any[]>([]);
  const [stepHistory, setStepHistory] = useState<string[]>([]);
  const [title, setTitle] = useState(isAgentMode ? "Dzeck Agent" : "Dzeck Chat");
  const [attachments, setAttachments] = useState<any[]>([]);

  const flatListRef = useRef<FlatList>(null);
  const activeSessionIdRef = useRef<string>(externalSessionId || randomUUID());
  const planMsgIdRef = useRef<string | null>(null);
  const currentPlanRef = useRef<AgentPlan | null>(null);
  const isWaitingRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");

  useEffect(() => {
    if (flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, streamingContent, isLoading]);

  // Sync session when externalSessionId changes (e.g. sidebar session switch)
  useEffect(() => {
    if (externalSessionId && externalSessionId !== activeSessionIdRef.current) {
      if (cancelRef.current) {
        cancelRef.current();
        cancelRef.current = null;
      }
      activeSessionIdRef.current = externalSessionId;
      setMessages([]);
      setTools([]);
      setStepHistory([]);
      planMsgIdRef.current = null;
      currentPlanRef.current = null;
      streamingMsgIdRef.current = null;
      setStreamingContent('');
      setThinking({ active: false, label: '', stepLabel: undefined });
      setIsLoading(false);
      setIsWaitingForUser(false);
      isWaitingRef.current = false;
    }
  }, [externalSessionId]);

  // Propagate tools changes to parent layout
  useEffect(() => {
    onToolsChange?.(tools);
  }, [tools, onToolsChange]);

  const handleEvent = useCallback((event: AgentEvent) => {
    const { type } = event;

    if (type === "session" && event.session_id) {
      activeSessionIdRef.current = event.session_id;
      return;
    }

    if (type === "plan") {
      const planData = event.plan as AgentPlan | undefined;
      const planStatus = event.status as string;

      if (planData && !planMsgIdRef.current) {
        // First time plan is created
        const planMsgId = `plan_${Date.now()}`;
        planMsgIdRef.current = planMsgId;
        currentPlanRef.current = planData;
        const planMsg: ChatMessage = {
          id: planMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          plan: planData,
        };
        setMessages(prev => [...prev, planMsg]);
        setThinking({ active: true, label: planData.title || "Membuat rencana...", stepLabel: planData.title });
      } else if (planData && planMsgIdRef.current) {
        // Update existing plan card
        currentPlanRef.current = planData;
        setMessages(prev => prev.map(m =>
          m.id === planMsgIdRef.current ? { ...m, plan: planData } : m
        ));
        if (planStatus === "completed") {
          setThinking({ active: false, label: "" });
        }
      } else if (!planData) {
        setThinking({ active: true, label: "Membuat rencana...", stepLabel: event.plan?.title });
      }
      return;
    }

    if (type === "step") {
      const step = event.step as AgentPlanStep | undefined;
      const status = event.status;

      if (step && planMsgIdRef.current && currentPlanRef.current) {
        const updatedSteps = currentPlanRef.current.steps.map(s =>
          s.id === step.id ? { ...s, ...step } : s
        );
        const updatedPlan: AgentPlan = { ...currentPlanRef.current, steps: updatedSteps };
        currentPlanRef.current = updatedPlan;
        setMessages(prev => prev.map(m =>
          m.id === planMsgIdRef.current ? { ...m, plan: updatedPlan } : m
        ));
      }

      if (status === "running" && step?.description) {
        setStepHistory(prev => {
          if (prev.length > 0 && prev[prev.length - 1] === step.description) return prev;
          return [...prev, step.description];
        });
        setThinking({ active: true, label: step.description, stepLabel: step.description });
      } else if (status === "completed" || status === "failed") {
        setThinking({ active: true, label: "Menyelesaikan langkah..." });
      }
      return;
    }

    if (type === "tool_stream") {
      const callId = event.tool_call_id || "";
      const chunk = event.chunk || "";
      if (callId && chunk) {
        setTools(prev => {
          const idx = prev.findIndex(t => t.tool_call_id === callId);
          if (idx >= 0) {
            const updated = [...prev];
            const existing = updated[idx].output || "";
            updated[idx] = { ...updated[idx], output: existing + chunk };
            return updated;
          }
          return prev;
        });
      }
      return;
    }

    if (type === "tool") {
      const toolName = event.tool_name || event.function_name || "tool";
      const functionName = event.function_name || event.tool_name || "";
      const callId = event.tool_call_id || `tool_${Date.now()}`;
      const status = event.status as "calling" | "called" | "error";

      const toolLabels: Record<string, string> = {
        browser: "Membuka browser",
        shell: "Menjalankan perintah",
        file: "Membaca file",
        search: "Mencari informasi",
        mcp: "Memanggil MCP",
        todo: "Mengatur todo",
        task: "Mengelola tugas",
        message: "Mengirim pesan",
      };
      const thinkLabel = toolLabels[toolName] || `Menggunakan ${toolName}`;

      if (status === "calling") {
        setThinking({ active: true, label: thinkLabel });
        setTools(prev => {
          const idx = prev.findIndex(t => t.tool_call_id === callId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: "calling", function_name: functionName };
            return updated;
          }
          return [...prev, {
            tool_call_id: callId,
            name: toolName,
            function_name: functionName,
            status: "calling",
            input: event.function_args,
          }];
        });
      } else if (status === "called") {
        setTools(prev => {
          const idx = prev.findIndex(t => t.tool_call_id === callId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              status: "called",
              function_name: functionName,
              output: event.function_result,
              tool_content: event.tool_content,
            };
            return updated;
          }
          return prev;
        });
      } else if (status === "error") {
        setTools(prev => {
          const idx = prev.findIndex(t => t.tool_call_id === callId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: "error", function_name: functionName, error: event.function_result };
            return updated;
          }
          return prev;
        });
      }
      return;
    }

    if (type === "waiting_for_user") {
      isWaitingRef.current = true;
      setIsWaitingForUser(true);
      setThinking({ active: false, label: "" });
      return;
    }

    if (type === "message_start") {
      const role = event.role === "ask" ? "ask" as const : "assistant" as const;
      const newId = `msg_${Date.now()}_stream`;
      streamingMsgIdRef.current = newId;
      setStreamingContent("");
      if (role === "ask") {
        setThinking({ active: true, label: "AI mengajukan pertanyaan..." });
      } else {
        setThinking({ active: false, label: "" });
      }
      const msg: ChatMessage = {
        id: newId,
        role,
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      };
      setMessages(prev => [...prev, msg]);
      return;
    }

    if (type === "message_chunk") {
      const chunk = event.chunk || event.content || "";
      if (chunk) {
        setStreamingContent(prev => prev + chunk);
        if (streamingMsgIdRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === streamingMsgIdRef.current
              ? { ...m, content: m.content + chunk }
              : m
          ));
        } else {
          const newId = `msg_${Date.now()}_stream`;
          streamingMsgIdRef.current = newId;
          setThinking({ active: false, label: "" });
          setMessages(prev => [...prev, {
            id: newId,
            role: "assistant",
            content: chunk,
            timestamp: Date.now(),
            isStreaming: true,
          }]);
        }
      }
      return;
    }

    if (type === "message_end" || type === "done") {
      if (streamingMsgIdRef.current) {
        const isAskEnd = event.role === "ask";
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgIdRef.current
            ? { ...m, isStreaming: false }
            : m
        ));
        streamingMsgIdRef.current = null;
        setStreamingContent("");
        if (isAskEnd) {
          setThinking({ active: false, label: "" });
        }
      }
      if (type === "done") {
        setThinking({ active: false, label: "" });
        setIsLoading(false);
      }
      return;
    }

    if (type === "message") {
      const content = event.content || event.message || "";
      if (!content) return;
      setThinking({ active: false, label: "" });
      const msg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, msg]);
      return;
    }

    if (type === "title" && event.title) {
      setTitle(event.title);
      return;
    }

    if (type === "thinking" && event.thinking) {
      setThinking({ active: true, label: event.thinking });
      return;
    }

    if (type === "message_correct") {
      const correctedText = event.text || "";
      if (correctedText && streamingMsgIdRef.current) {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgIdRef.current
            ? { ...m, content: correctedText }
            : m
        ));
      }
      return;
    }

    if (type === "notify") {
      const notifyText = event.text || event.message || "";
      if (notifyText) {
        setThinking({ active: true, label: notifyText });
      }
      return;
    }

    if (type === "files") {
      const files = event.files as Array<{ filename: string; download_url: string; mime?: string }> | undefined;
      if (files && files.length > 0) {
        const fileList = files.map(f => `📎 [${f.filename}](${f.download_url})`).join("\n");
        const fileMsg: ChatMessage = {
          id: `msg_${Date.now()}_files`,
          role: "assistant",
          content: "File yang dibuat:\n" + fileList,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, fileMsg]);
      }
      return;
    }

    // Handle VNC stream URL from agent sandbox — notify parent to show desktop
    if (type === "vnc_stream_url") {
      const vncUrl = event.vnc_url || "";
      const sandboxId = event.sandbox_id || "";
      const e2bSessionId = event.e2b_session_id || "";
      if (vncUrl && sandboxId) {
        onVncSessionChange?.({
          sandboxId,
          vncUrl,
          e2bSessionId,
        });
      }
      return;
    }

    if (type === "error") {
      setThinking({ active: false, label: "" });
      const errMsg: ChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        error: event.error || "Terjadi kesalahan",
      };
      setMessages(prev => [...prev, errMsg]);
      setIsLoading(false);
      return;
    }
  }, [onVncSessionChange]);

  const handleSubmit = useCallback(async () => {
    if (!inputMessage.trim()) return;

    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: inputMessage.trim(),
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const wasContinuation = isWaitingForUser;

    setMessages(prev => [...prev, userMsg]);
    const msgText = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);
    isWaitingRef.current = false;
    setIsWaitingForUser(false);
    setTools([]);
    if (!wasContinuation) {
      setStepHistory([]);
      planMsgIdRef.current = null;
      currentPlanRef.current = null;
    }
    setThinking({ active: true, label: isAgentMode ? "Dzeck sedang berpikir..." : "Memikirkan jawaban..." });

    try {
      if (isAgentMode) {
        const historyMsgs = messages.map(m => ({
          role: m.role === "ask" ? "assistant" as const : m.role,
          content: m.content,
        }));

        const cancel = await apiService.agent(
          {
            message: msgText,
            messages: historyMsgs,
            model: "qwen-3-235b-a22b-instruct-2507",
            attachments: [],
            session_id: activeSessionIdRef.current,
            is_continuation: wasContinuation,
          },
          {
            onMessage: handleEvent,
            onError: (err) => handleEvent({ type: "error", error: err.message }),
            onDone: () => {
              handleEvent({ type: "done" });
              setIsLoading(false);
              cancelRef.current = null;
            },
          }
        );
        cancelRef.current = cancel;
      } else {
        const historyMsgs = messages.map(m => ({
          role: m.role === "ask" ? "assistant" as const : m.role,
          content: m.content,
        }));
        historyMsgs.push({ role: "user" as const, content: msgText });

        const cancel = await apiService.chat(
          { messages: historyMsgs },
          {
            onMessage: handleEvent,
            onError: (err) => handleEvent({ type: "error", error: err.message }),
            onDone: () => {
              handleEvent({ type: "message_end" });
              setIsLoading(false);
              cancelRef.current = null;
            },
          }
        );
        cancelRef.current = cancel;
      }
    } catch (err: any) {
      console.error("Submit error:", err);
      handleEvent({ type: "error", error: err.message });
    }
  }, [inputMessage, isAgentMode, messages, attachments, isWaitingForUser, handleEvent]);

  const handleStop = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsLoading(false);
    setThinking({ active: false, label: "" });
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageComponent
            message={item}
            tools={item.id === planMsgIdRef.current ? tools : undefined}
          />
        )}
        contentContainerStyle={styles.messageList}
        ListFooterComponent={
          thinking.active ? (
            <AgentThinking
              thinking={thinking.label}
            />
          ) : null
        }
      />

      <ChatBox
        value={inputMessage}
        onChangeText={setInputMessage}
        onSubmit={handleSubmit}
        onStop={handleStop}
        isLoading={isLoading}
        isWaitingForUser={isWaitingForUser}
        isAgentMode={isAgentMode}
        attachments={attachments}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#edebe3",
  },
  header: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#edebe3",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9d0",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1916",
  },
  messageList: {
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
});
