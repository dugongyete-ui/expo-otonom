import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface ToolItem {
  tool_call_id: string;
  name: string;
  status: "calling" | "called" | "error";
  input?: any;
  output?: string;
  error?: string;
  tool_content?: any;
}

interface ToolPanelProps {
  tools?: ToolItem[];
  isVisible?: boolean;
  onToggleVisible?: () => void;
  sessionId?: string;
}

const TOOL_ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  browser: "globe",
  shell: "terminal",
  file: "document-text",
  search: "search",
  mcp: "extension-puzzle",
};

const TOOL_COLOR_MAP: Record<string, string> = {
  browser: "#007AFF",
  shell: "#30D158",
  file: "#FF9F0A",
  search: "#BF5AF2",
  mcp: "#0A84FF",
};

function getToolIcon(name: string): keyof typeof Ionicons.glyphMap {
  const key = Object.keys(TOOL_ICON_MAP).find(k => name.toLowerCase().includes(k));
  return key ? TOOL_ICON_MAP[key] : "settings-outline";
}

function getToolColor(name: string): string {
  const key = Object.keys(TOOL_COLOR_MAP).find(k => name.toLowerCase().includes(k));
  return key ? TOOL_COLOR_MAP[key] : "#8E8E93";
}

function getStatusColor(status: ToolItem["status"]): string {
  switch (status) {
    case "calling": return "#6C5CE7";
    case "called": return "#30D158";
    case "error": return "#FF453A";
  }
}

function getStatusLabel(status: ToolItem["status"]): string {
  switch (status) {
    case "calling": return "Memproses";
    case "called": return "Selesai";
    case "error": return "Error";
  }
}

export function ToolPanel({
  tools = [],
  isVisible = true,
  onToggleVisible,
}: ToolPanelProps) {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);

  const selectedTool = tools.find(t => t.tool_call_id === selectedToolId) || null;

  if (!isVisible) {
    return (
      <TouchableOpacity
        style={styles.collapsedContainer}
        onPress={onToggleVisible}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={16} color="#636366" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="terminal-outline" size={14} color="#6C5CE7" />
          <Text style={styles.headerTitle}>Tools</Text>
          {tools.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{tools.length}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.collapseButton}
          onPress={onToggleVisible}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={16} color="#636366" />
        </TouchableOpacity>
      </View>

      {/* Tools List */}
      <ScrollView
        style={styles.toolsList}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.toolsListContent}
      >
        {tools.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={28} color="#2A2A32" />
            <Text style={styles.emptyStateTitle}>Belum ada tools</Text>
            <Text style={styles.emptyStateText}>
              Tools digunakan saat agen menjalankan tugas
            </Text>
          </View>
        ) : (
          tools.map((tool) => (
            <TouchableOpacity
              key={tool.tool_call_id}
              style={[
                styles.toolItem,
                selectedToolId === tool.tool_call_id && styles.toolItemSelected,
              ]}
              onPress={() =>
                setSelectedToolId(
                  selectedToolId === tool.tool_call_id ? null : tool.tool_call_id
                )
              }
              activeOpacity={0.7}
            >
              <View style={[styles.toolIcon, { backgroundColor: `${getToolColor(tool.name)}18` }]}>
                <Ionicons
                  name={getToolIcon(tool.name)}
                  size={14}
                  color={getToolColor(tool.name)}
                />
              </View>
              <View style={styles.toolInfo}>
                <Text style={styles.toolName} numberOfLines={1}>{tool.name}</Text>
                <View style={styles.toolStatusRow}>
                  {tool.status === "calling" && (
                    <ActivityIndicator size="small" color="#6C5CE7" style={styles.spinner} />
                  )}
                  <Text style={[styles.toolStatus, { color: getStatusColor(tool.status) }]}>
                    {getStatusLabel(tool.status)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Tool Details */}
      {selectedTool && (
        <View style={styles.detailContainer}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{selectedTool.name}</Text>
            <TouchableOpacity onPress={() => setSelectedToolId(null)}>
              <Ionicons name="close" size={16} color="#636366" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
            {selectedTool.input && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Input</Text>
                <View style={styles.codeBlock}>
                  <Text style={styles.codeText} selectable>
                    {typeof selectedTool.input === "string"
                      ? selectedTool.input
                      : JSON.stringify(selectedTool.input, null, 2)}
                  </Text>
                </View>
              </View>
            )}

            {selectedTool.output && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Output</Text>
                <View style={styles.codeBlock}>
                  <Text style={styles.codeText} selectable numberOfLines={20}>
                    {selectedTool.output}
                  </Text>
                </View>
              </View>
            )}

            {selectedTool.tool_content?.type === "browser" && selectedTool.tool_content.url && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>URL</Text>
                <Text style={styles.urlText}>{selectedTool.tool_content.url}</Text>
              </View>
            )}

            {selectedTool.error && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Error</Text>
                <View style={[styles.codeBlock, styles.errorBlock]}>
                  <Text style={styles.errorText} selectable>{selectedTool.error}</Text>
                </View>
              </View>
            )}

            {selectedTool.status === "calling" && (
              <View style={styles.runningRow}>
                <ActivityIndicator color="#6C5CE7" size="small" />
                <Text style={styles.runningText}>Sedang dieksekusi...</Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D12",
  },
  collapsedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 16,
    backgroundColor: "#0D0D12",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E26",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#E8E8ED",
  },
  badge: {
    backgroundColor: "rgba(108,92,231,0.2)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#6C5CE7",
  },
  collapseButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A22",
  },
  toolsList: {
    flex: 1,
    maxHeight: "55%",
  },
  toolsListContent: {
    padding: 8,
    gap: 4,
  },
  toolItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#131318",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toolItemSelected: {
    borderColor: "rgba(108,92,231,0.3)",
    backgroundColor: "rgba(108,92,231,0.07)",
  },
  toolIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolInfo: {
    flex: 1,
    gap: 2,
  },
  toolName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#E8E8ED",
  },
  toolStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  spinner: {
    transform: [{ scale: 0.65 }],
  },
  toolStatus: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 6,
    paddingHorizontal: 16,
  },
  emptyStateTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#3A3A45",
    marginTop: 4,
  },
  emptyStateText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#2A2A35",
    textAlign: "center",
    lineHeight: 16,
  },
  detailContainer: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: "#1E1E26",
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E26",
  },
  detailTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#E8E8ED",
  },
  detailScroll: {
    flex: 1,
    padding: 10,
  },
  section: {
    marginBottom: 10,
    gap: 4,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#636366",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  codeBlock: {
    backgroundColor: "#0A0A0F",
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#1E1E26",
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#8E8EA0",
    lineHeight: 15,
  },
  errorBlock: {
    borderColor: "rgba(255,69,58,0.3)",
    backgroundColor: "rgba(255,69,58,0.05)",
  },
  errorText: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#FF453A",
    lineHeight: 15,
  },
  urlText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#007AFF",
    lineHeight: 16,
  },
  runningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  runningText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#6C5CE7",
  },
});
