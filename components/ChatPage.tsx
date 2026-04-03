import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Text, TouchableOpacity, Linking, Modal, Image, Share, Alert, ScrollView, Animated, Easing } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ChatMessage as MessageComponent } from "./ChatMessage";
import { ChatBox } from "./ChatBox";
import { AgentPlanView } from "./AgentPlanView";
import { ToolDetailModal } from "./ToolDetailModal";
import {
  ShareIcon, LogOutIcon, EllipsisIcon,
  SettingsIcon, ServerIcon,
  CheckCircleIcon, DocumentTextIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronBackIcon,
  StarIcon,
} from "@/components/icons/SvgIcon";
import { ShellIcon, BrowserIcon, EditIcon, SearchIcon, MessageIcon } from "@/components/icons/ToolIcons";
import { apiService, AgentEvent, ChatMessage as ApiChatMessage, getStoredToken, getApiBaseUrl } from "../lib/api-service";
import { processAgentEvent } from "../lib/agent-event-processor";
import { saveActiveSessionId, loadActiveSessionId, clearActiveSessionId, saveActiveSessionLastId, loadActiveSessionLastId } from "../lib/storage";
import { randomUUID } from "expo-crypto";
import { useI18n, t as translate } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { MCPPanel } from "./MCPPanel";
import { SettingsPanel } from "./SettingsPanel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cleanAgentText } from "@/lib/text-utils";
import { getToolDisplayInfo, getToolCategory } from "@/lib/tool-constants";
import type { ToolContent } from "@/lib/chat";

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
  stepNotifyMessages?: { stepId: string; text: string }[];
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

function AnimatedPlanDot() {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return <Animated.View style={[planDotStyles.dot, { opacity: pulseAnim }]} />;
}

const planDotStyles = StyleSheet.create({
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#4a7cf0",
  },
});

function ManusThinkingIndicator({ label }: { label: string }) {
  const pulseAnim = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={thinkingStyles.row}>
      <Animated.View style={[thinkingStyles.blueDot, { opacity: pulseAnim }]} />
      <Text style={thinkingStyles.label} numberOfLines={1}>{label || "Sedang berpikir"}</Text>
    </View>
  );
}

const thinkingStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  blueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4A90D9",
    flexShrink: 0,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
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

