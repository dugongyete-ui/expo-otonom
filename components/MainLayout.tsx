import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  SafeAreaView,
  TouchableOpacity,
  Modal,
  useWindowDimensions,
} from "react-native";
import { LeftPanel } from "./LeftPanel";
import { ChatPage } from "./ChatPage";
import { ToolPanel } from "./ToolPanel";
import { BrowserPanel } from "./BrowserPanel";
import { FilePanel } from "./FilePanel";
import { TakeOverView } from "./TakeOverView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getToolCategory } from "@/lib/tool-constants";
import type { VncSessionInfo } from "./ChatPage";

interface ToolItem {
  tool_call_id: string;
  name: string;
  function_name?: string;
  status: "calling" | "called" | "error";
  input?: any;
  output?: string;
  error?: string;
  tool_content?: any;
}

interface MainLayoutProps {
  sessionId?: string;
  isAgentMode?: boolean;
}

const TOOL_PANEL_WIDTH = 280;
const NARROW_BREAKPOINT = 768;

export function MainLayout({ sessionId: initialSessionId, isAgentMode: isAgentModeProp = false }: MainLayoutProps) {
  const [isLeftPanelShow, setIsLeftPanelShow] = useState(false);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [isAgentMode, setIsAgentMode] = useState(isAgentModeProp);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [isToolPanelVisible, setIsToolPanelVisible] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<"tools" | "browser" | "files">("tools");
  const [showTakeOver, setShowTakeOver] = useState(false);
  const [takeOverE2bSessionId, setTakeOverE2bSessionId] = useState<string | undefined>(undefined);
  const [vncSession, setVncSession] = useState<VncSessionInfo | null>(null);
  const [liveBrowserEvent, setLiveBrowserEvent] = useState<{ url?: string; screenshot_b64?: string; title?: string } | null>(null);
  const [showToolsModal, setShowToolsModal] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isNarrowScreen = screenWidth < NARROW_BREAKPOINT;

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelShow(v => !v);
  }, []);

  const handleNewSession = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
  }, []);

  const handleToolsChange = useCallback((newTools: ToolItem[]) => {
    setTools(newTools);
  }, []);

  const handleBrowserEventChange = useCallback((event: { url?: string; screenshot_b64?: string; title?: string } | null) => {
    if (event?.screenshot_b64) {
      setLiveBrowserEvent(event);
      if (!isNarrowScreen) {
        setRightPanelMode("browser");
        setIsToolPanelVisible(true);
      }
    }
  }, [isNarrowScreen]);

  const prevToolsLenRef = useRef(0);
  useEffect(() => {
    if (tools.length > prevToolsLenRef.current) {
      const latestTool = tools[tools.length - 1];
      const fnName = latestTool.function_name || latestTool.name;
      const category = getToolCategory(fnName);
      if (category === "browser" && latestTool.status === "calling" && !isNarrowScreen) {
        setRightPanelMode("browser");
        setIsToolPanelVisible(true);
      }
    }
    prevToolsLenRef.current = tools.length;
  }, [tools, isNarrowScreen]);

  const toolBrowserEvent = tools
    .filter(t => {
      const fn = t.function_name || t.name;
      return getToolCategory(fn) === "browser" && t.tool_content?.type === "browser";
    })
    .pop()?.tool_content || null;

  const lastBrowserEvent = liveBrowserEvent ?? toolBrowserEvent;

  const handleSwitchToBrowser = useCallback(() => {
    setRightPanelMode("browser");
    if (!isNarrowScreen) setIsToolPanelVisible(true);
  }, [isNarrowScreen]);

  const handleVncSessionChange = useCallback((info: VncSessionInfo | null) => {
    setVncSession(info);
    if (info && !isNarrowScreen) {
      setRightPanelMode("browser");
      setIsToolPanelVisible(true);
    }
  }, [isNarrowScreen]);

  const handleTakeOver = useCallback((e2bSessionId: string) => {
    setTakeOverE2bSessionId(e2bSessionId || undefined);
    setShowTakeOver(true);
  }, []);

  const handleCloseTakeOver = useCallback(() => {
    setShowTakeOver(false);
  }, []);

  const handleOpenTools = useCallback(() => {
    setShowToolsModal(true);
  }, []);

  const handleCloseToolsModal = useCallback(() => {
    setShowToolsModal(false);
  }, []);

  const leftPanelWidth = isLeftPanelShow ? (Platform.OS === "web" ? 260 : Math.min(280, screenWidth * 0.75)) : 0;
  const toolPanelWidth = isToolPanelVisible ? TOOL_PANEL_WIDTH : 32;

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  const activeToolsCount = tools.filter(t => t.status === "calling").length;
  const totalToolsCount = tools.length;

  return (
    <SafeAreaView style={styles.container}>
      <View
        style={[
          styles.mainContainer,
          Platform.OS === "web" && {
            paddingTop: webTopInset,
            paddingBottom: webBottomInset,
          },
        ]}
      >
        {/* Left Panel - Session List */}
        {isLeftPanelShow && (
          <View
            style={[
              styles.leftPanel,
              { width: leftPanelWidth },
            ]}
          >
            <LeftPanel
              isOpen={isLeftPanelShow}
              onToggle={toggleLeftPanel}
              onNewSession={handleNewSession}
            />
          </View>
        )}

        {/* Chat Area - full width on narrow screens */}
        <View style={styles.chatArea}>
          <ChatPage
            sessionId={sessionId}
            isAgentMode={isAgentMode}
            onAgentModeChange={setIsAgentMode}
            isLeftPanelShow={isLeftPanelShow}
            onToggleLeftPanel={toggleLeftPanel}
            onToolsChange={handleToolsChange}
            onVncSessionChange={handleVncSessionChange}
            onBrowserEventChange={handleBrowserEventChange}
            onOpenTools={isNarrowScreen ? handleOpenTools : undefined}
            toolsCount={totalToolsCount}
            activeToolsCount={activeToolsCount}
          />
        </View>

        {/* Right Panel - only on wide screens */}
        {!isNarrowScreen && (
          <View style={[styles.toolPanel, { width: toolPanelWidth }]}>
            {rightPanelMode === "tools" ? (
              <ToolPanel
                tools={tools}
                isVisible={isToolPanelVisible}
                onToggleVisible={() => setIsToolPanelVisible(v => !v)}
                sessionId={sessionId}
                onSwitchToBrowser={handleSwitchToBrowser}
              />
            ) : rightPanelMode === "browser" ? (
              <BrowserPanel
                isVisible={isToolPanelVisible}
                onToggleVisible={() => setIsToolPanelVisible(v => !v)}
                agentSessionId={sessionId}
                lastBrowserEvent={lastBrowserEvent}
                onTakeOver={handleTakeOver}
                agentVncSession={vncSession}
                vncViewerActive={Platform.OS !== "web" && !!vncSession}
              />
            ) : (
              <FilePanel
                sessionId={sessionId}
                isVisible={isToolPanelVisible}
              />
            )}
            {isToolPanelVisible && (
              <View style={styles.panelSwitcher}>
                <TouchableOpacity
                  style={[
                    styles.switchTab,
                    rightPanelMode === "tools" && styles.switchTabActive,
                  ]}
                  onPress={() => setRightPanelMode("tools")}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.switchTabText,
                    rightPanelMode === "tools" && styles.switchTabTextActive,
                  ]}>Tools</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.switchTab,
                    rightPanelMode === "browser" && styles.switchTabActive,
                  ]}
                  onPress={() => setRightPanelMode("browser")}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.switchTabText,
                    rightPanelMode === "browser" && styles.switchTabTextActive,
                  ]}>Browser</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.switchTab,
                    rightPanelMode === "files" && styles.switchTabActive,
                  ]}
                  onPress={() => setRightPanelMode("files")}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.switchTabText,
                    rightPanelMode === "files" && styles.switchTabTextActive,
                  ]}>Files</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Tools Modal for narrow screens */}
      {isNarrowScreen && (
        <Modal
          visible={showToolsModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={handleCloseToolsModal}
        >
          <SafeAreaView style={styles.toolsModalContainer}>
            <View style={styles.toolsModalHeader}>
              <View style={styles.toolsModalTabs}>
                <TouchableOpacity
                  style={[styles.modalTab, rightPanelMode === "tools" && styles.modalTabActive]}
                  onPress={() => setRightPanelMode("tools")}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalTabText, rightPanelMode === "tools" && styles.modalTabTextActive]}>
                    Tools{totalToolsCount > 0 ? ` (${totalToolsCount})` : ""}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, rightPanelMode === "browser" && styles.modalTabActive]}
                  onPress={() => setRightPanelMode("browser")}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalTabText, rightPanelMode === "browser" && styles.modalTabTextActive]}>
                    Browser
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, rightPanelMode === "files" && styles.modalTabActive]}
                  onPress={() => setRightPanelMode("files")}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalTabText, rightPanelMode === "files" && styles.modalTabTextActive]}>
                    Files
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.toolsModalClose}
                onPress={handleCloseToolsModal}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.toolsModalContent}>
              {rightPanelMode === "tools" ? (
                <ToolPanel
                  tools={tools}
                  isVisible={true}
                  sessionId={sessionId}
                  onSwitchToBrowser={() => {
                    setRightPanelMode("browser");
                  }}
                />
              ) : rightPanelMode === "browser" ? (
                <BrowserPanel
                  isVisible={true}
                  agentSessionId={sessionId}
                  lastBrowserEvent={lastBrowserEvent}
                  onTakeOver={handleTakeOver}
                  agentVncSession={vncSession}
                  vncViewerActive={Platform.OS !== "web" && !!vncSession}
                />
              ) : (
                <FilePanel
                  sessionId={sessionId}
                  isVisible={true}
                />
              )}
            </View>
          </SafeAreaView>
        </Modal>
      )}

      {/* TakeOver Overlay */}
      {showTakeOver && sessionId && (
        <TakeOverView
          agentSessionId={sessionId}
          e2bSessionId={takeOverE2bSessionId}
          onClose={handleCloseTakeOver}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  mainContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#ffffff",
  },
  leftPanel: {
    backgroundColor: "#f9fafb",
    borderRightWidth: 1,
    borderRightColor: "#e5e7eb",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    backgroundColor: "#ffffff",
    minWidth: 0,
  },
  toolPanel: {
    backgroundColor: "#f9fafb",
    borderLeftWidth: 1,
    borderLeftColor: "#e5e7eb",
    overflow: "hidden",
  },
  panelSwitcher: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  switchTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  switchTabActive: {
    borderTopWidth: 2,
    borderTopColor: "#2563eb",
  },
  switchTabText: {
    fontSize: 11,
    color: "#6b7280",
  },
  switchTabTextActive: {
    color: "#111827",
  },
  toolsModalContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  toolsModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#ffffff",
  },
  toolsModalTabs: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  modalTab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalTabActive: {
    backgroundColor: "#f3f4f6",
  },
  modalTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
  },
  modalTabTextActive: {
    color: "#111827",
  },
  toolsModalClose: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    marginLeft: 8,
  },
  toolsModalContent: {
    flex: 1,
  },
});
