import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { HelpIcon, AlertCircleIcon, CheckIcon, CopyOutlineIcon } from "@/components/icons/SvgIcon";
import { CodeBlock } from "@/components/CodeBlock";
import type { ChatMessage as ChatMessageType, AgentPlanStep, ToolContent, AgentEvent } from "@/lib/chat";
import { COLORS } from "@/lib/theme";
import { cleanText } from "@/lib/text-utils";
import { getToolCategory, getToolDisplayInfo, getToolPrimaryArg, TOOL_FUNCTION_MAP } from "@/lib/tool-constants";

interface ChatMessageProps {
  message: ChatMessageType;
}

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

function parseContent(text: string): Segment[] {
  text = cleanText(text);
  const segments: Segment[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: "code",
      content: match[2].trim(),
      language: match[1] || "code",
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}

function FormattedText({ text, isUser }: { text: string; isUser: boolean }) {
  const textColor = isUser ? COLORS.textUser : COLORS.textAi;

  const parts = useMemo(() => {
    const result: React.ReactNode[] = [];
    const lines = text.split("\n");

    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        result.push(<Text key={`br-${lineIndex}`}>{"\n"}</Text>);
      }

      const headingMatch = line.match(/^(#{1,3})\s*(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const sizes = [22, 19, 17];
        result.push(
          <Text
            key={`h-${lineIndex}`}
            style={{
              fontSize: sizes[level - 1],
              fontFamily: "Inter_700Bold",
              color: textColor,
              lineHeight: sizes[level - 1] * 1.4,
            }}
          >
            {renderInline(headingMatch[2], textColor)}
          </Text>,
        );
        return;
      }

      const listMatch = line.match(/^[\s]*[-*+]\s+(.+)/);
      if (listMatch) {
        result.push(
          <Text key={`li-${lineIndex}`} style={{ color: textColor }}>
            {"  \u2022  "}
            {renderInline(listMatch[1], textColor)}
          </Text>,
        );
        return;
      }

      const numListMatch = line.match(/^[\s]*(\d+)\.\s+(.+)/);
      if (numListMatch) {
        result.push(
          <Text key={`nli-${lineIndex}`} style={{ color: textColor }}>
            {`  ${numListMatch[1]}.  `}
            {renderInline(numListMatch[2], textColor)}
          </Text>,
        );
        return;
      }

      result.push(
        <Text key={`t-${lineIndex}`}>
          {renderInline(line, textColor)}
        </Text>,
      );
    });

    return result;
  }, [text, textColor]);

  return (
    <Text
      style={[styles.messageText, { color: textColor }]}
      selectable
    >
      {parts}
    </Text>
  );
}

function renderInline(text: string, color: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\*(.+?)\*)/g;
  let lastIdx = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(
        <Text key={`plain-${key++}`} style={{ color }}>
          {text.slice(lastIdx, match.index)}
        </Text>,
      );
    }

    if (match[2]) {
      nodes.push(
        <Text
          key={`bolditalic-${key++}`}
          style={{ fontFamily: "Inter_700Bold", fontStyle: "italic", color }}
        >
          {match[2]}
        </Text>,
      );
    } else if (match[4]) {
      nodes.push(
        <Text
          key={`bold-${key++}`}
          style={{ fontFamily: "Inter_700Bold", color }}
        >
          {match[4]}
        </Text>,
      );
    } else if (match[6]) {
      nodes.push(
        <Text
          key={`icode-${key++}`}
          style={{
            fontFamily: "monospace",
            backgroundColor: "#F0EEE6",
            color: "#374151",
            fontSize: 12,
            paddingHorizontal: 5,
            borderRadius: 4,
          }}
        >
          {` ${match[6]} `}
        </Text>,
      );
    } else if (match[8]) {
      nodes.push(
        <Text
          key={`italic-${key++}`}
          style={{ fontStyle: "italic", color }}
        >
          {match[8]}
        </Text>,
      );
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    nodes.push(
      <Text key={`end-${key}`} style={{ color }}>
        {text.slice(lastIdx)}
      </Text>,
    );
  }

  return nodes;
}

// ─── Tool category icon helper ────────────────────────────────────────────────

const TOOL_CATEGORY_ICONS: Record<string, string> = {
  shell: "terminal-outline",
  file: "document-text-outline",
  browser: "globe-outline",
  desktop: "desktop-outline",
  search: "search-outline",
  mcp: "extension-puzzle-outline",
  message: "chatbubble-outline",
  todo: "checkmark-circle-outline",
  task: "list-outline",
  info: "information-circle-outline",
  email: "mail-outline",
  image: "image-outline",
};

// ─── Tool card message (ai-manus "ToolUse" style) ────────────────────────────

type IonIconName = React.ComponentProps<typeof Ionicons>["name"];

