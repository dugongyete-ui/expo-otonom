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
  notifyMessages?: string[];
}

const toolIconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
  web_search: "search-outline",
  web_browse: "globe-outline",
  browser_navigate: "globe-outline",
  browser_view: "eye-outline",
  browser_click: "finger-print-outline",
  browser_type: "create-outline",
  browser_scroll: "arrow-down-outline",
  shell_exec: "terminal-outline",
  shell_view: "terminal-outline",
  shell_wait: "time-outline",
  file_read: "document-text-outline",
  file_write: "save-outline",
  file_str_replace: "create-outline",
  file_find_by_name: "search-outline",
  message_notify_user: "chatbubble-outline",
  message_ask_user: "help-circle-outline",
  mcp_call_tool: "extension-puzzle-outline",
};

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

function getToolInfo(event: AgentEvent): { label: string; icon: keyof typeof Ionicons.glyphMap } {
  const fnName = event.function_name || "";
  const args = event.function_args || {};
  const label = toolLabelMap[fnName] || fnName;
  const icon = toolIconMap[fnName] || "construct-outline";

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
    const preview = val.length > 55 ? val.slice(0, 55) + "…" : val;
    return { label: `${label}: ${preview}`, icon };
  }

  return { label, icon };
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

  return <Animated.View style={[styles.pulsingDot, { opacity }]} />;
}

function ToolRow({ event }: { event: AgentEvent }) {
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const isError = event.status === "error";
  const { label, icon } = getToolInfo(event);

  return (
    <View style={styles.toolRow}>
      <View style={[
        styles.toolIconBox,
        isError && styles.toolIconBoxError,
        isCalled && styles.toolIconBoxDone,
      ]}>
        <Ionicons
          name={icon}
          size={10}
          color={isError ? "#f87171" : isCalled ? "#888888" : "#888888"}
        />
      </View>
      <Text
        style={[
          styles.toolLabel,
          isError && styles.toolLabelError,
          isCalled && styles.toolLabelDone,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {isCalling && <PulsingDot />}
      {isCalled && <Ionicons name="checkmark" size={10} color="#4ade80" />}
      {isError && <Ionicons name="close" size={10} color="#f87171" />}
    </View>
  );
}

function StepRow({ step }: { step: AgentPlanStep }) {
  const isRunning = step.status === "running";
  const isDone = step.status === "completed";
  const isFailed = step.status === "failed";
  const isPending = step.status === "pending";
  const tools: AgentEvent[] = (step as any).tools || [];

  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const doneToolCount = tools.filter(t => t.status === "called").length;
  const canExpand = tools.length > 0;

  return (
    <View style={styles.stepRow}>
      <TouchableOpacity
        style={styles.stepHeader}
        onPress={() => canExpand && setExpanded(!expanded)}
        activeOpacity={canExpand ? 0.65 : 1}
      >
        <View style={[
          styles.stepCheckBox,
          isDone && styles.stepCheckBoxDone,
          isFailed && styles.stepCheckBoxFailed,
          isRunning && styles.stepCheckBoxRunning,
          isPending && styles.stepCheckBoxPending,
        ]}>
          {isDone ? (
            <Ionicons name="checkmark" size={10} color="#fff" />
          ) : isFailed ? (
            <Ionicons name="close" size={10} color="#fff" />
          ) : isRunning ? (
            <PulsingDot />
          ) : null}
        </View>

        <Text
          style={[
            styles.stepTitle,
            isDone && styles.stepTitleDone,
            isFailed && styles.stepTitleFailed,
            isRunning && styles.stepTitleRunning,
            isPending && styles.stepTitlePending,
          ]}
          numberOfLines={2}
        >
          {step.description}
        </Text>

        {canExpand && (
          <View style={styles.stepRight}>
            {tools.length > 0 && (
              <Text style={styles.stepCounter}>{doneToolCount}/{tools.length}</Text>
            )}
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={12}
              color="#606060"
            />
          </View>
        )}
      </TouchableOpacity>

      {expanded && tools.length > 0 && (
        <View style={styles.toolsList}>
          {tools.map((tool, i) => (
            <ToolRow key={(tool as any).tool_call_id || i} event={tool} />
          ))}
        </View>
      )}
    </View>
  );
}

export function AgentPlanView({ plan, notifyMessages }: AgentPlanViewProps) {
  const steps = plan.steps || [];

  // Only show steps that are active (running, completed, failed).
  // Hide future pending steps — they'll appear progressively as the agent works.
  const visibleSteps = steps.filter(
    (s) => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  return (
    <View style={styles.container}>
      {visibleSteps.map((step, index) => (
        <StepRow key={step.id || index} step={step} />
      ))}
      {notifyMessages && notifyMessages.length > 0 && (
        <View style={styles.notifyBlock}>
          {notifyMessages.map((msg, i) => (
            <View key={i} style={styles.notifyRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={12} color="#888888" style={styles.notifyIcon} />
              <Text style={styles.notifyText}>{msg}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
    paddingVertical: 2,
  },
  stepRow: {
    gap: 0,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  stepCheckBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  stepCheckBoxDone: {
    backgroundColor: "#16a34a",
  },
  stepCheckBoxFailed: {
    backgroundColor: "#dc2626",
  },
  stepCheckBoxRunning: {
    borderWidth: 1.5,
    borderColor: "#3b82f6",
    backgroundColor: "transparent",
  },
  stepCheckBoxPending: {
    borderWidth: 1.5,
    borderColor: "#3a3a3a",
    backgroundColor: "transparent",
  },
  stepTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.1,
    color: "#a0a0a0",
  },
  stepTitleDone: {
    color: "#888888",
    fontFamily: "Inter_400Regular",
  },
  stepTitleFailed: {
    color: "#f87171",
  },
  stepTitleRunning: {
    color: "#e0e0e0",
    fontFamily: "Inter_600SemiBold",
  },
  stepTitlePending: {
    color: "#888888",
  },
  stepRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 2,
    flexShrink: 0,
  },
  stepCounter: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#606060",
  },
  toolsList: {
    marginLeft: 28,
    gap: 1,
    paddingBottom: 4,
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 3,
  },
  toolIconBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolIconBoxDone: {
    backgroundColor: "#1a2a1a",
  },
  toolIconBoxError: {
    backgroundColor: "#2a1a1a",
  },
  toolLabel: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#606060",
    lineHeight: 17,
  },
  toolLabelDone: {
    color: "#3a3a3a",
  },
  toolLabelError: {
    color: "#f87171",
  },
  pulsingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#3b82f6",
    flexShrink: 0,
  },
  notifyBlock: {
    marginTop: 8,
    marginLeft: 4,
    gap: 6,
    borderLeftWidth: 2,
    borderLeftColor: "#2a2a2a",
    paddingLeft: 10,
  },
  notifyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  notifyIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  notifyText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#a0a0a0",
    lineHeight: 18,
  },
});
