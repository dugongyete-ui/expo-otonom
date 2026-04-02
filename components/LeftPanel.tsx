import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiService, getApiBaseUrl, getStoredToken } from "@/lib/api-service";
import { t } from "@/lib/i18n";

interface Session {
  session_id: string;
  title: string;
  timestamp: number;
  preview?: string;
  is_running?: boolean;
}

interface LeftPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewSession: (sessionId: string) => void;
}

export function LeftPanel({ isOpen, onToggle, onNewSession }: LeftPanelProps) {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const headers: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
      const res = await fetch(`${baseUrl}/api/sessions`, { headers });
      if (res.ok) {
        const data = await res.json();
        const mapped: Session[] = (data.sessions || []).map((s: any) => {
          const rawMsg: string = s.user_message || "";
          const title = rawMsg.trim()
            ? (rawMsg.length > 48 ? rawMsg.slice(0, 48) + "…" : rawMsg)
            : `Session ${s.session_id.slice(-6)}`;
          return {
            session_id: s.session_id,
            title,
            timestamp: s.startedAt || Date.now(),
            preview: s.eventCount ? `${s.eventCount} events` : undefined,
            is_running: s.is_running || false,
          };
        });
        setSessions(mapped);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleNewTask = useCallback(() => {
    const newSessionId = `session_${Date.now()}`;
    onNewSession(newSessionId);
  }, [onNewSession]);

  const handleClearAllHistory = useCallback(async () => {
    setIsClearing(true);
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const deleteHeaders: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
      await Promise.all(
        sessions.map(s =>
          fetch(`${baseUrl}/api/sessions/${s.session_id}`, { method: "DELETE", headers: deleteHeaders }).catch(() => {})
        )
      );
      setSessions([]);
      setShowClearConfirm(false);
      onNewSession(`session_${Date.now()}`);
    } catch (error) {
      console.error("Failed to clear history:", error);
      Alert.alert("Error", "Failed to clear history");
    } finally {
      setIsClearing(false);
    }
  }, [sessions, onNewSession]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      onNewSession(sessionId);
    },
    [onNewSession]
  );

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const headers: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
      await fetch(`${baseUrl}/api/sessions/${sessionId}`, { method: "DELETE", headers });
    } catch {}
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }, []);

  const handleShareSession = useCallback(async (sessionId: string) => {
    try {
      const result = await apiService.shareSession(sessionId, true);
      if (result.share_url) {
        try {
          await Share.share({ message: result.share_url, url: result.share_url });
        } catch {
          Alert.alert("Share Link", result.share_url);
        }
      }
    } catch (err: any) {
      Alert.alert("Share Error", err.message || "Failed to share session");
    }
  }, []);

  const runningCount = sessions.filter(s => s.is_running).length;

  if (!isOpen) {
    return (
      <View style={styles.collapsedContainer}>
        <TouchableOpacity style={styles.toggleButton} onPress={onToggle}>
          <View>
            <Ionicons name="menu" size={20} color="#8a8780" />
            {runningCount > 0 && (
              <View style={styles.badgeSmall}>
                <Text style={styles.badgeSmallText}>{runningCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.toggleButton} onPress={onToggle}>
          <Ionicons name="chevron-back" size={20} color="#8a8780" />
        </TouchableOpacity>

        {runningCount > 0 && (
          <View style={styles.runningBadge}>
            <View style={styles.runningDot} />
            <Text style={styles.runningBadgeText}>
              {runningCount} {t("Background agent running")}
            </Text>
          </View>
        )}
      </View>

      {/* New Task Button */}
      <TouchableOpacity
        style={styles.newTaskButton}
        onPress={handleNewTask}
        activeOpacity={0.7}
      >
        <Ionicons name="add" size={18} color="#6a6762" />
        <Text style={styles.newTaskButtonText}>{t("New Task")}</Text>
        <View style={styles.shortcutKeys}>
          <Text style={styles.shortcutKey}>⌘K</Text>
        </View>
      </TouchableOpacity>

      {/* Sessions List */}
      {isLoading && sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color="#8a8780" />
        </View>
      ) : sessions.length > 0 ? (
        <ScrollView
          style={styles.sessionsList}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {sessions.map((session) => (
            <SessionItem
              key={session.session_id}
              session={session}
              onSelect={() => handleSessionSelect(session.session_id)}
              onDelete={() => handleDeleteSession(session.session_id)}
              onShare={() => handleShareSession(session.session_id)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons
            name="chatbubble-outline"
            size={40}
            color="#8a8780"
          />
          <Text style={styles.emptyStateText}>{t("Create a task to get started")}</Text>
        </View>
      )}

      {/* Clear History Button */}
      {sessions.length > 0 && (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={() => setShowClearConfirm(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={16} color="#8a8780" />
          <Text style={styles.clearButtonText}>{t("Clear All History")}</Text>
        </TouchableOpacity>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearConfirm && (
        <View style={styles.confirmDialog}>
          <View style={styles.confirmDialogContent}>
            <View style={styles.confirmDialogIcon}>
              <Ionicons name="trash" size={24} color="#dc2626" />
            </View>
            <Text style={styles.confirmDialogTitle}>{t("Clear All History")}</Text>
            <Text style={styles.confirmDialogMessage}>
              This will permanently delete all chat sessions. This action cannot be undone.
            </Text>
            <View style={styles.confirmDialogButtons}>
              <TouchableOpacity
                style={styles.confirmDialogCancel}
                onPress={() => setShowClearConfirm(false)}
              >
                <Text style={styles.confirmDialogCancelText}>{t("Cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmDialogDelete,
                  isClearing && styles.confirmDialogDeleteDisabled,
                ]}
                onPress={handleClearAllHistory}
                disabled={isClearing}
              >
                {isClearing ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="trash" size={16} color="#FFFFFF" />
                    <Text style={styles.confirmDialogDeleteText}>Delete All</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

interface SessionItemProps {
  session: Session;
  onSelect: () => void;
  onDelete: () => void;
  onShare: () => void;
}

function SessionItem({ session, onSelect, onDelete, onShare }: SessionItemProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return t("Just now");
    if (hours < 24) return `${hours}h ${t("hours ago")}`;
    if (days < 7) return `${days}d ${t("days ago")}`;
    return date.toLocaleDateString();
  };

  return (
    <TouchableOpacity
      style={styles.sessionItem}
      onPress={onSelect}
      activeOpacity={0.7}
    >
      <View style={styles.sessionItemContent}>
        <View style={styles.sessionItemTitleRow}>
          {session.is_running && (
            <View style={styles.runningDotSmall} />
          )}
          <Text style={styles.sessionItemTitle} numberOfLines={1}>
            {session.title}
          </Text>
        </View>
        {session.preview && (
          <Text style={styles.sessionItemPreview} numberOfLines={1}>
            {session.preview}
          </Text>
        )}
      </View>
      <Text style={styles.sessionItemTime}>{formatTime(session.timestamp)}</Text>
      <TouchableOpacity
        style={styles.sessionItemAction}
        onPress={onShare}
        activeOpacity={0.7}
      >
        <Ionicons name="share-social-outline" size={15} color="#8a8780" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.sessionItemAction}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={16} color="#8a8780" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  collapsedContainer: {
    flex: 1,
    backgroundColor: "#f9fafb",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingVertical: 12,
  },
  badgeSmall: {
    position: "absolute",
    top: -3,
    right: -3,
    backgroundColor: "#2563eb",
    borderRadius: 7,
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeSmallText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    height: 40,
    gap: 8,
  },
  toggleButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  runningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(48,209,88,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    flex: 1,
  },
  runningDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#30D158",
  },
  runningDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#30D158",
    marginRight: 4,
  },
  runningBadgeText: {
    color: "#30D158",
    fontSize: 10,
    fontWeight: "600",
    flex: 1,
  },
  newTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d1d5db",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  newTaskButtonText: {
    flex: 1,
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "500",
  },
  shortcutKeys: {
    flexDirection: "row",
    gap: 4,
  },
  shortcutKey: {
    color: "#6b7280",
    fontSize: 11,
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sessionsList: {
    flex: 1,
    marginBottom: 12,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 2,
    gap: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  sessionItemContent: {
    flex: 1,
    minWidth: 0,
  },
  sessionItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sessionItemTitle: {
    color: "#374151",
    fontSize: 13,
    fontWeight: "400",
    flex: 1,
  },
  sessionItemPreview: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  sessionItemTime: {
    color: "#9ca3af",
    fontSize: 11,
  },
  sessionItemDelete: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionItemAction: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyStateText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "400",
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    justifyContent: "center",
  },
  clearButtonText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "500",
  },
  confirmDialog: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  confirmDialogContent: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 20,
    width: "80%",
    maxWidth: 300,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 8,
  },
  confirmDialogIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(220,38,38,0.1)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  confirmDialogTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  confirmDialogMessage: {
    color: "#6b7280",
    fontSize: 13,
    textAlign: "center",
  },
  confirmDialogButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  confirmDialogCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDialogCancelText: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "500",
  },
  confirmDialogDelete: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  confirmDialogDeleteDisabled: {
    opacity: 0.6,
  },
  confirmDialogDeleteText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
  },
});
