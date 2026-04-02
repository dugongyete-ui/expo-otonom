import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.language}>{language || "code"}</Text>
        <TouchableOpacity
          onPress={handleCopy}
          style={styles.copyButton}
          activeOpacity={0.7}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={14}
            color={copied ? "#30D158" : "#8E8E93"}
          />
          <Text style={[styles.copyText, copied && styles.copiedText]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.codeScroll}
      >
        <Text style={styles.code} selectable>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#242424",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    marginVertical: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
    backgroundColor: "#2a2a2a",
  },
  language: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#a0a0a0",
    textTransform: "lowercase",
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  copyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#8E8E93",
  },
  copiedText: {
    color: "#30D158",
  },
  codeScroll: {
    padding: 14,
  },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 20,
    color: "#c8c8c8",
  },
});
