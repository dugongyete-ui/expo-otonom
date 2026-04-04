import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Easing,
} from "react-native";
import type { AgentPlan, AgentPlanStep, AgentEvent, ToolContent } from "@/lib/chat";
import { getToolCategory } from "@/lib/tool-constants";
import { cleanText } from "@/lib/text-utils";

export interface SelectedToolInfo {
  functionName: string;
  functionArgs: Record<string, unknown>;
  status: string;
  toolContent?: ToolContent;
  functionResult?: string;
  label: string;
  icon: string;
  iconColor: string;
}

interface AgentPlanViewProps {
  plan: AgentPlan;
  notifyMessages?: string[];
  stepNotifyMessages?: { stepId: string; text: string }[];
  thoughtStream?: string[];
  onToolPress?: (tool: SelectedToolInfo) => void;
}

interface StepToolEntry {
  tool_call_id?: string;
  type?: string;
  name?: string;
  function_name?: string;
  status?: string;
  input?: Record<string, unknown>;
  function_args?: Record<string, unknown>;
  output?: string;
  function_result?: string;
  error?: string;
  tool_content?: ToolContent;
}

// Manus-style label for each tool call
function buildToolLabel(fnName: string, args: Record<string, unknown>): string {
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
    return dir === "up" ? "Scroll ke atas" : dir === "down" ? "Scroll ke bawah" : "Scroll halaman";
  }
  if (fnName === "browser_click") {
    const sel = String(args.selector || args.element || args.label || args.text || "");
    if (sel) return `Klik: ${sel.slice(0, 45)}`;
    return "Klik elemen";
  }
  if (fnName === "browser_type" || fnName === "browser_input") {
    const text = String(args.text || args.value || args.input || "");
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
  if (fnName === "web_search" || fnName === "info_search_web") {
    const q = String(args.query || args.q || "");
    if (q) return `Mencari informasi terbaru tentang ${q.slice(0, 50)}`;
    return "Mencari informasi";
  }
  if (fnName === "shell_exec") {
    const cmd = String(args.command || args.cmd || "");
    if (cmd) return `Jalankan: ${cmd.slice(0, 45)}`;
    return "Jalankan perintah";
  }
  if (fnName === "shell_view") return "Lihat output terminal";
  if (fnName === "file_read") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Membaca ${file.slice(0, 45)}`;
    return "Membaca file";
  }
  if (fnName === "file_write") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Mengedit file ${file.slice(0, 45)}`;
    return "Menulis file";
  }
  if (fnName === "file_str_replace") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Mengedit ${file.slice(0, 45)}`;
    return "Mengedit file";
  }
  if (fnName === "message_notify_user") {
    const text = String(args.text || args.message || "");
    if (text) return text.slice(0, 60);
    return "Notifikasi";
  }
  if (fnName === "message_ask_user") {
    const text = String(args.text || args.question || "");
    if (text) return `Tanya: ${text.slice(0, 40)}`;
    return "Pertanyaan";
  }
  // Generic fallback
  const first = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
  let argVal = first ? String(args[first] || "") : "";
  argVal = argVal.replace(/^\/home\/ubuntu\//, "~/");
  if (argVal.length > 55) argVal = argVal.slice(0, 55) + "…";
  if (argVal) return `${fnName.replace(/_/g, " ")}: ${argVal}`;
  return fnName.replace(/_/g, " ");
}

// Map tool function name to a small icon character
function getToolIconChar(fnName: string): string {
  const category = getToolCategory(fnName);
  switch (category) {
    case "browser":
    case "desktop":
      return "🌐";
    case "file":
    case "image":
    case "multimedia":
      return "📄";
    case "search":
    case "info":
      return "🔍";
    case "message":
    case "todo":
    case "task":
    case "email":
      return "💬";
    case "shell":
    default:
      return "⚡";
  }
}

// Animated spinner
function SpinnerIcon({ size = 12 }: { size?: number }) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: "#5b8def",
          borderTopColor: "transparent",
        }}
      />
    </Animated.View>
  );
}

// Fade+slide in for new rows appearing
function FadeSlideIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(6)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 250, delay, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 250, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
      {children}
    </Animated.View>
  );
}

// A single tool-call row (Manus.im style)
// Shows: [icon circle] [label text...] [status]
interface ToolRowProps {
  tool: StepToolEntry;
  onPress?: () => void;
}

function ToolRow({ tool, onPress }: ToolRowProps) {
  const fnName = tool.function_name || tool.name || "";
  const args = tool.function_args || tool.input || {};
  const label = buildToolLabel(fnName, args);
  const status = tool.status;
  const isRunning = status === "calling";
  const isDone = status === "called";
  const isError = status === "error";
  const iconChar = getToolIconChar(fnName);

  return (
    <TouchableOpacity
      style={trStyles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      {/* Small icon circle */}
      <View style={[
        trStyles.iconCircle,
        isRunning && trStyles.iconCircleRunning,
        isDone && trStyles.iconCircleDone,
        isError && trStyles.iconCircleError,
      ]}>
        <Text style={trStyles.iconChar}>{iconChar}</Text>
      </View>

      {/* Label */}
      <Text
        style={[
          trStyles.label,
          isRunning && trStyles.labelRunning,
          isDone && trStyles.labelDone,
          isError && trStyles.labelError,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>

      {/* Status indicator */}
      <View style={trStyles.statusWrap}>
        {isRunning && <SpinnerIcon size={11} />}
        {isDone && <Text style={trStyles.checkmark}>✓</Text>}
        {isError && <Text style={trStyles.errormark}>✕</Text>}
      </View>
    </TouchableOpacity>
  );
}

const trStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#2d2d2d",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconCircleRunning: {
    borderColor: "#3a5fc0",
    backgroundColor: "rgba(74, 124, 240, 0.08)",
  },
  iconCircleDone: {
    borderColor: "#2a4a2a",
    backgroundColor: "rgba(76, 175, 80, 0.06)",
  },
  iconCircleError: {
    borderColor: "#4a2a2a",
    backgroundColor: "rgba(220, 80, 80, 0.06)",
  },
  iconChar: {
    fontSize: 12,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
    flex: 1,
    lineHeight: 19,
  },
  labelRunning: {
    color: "#b8c8f0",
  },
  labelDone: {
    color: "#606060",
  },
  labelError: {
    color: "#a06060",
  },
  statusWrap: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkmark: {
    fontSize: 12,
    color: "#5a9e60",
    fontWeight: "700",
  },
  errormark: {
    fontSize: 11,
    color: "#b05050",
    fontWeight: "700",
  },
});

// A narrative line shown between tool calls (from notify messages)
function NarrativeLine({ text }: { text: string }) {
  return (
    <Text style={narStyles.text} numberOfLines={4}>
      {cleanText(text)}
    </Text>
  );
}

const narStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    fontSize: 12.5,
    color: "#909090",
    lineHeight: 18,
    paddingVertical: 3,
    paddingLeft: 34,
  },
});

// Build a flat list of items: tool calls + narrative inserts, ordered by step
interface FlatItem {
  kind: "tool";
  tool: StepToolEntry;
  stepId: string;
  key: string;
  onPress?: () => void;
}

interface NarrativeItem {
  kind: "narrative";
  text: string;
  key: string;
}

type DisplayItem = FlatItem | NarrativeItem;

export function AgentGoalMessage({ message }: { message: string }) {
  return <Text style={goalStyles.text}>{cleanText(message)}</Text>;
}

const goalStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#c0c0c0",
    lineHeight: 21,
    paddingVertical: 4,
  },
});

/**
 * Manus-style AgentPlanView
 *
 * Renders a single collapsible task block.
 * Inside, tool calls from all active steps appear ONE BY ONE as they execute.
 * Narrative/notify text appears inline between them.
 * Pending steps (not yet started) produce no visible rows.
 */
export function AgentPlanView({
  plan,
  notifyMessages,
  stepNotifyMessages,
  thoughtStream,
  onToolPress,
}: AgentPlanViewProps) {
  const allSteps = plan.steps || [];

  // Only process steps that have been started
  const activeSteps = allSteps.filter(
    s => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  const isAllDone =
    plan.status === "completed" ||
    (allSteps.length > 0 && allSteps.every(s => s.status === "completed" || s.status === "failed"));
  const isRunning =
    plan.status === "running" || allSteps.some(s => s.status === "running");

  const completedCount = allSteps.filter(s => s.status === "completed" || s.status === "failed").length;
  const totalCount = allSteps.length;

  // Collapse on done, expand while running
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  // Build flat display list: tools + narratives interleaved by step
  const displayItems: DisplayItem[] = [];
  for (const step of activeSteps) {
    const tools: StepToolEntry[] = (step as any).tools || [];
    const narratives = (stepNotifyMessages || [])
      .filter(n => n.stepId === step.id)
      .map(n => n.text);

    // Add tool call rows for this step
    tools.forEach((tool, idx) => {
      const fnName = tool.function_name || tool.name || "";
      displayItems.push({
        kind: "tool",
        tool,
        stepId: step.id,
        key: `${step.id}-tool-${tool.tool_call_id || idx}`,
        onPress: onToolPress
          ? () => {
              onToolPress({
                functionName: fnName,
                functionArgs: tool.function_args || tool.input || {},
                status: tool.status || "called",
                toolContent: tool.tool_content,
                functionResult: tool.function_result || tool.output,
                label: fnName,
                icon: "search",
                iconColor: "#4a7cf0",
              });
            }
          : undefined,
      });
    });

    // Add narrative rows after this step's tools
    narratives.forEach((text, i) => {
      displayItems.push({
        kind: "narrative",
        text,
        key: `${step.id}-nar-${i}`,
      });
    });
  }

  // Plan-level notify messages appear at the bottom
  const planNarratives = notifyMessages || [];

  return (
    <View style={planStyles.container}>
      {/* Phase header — Manus-style: circle icon + task title + progress + chevron */}
      <TouchableOpacity
        style={planStyles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.75}
      >
        {/* Phase status circle */}
        <View
          style={[
            planStyles.phaseCircle,
            isAllDone && planStyles.phaseCircleDone,
            isRunning && !isAllDone && planStyles.phaseCircleRunning,
          ]}
        >
          {isAllDone ? (
            <Text style={planStyles.phaseCircleCheck}>✓</Text>
          ) : isRunning ? (
            <SpinnerIcon size={10} />
          ) : null}
        </View>

        <Text
          style={[
            planStyles.phaseTitle,
            isAllDone && planStyles.phaseTitleDone,
          ]}
          numberOfLines={2}
        >
          {plan.title || "Mengerjakan tugas"}
        </Text>

        <View style={planStyles.headerRight}>
          {totalCount > 0 && (
            <Text style={planStyles.counter}>
              {completedCount}/{totalCount}
            </Text>
          )}
          <Text style={planStyles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
        </View>
      </TouchableOpacity>

      {/* Content — flat list of tool rows + narrative lines */}
      {expanded && displayItems.length > 0 && (
        <View style={planStyles.content}>
          {displayItems.map(item => (
            <FadeSlideIn key={item.key}>
              {item.kind === "tool" ? (
                <ToolRow
                  tool={(item as FlatItem).tool}
                  onPress={(item as FlatItem).onPress}
                />
              ) : (
                <NarrativeLine text={(item as NarrativeItem).text} />
              )}
            </FadeSlideIn>
          ))}

          {/* Plan-level narratives */}
          {planNarratives.map((text, i) => (
            <FadeSlideIn key={`plan-nar-${i}`}>
              <NarrativeLine text={text} />
            </FadeSlideIn>
          ))}
        </View>
      )}

      {/* Empty state while loading first step */}
      {expanded && displayItems.length === 0 && isRunning && (
        <View style={planStyles.loadingRow}>
          <SpinnerIcon size={10} />
          <Text style={planStyles.loadingText}>Mempersiapkan...</Text>
        </View>
      )}
    </View>
  );
}

const planStyles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingRight: 2,
  },
  phaseCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#1e1e1e",
    borderWidth: 1.5,
    borderColor: "#383838",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  phaseCircleRunning: {
    borderColor: "#4a7cf0",
    backgroundColor: "rgba(74, 124, 240, 0.1)",
  },
  phaseCircleDone: {
    borderColor: "#4CAF50",
    backgroundColor: "rgba(76, 175, 80, 0.1)",
  },
  phaseCircleCheck: {
    fontSize: 10,
    color: "#5CAF5C",
    fontWeight: "700",
    lineHeight: 14,
  },
  phaseTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#d0d0d0",
    lineHeight: 20,
    flex: 1,
  },
  phaseTitleDone: {
    color: "#808080",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  counter: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#505050",
  },
  chevron: {
    fontSize: 11,
    color: "#505050",
  },
  content: {
    paddingLeft: 30,
    paddingTop: 2,
    paddingBottom: 4,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 30,
    paddingTop: 6,
    paddingBottom: 4,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#606060",
  },
});
