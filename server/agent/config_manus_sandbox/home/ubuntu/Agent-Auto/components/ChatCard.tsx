import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ChatCardProps {
  type: "user" | "assistant" | "tool" | "step";
  content: string;
  timestamp?: Date;
  toolName?: string;
  toolIcon?: string;
  toolArgs?: Record<string, any>;
  isLoading?: boolean;
  onToolClick?: () => void;
}

export function ChatCard({
  type,
  content,
  timestamp,
  toolName,
  toolIcon,
  toolArgs,
  isLoading,
  onToolClick,
}: ChatCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formatTime = (date?: Date) => {
    if (!date) return "";
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  if (type === "user") {
    return (
      <View style={styles.userMessageContainer}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{content}</Text>
        </View>
        {timestamp && (
          <Text style={styles.timestamp}>{formatTime(timestamp)}</Text>
        )}
      </View>
    );
  }

  if (type === "assistant") {
    return (
      <View style={styles.assistantMessageContainer}>
        <View style={styles.assistantHeader}>
          <View style={styles.assistantIcon}>
            <Ionicons name="sparkles" size={20} color="#6C5CE7" />
          </View>
          <Text style={styles.assistantLabel}>Dzeck AI</Text>
        </View>
        <View style={styles.assistantBubble}>
          <Text style={styles.assistantText}>{content}</Text>
        </View>
        {timestamp && (
          <Text style={styles.timestamp}>{formatTime(timestamp)}</Text>
        )}
      </View>
    );
  }

  if (type === "tool") {
    const getToolColor = (name?: string) => {
      const map: Record<string, string> = {
        shell_exec: "#34C759",
        file_read: "#FFD60A",
        browser_navigate: "#FF9F0A",
        web_search: "#5AC8FA",
        mcp_call_tool: "#64D2FF",
      };
      return map[name || ""] || "#8E8E93";
    };

    const getToolIcon = (name?: string) => {
      const map: Record<string, any> = {
        shell_exec: "terminal-outline",
        file_read: "document-text-outline",
        browser_navigate: "globe-outline",
        web_search: "search-outline",
        mcp_call_tool: "extension-puzzle-outline",
      };
      return map[name || ""] || "construct-outline";
    };

    const color = getToolColor(toolName);
    const icon = getToolIcon(toolName);

    return (
      <View style={styles.toolCardContainer}>
        <TouchableOpacity
          style={[styles.toolCard, { borderLeftColor: color }]}
          onPress={onToolClick}
          activeOpacity={0.7}
        >
          <View style={styles.toolHeader}>
            <View style={[styles.toolIconBg, { backgroundColor: color + "20" }]}>
              <Ionicons name={icon as any} size={16} color={color} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolName}>{toolName}</Text>
              {toolArgs && Object.keys(toolArgs).length > 0 && (
                <Text style={styles.toolArgs} numberOfLines={1}>
                  {Object.entries(toolArgs)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`)
                    .join(" • ")}
                </Text>
              )}
            </View>
          </View>
          {isLoading && (
            <View style={styles.toolLoading}>
              <View style={styles.spinner} />
              <Text style={styles.loadingText}>Processing...</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (type === "step") {
    return (
      <View style={styles.stepContainer}>
        <TouchableOpacity
          style={styles.stepHeader}
          onPress={() => setIsExpanded(!isExpanded)}
          activeOpacity={0.7}
        >
          <View style={styles.stepStatus}>
            {isLoading ? (
              <View style={styles.spinner} />
            ) : (
              <View style={styles.stepCheckmark}>
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              </View>
            )}
          </View>
          <Text style={styles.stepText}>{content}</Text>
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color="#8E8E93"
          />
        </TouchableOpacity>
        {isExpanded && (
          <View style={styles.stepContent}>
            <Text style={styles.stepDetails}>
              {isLoading ? "Processing..." : "Completed"}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  userMessageContainer: {
    alignItems: "flex-end",
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  userBubble: {
    backgroundColor: "#6C5CE7",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: "85%",
  },
  userText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
  },
  assistantMessageContainer: {
    alignItems: "flex-start",
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  assistantHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  assistantIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  assistantLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  assistantBubble: {
    backgroundColor: "#1A1A20",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2C2C30",
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: "85%",
  },
  assistantText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
  },
  timestamp: {
    color: "#8E8E93",
    fontSize: 12,
    marginTop: 4,
  },
  toolCardContainer: {
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  toolCard: {
    backgroundColor: "#1A1A20",
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  toolHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  toolIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  toolInfo: {
    flex: 1,
  },
  toolName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  toolArgs: {
    color: "#8E8E93",
    fontSize: 11,
    marginTop: 2,
  },
  toolLoading: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  spinner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#6C5CE7",
    borderTopColor: "transparent",
    marginRight: 6,
  },
  loadingText: {
    color: "#8E8E93",
    fontSize: 12,
  },
  stepContainer: {
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A20",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  stepStatus: {
    width: 20,
    height: 20,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepCheckmark: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#34C759",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
  },
  stepContent: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#1A1A20",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  stepDetails: {
    color: "#8E8E93",
    fontSize: 12,
  },
});