function buildInlineLabel(fnName: string, args: Record<string, unknown>): string {
  // Browser-specific richer labels
  if (fnName === "browser_navigate" || fnName === "web_browse") {
    const url = String(args.url || args.page || "");
    if (url) {
      try {
        const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
        return `Navigasi ke ${domain}`;
      } catch {
        return `Navigasi ke ${url.slice(0, 40)}`;
      }
    }
    return "Navigasi halaman";
  }
  if (fnName === "browser_scroll") {
    const dir = String(args.direction || "").toLowerCase();
    const page = String(args.page || args.url || "");
    const dirLabel = dir === "up" ? "ke atas" : dir === "down" ? "ke bawah" : dir ? `ke ${dir}` : "";
    if (page) {
      try {
        const domain = new URL(page.startsWith("http") ? page : `https://${page}`).hostname.replace(/^www\./, "");
        return `Scroll ${dirLabel} di ${domain}`.trim();
      } catch {}
    }
    return dirLabel ? `Scroll ${dirLabel}` : "Scroll halaman";
  }
  if (fnName === "browser_click") {
    const sel = String(args.selector || args.element || args.label || args.text || "");
    if (sel) return `Klik: ${sel.slice(0, 45)}`;
    return "Klik elemen";
  }
  if (fnName === "browser_type" || fnName === "browser_input") {
    const text = String(args.text || args.value || args.input || "");
    const field = String(args.selector || args.field || "");
    if (text && field) return `Mengetik '${text.slice(0, 30)}' di ${field.slice(0, 25)}`;
    if (text) return `Mengetik: '${text.slice(0, 40)}'`;
    return "Mengetik teks";
  }
  if (fnName === "browser_view") {
    const page = String(args.page || args.url || "");
    if (page) {
      try {
        const domain = new URL(page.startsWith("http") ? page : `https://${page}`).hostname.replace(/^www\./, "");
        return `Melihat ${domain}`;
      } catch {}
    }
    return "Melihat halaman";
  }
  if (fnName === "browser_tab_new") {
    const url = String(args.url || "");
    if (url) {
      try {
        const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
        return `Tab baru: ${domain}`;
      } catch {}
    }
    return "Buka tab baru";
  }
  // Search tools
  if (fnName === "web_search" || fnName === "info_search_web") {
    const q = String(args.query || args.q || "");
    if (q) return `Mencari '${q.slice(0, 45)}'`;
    return "Mencari informasi";
  }
  // Shell tools
  if (fnName === "shell_exec") {
    const cmd = String(args.command || args.cmd || "");
    if (cmd) return `Jalankan: ${cmd.slice(0, 45)}`;
    return "Jalankan perintah";
  }
  // File tools
  if (fnName === "file_read") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Membaca ${file.slice(0, 45)}`;
    return "Membaca file";
  }
  if (fnName === "file_write") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Menulis ${file.slice(0, 45)}`;
    return "Menulis file";
  }
  if (fnName === "file_str_replace") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Mengedit ${file.slice(0, 45)}`;
    return "Mengedit file";
  }
  if (fnName === "message_notify_user") {
    const text = String(args.text || args.message || "");
    if (text) return `Notifikasi: ${text.slice(0, 40)}`;
    return "Notifikasi";
  }
  if (fnName === "message_ask_user") {
    const text = String(args.text || args.question || "");
    if (text) return `Tanya: ${text.slice(0, 40)}`;
    return "Pertanyaan";
  }
  // Generic fallback
  const primaryArgMap: Record<string, string> = {
    file_find_by_name: "path", file_find_in_content: "file",
  };
  const actionMap: Record<string, string> = {
    shell_view: "Lihat output",
    file_find_by_name: "Cari file", file_find_in_content: "Cari dalam",
  };
  const argKey = primaryArgMap[fnName];
  let argVal = argKey && args[argKey] ? String(args[argKey]) : "";
  if (!argVal) {
    const first = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
    argVal = first ? String(args[first] || "") : "";
  }
  argVal = argVal.replace(/^\/home\/ubuntu\//, "~/");
  if (argVal.length > 50) argVal = argVal.slice(0, 50) + "…";
  const action = actionMap[fnName];
  if (action && argVal) return `${action}: ${argVal}`;
  if (action) return action;
  return TOOL_LABEL_MAP[fnName] || fnName;
}


function InlineSpinner() {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View style={inlineSpinnerStyles.ring} />
    </Animated.View>
  );
}

const inlineSpinnerStyles = StyleSheet.create({
  ring: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#4a7cf0",
    borderTopColor: "transparent",
  },
});

function ManusInlineToolStep({ tool }: { tool: any }) {
  const fnName = tool.function_name || tool.name || "tool";
  const args = (tool.function_args || tool.input || {}) as Record<string, unknown>;
  const label = buildInlineLabel(fnName, args);
  const status = tool.status;

  const isRunning = status === "calling";
  const isDone = status === "called";
  const isError = status === "error";

  const category = getToolCategory(fnName);
  const iconColor = isRunning ? "#4a7cf0" : isDone ? "#4CAF50" : isError ? "#e05c5c" : "#666666";
  let iconEl: React.ReactNode;
  switch (category) {
    case "browser":
    case "desktop":
      iconEl = <BrowserIcon size={12} color={iconColor} />;
      break;
    case "file":
    case "image":
    case "multimedia":
      iconEl = <EditIcon size={12} color={iconColor} />;
      break;
    case "search":
    case "info":
      iconEl = <SearchIcon size={12} color={iconColor} />;
      break;
    case "message":
    case "todo":
    case "task":
    case "email":
      iconEl = <MessageIcon size={12} color={iconColor} />;
      break;
    default:
      iconEl = <ShellIcon size={12} color={iconColor} />;
      break;
  }

  return (
    <View style={inlineToolStyles.row}>
      <View style={[inlineToolStyles.iconWrap, isRunning && { backgroundColor: "rgba(74,124,240,0.1)" }, isDone && { backgroundColor: "rgba(76,175,80,0.08)" }]}>
        {iconEl}
      </View>
      <Text style={[inlineToolStyles.label, isRunning && { color: "#a0b4e8" }, isDone && { color: "#888888" }, isError && { color: "#c07070" }]} numberOfLines={1}>{label}</Text>
      <View style={inlineToolStyles.statusWrap}>
        {isRunning && <InlineSpinner />}
        {isDone && <Text style={inlineToolStyles.checkMark}>✓</Text>}
        {isError && <Text style={inlineToolStyles.errorMark}>✕</Text>}
      </View>
    </View>
  );
}

const inlineToolStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  iconWrap: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#1e1e1e",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
    flex: 1,
  },
  statusWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkMark: {
    fontSize: 11,
    color: "#4CAF50",
    fontWeight: "700",
  },
  errorMark: {
    fontSize: 10,
    color: "#e05c5c",
    fontWeight: "700",
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
  const [completedSteps, setCompletedSteps] = useState<Array<{ id: string; description: string }>>([]);
  const [taskFinalNarrative, setTaskFinalNarrative] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<{
    functionName: string;
    functionArgs: Record<string, unknown>;
    status: string;
    toolContent?: ToolContent;
    functionResult?: string;
    label: string;
    icon: string;
    iconColor: string;
  } | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const msgCounterRef = useRef(0);
  const nextMsgId = (suffix?: string) => `msg_${Date.now()}_${msgCounterRef.current++}${suffix ? `_${suffix}` : ""}`;
  const activeSessionIdRef = useRef<string>(externalSessionId || randomUUID());
  const planMsgIdRef = useRef<string | null>(null);
  const currentPlanRef = useRef<AgentPlan | null>(null);
  const currentRunningStepIdRef = useRef<string | null>(null);
  const lastNotifyTextRef = useRef<string | null>(null);
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
  const [activePlanTitle, setActivePlanTitle] = useState<string | null>(null);
  const [planBarExpanded, setPlanBarExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [starRating, setStarRating] = useState(0);
  const [planHistory, setPlanHistory] = useState<AgentPlan[]>([]);
  const [activePlanIndex, setActivePlanIndex] = useState(0);

  useEffect(() => {
    if (flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, streamingContent, isLoading]);

  // Floating plan bar: start/stop elapsed timer when agent is running
  useEffect(() => {
    if (isLoading && isAgentMode) {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds(s => s + 1);
      }, 1000);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (!isLoading) {
        setActivePlanTitle(null);
        setPlanBarExpanded(false);
      }
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [isLoading, isAgentMode]);

  // Load active model: user prefs (per-user MongoDB) take priority over global config
  useEffect(() => {
    const base = getApiBaseUrl();
    const token = getStoredToken();
    const authHdr = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch(`${base}/api/user/prefs`, { headers: authHdr }).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({})),
    ]).then(([prefs, cfg]) => {
      const m = prefs.model || cfg.modelName || cfg.G4F_MODEL;
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
          if (planData.title) setActivePlanTitle(planData.title);
          setPlanHistory(prev => {
            const exists = prev.some(p => p.id === planData.id);
            if (exists) return prev;
            const updated = [...prev, planData];
            setActivePlanIndex(updated.length - 1);
            return updated;
          });
        } else if (planData && planMsgIdRef.current) {
          currentPlanRef.current = planData;
          setMessages(prev => prev.map(m =>
            m.id === planMsgIdRef.current ? { ...m, plan: planData } : m
          ));
          setPlanHistory(prev => prev.map(p => p.id === planData.id ? planData : p));
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
          currentRunningStepIdRef.current = step.id;
          setStepHistory(prev => {
            if (prev.length > 0 && prev[prev.length - 1] === step.description) return prev;
            return [...prev, step.description];
          });
          setThinking({ active: true, label: step.description, stepLabel: step.description });
        } else if (status === "completed" || status === "failed") {
          if (step?.id === currentRunningStepIdRef.current) {
            currentRunningStepIdRef.current = null;
          }
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

        // Build a descriptive live status label for the thinking indicator
        const buildLiveStatusLabel = (fn: string, toolArgs: Record<string, any> | undefined): string => {
          if (fn === "browser_navigate" || fn === "web_browse") {
            const url = String((toolArgs?.url || toolArgs?.page || ""));
            if (url) {
              try {
                const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
                return `Menggunakan peramban: ${domain}`;
              } catch {}
            }
            return "Menggunakan peramban";
          }
          if (fn === "browser_scroll") {
            const dir = String(toolArgs?.direction || "").toLowerCase();
            return dir === "up" ? "Scroll ke atas" : dir === "down" ? "Scroll ke bawah" : "Scroll halaman";
          }
          if (fn === "browser_click") {
            const el = String(toolArgs?.selector || toolArgs?.element || toolArgs?.label || toolArgs?.text || "");
            return el ? `Klik: ${el.slice(0, 40)}` : "Mengklik elemen";
          }
          if (fn === "browser_type" || fn === "browser_input") {
            const text = String(toolArgs?.text || toolArgs?.value || "");
            return text ? `Mengetik: '${text.slice(0, 35)}'` : "Mengetik teks";
          }
          if (fn === "browser_view") return "Melihat halaman";
          if (fn === "web_search" || fn === "info_search_web") {
            const q = String(toolArgs?.query || toolArgs?.q || "");
            return q ? `Sedang mencari '${q.slice(0, 40)}'...` : "Mencari informasi terbaru...";
          }
          if (fn === "shell_exec") {
            const cmd = String(toolArgs?.command || "");
            return cmd ? `Menjalankan: ${cmd.slice(0, 40)}` : "Menjalankan perintah";
          }
          if (fn === "file_read") {
            const file = String(toolArgs?.file || toolArgs?.path || "").replace(/^\/home\/ubuntu\//, "~/");
            return file ? `Membaca file ${file.slice(0, 40)}` : "Membaca file";
          }
          if (fn === "file_write") {
            const file = String(toolArgs?.file || toolArgs?.path || "").replace(/^\/home\/ubuntu\//, "~/");
            return file ? `Mengedit file ${file.slice(0, 40)}` : "Menulis file";
          }
          if (fn === "file_str_replace") {
            const file = String(toolArgs?.file || toolArgs?.path || "").replace(/^\/home\/ubuntu\//, "~/");
            return file ? `Mengedit file ${file.slice(0, 40)}` : "Mengedit file";
          }
          if (fn === "message_notify_user" || fn === "message_ask_user") return "Mengirim pesan";
          // Category fallbacks
          const toolLabels: Record<string, string> = {
            browser: "Menggunakan peramban",
            shell: "Menjalankan perintah",
            file: "Memproses file",
            search: "Mencari informasi...",
            mcp: "Memanggil MCP",
            todo: "Mengatur todo",
            task: "Mengelola tugas",
            message: "Mengirim pesan",
          };
          return toolLabels[toolName] || `Menggunakan ${toolName}`;
        };
        const thinkLabel = buildLiveStatusLabel(functionName, args);

        // Helper: update a tool entry inside the currently-running plan step
        const upsertToolInCurrentStep = (updater: (prev: any[]) => any[]) => {
          if (!currentPlanRef.current || !planMsgIdRef.current) return;
          const stepId = currentRunningStepIdRef.current;
          if (!stepId) return;
          const updatedSteps = currentPlanRef.current.steps.map(s => {
            if (s.id !== stepId) return s;
            const stepTools: any[] = (s as any).tools || [];
            return { ...s, tools: updater(stepTools) };
          });
          const updatedPlan: AgentPlan = { ...currentPlanRef.current, steps: updatedSteps };
          currentPlanRef.current = updatedPlan;
          setMessages(prev => prev.map(m =>
            m.id === planMsgIdRef.current ? { ...m, plan: updatedPlan } : m
          ));
        };

        if (status === "calling") {
          setThinking({ active: true, label: thinkLabel });
          const newToolEntry = {
            tool_call_id: callId,
            type: "tool",
            name: toolName,
            function_name: functionName,
            status: "calling",
            input: args,
            function_args: args,
          };
          setTools(prev => {
            const idx = prev.findIndex(t => t.tool_call_id === callId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], status: "calling", function_name: functionName };
              return updated;
            }
            return [...prev, newToolEntry];
          });
          upsertToolInCurrentStep(stepTools => {
            const idx = stepTools.findIndex(t => t.tool_call_id === callId);
            if (idx >= 0) return stepTools;
            return [...stepTools, newToolEntry];
          });
        } else if (status === "called") {
          const normalizeShot = (s: string) =>
            s && !s.startsWith("data:") ? `data:image/png;base64,${s}` : s;
          setTools(prev => {
            const idx = prev.findIndex(t => t.tool_call_id === callId);
            if (idx >= 0) {
              const updated = [...prev];
              const existing = updated[idx];
              // Deep-merge tool_content: preserve screenshot_b64/url/title from prior events
              const prevTc = existing.tool_content || {};
              const newTc = toolContent || {};
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
          upsertToolInCurrentStep(stepTools => {
            const idx = stepTools.findIndex(t => t.tool_call_id === callId);
            if (idx >= 0) {
              const updated = [...stepTools];
              const existing = updated[idx];
              const prevTc = existing.tool_content || {};
              const newTc = toolContent || {};
              const newShot = (newTc.screenshot_b64 && !newTc.screenshot_b64.startsWith("data:"))
                ? `data:image/png;base64,${newTc.screenshot_b64}`
                : (newTc.screenshot_b64 || "");
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
                function_result: result,
                tool_content: mergedTc,
              };
              return updated;
            }
            return stepTools;
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
          upsertToolInCurrentStep(stepTools => {
            const idx = stepTools.findIndex(t => t.tool_call_id === callId);
            if (idx >= 0) {
              const updated = [...stepTools];
              updated[idx] = {
                ...updated[idx],
                status: "error",
                function_name: functionName,
                error: result,
                function_result: result,
              };
              return updated;
            }
            return stepTools;
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
            setTaskFinalNarrative(lastNotifyTextRef.current);
            lastNotifyTextRef.current = null;
            setTaskCompleted(true);
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
            content: ev.text ? cleanAgentText(ev.text) : "",
            timestamp: Date.now(),
            files: newFiles,
          };
          setMessages(prev => [...prev, filesMsg]);
        } else if (ev.text) {
          const cleanedText = cleanAgentText(ev.text);
          if (!cleanedText) return;
          lastNotifyTextRef.current = cleanedText;
          if (planMsgIdRef.current) {
            const stepId = currentRunningStepIdRef.current;
            setMessages(prev => prev.map(m => {
              if (m.id !== planMsgIdRef.current) return m;
              if (stepId) {
                return {
                  ...m,
                  stepNotifyMessages: [
                    ...(m.stepNotifyMessages || []),
                    { stepId, text: cleanedText },
                  ],
                };
              }
              return { ...m, notifyMessages: [...(m.notifyMessages || []), cleanedText] };
            }));
          } else {
            const notifyMsg: ChatMessage = {
              id: `msg_${Date.now()}_${msgCounterRef.current++}_notify`,
              role: "assistant",
              content: cleanedText,
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
    setCompletedSteps([]);
    setTaskFinalNarrative(null);
    setStarRating(0);
    lastNotifyTextRef.current = null;
    if (!wasContinuation) {
      setStepHistory([]);
      planMsgIdRef.current = null;
      currentPlanRef.current = null;
      currentRunningStepIdRef.current = null;
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
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={onToggleLeftPanel}
            style={styles.headerBackBtn}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          >
            <ChevronBackIcon size={22} color="#b0b0b0" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAgentModeChange?.(!isAgentMode)}
            style={styles.headerBrandRow}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6 }}
          >
            <Text style={styles.headerBrandName}>Dzeck 1.6 {isAgentMode ? "Agent" : "Lite"}</Text>
            <ChevronDownIcon size={14} color="#888888" />
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
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
              <LogOutIcon size={16} color="#888888" />
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
        renderItem={({ item, index }) => {
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

          // Assistant message immediately before a plan — suppress standalone render
          // It will be shown inline above the plan view instead
          if (item.role === "assistant" && !item.plan && !item.files && !item.error && item.content) {
            const nextMsg = messages[index + 1];
            if (nextMsg && nextMsg.plan) {
              return null;
            }
          }

          // Plan message — Manus-style: agent header (dzeck + Agent badge) + text + collapsible task
          if (item.plan) {
            const isPlanRunning = item.plan.status === "running" || item.plan.steps.some(s => s.status === "running");
            const isPlanDone = item.plan.status === "completed" || item.plan.steps.every(s => s.status === "completed" || s.status === "failed");
            // Check if there's a preceding assistant message to show above plan
            const prevMsg = messages[index - 1];
            const precedingText = prevMsg && prevMsg.role === "assistant" && !prevMsg.plan && !prevMsg.files && !prevMsg.error && prevMsg.content
              ? cleanAgentText(prevMsg.content)
              : null;
            return (
              <View style={styles.agentTurnBlock}>
                <View style={styles.agentTurnHeader}>
                  <Text style={styles.agentTurnName}>dzeck</Text>
                  <View style={styles.agentTurnModeBadge}>
                    <Text style={styles.agentTurnModeBadgeText}>Agent</Text>
                  </View>
                </View>
                {precedingText ? (
                  <Text style={styles.agentPrecedingText}>{precedingText}</Text>
                ) : null}
                <AgentPlanView
                  plan={item.plan}
                  notifyMessages={item.notifyMessages}
                  stepNotifyMessages={item.stepNotifyMessages}
                  onToolPress={(tool) => {
                    setSelectedTool(tool);
                  }}
                />
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
                  <Text style={styles.agentTurnName}>dzeck</Text>
                  <View style={styles.agentTurnModeBadge}>
                    <Text style={styles.agentTurnModeBadgeText}>Agent</Text>
                  </View>
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
              <ManusThinkingIndicator label={thinking.label} />
              {isAgentMode && !planMsgIdRef.current && tools.length > 0 && (
                <View style={styles.inlineToolsBlock}>
                  {tools.slice(-3).map((tool, i) => (
                    <ManusInlineToolStep key={tool.tool_call_id || i} tool={tool} />
                  ))}
                </View>
              )}
            </View>
          ) : taskCompleted ? (
            <View style={styles.taskCompletedWrap}>
              {/* Manus-style: checkmark + task title + "Tugas telah selesai" */}
              <View style={styles.taskCompletedCard}>
                <View style={styles.taskCompletedCardHeader}>
                  <CheckCircleIcon size={18} color="#4CAF50" />
                  <Text style={styles.taskCompletedTitle}>Tugas telah selesai</Text>
                </View>
                {taskFinalNarrative ? (
                  <View style={styles.taskCompletedNarrative}>
                    <Text style={styles.taskCompletedNarrativeText}>{taskFinalNarrative}</Text>
                  </View>
                ) : null}
                {completedSteps.length > 0 && (
                  <View style={styles.taskCompletedSteps}>
                    {completedSteps.map((step, i) => (
                      <View key={step.id || i} style={styles.taskCompletedStepRow}>
                        <CheckCircleIcon size={14} color="#4CAF50" />
                        <Text style={styles.taskCompletedStepText} numberOfLines={2}>
                          {step.description}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Star rating row like Manus */}
                <View style={styles.starRatingRow}>
                  <Text style={styles.starRatingLabel}>
                    {starRating > 0 ? "Terima kasih atas penilaianmu!" : "Beri nilai hasil ini"}
                  </Text>
                  <View style={styles.starRatingStars}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <TouchableOpacity
                        key={n}
                        activeOpacity={0.7}
                        onPress={() => setStarRating(n)}
                      >
                        <StarIcon
                          size={22}
                          color={n <= starRating ? "#f5a623" : "#444444"}
                          filled={n <= starRating}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          ) : null
        }
      />

      {isAgentMode && isLoading && activePlanTitle ? (() => {
        const plan = currentPlanRef.current;
        const steps = plan?.steps || [];
        const completedCount = steps.filter(s => s.status === "completed").length;
        const totalCount = steps.length;
        return (
          <View style={styles.floatingPlanBarWrapper}>
            {planBarExpanded && plan && steps.length > 0 ? (
              <ScrollView style={styles.floatingPlanExpandedPanel} showsVerticalScrollIndicator={false}>
                {steps.map((step, i) => {
                  const isRunning = step.status === "running";
                  const isDone = step.status === "completed";
                  const isFailed = step.status === "failed";
                  return (
                    <View key={step.id || i} style={styles.floatingPlanStep}>
                      <View style={[
                        styles.floatingPlanStepDot,
                        isRunning && { backgroundColor: "#4a7cf0" },
                        isDone && { backgroundColor: "#4CAF50" },
                        isFailed && { backgroundColor: "#e05c5c" },
                      ]} />
                      <Text style={[
                        styles.floatingPlanStepText,
                        isRunning && { color: "#d0d0d0" },
                        isDone && { color: "#555555" },
                        isFailed && { color: "#c07070" },
                      ]} numberOfLines={2}>{step.description}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            ) : planBarExpanded && thinking.active && thinking.label ? (
              <View style={styles.floatingPlanExpandedSingle}>
                <Text style={styles.floatingPlanExpandedLabel} numberOfLines={2}>{thinking.label}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.floatingPlanBar}
              onPress={() => setPlanBarExpanded(v => !v)}
              activeOpacity={0.8}
            >
              <View style={styles.floatingPlanBarLeft}>
                <AnimatedPlanDot />
                <Text style={styles.floatingPlanTitle} numberOfLines={1}>{activePlanTitle}</Text>
              </View>
              {totalCount > 0 ? (
                <Text style={styles.floatingPlanCounter}>{completedCount} / {totalCount}</Text>
              ) : null}
              <Text style={styles.floatingPlanTimer}>
                {`${Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:${(elapsedSeconds % 60).toString().padStart(2, "0")}`}
              </Text>
              {planBarExpanded ? (
                <ChevronDownIcon size={14} color="#666666" />
              ) : (
                <ChevronUpIcon size={14} color="#666666" />
              )}
            </TouchableOpacity>
          </View>
        );
      })() : null}

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

      {selectedTool && (
        <ToolDetailModal
          visible={!!selectedTool}
          onClose={() => setSelectedTool(null)}
          functionName={selectedTool.functionName}
          functionArgs={selectedTool.functionArgs}
          label={selectedTool.label}
          icon={selectedTool.icon}
          iconColor={selectedTool.iconColor}
          status={selectedTool.status}
          toolContent={selectedTool.toolContent}
          functionResult={selectedTool.functionResult}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0D",
  },
  header: {
    paddingBottom: 10,
    paddingHorizontal: 12,
    backgroundColor: "#0D0D0D",
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e1e",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerBrandName: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#e0e0e0",
    letterSpacing: -0.3,
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
    color: "#888888",
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
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  e2bError: {
    backgroundColor: "rgba(255,255,255,0.04)",
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
  // Manus-style agent turn block
  agentTurnBlock: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  agentTurnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  agentTurnName: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#e0e0e0",
    letterSpacing: -0.2,
  },
  agentTurnModeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "#333333",
  },
  agentTurnModeBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#888888",
    letterSpacing: 0.1,
  },
  agentPrecedingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#e8e8e8",
    lineHeight: 22,
    letterSpacing: -0.1,
    marginBottom: 4,
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
    backgroundColor: "#1a1a1a",
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
    color: "#4A90D9",
    paddingLeft: 2,
    paddingTop: 2,
  },
  // Manus-style floating plan bar
  floatingPlanBarWrapper: {
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  floatingPlanExpandedPanel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingBottom: 12,
    backgroundColor: "#111111",
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e1e",
    maxHeight: 200,
  },
  floatingPlanExpandedSingle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#111111",
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e1e",
  },
  floatingPlanExpandedLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#888888",
    fontStyle: "italic",
    lineHeight: 18,
  },
  floatingPlanStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
  },
  floatingPlanStepDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#333333",
    flexShrink: 0,
  },
  floatingPlanStepText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#666666",
    lineHeight: 17,
  },
  floatingPlanBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#141414",
  },
  floatingPlanBarLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  floatingPlanDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#4a7cf0",
  },
  floatingPlanTitle: {
    flex: 1,
    color: "#a0a0a0",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  floatingPlanCounter: {
    color: "#666666",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  floatingPlanTimer: {
    color: "#555555",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  // Manus-style task completed
  taskCompletedWrap: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  taskCompletedCard: {
    backgroundColor: "#161616",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    overflow: "hidden",
    paddingBottom: 8,
  },
  taskCompletedCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  taskCompletedTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#e8e8e8",
    letterSpacing: -0.2,
  },
  taskCompletedSteps: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  taskCompletedStepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  taskCompletedStepText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#b0b0b0",
    flex: 1,
    lineHeight: 19,
  },
  taskCompletedNarrative: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#111111",
    borderRadius: 8,
  },
  taskCompletedNarrativeText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#d0d0d0",
    lineHeight: 21,
  },
  // Star rating like Manus
  starRatingRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
    marginTop: 4,
    gap: 8,
  },
  starRatingLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
  },
  starRatingStars: {
    flexDirection: "row",
    gap: 8,
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
    backgroundColor: "#1a1a1a",
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
    backgroundColor: "#444444",
    alignItems: "center",
    justifyContent: "center",
  },
  toolsBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#ffffff",
  },
  toolsBtnActive: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  inlineToolsBlock: {
    marginLeft: 16,
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 0,
    paddingVertical: 2,
    gap: 1,
  },
});
