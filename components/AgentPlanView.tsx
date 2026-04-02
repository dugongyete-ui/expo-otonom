import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import type { AgentPlan, AgentPlanStep, AgentEvent } from "@/lib/chat";

interface AgentPlanViewProps {
  plan: AgentPlan;
  notifyMessages?: string[];
}

const toolIconMap: Record<string, string> = {
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

function getToolInfo(event: AgentEvent): { label: string; icon: string; argPreview: string } {
  const fnName = event.function_name || "";
  const args = (event as any).function_args || (event as any).input || {};
  const label = toolLabelMap[fnName] || fnName;
  const icon = toolIconMap[fnName] || "settings-outline";

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
    return { label, icon, argPreview: preview };
  }

  return { label, icon, argPreview: "" };
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
  const [expanded, setExpanded] = useState(false);
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const isError = event.status === "error";
  const { label, icon, argPreview } = getToolInfo(event);

  const output: string = (event as any).output || "";
  const errorMsg: string = (event as any).error || "";
  const hasResult = isCalled && (output || errorMsg);
  const hasError = isError && errorMsg;

  const displayResult = (hasResult ? output : errorMsg) || "";
  const truncated = displayResult.length > 300 ? displayResult.slice(0, 300) + "…" : displayResult;

  return (
    <View style={styles.toolRowWrap}>
      <TouchableOpacity
        style={styles.toolRow}
        onPress={() => (hasResult || hasError) && setExpanded(!expanded)}
        activeOpacity={(hasResult || hasError) ? 0.65 : 1}
      >
        <View style={[
          styles.toolIconBox,
          isError && styles.toolIconBoxError,
        ]}>
          <NativeIcon
            name={icon}
            size={10}
            color={isError ? "#f87171" : "#888888"}
          />
        </View>
        <View style={styles.toolLabelWrap}>
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
          {argPreview ? (
            <Text style={styles.toolArgPreview} numberOfLines={1}>{argPreview}</Text>
          ) : null}
        </View>
        {isCalling && <PulsingDot />}
        {isCalled && (
          <View style={styles.toolStatusRight}>
            <NativeIcon name="checkmark" size={10} color="#555555" />
            {hasResult && (
              <NativeIcon
                name={expanded ? "chevron-up" : "chevron-down"}
                size={10}
                color="#444444"
              />
            )}
          </View>
        )}
        {isError && <NativeIcon name="close" size={10} color="#f87171" />}
      </TouchableOpacity>

      {expanded && truncated ? (
        <View style={styles.toolResultBox}>
          <Text style={[styles.toolResultText, isError && styles.toolResultTextError]}>
            {truncated}
          </Text>
        </View>
      ) : null}
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
            <NativeIcon name="checkmark" size={10} color="#888888" />
          ) : isFailed ? (
            <NativeIcon name="close" size={10} color="#f87171" />
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
            <NativeIcon
              name={expanded ? "chevron-up" : "chevron-down"}
              size={12}
              color="#555555"
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
              <NativeIcon name="chatbubble-ellipses" size={12} color="#888888" />
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
    backgroundColor: "#2c2c2c",
    borderWidth: 1.5,
    borderColor: "#3a3a3a",
  },
  stepCheckBoxFailed: {
    backgroundColor: "#2a1a1a",
    borderWidth: 1.5,
    borderColor: "#5a2020",
  },
  stepCheckBoxRunning: {
    borderWidth: 1.5,
    borderColor: "#555555",
    backgroundColor: "transparent",
  },
  stepCheckBoxPending: {
    borderWidth: 1.5,
    borderColor: "#2e2e2e",
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
    color: "#686868",
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
    color: "#505050",
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
    color: "#555555",
  },
  toolsList: {
    marginLeft: 28,
    gap: 0,
    paddingBottom: 4,
  },
  toolRowWrap: {
    gap: 0,
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 4,
  },
  toolIconBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: "#242424",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolIconBoxError: {
    backgroundColor: "#2a1a1a",
  },
  toolLabelWrap: {
    flex: 1,
    gap: 1,
  },
  toolLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#707070",
    lineHeight: 17,
  },
  toolLabelDone: {
    color: "#505050",
  },
  toolLabelError: {
    color: "#f87171",
  },
  toolArgPreview: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#505050",
    lineHeight: 15,
  },
  toolStatusRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  toolResultBox: {
    marginLeft: 23,
    marginTop: 2,
    marginBottom: 4,
    backgroundColor: "#1e1e1e",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    padding: 8,
  },
  toolResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#707070",
    lineHeight: 16,
  },
  toolResultTextError: {
    color: "#f87171",
  },
  pulsingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#666666",
    flexShrink: 0,
  },
  notifyBlock: {
    marginTop: 8,
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
    color: "#a0a0a0",
    lineHeight: 18,
  },
});
