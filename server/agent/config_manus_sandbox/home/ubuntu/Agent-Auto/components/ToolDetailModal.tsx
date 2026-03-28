import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ToolContent } from "@/lib/chat";

interface ToolDetailModalProps {
  visible: boolean;
  onClose: () => void;
  functionName: string;
  functionArgs: Record<string, unknown>;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  status: string;
  toolContent?: ToolContent;
  functionResult?: string;
}

function ShellView({ content }: { content: string }) {
  return (
    <View style={styles.shellContainer}>
      <ScrollView style={styles.shellScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.shellText} selectable>{content || "(no output)"}</Text>
      </ScrollView>
    </View>
  );
}

function SearchView({ results }: { results: { title: string; url: string; snippet?: string }[] }) {
  return (
    <ScrollView style={styles.searchContainer} showsVerticalScrollIndicator={false}>
      {results.slice(0, 10).map((r, i) => (
        <View key={i} style={styles.searchItem}>
          <Text style={styles.searchTitle} numberOfLines={2}>{r.title}</Text>
          <Text style={styles.searchUrl} numberOfLines={1}>{r.url}</Text>
          {r.snippet ? (
            <Text style={styles.searchSnippet} numberOfLines={3}>{r.snippet}</Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function BrowserView({ title, url, content }: { title?: string; url?: string; content?: string }) {
  return (
    <ScrollView style={styles.browserContainer} showsVerticalScrollIndicator={false}>
      {url && (
        <View style={styles.browserBar}>
          <Ionicons name="lock-closed" size={11} color="#34C759" />
          <Text style={styles.browserUrl} numberOfLines={1}>{url}</Text>
        </View>
      )}
      {title && <Text style={styles.browserTitle} numberOfLines={2}>{title}</Text>}
      <Text style={styles.browserContent}>{content || "(page loaded)"}</Text>
    </ScrollView>
  );
}

function FileView({ fileName, content }: { fileName?: string; content?: string }) {
  return (
    <View style={styles.fileContainer}>
      {fileName && (
        <View style={styles.fileHeader}>
          <Ionicons name="document-text-outline" size={13} color="#FFD60A" />
          <Text style={styles.fileName} numberOfLines={1}>{fileName.replace(/^\/home\/ubuntu\//, "")}</Text>
        </View>
      )}
      <ScrollView style={styles.fileScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.fileText} selectable>{content || "(empty)"}</Text>
      </ScrollView>
    </View>
  );
}

function ArgsView({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  if (!entries.length) return null;
  return (
    <View style={styles.argsContainer}>
      <Text style={styles.argsTitle}>Arguments</Text>
      {entries.map(([k, v]) => (
        <View key={k} style={styles.argRow}>
          <Text style={styles.argKey}>{k}</Text>
          <Text style={styles.argVal} numberOfLines={4}>
            {String(v ?? "").slice(0, 300)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ToolDetailModal({
  visible,
  onClose,
  functionName,
  functionArgs,
  label,
  icon,
  iconColor,
  status,
  toolContent,
  functionResult,
}: ToolDetailModalProps) {
  const hasCalled = status === "called" || status === "error";

  const renderContent = () => {
    if (toolContent) {
      if (toolContent.type === "shell" && toolContent.console != null) {
        return <ShellView content={toolContent.console} />;
      }
      if (toolContent.type === "search" && toolContent.results) {
        return <SearchView results={toolContent.results} />;
      }
      if (toolContent.type === "browser") {
        return (
          <BrowserView
            title={toolContent.title}
            url={toolContent.url as string | undefined}
            content={toolContent.content}
          />
        );
      }
      if (toolContent.type === "file" && toolContent.content != null) {
        return (
          <FileView
            fileName={String(functionArgs.file || functionArgs.path || "")}
            content={toolContent.content}
          />
        );
      }
    }
    if (functionResult && hasCalled) {
      return <ShellView content={functionResult.slice(0, 2000)} />;
    }
    return null;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <SafeAreaView style={styles.safeArea}>
            {/* Handle */}
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={[styles.iconCircle, { backgroundColor: `${iconColor}22` }]}>
                  <Ionicons name={icon} size={18} color={iconColor} />
                </View>
                <View>
                  <Text style={styles.headerLabel}>{label}</Text>
                  <Text style={styles.headerStatus}>
                    {status === "calling" ? "Running…" : status === "called" ? "Completed" : "Error"}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            {/* Args */}
            <ArgsView args={functionArgs} />

            {/* Result */}
            {hasCalled && (
              <View style={styles.resultSection}>
                <Text style={styles.resultTitle}>Result</Text>
                {renderContent()}
              </View>
            )}

            {!hasCalled && (
              <View style={styles.waitingSection}>
                <Text style={styles.waitingText}>Executing…</Text>
              </View>
            )}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: "#111115",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.06)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.06)",
  },
  safeArea: {
    padding: 20,
    gap: 14,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  headerStatus: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  argsContainer: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  argsTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  argRow: {
    gap: 3,
  },
  argKey: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
  },
  argVal: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    lineHeight: 18,
  },
  resultSection: {
    gap: 8,
  },
  resultTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  waitingSection: {
    padding: 20,
    alignItems: "center",
  },
  waitingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "rgba(255,255,255,0.35)",
  },
  // Shell
  shellContainer: {
    backgroundColor: "#0C0C10",
    borderRadius: 10,
    padding: 12,
    maxHeight: 280,
    borderWidth: 1,
    borderColor: "rgba(52,199,89,0.15)",
  },
  shellScroll: {
    maxHeight: 256,
  },
  shellText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#34C759",
    lineHeight: 18,
  },
  // Search
  searchContainer: {
    maxHeight: 300,
    gap: 0,
  },
  searchItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    gap: 3,
  },
  searchTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#5AC8FA",
    lineHeight: 18,
  },
  searchUrl: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.3)",
  },
  searchSnippet: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    lineHeight: 17,
    marginTop: 2,
  },
  // Browser
  browserContainer: {
    backgroundColor: "#0D0D12",
    borderRadius: 10,
    padding: 12,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: "rgba(255,159,10,0.15)",
    gap: 8,
  },
  browserBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  browserUrl: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    flex: 1,
  },
  browserTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#FF9F0A",
    lineHeight: 18,
    marginBottom: 6,
  },
  browserContent: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 18,
  },
  // File
  fileContainer: {
    backgroundColor: "#0C0C10",
    borderRadius: 10,
    maxHeight: 280,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,214,10,0.15)",
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  fileName: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#FFD60A",
  },
  fileScroll: {
    maxHeight: 230,
    padding: 12,
  },
  fileText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 18,
  },
});
