import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface AgentStatusBarProps {
  status: string;
  toolName?: string;
  functionName?: string;
  isActive: boolean;
}

const TOOL_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  web_search: { label: "Searching the web", icon: "search", color: "#5AC8FA" },
  web_browse: { label: "Browsing page", icon: "globe", color: "#FF9F0A" },
  browser_navigate: { label: "Navigating browser", icon: "globe", color: "#FF9F0A" },
  browser_view: { label: "Reading page", icon: "eye", color: "#FF9F0A" },
  browser_click: { label: "Clicking element", icon: "finger-print", color: "#FF9F0A" },
  browser_type: { label: "Typing text", icon: "create", color: "#FF9F0A" },
  browser_scroll: { label: "Scrolling page", icon: "arrow-down", color: "#FF9F0A" },
  shell_exec: { label: "Running command", icon: "terminal", color: "#30D158" },
  shell_view: { label: "Viewing terminal", icon: "terminal", color: "#30D158" },
  shell_wait: { label: "Waiting for process", icon: "hourglass", color: "#30D158" },
  file_read: { label: "Reading file", icon: "document-text", color: "#FFD60A" },
  file_write: { label: "Writing file", icon: "document-text", color: "#FFD60A" },
  file_str_replace: { label: "Editing file", icon: "create", color: "#FFD60A" },
  file_find_by_name: { label: "Finding file", icon: "folder-open", color: "#FFD60A" },
  message_notify_user: { label: "Sending message", icon: "chatbubble", color: "#BF5AF2" },
  message_ask_user: { label: "Asking question", icon: "help-circle", color: "#BF5AF2" },
  mcp_call_tool: { label: "Calling MCP tool", icon: "extension-puzzle", color: "#64D2FF" },
};

function PulsingDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 500, useNativeDriver: true }),
        ]),
      ]),
    ).start();
  }, [scale, opacity]);

  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
}

export function AgentStatusBar({
  status,
  toolName,
  functionName,
  isActive,
}: AgentStatusBarProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isActive ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isActive, fadeAnim]);

  const toolInfo = functionName ? TOOL_LABELS[functionName] : null;
  const color = toolInfo?.color || "#6C5CE7";
  const icon = (toolInfo?.icon || "sync") as keyof typeof Ionicons.glyphMap;
  const label = toolInfo?.label || status || "Agent is working";

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]} pointerEvents="none">
      <View style={[styles.bar, { borderColor: `${color}25` }]}>
        <PulsingDot color={color} />
        <Ionicons name={icon} size={12} color={color} />
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {label}
          {functionName && toolInfo?.label !== label ? `: ${toolName || functionName}` : ""}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(108, 92, 231, 0.06)",
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    fontStyle: "italic",
  },
});
