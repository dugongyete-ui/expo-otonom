import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ChatMessageBubble } from "./ChatMessage";
import { ChatBox } from "./ChatBox";
import { AgentThinking, AgentWorking } from "./AgentThinking";
import { AgentPlanView } from "./AgentPlanView";
import { apiService, type AgentEvent } from "@/lib/api-service";
import type { ChatMessage, ChatAttachment, AgentPlan, AgentPlanStep } from "@/lib/chat";

interface ToolItem {
  tool_call_id: string;
  name: string;
  status: "calling" | "called" | "error";
  input?: any;
  output?: string;
  error?: string;
  tool_content?: any;
}

interface ChatPageProps {
  sessionId?: string;
  isLeftPanelShow: boolean;
  onToggleLeftPanel: () => void;
  onToolsChange?: (tools: ToolItem[]) => void;
}

type ThinkingState = {
  active: boolean;
  label: string;
  stepLabel?: string;
};

export function ChatPage({
  sessionId,
  isLeftPanelShow,
  onToggleLeftPanel,
  onToolsChange,
}: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [title, setTitle] = useState("New Chat");
  const [attachments] = useState<ChatAttachment[]>([]);
  const [follow, setFollow] = useState(true);
  const [isAgentMode, setIsAgentMode] = useState(true);
  const [thinking, setThinking] = useState<ThinkingState>({ active: false, label: "" });
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [stepHistory, setStepHistory] = useState<string[]>([]);

  const flatListRef = useRef<FlatList>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const isWaitingRef = useRef(false);
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolsRef = useRef<ToolItem[]>([]);
  const planMsgIdRef = useRef<string | null>(null);
  const currentPlanRef = useRef<AgentPlan | null>(null);
  const activeSessionIdRef = useRef<string | undefined>(sessionId);

  useEffect(() => {
    toolsRef.current = tools;
    onToolsChange?.(tools);
  }, [tools, onToolsChange]);

  useEffect(() => {
    if (follow && (messages.length > 0 || thinking.active)) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  }, [messages, thinking, follow, streamingContent]);

  const handleEvent = useCallback((event: AgentEvent) => {
    const type = event.type;

    if (type === "session") {
      if (event.session_id) {
        activeSessionIdRef.current = event.session_id;
      }
      return;
    }

    if (type === "plan") {
      const planStatus = event.status;
      const planData = event.plan as AgentPlan | undefined;

      if (planData && planStatus === "created" && !planMsgIdRef.current) {
        // Plan created — add a plan card to the messages list
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
        // Update the step status inside the plan card
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
      const callId = event.tool_call_id || `tool_${Date.now()}`;
      const status = event.status as "calling" | "called" | "error";

      const toolLabels: Record<string, string> = {
        browser: "Membuka browser",
        shell: "Menjalankan perintah",
        file: "Membaca file",
        search: "Mencari informasi",
        mcp: "Memanggil MCP",
      };
      const thinkLabel = toolLabels[toolName] || `Menggunakan ${toolName}`;

      if (status === "calling") {
        setThinking({ active: true, label: thinkLabel });
        setTools(prev => {
          const idx = prev.findIndex(t => t.tool_call_id === callId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: "calling" };
            return updated;
          }
          return [...prev, {
            tool_call_id: callId,
            name: toolName,
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
            updated[idx] = { ...updated[idx], status: "error", error: event.function_result };
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
      if (chunk && streamingMsgIdRef.current) {
        setStreamingContent(prev => prev + chunk);
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgIdRef.current
            ? { ...m, content: m.content + chunk }
            : m
        ));
      }
      return;
    }

    if (type === "message_end") {
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
      return;
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!inputMessage.trim()) return;
    if (isLoading && !isWaitingForUser) return;

    if (isWaitingForUser && cancelRef.current) {
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
            model: "@cf/meta/llama-3.1-70b-instruct",
            attachments: [],
            session_id: activeSessionIdRef.current,
            is_continuation: wasContinuation,
          },
          {
            onMessage: handleEvent,
            onError: (err) => {
              console.error("Agent error:", err);
              setThinking({ active: false, label: "" });
              setMessages(prev => [...prev, {
                id: `msg_${Date.now()}_err`,
                role: "assistant",
                content: "",
                timestamp: Date.now(),
                error: err.message,
              }]);
              setIsLoading(false);
            },
            onDone: () => {
              setThinking({ active: false, label: "" });
              if (!isWaitingRef.current) {
                setIsLoading(false);
                setStepHistory([]);
              }
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

        const response = await apiService.chat({ messages: historyMsgs });
        setThinking({ active: false, label: "" });

        const replyContent = response.content || "Tidak ada balasan";
        const assistantMsg: ChatMessage = {
          id: `msg_${Date.now()}`,
          role: "assistant",
          content: replyContent,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Submit error:", err);
      setThinking({ active: false, label: "" });
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        error: err?.message || "Gagal mengirim pesan",
      }]);
      setIsLoading(false);
    }
  }, [inputMessage, messages, isAgentMode, attachments, isLoading, isWaitingForUser, handleEvent]);

  const handleStop = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setThinking({ active: false, label: "" });
    setIsLoading(false);
    isWaitingRef.current = false;
    setIsWaitingForUser(false);
    setStepHistory([]);
  }, []);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.plan) {
      return (
        <View style={styles.planCardWrapper}>
          <AgentPlanView plan={item.plan} />
        </View>
      );
    }
    return <ChatMessageBubble message={item} />;
  }, []);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="sparkles" size={36} color="#6C5CE7" />
      </View>
      <Text style={styles.emptyTitle}>Dzeck AI</Text>
      <Text style={styles.emptySubtitle}>
        {isAgentMode
          ? "Mode Agen aktif — saya bisa browsing, menulis kode, dan lebih banyak lagi"
          : "Mode Chat — tanyakan apapun"}
      </Text>
    </View>
  );

  const renderListFooter = () => {
    if (!thinking.active) return null;
    return (
      <View style={styles.thinkingRow}>
        <View style={styles.thinkingAvatar}>
          <Ionicons name="sparkles" size={12} color="#FFFFFF" />
        </View>
        <View style={styles.thinkingBubble}>
          {stepHistory.length >= 1 ? (
            <View>
              {stepHistory.map((step, i) => (
                <Text
                  key={i}
                  style={[
                    styles.stepHistoryItem,
                    i === stepHistory.length - 1 && styles.stepHistoryItemActive,
                  ]}
                >
                  {i === stepHistory.length - 1 ? "▶ " : "✓ "}{step}
                </Text>
              ))}
            </View>
          ) : (
            <AgentWorking label={thinking.label || "Memproses..."} />
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!isLeftPanelShow && (
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={onToggleLeftPanel}
            >
              <Ionicons name="menu" size={20} color="#8E8E93" />
            </TouchableOpacity>
          )}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.modeButton, isAgentMode && styles.modeButtonActive]}
            onPress={() => setIsAgentMode(!isAgentMode)}
          >
            <Ionicons
              name={isAgentMode ? "flash" : "chatbubble-ellipses-outline"}
              size={16}
              color={isAgentMode ? "#6C5CE7" : "#8E8E93"}
            />
            <Text style={[styles.modeButtonText, isAgentMode && styles.modeButtonTextActive]}>
              {isAgentMode ? "Agen" : "Chat"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderListFooter}
        contentContainerStyle={[
          styles.messageList,
          messages.length === 0 && styles.messageListEmpty,
        ]}
        scrollEnabled={true}
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const isAtBottom = contentSize.height - layoutMeasurement.height - contentOffset.y < 120;
          setFollow(isAtBottom);
        }}
        scrollEventThrottle={100}
      />

      <ChatBox
        value={inputMessage}
        onChangeText={setInputMessage}
        onSubmit={handleSubmit}
        onStop={handleStop}
        isLoading={isLoading}
        isAgentMode={isAgentMode}
        isWaitingForUser={isWaitingForUser}
        attachments={attachments}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0C",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E26",
    backgroundColor: "#0D0D12",
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A22",
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#1A1A22",
    borderWidth: 1,
    borderColor: "#2C2C35",
  },
  modeButtonActive: {
    borderColor: "rgba(108,92,231,0.5)",
    backgroundColor: "rgba(108,92,231,0.12)",
  },
  modeButtonText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#8E8E93",
  },
  modeButtonTextActive: {
    color: "#6C5CE7",
  },
  messageList: {
    paddingVertical: 12,
    paddingBottom: 8,
  },
  messageListEmpty: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
    paddingTop: 80,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(108,92,231,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(108,92,231,0.2)",
  },
  emptyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#636366",
    textAlign: "center",
    lineHeight: 20,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  thinkingAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  thinkingBubble: {
    flex: 1,
    backgroundColor: "rgba(108,92,231,0.07)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(108,92,231,0.15)",
  },
  planCardWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  stepHistoryItem: {
    fontSize: 13,
    color: "#636366",
    lineHeight: 20,
  },
  stepHistoryItemActive: {
    color: "#A78BFA",
    fontWeight: "600",
  },
});
