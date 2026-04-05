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
  StarIcon, NativeIcon,
} from "@/components/icons/SvgIcon";
import { ShellIcon, BrowserIcon, EditIcon, SearchIcon, MessageIcon } from "@/components/icons/ToolIcons";
import { apiService, AgentEvent, ChatMessage as ApiChatMessage, getStoredToken, getApiBaseUrl, DEFAULT_MODEL_FALLBACK } from "../lib/api-service";
import { processAgentEvent, AgentPhase } from "../lib/agent-event-processor";
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
  status: "pending" | "running" | "started" | "completed" | "failed";
  result?: string;
  error?: string;
}

interface AgentPlan {
  title: string;
  steps: AgentPlanStep[];
  status: "pending" | "running" | "created" | "updated" | "completed" | "failed";
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
    backgroundColor: "#3B82F6",
    flexShrink: 0,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#9CA3AF",
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
  onPlanChange?: (
    plan: import("@/lib/chat").AgentPlan | null,
    stepNotifyMessages: { stepId: string; text: string }[],
    notifyMessages: string[],
    isRunning: boolean,
  ) => void;
  /** Called when user taps a tool card in chat; provides the tool_call_id for ToolPanel to focus */
  onSelectTool?: (toolCallId: string) => void;
  /** Initial message to auto-send when the chat page first loads (e.g. from home page input) */
  initialMessage?: string;
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
  onPlanChange,
  onSelectTool,
  initialMessage,
}: ChatPageProps = {}) {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  const isAgentMode = agentModeProp ?? mode === "agent";
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("IDLE");
  const [thinking, setThinking] = useState({ active: false, label: "", stepLabel: "" as string | undefined });
  const [tools, setTools] = useState<any[]>([]);
  const [stepHistory, setStepHistory] = useState<string[]>([]);
  const [title, setTitle] = useState(isAgentMode ? "Dzeck Agent" : "Dzeck Chat");
  const [showSettings, setShowSettings] = useState(false);
  const [showMCPPanel, setShowMCPPanel] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [activeModel, setActiveModel] = useState(DEFAULT_MODEL_FALLBACK);
  const { locale, changeLocale } = useI18n();
  const { logout, user } = useAuth();
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
  const initialMessageSentRef = useRef(false);
  const planMsgIdRef = useRef<string | null>(null);
  const currentPlanRef = useRef<AgentPlan | null>(null);
  const currentRunningStepIdRef = useRef<string | null>(null);
  const lastStepIdRef = useRef<string | null>(null);
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
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [thoughtStream, setThoughtStream] = useState<string[]>([]);

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

  // Load active model: user prefs (per-user MongoDB) take priority over global config.
  // Falls back to DEFAULT_MODEL_FALLBACK if no preference is stored.
  useEffect(() => {
    const base = getApiBaseUrl();
    Promise.all([
      apiService.getUserPrefs(),
      fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({})),
    ]).then(([prefs, cfg]) => {
      const m = prefs.model || cfg.modelName || cfg.G4F_MODEL || DEFAULT_MODEL_FALLBACK;
      setActiveModel(m);
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

  // Load share status and rating for the initial externalSessionId (mount case)
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
    apiService.getSessionRating(externalSessionId)
      .then(({ rating }) => {
        if ((activeSessionIdRef.current === externalSessionId || !activeSessionIdRef.current) && rating > 0) {
          setStarRating(rating);
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

      if (!status.exists || status.status === "not_found" || status.status === "expired") {
        await clearActiveSessionId();
        setSessionEnded(true);
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
          } catch (err: unknown) {
            if (!cancelled) {
              setReconnectError(err instanceof Error ? err.message : "Failed to load session history");
            }
          }
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
        onError: (err?: Error) => {
          if (!cancelled) {
            setIsLoading(false);
            setThinking({ active: false, label: "" });
            clearActiveSessionId().catch(() => {});
            const msg = err?.message || "Failed to reconnect to session stream";
            const isNotFound = msg.includes("not found") || msg.includes("404") || msg.includes("max reconnect");
            if (isNotFound) {
              setSessionEnded(true);
            } else {
              setReconnectError(msg);
            }
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
      currentRunningStepIdRef.current = null;
      lastStepIdRef.current = null;
      streamingMsgIdRef.current = null;
      filesShownViaNotifyRef.current = false;
      setStreamingContent('');
      setThinking({ active: false, label: '', stepLabel: undefined });
      setAgentPhase("IDLE");
      setIsLoading(false);
      setIsWaitingForUser(false);
      isWaitingRef.current = false;
      setIsShared(false);
      setShareUrl(null);
      setReconnectError(null);
      setSessionEnded(false);
      setStarRating(0);

      apiService.getSessionRating(externalSessionId)
        .then(({ rating }) => {
          if (activeSessionIdRef.current === externalSessionId && rating > 0) {
            setStarRating(rating);
          }
        })
        .catch(() => {});

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

  // Auto-send initialMessage when component first mounts with a pre-populated message
  // (e.g. from the home page greeting input). Pre-fills the input; auto-submit fires
  // in the effect below once inputMessage state has been updated.
  const pendingInitialMsgRef = useRef<string | null>(initialMessage || null);
  const autoSubmitPendingRef = useRef(false);
  useEffect(() => {
    if (!pendingInitialMsgRef.current || initialMessageSentRef.current) return;
    initialMessageSentRef.current = true;
    const msg = pendingInitialMsgRef.current;
    pendingInitialMsgRef.current = null;
    autoSubmitPendingRef.current = true;
    setInputMessage(msg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Propagate tools changes to parent layout
  useEffect(() => {
    onToolsChange?.(tools);
  }, [tools, onToolsChange]);

  // Propagate live browser screenshot events to parent layout (for BrowserPanel)
  useEffect(() => {
    onBrowserEventChange?.(lastBrowserEvent);
  }, [lastBrowserEvent, onBrowserEventChange]);

  // Propagate active plan data to parent layout (for PlanPanel)
  useEffect(() => {
    if (!onPlanChange) return;
    if (!planMsgIdRef.current) {
      return;
    }
    const planMsg = messages.find(m => m.id === planMsgIdRef.current);
    if (!planMsg?.plan) return;
    onPlanChange(
      planMsg.plan,
      planMsg.stepNotifyMessages || [],
      planMsg.notifyMessages || [],
      isLoading,
    );
  }, [messages, isLoading, onPlanChange]);

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

        if (planStatus === "created") {
          setAgentPhase("PLANNING");
        } else if (planStatus === "updated") {
          setAgentPhase("UPDATING");
        } else if (planStatus === "completed") {
          setAgentPhase("IDLE");
        }

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
          setThinking({ active: true, label: "Merencanakan...", stepLabel: planData.title });
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
          if (planStatus === "updated") {
            setThinking({ active: true, label: "Memperbarui rencana..." });
          } else if (planStatus === "completed") {
            setThinking({ active: false, label: "" });
          }
        } else if (!planData) {
          setThinking({ active: true, label: "Merencanakan...", stepLabel: (ev.plan as any)?.title });
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

        if ((status === "running" || status === "started") && step?.description) {
          setAgentPhase("EXECUTING");
          lastStepIdRef.current = null;
          currentRunningStepIdRef.current = step.id;
          setStepHistory(prev => {
            if (prev.length > 0 && prev[prev.length - 1] === step.description) return prev;
            return [...prev, step.description];
          });
          setThinking({ active: true, label: step.description, stepLabel: step.description });
        } else if (status === "completed" || status === "failed") {
          if (step?.id === currentRunningStepIdRef.current) {
            lastStepIdRef.current = step.id;
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
          // Fall back to lastStepIdRef so tool "called" events arriving AFTER the step
          // completes (race condition) still update the correct step's tools array.
          const stepId = currentRunningStepIdRef.current || lastStepIdRef.current;
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
              const existing = prev[idx];
              // Status precedence: never regress a completed/errored tool back to calling
              if (existing.status === "called" || existing.status === "error") return prev;
              const updated = [...prev];
              updated[idx] = { ...existing, status: "calling", function_name: functionName };
              return updated;
            }
            return [...prev, newToolEntry];
          });
          upsertToolInCurrentStep(stepTools => {
            const idx = stepTools.findIndex(t => t.tool_call_id === callId);
            // Never regress completed/errored step tools back to calling
            if (idx >= 0) {
              const existing = stepTools[idx];
              if (existing.status === "called" || existing.status === "error") return stepTools;
            }
            if (idx >= 0) return stepTools;
            return [...stepTools, newToolEntry];
          });
        } else if (status === "called") {
          const normalizeShot = (s: string) =>
            s && !s.startsWith("data:") ? `data:image/png;base64,${s}` : s;
          setTools(prev => {
            const idx = prev.findIndex(t => t.tool_call_id === callId);
            const newTc = toolContent || {};
            const newShot = normalizeShot(newTc.screenshot_b64 || "");
            if (idx >= 0) {
              const updated = [...prev];
              const existing = updated[idx];
              // Deep-merge tool_content: preserve screenshot_b64/url/title from prior events
              const prevTc = existing.tool_content || {};
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
            // Tool arrived as "called" without a prior "calling" event — add it now
            const mergedTc = { ...newTc, screenshot_b64: newShot || "" };
            return [...prev, {
              tool_call_id: callId,
              type: "tool",
              name: toolName,
              function_name: functionName,
              status: "called" as const,
              input: args,
              function_args: args,
              output: result,
              function_result: result,
              tool_content: mergedTc,
            }];
          });
          upsertToolInCurrentStep(stepTools => {
            const idx = stepTools.findIndex(t => t.tool_call_id === callId);
            const newTc = toolContent || {};
            const newShot = (newTc.screenshot_b64 && !newTc.screenshot_b64.startsWith("data:"))
              ? `data:image/png;base64,${newTc.screenshot_b64}`
              : (newTc.screenshot_b64 || "");
            if (idx >= 0) {
              const updated = [...stepTools];
              const existing = updated[idx];
              const prevTc = existing.tool_content || {};
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
            // Add tool if it arrived as "called" without prior "calling"
            return [...stepTools, {
              tool_call_id: callId,
              type: "tool",
              name: toolName,
              function_name: functionName,
              status: "called" as const,
              input: args,
              function_args: args,
              output: result,
              function_result: result,
              tool_content: { ...newTc, screenshot_b64: newShot || "" },
            }];
          });
        } else if (status === "error") {
          const normalizeShot = (s: string) =>
            s && !s.startsWith("data:") ? `data:image/png;base64,${s}` : s;
          setTools(prev => {
            const idx = prev.findIndex(t => t.tool_call_id === callId);
            const newTc = toolContent || {};
            const newShot = normalizeShot(newTc.screenshot_b64 || "");
            if (idx >= 0) {
              const updated = [...prev];
              const existing = updated[idx];
              const prevTc = existing.tool_content || {};
              const mergedTc = {
                ...prevTc,
                ...newTc,
                screenshot_b64: newShot || prevTc.screenshot_b64 || "",
                url: newTc.url || prevTc.url || "",
                title: newTc.title || prevTc.title || "",
              };
              updated[idx] = {
                ...existing,
                status: "error",
                function_name: functionName,
                error: result,
                tool_content: mergedTc,
              };
              return updated;
            }
            // Tool arrived as "error" without a prior "calling" event — add it now
            return [...prev, {
              tool_call_id: callId,
              type: "tool",
              name: toolName,
              function_name: functionName,
              status: "error" as const,
              input: args,
              function_args: args,
              error: result,
              tool_content: { ...newTc, screenshot_b64: newShot || "" },
            }];
          });
          upsertToolInCurrentStep(stepTools => {
            const idx = stepTools.findIndex(t => t.tool_call_id === callId);
            const newTc = toolContent || {};
            const newShot = (newTc.screenshot_b64 && !newTc.screenshot_b64.startsWith("data:"))
              ? `data:image/png;base64,${newTc.screenshot_b64}`
              : (newTc.screenshot_b64 || "");
            if (idx >= 0) {
              const updated = [...stepTools];
              const existing = updated[idx];
              const prevTc = existing.tool_content || {};
              const mergedTc = {
                ...prevTc,
                ...newTc,
                screenshot_b64: newShot || prevTc.screenshot_b64 || "",
                url: newTc.url || prevTc.url || "",
                title: newTc.title || prevTc.title || "",
              };
              updated[idx] = {
                ...existing,
                status: "error",
                function_name: functionName,
                error: result,
                function_result: result,
                tool_content: mergedTc,
              };
              return updated;
            }
            // Tool arrived as "error" without a prior "calling" event — add it to step history too
            return [...stepTools, {
              tool_call_id: callId,
              type: "tool",
              name: toolName,
              function_name: functionName,
              status: "error" as const,
              input: args,
              function_args: args,
              error: result,
              function_result: result,
              tool_content: { ...newTc, screenshot_b64: newShot || "" },
            }];
          });
        }
        return;
      }

      case "thinking": {
        if (ev.text) {
          setThoughtStream(prev => [...prev.slice(-4), ev.text]); // Keep last 5 thoughts
        }
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
        setAgentPhase("IDLE");
        setThinking({ active: false, label: "", stepLabel: undefined });
        currentRunningStepIdRef.current = null;
        lastStepIdRef.current = null;
        setIsLoading(false);
        if (isAgentMode && currentPlanRef.current) {
          const steps = currentPlanRef.current?.steps || [];
          if (steps.length > 0) {
            const allCompleted = steps.map(s =>
              s.status !== "completed" && s.status !== "failed"
                ? { ...s, status: "completed" as const }
                : s
            );
            const updatedPlan: AgentPlan = { ...currentPlanRef.current, steps: allCompleted, status: "completed" };
            currentPlanRef.current = updatedPlan;
            if (planMsgIdRef.current) {
              setMessages(prev => prev.map(m =>
                m.id === planMsgIdRef.current ? { ...m, plan: updatedPlan } : m
              ));
            }
            setCompletedSteps(allCompleted.map(s => ({ id: s.id, description: s.description })));
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
            const stepId = currentRunningStepIdRef.current || lastStepIdRef.current;
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
        setAgentPhase("IDLE");
        setThinking({ active: false, label: "" });
        currentRunningStepIdRef.current = null;
        lastStepIdRef.current = null;
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

      case "waiting_for_user": {
        setAgentPhase("IDLE");
        setThinking({ active: false, label: "" });
        setIsWaitingForUser(true);
        isWaitingRef.current = true;
        setIsLoading(false);
        return;
      }

      case "summarize": {
        setAgentPhase("SUMMARIZING");
        setThinking({ active: true, label: "Menyimpulkan..." });
        if (ev.text) {
          const summaryMsg: ChatMessage = {
            id: `msg_${Date.now()}_${msgCounterRef.current++}_summary`,
            role: "assistant",
            content: ev.text,
            timestamp: Date.now(),
            isStreaming: false,
          };
          setMessages(prev => [...prev, summaryMsg]);
        }
        return;
      }

      case "todo_update": {
        if (ev.items && ev.items.length > 0) {
          const todoMsg: ChatMessage = {
            id: `msg_${Date.now()}_${msgCounterRef.current++}_todo`,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            todoItems: ev.items,
          };
          setMessages(prev => [...prev, todoMsg]);
        }
        return;
      }

      case "task_update": {
        if (ev.task) {
          const taskMsg: ChatMessage = {
            id: `msg_${Date.now()}_${msgCounterRef.current++}_task`,
            role: "assistant",
            content: ev.task.title || ev.task.description || "",
            timestamp: Date.now(),
            taskUpdate: ev.task,
          };
          setMessages(prev => [...prev, taskMsg]);
        }
        return;
      }

      case "search_results": {
        if (ev.results && ev.results.length > 0) {
          const searchMsg: ChatMessage = {
            id: `msg_${Date.now()}_${msgCounterRef.current++}_search`,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            searchResults: ev.results,
            searchQuery: ev.query,
          };
          setMessages(prev => [...prev, searchMsg]);
        }
        return;
      }

      case "shell_output": {
        if (ev.output) {
          setTools(prev => {
            const idx = ev.callId ? prev.findIndex(t => t.tool_call_id === ev.callId) : -1;
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], output: (updated[idx].output || "") + ev.output };
              return updated;
            }
            return prev;
          });
        }
        return;
      }

      default:
        return;
    }
  }, [onVncSessionChange, onSessionFilesChange, isAgentMode]);

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
      lastStepIdRef.current = null;
    }
    setAgentPhase("PLANNING");
    setThinking({ active: true, label: isAgentMode ? "Merencanakan..." : "Memikirkan jawaban..." });

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

  // Fire auto-submit once inputMessage has been populated from initialMessage
  useEffect(() => {
    if (!autoSubmitPendingRef.current || !inputMessage.trim()) return;
    autoSubmitPendingRef.current = false;
    handleSubmit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMessage]);

  const handleStop = useCallback(() => {
    const sid = activeSessionIdRef.current;

    // Cancel the SSE stream immediately on the client side
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsLoading(false);
    setAgentPhase("IDLE");
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
          {(() => {
            const firstName = user?.fullname?.trim().split(/\s+/)[0] || null;
            return locale === "id"
              ? `Halo, ${firstName ?? "selamat datang"}`
              : `Hello, ${firstName ?? "welcome"}`;
          })()}
        </Text>
        <Text style={styles.welcomeSubtitle}>
          {locale === "id" ? "Apa yang bisa saya bantu?" : "What can I do for you?"}
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
          {onOpenTools && toolsCount > 0 && (
            <TouchableOpacity
              onPress={onOpenTools}
              style={styles.toolsBadgeBtn}
              hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
            >
              <NativeIcon name="terminal-outline" size={16} color="#a0a0a0" />
              <View style={[
                styles.toolsBadge,
                activeToolsCount > 0 && styles.toolsBadgeActive,
              ]}>
                <Text style={[
                  styles.toolsBadgeText,
                  activeToolsCount > 0 && styles.toolsBadgeTextActive,
                ]}>
                  {activeToolsCount > 0 ? activeToolsCount : toolsCount}
                </Text>
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

      {reconnectError && (
        <View style={styles.reconnectErrorBanner}>
          <Text style={styles.reconnectErrorText} numberOfLines={2}>{reconnectError}</Text>
          <TouchableOpacity onPress={() => setReconnectError(null)} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
            <Text style={styles.reconnectErrorDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {sessionEnded && (
        <View style={styles.sessionEndedBanner}>
          <Text style={styles.sessionEndedText}>Session ended — this session is no longer active.</Text>
          <TouchableOpacity onPress={() => setSessionEnded(false)} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
            <Text style={styles.reconnectErrorDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {isShared && shareUrl && (
        <View style={styles.shareUrlBanner}>
          <ShareIcon size={14} color="#7ab8f5" />
          <Text style={styles.shareUrlText} numberOfLines={1} selectable>{shareUrl}</Text>
          <TouchableOpacity
            onPress={() => Share.share({ message: shareUrl, url: shareUrl }).catch(() => Alert.alert("Share Link", shareUrl))}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          >
            <Text style={styles.shareUrlCopy}>Share</Text>
          </TouchableOpacity>
        </View>
      )}

      <MCPPanel
        visible={showMCPPanel}
        onClose={() => setShowMCPPanel(false)}
      />

      <SettingsPanel
        visible={showModelSettings}
        onClose={() => {
          setShowModelSettings(false);
          const base = getApiBaseUrl();
          Promise.all([
            apiService.getUserPrefs(),
            fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({})),
          ]).then(([prefs, cfg]) => {
            const m = prefs.model || cfg.G4F_MODEL || cfg.modelName || DEFAULT_MODEL_FALLBACK;
            setActiveModel(m);
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

          // Suppress streaming assistant messages while the plan is still running
          // The final answer should only appear AFTER all tasks are complete
          if (item.role === "assistant" && !item.plan && !item.files && !item.error && item.isStreaming) {
            const hasRunningPlan = messages.some(m =>
              m.plan && (
                m.plan.status === "running" ||
                m.plan.steps.some(s => s.status === "running")
              )
            );
            if (hasRunningPlan) return null;
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
                  thoughtStream={thoughtStream}
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

          // In agent mode: if this assistant message follows a plan message, give it the agent header
          if (
            isAgentMode &&
            item.role === "assistant" &&
            !item.plan &&
            !item.files &&
            !item.error &&
            item.content
          ) {
            const hasPlanBefore = messages.slice(0, index).some(m => m.plan);
            if (hasPlanBefore) {
              return (
                <View style={styles.agentTurnBlock}>
                  <View style={styles.agentTurnHeader}>
                    <Text style={styles.agentTurnName}>dzeck</Text>
                    <View style={styles.agentTurnModeBadge}>
                      <Text style={styles.agentTurnModeBadgeText}>Agent</Text>
                    </View>
                  </View>
                  <MessageComponent message={item} onToolPress={(tool) => {
                    if (tool.tool_call_id && onSelectTool) {
                      onSelectTool(tool.tool_call_id);
                    } else {
                      const info = getToolDisplayInfo(tool.function_name || tool.name || "");
                      setSelectedTool({
                        functionName: tool.function_name || tool.name || "",
                        functionArgs: {},
                        status: tool.status || "called",
                        toolContent: tool.tool_content,
                        label: info.label,
                        icon: info.icon,
                        iconColor: info.color,
                      });
                    }
                  }} />
                </View>
              );
            }
          }

          return (
            <MessageComponent
              message={item}
              onToolPress={(tool) => {
                if (tool.tool_call_id && onSelectTool) {
                  onSelectTool(tool.tool_call_id);
                } else {
                  const info = getToolDisplayInfo(tool.function_name || tool.name || "");
                  setSelectedTool({
                    functionName: tool.function_name || tool.name || "",
                    functionArgs: {},
                    status: tool.status || "called",
                    toolContent: tool.tool_content,
                    label: info.label,
                    icon: info.icon,
                    iconColor: info.color,
                  });
                }
              }}
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
              <ManusThinkingIndicator
                label={
                  agentPhase === "SUMMARIZING" ? "Menyimpulkan..." :
                  agentPhase === "UPDATING" ? (thinking.label || "Memperbarui rencana...") :
                  agentPhase === "PLANNING" ? (thinking.label || "Merencanakan...") :
                  agentPhase === "EXECUTING" ? (thinking.label || "Mengerjakan...") :
                  thinking.label || "Sedang berpikir..."
                }
              />
            </View>
          ) : taskCompleted ? (
            <View style={styles.taskCompletedWrap}>
              {/* Only show goal description - clean and minimal */}
              <View style={styles.taskCompletedHeaderSection}>
                <CheckCircleIcon size={20} color="#22C55E" />
                <Text style={styles.taskCompletedHeaderText}>
                  {locale === "id" ? "Tugas telah selesai" : "Task completed"}
                </Text>
              </View>
              {taskFinalNarrative && (
                <Text style={styles.taskCompletedGoalText}>{taskFinalNarrative}</Text>
              )}
              {/* Star rating - minimal and clean */}
              <View style={styles.starRatingRow}>
                <Text style={styles.starRatingLabel}>
                  {starRating > 0
                    ? (locale === "id" ? "Terima kasih atas rating Anda" : "Thank you for your rating")
                    : (locale === "id" ? "Bagaimana hasil kerjanya?" : "How was the result?")}
                </Text>
                <View style={styles.starRatingStars}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity
                      key={n}
                      activeOpacity={0.7}
                      onPress={() => {
                        setStarRating(n);
                        const sid = activeSessionIdRef.current;
                        if (sid) {
                          apiService.rateSession(sid, n).catch(() => {});
                        }
                      }}
                    >
                      <StarIcon
                        size={22}
                        color={n <= starRating ? "#F59E0B" : "#D1CFC8"}
                        filled={n <= starRating}
                      />
                    </TouchableOpacity>
                  ))}
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
        const allDone = totalCount > 0 && steps.every(s => s.status === "completed" || s.status === "failed");
        const runningStep = steps.find(s => s.status === "running");
        const currentStepDesc = runningStep?.description || (allDone ? "Task selesai" : activePlanTitle);
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
                      <View style={styles.floatingPlanStepIcon}>
                        {isRunning ? (
                          <View style={styles.floatingPlanStepSpinnerWrap}>
                            <AnimatedPlanDot />
                          </View>
                        ) : isDone ? (
                          <View style={styles.floatingPlanStepDone}>
                            <Text style={styles.floatingPlanStepCheck}>✓</Text>
                          </View>
                        ) : isFailed ? (
                          <View style={styles.floatingPlanStepFailed}>
                            <Text style={styles.floatingPlanStepX}>✕</Text>
                          </View>
                        ) : (
                          <View style={styles.floatingPlanStepClock}>
                            <View style={styles.floatingPlanStepClockInner} />
                          </View>
                        )}
                      </View>
                      <Text style={[
                        styles.floatingPlanStepText,
                        isRunning && { color: "#1A1A1A", fontFamily: "Inter_500Medium" },
                        isDone && { color: "#9CA3AF" },
                        isFailed && { color: "#EF4444" },
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
                {allDone ? (
                  <View style={styles.floatingPlanDoneIcon}>
                    <Text style={styles.floatingPlanDoneCheck}>✓</Text>
                  </View>
                ) : (
                  <AnimatedPlanDot />
                )}
                <Text style={styles.floatingPlanTitle} numberOfLines={1}>{currentStepDesc}</Text>
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
    backgroundColor: "#F0EEE6",
  },
  header: {
    paddingBottom: 10,
    paddingHorizontal: 12,
    backgroundColor: "#F0EEE6",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
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
    color: "#1A1A1A",
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
  toolsBadgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  toolsBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#E5E3DC",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  toolsBadgeActive: {
    backgroundColor: "#3B82F6",
  },
  toolsBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6B7280",
  },
  toolsBadgeTextActive: {
    color: "#ffffff",
  },
  settingsOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  settingsPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  settingsPanelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  settingsSection: {
    gap: 10,
  },
  settingsSectionTitle: {
    fontSize: 13,
    color: "#9CA3AF",
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
    borderColor: "#E5E3DC",
    alignItems: "center",
    backgroundColor: "#F5F4EF",
  },
  langBtnActive: {
    backgroundColor: "#1A1A1A",
    borderColor: "#1A1A1A",
  },
  langBtnText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "500",
  },
  langBtnTextActive: {
    color: "#FFFFFF",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E3DC",
  },
  logoutBtnText: {
    color: "#6B7280",
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
    backgroundColor: "rgba(34,197,94,0.1)",
  },
  e2bError: {
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  e2bChecking: {
    backgroundColor: "#E5E3DC",
  },
  e2bBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#6B7280",
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
    color: "#9CA3AF",
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  fileCardName: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#374151",
  },
  fileCardAction: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
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
    backgroundColor: "#E5E3DC",
    borderWidth: 1,
    borderColor: "#E5E3DC",
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
    color: "#1A1A1A",
    letterSpacing: -0.2,
  },
  agentTurnModeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "#F5F4EF",
    borderWidth: 1,
    borderColor: "#E5E3DC",
  },
  agentTurnModeBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#9CA3AF",
    letterSpacing: 0.1,
  },
  agentPrecedingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#374151",
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
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileDocIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#F5F4EF",
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
    color: "#1A1A1A",
    lineHeight: 18,
  },
  fileDocType: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#9CA3AF",
    letterSpacing: 0.2,
  },
  fileDocDownloadBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F5F4EF",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileViewAllLink: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#3B82F6",
    paddingLeft: 2,
    paddingTop: 2,
  },
  // Manus-style floating plan bar
  floatingPlanBarWrapper: {
    borderTopWidth: 1,
    borderTopColor: "#E5E3DC",
  },
  floatingPlanExpandedPanel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingBottom: 12,
    backgroundColor: "#F5F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
    maxHeight: 200,
  },
  floatingPlanExpandedSingle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#F5F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
  },
  floatingPlanExpandedLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#6B7280",
    fontStyle: "italic",
    lineHeight: 18,
  },
  floatingPlanStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 4,
  },
  floatingPlanStepIcon: {
    width: 14,
    height: 14,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  floatingPlanStepSpinnerWrap: {
    width: 8,
    height: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPlanStepDone: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderWidth: 1,
    borderColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPlanStepCheck: {
    fontSize: 8,
    color: "#22C55E",
    fontWeight: "700",
    lineHeight: 10,
  },
  floatingPlanStepFailed: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPlanStepX: {
    fontSize: 8,
    color: "#EF4444",
    fontWeight: "700",
    lineHeight: 10,
  },
  floatingPlanStepClock: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#D1CFC8",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPlanStepClockInner: {
    width: 1,
    height: 4,
    backgroundColor: "#D1CFC8",
    borderRadius: 1,
    marginBottom: 1,
  },
  floatingPlanDoneIcon: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(34,197,94,0.15)",
    borderWidth: 1,
    borderColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPlanDoneCheck: {
    fontSize: 6,
    color: "#22C55E",
    fontWeight: "700",
    lineHeight: 8,
  },
  floatingPlanStepText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 17,
  },
  floatingPlanBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F0EEE6",
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
    backgroundColor: "#3B82F6",
  },
  floatingPlanTitle: {
    flex: 1,
    color: "#6B7280",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  floatingPlanCounter: {
    color: "#9CA3AF",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  floatingPlanTimer: {
    color: "#9CA3AF",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  // Manus-style task completed - clean and minimal
  taskCompletedWrap: {
    marginHorizontal: 16,
    marginVertical: 12,
    gap: 12,
  },
  taskCompletedHeaderSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  taskCompletedHeaderText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#1A1A1A",
    letterSpacing: -0.2,
  },
  taskCompletedGoalText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#374151",
    lineHeight: 21,
    marginTop: 4,
  },
  // Star rating like Manus
  starRatingRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E3DC",
    marginTop: 4,
    gap: 8,
  },
  starRatingLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#9CA3AF",
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
    color: "#1A1A1A",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  welcomeSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    color: "#9CA3AF",
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
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionChipText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#9CA3AF",
    lineHeight: 18,
  },
  toolsBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#9CA3AF",
    alignItems: "center",
    justifyContent: "center",
  },
  toolsBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#ffffff",
  },
  toolsBtnActive: {
    backgroundColor: "#E5E3DC",
  },
  inlineToolsBlock: {
    marginLeft: 16,
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 0,
    paddingVertical: 2,
    gap: 1,
  },
  reconnectErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239,68,68,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(239,68,68,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  reconnectErrorText: {
    flex: 1,
    fontSize: 13,
    color: "#EF4444",
    fontFamily: "Inter_400Regular",
  },
  reconnectErrorDismiss: {
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "600",
  },
  sessionEndedBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  sessionEndedText: {
    flex: 1,
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  shareUrlBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(59,130,246,0.06)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(59,130,246,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  shareUrlText: {
    flex: 1,
    fontSize: 12,
    color: "#3B82F6",
    fontFamily: "Inter_400Regular",
  },
  shareUrlCopy: {
    fontSize: 12,
    color: "#3B82F6",
    fontWeight: "600",
    fontFamily: "Inter_500Medium",
  },
});
