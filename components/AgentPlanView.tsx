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
  web_browse: { icon: "globe-outline", color: "#d97706", label: "Browsing page" },
  browser_navigate: { icon: "globe-outline", color: "#d97706", label: "Navigating to webpage" },
  browser_view: { icon: "eye-outline", color: "#d97706", label: "Reading page" },
  browser_click: { icon: "finger-print-outline", color: "#d97706", label: "Clicking" },
  browser_type: { icon: "create-outline", color: "#d97706", label: "Typing" },
  browser_scroll: { icon: "arrow-down-outline", color: "#d97706", label: "Scrolling" },
  shell_exec: { icon: "terminal-outline", color: "#30D158", label: "Running command" },
  shell_view: { icon: "terminal-outline", color: "#30D158", label: "Viewing output" },
  shell_wait: { icon: "time-outline", color: "#30D158", label: "Waiting" },
  file_read: { icon: "document-text-outline", color: "#FFD60A", label: "Reading file" },
  file_write: { icon: "save-outline", color: "#FFD60A", label: "Writing file" },
  file_str_replace: { icon: "create-outline", color: "#FFD60A", label: "Editing file" },
  file_find_by_name: { icon: "folder-open-outline", color: "#FFD60A", label: "Finding file" },
  message_notify_user: { icon: "chatbubble-outline", color: "#7c3aed", label: "Notification" },
  message_ask_user: { icon: "help-circle-outline", color: "#7c3aed", label: "Question" },
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

function PulsingDot() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 550, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return <Animated.View style={[styles.pulseDot, { opacity }]} />;
}

function ToolChip({ event, isLast }: { event: AgentEvent; isLast: boolean }) {
  const fnName = event.function_name || "";
  const isError = event.status === "error";
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const config = toolConfig[fnName] || { icon: "construct-outline" as keyof typeof Ionicons.glyphMap, color: "#9ca3af", label: fnName };
  const argPreview = getArgPreview(event);

  return (
    <View style={styles.toolChipRow}>
      <View style={styles.toolTimelineCol}>
        <View style={[styles.toolTimelineDot, { backgroundColor: isError ? "#dc2626" : isCalled ? "#30D158" : "#ccc8be" }]} />
        {!isLast && <View style={styles.toolTimelineLine} />}
      </View>
      <View style={[styles.toolChip, isError && styles.toolChipError]}>
        <Ionicons name={config.icon} size={12} color={config.color} />
        <Text style={[styles.toolChipLabel, { color: config.color }]} numberOfLines={1}>
          {config.label}
        </Text>
        {argPreview ? (
          <View style={styles.toolArgPill}>
            <Text style={styles.toolArgPillText} numberOfLines={1}>{argPreview}</Text>
          </View>
        ) : null}
        <View style={styles.toolChipStatus}>
          {isCalling && <PulsingDot />}
          {isCalled && <Ionicons name="checkmark" size={10} color="#30D158" />}
          {isError && <Ionicons name="close" size={10} color="#dc2626" />}
        </View>
      </View>
    </View>
  );
}

function StepBlock({ step }: { step: AgentPlanStep }) {
  const [expanded, setExpanded] = useState(step.status === "running");
  const isRunning = step.status === "running";
  const isDone = step.status === "completed";
  const isFailed = step.status === "failed";
  const isPending = step.status === "pending";
  const tools = step.tools || [];

  useEffect(() => {
    if (isRunning) setExpanded(true);
    else if (isDone || isFailed) setExpanded(false);
  }, [step.status, isRunning, isDone, isFailed]);

  const borderColor = isDone ? "#16a34a" : isFailed ? "#dc2626" : isRunning ? "#2563eb" : "#ccc8be";
  const bgColor = isDone ? "#16a34a" : "transparent";

  return (
    <View style={styles.stepBlock}>
      <View style={styles.stepCard}>
        <TouchableOpacity
          style={styles.stepCardHeader}
          onPress={() => setExpanded(!expanded)}
          activeOpacity={0.7}
        >
          <View style={[styles.stepCheckCircle, { borderColor, backgroundColor: bgColor }]}>
            {isDone && <Ionicons name="checkmark" size={10} color="#ffffff" />}
            {isFailed && <Ionicons name="close" size={9} color="#dc2626" />}
          </View>
          <Text
            style={[
              styles.stepCardTitle,
              isDone && styles.stepCardTitleDone,
              isFailed && styles.stepCardTitleFailed,
              isPending && styles.stepCardTitlePending,
            ]}
            numberOfLines={2}
          >
            {step.description}
          </Text>
          {isRunning && <PulsingDot />}
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={13}
            color="#ccc8be"
            style={{ marginLeft: 2 }}
          />
        </TouchableOpacity>

        {expanded && tools.length > 0 && (
          <View style={styles.stepCardBody}>
            <View style={styles.toolsList}>
              {tools.map((tool, i) => (
                <ToolChip key={tool.tool_call_id || i} event={tool} isLast={i === tools.length - 1} />
              ))}
            </View>
          </View>
        )}
      </View>

      {step.result && (isDone || isRunning) && (
        <Text style={styles.stepResultText} numberOfLines={4}>
          {step.result}
        </Text>
      )}
    </View>
  );
}

export function AgentPlanView({ plan }: AgentPlanViewProps) {
  return (
    <View style={styles.container}>
      {plan.steps.map((step, index) => (
        <StepBlock key={step.id || index} step={step} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  stepBlock: {
    gap: 6,
  },
  stepCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  stepCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stepCheckCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepCardTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#111827",
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  stepCardTitleDone: {
    color: "#9ca3af",
  },
  stepCardTitleFailed: {
    color: "#dc2626",
  },
  stepCardTitlePending: {
    color: "#374151",
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#2563eb",
    flexShrink: 0,
  },
  stepCardBody: {
    borderTopWidth: 1,
    borderTopColor: "#f0ede7",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  toolsList: {
    gap: 0,
  },
  toolChipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 28,
  },
  toolTimelineCol: {
    width: 16,
    alignItems: "center",
    paddingTop: 9,
    flexShrink: 0,
  },
  toolTimelineDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#ccc8be",
  },
  toolTimelineLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: "#e5e7eb",
    marginTop: 2,
    minHeight: 14,
  },
  toolChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#f8f7f4",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginLeft: 6,
    marginBottom: 4,
  },
  toolChipError: {
    backgroundColor: "rgba(220,38,38,0.06)",
  },
  toolChipLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: -0.1,
    flexShrink: 0,
  },
  toolArgPill: {
    flex: 1,
    backgroundColor: "#eceae4",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  toolArgPillText: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#9ca3af",
  },
  toolChipStatus: {
    width: 14,
    alignItems: "center",
    flexShrink: 0,
  },
  stepResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 17,
    letterSpacing: -0.1,
    paddingHorizontal: 4,
  },
});
