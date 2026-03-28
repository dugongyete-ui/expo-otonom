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
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/lib/api-service";

interface Session {
  session_id: string;
  title: string;
  timestamp: number;
  preview?: string;
}

interface LeftPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewSession: (sessionId: string) => void;
}

export function LeftPanel({ isOpen, onToggle, onNewSession }: LeftPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      // This would call your backend API to get sessions
      // For now, we'll use mock data
      setSessions([]);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleNewTask = useCallback(() => {
    const newSessionId = `session_${Date.now()}`;
    onNewSession(newSessionId);
  }, [onNewSession]);

  const handleClearAllHistory = useCallback(async () => {
    setIsClearing(true);
    try {
      // Call API to clear all sessions
      setSessions([]);
      setShowClearConfirm(false);
      onNewSession(`session_${Date.now()}`);
    } catch (error) {
      console.error("Failed to clear history:", error);
      Alert.alert("Error", "Failed to clear history");
    } finally {
      setIsClearing(false);
    }
  }, [onNewSession]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      onNewSession(sessionId);
    },
    [onNewSession]
  );

  const handleDeleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }, []);

  if (!isOpen) {
    return (
      <View style={styles.collapsedContainer}>
        <TouchableOpacity style={styles.toggleButton} onPress={onToggle}>
          <Ionicons name="menu" size={20} color="#8E8E93" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.toggleButton} onPress={onToggle}>
          <Ionicons name="chevron-back" size={20} color="#8E8E93" />
        </TouchableOpacity>
      </View>

      {/* New Task Button */}
      <TouchableOpacity
        style={styles.newTaskButton}
        onPress={handleNewTask}
        activeOpacity={0.7}
      >
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={styles.newTaskButtonText}>New Task</Text>
        <View style={styles.shortcutKeys}>
          <Text style={styles.shortcutKey}>⌘K</Text>
        </View>
      </TouchableOpacity>

      {/* Sessions List */}
      {sessions.length > 0 ? (
        <ScrollView style={styles.sessionsList} showsVerticalScrollIndicator={false}>
          {sessions.map((session) => (
            <SessionItem
              key={session.session_id}
              session={session}
              onSelect={() => handleSessionSelect(session.session_id)}
              onDelete={() => handleDeleteSession(session.session_id)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons
            name="chatbubble-outline"
            size={40}
            color="#636366"
          />
          <Text style={styles.emptyStateText}>Create a task to get started</Text>
        </View>
      )}

      {/* Clear History Button */}
      {sessions.length > 0 && (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={() => setShowClearConfirm(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={16} color="#8E8E93" />
          <Text style={styles.clearButtonText}>Clear All History</Text>
        </TouchableOpacity>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearConfirm && (
        <View style={styles.confirmDialog}>
          <View style={styles.confirmDialogContent}>
            <View style={styles.confirmDialogIcon}>
              <Ionicons name="trash" size={24} color="#FF453A" />
            </View>
            <Text style={styles.confirmDialogTitle}>Clear All History</Text>
            <Text style={styles.confirmDialogMessage}>
              This will permanently delete all chat sessions. This action cannot be undone.
            </Text>
            <View style={styles.confirmDialogButtons}>
              <TouchableOpacity
                style={styles.confirmDialogCancel}
                onPress={() => setShowClearConfirm(false)}
              >
                <Text style={styles.confirmDialogCancelText}>Cancel</Text>
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
}

function SessionItem({ session, onSelect, onDelete }: SessionItemProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Just now";
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
        <Text style={styles.sessionItemTitle} numberOfLines={1}>
          {session.title}
        </Text>
        {session.preview && (
          <Text style={styles.sessionItemPreview} numberOfLines={1}>
            {session.preview}
          </Text>
        )}
      </View>
      <Text style={styles.sessionItemTime}>{formatTime(session.timestamp)}</Text>
      <TouchableOpacity
        style={styles.sessionItemDelete}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={16} color="#8E8E93" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1A1A20",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  collapsedContainer: {
    flex: 1,
    backgroundColor: "#1A1A20",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingVertical: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    height: 40,
  },
  toggleButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2C2C30",
  },
  newTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6C5CE7",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  newTaskButtonText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  shortcutKeys: {
    flexDirection: "row",
    gap: 4,
  },
  shortcutKey: {
    color: "#8E8E93",
    fontSize: 11,
    backgroundColor: "#2C2C30",
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
    backgroundColor: "#2C2C30",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 8,
  },
  sessionItemContent: {
    flex: 1,
    minWidth: 0,
  },
  sessionItemTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
  },
  sessionItemPreview: {
    color: "#8E8E93",
    fontSize: 12,
    marginTop: 2,
  },
  sessionItemTime: {
    color: "#636366",
    fontSize: 11,
  },
  sessionItemDelete: {
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
    color: "#636366",
    fontSize: 14,
    fontWeight: "500",
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C30",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    justifyContent: "center",
  },
  clearButtonText: {
    color: "#8E8E93",
    fontSize: 14,
    fontWeight: "500",
  },
  confirmDialog: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  confirmDialogContent: {
    backgroundColor: "#1A1A20",
    borderRadius: 12,
    padding: 20,
    width: "80%",
    maxWidth: 300,
    gap: 12,
  },
  confirmDialogIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FF453A20",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  confirmDialogTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  confirmDialogMessage: {
    color: "#8E8E93",
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
    borderColor: "#2C2C30",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDialogCancelText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
  },
  confirmDialogDelete: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#FF453A",
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
