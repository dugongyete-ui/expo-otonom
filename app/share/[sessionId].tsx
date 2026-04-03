/**
 * Public share page for agent sessions.
 * Read-only view that shows plan steps, messages, tool calls, and output files.
 * Does NOT require authentication (public share).
 */
import React, { useState, useEffect, useCallback, useRef, ComponentProps } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Platform,
  Pressable,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl } from "@/lib/api-service";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];
type PlanStepStatus = "pending" | "running" | "completed" | "failed";

interface PlanStep {
  id?: string;
  title?: string;
  status?: PlanStepStatus;
  description?: string;
  agent?: string;
}

interface AgentEvent {
  type: string;
  content?: string;
  chunk?: string;
  text?: string;
  title?: string;
  message?: string;
  function_name?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  status?: string;
  tool_content?: Record<string, unknown>;
  plan?: { steps?: PlanStep[] };
  step?: Partial<PlanStep>;
  step_id?: string;
  step_status?: string;
  error?: string;
  timestamp?: string;
  session_id?: string;
}

interface ParsedSession {
  userMessage: string;
  assistantMessages: string[];
  planSteps: PlanStep[];
  toolCalls: Array<{ name: string; status: string; content: any }>;
  files: Array<{ name: string; path: string; download_url: string }>;
  done: boolean;
  error?: string;
}

function parseEventsToSession(rawLines: string[]): ParsedSession {
  const result: ParsedSession = {
    userMessage: "",
    assistantMessages: [],
    planSteps: [],
    toolCalls: [],
    files: [],
    done: false,
  };

  let currentChunks: string[] = [];

  for (const line of rawLines) {
    let evt: AgentEvent | null = null;
    try {
      const raw = line.startsWith("data: ") ? line.slice(6) : line;
      if (raw === "[DONE]") { result.done = true; continue; }
      evt = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!evt) continue;

    switch (evt.type) {
      case "session":
        break;
      case "user_message":
      case "user":
        if (evt.content || evt.message) {
          result.userMessage = evt.content || evt.message || "";
        }
        break;
      case "message_start":
        currentChunks = [];
        break;
      case "message_chunk":
        if (evt.chunk) currentChunks.push(evt.chunk);
        break;
      case "message_end":
        if (currentChunks.length > 0) {
          result.assistantMessages.push(currentChunks.join(""));
          currentChunks = [];
        }
        break;
      case "message_correct":
        if (evt.text) result.assistantMessages.push(evt.text);
        break;
      case "notify":
        if (evt.content) result.assistantMessages.push(evt.content);
        break;
      case "plan":
        if (evt.plan?.steps) {
          result.planSteps = evt.plan.steps;
        }
        break;
      case "step":
        if (evt.step && evt.step_id) {
          const idx = result.planSteps.findIndex((s) => s.id === evt.step_id);
          const validStatuses: PlanStepStatus[] = ["pending", "running", "completed", "failed"];
          const parsedStatus = validStatuses.includes(evt.step_status as PlanStepStatus)
            ? (evt.step_status as PlanStepStatus)
            : undefined;
          if (idx >= 0) {
            result.planSteps[idx] = {
              ...result.planSteps[idx],
              ...evt.step,
              status: parsedStatus ?? result.planSteps[idx].status,
            };
          } else if (evt.step) {
            result.planSteps.push({ ...evt.step, id: evt.step_id, status: parsedStatus ?? "pending" });
          }
        }
        break;
      case "tool":
      case "tool_call":
        if (evt.function_name || evt.tool_name) {
          const toolName = evt.function_name || evt.tool_name || "unknown";
          result.toolCalls.push({
            name: toolName,
            status: evt.status || "called",
            content: evt.tool_content || evt.arguments || {},
          });
          const tc = evt.tool_content;
          const tcFile = typeof tc?.file === "string" ? tc.file : null;
          if (tc && tc.type === "file" && tcFile && tc.operation === "write") {
            const alreadyAdded = result.files.some((f) => f.path === tcFile);
            if (!alreadyAdded) {
              result.files.push({
                name: tcFile.split("/").pop() || tcFile,
                path: tcFile,
                download_url: "",
              });
            }
          }
        }
        break;
      case "tool_result":
        if (evt.function_name || evt.tool_name) {
          const tName = evt.function_name || evt.tool_name || "unknown";
          const callIdx = result.toolCalls.findIndex((t) => t.name === tName && t.status === "called");
          if (callIdx >= 0) {
            result.toolCalls[callIdx] = { ...result.toolCalls[callIdx], status: evt.error ? "error" : "done" };
          }
        }
        break;
      case "step_start":
        if (evt.step_id || evt.step?.id) {
          const sid = evt.step_id || evt.step?.id;
          const existing = result.planSteps.findIndex((s) => s.id === sid);
          const newStep: PlanStep = {
            id: sid,
            title: evt.step?.title || evt.title,
            description: evt.step?.description,
            agent: evt.step?.agent,
            status: "running",
          };
          if (existing >= 0) {
            result.planSteps[existing] = { ...result.planSteps[existing], ...newStep };
          } else {
            result.planSteps.push(newStep);
          }
        }
        break;
      case "step_done":
        if (evt.step_id || evt.step?.id) {
          const sid = evt.step_id || evt.step?.id;
          const idx = result.planSteps.findIndex((s) => s.id === sid);
          if (idx >= 0) result.planSteps[idx] = { ...result.planSteps[idx], status: "completed" };
        }
        break;
      case "step_failed":
        if (evt.step_id || evt.step?.id) {
          const sid = evt.step_id || evt.step?.id;
          const idx = result.planSteps.findIndex((s) => s.id === sid);
          if (idx >= 0) result.planSteps[idx] = { ...result.planSteps[idx], status: "failed" };
        }
        break;
      case "done":
        result.done = true;
        break;
      case "error":
        result.error = evt.error;
        break;
    }
  }

  return result;
}

