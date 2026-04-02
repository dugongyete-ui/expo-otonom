import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TOOL_ICON_MAP as CONST_TOOL_ICON_MAP, TOOL_COLOR_MAP as CONST_TOOL_COLOR_MAP, getToolCategory, TOOL_FUNCTION_MAP } from "@/lib/tool-constants";
import { ToolPanelContent } from "./ToolPanelContent";

export interface ToolItem {
  tool_call_id: string;
  name: string;
  function_name?: string;
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
  onSwitchToBrowser?: () => void;
}

function getToolIcon(name: string): keyof typeof Ionicons.glyphMap {
  const category = getToolCategory(name);
  return CONST_TOOL_ICON_MAP[category] || "settings-outline";
}

function getToolColor(name: string): string {
  const category = getToolCategory(name);
  return CONST_TOOL_COLOR_MAP[category] || "#8E8E93";
}

function getStatusColor(status: ToolItem["status"]): string {
  switch (status) {
    case "calling": return "#4a7cf0";
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
  sessionId,
  onSwitchToBrowser,
}: ToolPanelProps) {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);

  const selectedTool = tools.find(t => t.tool_call_id === selectedToolId) || null;

  // Auto-select the latest "calling" tool so user sees live progress
  useEffect(() => {
    const callingTool = [...tools].reverse().find(t => t.status === "calling");
    if (callingTool && callingTool.tool_call_id !== selectedToolId) {
      setSelectedToolId(callingTool.tool_call_id);
    }
  }, [tools]);

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
          <Ionicons name="terminal-outline" size={14} color="#4a7cf0" />
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
          tools.map((tool) => {
            const fnName = tool.function_name || tool.name;
            return (
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
                <View style={[styles.toolIcon, { backgroundColor: `${getToolColor(fnName)}18` }]}>
                  <Ionicons
                    name={getToolIcon(fnName)}
                    size={14}
                    color={getToolColor(fnName)}
                  />
                </View>
                <View style={styles.toolInfo}>
                  <Text style={styles.toolName} numberOfLines={1}>
                    {TOOL_FUNCTION_MAP[fnName] || TOOL_FUNCTION_MAP[tool.name] || fnName}
                  </Text>
                  <View style={styles.toolStatusRow}>
                    {tool.status === "calling" && (
                      <ActivityIndicator size="small" color="#4a7cf0" style={styles.spinner} />
                    )}
                    <Text style={[styles.toolStatus, { color: getStatusColor(tool.status) }]}>
                      {getStatusLabel(tool.status)}
                    </Text>
                  </View>
                </View>
                {/* Status indicator dot */}
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(tool.status) }]} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Rich Tool Content View */}
      {selectedTool && (
        <View style={styles.detailContainer}>
          <View style={styles.detailHeaderBar}>
            <TouchableOpacity
              style={styles.closeDetailBtn}
              onPress={() => setSelectedToolId(null)}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={14} color="#636366" />
            </TouchableOpacity>
          </View>
          <ToolPanelContent
            toolContent={selectedTool.tool_content || null}
            toolName={selectedTool.name}
            functionName={selectedTool.function_name || selectedTool.name}
            functionArgs={selectedTool.input}
            functionResult={selectedTool.output}
            status={selectedTool.status}
            sessionId={sessionId}
            isLive={selectedTool.status === "calling"}
            onSwitchToBrowser={
              getToolCategory(selectedTool.function_name || selectedTool.name) === "browser"
                ? onSwitchToBrowser
                : undefined
            }
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#242424",
  },
  collapsedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 16,
    backgroundColor: "#242424",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#f3f4f6",
  },
  badge: {
    backgroundColor: "#2a2a2a",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#d1d5db",
  },
  collapseButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a2a2a",
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
    backgroundColor: "transparent",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toolItemSelected: {
    borderColor: "#3a3a3a",
    backgroundColor: "#2a2a2a",
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
    color: "#d1d5db",
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
    color: "#a0a0a0",
    marginTop: 4,
  },
  emptyStateText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#a0a0a0",
    textAlign: "center",
    lineHeight: 16,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  detailContainer: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  detailHeaderBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  closeDetailBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a2a2a",
  },
});
