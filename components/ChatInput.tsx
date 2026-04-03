import React, { useState, useRef, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Platform,
  Text,
  ActivityIndicator,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatAttachment } from "@/lib/chat";
import { getApiBaseUrl, getStoredToken } from "@/lib/api-service";
import { COLORS } from "@/lib/theme";

interface ChatInputProps {
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  disabled?: boolean;
  onStop?: () => void;
  isGenerating?: boolean;
  placeholder?: string;
  isAgentMode?: boolean;
  onToggleMode?: () => void;
  onShowHistory?: () => void;
  showModeToggle?: boolean;
  activeSessionId?: string | null;
}

export function ChatInput({
  onSend,
  disabled,
  onStop,
  isGenerating,
  placeholder,
  isAgentMode,
  onToggleMode,
  showModeToggle,
  activeSessionId,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingToSandbox, setIsUploadingToSandbox] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [text, attachments, onSend]);

  const handleAttachFile = useCallback(async () => {
    setShowAttachMenu(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isImage = asset.mimeType?.startsWith("image/") ?? false;
        setAttachments((prev) => [
          ...prev,
          {
            uri: asset.uri,
            type: isImage ? ("image" as const) : ("file" as const),
            name: asset.name || "file",
            mimeType: asset.mimeType,
          },
        ]);
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch (error) {
      console.error("File picker error:", error);
    }
  }, []);

  const handleUploadToSandbox = useCallback(async () => {
    setShowAttachMenu(false);
    if (!activeSessionId) {
      console.warn("No active session to upload to");
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      setIsUploadingToSandbox(true);

      const formData = new FormData();
      const filePayload: Record<string, string> = {
        uri: asset.uri,
        name: asset.name || "file",
        type: asset.mimeType || "application/octet-stream",
      };
      formData.append("file", filePayload as unknown as Blob);

      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const uploadHeaders: Record<string, string> = {};
      if (token) uploadHeaders["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`${baseUrl}/api/e2b/sessions/${activeSessionId}/upload`, {
        method: "POST",
        headers: uploadHeaders,
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }

      const data = await response.json();
      const uploadedPath = data.path || asset.name;
      setText((prev) => {
        const note = `[File uploaded to sandbox: ${uploadedPath}] `;
        return prev ? `${prev} ${note}` : note;
      });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error: any) {
      console.error("File upload error:", error);
      setText((prev) => (prev ? prev : `Upload failed: ${error.message}`));
    } finally {
      setIsUploadingToSandbox(false);
    }
  }, [activeSessionId]);

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled;

  const bottomPad = Platform.OS === "ios"
    ? Math.max(insets.bottom, 8)
    : insets.bottom > 0
      ? insets.bottom + 16
      : 32;

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
      {/* Attachment menu */}
      {showAttachMenu && (
        <View style={styles.attachMenu}>
          <TouchableOpacity
            style={styles.attachMenuItem}
            onPress={handleAttachFile}
          >
            <NativeIcon name="attach" size={18} color={COLORS.iconMuted} />
            <Text style={styles.attachMenuText}>Pilih File</Text>
          </TouchableOpacity>
          {activeSessionId && (
            <TouchableOpacity
              style={[styles.attachMenuItem, { borderBottomWidth: 0 }]}
              onPress={handleUploadToSandbox}
              disabled={isUploadingToSandbox}
            >
              {isUploadingToSandbox ? (
                <ActivityIndicator size="small" color={COLORS.iconMuted} />
              ) : (
                <NativeIcon name="cloud-upload" size={18} color={COLORS.iconMuted} />
              )}
              <Text style={styles.attachMenuText}>
                {isUploadingToSandbox ? "Uploading..." : "Upload to Sandbox"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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
                  <NativeIcon name="document" size={22} color={COLORS.iconMuted} />
                  <Text style={styles.fileThumbName} numberOfLines={1}>{att.name}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => removeAttachment(i)}
              >
                <NativeIcon name="close-circle" size={18} color="#888888" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Input area */}
      <View style={styles.inputWrapper}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder || "Ask Dzeck AI..."}
          placeholderTextColor={COLORS.textPlaceholder}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
          editable={!disabled}
          onSubmitEditing={Platform.OS === "web" ? handleSend : undefined}
          blurOnSubmit={false}
        />
      </View>

      {/* Bottom toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <TouchableOpacity
            onPress={() => setShowAttachMenu(v => !v)}
            style={styles.toolbarBtn}
            activeOpacity={0.6}
            disabled={disabled}
          >
            <NativeIcon
              name={showAttachMenu ? "close" : "add"}
              size={22}
              color={disabled ? COLORS.textMuted : COLORS.iconMuted}
            />
          </TouchableOpacity>

          {showModeToggle && (
            <TouchableOpacity
              onPress={onToggleMode}
              style={styles.toolbarBtn}
              activeOpacity={0.6}
              disabled={disabled || isGenerating}
            >
              <NativeIcon
                name={isAgentMode ? "flash" : "code"}
                size={20}
                color={isAgentMode ? "#aaaaaa" : COLORS.iconMuted}
              />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.toolbarRight}>
          {isGenerating ? (
            <TouchableOpacity
              onPress={onStop}
              style={styles.toolbarBtn}
              activeOpacity={0.6}
            >
              <View style={styles.stopIcon}>
                <NativeIcon name="stop" size={14} color={COLORS.stopIcon} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSend}
              style={[styles.toolbarBtn, !canSend && styles.sendButtonDisabled]}
              activeOpacity={0.6}
              disabled={!canSend}
            >
              <View
                style={[
                  styles.sendIconContainer,
                  !canSend && styles.sendIconDisabled,
                ]}
              >
                <NativeIcon name="arrow-up" size={16} color="#FFFFFF" />
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
  attachMenu: {
    backgroundColor: "#242424",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
    overflow: "hidden",
  },
  attachMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  attachMenuText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: "500",
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
    width: 80,
    height: 60,
    borderRadius: 10,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    gap: 2,
  },
  fileThumbName: {
    fontSize: 9,
    color: COLORS.textMuted,
    textAlign: "center",
  },
  removeAttachment: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: COLORS.bgToolbar,
    borderRadius: 9,
  },
  inputWrapper: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: Platform.OS === "ios" ? 6 : 4,
    maxHeight: 120,
    marginBottom: 4,
    marginTop: 6,
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
    gap: 2,
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  toolbarBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#3a3a3a",
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
