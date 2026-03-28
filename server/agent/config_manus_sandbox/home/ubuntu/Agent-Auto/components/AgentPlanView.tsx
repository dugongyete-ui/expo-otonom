import React, { useState } from "react";
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

function ToolRow({ event }: { event: AgentEvent }) {
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const isError = event.status === "error";
  const fnName = event.function_name || "";

  const toolConfig: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
    web_search: { icon: "search-outline", color: "#5AC8FA", label: "Searching web" },
    web_browse: { icon: "globe-outline", color: "#FF9F0A", label: "Browsing page" },
    browser_navigate: { icon: "globe-outline", color: "#FF9F0A", label: "Opening page" },
    browser_view: { icon: "eye-outline", color: "#FF9F0A", label: "Reading page" },
    browser_click: { icon: "finger-print-outline", color: "#FF9F0A", label: "Clicking" },
    browser_type: { icon: "create-outline", color: "#FF9F0A", label: "Typing" },
    browser_scroll: { icon: "arrow-down-outline", color: "#FF9F0A", label: "Scrolling" },
    shell_exec: { icon: "terminal-outline", color: "#30D158", label: "Running command" },
    shell_view: { icon: "terminal-outline", color: "#30D158", label: "Viewing output" },
    shell_wait: { icon: "time-outline", color: "#30D158", label: "Waiting" },
    file_read: { icon: "document-text-outline", color: "#FFD60A", label: "Reading file" },
    file_write: { icon: "save-outline", color: "#FFD60A", label: "Writing file" },
    file_str_replace: { icon: "create-outline", color: "#FFD60A", label: "Editing file" },
    file_find_by_name: { icon: "folder-open-outline", color: "#FFD60A", label: "Finding file" },
    message_notify_user: { icon: "chatbubble-outline", color: "#BF5AF2", label: "Notification" },
    message_ask_user: { icon: "help-circle-outline", color: "#BF5AF2", label: "Question" },
    mcp_call_tool: { icon: "extension-puzzle-outline", color: "#64D2FF", label: "MCP tool" },
  };

  const config = toolConfig[fnName] || { icon: "construct-outline" as keyof typeof Ionicons.glyphMap, color: "#8E8E93", label: fnName };

  const getArgPreview = (): string => {
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
      return val.length > 50 ? val.slice(0, 50) + "…" : val;
    }
    const firstKey = Object.keys(args)[0];
    if (firstKey) {
      const val = String(args[firstKey]);
      return val.length > 50 ? val.slice(0, 50) + "…" : val;
    }
    return "";
  };

  const argPreview = getArgPreview();

  return (
    <View style={[styles.toolRow, isError && styles.toolRowError]}>
      <Ionicons name={config.icon} size={12} color={config.color} />
      <Text style={[styles.toolLabel, { color: config.color }]} numberOfLines={1}>
        {config.label}
      </Text>
      {argPreview ? (
        <Text style={styles.toolArg} numberOfLines={1}>
          {argPreview}
        </Text>
      ) : null}
      <View style={styles.toolStatus}>
        {isCalling && <Ionicons name="ellipse" size={6} color="#6C5CE7" />}
        {isCalled && <Ionicons name="checkmark" size={11} color="#30D158" />}
        {isError && <Ionicons name="close" size={11} color="#FF453A" />}
      </View>
    </View>
  );
}

