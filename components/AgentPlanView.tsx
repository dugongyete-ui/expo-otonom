import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Easing,
} from "react-native";
import { CheckCircleIcon, ChevronUpIcon, ChevronDownIcon } from "@/components/icons/SvgIcon";
import { ShellIcon, BrowserIcon, EditIcon, SearchIcon, MessageIcon } from "@/components/icons/ToolIcons";
import type { AgentPlan, AgentPlanStep, AgentEvent, ToolContent } from "@/lib/chat";
import { getToolDisplayInfo, getToolCategory } from "@/lib/tool-constants";

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

function cleanCitations(raw: string): string {
  return raw
    .replace(/<co>([\s\S]*?)<\/co:[^>]*>/g, "$1")
    .replace(/<\/?co[^>]*>/g, "");
}

// Build a concise label like Manus shows for each tool step
function buildStepToolLabel(fnName: string, args: Record<string, unknown>): string {
  const primaryArgMap: Record<string, string> = {
    web_search: "query", info_search_web: "query",
    browser_navigate: "url", browser_view: "page", browser_tab_new: "url", web_browse: "url",
    shell_exec: "command",
    file_read: "file", file_write: "file", file_str_replace: "file",
    file_find_by_name: "path", file_find_in_content: "file",
  };
  const actionMap: Record<string, string> = {
    web_search: "Mencari", info_search_web: "Mencari",
    browser_navigate: "Membuka", browser_view: "Melihat", browser_tab_new: "Tab baru", web_browse: "Membuka",
    shell_exec: "Jalankan", shell_view: "Lihat output",
    file_read: "Membaca", file_write: "Menulis", file_str_replace: "Edit",
    file_find_by_name: "Cari file", file_find_in_content: "Cari dalam",
    message_notify_user: "Notifikasi", message_ask_user: "Tanya",
  };
  const argKey = primaryArgMap[fnName];
  let argVal = argKey && args[argKey] ? String(args[argKey]) : "";
  if (!argVal) {
    const first = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
    argVal = first ? String(args[first] || "") : "";
  }
  argVal = argVal.replace(/^\/home\/ubuntu\//, "~/");
  if (argVal.length > 55) argVal = argVal.slice(0, 55) + "…";
  const action = actionMap[fnName];
  if (action && argVal) return `${action} ${argVal}`;
  if (action) return action;
  return fnName;
}

function getToolIcon(fnName: string): React.ReactNode {
  const category = getToolCategory(fnName);
  const iconColor = "#888888";
  const size = 12;
  switch (category) {
    case "browser":
    case "desktop":
      return <BrowserIcon size={size} color={iconColor} />;
    case "file":
    case "image":
    case "multimedia":
      return <EditIcon size={size} color={iconColor} />;
    case "search":
    case "info":
      return <SearchIcon size={size} color={iconColor} />;
    case "message":
    case "todo":
    case "task":
    case "email":
      return <MessageIcon size={size} color={iconColor} />;
    case "shell":
    default:
      return <ShellIcon size={size} color={iconColor} />;
  }
}

// Manus-style inline tool step row (icon + label)
function ManusToolStepRow({ tool, onPress }: { tool: StepToolEntry; onPress?: () => void }) {
  const fnName = tool.function_name || tool.name || "";
  const args = tool.function_args || tool.input || {};
  const label = buildStepToolLabel(fnName, args);
  const icon = getToolIcon(fnName);

  return (
    <TouchableOpacity
      style={mtsStyles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={mtsStyles.iconWrap}>{icon}</View>
      <Text style={mtsStyles.label} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const mtsStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  iconWrap: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#999999",
    flex: 1,
  },
});

// Narrative text shown between tool steps (Manus shows progress updates inline)
function NarrativeText({ message }: { message: string }) {
  return (
    <Text style={narrativeStyles.text}>{cleanCitations(message)}</Text>
  );
}

const narrativeStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#c8c8c8",
    lineHeight: 21,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});

export function AgentGoalMessage({ message }: { message: string }) {
  return (
    <Text style={narrativeStyles.text}>{cleanCitations(message)}</Text>
  );
}

/**
 * Manus-style AgentPlanView: A single collapsible task block.
 * Shows task title with circle indicator, steps inside with icons,
 * and inline narrative text between steps.
 */
export function AgentPlanView({ plan, notifyMessages, stepNotifyMessages, onToolPress }: AgentPlanViewProps) {
  const steps = plan.steps || [];
  const [expanded, setExpanded] = useState(true);

  const isAllDone = plan.status === "completed" || steps.every(s => s.status === "completed" || s.status === "failed");
  const isRunning = plan.status === "running" || steps.some(s => s.status === "running");

  // Collect all tool steps and narrative messages in order
  const allVisibleSteps = steps.filter(
    s => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  // Build interleaved content: tools from steps + notify messages
  const buildContent = () => {
    const items: React.ReactNode[] = [];
    let key = 0;

    for (const step of allVisibleSteps) {
      const rawTools: StepToolEntry[] = (step as AgentPlanStep & { tools?: StepToolEntry[] }).tools || [];
      const stepTexts = (stepNotifyMessages || [])
        .filter(n => n.stepId === step.id)
        .map(n => n.text);

      for (const tool of rawTools) {
        const fnName = tool.function_name || tool.name || "";
        const displayInfo = getToolDisplayInfo(fnName);
        const handlePress = onToolPress ? () => {
          onToolPress({
            functionName: fnName,
            functionArgs: tool.function_args || tool.input || {},
            status: tool.status || "called",
            toolContent: tool.tool_content,
            functionResult: tool.function_result || tool.output,
            label: displayInfo.label,
            icon: displayInfo.icon,
            iconColor: displayInfo.color,
          });
        } : undefined;
        items.push(
          <ManusToolStepRow
            key={`tool-${key++}`}
            tool={tool}
            onPress={handlePress}
          />
        );
      }

      // Step-level notify messages (narrative text between tools)
      for (const text of stepTexts) {
        items.push(<NarrativeText key={`notify-${key++}`} message={text} />);
      }
    }

    // Plan-level notify messages
    if (notifyMessages && notifyMessages.length > 0) {
      for (const msg of notifyMessages) {
        items.push(<NarrativeText key={`plan-notify-${key++}`} message={msg} />);
      }
    }

    return items;
  };

  return (
    <View style={styles.container}>
      {/* Task header row */}
      <TouchableOpacity
        style={styles.taskHeader}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.taskCircle,
          isAllDone && styles.taskCircleDone,
        ]}>
          {isAllDone && <CheckCircleIcon size={18} color="#4CAF50" />}
        </View>
        <Text style={[
          styles.taskTitle,
          isAllDone && styles.taskTitleDone,
        ]} numberOfLines={2}>
          {plan.title || "Tugas"}
        </Text>
        {expanded
          ? <ChevronUpIcon size={16} color="#666666" />
          : <ChevronDownIcon size={16} color="#666666" />
        }
      </TouchableOpacity>

      {/* Expanded content: tool steps + narrative */}
      {expanded && (
        <View style={styles.taskContent}>
          {buildContent()}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 2,
    borderLeftColor: "#2a2a2a",
    marginLeft: 4,
    marginTop: 4,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  taskCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#444444",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  taskCircleDone: {
    borderColor: "#4CAF50",
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  taskTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#d0d0d0",
    lineHeight: 20,
  },
  taskTitleDone: {
    color: "#c8c8c8",
  },
  taskContent: {
    paddingLeft: 4,
    paddingBottom: 4,
    gap: 1,
  },
});
