import React, { useRef, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  ScrollView,
  Text,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatAttachment } from "@/lib/chat";
import { COLORS } from "@/lib/theme";
import { PaperclipIcon, ArrowUpIcon, StopIcon, CloseCircleIcon, DocumentIcon } from "@/components/icons/SvgIcon";

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
  placeholder?: string;
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
  placeholder,
}: ChatBoxProps) {
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  const inputEditable = true;
  const canSend = (!isLoading || isWaitingForUser) && (value.trim().length > 0 || attachments.length > 0);

  const placeholderText = placeholder || (isWaitingForUser
    ? "Type your reply..."
    : "Give Manus a task to work on...");

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
      ? insets.bottom + 8
      : 16;

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
                  <DocumentIcon size={22} color={COLORS.iconMuted} />
                </View>
              )}
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => removeAttachment(i)}
              >
                <CloseCircleIcon size={18} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Main input box - rounded container like ai-manus */}
      <View style={[styles.inputBox, isWaitingForUser && styles.inputBoxWaiting]}>
        {/* Textarea */}
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={placeholderText}
            placeholderTextColor="#9CA3AF"
            value={value}
            onChangeText={onChangeText}
            multiline
            maxLength={4000}
            editable={inputEditable}
            onSubmitEditing={Platform.OS === "web" ? onSubmit : undefined}
            blurOnSubmit={false}
          />
        </View>

        {/* Footer toolbar */}
        <View style={styles.toolbar}>
          {/* Left: paperclip attach */}
          <TouchableOpacity
            onPress={handleAttachFile}
            style={styles.attachBtn}
            activeOpacity={0.6}
          >
            <View style={styles.attachBtnInner}>
              <PaperclipIcon size={18} color="#9CA3AF" />
            </View>
          </TouchableOpacity>

          {/* Right: send / stop */}
          <View style={styles.toolbarRight}>
            {isLoading && !isWaitingForUser ? (
              <TouchableOpacity onPress={onStop} style={styles.actionBtn} activeOpacity={0.8}>
                <View style={styles.stopBtnInner}>
                  <View style={styles.stopSquare} />
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={canSend ? onSubmit : undefined}
                style={styles.actionBtn}
                activeOpacity={canSend ? 0.8 : 1}
              >
                <View style={[styles.sendBtnInner, !canSend && styles.sendBtnDisabled]}>
                  <ArrowUpIcon size={16} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F0EEE6",
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  attachmentBar: {
    maxHeight: 80,
    marginBottom: 6,
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
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E3DC",
    alignItems: "center",
    justifyContent: "center",
  },
  removeAttachment: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#F0EEE6",
    borderRadius: 9,
  },
  inputBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    paddingTop: 12,
    paddingBottom: 8,
  },
  inputBoxWaiting: {
    borderColor: "#3B82F6",
    borderWidth: 1.5,
  },
  inputWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    maxHeight: 120,
  },
  input: {
    fontSize: 15,
    color: "#1A1A1A",
    maxHeight: 100,
    lineHeight: 22,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  attachBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E3DC",
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1A1A1A",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#D1CFC8",
  },
  stopBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1A1A1A",
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
});
