import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import { AgentToolCard } from "@/components/AgentToolCard";
import type { AgentPlan, AgentPlanStep, AgentEvent, ToolContent } from "@/lib/chat";
import { getToolDisplayInfo } from "@/lib/tool-constants";

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

function normalizeStepTool(raw: StepToolEntry): AgentEvent {
  const fnName = raw.function_name || raw.name || "";
  const fnArgs: Record<string, unknown> = raw.function_args || raw.input || {};
  const result = raw.function_result || raw.output || (raw.status === "error" ? raw.error : undefined);
  return {
    type: "tool",
    function_name: fnName,
    function_args: fnArgs,
    tool_call_id: raw.tool_call_id,
    status: raw.status || "calling",
    function_result: result,
    tool_content: raw.tool_content,
  };
}

function StepRow({
  step,
  onToolPress,
}: {
  step: AgentPlanStep;
  onToolPress?: (tool: SelectedToolInfo) => void;
}) {
  const isRunning = step.status === "running";
  const isDone    = step.status === "completed";
  const isFailed  = step.status === "failed";
  const rawTools: StepToolEntry[] = (step as AgentPlanStep & { tools?: StepToolEntry[] }).tools || [];
  const hasTools = rawTools.length > 0;

  const [toolsExpanded, setToolsExpanded] = useState(hasTools);

  return (
    <View style={styles.stepRow}>
      <TouchableOpacity
        style={styles.stepHeader}
        onPress={() => hasTools && setToolsExpanded(prev => !prev)}
        activeOpacity={hasTools ? 0.7 : 1}
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

        {hasTools && (
          <NativeIcon
            name={toolsExpanded ? "chevron-up" : "chevron-down"}
            size={12}
            color="#555555"
          />
        )}
      </TouchableOpacity>

      {hasTools && toolsExpanded && (
        <View style={styles.toolsContainer}>
          {rawTools.map((tool, i) => {
            const normalized = normalizeStepTool(tool);
            const fnName = normalized.function_name || "";
            const displayInfo = getToolDisplayInfo(fnName);
            const handlePress = onToolPress ? () => {
              onToolPress({
                functionName: fnName,
                functionArgs: normalized.function_args || {},
                status: normalized.status || "called",
                toolContent: normalized.tool_content,
                functionResult: normalized.function_result,
                label: displayInfo.label,
                icon: displayInfo.icon,
                iconColor: displayInfo.color,
              });
            } : undefined;
            return (
              <AgentToolCard
                key={tool.tool_call_id || i}
                event={normalized}
                onHeaderPress={handlePress}
              />
            );
          })}
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

  toolsContainer: {
    marginLeft: 8,
    gap: 4,
    paddingBottom: 2,
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
