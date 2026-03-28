import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Switch,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ChatCard } from "./ChatCard";
import { ChatInput } from "./ChatInput";
import { VNCViewer } from "./VNCViewer";
import { useChat, Message, VncInfo } from "@/lib/useChat";
import { getApiBaseUrl, getStoredToken } from "@/lib/api-service";
import { t } from "@/lib/i18n";

export function ChatScreen() {
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [vncInfo, setVncInfo] = useState<VncInfo | null>(null);
  const [showVNC, setShowVNC] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [vncConnected, setVncConnected] = useState(false);

  const handleVncUrl = useCallback((info: VncInfo) => {
    setVncInfo(info);
    setShowVNC(true);
  }, []);

  const { messages, isLoading, isWaitingForUser, error, sendMessage, stop, clear, sessionId } = useChat(handleVncUrl);
  const flatListRef = useRef<FlatList>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(
    async (text: string, attachments?: any[]) => {
      await sendMessage(text, isAgentMode, attachments);
      scrollToBottom();
    },
    [sendMessage, isAgentMode, scrollToBottom]
  );

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleClear = useCallback(() => {
    clear();
    setVncInfo(null);
    setShowVNC(false);
  }, [clear]);

  const fetchShareState = useCallback(async (sid: string) => {
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/api/sessions/${sid}/share`, { headers });
      if (res.ok) {
        const data = await res.json();
        setIsShared(data.is_shared || false);
        setShareUrl(data.share_url || null);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleOpenShare = useCallback(() => {
    if (sessionId) {
      fetchShareState(sessionId);
    }
    setShowShareModal(true);
  }, [sessionId, fetchShareState]);

  const handleToggleShare = useCallback(async () => {
    if (!sessionId) return;
    setIsTogglingShare(true);
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/share`, {
        method: "POST",
        headers,
        body: JSON.stringify({ is_shared: !isShared }),
      });
      const data = await res.json();
      setIsShared(data.is_shared);
      setShareUrl(data.share_url || null);
    } catch {
      Alert.alert("Error", "Failed to update sharing settings");
    } finally {
      setIsTogglingShare(false);
    }
  }, [sessionId, isShared]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await Clipboard.setStringAsync(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      Alert.alert("Error", "Failed to copy link");
    }
  }, [shareUrl]);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <ChatCard
        type={item.type}
        content={item.content}
        timestamp={item.timestamp}
        toolName={item.toolName}
        toolArgs={item.toolArgs}
        isLoading={item.isLoading}
      />
    ),
    []
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="sparkles" size={48} color="#6C5CE7" />
      </View>
      <Text style={styles.emptyTitle}>{t("Welcome to Dzeck AI")}</Text>
      <Text style={styles.emptySubtitle}>
        {isAgentMode
          ? t("Tell me what you want to accomplish")
          : t("Ask me anything")}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="sparkles" size={24} color="#6C5CE7" />
            <Text style={styles.headerTitle}>Dzeck AI</Text>
          </View>
          <View style={styles.headerRight}>
            {/* VNC toggle button when VNC session active */}
            {vncInfo && (
              <TouchableOpacity
                onPress={() => setShowVNC(v => !v)}
                style={[styles.iconButton, showVNC && styles.iconButtonActive]}
              >
                <Ionicons
                  name={showVNC ? "desktop" : "desktop-outline"}
                  size={18}
                  color={showVNC ? "#6C5CE7" : "#8E8E93"}
                />
              </TouchableOpacity>
            )}

            {/* Share button */}
            {sessionId && messages.length > 0 && (
              <TouchableOpacity
                onPress={handleOpenShare}
                style={styles.iconButton}
              >
                <Ionicons name="share-outline" size={18} color="#8E8E93" />
              </TouchableOpacity>
            )}

            {/* Agent mode toggle */}
            <TouchableOpacity
              onPress={() => setIsAgentMode(!isAgentMode)}
              style={[
                styles.modeButton,
                isAgentMode && styles.modeButtonActive,
              ]}
            >
              <Ionicons
                name={isAgentMode ? "flash" : "git-branch-outline"}
                size={18}
                color={isAgentMode ? "#6C5CE7" : "#8E8E93"}
              />
            </TouchableOpacity>

            {/* Clear button */}
            <TouchableOpacity
              onPress={handleClear}
              style={styles.clearButton}
            >
              <Ionicons name="trash-outline" size={18} color="#8E8E93" />
            </TouchableOpacity>
          </View>
        </View>

        {/* VNC Panel - inline in ChatScreen */}
        {showVNC && vncInfo?.e2bSessionId && (
          <View style={styles.vncPanel}>
            <View style={styles.vncHeader}>
              <View style={styles.vncHeaderLeft}>
                <Ionicons name="desktop-outline" size={14} color="#6C5CE7" />
                <Text style={styles.vncHeaderTitle}>Desktop</Text>
                {vncConnected && (
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveBadgeText}>Live</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={() => setShowVNC(false)}
                style={styles.vncCloseBtn}
              >
                <Ionicons name="chevron-down" size={16} color="#636366" />
              </TouchableOpacity>
            </View>
            <View style={styles.vncContent}>
              <VNCViewer
                sessionId={vncInfo.e2bSessionId}
                enabled={showVNC}
                viewOnly={false}
                onConnected={() => setVncConnected(true)}
                onDisconnected={() => setVncConnected(false)}
              />
            </View>
          </View>
        )}

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.messageList}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
        />

        {/* Loading indicator */}
        {isLoading && !isWaitingForUser && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#6C5CE7" />
            <Text style={styles.loadingText}>
              {isAgentMode ? t("Agent is working...") : "Thinking..."}
            </Text>
          </View>
        )}

        {/* Waiting for user indicator */}
        {isWaitingForUser && (
          <View style={styles.loadingContainer}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color="#6C5CE7" />
            <Text style={styles.loadingText}>
              {t("Agent is waiting for your reply...")}
            </Text>
          </View>
        )}

        {/* Error message */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={16} color="#FF453A" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          disabled={isLoading && !isWaitingForUser}
          onStop={handleStop}
          isGenerating={isLoading && !isWaitingForUser}
          isAgentMode={isAgentMode}
          onToggleMode={() => setIsAgentMode(!isAgentMode)}
          showModeToggle={true}
          activeSessionId={sessionId}
          placeholder={
            isWaitingForUser
              ? t("Type your reply...")
              : isAgentMode
                ? t("Tell Dzeck what to do...")
                : t("Ask Dzeck anything...")
          }
        />
      </KeyboardAvoidingView>

      {/* Share Modal */}
      <Modal
        visible={showShareModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.shareModal}>
            <View style={styles.shareModalHeader}>
              <Text style={styles.shareModalTitle}>{t("Share")}</Text>
              <TouchableOpacity onPress={() => setShowShareModal(false)}>
                <Ionicons name="close" size={22} color="#636366" />
              </TouchableOpacity>
            </View>

            <View style={styles.shareRow}>
              <View style={styles.shareRowLeft}>
                <Ionicons
                  name={isShared ? "globe-outline" : "lock-closed-outline"}
                  size={20}
                  color={isShared ? "#6C5CE7" : "#8E8E93"}
                />
                <View>
                  <Text style={styles.shareRowTitle}>
                    {isShared ? t("Public Access") : t("Private Only")}
                  </Text>
                  <Text style={styles.shareRowSub}>
                    {isShared ? t("Anyone with the link can view") : t("Only visible to you")}
                  </Text>
                </View>
              </View>
              {isTogglingShare ? (
                <ActivityIndicator size="small" color="#6C5CE7" />
              ) : (
                <Switch
                  value={isShared}
                  onValueChange={handleToggleShare}
                  trackColor={{ false: "#2C2C30", true: "#6C5CE7" }}
                  thumbColor="#FFFFFF"
                />
              )}
            </View>

            {isShared && shareUrl && (
              <TouchableOpacity
                style={styles.copyLinkBtn}
                onPress={handleCopyLink}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={linkCopied ? "checkmark-circle" : "copy-outline"}
                  size={18}
                  color={linkCopied ? "#30D158" : "#FFFFFF"}
                />
                <Text style={styles.copyLinkText}>
                  {linkCopied ? t("Link Copied!") : t("Copy Link")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0C",
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2C2C30",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A20",
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  iconButtonActive: {
    backgroundColor: "#1E1A2E",
    borderColor: "#6C5CE7",
  },
  modeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A20",
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  modeButtonActive: {
    backgroundColor: "#6C5CE7",
    borderColor: "#6C5CE7",
  },
  clearButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A20",
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  vncPanel: {
    height: 240,
    backgroundColor: "#0A0A0C",
    borderBottomWidth: 1,
    borderBottomColor: "#2C2C30",
  },
  vncHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2C2C30",
  },
  vncHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vncHeaderTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(48,209,88,0.15)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#30D158",
  },
  liveBadgeText: {
    fontSize: 9,
    color: "#30D158",
    fontWeight: "600",
  },
  vncCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A20",
  },
  vncContent: {
    flex: 1,
  },
  messageList: {
    flexGrow: 1,
    paddingVertical: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    minHeight: 300,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#8E8E93",
    textAlign: "center",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  loadingText: {
    color: "#8E8E93",
    fontSize: 14,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FF453A20",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FF453A",
    gap: 8,
  },
  errorText: {
    color: "#FF453A",
    fontSize: 12,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  shareModal: {
    backgroundColor: "#1A1A20",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: "#2C2C30",
    gap: 16,
  },
  shareModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shareModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0A0A0C",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  shareRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  shareRowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  shareRowSub: {
    fontSize: 12,
    color: "#636366",
    marginTop: 2,
  },
  copyLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#6C5CE7",
    borderRadius: 12,
    paddingVertical: 14,
  },
  copyLinkText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