function StepCard({ step, isLast }: { step: AgentPlanStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(step.status === "running");
  const isRunning = step.status === "running";
  const isDone = step.status === "completed";
  const isFailed = step.status === "failed";
  const isPending = step.status === "pending";
  const tools = step.tools || [];

  React.useEffect(() => {
    if (isRunning) setExpanded(true);
    else if (isDone) setExpanded(false);
  }, [step.status, isRunning, isDone]);

  const renderIcon = () => {
    if (isDone) return <Ionicons name="checkmark-circle" size={18} color="#30D158" />;
    if (isFailed) return <Ionicons name="close-circle" size={18} color="#FF453A" />;
    if (isRunning) return <Ionicons name="radio-button-on" size={18} color="#6C5CE7" />;
    return <Ionicons name="radio-button-off" size={18} color="#3A3A3F" />;
  };

  return (
    <View style={styles.stepWrapper}>
      <View style={styles.stepConnector}>
        <View style={styles.stepIconCol}>
          {renderIcon()}
          {!isLast && (
            <View style={[styles.connectorLine, isDone && styles.connectorLineDone]} />
          )}
        </View>

        <View style={styles.stepBody}>
          <TouchableOpacity
            style={styles.stepHeader}
            onPress={() => setExpanded(!expanded)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.stepDescription,
                isDone && styles.stepDescriptionDone,
                isFailed && styles.stepDescriptionFailed,
                isPending && styles.stepDescriptionPending,
              ]}
              numberOfLines={2}
            >
              {step.description}
            </Text>
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={13}
              color="#3A3A3F"
            />
          </TouchableOpacity>

          {expanded && (
            <View style={styles.stepExpandedContent}>
              {/* Result/status description text */}
              {(isRunning || isDone) && step.result ? (
                <Text style={styles.stepResultText} numberOfLines={4}>
                  {step.result}
                </Text>
              ) : null}

              {/* Tool rows */}
              {tools.length > 0 && (
                <View style={styles.toolsList}>
                  {tools.map((tool, i) => (
                    <ToolRow key={`${tool.tool_call_id || i}`} event={tool} />
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export function AgentPlanView({ plan }: AgentPlanViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalCount = plan.steps.length;
  const allDone = completedCount === totalCount && totalCount > 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setCollapsed(!collapsed)}
        activeOpacity={0.7}
      >
        <View style={[styles.headerDot, allDone && styles.headerDotDone]}>
          {allDone ? (
            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
          ) : (
            <Ionicons name="flash" size={12} color="#FFFFFF" />
          )}
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Perencana
        </Text>
        <View style={styles.headerRight}>
          <Text style={styles.headerCount}>
            {completedCount} / {totalCount}
          </Text>
          <Ionicons
            name={collapsed ? "chevron-down" : "chevron-up"}
            size={14}
            color="#636366"
          />
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <View style={styles.stepsContainer}>
          {plan.steps.map((step, index) => (
            <StepCard
              key={step.id || index}
              step={step}
              isLast={index === plan.steps.length - 1}
            />
          ))}
        </View>
      )}

      {collapsed && (
        <View style={styles.collapsedInfo}>
          <Text style={styles.collapsedText}>
            {completedCount}/{totalCount} langkah selesai
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#111115",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#222228",
    overflow: "hidden",
    marginVertical: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
    justifyContent: "center",
  },
  headerDotDone: {
    backgroundColor: "#30D158",
  },
  headerTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#E8E8ED",
    letterSpacing: -0.2,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  headerCount: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#636366",
  },
  collapsedInfo: {
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  collapsedText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#636366",
  },
  stepsContainer: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 0,
  },
  stepWrapper: {
    minHeight: 32,
  },
  stepConnector: {
    flexDirection: "row",
    gap: 10,
  },
  stepIconCol: {
    alignItems: "center",
    width: 20,
  },
  connectorLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: "#2A2A30",
    marginTop: 4,
    marginBottom: -4,
    minHeight: 12,
  },
  connectorLineDone: {
    backgroundColor: "#30D15840",
  },
  stepBody: {
    flex: 1,
    paddingBottom: 12,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingTop: 1,
  },
  stepDescription: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#C8C8D0",
    lineHeight: 19,
    letterSpacing: -0.1,
  },
  stepDescriptionDone: {
    color: "#636366",
  },
  stepDescriptionFailed: {
    color: "#FF6B6B",
  },
  stepDescriptionPending: {
    color: "#444450",
  },
  stepExpandedContent: {
    gap: 6,
  },
  stepResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#8E8E93",
    lineHeight: 17,
    letterSpacing: -0.1,
    paddingRight: 4,
  },
  toolsList: {
    marginTop: 2,
    gap: 1,
    paddingLeft: 2,
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "#18181E",
    marginBottom: 2,
  },
  toolRowError: {
    backgroundColor: "rgba(255,69,58,0.06)",
  },
  toolLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: -0.1,
  },
  toolArg: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 10,
    color: "#636366",
  },
  toolStatus: {
    width: 14,
    alignItems: "center",
  },
});
