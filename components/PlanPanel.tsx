/**
 * PlanPanel — ai-manus style real-time plan visualization.
 * Shows plan steps with animated status indicators, inline tool execution pills,
 * and intermediate goal narratives — connected to live SSE data.
 */
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  TouchableOpacity,
} from "react-native";
import type { AgentPlan } from "@/lib/chat";
import { cleanText } from "@/lib/text-utils";

interface StepToolEntry {
  tool_call_id?: string;
  name?: string;
  function_name?: string;
  status?: string;
  function_args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  function_result?: string;
  output?: string;
  error?: string;
}

interface PlanPanelProps {
  plan: AgentPlan;
  stepNotifyMessages?: { stepId: string; text: string }[];
  notifyMessages?: string[];
  isRunning?: boolean;
  isVisible?: boolean;
  onToggleVisible?: () => void;
}

// ─── Tool label builder ───────────────────────────────────────────────────────

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
  if (fnName === "web_search" || fnName === "info_search_web") {
    const q = String(args.query || args.q || "");
    if (q) return `Mencari ${q.slice(0, 50)}`;
    return "Mencari informasi";
  }
  if (fnName === "browser_click") {
    const sel = String(args.selector || args.element || args.label || args.text || "");
    if (sel) return `Klik: ${sel.slice(0, 40)}`;
    return "Klik elemen";
  }
  if (fnName === "browser_type" || fnName === "browser_input") {
    const text = String(args.text || args.value || args.input || "");
    if (text) return `Mengetik: '${text.slice(0, 40)}'`;
    return "Mengetik teks";
  }
  if (fnName === "browser_scroll") {
    const dir = String(args.direction || "").toLowerCase();
    return dir === "up" ? "Scroll ke atas" : dir === "down" ? "Scroll ke bawah" : "Scroll halaman";
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
  if (fnName === "shell_exec") {
    const cmd = String(args.command || args.cmd || "");
    if (cmd) return `Jalankan: ${cmd.slice(0, 45)}`;
    return "Jalankan perintah";
  }
  if (fnName === "file_read") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Baca ${file.slice(0, 45)}`;
    return "Membaca file";
  }
  if (fnName === "file_write") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Tulis ${file.slice(0, 45)}`;
    return "Menulis file";
  }
  if (fnName === "file_str_replace") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Edit ${file.slice(0, 45)}`;
    return "Mengedit file";
  }
  if (fnName === "message_notify_user") {
    const text = String(args.text || args.message || "");
    if (text) return text.slice(0, 55);
    return "Kirim notifikasi";
  }
  if (fnName === "message_ask_user") {
    const text = String(args.text || args.question || "");
    if (text) return `Tanya: ${text.slice(0, 45)}`;
    return "Tanya pengguna";
  }
  const first = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
  let argVal = first ? String(args[first] || "") : "";
  argVal = argVal.replace(/^\/home\/ubuntu\//, "~/");
  if (argVal.length > 50) argVal = argVal.slice(0, 50) + "…";
  if (argVal) return `${fnName.replace(/_/g, " ")}: ${argVal}`;
  return fnName.replace(/_/g, " ");
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 10, color = "#4a7cf0" }: { size?: number; color?: string }) {
  const rotAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotAnim, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        borderTopColor: "transparent",
      }} />
    </Animated.View>
  );
}

// ─── Pulse dot ────────────────────────────────────────────────────────────────

function PulseDot({ color = "#4a7cf0", size = 6 }: { color?: string; size?: number }) {
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
    <Animated.View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      opacity: pulseAnim,
    }} />
  );
}

// ─── Step status circle ───────────────────────────────────────────────────────

function StepCircle({ index, status }: { index: number; status: string }) {
  const isRunning = status === "running";
  const isDone = status === "completed";
  const isFailed = status === "failed";

  return (
    <View style={[
      circleStyles.circle,
      isRunning && circleStyles.circleRunning,
      isDone && circleStyles.circleDone,
      isFailed && circleStyles.circleFailed,
    ]}>
      {isRunning ? (
        <Spinner size={10} color="#4a7cf0" />
      ) : isDone ? (
        <Text style={circleStyles.check}>✓</Text>
      ) : isFailed ? (
        <Text style={circleStyles.cross}>✕</Text>
      ) : (
        <Text style={circleStyles.num}>{index + 1}</Text>
      )}
    </View>
  );
}

const circleStyles = StyleSheet.create({
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#1e1e1e",
    borderWidth: 1.5,
    borderColor: "#333333",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  circleRunning: {
    borderColor: "#4a7cf0",
    backgroundColor: "rgba(74,124,240,0.1)",
  },
  circleDone: {
    borderColor: "#4CAF50",
    backgroundColor: "rgba(76,175,80,0.1)",
  },
  circleFailed: {
    borderColor: "#e05c5c",
    backgroundColor: "rgba(224,92,92,0.1)",
  },
  num: {
    fontSize: 10,
    color: "#555555",
    fontWeight: "600",
    lineHeight: 13,
  },
  check: {
    fontSize: 11,
    color: "#4CAF50",
    fontWeight: "700",
    lineHeight: 13,
  },
  cross: {
    fontSize: 10,
    color: "#e05c5c",
    fontWeight: "700",
    lineHeight: 13,
  },
});

// ─── Tool pill ────────────────────────────────────────────────────────────────

function ToolPill({ tool }: { tool: StepToolEntry }) {
  const fnName = tool.function_name || tool.name || "";
  const args = tool.function_args || tool.input || {};
  const label = buildToolLabel(fnName, args);
  const isCalling = tool.status === "calling";
  const isCalled = tool.status === "called";
  const isError = tool.status === "error";

  return (
    <View style={[
      pillStyles.pill,
      isCalling && pillStyles.pillCalling,
      isError && pillStyles.pillError,
    ]}>
      <View style={pillStyles.iconWrap}>
        {isCalling ? (
          <Spinner size={8} color="#6080c0" />
        ) : isCalled ? (
          <Text style={pillStyles.checkChar}>✓</Text>
        ) : isError ? (
          <Text style={pillStyles.errorChar}>✕</Text>
        ) : (
          <View style={pillStyles.defaultDot} />
        )}
      </View>
      <Text
        style={[
          pillStyles.label,
          isCalling && pillStyles.labelCalling,
          isDone(tool) && pillStyles.labelDone,
          isError && pillStyles.labelError,
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </View>
  );
}

function isDone(tool: StepToolEntry) {
  return tool.status === "called";
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "#181818",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#242424",
    marginBottom: 3,
  },
  pillCalling: {
    borderColor: "#253050",
    backgroundColor: "#111520",
  },
  pillError: {
    borderColor: "#3a1f1f",
    backgroundColor: "#150d0d",
  },
  iconWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  defaultDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#444444",
  },
  checkChar: {
    fontSize: 9,
    color: "#4a8a4a",
    fontWeight: "700",
  },
  errorChar: {
    fontSize: 9,
    color: "#a06060",
    fontWeight: "700",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#666666",
    flex: 1,
    lineHeight: 16,
  },
  labelCalling: {
    color: "#7090c0",
  },
  labelDone: {
    color: "#555555",
  },
  labelError: {
    color: "#907070",
  },
});

// ─── Narrative text ───────────────────────────────────────────────────────────

const VERBOSE_PREFIXES_LC = [
  "step execution error",
  "rencana selesai",
  "saya telah menyelesaikan semua",
];

function isVerbose(text: string): boolean {
  const lc = text.toLowerCase().trim();
  if (lc.length > 600) return true;
  if (/^#{1,4}\s/.test(lc)) return true;
  if (/\|\s*---/.test(lc)) return true;
  if (/^(\d+\.\s+\*\*|[-*]\s+\*\*)/.test(lc)) return true;
  for (const p of VERBOSE_PREFIXES_LC) {
    if (lc.startsWith(p)) return true;
  }
  return false;
}

function NarrativeText({ text }: { text: string }) {
  const clean = cleanText(text) || "";
  const MAX = 380;
  const display = clean.length > MAX ? clean.slice(0, MAX).trimEnd() + "…" : clean;
  return (
    <Text style={narrativeStyles.text}>{display}</Text>
  );
}

const narrativeStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 12.5,
    color: "#909090",
    lineHeight: 18,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
});

// ─── Single Step Row ──────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  narratives,
}: {
  step: any;
  index: number;
  narratives: string[];
}) {
  const isRunning = step.status === "running";
  const isDoneStep = step.status === "completed";
  const isFailed = step.status === "failed";
  const isPending = step.status === "pending";
  const tools: StepToolEntry[] = (step as any).tools || [];
  const hasActivity = isRunning || isDoneStep || isFailed;
  const cleanNarratives = narratives.filter(t => {
    const c = cleanText(t) || "";
    return c.trim().length > 10 && !isVerbose(c);
  });

  return (
    <View style={stepStyles.row}>
      {/* Left: circle + connector line */}
      <View style={stepStyles.leftCol}>
        <StepCircle index={index} status={step.status} />
        <View style={[
          stepStyles.connector,
          isDoneStep && stepStyles.connectorDone,
          isRunning && stepStyles.connectorRunning,
        ]} />
      </View>

      {/* Right: content */}
      <View style={stepStyles.rightCol}>
        <View style={stepStyles.descRow}>
          <Text
            style={[
              stepStyles.desc,
              isPending && stepStyles.descPending,
              isDoneStep && stepStyles.descDone,
              isFailed && stepStyles.descFailed,
              isRunning && stepStyles.descRunning,
            ]}
            numberOfLines={2}
          >
            {step.description}
          </Text>
          {isRunning && (
            <View style={stepStyles.runningBadge}>
              <PulseDot color="#4a7cf0" size={5} />
              <Text style={stepStyles.runningLabel}>berjalan</Text>
            </View>
          )}
          {isDoneStep && (
            <Text style={stepStyles.doneBadge}>selesai</Text>
          )}
          {isFailed && (
            <Text style={stepStyles.failedBadge}>gagal</Text>
          )}
        </View>

        {/* Tools + narratives for active steps */}
        {hasActivity && (
          <View style={stepStyles.activity}>
            {tools.map((tool, tIdx) => (
              <ToolPill key={tool.tool_call_id || tIdx} tool={tool} />
            ))}
            {cleanNarratives.map((text, nIdx) => (
              <NarrativeText key={nIdx} text={text} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 0,
  },
  leftCol: {
    alignItems: "center",
    width: 24,
    flexShrink: 0,
  },
  connector: {
    width: 1.5,
    flex: 1,
    minHeight: 12,
    backgroundColor: "#252525",
    borderRadius: 1,
    marginTop: 3,
    marginBottom: 0,
  },
  connectorDone: {
    backgroundColor: "rgba(76,175,80,0.3)",
  },
  connectorRunning: {
    backgroundColor: "rgba(74,124,240,0.4)",
  },
  rightCol: {
    flex: 1,
    paddingBottom: 14,
  },
  descRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 3,
  },
  desc: {
    fontFamily: "Inter_500Medium",
    fontSize: 13.5,
    color: "#d0d0d0",
    lineHeight: 20,
    flex: 1,
  },
  descPending: {
    color: "#555555",
  },
  descDone: {
    color: "#606060",
  },
  descFailed: {
    color: "#a07070",
  },
  descRunning: {
    color: "#c0c8e8",
  },
  runningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(74,124,240,0.12)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
    marginTop: 1,
  },
  runningLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#6080c0",
  },
  doneBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#4a7a4a",
    flexShrink: 0,
    marginTop: 3,
  },
  failedBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#a06060",
    flexShrink: 0,
    marginTop: 3,
  },
  activity: {
    marginTop: 6,
    gap: 1,
  },
});

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? completed / total : 0;
  const widthAnim = useRef(new Animated.Value(pct)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  return (
    <View style={progressStyles.container}>
      <View style={progressStyles.track}>
        <Animated.View
          style={[
            progressStyles.fill,
            { width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
          ]}
        />
      </View>
      <Text style={progressStyles.label}>
        {completed}/{total} langkah selesai
      </Text>
    </View>
  );
}

const progressStyles = StyleSheet.create({
  container: {
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#1e1e1e",
  },
  track: {
    height: 3,
    backgroundColor: "#222222",
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#4a7cf0",
    borderRadius: 2,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#505050",
  },
});

// ─── Main PlanPanel ───────────────────────────────────────────────────────────

export function PlanPanel({
  plan,
  stepNotifyMessages = [],
  notifyMessages = [],
  isRunning = false,
  isVisible = true,
  onToggleVisible,
}: PlanPanelProps) {
  const steps = plan.steps || [];
  const completedCount = steps.filter(s => s.status === "completed" || s.status === "failed").length;
  const totalCount = steps.length;
  const allDone = plan.status === "completed" || (totalCount > 0 && completedCount === totalCount);
  const planRunning = isRunning || plan.status === "running" || steps.some(s => s.status === "running");

  if (!isVisible) {
    return (
      <View style={styles.collapsedContainer}>
        <TouchableOpacity
          style={styles.collapsedBar}
          onPress={onToggleVisible}
          activeOpacity={0.7}
        >
          <View style={styles.collapsedLeft}>
            {planRunning ? <Spinner size={9} color="#4a7cf0" /> : (
              allDone ? (
                <Text style={{ fontSize: 10, color: "#4CAF50", fontWeight: "700" }}>✓</Text>
              ) : (
                <View style={{ width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5, borderColor: "#444444" }} />
              )
            )}
            <Text style={styles.collapsedTitle} numberOfLines={1}>{plan.title || "Rencana"}</Text>
          </View>
          <Text style={styles.collapsedCounter}>{completedCount}/{totalCount}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={onToggleVisible}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          {planRunning ? (
            <Spinner size={11} color="#4a7cf0" />
          ) : allDone ? (
            <View style={styles.doneCircle}>
              <Text style={styles.doneCheck}>✓</Text>
            </View>
          ) : (
            <View style={styles.pendingCircle} />
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>{plan.title || "Rencana"}</Text>
        </View>
        <View style={styles.headerRight}>
          {totalCount > 0 && (
            <Text style={styles.headerCounter}>{completedCount}/{totalCount}</Text>
          )}
          {planRunning && (
            <View style={styles.liveChip}>
              <PulseDot color="#4a7cf0" size={5} />
              <Text style={styles.liveLabel}>live</Text>
            </View>
          )}
          {onToggleVisible && (
            <Text style={styles.chevron}>⌄</Text>
          )}
        </View>
      </TouchableOpacity>

      {/* Steps list */}
      <ScrollView
        style={styles.scrollArea}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {steps.map((step, index) => {
          const stepNarratives = stepNotifyMessages
            .filter(n => n.stepId === step.id)
            .map(n => n.text);
          return (
            <StepRow
              key={step.id || index}
              step={step}
              index={index}
              narratives={stepNarratives}
            />
          );
        })}

        {/* Plan-level narratives */}
        {notifyMessages.filter(t => {
          const c = cleanText(t) || "";
          return c.trim().length > 10 && !isVerbose(c);
        }).map((text, i) => (
          <View key={`pnar-${i}`} style={styles.planNarrativeWrap}>
            <NarrativeText text={text} />
          </View>
        ))}

        {/* Thinking state when no steps yet */}
        {planRunning && steps.length === 0 && (
          <View style={styles.thinkingRow}>
            <PulseDot color="#4a7cf0" size={6} />
            <Text style={styles.thinkingLabel}>Sedang berpikir...</Text>
          </View>
        )}
      </ScrollView>

      {/* Progress bar */}
      {totalCount > 0 && (
        <ProgressBar completed={completedCount} total={totalCount} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0d0d",
  },
  collapsedContainer: {
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e1e",
  },
  collapsedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  collapsedLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  collapsedTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#888888",
    flex: 1,
  },
  collapsedCounter: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#505050",
    flexShrink: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    gap: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  doneCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(76,175,80,0.12)",
    borderWidth: 1.5,
    borderColor: "#4CAF50",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  doneCheck: {
    fontSize: 9,
    color: "#4CAF50",
    fontWeight: "700",
    lineHeight: 12,
  },
  pendingCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#333333",
    flexShrink: 0,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13.5,
    color: "#d0d0d0",
    flex: 1,
    lineHeight: 20,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  headerCounter: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#505050",
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(74,124,240,0.1)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(74,124,240,0.2)",
  },
  liveLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#5878c0",
  },
  chevron: {
    fontSize: 12,
    color: "#444444",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
  },
  planNarrativeWrap: {
    paddingLeft: 36,
    paddingBottom: 8,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 36,
  },
  thinkingLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#5070a0",
  },
});
