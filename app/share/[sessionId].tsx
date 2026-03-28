/**
 * Public share page for agent sessions
 * Anyone with the link can view the session events
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl } from "@/lib/api-service";

interface SessionEvent {
  type: string;
  content?: string;
  message?: string;
  timestamp?: string;
  session_id?: string;
}

export default function SharePage() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/sessions/${sessionId}/events`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Session not found or not public`);
      }
      const data = await res.json();
      setEvents(data.events || []);
      setIsDone(data.done || false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchEvents();

    if (!isDone) {
      pollingRef.current = setInterval(fetchEvents, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchEvents]);

  useEffect(() => {
    if (isDone && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [isDone]);

  const renderEvent = ({ item, index }: { item: SessionEvent; index: number }) => {
    const text = item.content || item.message || JSON.stringify(item);
    const isUser = item.type === "user_message" || item.type === "user";
    const isAssistant = item.type === "message" || item.type === "assistant";
    const isTool = item.type === "tool_call" || item.type === "tool_result";

    return (
      <View style={[
        styles.eventItem,
        isUser && styles.eventUser,
        isAssistant && styles.eventAssistant,
        isTool && styles.eventTool,
      ]}>
        <View style={styles.eventHeader}>
          <Ionicons
            name={isUser ? "person" : isAssistant ? "sparkles" : "construct-outline"}
            size={12}
            color={isUser ? "#6C5CE7" : isAssistant ? "#30D158" : "#8E8E93"}
          />
          <Text style={styles.eventType}>{item.type}</Text>
          {item.timestamp && (
            <Text style={styles.eventTime}>
              {new Date(item.timestamp).toLocaleTimeString()}
            </Text>
          )}
        </View>
        {text && text !== "{}" && (
          <Text style={styles.eventContent} numberOfLines={5}>{text}</Text>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C5CE7" />
        <Text style={styles.loadingText}>Loading session...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={48} color="#636366" />
        <Text style={styles.errorTitle}>Session Not Available</Text>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={20} color="#6C5CE7" />
          <Text style={styles.headerTitle}>Shared Session</Text>
        </View>
        <View style={styles.headerRight}>
          {!isDone ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>Live</Text>
            </View>
          ) : (
            <View style={styles.doneBadge}>
              <Text style={styles.doneBadgeText}>Completed</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.sessionInfo}>
        <Text style={styles.sessionInfoText}>
          Session: {sessionId?.slice(-12)}
        </Text>
        <Text style={styles.sessionInfoText}>
          {events.length} events
        </Text>
      </View>

      {events.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="hourglass-outline" size={32} color="#636366" />
          <Text style={styles.emptyText}>No events yet</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={renderEvent}
          keyExtractor={(_, index) => `event-${index}`}
          contentContainerStyle={styles.eventsList}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0C",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#0A0A0C",
  },
  loadingText: {
    color: "#8E8E93",
    fontSize: 14,
    marginTop: 8,
  },
  errorTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 8,
  },
  errorText: {
    color: "#8E8E93",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2C2C30",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(48,209,88,0.15)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#30D158",
  },
  liveBadgeText: {
    color: "#30D158",
    fontSize: 11,
    fontWeight: "600",
  },
  doneBadge: {
    backgroundColor: "rgba(108,92,231,0.15)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  doneBadgeText: {
    color: "#6C5CE7",
    fontSize: 11,
    fontWeight: "600",
  },
  sessionInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#111114",
  },
  sessionInfoText: {
    color: "#636366",
    fontSize: 11,
    fontFamily: "monospace",
  },
  eventsList: {
    padding: 12,
    gap: 8,
  },
  eventItem: {
    backgroundColor: "#1A1A20",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2C2C30",
    marginBottom: 8,
    gap: 6,
  },
  eventUser: {
    borderColor: "rgba(108,92,231,0.3)",
    backgroundColor: "rgba(108,92,231,0.05)",
  },
  eventAssistant: {
    borderColor: "rgba(48,209,88,0.2)",
    backgroundColor: "rgba(48,209,88,0.03)",
  },
  eventTool: {
    borderColor: "#2C2C30",
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  eventType: {
    color: "#636366",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
  },
  eventTime: {
    color: "#3A3A40",
    fontSize: 10,
  },
  eventContent: {
    color: "#AEAEB2",
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    color: "#8E8E93",
    fontSize: 14,
  },
});
