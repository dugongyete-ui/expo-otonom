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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ChatCard } from "./ChatCard";
import { ChatInput } from "./ChatInput";
import { useChat, Message } from "@/lib/useChat";

export function ChatScreen() {
  const { messages, isLoading, isWaitingForUser, error, sendMessage, stop, clear } = useChat();
  const [isAgentMode, setIsAgentMode] = useState(false);
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
    async (text: string) => {
      await sendMessage(text, isAgentMode);
      scrollToBottom();
    },
    [sendMessage, isAgentMode, scrollToBottom]
  );

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleClear = useCallback(() => {
    clear();
  }, [clear]);

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
      <Text style={styles.emptyTitle}>Welcome to Dzeck AI</Text>
      <Text style={styles.emptySubtitle}>
        {isAgentMode
          ? "Tell me what you want to accomplish"
          : "Ask me anything"}
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
            <TouchableOpacity
              onPress={handleClear}
              style={styles.clearButton}
            >
              <Ionicons name="trash-outline" size={18} color="#8E8E93" />
            </TouchableOpacity>
          </View>
        </View>

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
              {isAgentMode ? "Agent is working..." : "Thinking..."}
            </Text>
          </View>
        )}

        {/* Waiting for user indicator */}
        {isWaitingForUser && (
          <View style={styles.loadingContainer}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color="#6C5CE7" />
            <Text style={styles.loadingText}>
              Agent is waiting for your reply...
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
          placeholder={
            isWaitingForUser
              ? "Type your reply..."
              : isAgentMode
                ? "Tell Dzeck what to do..."
                : "Ask Dzeck anything..."
          }
        />
      </KeyboardAvoidingView>
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
  messageList: {
    flexGrow: 1,
    paddingVertical: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
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
});
