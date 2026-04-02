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

const toolConfig: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  web_search: { icon: "search-outline", color: "#5AC8FA", label: "Searching web" },
  web_browse: { icon: "globe-outline", color: "#FF9F0A", label: "Browsing page" },
  browser_navigate: { icon: "globe-outline", color: "#FF9F0A", label: "Navigating to webpage" },
  browser_view: { icon: "eye-outline", color: "#FF9F0A", label: "Reading page" },
  browser_click: { icon: "finger-print-outline", color: "#FF9F0A", label: "Clicking" },
  browser_type: { icon: "create-outline", color: "#FF9F0A", label: "Typing" },
  browser_scroll: { icon: "arrow-down-outline", color: "#FF9F0A", label: "Scrolling" },
  shell_exec: { icon: "terminal-outline", color: "#34C759", label: "Running command" },
  shell_view: { icon: "terminal-outline", color: "#34C759", label: "Viewing output" },
  shell_wait: { icon: "time-outline", color: "#34C759", label: "Waiting" },
  file_read: { icon: "document-text-outline", color: "#FFD60A", label: "Reading file" },
  file_write: { icon: "save-outline", color: "#FFD60A", label: "Writing file" },
  file_str_replace: { icon: "create-outline", color: "#FFD60A", label: "Editing file" },
  file_find_by_name: { icon: "folder-open-outline", color: "#FFD60A", label: "Finding file" },
  message_notify_user: { icon: "chatbubble-outline", color: "#BF5AF2", label: "Notification" },
  message_ask_user: { icon: "help-circle-outline", color: "#BF5AF2", label: "Question" },
  mcp_call_tool: { icon: "extension-puzzle-outline", color: "#64D2FF", label: "MCP tool" },
};

function getArgPreview(event: AgentEvent): string {
  const fnName = event.function_name || "";
  const args = event.function_args || {};
  const argKeyMap: Record<string, string> = {
    web_search: "query", web_browse: "url", browser_navigate: "url",
    shell_exec: "command", file_read: "file", file_write: "file",
    message_notify_user: "text", message_ask_user: "text",
    mcp_call_tool: "tool_name",
  };
  const key = argKeyMap[fnName];
  if (key && args[key]) {
    const val = String(args[key]);
    return val.length > 45 ? val.slice(0, 45) + "…" : val;
  }
  const firstKey = Object.keys(args)[0];
  if (firstKey) {
    const val = String(args[firstKey]);
    return val.length > 45 ? val.slice(0, 45) + "…" : val;
  }
  return "";
}

function PulsingDot({ color = "#3b82f6" }: { color?: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.8, duration: 600, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[styles.pulseDot, { backgroundColor: color, opacity, transform: [{ scale }] }]}
    />
  );
}

function ToolChip({ event, isLast }: { event: AgentEvent; isLast: boolean }) {
  const fnName = event.function_name || "";
  const isError = event.status === "error";
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const config = toolConfig[fnName] || {
    icon: "construct-outline" as keyof typeof Ionicons.glyphMap,
    color: "#6b7280",
    label: fnName,
  };
  const argPreview = getArgPreview(event);

  return (
    <View style={styles.toolChipRow}>
      <View style={styles.toolTimelineCol}>
        <View style={[
          styles.toolTimelineDot,
          { backgroundColor: isError ? "#FF453A" : isCalled ? "#34C759" : "#4a4a4a" }
        ]} />
        {!isLast && <View style={styles.toolTimelineLine} />}
      </View>
      <View style={[styles.toolChip, isError && styles.toolChipError]}>
        <Ionicons name={config.icon} size={11} color={config.color} />
        <Text style={[styles.toolChipLabel, { color: config.color }]} numberOfLines={1}>
          {config.label}
        </Text>
        {argPreview ? (
          <View style={styles.toolArgPill}>
            <Text style={styles.toolArgPillText} numberOfLines={1}>{argPreview}</Text>
          </View>
        ) : null}
        <View style={styles.toolChipStatus}>
          {isCalling && <PulsingDot color="#3b82f6" />}
          {isCalled && <Ionicons name="checkmark" size={10} color="#34C759" />}
          {isError && <Ionicons name="close" size={10} color="#FF453A" />}
        </View>
      </View>
    </View>
  );
}

function StepBlock({ step }: { step: AgentPlanStep }) {
  const isRunning = step.status === "running";
  const isDone = step.status === "completed";
  const isFailed = step.status === "failed";
  const tools = step.tools || [];

  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
    }
  }, [isRunning]);

  const titleColor = isDone
    ? "#6b7280"
    : isFailed
    ? "#FF453A"
    : isRunning
    ? "#f9fafb"
    : "#8a8a8a";

  return (
    <View style={styles.stepBlock}>
      <TouchableOpacity
        style={styles.stepHeader}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.stepLeadCol}>
          {isDone ? (
            <View style={styles.stepDoneCircle}>
              <Ionicons name="checkmark" size={10} color="#fff" />
            </View>
          ) : isFailed ? (
            <View style={[styles.stepDoneCircle, styles.stepFailCircle]}>
              <Ionicons name="close" size={10} color="#fff" />
            </View>
          ) : isRunning ? (
            <PulsingDot color="#3b82f6" />
          ) : (
            <View style={styles.stepPendingCircle} />
          )}
        </View>

        <Text
          style={[styles.stepTitle, { color: titleColor }]}
          numberOfLines={2}
        >
          {step.description}
        </Text>

        {tools.length > 0 && (
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={12}
            color="#555"
            style={{ marginLeft: 4 }}
          />
        )}
      </TouchableOpacity>

      {expanded && tools.length > 0 && (
        <View style={styles.toolsContainer}>
          {tools.map((tool, i) => (
            <ToolChip
              key={tool.tool_call_id || i}
              event={tool}
              isLast={i === tools.length - 1}
            />
          ))}
        </View>
      )}

      {step.result && isDone && (
        <Text style={styles.stepResultText} numberOfLines={3}>
          {step.result}
        </Text>
      )}
    </View>
  );
}