function ToolMessageCard({
  toolContent,
  functionName,
  functionArgs,
  onPress,
}: {
  toolContent?: ToolContent | null;
  functionName?: string;
  functionArgs?: Record<string, unknown>;
  onPress?: () => void;
}) {
  const name = functionName || toolContent?.type || "tool";
  const displayInfo = getToolDisplayInfo(name);
  const icon: IonIconName = displayInfo.icon as IonIconName;
  const actionLabel = TOOL_FUNCTION_MAP[name] || displayInfo.label || name;
  const args: Record<string, unknown> = functionArgs || (toolContent as any)?.input || {};
  const argVal = getToolPrimaryArg(name, args);

  return (
    <TouchableOpacity
      style={toolCardStyles.pill}
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
    >
      <View style={toolCardStyles.pillIconWrap}>
        <Ionicons name={icon} size={14} color="#374151" />
      </View>
      <View style={toolCardStyles.pillTextWrap}>
        <Text style={toolCardStyles.pillAction} numberOfLines={1}>
          {actionLabel}
          {argVal ? (
            <Text style={toolCardStyles.pillArg}>{" "}{argVal}</Text>
          ) : null}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const toolCardStyles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
    backgroundColor: "#F0EEE6",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2DFD8",
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: "100%",
  },
  pillIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: "#E8E6DF",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pillTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  pillAction: {
    fontFamily: "Inter_500Medium",
    fontSize: 12.5,
    color: "#374151",
    lineHeight: 18,
  },
  pillArg: {
    fontFamily: "monospace",
    fontSize: 10.5,
    color: "#8B8985",
    maxWidth: "100%",
  },
});

// ─── Step message (ai-manus "step" style: dashed border + expandable) ─────────

