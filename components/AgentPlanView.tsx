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

// Build a concise label like Manus shows for each tool step
function buildStepToolLabel(fnName: string, args: Record<string, unknown>): string {
  // Browser-specific richer labels
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
  if (fnName === "browser_scroll") {
    const dir = String(args.direction || "").toLowerCase();
    const page = String(args.page || args.url || "");
    const dirLabel = dir === "up" ? "ke atas" : dir === "down" ? "ke bawah" : dir ? `ke ${dir}` : "";
    if (page) {
      try {
        const domain = new URL(page.startsWith("http") ? page : `https://${page}`).hostname.replace(/^www\./, "");
        return `Scroll ${dirLabel} di ${domain}`.trim();
      } catch {}
    }
    return dirLabel ? `Scroll ${dirLabel}` : "Scroll halaman";
  }
  if (fnName === "browser_click") {
    const sel = String(args.selector || args.element || args.label || args.text || "");
    if (sel) return `Klik: ${sel.slice(0, 45)}`;
    return "Klik elemen";
  }
  if (fnName === "browser_type" || fnName === "browser_input") {
    const text = String(args.text || args.value || args.input || "");
    const field = String(args.selector || args.field || "");
    if (text && field) return `Mengetik '${text.slice(0, 30)}' di ${field.slice(0, 25)}`;
    if (text) return `Mengetik: '${text.slice(0, 40)}'`;
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

  // Search tools
  if (fnName === "web_search" || fnName === "info_search_web") {
    const q = String(args.query || args.q || "");
    if (q) return `Mencari '${q.slice(0, 45)}'`;
    return "Mencari informasi";
  }

  // Shell tools
  if (fnName === "shell_exec") {
    const cmd = String(args.command || args.cmd || "");
    if (cmd) return `Jalankan: ${cmd.slice(0, 45)}`;
    return "Jalankan perintah";
  }
  if (fnName === "shell_view") {
    return "Lihat output terminal";
  }

  // File tools
  if (fnName === "file_read") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Membaca ${file.slice(0, 45)}`;
    return "Membaca file";
  }
  if (fnName === "file_write") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Menulis ${file.slice(0, 45)}`;
    return "Menulis file";
  }
  if (fnName === "file_str_replace") {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    if (file) return `Mengedit ${file.slice(0, 45)}`;
    return "Mengedit file";
  }
  if (fnName === "file_find_by_name") {
    const name = String(args.name || args.pattern || "");
    if (name) return `Cari file: ${name.slice(0, 40)}`;
    return "Cari file berdasarkan nama";
  }
  if (fnName === "file_find_in_content") {
    const q = String(args.query || args.pattern || "");
    if (q) return `Cari dalam file: '${q.slice(0, 35)}'`;
    return "Cari dalam konten file";
  }

  // Message tools
  if (fnName === "message_notify_user") {
    const text = String(args.text || args.message || "");
    if (text) return `Notifikasi: ${text.slice(0, 40)}`;
    return "Notifikasi";
  }
  if (fnName === "message_ask_user") {
    const text = String(args.text || args.question || "");
    if (text) return `Tanya: ${text.slice(0, 40)}`;
    return "Pertanyaan ke pengguna";
  }

  // Generic fallback
  const primaryArgMap: Record<string, string> = {
    browser_navigate: "url", browser_view: "page", browser_tab_new: "url", web_browse: "url",
    shell_exec: "command",
    file_read: "file", file_write: "file", file_str_replace: "file",
    file_find_by_name: "path", file_find_in_content: "file",
  };
  const actionMap: Record<string, string> = {
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

function getToolIcon(fnName: string, color: string = "#888888"): React.ReactNode {
  const category = getToolCategory(fnName);
  const size = 12;
  switch (category) {
    case "browser":
    case "desktop":
      return <BrowserIcon size={size} color={color} />;
    case "file":
    case "image":
    case "multimedia":
      return <EditIcon size={size} color={color} />;
    case "search":
    case "info":
      return <SearchIcon size={size} color={color} />;
    case "message":
    case "todo":
    case "task":
    case "email":
      return <MessageIcon size={size} color={color} />;
    case "shell":
    default:
      return <ShellIcon size={size} color={color} />;
  }
}

// Animated spinner that rotates continuously
function SpinnerIcon() {
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <View style={spinnerStyles.ring} />
    </Animated.View>
  );
}

const spinnerStyles = StyleSheet.create({
  ring: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#4a7cf0",
    borderTopColor: "transparent",
  },
});

