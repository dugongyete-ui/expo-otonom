import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import type { AgentPlan, AgentPlanStep, AgentEvent } from "@/lib/chat";

interface AgentPlanViewProps {
  plan: AgentPlan;
  notifyMessages?: string[];
  onToolPress?: () => void;
}

function cleanCitations(raw: string): string {
  return raw
    .replace(/<co>([\s\S]*?)<\/co:[^>]*>/g, "$1")
    .replace(/<\/?co[^>]*>/g, "");
}

const TOOL_META: Record<string, { label: string; icon: string }> = {
  web_search:           { label: "Mencari web",          icon: "search" },
  web_browse:           { label: "Membuka halaman",       icon: "globe" },
  browser_navigate:     { label: "Navigasi ke halaman",   icon: "globe" },
  browser_view:         { label: "Membaca halaman",       icon: "eye" },
  browser_click:        { label: "Mengklik elemen",       icon: "hand-left" },
  browser_type:         { label: "Mengetik teks",         icon: "create" },
  browser_scroll:       { label: "Scroll halaman",        icon: "arrow-down" },
  browser_console_exec: { label: "Menjalankan script",    icon: "code" },
  shell_exec:           { label: "Menjalankan perintah",  icon: "terminal" },
  shell_view:           { label: "Melihat output",        icon: "terminal" },
  shell_wait:           { label: "Menunggu proses",       icon: "time" },
  file_read:            { label: "Membaca file",          icon: "document-text" },
  file_write:           { label: "Menulis file",          icon: "save" },
  file_str_replace:     { label: "Mengedit file",         icon: "create" },
  file_find_by_name:    { label: "Mencari file",          icon: "search" },
  message_notify_user:  { label: "Mengirim notifikasi",   icon: "chatbubble" },
  message_ask_user:     { label: "Mengajukan pertanyaan", icon: "help-circle" },
  mcp_call_tool:        { label: "Menggunakan MCP",       icon: "extension-puzzle" },
};

function getArgPreview(fnName: string, args: any): string {
  if (!args || typeof args !== "object") return "";
  const keyMap: Record<string, string[]> = {
    web_search:           ["query"],
    web_browse:           ["url"],
    browser_navigate:     ["url"],
    browser_view:         ["url"],
    browser_click:        ["selector", "text"],
    browser_type:         ["text", "selector"],
    shell_exec:           ["command"],
    file_read:            ["file", "path"],
    file_write:           ["file", "path"],
    file_str_replace:     ["file", "path"],
    file_find_by_name:    ["name", "pattern"],
    message_notify_user:  ["text"],
    message_ask_user:     ["text"],
    mcp_call_tool:        ["tool_name"],
    browser_console_exec: ["js"],
  };
  const keys = keyMap[fnName] || Object.keys(args);
  for (const k of keys) {
    if (args[k]) {
      const val = String(args[k]);
      return val.length > 70 ? val.slice(0, 70) + "…" : val;
    }
  }
  return "";
}

function PulsingDot({ size = 6, color = "#888888" }: { size?: number; color?: string }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1,   duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }}
    />
  );
}

