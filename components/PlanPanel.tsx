/**
 * PlanPanel — ai-manus style plan visualization.
 * Two states:
 *  - Collapsed: floating bar at bottom with progress "X/Y", status icon, current step description
 *  - Expanded: full vertical panel showing all steps with per-step status icons
 * Smooth expand/collapse animation.
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

// ─── Clock icon (svg-style using View) ────────────────────────────────────────

function ClockIcon({ size = 14, color = "#888888" }: { size?: number; color?: string }) {
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 1.5,
      borderColor: color,
      alignItems: "center",
      justifyContent: "center",
    }}>
      <View style={{
        width: size * 0.06,
        height: size * 0.35,
        backgroundColor: color,
        position: "absolute",
        bottom: size * 0.3,
        left: size * 0.44,
        borderRadius: 1,
      }} />
      <View style={{
        width: size * 0.25,
        height: size * 0.06,
        backgroundColor: color,
        position: "absolute",
        bottom: size * 0.4,
        left: size * 0.44,
        borderRadius: 1,
      }} />
    </View>
  );
}

// ─── Step status icon ─────────────────────────────────────────────────────────

function StepStatusIcon({ status, index = 0 }: { status: string; index?: number }) {
  const isRunning = status === "running";
  const isDone = status === "completed";
  const isFailed = status === "failed";

  if (isRunning) {
    return <Spinner size={14} color="#3B82F6" />;
  }
  if (isDone) {
    return (
      <View style={iconStyles.successCircle}>
        <Text style={iconStyles.successCheck}>✓</Text>
      </View>
    );
  }
  if (isFailed) {
    return (
      <View style={iconStyles.failedCircle}>
        <Text style={iconStyles.failedX}>✕</Text>
      </View>
    );
  }
  return (
    <View style={iconStyles.pendingCircle}>
      <Text style={iconStyles.pendingNum}>{index + 1}</Text>
    </View>
  );
}

const iconStyles = StyleSheet.create({
  successCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderWidth: 1,
    borderColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
  },
  successCheck: {
    fontSize: 8,
    color: "#22C55E",
    fontWeight: "700",
    lineHeight: 10,
  },
  failedCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  failedX: {
    fontSize: 8,
    color: "#EF4444",
    fontWeight: "700",
    lineHeight: 10,
  },
  pendingCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#F5F4EF",
    borderWidth: 1,
    borderColor: "#D1CFC8",
    alignItems: "center",
    justifyContent: "center",
  },
  pendingNum: {
    fontSize: 7,
    color: "#9CA3AF",
    fontWeight: "700",
    lineHeight: 9,
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
          isCalled && pillStyles.labelDone,
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

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#F5F4EF",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    marginBottom: 3,
  },
  pillCalling: {
    borderColor: "rgba(59,130,246,0.25)",
    backgroundColor: "rgba(59,130,246,0.05)",
  },
  pillError: {
    borderColor: "rgba(239,68,68,0.2)",
    backgroundColor: "rgba(239,68,68,0.04)",
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
    backgroundColor: "#D1CFC8",
  },
  checkChar: {
    fontSize: 9,
    color: "#22C55E",
    fontWeight: "700",
  },
  errorChar: {
    fontSize: 9,
    color: "#EF4444",
    fontWeight: "700",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#9CA3AF",
    flex: 1,
    lineHeight: 16,
  },
  labelCalling: {
    color: "#3B82F6",
  },
  labelDone: {
    color: "#9CA3AF",
  },
  labelError: {
    color: "#EF4444",
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
    fontSize: 11.5,
    color: "#9CA3AF",
    lineHeight: 17,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
});

// ─── Single Step Row ──────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  narratives,
  isLast,
}: {
  step: any;
  index: number;
  narratives: string[];
  isLast: boolean;
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
      <View style={stepStyles.leftCol}>
        <View style={stepStyles.iconWrap}>
          <StepStatusIcon status={step.status} index={index} />
        </View>
        {!isLast && (
          <View style={[
            stepStyles.connector,
            isDoneStep && stepStyles.connectorDone,
            isRunning && stepStyles.connectorRunning,
          ]} />
        )}
      </View>

      <View style={[stepStyles.rightCol, isLast && stepStyles.rightColLast]}>
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
    gap: 10,
  },
  leftCol: {
    alignItems: "center",
    width: 18,
    flexShrink: 0,
    paddingTop: 2,
  },
  iconWrap: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  connector: {
    width: 1,
    flex: 1,
    minHeight: 8,
    backgroundColor: "#E5E3DC",
    borderRadius: 1,
    marginTop: 4,
    marginBottom: 0,
  },
  connectorDone: {
    backgroundColor: "rgba(34,197,94,0.2)",
  },
  connectorRunning: {
    backgroundColor: "rgba(59,130,246,0.25)",
  },
  rightCol: {
    flex: 1,
    paddingBottom: 16,
    paddingTop: 1,
  },
  rightColLast: {
    paddingBottom: 8,
  },
  desc: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#374151",
    lineHeight: 19,
  },
  descPending: {
    color: "#9CA3AF",
  },
  descDone: {
    color: "#9CA3AF",
  },
  descFailed: {
    color: "#EF4444",
  },
  descRunning: {
    color: "#1A1A1A",
  },
  activity: {
    marginTop: 5,
    gap: 1,
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
  const completedCount = steps.filter(s => s.status === "completed").length;
  const totalCount = steps.length;
  const allDone = plan.status === "completed" || (totalCount > 0 && steps.every(s => s.status === "completed" || s.status === "failed"));
  const planRunning = isRunning || plan.status === "running" || steps.some(s => s.status === "running");

  const currentStep = steps.find(s => s.status === "running" || s.status === "pending") || null;
  const currentStepDesc = currentStep?.description || (allDone ? "Task selesai" : plan.title || "Rencana");

  // Animated expand/collapse: 1 = expanded (full panel), 0 = collapsed (bar only)
  const expandAnim = useRef(new Animated.Value(isVisible ? 1 : 0)).current;
  const prevVisible = useRef(isVisible);

  useEffect(() => {
    if (prevVisible.current === isVisible) return;
    prevVisible.current = isVisible;
    Animated.timing(expandAnim, {
      toValue: isVisible ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [isVisible]);

  // Animate body opacity and scale
  const bodyOpacity = expandAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });
  const bodyTranslateY = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  });

  // Collapsed bar opacity (opposite of expanded)
  const barOpacity = expandAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0, 0],
  });

  const chevronRotate = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <View style={styles.container}>
      {/* Collapsed bar — fades out when expanding */}
      <Animated.View
        style={[collapsedStyles.barAnimated, { opacity: barOpacity }]}
        pointerEvents={isVisible ? "none" : "auto"}
      >
        <TouchableOpacity
          style={collapsedStyles.bar}
          onPress={onToggleVisible}
          activeOpacity={0.8}
        >
          <View style={collapsedStyles.leftSection}>
            <View style={collapsedStyles.iconWrap}>
              {planRunning ? (
                <Spinner size={13} color="#4a7cf0" />
              ) : allDone ? (
                <View style={collapsedStyles.doneCircle}>
                  <Text style={collapsedStyles.doneCheck}>✓</Text>
                </View>
              ) : (
                <ClockIcon size={13} color="#888888" />
              )}
            </View>
            <Text style={collapsedStyles.stepDesc} numberOfLines={1}>{currentStepDesc}</Text>
          </View>
          <View style={collapsedStyles.rightSection}>
            {totalCount > 0 && (
              <Text style={collapsedStyles.progress}>{completedCount}/{totalCount}</Text>
            )}
            <Animated.Text style={[collapsedStyles.chevron, { transform: [{ rotate: chevronRotate }] }]}>↑</Animated.Text>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Expanded panel — fades in when visible */}
      <Animated.View
        style={[
          styles.expandedPanel,
          {
            opacity: bodyOpacity,
            transform: [{ translateY: bodyTranslateY }],
          },
        ]}
        pointerEvents={isVisible ? "auto" : "none"}
      >
        {/* Header — tap to collapse */}
        <TouchableOpacity
          style={styles.header}
          onPress={onToggleVisible}
          activeOpacity={0.8}
        >
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle} numberOfLines={1}>{plan.title || "Task Progress"}</Text>
          </View>
          <View style={styles.headerRight}>
            {totalCount > 0 && (
              <Text style={styles.headerCounter}>{completedCount}/{totalCount}</Text>
            )}
            {onToggleVisible && (
              <Text style={styles.chevron}>↓</Text>
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
                isLast={index === steps.length - 1}
              />
            );
          })}

          {notifyMessages.filter(t => {
            const c = cleanText(t) || "";
            return c.trim().length > 10 && !isVerbose(c);
          }).map((text, i) => (
            <View key={`pnar-${i}`} style={styles.planNarrativeWrap}>
              <NarrativeText text={text} />
            </View>
          ))}

          {planRunning && steps.length === 0 && (
            <View style={styles.thinkingRow}>
              <Spinner size={12} color="#4a7cf0" />
              <Text style={styles.thinkingLabel}>Sedang berpikir...</Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// ─── Collapsed bar styles ─────────────────────────────────────────────────────

const collapsedStyles = StyleSheet.create({
  barAnimated: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E3DC",
    backgroundColor: "#F5F4EF",
    gap: 10,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  iconWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  doneCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderWidth: 1,
    borderColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
  },
  doneCheck: {
    fontSize: 8,
    color: "#22C55E",
    fontWeight: "700",
    lineHeight: 10,
  },
  stepDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#6B7280",
    flex: 1,
  },
  rightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  progress: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#9CA3AF",
  },
  chevron: {
    fontSize: 12,
    color: "#9CA3AF",
  },
});

// ─── Expanded panel styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F4EF",
    position: "relative",
  },
  expandedPanel: {
    flex: 1,
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#1A1A1A",
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
    color: "#9CA3AF",
  },
  chevron: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 12,
  },
  planNarrativeWrap: {
    paddingLeft: 28,
    paddingBottom: 6,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 28,
  },
  thinkingLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#6B7280",
  },
});
