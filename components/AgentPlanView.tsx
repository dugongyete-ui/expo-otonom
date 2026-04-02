import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AgentPlan, AgentPlanStep, AgentEvent } from "@/lib/chat";

interface AgentPlanViewProps {
  plan: AgentPlan;
}

const toolLabelMap: Record<string, string> = {
  web_search: "Mencari informasi",
  web_browse: "Membuka halaman",
  browser_navigate: "Navigasi ke halaman",
  browser_view: "Membaca halaman",
  browser_click: "Mengklik elemen",
  browser_type: "Mengetik teks",
  browser_scroll: "Scroll halaman",
  shell_exec: "Menjalankan perintah",
  shell_view: "Melihat output",
  shell_wait: "Menunggu",
  file_read: "Membaca file",
  file_write: "Menulis file",
  file_str_replace: "Mengedit file",
  file_find_by_name: "Mencari file",
  message_notify_user: "Mengirim notifikasi",
  message_ask_user: "Mengajukan pertanyaan",
  mcp_call_tool: "Menggunakan tool MCP",
};

function getToolDescription(event: AgentEvent): string {
  const fnName = event.function_name || "";
  const args = event.function_args || {};
  const label = toolLabelMap[fnName] || fnName;
  const argKeyMap: Record<string, string> = {
    web_search: "query",
    web_browse: "url",
    browser_navigate: "url",
    shell_exec: "command",
    file_read: "file",
    file_write: "file",
    message_notify_user: "text",
    message_ask_user: "text",
    mcp_call_tool: "tool_name",
  };
  const key = argKeyMap[fnName];
  if (key && args[key]) {
    const val = String(args[key]);
    const preview = val.length > 60 ? val.slice(0, 60) + "…" : val;
    return `${label}: ${preview}`;
  }
  return label;
}

function PulsingDot() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View style={[styles.runningDot, { opacity }]} />
  );
}

function ToolRow({ event, isLast }: { event: AgentEvent; isLast: boolean }) {
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const isError = event.status === "error";
  const description = getToolDescription(event);

  return (
    <View style={[styles.toolRow, !isLast && styles.toolRowNotLast]}>
      <View style={styles.toolRowLeft}>
        <View style={[styles.toolDot, isError && styles.toolDotError, isCalled && styles.toolDotDone]} />
        <View style={styles.toolRowLine} />
      </View>
      <View style={styles.toolRowContent}>
        <Text
          style={[
            styles.toolRowText,
            isError && styles.toolRowTextError,
            isCalled && styles.toolRowTextDone,
          ]}
          numberOfLines={2}
        >
          {description}
        </Text>
        {isCalling && <PulsingDot />}
        {isCalled && <Ionicons name="checkmark" size={12} color="#34C759" />}
        {isError && <Ionicons name="close" size={12} color="#FF453A" />}
      </View>
    </View>
  );
}

function StepRow({ step, index }: { step: AgentPlanStep; index: number }) {
  const isRunning = step.status === "running";
  const isDone = step.status === "completed";
  const isFailed = step.status === "failed";
  const tools = step.tools || [];

  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  return (
    <View style={styles.stepRow}>
      <TouchableOpacity
        style={styles.stepHeader}
        onPress={() => tools.length > 0 && setExpanded(!expanded)}
        activeOpacity={tools.length > 0 ? 0.6 : 1}
      >
        <View style={styles.stepIconCol}>
          {isDone ? (
            <View style={styles.stepDoneCircle}>
              <Ionicons name="checkmark" size={10} color="#fff" />
            </View>
          ) : isFailed ? (
            <View style={[styles.stepDoneCircle, { backgroundColor: "#FF453A" }]}>
              <Ionicons name="close" size={10} color="#fff" />
            </View>
          ) : isRunning ? (
            <View style={styles.stepRunningCircle}>
              <PulsingDot />
            </View>
          ) : (
            <View style={styles.stepPendingCircle} />
          )}
        </View>

        <Text
          style={[
            styles.stepTitle,
            isDone && styles.stepTitleDone,
            isFailed && styles.stepTitleFailed,
            isRunning && styles.stepTitleRunning,
          ]}
          numberOfLines={3}
        >
          {step.description}
        </Text>

        {tools.length > 0 && (
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={13}
            color="#374151"
          />
        )}
      </TouchableOpacity>

      {expanded && tools.length > 0 && (
        <View style={styles.toolsContainer}>
          {tools.map((tool, i) => (
            <ToolRow
              key={tool.tool_call_id || i}
              event={tool}
              isLast={i === tools.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function AgentPlanView({ plan }: AgentPlanViewProps) {
  const steps = plan.steps || [];
  const doneCount = steps.filter(s => s.status === "completed").length;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Ionicons name="sparkles" size={13} color="#3b82f6" />
          <Text style={styles.cardTitle} numberOfLines={2}>
            {plan.title || "Rencana"}
          </Text>
          {plan.status === "running" && <PulsingDot />}
          {plan.status === "completed" && (
            <View style={styles.doneBadge}>
              <Ionicons name="checkmark-circle" size={12} color="#34C759" />
              <Text style={styles.doneBadgeText}>Selesai</Text>
            </View>
          )}
        </View>

        <View style={styles.progressRow}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: steps.length > 0 ? `${(doneCount / steps.length) * 100}%` : "0%" },
              ]}
            />
          </View>
          <Text style={styles.progressText}>{doneCount}/{steps.length}</Text>
        </View>
      </View>

      <View style={styles.stepsList}>
        {steps.map((step, index) => (
          <StepRow key={step.id || index} step={step} index={index} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
    overflow: "hidden",
  },
  cardHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    gap: 8,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  cardTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#e5e7eb",
    letterSpacing: -0.2,
  },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  doneBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#34C759",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: "#1f2937",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#3b82f6",
    borderRadius: 2,
  },
  progressText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#4b5563",
    minWidth: 28,
    textAlign: "right",
  },
  stepsList: {
    paddingVertical: 6,
  },
  stepRow: {
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 6,
  },
  stepIconCol: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 1,
    flexShrink: 0,
  },
  stepDoneCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#34C759",
    alignItems: "center",
    justifyContent: "center",
  },
  stepRunningCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
  },
  stepPendingCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#2d3748",
  },
  stepTitle: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#9ca3af",
    lineHeight: 19,
    letterSpacing: -0.1,
  },
  stepTitleDone: {
    color: "#6b7280",
    textDecorationLine: "line-through",
  },
  stepTitleFailed: {
    color: "#f87171",
  },
  stepTitleRunning: {
    color: "#e5e7eb",
    fontFamily: "Inter_500Medium",
  },
  toolsContainer: {
    marginLeft: 28,
    marginBottom: 4,
    borderLeftWidth: 1,
    borderLeftColor: "#1f2937",
    paddingLeft: 12,
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    minHeight: 22,
  },
  toolRowNotLast: {
    marginBottom: 0,
  },
  toolRowLeft: {
    width: 10,
    alignItems: "center",
    paddingTop: 6,
    flexShrink: 0,
  },
  toolDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#2d3748",
    flexShrink: 0,
  },
  toolDotDone: {
    backgroundColor: "#34C759",
  },
  toolDotError: {
    backgroundColor: "#FF453A",
  },
  toolRowLine: {
    flex: 1,
    width: 1,
    backgroundColor: "transparent",
  },
  toolRowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  toolRowText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#4b5563",
    lineHeight: 17,
    letterSpacing: -0.1,
  },
  toolRowTextDone: {
    color: "#374151",
  },
  toolRowTextError: {
    color: "#f87171",
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#3b82f6",
    flexShrink: 0,
  },
});
