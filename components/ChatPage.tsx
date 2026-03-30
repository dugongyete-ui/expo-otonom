import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Text, TouchableOpacity, Linking, Modal } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ChatMessage as MessageComponent } from "./ChatMessage";
import { ChatBox } from "./ChatBox";
import { AgentThinking } from "./AgentThinking";
import { apiService, AgentEvent, ChatMessage as ApiChatMessage, getStoredToken, getApiBaseUrl } from "../lib/api-service";
import { randomUUID } from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { useI18n, t as translate } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { MCPPanel } from "./MCPPanel";
import { SettingsPanel } from "./SettingsPanel";

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

interface CreatedFile {
  filename: string;
  download_url: string;
  mime?: string;
  sandbox_path?: string;
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
  files?: CreatedFile[];
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
  const [showSettings, setShowSettings] = useState(false);
  const [showMCPPanel, setShowMCPPanel] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [activeModel, setActiveModel] = useState("qwen-3-235b-a22b-instruct-2507");
  const { locale, changeLocale } = useI18n();
  const { logout } = useAuth();
  const [attachments, setAttachments] = useState<any[]>([]);
  const [e2bStatus, setE2bStatus] = useState<"checking" | "connected" | "error">("checking");

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

  // Load active model from server config so Settings panel changes take effect
  useEffect(() => {
    const base = getApiBaseUrl();
    fetch(`${base}/api/config`)
      .then((r) => r.json())
      .then((cfg) => {
        const m = cfg.CEREBRAS_AGENT_MODEL || cfg.modelName;
        if (m) setActiveModel(m);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAgentMode) return;
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const base = typeof window !== "undefined" ? window.location.origin : "";
        const res = await fetch(`${base}/api/health/tools`);
        if (cancelled) return;
        if (!res.ok) { setE2bStatus("error"); return; }
        const data = await res.json();
        if (cancelled) return;
        // Show connected if E2B is enabled (sandbox may not be active until first use)
        setE2bStatus(data?.e2b_enabled === true ? "connected" : "error");
      } catch {
        if (!cancelled) setE2bStatus("error");
      }
    };
    checkHealth();
    return () => { cancelled = true; };
  }, [isAgentMode]);

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
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgIdRef.current
            ? { ...m, isStreaming: false }
            : m
        ));
        streamingMsgIdRef.current = null;
        setStreamingContent("");
      }
      if (type === "done") {
        streamingMsgIdRef.current = null;
        setStreamingContent("");
        setThinking({ active: false, label: "", stepLabel: undefined });
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
      // If notify event includes file attachments, show them as a chat message with download buttons
      const notifyAttachments = event.attachments as Array<{ filename: string; download_url: string; sandbox_path?: string }> | undefined;
      if (notifyAttachments && notifyAttachments.length > 0) {
        const filesMsg: ChatMessage = {
          id: `msg_${Date.now()}_notify_files`,
          role: "assistant",
          content: notifyText || "",
          timestamp: Date.now(),
          files: notifyAttachments.map(a => ({
            filename: a.filename,
            download_url: a.download_url,
            sandbox_path: a.sandbox_path,
          })),
        };
        setMessages(prev => [...prev, filesMsg]);
      }
      return;
    }

    if (type === "files") {
      const files = event.files as Array<{ filename: string; download_url: string; mime?: string; sandbox_path?: string }> | undefined;
      if (files && files.length > 0) {
        const fileMsg: ChatMessage = {
          id: `msg_${Date.now()}_files`,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          files,
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
            model: activeModel,
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
        <View style={styles.headerRight}>
          {isAgentMode && (
            <View style={[
              styles.e2bBadge,
              e2bStatus === "connected" ? styles.e2bConnected :
              e2bStatus === "error" ? styles.e2bError : styles.e2bChecking,
            ]}>
              <Text style={styles.e2bBadgeText}>
                {e2bStatus === "connected" ? "● E2B" : e2bStatus === "error" ? "✕ E2B" : "… E2B"}
              </Text>
            </View>
          )}
          <TouchableOpacity
            onPress={() => setShowSettings(true)}
            style={styles.settingsBtn}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          >
            <Ionicons name="settings-outline" size={18} color="#8a8780" />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={showSettings}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettings(false)}
      >
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setShowSettings(false)}
        >
          <View style={styles.settingsPanel}>
            <Text style={styles.settingsPanelTitle}>{translate("Settings")}</Text>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>{translate("Language")}</Text>
              <View style={styles.langRow}>
                <TouchableOpacity
                  style={[styles.langBtn, locale === "en" && styles.langBtnActive]}
                  onPress={() => changeLocale("en")}
                >
                  <Text style={[styles.langBtnText, locale === "en" && styles.langBtnTextActive]}>
                    {translate("English")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langBtn, locale === "id" && styles.langBtnActive]}
                  onPress={() => changeLocale("id")}
                >
                  <Text style={[styles.langBtnText, locale === "id" && styles.langBtnTextActive]}>
                    {translate("Indonesian")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => {
                setShowSettings(false);
                setShowModelSettings(true);
              }}
            >
              <Ionicons name="options-outline" size={16} color="#6C5CE7" />
              <Text style={[styles.logoutBtnText, { color: "#6C5CE7" }]}>Model & Config</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => {
                setShowSettings(false);
                setShowMCPPanel(true);
              }}
            >
              <Ionicons name="server-outline" size={16} color="#6C5CE7" />
              <Text style={[styles.logoutBtnText, { color: "#6C5CE7" }]}>MCP Servers</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={async () => {
                setShowSettings(false);
                await logout();
              }}
            >
              <Ionicons name="log-out-outline" size={16} color="#dc2626" />
              <Text style={styles.logoutBtnText}>{translate("Logout")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <MCPPanel
        visible={showMCPPanel}
        onClose={() => setShowMCPPanel(false)}
        authToken={getStoredToken()}
      />

      <SettingsPanel
        visible={showModelSettings}
        onClose={() => {
          setShowModelSettings(false);
          fetch(`${getApiBaseUrl()}/api/config`)
            .then((r) => r.json())
            .then((cfg) => {
              const m = cfg.CEREBRAS_AGENT_MODEL || cfg.modelName;
              if (m) setActiveModel(m);
            })
            .catch(() => {});
        }}
        authToken={getStoredToken()}
      />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          if (item.files && item.files.length > 0) {
            const base = typeof window !== "undefined" ? window.location.origin : "";
            return (
              <View style={styles.fileCardContainer}>
                <View style={styles.fileCardHeader}>
                  <Ionicons name="document-outline" size={15} color="#636366" />
                  <Text style={styles.fileCardTitle}>File yang dibuat:</Text>
                </View>
                {item.files.map((f, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.fileCard}
                    activeOpacity={0.7}
                    onPress={() => {
                      const url = f.download_url.startsWith("http") ? f.download_url : `${base}${f.download_url}`;
                      Linking.openURL(url).catch(() => {});
                    }}
                  >
                    <Ionicons name="download-outline" size={16} color="#1a73e8" />
                    <Text style={styles.fileCardName} numberOfLines={1}>{f.filename}</Text>
                    <Text style={styles.fileCardAction}>Unduh</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          }
          return (
            <MessageComponent
              message={item}
              tools={item.id === planMsgIdRef.current ? tools : undefined}
            />
          );
        }}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1916",
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingsBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f3ee",
  },
  settingsOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  settingsPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  settingsPanelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1916",
    marginBottom: 4,
  },
  settingsSection: {
    gap: 10,
  },
  settingsSectionTitle: {
    fontSize: 13,
    color: "#8a8780",
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  langRow: {
    flexDirection: "row",
    gap: 8,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    alignItems: "center",
    backgroundColor: "#f5f3ee",
  },
  langBtnActive: {
    backgroundColor: "#1a1916",
    borderColor: "#1a1916",
  },
  langBtnText: {
    color: "#6a6762",
    fontSize: 14,
    fontWeight: "500",
  },
  langBtnTextActive: {
    color: "#ffffff",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#f5f3ee",
  },
  logoutBtnText: {
    color: "#dc2626",
    fontSize: 14,
    fontWeight: "500",
  },
  messageList: {
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  e2bBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
  },
  e2bConnected: {
    backgroundColor: "#d1f5d3",
  },
  e2bError: {
    backgroundColor: "#fde8e8",
  },
  e2bChecking: {
    backgroundColor: "#f0efea",
  },
  e2bBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#1a1916",
    letterSpacing: 0.3,
  },
  fileCardContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  fileCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  fileCardTitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#636366",
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  fileCardName: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#1a1916",
  },
  fileCardAction: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#1a73e8",
    fontWeight: "600",
  },
});
