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

// ─── Tool label builder ──────────────────────────────────────────────────────

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
    if (q) return `Mencari ${q.slice(0, 65)}`;
    return "Mencari informasi";
  }
  if (fnName === "shell_exec") {
    const cmd = String(args.command || args.cmd || "");
    if (cmd) return `Menjalankan: ${cmd.slice(0, 50)}`;
    return "Menjalankan perintah";
  }
  if (fnName === "shell_view") return "Melihat output terminal";
  if (fnName === "file_read") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Membaca ${file.slice(0, 50)}`;
    return "Membaca file";
  }
  if (fnName === "file_write") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Menyimpan ${file.slice(0, 50)}`;
    return "Menyimpan file";
  }
  if (fnName === "file_str_replace") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Mengedit ${file.slice(0, 50)}`;
    return "Mengedit file";
  }
  if (fnName === "message_notify_user") {
    const text = String(args.text || args.message || "");
    if (text) return text.slice(0, 65);
    return "Mengirim notifikasi";
  }
  if (fnName === "message_ask_user") {
    const text = String(args.text || args.question || "");
    if (text) return `Tanya: ${text.slice(0, 45)}`;
    return "Mengajukan pertanyaan";
  }
  const first = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
  let argVal = first ? String(args[first] || "") : "";
  argVal = argVal.replace(/^\/home\/ubuntu\//, "~/");
  if (argVal.length > 60) argVal = argVal.slice(0, 60) + "…";
  if (argVal) return `${fnName.replace(/_/g, " ")}: ${argVal}`;
  return fnName.replace(/_/g, " ");
}

// ─── Tool icon (minimal, no emoji) ──────────────────────────────────────────

type ToolIconStyle = {
  bg: string;
  border: string;
  dot: string;
  letter: string;
};

function getToolIconStyle(fnName: string): ToolIconStyle {
  const cat = getToolCategory(fnName);
  switch (cat) {
    case "search":
    case "info":
      return { bg: "#141e30", border: "#1e3050", dot: "#3a6abf", letter: "S" };
    case "browser":
    case "desktop":
      return { bg: "#141e14", border: "#1e3020", dot: "#3a8a3a", letter: "W" };
    case "file":
    case "image":
    case "multimedia":
      return { bg: "#1e1814", border: "#302818", dot: "#8a6a30", letter: "F" };
    case "shell":
      return { bg: "#1e1428", border: "#30204a", dot: "#6a40a0", letter: ">" };
    case "message":
    case "todo":
    case "task":
    case "email":
      return { bg: "#1a1e14", border: "#283018", dot: "#5a8030", letter: "M" };
    default:
      return { bg: "#181818", border: "#282828", dot: "#505050", letter: "•" };
  }
}

// ─── Animated helpers ────────────────────────────────────────────────────────

function SpinnerIcon({ size = 12 }: { size?: number }) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: "#5b8def", borderTopColor: "transparent" }} />
    </Animated.View>
  );
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(7)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 230, delay, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 230, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
      {children}
    </Animated.View>
  );
}

// ─── Tool Pill ───────────────────────────────────────────────────────────────
// Manus.im style: no emoji, minimal colored letter-dot icon on left, label text

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
  const iconStyle = getToolIconStyle(fnName);

  return (
    <FadeIn delay={animDelay}>
      <TouchableOpacity
        style={[pillStyles.pill, isError && pillStyles.pillError]}
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={!onPress}
      >
        {/* Minimal icon: small colored dot in a circle (no emoji) */}
        <View style={[
          pillStyles.iconWrap,
          { backgroundColor: isError ? "#1a1515" : iconStyle.bg, borderColor: isError ? "#3a1f1f" : iconStyle.border }
        ]}>
          <View style={[pillStyles.iconDot, { backgroundColor: isError ? "#804040" : iconStyle.dot }]} />
        </View>

        {/* Label */}
        <Text
          style={[pillStyles.label, isError && pillStyles.labelError]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
      </TouchableOpacity>
    </FadeIn>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "#252525",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 5,
    gap: 9,
  },
  pillError: {
    borderColor: "#3a1f1f",
    backgroundColor: "#181212",
  },
  iconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#808080",
    flex: 1,
    lineHeight: 18,
  },
  labelError: {
    color: "#8a5050",
  },
});

// ─── Narrative filter ────────────────────────────────────────────────────────
// Keeps ONLY clean goal-summary text. Strips verbose patterns the agent outputs.

const VERBOSE_PREFIXES = [
  "saya telah menyelesaikan:",
  "berikut adalah",
  "berikut ini",
  "rencana selesai",
  "langkah-langkah berikutnya",
  "step execution error",
  "saya telah:",
  "telah selesai:",
  "hasil pencarian:",
  "informasi yang ditemukan:",
  "laporan ringkas",
  "laporan terbaru",
  "laporan komprehensif",
  "laporan ini",
];

function isVerboseText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length > 280) return true;
  for (const prefix of VERBOSE_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Pick the best narrative for a step's notify messages.
 * Returns the LAST clean (non-verbose) message, or null if none pass.
 */
function pickBestNarrative(messages: string[]): string | null {
  const clean = messages.filter(t => {
    const c = cleanText(t) || "";
    return c.trim().length > 10 && !isVerboseText(c);
  });
  if (clean.length === 0) return null;
  // Return the last clean message
  return clean[clean.length - 1];
}

// ─── Narrative line ──────────────────────────────────────────────────────────

function NarrativeLine({ text, animDelay = 0 }: { text: string; animDelay?: number }) {
  const MAX_CHARS = 220;
  const raw = cleanText(text) || "";
  const display = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS).trimEnd() + "…" : raw;
  return (
    <FadeIn delay={animDelay}>
      <Text style={narStyles.text}>{display}</Text>
    </FadeIn>
  );
}

const narStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 13.5,
    color: "#b0b0b0",
    lineHeight: 20,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
});

// ─── Thinking row (initial loading state inside block) ───────────────────────

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
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#4a7cf0" },
  label: { fontFamily: "Inter_400Regular", fontSize: 13, color: "#5a78b8" },
});

// ─── AgentGoalMessage ────────────────────────────────────────────────────────

export function AgentGoalMessage({ message }: { message: string }) {
  return <Text style={goalStyles.text}>{cleanText(message)}</Text>;
}

const goalStyles = StyleSheet.create({
  text: { fontFamily: "Inter_400Regular", fontSize: 14, color: "#c0c0c0", lineHeight: 21, paddingVertical: 4 },
});

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * AgentPlanView — Manus.im-style task block
 *
 * Visual structure:
 *   ○/✓  Task title                                     2/2  ⌃
 *   │  [pill: Mencari informasi terbaru timnas...]
 *   │  [pill: Navigasi ke pssi.org]
 *   │  Saya menemukan ranking FIFA terbaru Indonesia…    ← clean goal narrative only
 *   │  [pill: Menyimpan temuan awal tentang Timnas...]
 *   │  ● Sedang berpikir  ← only when no content yet
 *
 * Rules:
 * - Only COMPLETED (status "called"/"error") tools show as pills
 * - Running tool handled by ChatPage's ManusThinkingIndicator (external, below)
 * - Narrative: show only the LAST clean notify message per step (skip verbose text)
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

  const [expanded, setExpanded] = React.useState(true);
  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  // Build display items: completed tool pills + one clean narrative per step
  const activeSteps = allSteps.filter(
    s => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  interface DisplayItem {
    kind: "pill" | "narrative";
    key: string;
    tool?: StepToolEntry;
    text?: string;
  }

  const displayItems: DisplayItem[] = [];

  for (const step of activeSteps) {
    const tools: StepToolEntry[] = (step as any).tools || [];
    const stepMsgs = (stepNotifyMessages || [])
      .filter(n => n.stepId === step.id)
      .map(n => n.text);

    // Add COMPLETED tool pills only
    tools.forEach((tool, tIdx) => {
      if (tool.status === "called" || tool.status === "error") {
        displayItems.push({
          kind: "pill",
          key: `${step.id}-tool-${tool.tool_call_id || tIdx}`,
          tool,
        });
      }
    });

    // Add only 1 clean narrative per step (last valid one)
    const best = pickBestNarrative(stepMsgs);
    if (best) {
      displayItems.push({
        kind: "narrative",
        key: `${step.id}-nar`,
        text: best,
      });
    }
  }

  // Plan-level narratives (fallback)
  const planNarratives = (notifyMessages || []).filter(t => {
    const c = cleanText(t) || "";
    return c.trim().length > 10 && !isVerboseText(c);
  });

  const hasContent = displayItems.length > 0 || planNarratives.length > 0;

  return (
    <View style={planStyles.container}>
      {/* Header */}
      <TouchableOpacity
        style={planStyles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.75}
      >
        <View style={[
          planStyles.phaseCircle,
          isAllDone && planStyles.phaseCircleDone,
          isRunning && !isAllDone && planStyles.phaseCircleRunning,
        ]}>
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
            <Text style={planStyles.counter}>{completedCount}/{totalCount}</Text>
          )}
          <Text style={planStyles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
        </View>
      </TouchableOpacity>

      {/* Body */}
      {expanded && (
        <View style={planStyles.body}>
          <View style={planStyles.leftBorder} />
          <View style={planStyles.content}>
            {hasContent ? (
              <>
                {displayItems.map((item, i) =>
                  item.kind === "pill" && item.tool ? (
                    <ToolPill
                      key={item.key}
                      tool={item.tool}
                      animDelay={i * 45}
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
                      animDelay={i * 45}
                    />
                  )
                )}
                {planNarratives.map((text, i) => (
                  <NarrativeLine
                    key={`plan-nar-${i}`}
                    text={text}
                    animDelay={(displayItems.length + i) * 45}
                  />
                ))}
              </>
            ) : isRunning ? (
              <ThinkingRow />
            ) : null}
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
    backgroundColor: "#1a1a1a",
    borderWidth: 1.5,
    borderColor: "#343434",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  phaseCircleRunning: {
    borderColor: "#4a7cf0",
    backgroundColor: "rgba(74,124,240,0.10)",
  },
  phaseCircleDone: {
    borderColor: "#4CAF50",
    backgroundColor: "rgba(76,175,80,0.10)",
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
    backgroundColor: "#252525",
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
