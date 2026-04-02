import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Text, TouchableOpacity, Linking, Modal, Image, Share, Alert, ScrollView, Animated } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ChatMessage as MessageComponent } from "./ChatMessage";
import { ChatBox } from "./ChatBox";
import { AgentPlanView } from "./AgentPlanView";
import {
  MenuIcon, TerminalIcon, ShareIcon, LogOutIcon, EllipsisIcon,
  FlashIcon, ChatbubbleIcon, SettingsIcon, ServerIcon,
  AlertCircleIcon, CheckIcon, HelpCircleIcon, SparklesIcon,
  CheckCircleIcon, CloseCircleIcon, DocumentTextIcon,
  ChevronUpIcon, ChevronDownIcon,
} from "@/components/icons/SvgIcon";
import { apiService, AgentEvent, ChatMessage as ApiChatMessage, getStoredToken, getApiBaseUrl } from "../lib/api-service";
import { processAgentEvent } from "../lib/agent-event-processor";
import { saveActiveSessionId, loadActiveSessionId, clearActiveSessionId, saveActiveSessionLastId, loadActiveSessionLastId } from "../lib/storage";
import { randomUUID } from "expo-crypto";
import { useI18n, t as translate } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { MCPPanel } from "./MCPPanel";
import { SettingsPanel } from "./SettingsPanel";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  screenshotB64?: string;
  todoItems?: Array<{ id: string; text: string; status: string; [key: string]: any }>;
  taskUpdate?: { id?: string; title?: string; status?: string; description?: string; [key: string]: any };
  searchResults?: Array<{ title: string; url: string; snippet?: string; [key: string]: any }>;
  searchQuery?: string;
  shellOutput?: string;
  notifyMessages?: string[];
}

export interface VncSessionInfo {
  sandboxId: string;
  vncUrl: string;
  e2bSessionId?: string;
}

interface BrowserEventState {
  url?: string;
  screenshot_b64?: string;
  title?: string;
}

function ThinkingIndicator({ label }: { label: string }) {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 350, useNativeDriver: true }),
        ])
      );
    const a1 = anim(dot1, 0);
    const a2 = anim(dot2, 160);
    const a3 = anim(dot3, 320);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={thinkingStyles.row}>
      <Image
        source={require("../assets/images/dzeck-logo.jpg")}
        style={thinkingStyles.avatarImage}
        resizeMode="cover"
      />
      <View style={thinkingStyles.bubble}>
        <View style={thinkingStyles.dotsRow}>
          {[dot1, dot2, dot3].map((d, i) => (
            <Animated.View
              key={i}
              style={[thinkingStyles.dot, { opacity: d, transform: [{ scaleY: d }] }]}
            />
          ))}
        </View>
        <Text style={thinkingStyles.label} numberOfLines={1}>{label || "Dzeck sedang berpikir..."}</Text>
      </View>
    </View>
  );
}

const thinkingStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 10,
  },
  avatarImage: {
    width: 22,
    height: 22,
    borderRadius: 6,
    flexShrink: 0,
    overflow: "hidden",
  },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#3a3a3a",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
    fontStyle: "italic",
    flex: 1,
  },
});

const TOOL_LABEL_MAP: Record<string, string> = {
  browser_navigate: "Navigasi halaman",
  browser_view: "Melihat halaman",
  browser_click: "Mengklik elemen",
  browser_type: "Mengetik teks",
  browser_scroll: "Scroll halaman",
  shell_exec: "Menjalankan perintah",
  shell_view: "Melihat output",
  web_search: "Mencari informasi",
  file_read: "Membaca file",
  file_write: "Menulis file",
  message_notify_user: "Notifikasi",
  message_ask_user: "Pertanyaan",
};

function InlineToolStep({ tool }: { tool: any }) {
  const fnName = tool.function_name || tool.name || "tool";
  const label = TOOL_LABEL_MAP[fnName] || fnName;
  const isRunning = tool.status === "calling";
  const isDone = tool.status === "called";
  const isError = tool.status === "error";

  return (
    <View style={inlineToolStyles.row}>
      <View style={[inlineToolStyles.iconWrap, isError && inlineToolStyles.iconWrapError, isDone && inlineToolStyles.iconWrapDone]}>
        <TerminalIcon size={10} color={isError ? "#f87171" : "#888888"} />
      </View>
      <Text style={[inlineToolStyles.label, isError && inlineToolStyles.labelError]} numberOfLines={1}>
        {label}
      </Text>
      {isRunning && <View style={inlineToolStyles.runningDot} />}
      {isDone && <CheckIcon size={10} color="#666666" />}
      {isError && <CloseCircleIcon size={10} color="#f87171" />}
    </View>
  );
}

const inlineToolStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 3,
  },
  iconWrap: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconWrapDone: {
    backgroundColor: "#1a2a1a",
  },
  iconWrapError: {
    backgroundColor: "#2a1a1a",
  },
  label: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#606060",
  },
  labelError: {
    color: "#f87171",
  },
  runningDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#666666",
    flexShrink: 0,
  },
});

interface ChatPageProps {
  sessionId?: string;
  isAgentMode?: boolean;
  onAgentModeChange?: (enabled: boolean) => void;
  isLeftPanelShow?: boolean;
  onToggleLeftPanel?: () => void;
  onToolsChange?: (tools: any[]) => void;
  onVncSessionChange?: (info: VncSessionInfo | null) => void;
  onBrowserEventChange?: (event: BrowserEventState | null) => void;
  onSessionFilesChange?: (files: Array<{ filename: string; download_url: string; sandbox_path?: string; mime?: string }>) => void;
  onOpenTools?: () => void;
  toolsCount?: number;
  activeToolsCount?: number;
}