function ToolPill({
  event,
  onPress,
}: {
  event: AgentEvent & { function_name?: string; function_args?: any; output?: string; error?: string };
  onPress?: () => void;
}) {
  const fnName = event.function_name || (event as any).name || "";
  const args   = (event as any).function_args || (event as any).input || {};
  const meta   = TOOL_META[fnName] || { label: fnName, icon: "settings" };
  const preview = getArgPreview(fnName, args);

  const isCalling = event.status === "calling";
  const isCalled  = event.status === "called";
  const isError   = event.status === "error";

  return (
    <TouchableOpacity
      style={[
        styles.toolPill,
        isError && styles.toolPillError,
        isCalling && styles.toolPillActive,
      ]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={[
        styles.toolIconCircle,
        isCalling && styles.toolIconCircleActive,
        isError   && styles.toolIconCircleError,
      ]}>
        <NativeIcon
          name={meta.icon}
          size={11}
          color={isError ? "#f87171" : isCalling ? "#b0b0b0" : "#686868"}
        />
      </View>

      <View style={styles.toolPillContent}>
        <Text style={[styles.toolPillLabel, isError && styles.toolPillLabelError]} numberOfLines={1}>
          {meta.label}
        </Text>
        {preview ? (
          <Text style={styles.toolPillPreview} numberOfLines={1}>{preview}</Text>
        ) : null}
      </View>

      <View style={styles.toolPillStatus}>
        {isCalling && <PulsingDot size={5} color="#888888" />}
        {isCalled  && <NativeIcon name="checkmark" size={11} color="#555555" />}
        {isError   && <NativeIcon name="close"     size={11} color="#f87171" />}
      </View>
    </TouchableOpacity>
  );
}

function StepRow({
  step,
  onToolPress,
}: {
  step: AgentPlanStep;
  onToolPress?: () => void;
}) {
  const isRunning = step.status === "running";
  const isDone    = step.status === "completed";
  const isFailed  = step.status === "failed";
  const tools: AgentEvent[] = (step as any).tools || [];

  const [expanded, setExpanded] = useState(isRunning || isDone);

  useEffect(() => {
    if (isRunning || isDone) setExpanded(true);
  }, [isRunning, isDone]);

  const canExpand = tools.length > 0;
  const doneCount = tools.filter(t => t.status === "called").length;

  return (
    <View style={styles.stepRow}>
      <TouchableOpacity
        style={styles.stepHeader}
        onPress={() => canExpand && setExpanded(v => !v)}
        activeOpacity={canExpand ? 0.65 : 1}
      >
        <View style={[
          styles.stepBullet,
          isDone    && styles.stepBulletDone,
          isFailed  && styles.stepBulletFailed,
          isRunning && styles.stepBulletRunning,
        ]}>
          {isDone   && <NativeIcon name="checkmark" size={9} color="#686868" />}
          {isFailed && <NativeIcon name="close"     size={9} color="#f87171" />}
          {isRunning && <PulsingDot size={5} color="#999999" />}
        </View>

        <Text
          style={[
            styles.stepTitle,
            isDone    && styles.stepTitleDone,
            isFailed  && styles.stepTitleFailed,
            isRunning && styles.stepTitleRunning,
          ]}
          numberOfLines={3}
        >
          {step.description}
        </Text>

        {canExpand && (
          <View style={styles.stepRight}>
            {tools.length > 0 && (
              <Text style={styles.stepCounter}>{doneCount}/{tools.length}</Text>
            )}
            <NativeIcon
              name={expanded ? "chevron-up" : "chevron-down"}
              size={12}
              color="#444444"
            />
          </View>
        )}
      </TouchableOpacity>

      {expanded && tools.length > 0 && (
        <View style={styles.toolsContainer}>
          {tools.map((tool, i) => (
            <ToolPill
              key={(tool as any).tool_call_id || i}
              event={tool as any}
              onPress={onToolPress}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function AgentPlanView({ plan, notifyMessages, onToolPress }: AgentPlanViewProps) {
  const steps = plan.steps || [];
  const visibleSteps = steps.filter(
    s => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  return (
    <View style={styles.container}>
      {visibleSteps.map((step, i) => (
        <StepRow key={step.id || i} step={step} onToolPress={onToolPress} />
      ))}
      {notifyMessages && notifyMessages.length > 0 && (
        <View style={styles.notifyBlock}>
          {notifyMessages.map((msg, i) => (
            <View key={i} style={styles.notifyRow}>
              <NativeIcon name="chatbubble-ellipses" size={11} color="#686868" />
              <Text style={styles.notifyText}>{cleanCitations(msg)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
    paddingVertical: 2,
  },

  stepRow: {
    gap: 4,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  stepBullet: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#2a2a2a",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  stepBulletDone: {
    backgroundColor: "#242424",
    borderColor: "#383838",
  },
  stepBulletFailed: {
    backgroundColor: "#2a1a1a",
    borderColor: "#5a2020",
  },
  stepBulletRunning: {
    borderColor: "#555555",
    borderWidth: 1.5,
  },
  stepTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: "#888888",
    letterSpacing: -0.1,
  },
  stepTitleDone: {
    color: "#606060",
    fontFamily: "Inter_400Regular",
  },
  stepTitleFailed: {
    color: "#f87171",
  },
  stepTitleRunning: {
    color: "#e8e8e8",
    fontFamily: "Inter_600SemiBold",
  },
  stepRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 3,
    flexShrink: 0,
  },
  stepCounter: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#444444",
  },

  toolsContainer: {
    marginLeft: 25,
    gap: 4,
    paddingBottom: 2,
  },
  toolPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1c1c1e",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#252525",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  toolPillActive: {
    borderColor: "#303030",
    backgroundColor: "#1e1e20",
  },
  toolPillError: {
    borderColor: "#3a1a1a",
    backgroundColor: "#1e1212",
  },
  toolIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#252525",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolIconCircleActive: {
    backgroundColor: "#2a2a2a",
  },
  toolIconCircleError: {
    backgroundColor: "#2a1515",
  },
  toolPillContent: {
    flex: 1,
    gap: 1,
  },
  toolPillLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#686868",
    lineHeight: 16,
  },
  toolPillLabelError: {
    color: "#f87171",
  },
  toolPillPreview: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#484848",
    lineHeight: 15,
  },
  toolPillStatus: {
    flexShrink: 0,
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  notifyBlock: {
    marginTop: 6,
    marginLeft: 4,
    gap: 6,
    borderLeftWidth: 2,
    borderLeftColor: "#242424",
    paddingLeft: 10,
  },
  notifyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  notifyText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#909090",
    lineHeight: 18,
  },
});
