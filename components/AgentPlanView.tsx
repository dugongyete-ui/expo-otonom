import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Easing,
} from "react-native";
import type { AgentPlan, ToolContent } from "@/lib/chat";
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

// Build a human-readable label for each tool call
function buildToolLabel(fnName: string, args: Record<string, unknown>): string {
  if (fnName === "browser_navigate" || fnName === "web_browse") {
    const url = String(args.url || args.page || "");
    if (url) {
      try {
        const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
        return `Navigasi ke ${domain}`;
      } catch {
        return `Navigasi ke ${url.slice(0, 50)}`;
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
    if (sel) return `Klik: ${sel.slice(0, 50)}`;
    return "Klik elemen";
  }
  if (fnName === "browser_type" || fnName === "browser_input") {
    const text = String(args.text || args.value || args.input || "");
    if (text) return `Mengetik: '${text.slice(0, 45)}'`;
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
    if (q) return `Mencari ${q.slice(0, 60)}`;
    return "Mencari informasi";
  }
  if (fnName === "shell_exec") {
    const cmd = String(args.command || args.cmd || "");
    if (cmd) return `Jalankan: ${cmd.slice(0, 50)}`;
    return "Jalankan perintah";
  }
  if (fnName === "shell_view") return "Lihat output terminal";
  if (fnName === "file_read") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Membaca ${file.slice(0, 50)}`;
    return "Membaca file";
  }
  if (fnName === "file_write") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Menyimpan ${file.slice(0, 50)}`;
    return "Menulis file";
  }
  if (fnName === "file_str_replace") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Mengedit ${file.slice(0, 50)}`;
    return "Mengedit file";
  }
  if (fnName === "message_notify_user") {
    const text = String(args.text || args.message || "");
    if (text) return text.slice(0, 65);
    return "Notifikasi";
  }
  if (fnName === "message_ask_user") {
    const text = String(args.text || args.question || "");
    if (text) return `Tanya: ${text.slice(0, 45)}`;
    return "Pertanyaan";
  }
  const first = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
  let argVal = first ? String(args[first] || "") : "";
  argVal = argVal.replace(/^\/home\/ubuntu\//, "~/");
  if (argVal.length > 60) argVal = argVal.slice(0, 60) + "…";
  if (argVal) return `${fnName.replace(/_/g, " ")}: ${argVal}`;
  return fnName.replace(/_/g, " ");
}

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

// Fade + slide-up animation when a row appears
function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 220, delay, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 220, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
      {children}
    </Animated.View>
  );
}

// Manus-style tool pill — shown for COMPLETED tools only
interface ToolPillProps {
  tool: StepToolEntry;
  animDelay?: number;
  onPress?: () => void;
}

function ToolPill({ tool, animDelay = 0, onPress }: ToolPillProps) {
  const fnName = tool.function_name || tool.name || "";
  const args = tool.function_args || tool.input || {};
  const label = buildToolLabel(fnName, args);
  const isError = tool.status === "error";
  const iconChar = getToolIconChar(fnName);

  return (
    <FadeIn delay={animDelay}>
      <TouchableOpacity
        style={[pillStyles.pill, isError && pillStyles.pillError]}
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={!onPress}
      >
        {/* Icon circle */}
        <View style={[pillStyles.iconCircle, isError && pillStyles.iconCircleError]}>
          <Text style={pillStyles.iconChar}>{iconChar}</Text>
        </View>

        {/* Label — single line, truncated */}
        <Text
          style={[pillStyles.label, isError && pillStyles.labelError]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>

        {/* Trailing icon: error X, or nothing for done */}
        {isError ? (
          <Text style={pillStyles.errorMark}>✕</Text>
        ) : null}
      </TouchableOpacity>
    </FadeIn>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1b1b1b",
    borderWidth: 1,
    borderColor: "#282828",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 5,
    gap: 8,
  },
  pillError: {
    borderColor: "#3a1f1f",
    backgroundColor: "#1a1515",
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#232323",
    borderWidth: 1,
    borderColor: "#303030",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconCircleError: {
    borderColor: "#4a2020",
    backgroundColor: "#221515",
  },
  iconChar: {
    fontSize: 11,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#787878",
    flex: 1,
    lineHeight: 18,
  },
  labelError: {
    color: "#8a5050",
  },
  errorMark: {
    fontSize: 11,
    color: "#a06060",
    fontWeight: "700",
    flexShrink: 0,
  },
});

// Narrative line — short text between tool pills
function NarrativeLine({ text, animDelay = 0 }: { text: string; animDelay?: number }) {
  // Truncate very long notify messages to keep it clean
  const MAX_CHARS = 180;
  const cleaned = cleanText(text) || "";
  const display = cleaned.length > MAX_CHARS ? cleaned.slice(0, MAX_CHARS).trimEnd() + "…" : cleaned;

  return (
    <FadeIn delay={animDelay}>
      <Text style={narStyles.text}>
        {display}
      </Text>
    </FadeIn>
  );
}

const narStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#a0a0a0",
    lineHeight: 19,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
});

// "Sedang berpikir" / "Sedang mencari" pulsing indicator inside the block
function ThinkingRow() {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={thinkStyles.row}>
      <Animated.View style={[thinkStyles.dot, { opacity: pulseAnim }]} />
      <Text style={thinkStyles.label}>Sedang berpikir</Text>
    </View>
  );
}

const thinkStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4a7cf0",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#6080b8",
  },
});

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
 * Manus.im-style AgentPlanView
 *
 * Layout:
 *  [○ / ✓]  Task title                              2/2  ⌃
 *  │  [pill: 🔍 Mencari informasi terbaru Timnas...]
 *  │  [pill: 🔍 Mencari status Kualifikasi Piala...]
 *  │  Saya menemukan ranking FIFA terbaru Indonesia di posisi 122…
 *  │  [pill: 📄 Menyimpan temuan awal tentang Timnas...]
 *  │  ● Sedang berpikir   ← only when still running
 *
 * Only COMPLETED (called/error) tool calls are shown as pills inside the block.
 * The currently RUNNING tool is handled by ChatPage's ManusThinkingIndicator (external).
 * Narrative text (stepNotifyMessages) appears between pills, truncated to 180 chars.
 */
export function AgentPlanView({
  plan,
  notifyMessages,
  stepNotifyMessages,
  onToolPress,
}: AgentPlanViewProps) {
  const allSteps = plan.steps || [];

  const isAllDone =
    plan.status === "completed" ||
    (allSteps.length > 0 && allSteps.every(s => s.status === "completed" || s.status === "failed"));
  const isRunning =
    plan.status === "running" || allSteps.some(s => s.status === "running");

  const completedCount = allSteps.filter(s => s.status === "completed" || s.status === "failed").length;
  const totalCount = allSteps.length;

  // Always expanded during execution; can toggle when done
  const [expanded, setExpanded] = React.useState(true);
  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  // Build a flat ordered list: pills for DONE tools + narrative text interleaved
  // Only completed/error tools appear — running tools show via ChatPage's indicator
  interface DisplayItem {
    kind: "pill" | "narrative";
    key: string;
    tool?: StepToolEntry;
    text?: string;
    stepId?: string;
  }

  const displayItems: DisplayItem[] = [];
  const activeSteps = allSteps.filter(
    s => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  let globalIdx = 0;
  for (const step of activeSteps) {
    const tools: StepToolEntry[] = (step as any).tools || [];
    const narratives = (stepNotifyMessages || [])
      .filter(n => n.stepId === step.id)
      .map(n => n.text);

    // Add COMPLETED tools as pills
    tools.forEach((tool, tIdx) => {
      const isDone = tool.status === "called" || tool.status === "error";
      if (isDone) {
        displayItems.push({
          kind: "pill",
          key: `${step.id}-tool-${tool.tool_call_id || tIdx}`,
          tool,
          stepId: step.id,
        });
        globalIdx++;
      }
    });

    // Add narrative text after this step's tools
    narratives.forEach((text, i) => {
      displayItems.push({
        kind: "narrative",
        key: `${step.id}-nar-${i}`,
        text,
      });
      globalIdx++;
    });
  }

  // Plan-level narratives (not tied to a specific step)
  const planNarratives = notifyMessages || [];

  // Whether there are any completed pills at all
  const hasContent = displayItems.length > 0 || planNarratives.length > 0;

  return (
    <View style={planStyles.container}>
      {/* Header: circle status + task title + counter + chevron */}
      <TouchableOpacity
        style={planStyles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.75}
      >
        <View
          style={[
            planStyles.phaseCircle,
            isAllDone && planStyles.phaseCircleDone,
            isRunning && !isAllDone && planStyles.phaseCircleRunning,
          ]}
        >
          {isAllDone ? (
            <Text style={planStyles.phaseCheck}>✓</Text>
          ) : isRunning ? (
            <SpinnerIcon size={10} />
          ) : null}
        </View>

        <Text
          style={[planStyles.phaseTitle, isAllDone && planStyles.phaseTitleDone]}
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

      {/* Body: pills + narrative lines */}
      {expanded && (
        <View style={planStyles.body}>
          {/* Left border line */}
          <View style={planStyles.leftBorder} />

          {/* Content */}
          <View style={planStyles.content}>
            {hasContent ? (
              <>
                {displayItems.map((item, i) =>
                  item.kind === "pill" && item.tool ? (
                    <ToolPill
                      key={item.key}
                      tool={item.tool}
                      animDelay={i * 40}
                      onPress={onToolPress ? () => {
                        const fnName = item.tool!.function_name || item.tool!.name || "";
                        onToolPress({
                          functionName: fnName,
                          functionArgs: item.tool!.function_args || item.tool!.input || {},
                          status: item.tool!.status || "called",
                          toolContent: item.tool!.tool_content,
                          functionResult: item.tool!.function_result || item.tool!.output,
                          label: fnName,
                          icon: "search",
                          iconColor: "#4a7cf0",
                        });
                      } : undefined}
                    />
                  ) : (
                    <NarrativeLine
                      key={item.key}
                      text={item.text || ""}
                      animDelay={i * 40}
                    />
                  )
                )}

                {/* Plan-level narratives */}
                {planNarratives.map((text, i) => (
                  <NarrativeLine
                    key={`plan-nar-${i}`}
                    text={text}
                    animDelay={(displayItems.length + i) * 40}
                  />
                ))}
              </>
            ) : null}

            {/* "Sedang berpikir" — shown while running and no content yet */}
            {isRunning && !hasContent && (
              <ThinkingRow />
            )}
          </View>
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
    borderColor: "#363636",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  phaseCircleRunning: {
    borderColor: "#4a7cf0",
    backgroundColor: "rgba(74, 124, 240, 0.10)",
  },
  phaseCircleDone: {
    borderColor: "#4CAF50",
    backgroundColor: "rgba(76, 175, 80, 0.10)",
  },
  phaseCheck: {
    fontSize: 10,
    color: "#5CAF5C",
    fontWeight: "700",
    lineHeight: 14,
  },
  phaseTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#d8d8d8",
    lineHeight: 20,
    flex: 1,
  },
  phaseTitleDone: {
    color: "#888888",
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
    color: "#555555",
  },
  chevron: {
    fontSize: 11,
    color: "#555555",
  },
  body: {
    flexDirection: "row",
    paddingLeft: 9,
    marginTop: 2,
    marginBottom: 4,
  },
  leftBorder: {
    width: 1.5,
    backgroundColor: "#2a2a2a",
    borderRadius: 1,
    marginRight: 14,
    flexShrink: 0,
  },
  content: {
    flex: 1,
    paddingTop: 2,
    paddingBottom: 2,
  },
});
