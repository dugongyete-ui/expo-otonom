import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";

interface AgentStatusBarProps {
  status: string;
  toolName?: string;
  functionName?: string;
  isActive: boolean;
}

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  web_search: { label: "Searching the web", icon: "search" },
  web_browse: { label: "Browsing page", icon: "globe" },
  browser_navigate: { label: "Navigating browser", icon: "globe" },
  browser_view: { label: "Reading page", icon: "eye" },
  browser_click: { label: "Clicking element", icon: "finger-print" },
  browser_type: { label: "Typing text", icon: "create" },
  browser_scroll: { label: "Scrolling page", icon: "arrow-down" },
  shell_exec: { label: "Running command", icon: "terminal" },
  shell_view: { label: "Viewing terminal", icon: "terminal" },
  shell_wait: { label: "Waiting for process", icon: "hourglass" },
  file_read: { label: "Reading file", icon: "document-text" },
  file_write: { label: "Writing file", icon: "document-text" },
  file_str_replace: { label: "Editing file", icon: "create" },
  file_find_by_name: { label: "Finding file", icon: "folder-open" },
  message_notify_user: { label: "Sending message", icon: "chatbubble" },
  message_ask_user: { label: "Asking question", icon: "help-circle" },
  mcp_call_tool: { label: "Calling MCP tool", icon: "extension-puzzle" },
};

const NEUTRAL = "#888888";

function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.4, duration: 500, useNativeDriver: true }),
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
        backgroundColor: NEUTRAL,
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
  const icon = toolInfo?.icon || "sync";
  const label = toolInfo?.label || status || "Agent is working";

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]} pointerEvents="none">
      <View style={styles.bar}>
        <PulsingDot />
        <NativeIcon name={icon} size={12} color={NEUTRAL} />
        <Text style={styles.label} numberOfLines={1}>
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
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#333333",
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    fontStyle: "italic",
    color: NEUTRAL,
  },
});
