import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import { TOOL_ICON_MAP as CONST_TOOL_ICON_MAP, getToolCategory, TOOL_FUNCTION_MAP } from "@/lib/tool-constants";
import { ToolPanelContent } from "./ToolPanelContent";
import type { ToolContent } from "@/lib/chat";

export interface ToolItem {
  tool_call_id: string;
  name: string;
  function_name?: string;
  status: "calling" | "called" | "error";
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  tool_content?: ToolContent;
}

interface ToolPanelProps {
  tools?: ToolItem[];
  isVisible?: boolean;
  onToggleVisible?: () => void;
  sessionId?: string;
  onSwitchToBrowser?: () => void;
  onTakeOver?: () => void;
  /** When set externally (e.g. from chat tool-card click), pins this tool and exits live-follow mode */
  externalToolId?: string | null;
  /** Active VNC session for live desktop streaming in browser tool view */
  agentVncSession?: { e2bSessionId?: string; vncUrl?: string } | null;
  /** If true, render as full-screen Modal overlay (mobile behavior) instead of inline slide-in */
  isMobile?: boolean;
}

function getToolIcon(name: string): string {
  const category = getToolCategory(name);
  return CONST_TOOL_ICON_MAP[category] || "settings-outline";
}

function getStatusColor(status: ToolItem["status"]): string {
  switch (status) {
    case "calling": return "#4a7cf0";
    case "called": return "#4CAF50";
    case "error": return "#e05c5c";
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
  onTakeOver,
  externalToolId,
  agentVncSession,
  isMobile = false,
}: ToolPanelProps) {
  // Slide-in animation (from right, ai-manus style 0.2s ease-in-out)
  // animVisible tracks whether we should still render the full panel during the exit animation
  const slideAnim = useRef(new Animated.Value(isVisible ? 0 : 1)).current;
  const [animVisible, setAnimVisible] = useState(isVisible);

  useEffect(() => {
    if (isVisible) {
      setAnimVisible(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setAnimVisible(false);
      });
    }
  }, [isVisible]);

  // "live follow" mode: when true, always show the latest completed tool
  const [liveFollow, setLiveFollow] = useState(true);
  // manually pinned tool id when user taps a specific one
  const [pinnedToolId, setPinnedToolId] = useState<string | null>(null);

  // Respond to external tool selection (e.g. from chat message tool-card tap)
  useEffect(() => {
    if (externalToolId) {
      setLiveFollow(false);
      setPinnedToolId(externalToolId);
    }
  }, [externalToolId]);

  // All tools including currently calling ones
  const allTools = tools;
  // Latest completed (non-calling) tool id
  const latestDoneId = [...allTools].reverse().find(t => t.status === "called" || t.status === "error")?.tool_call_id ?? null;
  // Latest tool overall (may be "calling")
  const latestCallingTool = [...allTools].reverse().find(t => t.status === "calling") ?? null;

  // Which tool to show in the detail pane
  // In live mode: prefer the currently calling tool, then fall back to latest done
  // In pinned mode: use the pinned tool id
  const selectedToolId: string | null = liveFollow
    ? (latestCallingTool?.tool_call_id ?? latestDoneId)
    : pinnedToolId;

  const selectedTool = allTools.find(t => t.tool_call_id === selectedToolId) ?? null;

  // When a new tool completes and we're in live mode, track to latest id
  // (no useEffect needed — liveFollow logic resolves it in render)

  // Completed (non-calling) tools for the list display
  const completedTools = allTools.filter(t => t.status !== "calling");

  // Is user looking at an older tool while a newer one exists?
  const isViewingHistory = !liveFollow && pinnedToolId !== null && pinnedToolId !== (latestCallingTool?.tool_call_id ?? latestDoneId);

  const handleSelectTool = (toolId: string) => {
    const currentLiveId = latestCallingTool?.tool_call_id ?? latestDoneId;
    if (toolId === currentLiveId) {
      // tapping the live/latest — enter live follow mode
      setLiveFollow(true);
      setPinnedToolId(null);
    } else {
      // tapping a historical tool — pin it, exit live follow
      setLiveFollow(false);
      setPinnedToolId(toolId);
    }
  };

  const jumpToLive = () => {
    setLiveFollow(true);
    setPinnedToolId(null);
  };

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 60],
  });
  const opacity = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  if (!animVisible) {
    return (
      <TouchableOpacity
        style={styles.collapsedContainer}
        onPress={onToggleVisible}
        activeOpacity={0.7}
      >
        <NativeIcon name="chevron-back" size={16} color="#636366" />
      </TouchableOpacity>
    );
  }

  // Shared panel body used in both desktop (Animated.View) and mobile (Modal) paths
  const panelBody = (
    <>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NativeIcon name="terminal-outline" size={14} color="#888888" />
          <Text style={styles.headerTitle}>Tools</Text>
          {completedTools.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{completedTools.length}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.collapseButton}
          onPress={onToggleVisible}
          activeOpacity={0.7}
        >
          <NativeIcon name="chevron-forward" size={16} color="#636366" />
        </TouchableOpacity>
      </View>

      {/* Tools List */}
      <ScrollView
        style={styles.toolsList}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.toolsListContent}
      >
        {completedTools.length === 0 ? (
          <View style={styles.emptyState}>
            <NativeIcon name="terminal-outline" size={28} color="#2A2A32" />
            <Text style={styles.emptyStateTitle}>Belum ada tools</Text>
            <Text style={styles.emptyStateText}>
              Tools digunakan saat agen menjalankan tugas
            </Text>
          </View>
        ) : (
          completedTools.map((tool) => {
            const fnName = tool.function_name || tool.name;
            return (
              <TouchableOpacity
                key={tool.tool_call_id}
                style={[
                  styles.toolItem,
                  selectedToolId === tool.tool_call_id && styles.toolItemSelected,
                ]}
                onPress={() => handleSelectTool(tool.tool_call_id)}
                activeOpacity={0.7}
              >
                <View style={styles.toolIcon}>
                  <NativeIcon
                    name={getToolIcon(fnName)}
                    size={14}
                    color="#636366"
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
                    {tool.status === "called" && (
                      <Text style={[styles.toolStatus, { color: "#4CAF50", marginRight: 2 }]}>✓</Text>
                    )}
                    {tool.status === "error" && (
                      <Text style={[styles.toolStatus, { color: "#e05c5c", marginRight: 2 }]}>✕</Text>
                    )}
                    <Text style={[styles.toolStatus, { color: getStatusColor(tool.status) }]}>
                      {getStatusLabel(tool.status)}
                    </Text>
                  </View>
                </View>
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
            {/* Jump to Live button — shows when viewing history */}
            {isViewingHistory && (
              <TouchableOpacity
                style={styles.jumpToLiveBtn}
                onPress={jumpToLive}
                activeOpacity={0.7}
              >
                <NativeIcon name="play" size={11} color="#FFFFFF" />
                <Text style={styles.jumpToLiveText}>Jump to Live</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.closeDetailBtn}
              onPress={() => { setLiveFollow(false); setPinnedToolId(null); }}
              activeOpacity={0.7}
            >
              <NativeIcon name="close" size={14} color="#636366" />
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
            onMinimize={() => { setLiveFollow(false); setPinnedToolId(null); }}
            onSwitchToBrowser={
              getToolCategory(selectedTool.function_name || selectedTool.name) === "browser"
                ? onSwitchToBrowser
                : undefined
            }
            onTakeOver={
              getToolCategory(selectedTool.function_name || selectedTool.name) === "browser"
                ? onTakeOver
                : undefined
            }
            agentVncSession={
              getToolCategory(selectedTool.function_name || selectedTool.name) === "browser"
                ? agentVncSession
                : undefined
            }
          />
        </View>
      )}
    </>
  );

  // Mobile: full-screen overlay Modal with slide-up transition
  if (isMobile) {
    return (
      <Modal
        visible={isVisible}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
        onRequestClose={onToggleVisible}
        transparent={false}
      >
        <View style={styles.container}>{panelBody}</View>
      </Modal>
    );
  }

  // Desktop/tablet: slide-in from right with Animated.View (0.2s ease-in-out)
  return (
    <Animated.View style={[styles.container, { transform: [{ translateX }], opacity }]}>
      {panelBody}
    </Animated.View>
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
    backgroundColor: "#2a2a2a",
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
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
    gap: 6,
  },
  jumpToLiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#3a3a3a",
    marginRight: "auto",
  },
  jumpToLiveText: {
    fontSize: 11,
    color: "#d1d5db",
    fontWeight: "500",
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
