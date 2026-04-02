import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Image } from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
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
            <Image
              source={require("../assets/images/dzeck-logo.jpg")}
              style={styles.avatarImage}
              resizeMode="cover"
            />
            <Text style={styles.agentName}>Dzeck</Text>
            <View style={[styles.agentBadge, styles.agentBadgeAgent]}>
              <Text style={[styles.agentBadgeText]}>Agent</Text>
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
            <NativeIcon name="flash" size={15} color="#888888" />
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
            <Image
              source={require("../assets/images/dzeck-logo.jpg")}
              style={styles.avatarImage}
              resizeMode="cover"
            />
            <Text style={styles.agentName}>Dzeck</Text>
            <View style={[styles.agentBadge, styles.agentBadgeWait]}>
              <Text style={[styles.agentBadgeText]}>Menunggu</Text>
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
            <NativeIcon name="alert-circle" size={14} color="#dc2626" />
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
  avatarImage: {
    width: 22,
    height: 22,
    borderRadius: 6,
    overflow: "hidden",
  },
  agentName: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#f3f4f6",
  },
  agentBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  agentBadgeAgent: {},
  agentBadgeWait: {},
  agentBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#888888",
  },
  messageBubble: {
    paddingLeft: 28,
  },
  messageText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#f3f4f6",
    lineHeight: 23,
    letterSpacing: -0.1,
  },
  cursor: {
    color: "#888888",
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
    color: "#f3f4f6",
    letterSpacing: -0.3,
    flex: 1,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(220,38,38,0.06)",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.15)",
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#f07070",
    lineHeight: 18,
  },
});