// Status indicator: spinner (calling), checkmark (called/success), X (error)
function ToolStatusIcon({ status }: { status?: string }) {
  const scaleAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (status === "called" || status === "error") {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 200,
        friction: 10,
        useNativeDriver: true,
      }).start();
    }
  }, [status]);

  if (status === "calling") {
    return <SpinnerIcon />;
  }

  if (status === "called") {
    return (
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <View style={statusStyles.checkCircle}>
          <Text style={statusStyles.checkMark}>✓</Text>
        </View>
      </Animated.View>
    );
  }

  if (status === "error") {
    return (
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <View style={statusStyles.errorCircle}>
          <Text style={statusStyles.errorMark}>✕</Text>
        </View>
      </Animated.View>
    );
  }

  // pending / unknown
  return <View style={statusStyles.pendingDot} />;
}

const statusStyles = StyleSheet.create({
  checkCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: {
    fontSize: 11,
    color: "#4CAF50",
    fontWeight: "700",
    lineHeight: 14,
  },
  errorCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  errorMark: {
    fontSize: 10,
    color: "#e05c5c",
    fontWeight: "700",
    lineHeight: 14,
  },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#444444",
    margin: 4,
  },
});

// Manus-style inline tool step row (icon + label + animated status)
function ManusToolStepRow({ tool, onPress }: { tool: StepToolEntry; onPress?: () => void }) {
  const fnName = tool.function_name || tool.name || "";
  const args = tool.function_args || tool.input || {};
  const label = buildStepToolLabel(fnName, args);
  const status = tool.status;

  const isRunning = status === "calling";
  const isDone = status === "called";
  const isError = status === "error";

  const iconColor = isRunning ? "#4a7cf0" : isDone ? "#4CAF50" : isError ? "#e05c5c" : "#666666";
  const icon = getToolIcon(fnName, iconColor);

  return (
    <TouchableOpacity
      style={mtsStyles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={[mtsStyles.iconWrap, isRunning && mtsStyles.iconWrapRunning, isDone && mtsStyles.iconWrapDone, isError && mtsStyles.iconWrapError]}>
        {icon}
      </View>
      <Text
        style={[
          mtsStyles.label,
          isRunning && mtsStyles.labelRunning,
          isDone && mtsStyles.labelDone,
          isError && mtsStyles.labelError,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View style={mtsStyles.statusWrap}>
        <ToolStatusIcon status={status} />
      </View>
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
  iconWrapRunning: {
    backgroundColor: "rgba(74, 124, 240, 0.1)",
  },
  iconWrapDone: {
    backgroundColor: "rgba(76, 175, 80, 0.08)",
  },
  iconWrapError: {
    backgroundColor: "rgba(224, 92, 92, 0.08)",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#666666",
    flex: 1,
  },
  labelRunning: {
    color: "#a0b4e8",
  },
  labelDone: {
    color: "#888888",
  },
  labelError: {
    color: "#c07070",
  },
  statusWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});

// Narrative text shown between tool steps (Manus shows progress updates inline)
function NarrativeText({ message }: { message: string }) {
  return (
    <Text style={narrativeStyles.text}>{cleanText(message)}</Text>
  );
}

const narrativeStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    fontSize: 13,
    color: "#888888",
    lineHeight: 19,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});

export function AgentGoalMessage({ message }: { message: string }) {
  return (
    <Text style={goalMessageStyles.text}>{cleanText(message)}</Text>
  );
}

const goalMessageStyles = StyleSheet.create({
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#c8c8c8",
    lineHeight: 21,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});

/**
 * Manus-style AgentPlanView: A single collapsible task block.
 * Shows task title with circle indicator, steps inside with icons,
 * and inline narrative text between steps.
 */
export function AgentPlanView({ plan, notifyMessages, stepNotifyMessages, onToolPress }: AgentPlanViewProps) {
  const steps = plan.steps || [];
  const [expanded, setExpanded] = useState(true);

  const isAllDone = plan.status === "completed" || (steps.length > 0 && steps.every(s => s.status === "completed" || s.status === "failed"));
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
          isRunning && styles.taskCircleRunning,
          isAllDone && styles.taskCircleDone,
        ]}>
          {isAllDone && <CheckCircleIcon size={18} color="#4CAF50" />}
          {isRunning && !isAllDone && <SpinnerIcon />}
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
  taskCircleRunning: {
    borderColor: "#4a7cf0",
    borderWidth: 0,
    backgroundColor: "transparent",
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