export function ChatPage({
  sessionId: externalSessionId,
  isAgentMode: agentModeProp,
  onAgentModeChange,
  isLeftPanelShow,
  onToggleLeftPanel,
  onToolsChange,
  onVncSessionChange,
  onBrowserEventChange,
  onSessionFilesChange,
  onOpenTools,
  toolsCount = 0,
  activeToolsCount = 0,
}: ChatPageProps = {}) {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  const isAgentMode = agentModeProp ?? mode === "agent";
  const insets = useSafeAreaInsets();

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
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [taskCompletedExpanded, setTaskCompletedExpanded] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Array<{ id: string; description: string }>>([]);

  const flatListRef = useRef<FlatList>(null);
  const msgCounterRef = useRef(0);
  const nextMsgId = (suffix?: string) => `msg_${Date.now()}_${msgCounterRef.current++}${suffix ? `_${suffix}` : ""}`;
  const activeSessionIdRef = useRef<string>(externalSessionId || randomUUID());
  const planMsgIdRef = useRef<string | null>(null);
  const currentPlanRef = useRef<AgentPlan | null>(null);
  const isWaitingRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const sseReconnectAttemptsRef = useRef(0);
  const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventIdRef = useRef<string>("0");
  const filesShownViaNotifyRef = useRef(false);
  const sseFilesRef = useRef<Array<{ filename: string; download_url: string; sandbox_path?: string; mime?: string }>>([]);
  const MAX_SSE_RECONNECT_ATTEMPTS = 3;
  const [streamingContent, setStreamingContent] = useState("");
  const [lastBrowserEvent, setLastBrowserEvent] = useState<{ url?: string; screenshot_b64?: string; title?: string } | null>(null);
  const [isShared, setIsShared] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    if (flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, streamingContent, isLoading]);

  // Load active model: user prefs (per-user MongoDB) take priority over global config
  useEffect(() => {
    const base = getApiBaseUrl();
    const token = getStoredToken();
    const authHdr = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch(`${base}/api/user/prefs`, { headers: authHdr }).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({})),
    ]).then(([prefs, cfg]) => {
      const m = prefs.model || cfg.G4F_MODEL || cfg.modelName;
      if (m) setActiveModel(m);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAgentMode) return;
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const base = getApiBaseUrl();
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

  // Load share status for the initial externalSessionId (mount case)
  useEffect(() => {
    if (!externalSessionId) return;
    apiService.getShareStatus(externalSessionId)
      .then((status) => {
        if (activeSessionIdRef.current === externalSessionId || !activeSessionIdRef.current) {
          setIsShared(status.is_shared);
          setShareUrl(status.share_url);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reconnect to an in-progress agent session after page refresh / app restart.
  // Runs once on mount in agent mode. Checks both the persisted active session ID
  // (no-external-session path) and an explicitly provided externalSessionId.
  useEffect(() => {
    if (!isAgentMode) return;
    let cancelled = false;

    const attemptReconnect = async (sessionIdToRestore: string) => {
      const status = await apiService.getSessionStatus(sessionIdToRestore);
      if (cancelled) return;

      if (!status.exists) {
        if (!externalSessionId) await clearActiveSessionId();
        return;
      }

      if (!status.is_running) {
        // Session finished — clear persisted ID and load history so the UI is not blank.
        // Only fetch history in the no-external-session path; the existing session-switch
        // effect already handles history loading when externalSessionId is provided.
        if (!externalSessionId) {
          await clearActiveSessionId();
          const base = getApiBaseUrl();
          const token = getStoredToken();
          try {
            const r = await fetch(`${base}/api/sessions/${sessionIdToRestore}/messages`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!cancelled && r.ok) {
              const data = await r.json();
              if (Array.isArray(data.messages) && data.messages.length > 0) {
                activeSessionIdRef.current = sessionIdToRestore;
                const restored: ChatMessage[] = data.messages
                  .filter((m: any) => m.role && m.content)
                  .map((m: any) => ({
                    id: m.id || `hist_${Date.now()}_${Math.random()}`,
                    role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
                    content: m.content,
                    timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
                  }));
                setMessages(restored);
              }
            }
          } catch {}
        }
        return;
      }

      // Session is still running on the server — reconnect to the live stream.
      // Use stored cursor if we have one for this exact session, otherwise replay from start.
      let lastId = "0";
      if (!externalSessionId) {
        lastId = await loadActiveSessionLastId();
      } else {
        const storedActiveId = await loadActiveSessionId();
        if (storedActiveId === sessionIdToRestore) {
          lastId = await loadActiveSessionLastId();
        }
      }
      if (cancelled) return;

      activeSessionIdRef.current = sessionIdToRestore;
      setIsLoading(true);
      setThinking({ active: true, label: "Menghubungkan kembali ke sesi aktif..." });

      const stopSSE = apiService.connectSessionSSE(sessionIdToRestore, {
        onMessage: (event: AgentEvent) => {
          if (!cancelled) {
            if ((event as any)._streamId) {
              saveActiveSessionLastId((event as any)._streamId).catch(() => {});
            }
            handleEvent(event);
          }
        },
        onDone: () => {
          if (!cancelled) {
            handleEvent({ type: "done" });
            setIsLoading(false);
            clearActiveSessionId().catch(() => {});
          }
        },
        onError: () => {
          if (!cancelled) {
            setIsLoading(false);
            setThinking({ active: false, label: "" });
            clearActiveSessionId().catch(() => {});
          }
        },
      }, lastId);

      cancelRef.current = stopSSE;
    };

    (async () => {
      if (externalSessionId) {
        // Explicit session provided: check if it's still running and reconnect
        await attemptReconnect(externalSessionId);
      } else {
        // No explicit session: check if we have a persisted active session from a prior run
        const persistedId = await loadActiveSessionId();
        if (!persistedId || cancelled) return;
        await attemptReconnect(persistedId);
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync session when externalSessionId changes (e.g. sidebar session switch)
  // Also loads historical messages from the server for the selected session
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
      filesShownViaNotifyRef.current = false;
      setStreamingContent('');
      setThinking({ active: false, label: '', stepLabel: undefined });
      setIsLoading(false);
      setIsWaitingForUser(false);
      isWaitingRef.current = false;
      setIsShared(false);
      setShareUrl(null);

      apiService.getShareStatus(externalSessionId)
        .then((status) => {
          if (activeSessionIdRef.current === externalSessionId) {
            setIsShared(status.is_shared);
            setShareUrl(status.share_url);
          }
        })
        .catch(() => {});

      // Fetch historical messages for the selected session
      const base = getApiBaseUrl();
      const token = getStoredToken();
      fetch(`${base}/api/sessions/${externalSessionId}/messages`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null)
        .then((data) => {
          if (!data || !Array.isArray(data.messages)) return;
          if (activeSessionIdRef.current !== externalSessionId) return;
          const restored: ChatMessage[] = data.messages
            .filter((m: any) => m.role && m.content)
            .map((m: any) => ({
              id: m.id || `hist_${Date.now()}_${Math.random()}`,
              role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
              content: m.content,
              timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
            }));
          if (restored.length > 0) {
            setMessages(restored);
          }
        });
    }
  }, [externalSessionId]);

  // Propagate tools changes to parent layout
  useEffect(() => {
    onToolsChange?.(tools);
  }, [tools, onToolsChange]);

  // Propagate live browser screenshot events to parent layout (for BrowserPanel)
  useEffect(() => {
    onBrowserEventChange?.(lastBrowserEvent);
  }, [lastBrowserEvent, onBrowserEventChange]);

  const handleEvent = useCallback((event: AgentEvent) => {
    const ev = processAgentEvent(event);

    switch (ev.kind) {
      case "session": {
        if (ev.sessionId) {
          activeSessionIdRef.current = ev.sessionId;
          if (isAgentMode) {
            saveActiveSessionId(ev.sessionId).catch(() => {});
          }
        }
        return;
      }

      case "plan": {
        const planData = ev.plan as AgentPlan | undefined;
        const planStatus = ev.status as string | undefined;

        if (planData && !planMsgIdRef.current) {
          const planMsgId = `plan_${Date.now()}_${msgCounterRef.current++}`;
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
          currentPlanRef.current = planData;
          setMessages(prev => prev.map(m =>
            m.id === planMsgIdRef.current ? { ...m, plan: planData } : m
          ));
          if (planStatus === "completed") {
            setThinking({ active: false, label: "" });
          }
        } else if (!planData) {
          setThinking({ active: true, label: "Membuat rencana...", stepLabel: (ev.plan as any)?.title });
        }
        return;
      }

      case "step": {
        const step = ev.step as AgentPlanStep | undefined;
        const status = ev.status;

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

      case "tool_stream": {
        if (ev.callId && ev.chunk) {
          setTools(prev => {
            const idx = prev.findIndex(t => t.tool_call_id === ev.callId);
            if (idx >= 0) {
              const updated = [...prev];
              const existing = updated[idx].output || "";
              updated[idx] = { ...updated[idx], output: existing + ev.chunk };
              return updated;
            }
            return prev;
          });
        }
        return;
      }

      case "tool": {
        const { toolName, functionName, callId, status, args, result, toolContent } = ev;

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
              input: args,
            }];
          });
        } else if (status === "called") {
          setTools(prev => {
            const idx = prev.findIndex(t => t.tool_call_id === callId);
            if (idx >= 0) {
              const updated = [...prev];
              const existing = updated[idx];
              // Deep-merge tool_content: preserve screenshot_b64/url/title from prior
              // browser_screenshot/desktop_screenshot events unless new payload provides them
              const prevTc = existing.tool_content || {};
              const newTc = toolContent || {};
              const normalizeShot = (s: string) =>
                s && !s.startsWith("data:") ? `data:image/png;base64,${s}` : s;
              const newShot = normalizeShot(newTc.screenshot_b64 || "");
              const mergedTc = {
                ...prevTc,
                ...newTc,
                screenshot_b64: newShot || prevTc.screenshot_b64 || "",
                url: newTc.url || prevTc.url || "",
                title: newTc.title || prevTc.title || "",
              };
              updated[idx] = {
                ...existing,
                status: "called",
                function_name: functionName,
                output: result,
                tool_content: mergedTc,
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
              updated[idx] = { ...updated[idx], status: "error", function_name: functionName, error: result };
              return updated;
            }
            return prev;
          });
        }
        return;
      }

      case "waiting_for_user": {
        isWaitingRef.current = true;
        setIsWaitingForUser(true);
        setThinking({ active: false, label: "" });
        return;
      }

      case "message_start": {
        const role = ev.role === "ask" ? "ask" as const : "assistant" as const;
        const newId = `msg_${Date.now()}_${msgCounterRef.current++}_stream`;
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

      case "message_chunk": {
        const chunk = ev.chunk;
        if (chunk) {
          setStreamingContent(prev => prev + chunk);
          if (streamingMsgIdRef.current) {
            setMessages(prev => prev.map(m =>
              m.id === streamingMsgIdRef.current
                ? { ...m, content: m.content + chunk }
                : m
            ));
          } else {
            const newId = `msg_${Date.now()}_${msgCounterRef.current++}_stream`;
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

      case "message_end": {
        if (streamingMsgIdRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === streamingMsgIdRef.current
              ? { ...m, isStreaming: false }
              : m
          ));
          streamingMsgIdRef.current = null;
          setStreamingContent("");
        }
        return;
      }

      case "done": {
        if (streamingMsgIdRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === streamingMsgIdRef.current
              ? { ...m, isStreaming: false }
              : m
          ));
          streamingMsgIdRef.current = null;
          setStreamingContent("");
        }
        setThinking({ active: false, label: "", stepLabel: undefined });
        setIsLoading(false);
        if (isAgentMode && currentPlanRef.current) {
          const steps = currentPlanRef.current?.steps || [];
          if (steps.length > 0) {
            const doneSteps = steps
              .filter(s => s.status === "completed" || s.status === "failed")
              .map(s => ({ id: s.id, description: s.description }));
            setCompletedSteps(doneSteps.length > 0 ? doneSteps : steps.map(s => ({ id: s.id, description: s.description })));
            setTaskCompleted(true);
            setTaskCompletedExpanded(false);
          }
        }
        return;
      }

      case "message": {
        if (!ev.content) return;
        setThinking({ active: false, label: "" });
        const msg: ChatMessage = {
          id: `msg_${Date.now()}_${msgCounterRef.current++}`,
          role: "assistant",
          content: ev.content,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, msg]);
        return;
      }

      case "title": {
        if (ev.title) setTitle(ev.title);
        return;
      }

      case "thinking": {
        if (ev.text) setThinking({ active: true, label: ev.text });
        return;
      }

      case "message_correct": {
        if (ev.text) {
          setMessages(prev => {
            if (streamingMsgIdRef.current) {
              return prev.map(m =>
                m.id === streamingMsgIdRef.current
                  ? { ...m, content: ev.text }
                  : m
              );
            }
            const lastAssistantIdx = [...prev].reverse().findIndex(m => m.role === "assistant");
            if (lastAssistantIdx === -1) return prev;
            const realIdx = prev.length - 1 - lastAssistantIdx;
            return prev.map((m, i) => i === realIdx ? { ...m, content: ev.text } : m);
          });
        }
        return;
      }

      case "notify": {
        setThinking({ active: false, label: "" });
        if (ev.attachments && ev.attachments.length > 0) {
          filesShownViaNotifyRef.current = true;
          const newFiles = ev.attachments.map((a: any) => ({
            filename: a.filename,
            download_url: a.download_url,
            sandbox_path: a.sandbox_path,
            mime: a.mime,
          }));
          const existingNames = new Set(sseFilesRef.current.map(f => f.filename));
          const uniqueNew = newFiles.filter((f: any) => !existingNames.has(f.filename));
          if (uniqueNew.length > 0) {
            sseFilesRef.current = [...sseFilesRef.current, ...uniqueNew];
            onSessionFilesChange?.(sseFilesRef.current);
          }
          const filesMsg: ChatMessage = {
            id: `msg_${Date.now()}_${msgCounterRef.current++}_notify_files`,
            role: "assistant",
            content: ev.text || "",
            timestamp: Date.now(),
            files: newFiles,
          };
          setMessages(prev => [...prev, filesMsg]);
        } else if (ev.text) {
          if (planMsgIdRef.current) {
            setMessages(prev => prev.map(m =>
              m.id === planMsgIdRef.current
                ? { ...m, notifyMessages: [...(m.notifyMessages || []), ev.text as string] }
                : m
            ));
          } else {
            const notifyMsg: ChatMessage = {
              id: `msg_${Date.now()}_${msgCounterRef.current++}_notify`,
              role: "assistant",
              content: ev.text,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, notifyMsg]);
          }
        }
        return;
      }

      case "files": {
        if (ev.files.length > 0) {
          const existingNames = new Set(sseFilesRef.current.map(f => f.filename));
          const uniqueNew = ev.files.filter((f: any) => !existingNames.has(f.filename));
          if (uniqueNew.length > 0) {
            sseFilesRef.current = [...sseFilesRef.current, ...uniqueNew];
            onSessionFilesChange?.(sseFilesRef.current);
          }
        }
        if (filesShownViaNotifyRef.current) {
          filesShownViaNotifyRef.current = false;
          return;
        }
        if (ev.files.length > 0) {
          const fileMsg: ChatMessage = {
            id: `msg_${Date.now()}_files`,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            files: ev.files,
          };
          setMessages(prev => [...prev, fileMsg]);
        }
        return;
      }

      case "screenshot": {
        const { screenshotB64, source, callId, url, title } = ev;
        if (screenshotB64) {
          if (source === "browser") {
            setLastBrowserEvent({ screenshot_b64: screenshotB64, url: url || "", title: title || "" });
          } else {
            setLastBrowserEvent({ screenshot_b64: screenshotB64 });
          }
          setTools(prev => {
            const idx = callId ? prev.findIndex(t => t.tool_call_id === callId) : prev.length - 1;
            if (idx >= 0) {
              const updated = [...prev];
              const existing = updated[idx].tool_content || {};
              updated[idx] = {
                ...updated[idx],
                tool_content: {
                  ...existing,
                  type: existing.type || "browser",
                  screenshot_b64: screenshotB64,
                  ...(source === "browser" ? { url: url || existing.url || "", title: title || existing.title || "" } : {}),
                },
              };
              return updated;
            }
            return prev;
          });
        }
        return;
      }

      case "vnc_stream_url": {
        if (ev.vncUrl && ev.sandboxId) {
          onVncSessionChange?.({ sandboxId: ev.sandboxId, vncUrl: ev.vncUrl, e2bSessionId: ev.e2bSessionId });
        }
        return;
      }

      case "error": {
        setThinking({ active: false, label: "" });
        const errMsg: ChatMessage = {
          id: `msg_${Date.now()}_${msgCounterRef.current++}_err`,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          error: ev.message || "Terjadi kesalahan",
        };
        setMessages(prev => [...prev, errMsg]);
        setIsLoading(false);
        return;
      }

      case "todo_update":
        return;

      case "task_update":
        return;

      case "search_results":
        return;

      case "shell_output":
        return;

      default:
        return;
    }
  }, [onVncSessionChange, isAgentMode]);

  const handleSubmit = useCallback(async () => {
    if (!inputMessage.trim() && attachments.length === 0) return;

    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_${msgCounterRef.current++}`,
      role: "user",
      content: inputMessage.trim(),
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const wasContinuation = isWaitingForUser;

    setMessages(prev => [...prev, userMsg]);
    // If attachment-only (no text), synthesize a default prompt so the backend receives non-empty message
    const msgText = inputMessage.trim() || (attachments.length > 0 ? "Analisis lampiran ini." : "");
    setInputMessage("");
    setAttachments([]);
    filesShownViaNotifyRef.current = false;
    setIsLoading(true);
    isWaitingRef.current = false;
    setIsWaitingForUser(false);
    setTools([]);
    setTaskCompleted(false);
    setTaskCompletedExpanded(false);
    setCompletedSteps([]);
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

        sseReconnectAttemptsRef.current = 0;
        lastEventIdRef.current = "0";

        // Persist the session ID immediately so a refresh mid-run can reconnect,
        // even if the server-assigned session_id event hasn't arrived yet.
        saveActiveSessionId(activeSessionIdRef.current).catch(() => {});
        saveActiveSessionLastId("0").catch(() => {});

        const _sseOnError = (err: Error) => {
          const attempt = sseReconnectAttemptsRef.current;
          if (attempt < MAX_SSE_RECONNECT_ATTEMPTS && activeSessionIdRef.current) {
            sseReconnectAttemptsRef.current += 1;
            const delay = Math.pow(2, attempt) * 1500;
            const sessionId = activeSessionIdRef.current;
            console.warn(`[SSE] Disconnected, reconnecting to stream in ${delay}ms (attempt ${attempt + 1}/${MAX_SSE_RECONNECT_ATTEMPTS})...`);
            if (sseReconnectTimerRef.current) clearTimeout(sseReconnectTimerRef.current);
            sseReconnectTimerRef.current = setTimeout(async () => {
              try {
                const cancel = await apiService.agentStreamReconnect(
                  sessionId,
                  lastEventIdRef.current,
                  { onMessage: _sseOnMessage, onError: _sseOnError, onDone: _sseOnDone }
                );
                cancelRef.current = cancel;
              } catch {
                handleEvent({ type: "error", error: err.message });
              }
            }, delay);
          } else {
            handleEvent({ type: "error", error: err.message });
          }
        };

        const _sseOnMessage = (event: any) => {
          if (event._streamId) {
            lastEventIdRef.current = event._streamId;
            saveActiveSessionLastId(event._streamId).catch(() => {});
          }
          handleEvent(event);
        };

        const _sseOnDone = () => {
          sseReconnectAttemptsRef.current = 0;
          if (sseReconnectTimerRef.current) {
            clearTimeout(sseReconnectTimerRef.current);
            sseReconnectTimerRef.current = null;
          }
          handleEvent({ type: "done" });
          setIsLoading(false);
          cancelRef.current = null;
          clearActiveSessionId().catch(() => {});
        };

        cancelRef.current = apiService.agent(
          {
            message: msgText,
            messages: historyMsgs,
            model: activeModel,
            attachments: attachments.length > 0 ? attachments : [],
            session_id: activeSessionIdRef.current,
            is_continuation: wasContinuation,
          },
          { onMessage: _sseOnMessage, onError: _sseOnError, onDone: _sseOnDone }
        );
      } else {
        const historyMsgs = messages.map(m => ({
          role: m.role === "ask" ? "assistant" as const : m.role,
          content: m.content,
        }));

        cancelRef.current = apiService.agent(
          {
            message: msgText,
            messages: historyMsgs,
            model: activeModel,
            attachments: [],
            session_id: activeSessionIdRef.current,
            mode: "chat",
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
      }
    } catch (err: any) {
      console.error("Submit error:", err);
      handleEvent({ type: "error", error: err.message });
    }
  }, [inputMessage, isAgentMode, messages, attachments, isWaitingForUser, handleEvent]);

  const handleStop = useCallback(() => {
    const sid = activeSessionIdRef.current;

    // Cancel the SSE stream immediately on the client side
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsLoading(false);
    setThinking({ active: false, label: "" });

    if (!sid) return;

    const base = getApiBaseUrl();
    const token = getStoredToken();
    const authHdr: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // Step 1: Send Redis graceful stop signal (plan_act.py checks this each iteration)
    fetch(`${base}/api/sessions/${sid}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHdr },
    }).catch(() => {});

    // Step 2: SIGTERM fallback after 3s — only if agent session is still alive
    setTimeout(() => {
      fetch(`${base}/api/agent/status/${sid}`, { headers: authHdr })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          // Only send SIGTERM if the session exists and hasn't finished gracefully
          if (data && data.exists && !data.done) {
            fetch(`${base}/api/agent/stop/${sid}`, {
              method: "POST",
              headers: authHdr,
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }, 3000);
  }, []);

  const handleShare = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    setIsSharing(true);
    try {
      const newShared = !isShared;
      const result = await apiService.shareSession(sessionId, newShared);
      setIsShared(result.is_shared);
      setShareUrl(result.share_url);
      if (result.is_shared && result.share_url) {
        try {
          await Share.share({ message: result.share_url, url: result.share_url });
        } catch {
          Alert.alert("Share Link", result.share_url);
        }
      } else {
        Alert.alert("Session unshared", "This session is no longer publicly accessible.");
      }
    } catch (err: any) {
      Alert.alert("Share Error", err.message || "Failed to share session");
    } finally {
      setIsSharing(false);
    }
  }, [isShared]);

  const handleSuggestion = useCallback((text: string) => {
    setInputMessage(text);
  }, []);

  const SUGGESTIONS = isAgentMode
    ? [
        { id: "s1", label: "Cari berita terbaru" },
        { id: "s2", label: "Buka browser Google" },
        { id: "s3", label: "Buat script Python" },
        { id: "s4", label: "Apa yang bisa kamu lakukan?" },
      ]
    : [
        { id: "s1", label: "Apa yang bisa kamu lakukan?" },
        { id: "s2", label: "Jelaskan sesuatu padaku" },
        { id: "s3", label: "Tulis email profesional" },
        { id: "s4", label: "Buat rencana belajar" },
      ];

  const WelcomeScreen = (
    <View style={styles.welcomeContainer}>
      <View style={styles.welcomeContent}>
        <Text style={styles.welcomeGreeting}>
          {locale === "id" ? "Halo, selamat datang" : "Hello, welcome"}
        </Text>
        <Text style={styles.welcomeSubtitle}>
          {locale === "id"
            ? isAgentMode ? "Apa yang ingin dikerjakan?" : "Apa yang ingin kamu tanyakan?"
            : isAgentMode ? "What do you want to accomplish?" : "What do you want to ask?"}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.suggestionScrollView}
        contentContainerStyle={styles.suggestionScrollContent}
      >
        {SUGGESTIONS.map(s => (
          <TouchableOpacity
            key={s.id}
            style={styles.suggestionChip}
            onPress={() => handleSuggestion(s.label)}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionChipText} numberOfLines={2}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onToggleLeftPanel}
          style={styles.settingsBtn}
          hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
        >
          <MenuIcon size={22} color="#b0b0b0" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image
            source={require("../assets/images/dzeck-logo.jpg")}
            style={{ width: 32, height: 32, borderRadius: 8 }}
            resizeMode="cover"
          />
          <TouchableOpacity
            onPress={() => onAgentModeChange?.(!isAgentMode)}
            style={[styles.modeBadge, isAgentMode ? styles.modeBadgeAgent : styles.modeBadgeChat]}
            hitSlop={{ top: 6, left: 6, right: 6, bottom: 6 }}
            activeOpacity={0.7}
          >
            {isAgentMode
              ? <FlashIcon size={10} color="#888888" />
              : <ChatbubbleIcon size={10} color="#888888" />
            }
            <Text style={[styles.modeBadgeText, isAgentMode ? styles.modeBadgeTextAgent : styles.modeBadgeTextChat]}>
              {isAgentMode ? "Agent" : "Chat"}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          {onOpenTools && (
            <TouchableOpacity
              onPress={onOpenTools}
              style={[styles.settingsBtn, activeToolsCount > 0 && styles.toolsBtnActive]}
              hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
            >
              <View>
                <TerminalIcon size={20} color="#a0a0a0" />
                {toolsCount > 0 && (
                  <View style={styles.toolsBadge}>
                    <Text style={styles.toolsBadgeText}>{toolsCount > 9 ? "9+" : toolsCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleShare}
            style={styles.settingsBtn}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
            disabled={isSharing || messages.length === 0}
          >
            <ShareIcon
              size={20}
              color={messages.length === 0 ? "#555555" : "#a0a0a0"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => { await logout(); }}
            style={styles.settingsBtn}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          >
            <LogOutIcon size={20} color="#a0a0a0" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowSettings(true)}
            style={styles.settingsBtn}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          >
            <EllipsisIcon size={20} color="#a0a0a0" />
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
              <SettingsIcon size={16} color="#a0a0a0" />
              <Text style={[styles.logoutBtnText, { color: "#a0a0a0" }]}>Model & Config</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => {
                setShowSettings(false);
                setShowMCPPanel(true);
              }}
            >
              <ServerIcon size={16} color="#a0a0a0" />
              <Text style={[styles.logoutBtnText, { color: "#a0a0a0" }]}>MCP Servers</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={async () => {
                setShowSettings(false);
                await logout();
              }}
            >
              <LogOutIcon size={16} color="#dc2626" />
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
          const base = getApiBaseUrl();
          const token = getStoredToken();
          const authHdr = token ? { Authorization: `Bearer ${token}` } : {};
          Promise.all([
            fetch(`${base}/api/user/prefs`, { headers: authHdr }).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
            fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({})),
          ]).then(([prefs, cfg]) => {
            const m = prefs.model || cfg.G4F_MODEL || cfg.modelName;
            if (m) setActiveModel(m);
          }).catch(() => {});
        }}
        authToken={getStoredToken()}
      />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        style={styles.flatList}
        renderItem={({ item }) => {
          // Screenshot message — display inline image
          if (item.screenshotB64) {
            return (
              <View style={styles.screenshotContainer}>
                <Image
                  source={{ uri: item.screenshotB64 }}
                  style={styles.screenshotImage}
                  resizeMode="contain"
                />
              </View>
            );
          }

          // Plan message — show agent header + AgentPlanView card(s)
          if (item.plan) {
            const isPlanRunning = item.plan.status === "running" || item.plan.steps.some(s => s.status === "running");
            const isPlanDone = item.plan.status === "completed" || item.plan.steps.every(s => s.status === "completed" || s.status === "failed");
            return (
              <View style={styles.agentTurnBlock}>
                <View style={styles.agentTurnHeader}>
                  <Image
                    source={require("../assets/images/dzeck-logo.jpg")}
                    style={styles.agentTurnLogo}
                    resizeMode="cover"
                  />
                  <Text style={styles.agentTurnName}>Dzeck</Text>
                  {isPlanRunning && !isPlanDone && (
                    <View style={styles.agentTurnBadgeRunning}>
                      <Text style={styles.agentTurnBadgeText}>Working…</Text>
                    </View>
                  )}
                  {isPlanDone && (
                    <View style={styles.agentTurnBadgeDone}>
                      <Text style={[styles.agentTurnBadgeText]}>Done</Text>
                    </View>
                  )}
                </View>
                <AgentPlanView plan={item.plan} notifyMessages={item.notifyMessages} />
              </View>
            );
          }

          // File output message — redesigned document cards
          if (item.files && item.files.length > 0) {
            const base = getApiBaseUrl();
            const openFile = async (f: CreatedFile) => {
              try {
                const token = getStoredToken();
                const downloadUrl = f.download_url.startsWith("http")
                  ? f.download_url
                  : `${base}${f.download_url}`;
                const tokenRes = await fetch(`${base}/api/files/one-time-token`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify({ download_url: f.download_url }),
                });
                if (tokenRes.ok) {
                  const { url } = await tokenRes.json();
                  Linking.openURL(url).catch(() => {});
                } else {
                  Linking.openURL(downloadUrl).catch(() => {});
                }
              } catch {
                const base2 = getApiBaseUrl();
                const url = f.download_url.startsWith("http") ? f.download_url : `${base2}${f.download_url}`;
                Linking.openURL(url).catch(() => {});
              }
            };

            const getFileExt = (name: string) => name.split(".").pop()?.toUpperCase() || "FILE";

            return (
              <View style={styles.fileCardsBlock}>
                <View style={styles.agentTurnHeader}>
                  <Image
                    source={require("../assets/images/dzeck-logo.jpg")}
                    style={styles.agentTurnLogo}
                    resizeMode="cover"
                  />
                  <Text style={styles.agentTurnName}>Dzeck</Text>
                </View>
                {item.files.map((f, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.fileDocCard}
                    activeOpacity={0.75}
                    onPress={() => openFile(f)}
                  >
                    <View style={styles.fileDocIconWrap}>
                      <DocumentTextIcon size={20} color="#a0a0a0" />
                    </View>
                    <View style={styles.fileDocInfo}>
                      <Text style={styles.fileDocName} numberOfLines={1}>{f.filename}</Text>
                      <Text style={styles.fileDocType}>{getFileExt(f.filename)}</Text>
                    </View>
                    <View style={styles.fileDocDownloadBtn}>
                      <ShareIcon size={16} color="#a0a0a0" />
                    </View>
                  </TouchableOpacity>
                ))}
                {item.files.length > 1 && (
                  <Text style={styles.fileViewAllLink}>View all files in this task</Text>
                )}
              </View>
            );
          }

          return (
            <MessageComponent
              message={item}
            />
          );
        }}
        contentContainerStyle={[
          styles.messageList,
          messages.length === 0 && styles.messageListEmpty,
          Platform.OS === "android" && {
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        ListEmptyComponent={WelcomeScreen}
        ListFooterComponent={
          thinking.active ? (
            <View>
              <ThinkingIndicator label={thinking.label} />
              {isAgentMode && !planMsgIdRef.current && tools.length > 0 && (
                <View style={styles.inlineToolsBlock}>
                  {tools.slice(-3).map((tool, i) => (
                    <InlineToolStep key={tool.tool_call_id || i} tool={tool} />
                  ))}
                </View>
              )}
            </View>
          ) : taskCompleted ? (
            <View style={styles.taskCompletedWrap}>
              <TouchableOpacity
                style={styles.taskCompletedBanner}
                onPress={() => setTaskCompletedExpanded(!taskCompletedExpanded)}
                activeOpacity={0.8}
              >
                <View style={styles.taskCompletedIcon}>
                  <CheckIcon size={13} color="#ffffff" />
                </View>
                <Text style={styles.taskCompletedText}>Task Completed</Text>
                {taskCompletedExpanded
                  ? <ChevronUpIcon size={14} color="#888888" />
                  : <ChevronDownIcon size={14} color="#888888" />
                }
              </TouchableOpacity>
              {taskCompletedExpanded && completedSteps.length > 0 && (
                <View style={styles.taskCompletedSteps}>
                  {completedSteps.map((step, i) => (
                    <View key={step.id || i} style={styles.taskCompletedStepRow}>
                      <CheckCircleIcon size={13} color="#888888" />
                      <Text style={styles.taskCompletedStepText} numberOfLines={2}>
                        {step.description}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
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
        onAttachmentsChange={setAttachments}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  header: {
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: "#1a1a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 8,
  },
  headerBrand: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#e0e0e0",
    letterSpacing: -0.3,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#e0e0e0",
    flex: 1,
  },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  modeBadgeChat: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "#333333",
  },
  modeBadgeAgent: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "#333333",
  },
  modeBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
  modeBadgeTextChat: {
    color: "#888888",
  },
  modeBadgeTextAgent: {
    color: "#888888",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  settingsOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  settingsPanel: {
    backgroundColor: "#242424",
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  settingsPanelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#e0e0e0",
    marginBottom: 4,
  },
  settingsSection: {
    gap: 10,
  },
  settingsSectionTitle: {
    fontSize: 13,
    color: "#606060",
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
    borderColor: "#2a2a2a",
    alignItems: "center",
    backgroundColor: "#222222",
  },
  langBtnActive: {
    backgroundColor: "#3a3a3a",
    borderColor: "#4a4a4a",
  },
  langBtnText: {
    color: "#888888",
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
    borderTopColor: "#2a2a2a",
  },
  logoutBtnText: {
    color: "#f87171",
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
    backgroundColor: "rgba(22,163,74,0.12)",
  },
  e2bError: {
    backgroundColor: "rgba(220,38,38,0.1)",
  },
  e2bChecking: {
    backgroundColor: "#2a2a2a",
  },
  e2bBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#888888",
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
    color: "#a0a0a0",
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#2a2a2a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  fileCardName: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#242424",
  },
  fileCardAction: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#a0a0a0",
    fontWeight: "600",
  },
  screenshotContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignItems: "flex-start",
  },
  screenshotImage: {
    width: "100%",
    maxWidth: 480,
    aspectRatio: 16 / 10,
    borderRadius: 10,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  agentTurnBlock: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 6,
  },
  agentTurnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  agentTurnIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "#2c4eb0",
    alignItems: "center",
    justifyContent: "center",
  },
  agentTurnLogo: {
    width: 22,
    height: 22,
    borderRadius: 6,
    overflow: "hidden",
  },
  agentTurnName: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#e0e0e0",
    letterSpacing: -0.2,
  },
  agentTurnBadgeRunning: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(100,100,100,0.1)",
    borderWidth: 1,
    borderColor: "rgba(100,100,100,0.2)",
  },
  agentTurnBadgeDone: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(100,100,100,0.08)",
    borderWidth: 1,
    borderColor: "rgba(100,100,100,0.2)",
  },
  agentTurnBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#888888",
    letterSpacing: -0.1,
  },
  fileCardsBlock: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  fileDocCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#242424",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileDocIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileDocInfo: {
    flex: 1,
    gap: 2,
  },
  fileDocName: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#e0e0e0",
    lineHeight: 18,
  },
  fileDocType: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#888888",
    letterSpacing: 0.2,
  },
  fileDocDownloadBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileViewAllLink: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#888888",
    paddingLeft: 2,
    paddingTop: 2,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  thinkingDotWrap: {
    width: 10,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  thinkingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#c8c8c8",
  },
  thinkingDotPulse: {
    backgroundColor: "#888888",
  },
  thinkingLabel: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#a0a0a0",
    fontStyle: "italic",
  },
  taskCompletedWrap: {
    marginHorizontal: 16,
    marginVertical: 6,
  },
  taskCompletedSteps: {
    paddingLeft: 30,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 5,
  },
  taskCompletedStepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  taskCompletedStepText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#888888",
    flex: 1,
    lineHeight: 17,
  },
  taskCompletedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  taskCompletedIcon: {
    width: 20,
    height: 20,
    borderRadius: 5,
    backgroundColor: "#404040",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  taskCompletedText: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#a0a0a0",
    letterSpacing: -0.2,
  },
  flatList: {
    flex: 1,
  },
  messageListEmpty: {
    flexGrow: 1,
  },
  welcomeContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 48,
    gap: 20,
    justifyContent: "flex-start",
  },
  welcomeContent: {
    gap: 6,
  },
  welcomeGreeting: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: "#e0e0e0",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  welcomeSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    color: "#888888",
    lineHeight: 22,
  },
  suggestionScrollView: {
    flexGrow: 0,
  },
  suggestionScrollContent: {
    paddingRight: 20,
    gap: 10,
    flexDirection: "row",
  },
  suggestionChip: {
    width: 160,
    backgroundColor: "#242424",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionChipText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
    lineHeight: 18,
  },
  toolsBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#4a7cf0",
    alignItems: "center",
    justifyContent: "center",
  },
  toolsBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#ffffff",
  },
  toolsBtnActive: {
    backgroundColor: "rgba(37,99,235,0.1)",
  },
  inlineToolsBlock: {
    marginLeft: 30,
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 0,
    paddingVertical: 2,
    gap: 1,
  },
});