function PerencanaStrip({ plan }: { plan: AgentPlan }) {
  const steps = plan.steps || [];
  const doneCount = steps.filter((s) => s.status === "completed").length;
  const total = steps.length;

  return (
    <View style={styles.perencanaStrip}>
      <View style={styles.perencanaHeader}>
        <View style={styles.perencanaIconWrap}>
          <Ionicons name="list-outline" size={11} color="#3b82f6" />
        </View>
        <Text style={styles.perencanaTitle}>Perencana</Text>
        <View style={styles.perencanaProgress}>
          <Text style={styles.perencanaProgressText}>{doneCount} / {total}</Text>
        </View>
      </View>
      <View style={styles.perencanaSteps}>
        {steps.map((step, i) => {
          const isDone = step.status === "completed";
          const isRunning = step.status === "running";
          return (
            <View key={step.id || i} style={styles.perencanaStepRow}>
              <View style={[
                styles.perencanaStepDot,
                isDone && styles.perencanaStepDotDone,
                isRunning && styles.perencanaStepDotRunning,
              ]} />
              <Text
                style={[
                  styles.perencanaStepText,
                  isDone && styles.perencanaStepTextDone,
                  isRunning && styles.perencanaStepTextRunning,
                ]}
                numberOfLines={1}
              >
                {isDone ? "✓ " : isRunning ? "▶ " : `${i + 1}. `}
                {step.description}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function AgentPlanView({ plan }: AgentPlanViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.stepsCard}>
        <View style={styles.cardHeader}>
          <Ionicons name="sparkles" size={13} color="#3b82f6" />
          <Text style={styles.cardTitle}>{plan.title || "Plan"}</Text>
          {plan.status === "running" && <PulsingDot color="#3b82f6" />}
          {plan.status === "completed" && (
            <View style={styles.completedBadge}>
              <Ionicons name="checkmark-circle" size={13} color="#34C759" />
              <Text style={styles.completedBadgeText}>Done</Text>
            </View>
          )}
        </View>

        <View style={styles.stepsList}>
          {plan.steps.map((step, index) => (
            <StepBlock key={step.id || index} step={step} />
          ))}
        </View>
      </View>

      <PerencanaStrip plan={plan} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 0,
  },
  stepsCard: {
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
    overflow: "hidden",
    marginBottom: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  cardTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#e5e7eb",
    letterSpacing: -0.2,
  },
  completedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  completedBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#34C759",
  },
  stepsList: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 4,
  },
  stepBlock: {
    gap: 4,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  stepLeadCol: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
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
  stepFailCircle: {
    backgroundColor: "#FF453A",
  },
  stepPendingCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#374151",
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#3b82f6",
    flexShrink: 0,
  },
  stepTitle: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#d1d5db",
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  toolsContainer: {
    marginLeft: 26,
    marginBottom: 4,
  },
  toolChipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 26,
  },
  toolTimelineCol: {
    width: 14,
    alignItems: "center",
    paddingTop: 8,
    flexShrink: 0,
  },
  toolTimelineDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#4a4a4a",
  },
  toolTimelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: "#2a2a2a",
    marginTop: 2,
    minHeight: 12,
  },
  toolChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#1a2133",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 6,
    marginBottom: 3,
  },
  toolChipError: {
    backgroundColor: "rgba(255,69,58,0.08)",
  },
  toolChipLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: -0.1,
    flexShrink: 0,
  },
  toolArgPill: {
    flex: 1,
    backgroundColor: "#0d1117",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  toolArgPillText: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#6b7280",
  },
  toolChipStatus: {
    width: 14,
    alignItems: "center",
    flexShrink: 0,
  },
  stepResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#4b5563",
    lineHeight: 16,
    letterSpacing: -0.1,
    marginLeft: 26,
    marginBottom: 4,
  },
  perencanaStrip: {
    backgroundColor: "#0d1117",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  perencanaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  perencanaIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: "rgba(59,130,246,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  perencanaTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "#6b7280",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  perencanaProgress: {
    backgroundColor: "#1a2133",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  perencanaProgressText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "#3b82f6",
  },
  perencanaSteps: {
    gap: 4,
  },
  perencanaStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  perencanaStepDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#2d2d2d",
    flexShrink: 0,
  },
  perencanaStepDotDone: {
    backgroundColor: "#34C759",
  },
  perencanaStepDotRunning: {
    backgroundColor: "#3b82f6",
  },
  perencanaStepText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#4b5563",
    lineHeight: 16,
  },
  perencanaStepTextDone: {
    color: "#34C759",
  },
  perencanaStepTextRunning: {
    color: "#93c5fd",
    fontFamily: "Inter_500Medium",
  },
});
