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
  updated_at?: number;
}

interface LeftPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewSession: (sessionId: string) => void;
}

const STALE_THRESHOLD_MS = 3 * 60 * 1000;

function isSessionActuallyRunning(session: Session): boolean {
  if (!session.is_running) return false;
  if (session.updated_at) {
    const age = Date.now() - session.updated_at;
    if (age > STALE_THRESHOLD_MS) return false;
  }
  return true;
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
          const updatedAt = s.updated_at
            ? new Date(s.updated_at).getTime()
            : s.startedAt
            ? new Date(s.startedAt).getTime()
            : undefined;
          return {
            session_id: s.session_id,
            title,
            timestamp: s.startedAt || Date.now(),
            preview: s.eventCount ? `${s.eventCount} events` : undefined,
            is_running: s.is_running || false,
            updated_at: updatedAt,
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
    const interval = setInterval(fetchSessions, 8000);
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

  const runningCount = sessions.filter(s => isSessionActuallyRunning(s)).length;

  if (!isOpen) {
    return (
      <View style={styles.collapsedContainer}>
        <TouchableOpacity style={styles.toggleButton} onPress={onToggle}>
          <View>
            <Ionicons name="menu" size={20} color="#888888" />
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
          <Ionicons name="chevron-back" size={20} color="#888888" />
        </TouchableOpacity>

        {runningCount > 0 && (
          <View style={styles.runningBadge}>
            <View style={styles.runningDot} />
            <Text style={styles.runningBadgeText} numberOfLines={1}>
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
        <Ionicons name="add" size={18} color="#888888" />
        <Text style={styles.newTaskButtonText}>{t("New Task")}</Text>
        <View style={styles.shortcutKeys}>
          <Text style={styles.shortcutKey}>⌘K</Text>
        </View>
      </TouchableOpacity>

      {/* Sessions List */}
      {isLoading && sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color="#888888" />
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
              isRunning={isSessionActuallyRunning(session)}
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
            size={36}
            color="#555555"
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
          <Ionicons name="trash-outline" size={14} color="#666666" />
          <Text style={styles.clearButtonText}>{t("Clear All History")}</Text>
        </TouchableOpacity>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearConfirm && (
        <View style={styles.confirmDialog}>
          <View style={styles.confirmDialogContent}>
            <View style={styles.confirmDialogIcon}>
              <Ionicons name="trash" size={22} color="#e05050" />
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
                    <Ionicons name="trash" size={14} color="#FFFFFF" />
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
  isRunning: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onShare: () => void;
}

function SessionItem({ session, isRunning, onSelect, onDelete, onShare }: SessionItemProps) {
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
          {isRunning && (
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
        <Ionicons name="share-social-outline" size={14} color="#666666" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.sessionItemAction}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={14} color="#666666" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  collapsedContainer: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingVertical: 12,
  },
  badgeSmall: {
    position: "absolute",
    top: -3,
    right: -3,
    backgroundColor: "#4a7cf0",
    borderRadius: 7,
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeSmallText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "700",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    height: 40,
    gap: 8,
  },
  toggleButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#252525",
  },
  runningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(50,200,80,0.08)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flex: 1,
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#40c060",
  },
  runningDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#40c060",
    marginRight: 5,
    flexShrink: 0,
  },
  runningBadgeText: {
    color: "#40c060",
    fontSize: 10,
    fontWeight: "500",
    flex: 1,
  },
  newTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#252525",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "#333333",
  },
  newTaskButtonText: {
    flex: 1,
    color: "#888888",
    fontSize: 13,
    fontWeight: "500",
  },
  shortcutKeys: {
    flexDirection: "row",
    gap: 4,
  },
  shortcutKey: {
    color: "#555555",
    fontSize: 10,
    backgroundColor: "#333333",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sessionsList: {
    flex: 1,
    marginBottom: 10,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 2,
    gap: 6,
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
    color: "#c0c0c0",
    fontSize: 12,
    fontWeight: "400",
    flex: 1,
  },
  sessionItemPreview: {
    color: "#606060",
    fontSize: 11,
    marginTop: 2,
  },
  sessionItemTime: {
    color: "#555555",
    fontSize: 10,
    flexShrink: 0,
  },
  sessionItemDelete: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionItemAction: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyStateText: {
    color: "#606060",
    fontSize: 12,
    fontWeight: "400",
    textAlign: "center",
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#252525",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 7,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#333333",
  },
  clearButtonText: {
    color: "#666666",
    fontSize: 13,
    fontWeight: "500",
  },
  confirmDialog: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  confirmDialogContent: {
    backgroundColor: "#252525",
    borderRadius: 14,
    padding: 20,
    width: "88%",
    maxWidth: 300,
    gap: 12,
    borderWidth: 1,
    borderColor: "#333333",
  },
  confirmDialogIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(220,60,60,0.12)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  confirmDialogTitle: {
    color: "#e0e0e0",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  confirmDialogMessage: {
    color: "#888888",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  confirmDialogButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  confirmDialogCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#404040",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDialogCancelText: {
    color: "#a0a0a0",
    fontSize: 13,
    fontWeight: "500",
  },
  confirmDialogDelete: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#c03030",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  confirmDialogDeleteDisabled: {
    opacity: 0.5,
  },
  confirmDialogDeleteText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
  },
});