interface StepTool {
  tool_call_id?: string;
  name?: string;
  function_name?: string;
  status?: string;
  tool_content?: ToolContent;
  function_args?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

function StepMessage({
  step,
  onToolPress,
}: {
  step: AgentPlanStep;
  onToolPress?: (tool: StepTool) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDone = step.status === "completed";
  const isRunning = step.status === "running";
  const isFailed = step.status === "failed";
  const tools: StepTool[] = (step.tools as unknown as StepTool[]) || [];
  const hasTool = tools.length > 0;

  return (
    <View style={stepMsgStyles.container}>
      <View style={stepMsgStyles.row}>
        <View style={stepMsgStyles.leftCol}>
          <TouchableOpacity
            style={[
              stepMsgStyles.statusCircle,
              isDone && stepMsgStyles.statusCircleDone,
              isRunning && stepMsgStyles.statusCircleRunning,
              isFailed && stepMsgStyles.statusCircleFailed,
            ]}
            onPress={hasTool ? () => setExpanded(e => !e) : undefined}
            activeOpacity={hasTool ? 0.7 : 1}
          >
            {isDone && <Ionicons name="checkmark" size={8} color="rgba(255,255,255,0.6)" />}
            {isFailed && <Text style={stepMsgStyles.xChar}>✕</Text>}
          </TouchableOpacity>
          {hasTool && expanded && (
            <View style={stepMsgStyles.dashedLine} />
          )}
        </View>
        <View style={stepMsgStyles.rightCol}>
          <TouchableOpacity
            style={stepMsgStyles.headerRow}
            onPress={hasTool ? () => setExpanded(e => !e) : undefined}
            activeOpacity={hasTool ? 0.7 : 1}
          >
            <Text style={[
              stepMsgStyles.desc,
              isDone && stepMsgStyles.descDone,
              isRunning && stepMsgStyles.descRunning,
              isFailed && stepMsgStyles.descFailed,
            ]} numberOfLines={3}>
              {step.description}
            </Text>
            {hasTool && (
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={13}
                color="#555555"
                style={stepMsgStyles.chevron}
              />
            )}
          </TouchableOpacity>

          {expanded && hasTool && (
            <View style={stepMsgStyles.toolsList}>
              {tools.map((tool, i) => (
                <ToolMessageCard
                  key={tool.tool_call_id || i}
                  functionName={tool.function_name || tool.name}
                  toolContent={tool.tool_content}
                  functionArgs={tool.function_args || tool.input}
                  onPress={onToolPress ? () => onToolPress(tool) : undefined}
                />
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const stepMsgStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 3,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  leftCol: {
    alignItems: "center",
    width: 16,
    flexShrink: 0,
    paddingTop: 1,
  },
  statusCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D1CFC8",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusCircleDone: {
    backgroundColor: "#F5F4EF",
    borderColor: "#B5B3AC",
  },
  statusCircleRunning: {
    borderColor: "#3B82F6",
    backgroundColor: "rgba(59,130,246,0.08)",
  },
  statusCircleFailed: {
    borderColor: "#EF4444",
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  xChar: {
    fontSize: 8,
    color: "#EF4444",
    fontWeight: "700",
    lineHeight: 10,
  },
  dashedLine: {
    width: 1,
    flex: 1,
    minHeight: 8,
    backgroundColor: "transparent",
    borderLeftWidth: 1,
    borderLeftColor: "#D1CFC8",
    borderStyle: "dashed",
    marginTop: 4,
  },
  rightCol: {
    flex: 1,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  desc: {
    flex: 1,
    fontSize: 13,
    color: "#374151",
    fontWeight: "500",
    lineHeight: 19,
  },
  descDone: {
    color: "#9CA3AF",
  },
  descRunning: {
    color: "#1A1A1A",
  },
  descFailed: {
    color: "#EF4444",
  },
  chevron: {
    marginTop: 3,
    flexShrink: 0,
  },
  toolsList: {
    marginTop: 6,
    gap: 3,
    paddingBottom: 4,
  },
});

export { ChatMessageBubble as ChatMessage, StepMessage, ToolMessageCard };

type OnToolPressHandler = (tool: StepTool) => void;

export function ChatMessageBubble({ message, onToolPress }: ChatMessageProps & { onToolPress?: OnToolPressHandler }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const isAsk = message.role === "ask";
  const segments = useMemo(() => parseContent(message.content), [message.content]);

  // Render step message (expandable section with dashed left border)
  if (message.step) {
    return <StepMessage step={message.step} onToolPress={onToolPress} />;
  }

  // Render tool card message
  if (message.toolContent) {
    const ev = message.agentEvent as AgentEvent | undefined;
    const fnName = ev?.function_name || ev?.tool_name;
    const fnArgs = (ev as any)?.function_args || (ev as any)?.input || {};
    const toolAsTool: StepTool = {
      tool_call_id: ev?.tool_call_id,
      name: ev?.tool_name,
      function_name: ev?.function_name,
      tool_content: message.toolContent,
      function_args: fnArgs,
    };
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
        <ToolMessageCard
          toolContent={message.toolContent}
          functionName={fnName}
          functionArgs={fnArgs}
          onPress={onToolPress ? () => onToolPress(toolAsTool) : undefined}
        />
      </View>
    );
  }

  const handleCopy = async () => {
    await Clipboard.setStringAsync(message.content);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[styles.container, isUser && styles.containerUser]}>
      {!isUser && (
        <View style={styles.avatarContainer}>
          {isAsk ? (
            <View style={[styles.avatar, styles.avatarAsk]}>
              <HelpIcon size={14} color="#FFFFFF" />
            </View>
          ) : (
            <Image
              source={require("../assets/images/dzeck-logo.jpg")}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          )}
        </View>
      )}
      <View style={[styles.bubbleWrapper, isUser && styles.bubbleWrapperUser]}>
        {!isUser && !isAsk && (
          <Text style={styles.senderName}>Dzeck</Text>
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : isAsk ? styles.askBubble : styles.aiBubble]}>
          {message.attachments?.map((att, i) => (
            <Image
              key={i}
              source={{ uri: att.uri }}
              style={styles.attachmentImage}
              resizeMode="cover"
            />
          ))}

          {segments.map((segment, i) =>
            segment.type === "code" ? (
              <CodeBlock key={i} code={segment.content} language={segment.language} />
            ) : (
              <FormattedText key={i} text={segment.content} isUser={isUser} />
            ),
          )}

          {isAsk && (
            <View style={styles.askBadge}>
              <Text style={styles.askBadgeText}>{"⏳ Menunggu balasan Anda..."}</Text>
            </View>
          )}

          {message.error && (
            <View style={styles.errorContainer}>
              <AlertCircleIcon size={14} color={COLORS.errorText} />
              <Text style={styles.errorText}>{message.error}</Text>
            </View>
          )}
        </View>

        {!isUser && message.content.length > 0 && !message.isStreaming && (
          <TouchableOpacity
            onPress={handleCopy}
            style={styles.actionButton}
            activeOpacity={0.6}
          >
            {copied
              ? <CheckIcon size={14} color="#888888" />
              : <CopyOutlineIcon size={14} color={COLORS.iconMuted} />
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
  },
  containerUser: {
    justifyContent: "flex-end",
  },
  avatarContainer: {
    paddingTop: 2,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: COLORS.avatarAi,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 22,
    height: 22,
    borderRadius: 6,
    overflow: "hidden",
  },
  avatarAsk: {
    backgroundColor: COLORS.avatarAsk,
  },
  senderName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9CA3AF",
    marginBottom: 4,
    marginLeft: 2,
  },
  bubbleWrapper: {
    maxWidth: "85%",
    alignItems: "flex-start",
  },
  bubbleWrapperUser: {
    alignItems: "flex-end",
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    backgroundColor: "#1A1A1A",
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  askBubble: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E3DC",
    paddingHorizontal: 14,
  },
  askBadge: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#F5F4EF",
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  askBadgeText: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 20,
  },
  messageText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
  },
  attachmentImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: COLORS.errorText,
  },
  actionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
  },
});
