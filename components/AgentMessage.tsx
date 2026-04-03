import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Image } from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import { MarkdownText } from "@/components/MarkdownText";
import type { AgentEvent } from "@/lib/chat";
import { cleanAgentText } from "@/lib/text-utils";

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
            <Text style={styles.agentVersion}>Lite</Text>
          </View>
          <View style={styles.messageBubble}>
            <MarkdownText text={cleanAgentText(event.message || "")} color="#f3f4f6" fontSize={15} />
            {event.isStreaming ? <StreamingCursor /> : null}
          </View>
        </View>
      );

    case "title":
      return (
        <View style={styles.container}>
          <View style={styles.titleRow}>
            <NativeIcon name="flash" size={15} color="#555555" />
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
            <Text style={styles.agentVersion}>menunggu</Text>
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
            <NativeIcon name="alert-circle" size={14} color="#888888" />
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
  agentVersion: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#555555",
    letterSpacing: 0.1,
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
    color: "#666666",
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
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#888888",
    lineHeight: 18,
  },
});
