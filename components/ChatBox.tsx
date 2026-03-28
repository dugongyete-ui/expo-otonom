import React, { useRef } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChatAttachment } from "@/lib/chat";

interface ChatBoxProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isLoading?: boolean;
  isAgentMode?: boolean;
  isWaitingForUser?: boolean;
  attachments?: ChatAttachment[];
}

export function ChatBox({
  value,
  onChangeText,
  onSubmit,
  onStop,
  isLoading = false,
  isAgentMode = false,
  isWaitingForUser = false,
  attachments = [],
}: ChatBoxProps) {
  const inputRef = useRef<TextInput>(null);

  const inputEditable = true; // Always allow input
  const showSendButton = true; // Always show send button
  const canSend = value.trim().length > 0;

  const placeholder = isWaitingForUser
    ? "Ketik balasan Anda..."
    : isAgentMode
      ? "Pesan untuk Agent AI..."
      : "Kirim pesan ke Dzeck AI...";

  return (
    <View style={styles.container}>
      <View style={[styles.inputWrapper, isWaitingForUser && styles.inputWrapperWaiting]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={isWaitingForUser ? "#92400e" : "#8a8780"}
          value={value}
          onChangeText={onChangeText}
          multiline
          maxLength={4000}
          editable={inputEditable}
          onSubmitEditing={Platform.OS === "web" ? onSubmit : undefined}
          blurOnSubmit={false}
        />
      </View>

      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          {isAgentMode && (
            <Ionicons name="flash" size={18} color="#d97706" style={styles.modeIcon} />
          )}
        </View>

        <View style={styles.toolbarRight}>
          {/* Always show Send button if there is text, otherwise show Stop if loading */}
          {canSend ? (
            <TouchableOpacity
              onPress={onSubmit}
              style={[styles.toolbarBtn]}
              activeOpacity={0.6}
            >
              <View style={[styles.sendIconContainer]}>
                <Ionicons name="arrow-up" size={16} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          ) : isLoading && !isWaitingForUser ? (
            <TouchableOpacity onPress={onStop} style={styles.toolbarBtn} activeOpacity={0.6}>
              <View style={styles.stopIcon}>
                <Ionicons name="stop" size={14} color="#4a4740" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.toolbarBtn, styles.sendButtonDisabled]}
              activeOpacity={0.6}
              disabled={true}
            >
              <View style={[styles.sendIconContainer, styles.sendIconDisabled]}>
                <Ionicons name="arrow-up" size={16} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#edebe3",
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
    paddingHorizontal: 12,
  },
  inputWrapper: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    maxHeight: 120,
    marginBottom: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  inputWrapperWaiting: {
    borderColor: "rgba(234,179,8,0.4)",
    backgroundColor: "rgba(234,179,8,0.05)",
  },
  input: {
    fontSize: 14,
    color: "#1a1916",
    maxHeight: 100,
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toolbarLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  toolbarBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  modeIcon: {
    marginLeft: 4,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#1a1916",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  sendIconDisabled: {
    backgroundColor: "#ccc8be",
    opacity: 0.35,
  },
  stopIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#f5f3ee",
    borderWidth: 1,
    borderColor: "#ddd9d0",
    alignItems: "center",
    justifyContent: "center",
  },
});