const STEP_ICONS: Record<string, IoniconsName> = {
  completed: "checkmark-circle",
  running: "radio-button-on",
  failed: "close-circle",
};

function StepBadge({ status }: { status?: PlanStepStatus }) {
  const color =
    status === "completed" ? "#888888" :
    status === "running" ? "#888888" :
    status === "failed" ? "#666666" : "#555555";
  const icon: IoniconsName = (status && STEP_ICONS[status]) || "ellipse-outline";
  return <Ionicons name={icon} size={14} color={color} />;
}

export default function SharePage() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [session, setSession] = useState<ParsedSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeTab, setActiveTab] = useState<"plan" | "messages" | "tools">("messages");

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/shared/${sessionId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Session not found or not public");
      }
      const data = await res.json();
      const parsed = parseEventsToSession(data.events || []);
      parsed.done = data.done || parsed.done;
      setSession(parsed);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
    pollingRef.current = setInterval(() => {
      if (session?.done) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
      } else {
        fetchSession();
      }
    }, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchSession]);

  useEffect(() => {
    if (session?.done && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [session?.done]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#888888" />
        <Text style={styles.loadingText}>Loading shared session...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={48} color="#636366" />
        <Text style={styles.errorTitle}>Session Not Available</Text>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!session) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={20} color="#888888" />
          <Text style={styles.headerTitle}>Shared Session</Text>
        </View>
        <View style={styles.headerRight}>
          {!session.done ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>Live</Text>
            </View>
          ) : (
            <View style={styles.doneBadge}>
              <Text style={styles.doneBadgeText}>Completed</Text>
            </View>
          )}
        </View>
      </View>

      {session.userMessage ? (
        <View style={styles.userMessageBox}>
          <Ionicons name="person-circle" size={16} color="#888888" />
          <Text style={styles.userMessageText} numberOfLines={3}>{session.userMessage}</Text>
        </View>
      ) : null}

      <View style={styles.tabBar}>
        {(["messages", "plan", "tools"] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "messages" ? "Messages" : tab === "plan" ? `Plan (${session.planSteps.length})` : `Tools (${session.toolCalls.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {activeTab === "plan" && (
          <>
            {session.planSteps.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="list-outline" size={32} color="#636366" />
                <Text style={styles.emptyText}>No plan generated yet</Text>
              </View>
            ) : (
              session.planSteps.map((step, idx) => (
                <View key={step.id || idx} style={styles.stepCard}>
                  <View style={styles.stepHeader}>
                    <StepBadge status={step.status} />
                    <Text style={styles.stepNumber}>Step {idx + 1}</Text>
                    <Text style={[
                      styles.stepStatus,
                      step.status === "completed" && { color: "#888888" },
                      step.status === "running" && { color: "#888888" },
                      step.status === "failed" && { color: "#666666" },
                    ]}>{step.status || "pending"}</Text>
                  </View>
                  <Text style={styles.stepTitle}>{step.title || "Untitled step"}</Text>
                  {step.description ? <Text style={styles.stepDesc}>{step.description}</Text> : null}
                  {step.agent ? <Text style={styles.stepAgent}>{step.agent}</Text> : null}
                </View>
              ))
            )}
          </>
        )}

        {activeTab === "messages" && (
          <>
            {session.assistantMessages.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubble-outline" size={32} color="#636366" />
                <Text style={styles.emptyText}>No messages yet</Text>
              </View>
            ) : (
              session.assistantMessages.map((msg, idx) => (
                <View key={idx} style={styles.messageCard}>
                  <View style={styles.messageHeader}>
                    <Ionicons name="sparkles" size={12} color="#888888" />
                    <Text style={styles.messageSender}>Dzeck</Text>
                  </View>
                  <Text style={styles.messageText}>{msg}</Text>
                </View>
              ))
            )}
          </>
        )}

        {activeTab === "tools" && (
          <>
            {session.toolCalls.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="construct-outline" size={32} color="#636366" />
                <Text style={styles.emptyText}>No tool calls recorded</Text>
              </View>
            ) : (
              session.toolCalls.map((tc, idx) => (
                <View key={idx} style={styles.toolCard}>
                  <View style={styles.toolHeader}>
                    <Ionicons name="construct-outline" size={12} color="#8E8E93" />
                    <Text style={styles.toolName}>{tc.name}</Text>
                    <Text style={[
                      styles.toolStatus,
                      tc.status === "called" && { color: "#888888" },
                      tc.status === "calling" && { color: "#888888" },
                      tc.status === "error" && { color: "#666666" },
                    ]}>{tc.status}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {session.done && session.files.length > 0 && (
          <View style={styles.filesSection}>
            <Text style={styles.filesSectionTitle}>Output Files</Text>
            {session.files.map((f, idx) => (
              <View key={idx} style={styles.fileCard}>
                <Ionicons name="document-outline" size={14} color="#8E8E93" />
                <Text style={styles.fileName}>{f.name}</Text>
              </View>
            ))}
          </View>
        )}

        {session.error && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={14} color="#888888" />
            <Text style={styles.errorCardText}>{session.error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Session: {sessionId?.slice(-12)} &bull; {session.toolCalls.length} tool calls
        </Text>
        <Text style={styles.footerBrand}>Powered by Dzeck AI</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0C" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#0A0A0C" },
  loadingText: { color: "#8E8E93", fontSize: 14, marginTop: 8 },
  errorTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600", marginTop: 8 },
  errorText: { color: "#8E8E93", fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#2C2C30",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#FFFFFF" },
  headerRight: { flexDirection: "row", alignItems: "center" },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#888888" },
  liveBadgeText: { color: "#888888", fontSize: 11, fontWeight: "600" },
  doneBadge: {
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  doneBadgeText: { color: "#888888", fontSize: 11, fontWeight: "600" },
  userMessageBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: 1, borderBottomColor: "#2C2C30",
  },
  userMessageText: { color: "#AEAEB2", fontSize: 13, flex: 1, lineHeight: 18 },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1, borderBottomColor: "#2C2C30",
    paddingHorizontal: 12,
  },
  tab: { paddingVertical: 10, paddingHorizontal: 12, marginBottom: -1 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#888888" },
  tabText: { color: "#636366", fontSize: 13, fontWeight: "500" },
  tabTextActive: { color: "#FFFFFF" },
  content: { flex: 1 },
  contentContainer: { padding: 12, gap: 8 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  emptyText: { color: "#636366", fontSize: 14 },
  stepCard: {
    backgroundColor: "#1A1A20", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#2C2C30", marginBottom: 8,
  },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  stepNumber: { color: "#636366", fontSize: 11, fontWeight: "600", flex: 1 },
  stepStatus: { color: "#636366", fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
  stepTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "500", marginBottom: 4 },
  stepDesc: { color: "#8E8E93", fontSize: 12, lineHeight: 16 },
  stepAgent: { color: "#888888", fontSize: 10, marginTop: 4 },
  messageCard: {
    backgroundColor: "#1A1A20", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#2a2a2a", marginBottom: 8,
  },
  messageHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  messageSender: { color: "#888888", fontSize: 11, fontWeight: "600" },
  messageText: { color: "#AEAEB2", fontSize: 13, lineHeight: 20 },
  toolCard: {
    backgroundColor: "#1A1A20", borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: "#2C2C30", marginBottom: 6,
  },
  toolHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolName: { color: "#AEAEB2", fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", flex: 1 },
  toolStatus: { color: "#636366", fontSize: 10, fontWeight: "600" },
  filesSection: { marginTop: 16 },
  filesSectionTitle: { color: "#8E8E93", fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  fileCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#1A1A20", borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: "#2C2C30", marginBottom: 6,
  },
  fileName: { color: "#AEAEB2", fontSize: 13, flex: 1 },
  errorCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: "#2a2a2a", marginTop: 8,
  },
  errorCardText: { color: "#a0a0a0", fontSize: 12, flex: 1, lineHeight: 16 },
  footer: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: "#2C2C30",
  },
  footerText: { color: "#3A3A40", fontSize: 10, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  footerBrand: { color: "#3A3A40", fontSize: 10 },
});
