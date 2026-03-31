import React, { useRef, useState, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
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
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
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
  onAttachmentsChange,
}: ChatBoxProps) {
  const inputRef = useRef<TextInput>(null);

  const inputEditable = true;
  const showSendButton = true;
  const canSend = value.trim().length > 0 || attachments.length > 0;

  const placeholder = isWaitingForUser
    ? "Ketik balasan Anda..."
    : isAgentMode
      ? "Pesan untuk Agent AI..."
      : "Kirim pesan ke Dzeck AI...";

  const handleAttachImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const newAttachments = [
          ...attachments,
          {
            uri: asset.uri,
            type: "image" as const,
            name: asset.fileName || "image.jpg",
          },
        ];
        onAttachmentsChange?.(newAttachments);
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch (error) {
      console.error("Image picker error:", error);
    }
  }, [attachments, onAttachmentsChange]);

  const removeAttachment = useCallback((index: number) => {
    onAttachmentsChange?.(attachments.filter((_, i) => i !== index));
  }, [attachments, onAttachmentsChange]);

  return (
    <View style={styles.container}>
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.attachmentBar}
          contentContainerStyle={styles.attachmentBarContent}
        >
          {attachments.map((att, i) => (
            <View key={i} style={styles.attachmentPreview}>
              <Image source={{ uri: att.uri }} style={styles.attachmentThumb} />
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => removeAttachment(i)}
              >
                <Ionicons name="close-circle" size={18} color="#dc2626" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

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
          {/* Attachment button */}
          <TouchableOpacity
            onPress={handleAttachImage}
            style={styles.toolbarBtn}
            activeOpacity={0.6}
          >
            <Ionicons name="image-outline" size={20} color="#8a8780" />
          </TouchableOpacity>
          {isAgentMode && (
            <Ionicons name="flash" size={18} color="#d97706" style={styles.modeIcon} />
          )}
        </View>

        <View style={styles.toolbarRight}>
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
  attachmentBar: {
    maxHeight: 80,
    marginBottom: 4,
  },
  attachmentBarContent: {
    paddingVertical: 4,
    gap: 8,
  },
  attachmentPreview: {
    position: "relative",
    marginRight: 8,
  },
  attachmentThumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
  },
  removeAttachment: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#edebe3",
    borderRadius: 9,
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
    gap: 4,
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
