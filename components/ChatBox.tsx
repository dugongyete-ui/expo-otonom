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
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatAttachment } from "@/lib/chat";
import { COLORS } from "@/lib/theme";
import { PaperclipIcon, FlashIcon, ArrowUpIcon, StopIcon, CloseCircleIcon, DocumentIcon } from "@/components/icons/SvgIcon";

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

  const handleAttachFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isImage = asset.mimeType?.startsWith("image/") ?? false;
        const newAttachments = [
          ...attachments,
          {
            uri: asset.uri,
            type: isImage ? ("image" as const) : ("file" as const),
            name: asset.name || "file",
            mimeType: asset.mimeType,
          },
        ];
        onAttachmentsChange?.(newAttachments);
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch (error) {
      console.error("File picker error:", error);
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
              {att.type === "image" ? (
                <Image source={{ uri: att.uri }} style={styles.attachmentThumb} />
              ) : (
                <View style={styles.fileThumb}>
                  <DocumentIcon size={22} color={COLORS.accent} />
                </View>
              )}
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => removeAttachment(i)}
              >
                <CloseCircleIcon size={18} color="#f87171" />
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
            onPress={handleAttachFile}
            style={styles.toolbarBtn}
            activeOpacity={0.6}
          >
            <PaperclipIcon size={20} color={COLORS.iconMuted} />
          </TouchableOpacity>
          {isAgentMode && (
            <View style={styles.modeIcon}>
              <FlashIcon size={18} color="#888888" />
            </View>
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
                <ArrowUpIcon size={16} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          ) : isLoading && !isWaitingForUser ? (
            <TouchableOpacity onPress={onStop} style={styles.toolbarBtn} activeOpacity={0.6}>
              <View style={styles.stopIcon}>
                <StopIcon size={14} color={COLORS.stopIcon} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.toolbarBtn, styles.sendButtonDisabled]}
              activeOpacity={0.6}
              disabled={true}
            >
              <View style={[styles.sendIconContainer, styles.sendIconDisabled]}>
                <ArrowUpIcon size={16} color="#FFFFFF" />
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
  fileThumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#3a3a3a",
    alignItems: "center",
    justifyContent: "center",
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
    alignItems: "center",
    justifyContent: "center",
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
