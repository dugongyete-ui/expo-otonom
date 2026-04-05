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

// ─── Tool label ──────────────────────────────────────────────────────────────

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

// ─── Animated helpers ────────────────────────────────────────────────────────

function SpinnerIcon({ size = 10 }: { size?: number }) {
  const rotAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotAnim, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: 1.5, borderColor: "#3B82F6", borderTopColor: "transparent",
      }} />
    </Animated.View>
  );
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(6)).current;
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

// ─── Tool Pill ───────────────────────────────────────────────────────────────

interface ToolPillProps {
  tool: StepToolEntry;
  animDelay?: number;
  onPress?: () => void;
}

function ToolPill({ tool, animDelay = 0, onPress }: ToolPillProps) {
  const fnName = tool.function_name || tool.name || "";
  const args = tool.function_args || tool.input || {};
  const label = buildToolLabel(fnName, args);
  const isCalling = tool.status === "calling";
  const isCalled = tool.status === "called";
  const isError = tool.status === "error";

  return (
    <FadeIn delay={animDelay}>
      <TouchableOpacity
        style={[
          pillStyles.pill,
          isCalling && pillStyles.pillCalling,
          isError && pillStyles.pillError,
        ]}
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={!onPress}
      >
        <View style={[
          pillStyles.statusDot,
          isCalling && pillStyles.statusDotCalling,
          isError && pillStyles.statusDotError,
        ]}>
          {isCalling ? (
            <SpinnerIcon size={9} />
          ) : isCalled ? (
            <Text style={pillStyles.checkChar}>✓</Text>
          ) : isError ? (
            <Text style={pillStyles.errorChar}>✕</Text>
          ) : null}
        </View>

        <Text
          style={[
            pillStyles.label,
            isCalling && pillStyles.labelCalling,
            isError && pillStyles.labelError,
          ]}
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
    backgroundColor: "#F5F4EF",
    borderWidth: 1,
    borderColor: "#E5E3DC",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
    gap: 9,
  },
  pillCalling: {
    borderColor: "rgba(59,130,246,0.25)",
    backgroundColor: "rgba(59,130,246,0.04)",
  },
  pillError: {
    borderColor: "rgba(239,68,68,0.2)",
    backgroundColor: "rgba(239,68,68,0.03)",
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#E5E3DC",
    borderWidth: 1,
    borderColor: "#D1CFC8",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statusDotCalling: {
    borderColor: "rgba(59,130,246,0.4)",
    backgroundColor: "rgba(59,130,246,0.06)",
  },
  statusDotError: {
    borderColor: "rgba(239,68,68,0.3)",
    backgroundColor: "rgba(239,68,68,0.05)",
  },
  checkChar: {
    fontSize: 8,
    color: "#22C55E",
    fontWeight: "700",
    lineHeight: 10,
  },
  errorChar: {
    fontSize: 8,
    color: "#EF4444",
    fontWeight: "700",
    lineHeight: 10,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 12.5,
    color: "#6B7280",
    flex: 1,
    lineHeight: 17,
  },
  labelCalling: {
    color: "#3B82F6",
  },
  labelError: {
    color: "#EF4444",
  },
});

// ─── Verbose filter ───────────────────────────────────────────────────────────
// Only filter truly verbose/formatted content (markdown tables, long numbered lists).
// Goal descriptions ("Saya menemukan...", "Menemukan...") SHOULD pass through.

const VERBOSE_EXACT_PREFIXES_LC = [
  "step execution error",
  "rencana selesai",
  "saya telah menyelesaikan semua",
];

function isVerbose(text: string): boolean {
  const lc = text.toLowerCase().trim();

  // Extremely long multi-paragraph content
  if (lc.length > 600) return true;

  // Markdown formatted content (tables, headers, numbered bullet lists)
  if (/^#{1,4}\s/.test(lc)) return true;
  if (/\|\s*---/.test(lc)) return true;
  if (/^(\d+\.\s+\*\*|[-*]\s+\*\*)/.test(lc)) return true;

  // Exact prefix matches for truly unhelpful messages
  for (const p of VERBOSE_EXACT_PREFIXES_LC) {
    if (lc.startsWith(p)) return true;
  }

  return false;
}

// Returns ALL clean narratives (not just the best one)
function getCleanNarratives(messages: string[]): string[] {
  return messages.filter(t => {
    const c = cleanText(t) || "";
    return c.trim().length > 10 && !isVerbose(c);
  });
}

// ─── Narrative line ───────────────────────────────────────────────────────────

function NarrativeLine({ text, animDelay = 0 }: { text: string; animDelay?: number }) {
  const MAX_CHARS = 380;
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
    fontSize: 13,
    color: "#9CA3AF",
    lineHeight: 19,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
});

