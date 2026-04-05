import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
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

  const runningCount = sessions.filter(s => isSessionActuallyRunning(s)).length;

  if (!isOpen) return null;

  return (
    <View style={styles.container}>
      {/* Header with collapse button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.toggleButton} onPress={onToggle} activeOpacity={0.7}>
          <Text style={styles.panelLeftIcon}>⟵</Text>
        </TouchableOpacity>
      </View>

      {/* New Task Button */}
      <TouchableOpacity
        style={styles.newTaskButton}
        onPress={handleNewTask}
        activeOpacity={0.7}
      >
        <View style={styles.newTaskIcon}>
          <Text style={styles.newTaskIconText}>✎</Text>
        </View>
        <Text style={styles.newTaskButtonText}>{t("New Task")}</Text>
        <View style={styles.shortcutKeys}>
          <View style={styles.shortcutKey}><Text style={styles.shortcutKeyText}>⌘</Text></View>
          <View style={styles.shortcutKey}><Text style={styles.shortcutKeyText}>K</Text></View>
        </View>
      </TouchableOpacity>

      {/* All Tasks label */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{t("All Tasks")}</Text>
        {runningCount > 0 && (
          <View style={styles.runningBadge}>
            <View style={styles.runningDot} />
            <Text style={styles.runningBadgeText}>{runningCount}</Text>
          </View>
        )}
      </View>

      {/* Sessions List */}
      {isLoading && sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color="#9CA3AF" />
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
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>💬</Text>
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
          <Text style={styles.clearButtonText}>{t("Clear All History")}</Text>
        </TouchableOpacity>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearConfirm && (
        <View style={styles.confirmDialog}>
          <View style={styles.confirmDialogContent}>
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
                  <Text style={styles.confirmDialogDeleteText}>Delete All</Text>
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
}

function SessionItem({ session, isRunning, onSelect, onDelete }: SessionItemProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return t("Just now");
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
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
      </View>
      <Text style={styles.sessionItemTime}>{formatTime(session.timestamp)}</Text>
      <TouchableOpacity
        style={styles.sessionItemAction}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Text style={styles.deleteIcon}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F4EF",
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  panelLeftIcon: {
    fontSize: 18,
    color: "#6B7280",
  },
  newTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
    marginBottom: 4,
    gap: 10,
    height: 36,
  },
  newTaskIcon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  newTaskIconText: {
    fontSize: 16,
    color: "#1A1A1A",
  },
  newTaskButtonText: {
    flex: 1,
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "500",
  },
  shortcutKeys: {
    flexDirection: "row",
    gap: 3,
    flexShrink: 0,
  },
  shortcutKey: {
    height: 20,
    minWidth: 20,
    paddingHorizontal: 4,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.06)",
    borderWidth: 1,
    borderColor: "#E5E3DC",
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutKeyText: {
    fontSize: 11,
    color: "#6B7280",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  sectionHeaderText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  runningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22C55E",
  },
  runningBadgeText: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "500",
  },
  sessionsList: {
    flex: 1,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 1,
    gap: 4,
  },
  sessionItemContent: {
    flex: 1,
    minWidth: 0,
  },
  sessionItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  runningDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#22C55E",
    marginRight: 5,
    flexShrink: 0,
  },
  sessionItemTitle: {
    color: "#374151",
    fontSize: 13,
    fontWeight: "400",
    flex: 1,
  },
  sessionItemTime: {
    color: "#9CA3AF",
    fontSize: 11,
    flexShrink: 0,
  },
  sessionItemAction: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  deleteIcon: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyStateIcon: {
    fontSize: 32,
    color: "#D1CFC8",
  },
  emptyStateText: {
    color: "#9CA3AF",
    fontSize: 13,
    textAlign: "center",
    fontWeight: "500",
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  clearButtonText: {
    color: "#9CA3AF",
    fontSize: 12,
  },
  confirmDialog: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDialogContent: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    width: "85%",
    maxWidth: 300,
    gap: 12,
  },
  confirmDialogTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  confirmDialogMessage: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 20,
  },
  confirmDialogButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  confirmDialogCancel: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F4EF",
    borderWidth: 1,
    borderColor: "#E5E3DC",
  },
  confirmDialogCancelText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "500",
  },
  confirmDialogDelete: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDialogDeleteDisabled: {
    opacity: 0.5,
  },
  confirmDialogDeleteText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
});
