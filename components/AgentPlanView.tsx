import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Easing,
  Image,
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

function SpinnerIcon({ size = 16, color = "#666666" }: { size?: number; color?: string }) {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }], width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: "transparent",
        borderTopColor: color,
        borderRightColor: color + "60",
      }} />
    </Animated.View>
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
  stepNotifyTexts,
  onToolPress,
}: {
  step: AgentPlanStep;
  stepNotifyTexts?: string[];
  onToolPress?: (tool: SelectedToolInfo) => void;
}) {
  const isRunning = step.status === "running";
  const isDone    = step.status === "completed";
  const isFailed  = step.status === "failed";
  const rawTools: StepToolEntry[] = (step as AgentPlanStep & { tools?: StepToolEntry[] }).tools || [];
  const hasTools = rawTools.length > 0;

  const [toolsExpanded, setToolsExpanded] = useState(isRunning || isDone);

  useEffect(() => {
    if (isRunning) setToolsExpanded(true);
  }, [isRunning]);

  return (
    <View style={[
      styles.stepRow,
      isRunning && styles.stepRowRunning,
      isDone && styles.stepRowDone,
      isFailed && styles.stepRowFailed,
    ]}>
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
          {isDone   && <NativeIcon name="checkmark" size={10} color="#888888" />}
          {isFailed && <NativeIcon name="close"     size={10} color="#888888" />}
          {isRunning && <SpinnerIcon size={14} color="#888888" />}
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
            color="#444444"
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

      {stepNotifyTexts && stepNotifyTexts.length > 0 && (
        <View style={styles.stepNotifyBlock}>
          {stepNotifyTexts.map((msg, i) => (
            <AgentGoalMessage key={i} message={msg} />
          ))}
        </View>
      )}
    </View>
  );
}

export function AgentGoalMessage({ message }: { message: string }) {
  return (
    <View style={goalStyles.container}>
      <View style={goalStyles.iconRow}>
        <Image
          source={require("../assets/images/dzeck-logo.jpg")}
          style={goalStyles.avatarImage}
          resizeMode="cover"
        />
        <Text style={goalStyles.labelText}>Agent</Text>
      </View>
      <Text style={goalStyles.messageText}>{cleanCitations(message)}</Text>
    </View>
  );
}

export function AgentPlanView({ plan, notifyMessages, stepNotifyMessages, onToolPress }: AgentPlanViewProps) {
  const steps = plan.steps || [];
  const visibleSteps = steps.filter(
    s => s.status === "running" || s.status === "completed" || s.status === "failed"
  );

  return (
    <View style={styles.container}>
      {visibleSteps.map((step, i) => {
        const stepTexts = (stepNotifyMessages || [])
          .filter(n => n.stepId === step.id)
          .map(n => n.text);
        return (
          <StepRow
            key={step.id || i}
            step={step}
            stepNotifyTexts={stepTexts.length > 0 ? stepTexts : undefined}
            onToolPress={onToolPress}
          />
        );
      })}
      {notifyMessages && notifyMessages.length > 0 && (
        <View style={styles.notifyBlock}>
          {notifyMessages.map((msg, i) => (
            <AgentGoalMessage key={i} message={msg} />
          ))}
        </View>
      )}
    </View>
  );
}

const goalStyles = StyleSheet.create({
  container: {
    backgroundColor: "#161616",
    borderLeftWidth: 2,
    borderLeftColor: "#3a3a3a",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    marginTop: 2,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  avatarImage: {
    width: 18,
    height: 18,
    borderRadius: 5,
    overflow: "hidden",
  },
  labelText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "#888888",
    letterSpacing: 0.2,
  },
  messageText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#e8e8e8",
    lineHeight: 22,
    letterSpacing: -0.1,
  },
});

const styles = StyleSheet.create({
  container: {
    gap: 4,
    paddingVertical: 2,
  },

  stepRow: {
    gap: 0,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  stepRowRunning: {
    backgroundColor: "#111111",
    borderWidth: 0,
    borderLeftWidth: 2,
    borderLeftColor: "#3a3a3a",
  },
  stepRowDone: {
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  stepRowFailed: {
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  stepBullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#2a2a2a",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  stepBulletDone: {
    backgroundColor: "#2a2a2a",
    borderColor: "#3a3a3a",
  },
  stepBulletFailed: {
    backgroundColor: "#1e1e1e",
    borderColor: "#3a3a3a",
  },
  stepBulletRunning: {
    backgroundColor: "transparent",
    borderColor: "#555555",
    borderWidth: 1.5,
  },
  stepTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: "#555555",
    letterSpacing: -0.1,
  },
  stepTitleDone: {
    color: "#606060",
    fontFamily: "Inter_400Regular",
  },
  stepTitleFailed: {
    color: "#888888",
  },
  stepTitleRunning: {
    color: "#e8e8e8",
    fontFamily: "Inter_600SemiBold",
  },

  toolsContainer: {
    marginLeft: 0,
    gap: 2,
    paddingBottom: 6,
    paddingTop: 0,
  },

  stepNotifyBlock: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
  },

  notifyBlock: {
    marginTop: 4,
    gap: 6,
  },
  notifyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  notifyText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#e8e8e8",
    lineHeight: 22,
  },
});