// ─── Phase circle spinner ─────────────────────────────────────────────────────

function PhaseSpinner() {
  const rotAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotAnim, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View style={{
        width: 10, height: 10, borderRadius: 5,
        borderWidth: 1.5, borderColor: "#3B82F6", borderTopColor: "transparent",
      }} />
    </Animated.View>
  );
}

// ─── Initial thinking row ─────────────────────────────────────────────────────

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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 }}>
      <Animated.View style={{
        width: 6, height: 6, borderRadius: 3,
        backgroundColor: "#3B82F6", opacity: pulseAnim,
      }} />
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12.5, color: "#9CA3AF" }}>
        Sedang berpikir...
      </Text>
    </View>
  );
}

// ─── AgentGoalMessage ─────────────────────────────────────────────────────────

export function AgentGoalMessage({ message }: { message: string }) {
  return <Text style={goalStyles.text}>{cleanText(message)}</Text>;
}

const goalStyles = StyleSheet.create({
  text: { fontFamily: "Inter_400Regular", fontSize: 13.5, color: "#374151", lineHeight: 20, paddingVertical: 4 },
});

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * AgentPlanView — Manus.im-style task block
 *
 * Shows ALL tools (calling=spinner, called=✓, error=✕) interleaved with
 * ALL intermediate goal descriptions after each tool batch.
 * Goal descriptions are shown as plain text (not filtered to just the "best" one).
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

  // All steps that have started (running, completed, or failed)
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

    // Show ALL tools (calling, called, error)
    tools.forEach((tool, tIdx) => {
      displayItems.push({
        kind: "pill",
        key: `${step.id}-tool-${tool.tool_call_id || tIdx}`,
        tool,
      });
    });

    // Show ALL clean goal narratives for this step (not just the last one)
    const cleanNarratives = getCleanNarratives(stepMsgs);
    cleanNarratives.forEach((msg, mIdx) => {
      displayItems.push({
        kind: "narrative",
        key: `${step.id}-nar-${mIdx}`,
        text: msg,
      });
    });
  }

  // Plan-level narratives (not tied to a specific step)
  const planNarratives = getCleanNarratives(notifyMessages || []);

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
            <PhaseSpinner />
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
                {planNarratives.map((text, i) => (
                  <NarrativeLine
                    key={`plan-nar-${i}`}
                    text={text}
                    animDelay={(displayItems.length + i) * 40}
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
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingRight: 12,
  },
  phaseCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#F5F4EF",
    borderWidth: 1.5,
    borderColor: "#D1CFC8",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  phaseCircleRunning: {
    borderColor: "#3B82F6",
    backgroundColor: "rgba(59,130,246,0.06)",
  },
  phaseCircleDone: {
    borderColor: "#22C55E",
    backgroundColor: "rgba(34,197,94,0.06)",
  },
  phaseCheck: {
    fontSize: 10,
    color: "#22C55E",
    fontWeight: "700",
    lineHeight: 14,
  },
  phaseTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13.5,
    color: "#1A1A1A",
    lineHeight: 19,
    flex: 1,
  },
  phaseTitleDone: {
    color: "#6B7280",
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
    color: "#9CA3AF",
  },
  chevron: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  body: {
    flexDirection: "row",
    paddingLeft: 12,
    paddingRight: 12,
    marginTop: 0,
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: "#F0EEE6",
    paddingTop: 8,
  },
  leftBorder: {
    width: 1.5,
    backgroundColor: "#E5E3DC",
    borderRadius: 1,
    marginRight: 12,
    flexShrink: 0,
  },
  content: {
    flex: 1,
    paddingTop: 2,
    paddingBottom: 2,
  },
});
