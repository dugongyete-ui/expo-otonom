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
import { CodeBlock } from "@/components/CodeBlock";
import type { ChatMessage as ChatMessageType } from "@/lib/chat";

interface ChatMessageProps {
  message: ChatMessageType;
}

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

function parseContent(text: string): Segment[] {
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
  const textColor = isUser ? "#FFFFFF" : "#E8E8ED";

  const parts = useMemo(() => {
    const result: React.ReactNode[] = [];
    const lines = text.split("\n");

    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        result.push(<Text key={`br-${lineIndex}`}>{"\n"}</Text>);
      }

      // Handle headings
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
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

      // Handle list items
      const listMatch = line.match(/^[\s]*[-*]\s+(.+)/);
      if (listMatch) {
        result.push(
          <Text key={`li-${lineIndex}`} style={{ color: textColor }}>
            {"  \u2022  "}
            {renderInline(listMatch[1], textColor)}
          </Text>,
        );
        return;
      }

      // Handle numbered lists
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

      // Regular text
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
  // Match bold, inline code, italic
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\*(.+?)\*)/g;
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
      // Bold
      nodes.push(
        <Text
          key={`bold-${key++}`}
          style={{ fontFamily: "Inter_700Bold", color }}
        >
          {match[2]}
        </Text>,
      );
    } else if (match[4]) {
      // Inline code
      nodes.push(
        <Text
          key={`icode-${key++}`}
          style={{
            fontFamily: "monospace",
            backgroundColor: "rgba(255,255,255,0.08)",
            color: "#D4D4DC",
            fontSize: 13,
            paddingHorizontal: 1,
          }}
        >
          {` ${match[4]} `}
        </Text>,
      );
    } else if (match[6]) {
      // Italic
      nodes.push(
        <Text
          key={`italic-${key++}`}
          style={{ fontStyle: "italic", color }}
        >
          {match[6]}
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

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const isAsk = message.role === "ask";
  const segments = useMemo(() => parseContent(message.content), [message.content]);

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
          <View style={[styles.avatar, isAsk && styles.avatarAsk]}>
            <Ionicons name={isAsk ? "help" : "sparkles"} size={14} color="#FFFFFF" />
          </View>
        </View>
      )}
      <View style={[styles.bubbleWrapper, isUser && styles.bubbleWrapperUser]}>
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
              <Ionicons name="alert-circle" size={14} color="#FF453A" />
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
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={14}
              color={copied ? "#30D158" : "#636366"}
            />
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
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarAsk: {
    backgroundColor: "#7C3AED",
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
    backgroundColor: "#2A2A30",
    borderBottomRightRadius: 6,
  },
  aiBubble: {
    backgroundColor: "transparent",
    paddingHorizontal: 0,
  },
  askBubble: {
    backgroundColor: "rgba(124,58,237,0.1)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.4)",
    paddingHorizontal: 14,
  },
  askBadge: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "rgba(124,58,237,0.15)",
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  askBadgeText: {
    fontSize: 12,
    color: "#A78BFA",
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
    color: "#FF453A",
  },
  actionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
  },
});
