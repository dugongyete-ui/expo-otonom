import React, { useRef, useCallback } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatAttachment } from "@/lib/chat";
import { COLORS } from "@/lib/theme";

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
  const insets = useSafeAreaInsets();

  const inputEditable = true;
  const canSend = (!isLoading || isWaitingForUser) && (value.trim().length > 0 || attachments.length > 0);

  const placeholder = isWaitingForUser
    ? "Ketik balasan Anda..."
    : isAgentMode
      ? "Berikan tugas untuk Dzeck AI..."
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

  const bottomPad = Platform.OS === "ios"
    ? Math.max(insets.bottom, 8)
    : insets.bottom > 0
      ? insets.bottom + 16
      : 32;

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
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
                <Ionicons name="close-circle" size={18} color="#f87171" />
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
          placeholderTextColor={isWaitingForUser ? "#92400e" : COLORS.textPlaceholder}
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
          <TouchableOpacity
            onPress={handleAttachImage}
            style={styles.toolbarBtn}
            activeOpacity={0.6}
          >
            <Ionicons name="image-outline" size={20} color={COLORS.iconMuted} />
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
                <Ionicons name="stop" size={14} color={COLORS.stopIcon} />
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
    backgroundColor: COLORS.bgToolbar,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
    backgroundColor: COLORS.bgToolbar,
    borderRadius: 9,
  },
  inputWrapper: {
    backgroundColor: COLORS.bgInput,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.bgInputBorder,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    maxHeight: 120,
    marginBottom: 6,
    marginTop: 8,
  },
  inputWrapperWaiting: {
    borderColor: "rgba(234,179,8,0.4)",
    backgroundColor: "rgba(234,179,8,0.05)",
  },
  input: {
    fontSize: 14,
    color: COLORS.text,
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
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIconDisabled: {
    backgroundColor: COLORS.sendDisabled,
    opacity: 0.5,
  },
  stopIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: COLORS.stopBg,
    borderWidth: 1,
    borderColor: COLORS.stopBorder,
    alignItems: "center",
    justifyContent: "center",
  },
});
