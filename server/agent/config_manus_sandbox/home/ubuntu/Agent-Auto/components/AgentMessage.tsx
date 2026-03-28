import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AgentEvent } from "@/lib/chat";

interface AgentMessageProps {
  event: AgentEvent;
}

function StreamingCursor() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    ).start();
    return () => opacity.stopAnimation();
  }, [opacity]);

  return (
    <Animated.Text style={[styles.cursor, { opacity }]}>▋</Animated.Text>
  );
}

export function AgentMessage({ event }: AgentMessageProps) {
  switch (event.type) {
    case "message":
      if (!event.message && !event.isStreaming) return null;
      return (
        <View style={styles.container}>
          <View style={styles.agentHeader}>
            <View style={styles.agentIcon}>
              <Ionicons name="flash" size={12} color="#FFFFFF" />
            </View>
            <Text style={styles.agentName}>Dzeck</Text>
            <View style={[styles.agentBadge, styles.agentBadgeAgent]}>
              <Text style={[styles.agentBadgeText, styles.agentBadgeTextAgent]}>Agent</Text>
            </View>
          </View>
          <View style={styles.messageBubble}>
            <Text style={styles.messageText} selectable>
              {event.message || ""}
              {event.isStreaming ? <StreamingCursor /> : null}
            </Text>
          </View>
        </View>
      );

    case "title":
      return (
        <View style={styles.container}>
          <View style={styles.titleRow}>
            <Ionicons name="rocket" size={15} color="#6C5CE7" />
            <Text style={styles.titleText} numberOfLines={2}>
              {event.title || ""}
            </Text>
          </View>
        </View>
      );

    case "wait":
      if (!event.prompt) return null;
      return (
        <View style={styles.container}>
          <View style={styles.agentHeader}>
            <View style={styles.agentIcon}>
              <Ionicons name="help-circle" size={12} color="#FFFFFF" />
            </View>
            <Text style={styles.agentName}>dzeck</Text>
            <View style={[styles.agentBadge, styles.agentBadgeWait]}>
              <Text style={[styles.agentBadgeText, styles.agentBadgeTextWait]}>Menunggu</Text>
            </View>
          </View>
          <View style={styles.messageBubble}>
            <Text style={styles.messageText} selectable>
              {event.prompt}
            </Text>
          </View>
        </View>
      );

    case "error":
      return (
        <View style={styles.container}>
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={14} color="#FF453A" />
            <Text style={styles.errorText}>{event.error || "Terjadi kesalahan"}</Text>
          </View>
        </View>
      );

    default:
      return null;
  }
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  agentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  agentIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
    justifyContent: "center",
  },
  agentName: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#E8E8ED",
  },
  agentBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "#2C2C30",
  },
  agentBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#8E8E93",
  },
  agentBadgeAgent: {
    backgroundColor: "rgba(108,92,231,0.15)",
    borderWidth: 1,
    borderColor: "rgba(108,92,231,0.25)",
  },
  agentBadgeTextAgent: {
    color: "#7C6AE8",
  },
  agentBadgeWait: {
    backgroundColor: "rgba(191,90,242,0.15)",
    borderWidth: 1,
    borderColor: "rgba(191,90,242,0.3)",
  },
  agentBadgeTextWait: {
    color: "#BF5AF2",
  },
  messageBubble: {
    paddingLeft: 28,
  },
  messageText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#E8E8ED",
    lineHeight: 23,
    letterSpacing: -0.1,
  },
  cursor: {
    color: "#6C5CE7",
    fontSize: 14,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingLeft: 4,
  },
  titleText: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: "#FFFFFF",
    letterSpacing: -0.3,
    flex: 1,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,69,58,0.07)",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,69,58,0.12)",
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#FF6B6B",
    lineHeight: 18,
  },
});
