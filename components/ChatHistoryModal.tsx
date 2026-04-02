import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeIcon } from "@/components/icons/SvgIcon";
import {
  loadChatSessions,
  deleteChatSession,
  clearAllSessions,
  formatRelativeTime,
  type ChatSession,
} from "@/lib/storage";
import { getApiBaseUrl, getStoredToken } from "@/lib/api-service";

interface ChatHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  onRestoreSession: (session: ChatSession) => void;
}

function SessionItem({
  session,
  onRestore,
  onDelete,
}: {
  session: ChatSession;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.sessionItem}
      onPress={onRestore}
      activeOpacity={0.7}
    >
      <View style={styles.sessionIcon}>
        <NativeIcon
          name={session.mode === "agent" ? "flash" : "chatbubble"}
          size={14}
          color="#636366"
        />
      </View>
      <View style={styles.sessionContent}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {session.title}
        </Text>
        {session.preview ? (
          <Text style={styles.sessionPreview} numberOfLines={2}>
            {session.preview}
          </Text>
        ) : null}
        <View style={styles.sessionMeta}>
          <View
            style={[
              styles.modeBadge,
              session.mode === "agent" && styles.modeBadgeAgent,
            ]}
          >
            <Text
              style={[
                styles.modeBadgeText,
                session.mode === "agent" && styles.modeBadgeTextAgent,
              ]}
            >
              {session.mode === "agent" ? "Agent" : "Chat"}
            </Text>
          </View>
          <Text style={styles.sessionTime}>
            {formatRelativeTime(session.timestamp)}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <NativeIcon name="trash-outline" size={16} color="#636366" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export function ChatHistoryModal({
  visible,
  onClose,
  onRestoreSession,
}: ChatHistoryModalProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const localSessions = await loadChatSessions();
      setSessions(localSessions);

      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      if (token) {
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const res = await fetch(`${baseUrl}/api/sessions`, { headers }).catch(() => null);
        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          if (data && Array.isArray(data.sessions)) {
            const serverSessions: ChatSession[] = data.sessions.map((s: any) => {
              const rawMsg: string = s.user_message || "";
              const title = rawMsg.trim()
                ? (rawMsg.length > 60 ? rawMsg.slice(0, 60) + "…" : rawMsg)
                : `Session ${s.session_id.slice(-6)}`;
              const startedAt = s.startedAt;
              const timestamp = startedAt
                ? (typeof startedAt === "number" ? startedAt : new Date(startedAt).getTime())
                : Date.now();
              return {
                id: s.session_id,
                title,
                mode: "agent" as const,
                preview: s.eventCount ? `${s.eventCount} events` : "",
                timestamp,
                messages: [],
              };
            });
            const localIds = new Set(localSessions.map((s) => s.id));
            const merged = [
              ...localSessions,
              ...serverSessions.filter((s) => !localIds.has(s.id)),
            ].sort((a, b) => b.timestamp - a.timestamp);
            setSessions(merged);
          }
        }
      }
    } catch {
      const data = await loadChatSessions();
      setSessions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadSessions();
    }
  }, [visible, loadSessions]);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert(
        "Delete conversation",
        "This conversation will be permanently deleted.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteChatSession(id);
              const baseUrl = getApiBaseUrl();
              const token = getStoredToken();
              if (token) {
                fetch(`${baseUrl}/api/sessions/${id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {});
              }
              setSessions((prev) => prev.filter((s) => s.id !== id));
            },
          },
        ],
      );
    },
    [],
  );

  const handleClearAll = useCallback(() => {
    Alert.alert(
      "Clear all history",
      "All conversations will be permanently deleted. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            await clearAllSessions();
            setSessions([]);
          },
        },
      ],
    );
  }, []);

  const handleRestore = useCallback(
    (session: ChatSession) => {
      onRestoreSession(session);
      onClose();
    },
    [onRestoreSession, onClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>History</Text>
          <View style={styles.headerActions}>
            {sessions.length > 0 && (
              <TouchableOpacity
                onPress={handleClearAll}
                style={styles.clearAllBtn}
                activeOpacity={0.7}
              >
                <NativeIcon name="trash-outline" size={16} color="#FF453A" />
                <Text style={styles.clearAllText}>Clear All</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              activeOpacity={0.7}
            >
              <NativeIcon name="close" size={22} color="#8E8E93" />
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#2563eb" />
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <NativeIcon name="time-outline" size={32} color="#636366" />
            </View>
            <Text style={styles.emptyTitle}>No History Yet</Text>
            <Text style={styles.emptySubtitle}>
              Your conversations will appear here
            </Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <SessionItem
                session={item}
                onRestore={() => handleRestore(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0A0A0C",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E24",
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: "#FFFFFF",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  clearAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255, 69, 58, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 69, 58, 0.15)",
  },
  clearAllText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#FF453A",
  },
  closeBtn: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#141418",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: "#E8E8ED",
  },
  emptySubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#636366",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  separator: {
    height: 1,
    backgroundColor: "#1E1E24",
    marginHorizontal: 4,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 12,
  },
  sessionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#141418",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#2C2C30",
    flexShrink: 0,
    marginTop: 2,
  },
  sessionContent: {
    flex: 1,
    gap: 4,
  },
  sessionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#E8E8ED",
    lineHeight: 20,
  },
  sessionPreview: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#8E8E93",
    lineHeight: 18,
  },
  sessionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  modeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(90, 200, 250, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(90, 200, 250, 0.2)",
  },
  modeBadgeAgent: {
    backgroundColor: "rgba(108, 92, 231, 0.1)",
    borderColor: "rgba(108, 92, 231, 0.2)",
  },
  modeBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#5AC8FA",
  },
  modeBadgeTextAgent: {
    color: "#2563eb",
  },
  sessionTime: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#636366",
  },
  deleteBtn: {
    padding: 8,
    marginTop: -4,
    flexShrink: 0,
  },
});
