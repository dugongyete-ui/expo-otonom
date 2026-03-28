import React, { useState, useRef } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import type { ChatAttachment } from "@/lib/chat";

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
}

export function ChatInput({ onSend, disabled, onStop, isGenerating, placeholder, isAgentMode, onToggleMode, showModeToggle }: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const inputRef = useRef<TextInput>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAttach = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsMultipleSelection: false,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAttachments((prev) => [
          ...prev,
          {
            uri: asset.uri,
            type: "image" as const,
            name: asset.fileName || "image.jpg",
          },
        ]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error("Image picker error:", error);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled;

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
                <Ionicons name="close-circle" size={18} color="#FF453A" />
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
          placeholder={placeholder || "Kirim pesan ke Dzeck AI..."}
          placeholderTextColor="#636366"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
          editable={!disabled}
          onSubmitEditing={Platform.OS === "web" ? handleSend : undefined}
          blurOnSubmit={false}
        />
      </View>

      {/* Bottom toolbar - Manus style */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <TouchableOpacity
            onPress={handleAttach}
            style={styles.toolbarBtn}
            activeOpacity={0.6}
            disabled={disabled}
          >
            <Ionicons
              name="add"
              size={22}
              color={disabled ? "#3A3A40" : "#8E8E93"}
            />
          </TouchableOpacity>

          {showModeToggle && (
            <TouchableOpacity
              onPress={onToggleMode}
              style={styles.toolbarBtn}
              activeOpacity={0.6}
              disabled={disabled || isGenerating}
            >
              <Ionicons
                name={isAgentMode ? "flash" : "git-branch-outline"}
                size={20}
                color={isAgentMode ? "#6C5CE7" : "#8E8E93"}
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
                <Ionicons name="stop" size={14} color="#FFFFFF" />
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
    backgroundColor: "#0A0A0C",
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
    backgroundColor: "#0A0A0C",
    borderRadius: 9,
  },
  inputWrapper: {
    backgroundColor: "#1A1A20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2C2C30",
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    maxHeight: 120,
    marginBottom: 6,
  },
  input: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#FFFFFF",
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
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
    justifyContent: "center",
  },
  sendIconDisabled: {
    backgroundColor: "#2C2C30",
  },
  stopIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FF453A",
    alignItems: "center",
    justifyContent: "center",
  },
});
