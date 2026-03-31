import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Text, TouchableOpacity, Linking, Modal, Image, Share, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ChatMessage as MessageComponent } from "./ChatMessage";
import { ChatBox } from "./ChatBox";
import { AgentPlanView } from "./AgentPlanView";
import { Ionicons } from "@expo/vector-icons";
import { apiService, AgentEvent, ChatMessage as ApiChatMessage, getStoredToken, getApiBaseUrl } from "../lib/api-service";
import { processAgentEvent } from "../lib/agent-event-processor";
import { saveActiveSessionId, loadActiveSessionId, clearActiveSessionId, saveActiveSessionLastId, loadActiveSessionLastId } from "../lib/storage";
import { randomUUID } from "expo-crypto";
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
  screenshotB64?: string;
  todoItems?: Array<{ id: string; text: string; status: string; [key: string]: any }>;
  taskUpdate?: { id?: string; title?: string; status?: string; description?: string; [key: string]: any };
  searchResults?: Array<{ title: string; url: string; snippet?: string; [key: string]: any }>;
  searchQuery?: string;
  shellOutput?: string;
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

interface ChatPageProps {
  sessionId?: string;
  isAgentMode?: boolean;
  onAgentModeChange?: (enabled: boolean) => void;
  isLeftPanelShow?: boolean;
  onToggleLeftPanel?: () => void;
  onToolsChange?: (tools: any[]) => void;
  onVncSessionChange?: (info: VncSessionInfo | null) => void;
  onBrowserEventChange?: (event: BrowserEventState | null) => void;
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
}: ChatPageProps = {}) {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  const isAgentMode = agentModeProp ?? mode === "agent";

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
      const m = prefs.model || cfg.CEREBRAS_AGENT_MODEL || cfg.modelName;
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
        if (isAgentMode) {
          const steps = currentPlanRef.current?.steps || [];
          const doneSteps = steps
            .filter(s => s.status === "completed" || s.status === "failed")
            .map(s => ({ id: s.id, description: s.description }));
          setCompletedSteps(doneSteps.length > 0 ? doneSteps : steps.map(s => ({ id: s.id, description: s.description })));
          setTaskCompleted(true);
          setTaskCompletedExpanded(false);
        }
        return;
      }

      case "message": {
        if (!ev.content) return;
        setThinking({ active: false, label: "" });
        const msg: ChatMessage = {
          id: `msg_${Date.now()}`,
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
        if (ev.text) {
          setThinking({ active: true, label: ev.text });
        }
        if (ev.attachments && ev.attachments.length > 0) {
          filesShownViaNotifyRef.current = true;
          const filesMsg: ChatMessage = {
            id: `msg_${Date.now()}_notify_files`,
            role: "assistant",
            content: ev.text || "",
            timestamp: Date.now(),
            files: ev.attachments.map(a => ({
              filename: a.filename,
              download_url: a.download_url,
              sandbox_path: a.sandbox_path,
            })),
          };
          setMessages(prev => [...prev, filesMsg]);
        }
        return;
      }

      case "files": {
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
          id: `msg_${Date.now()}_err`,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          error: ev.message || "Terjadi kesalahan",
        };
        setMessages(prev => [...prev, errMsg]);
        setIsLoading(false);
        return;
      }

      case "todo_update": {
        if (ev.items && ev.items.length > 0) {
          const summary = ev.items
            .map((item: any) => `• [${item.status || "?"}] ${item.text}`)
            .join("\n");
          const todoMsg: ChatMessage = {
            id: `msg_${Date.now()}_todo`,
            role: "assistant",
            content: `Todo list updated:\n${summary}`,
            timestamp: Date.now(),
            todoItems: ev.items,
          };
          setMessages(prev => {
            const existing = prev.findIndex(m => m.todoItems !== undefined);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { ...updated[existing], todoItems: ev.items, content: `Todo list updated:\n${summary}` };
              return updated;
            }
            return [...prev, todoMsg];
          });
        }
        return;
      }

      case "task_update": {
        if (ev.task) {
          const label = ev.task.title || ev.task.description || "";
          const status = ev.task.status ? ` [${ev.task.status}]` : "";
          const taskMsg: ChatMessage = {
            id: `msg_${Date.now()}_task`,
            role: "assistant",
            content: label ? `Task${status}: ${label}` : `Task updated${status}`,
            timestamp: Date.now(),
            taskUpdate: ev.task,
          };
          setMessages(prev => [...prev, taskMsg]);
        }
        return;
      }

      case "search_results": {
        if (ev.results && ev.results.length > 0) {
          const lines = ev.results.map((r: any) => `• ${r.title} — ${r.url}`).join("\n");
          const queryLabel = ev.query ? `Hasil pencarian "${ev.query}":\n` : "Hasil pencarian:\n";
          const searchMsg: ChatMessage = {
            id: `msg_${Date.now()}_search`,
            role: "assistant",
            content: queryLabel + lines,
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
          const shellMsg: ChatMessage = {
            id: `msg_${Date.now()}_shell`,
            role: "assistant",
            content: ev.output,
            timestamp: Date.now(),
            shellOutput: ev.output,
          };
          setMessages(prev => [...prev, shellMsg]);
        }
        return;
      }

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
      id: `msg_${Date.now()}`,
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

        const cancel = await apiService.agent(
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
            onPress={() => onAgentModeChange?.(!isAgentMode)}
            style={[styles.settingsBtn, isAgentMode && styles.agentModeActive]}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          >
            <Ionicons
              name={isAgentMode ? "flash" : "flash-outline"}
              size={18}
              color={isAgentMode ? "#d97706" : "#8a8780"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            style={styles.settingsBtn}
            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
            disabled={isSharing || messages.length === 0}
          >
            <Ionicons
              name={isShared ? "share-social" : "share-social-outline"}
              size={18}
              color={messages.length === 0 ? "#444" : isShared ? "#6C5CE7" : "#8a8780"}
            />
          </TouchableOpacity>
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
          const base = getApiBaseUrl();
          const token = getStoredToken();
          const authHdr = token ? { Authorization: `Bearer ${token}` } : {};
          Promise.all([
            fetch(`${base}/api/user/prefs`, { headers: authHdr }).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
            fetch(`${base}/api/config`).then((r) => r.json()).catch(() => ({})),
          ]).then(([prefs, cfg]) => {
            const m = prefs.model || cfg.CEREBRAS_AGENT_MODEL || cfg.modelName;
            if (m) setActiveModel(m);
          }).catch(() => {});
        }}
        authToken={getStoredToken()}
      />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
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
                  <View style={styles.agentTurnIcon}>
                    <Ionicons name="hardware-chip-outline" size={13} color="#ffffff" />
                  </View>
                  <Text style={styles.agentTurnName}>Dzeck</Text>
                  {isPlanRunning && !isPlanDone && (
                    <View style={styles.agentTurnBadgeRunning}>
                      <Text style={styles.agentTurnBadgeText}>Working…</Text>
                    </View>
                  )}
                  {isPlanDone && (
                    <View style={styles.agentTurnBadgeDone}>
                      <Text style={[styles.agentTurnBadgeText, { color: "#16a34a" }]}>Done</Text>
                    </View>
                  )}
                </View>
                <AgentPlanView plan={item.plan} />
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
                  <View style={styles.agentTurnIcon}>
                    <Ionicons name="hardware-chip-outline" size={13} color="#ffffff" />
                  </View>
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
                      <Ionicons name="document-text-outline" size={20} color="#2563eb" />
                    </View>
                    <View style={styles.fileDocInfo}>
                      <Text style={styles.fileDocName} numberOfLines={1}>{f.filename}</Text>
                      <Text style={styles.fileDocType}>{getFileExt(f.filename)}</Text>
                    </View>
                    <View style={styles.fileDocDownloadBtn}>
                      <Ionicons name="download-outline" size={16} color="#2563eb" />
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
        contentContainerStyle={styles.messageList}
        ListFooterComponent={
          taskCompleted && !thinking.active ? (
            <View style={styles.taskCompletedWrap}>
              <TouchableOpacity
                style={styles.taskCompletedBanner}
                onPress={() => setTaskCompletedExpanded(!taskCompletedExpanded)}
                activeOpacity={0.8}
              >
                <View style={styles.taskCompletedIcon}>
                  <Ionicons name="checkmark" size={13} color="#ffffff" />
                </View>
                <Text style={styles.taskCompletedText}>Task Completed</Text>
                <Ionicons
                  name={taskCompletedExpanded ? "chevron-up" : "chevron-down"}
                  size={14}
                  color="#16a34a"
                />
              </TouchableOpacity>
              {taskCompletedExpanded && completedSteps.length > 0 && (
                <View style={styles.taskCompletedSteps}>
                  {completedSteps.map((step, i) => (
                    <View key={step.id || i} style={styles.taskCompletedStepRow}>
                      <Ionicons name="checkmark-circle" size={13} color="#16a34a" />
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
  agentModeActive: {
    backgroundColor: "#fef3c7",
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
    backgroundColor: "#f0efea",
    borderWidth: 1,
    borderColor: "#ddd9d0",
  },
  agentTurnBlock: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  agentTurnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  agentTurnIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: "#1a1916",
    alignItems: "center",
    justifyContent: "center",
  },
  agentTurnName: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#1a1916",
    letterSpacing: -0.2,
  },
  agentTurnBadgeRunning: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(37,99,235,0.1)",
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.2)",
  },
  agentTurnBadgeDone: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(22,163,74,0.1)",
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.2)",
  },
  agentTurnBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#2563eb",
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
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileDocIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(37,99,235,0.08)",
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
    color: "#1a1916",
    lineHeight: 18,
  },
  fileDocType: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#8a8780",
    letterSpacing: 0.2,
  },
  fileDocDownloadBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(37,99,235,0.08)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileViewAllLink: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#2563eb",
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
    backgroundColor: "#8a8780",
  },
  thinkingDotPulse: {
    backgroundColor: "#2563eb",
  },
  thinkingLabel: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#8a8780",
    fontStyle: "italic",
  },
  taskCompletedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 8,
    backgroundColor: "rgba(22,163,74,0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.25)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  taskCompletedIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  taskCompletedText: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#16a34a",
    letterSpacing: -0.2,
  },
});
