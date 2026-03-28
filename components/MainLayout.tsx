import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  SafeAreaView,
  TouchableOpacity,
} from "react-native";
import { LeftPanel } from "./LeftPanel";
import { ChatPage } from "./ChatPage";
import { ToolPanel } from "./ToolPanel";
import { BrowserPanel } from "./BrowserPanel";
import { FilePanel } from "./FilePanel";
import { TakeOverView } from "./TakeOverView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
}

const TOOL_PANEL_WIDTH = 280;

export function MainLayout({ sessionId: initialSessionId }: MainLayoutProps) {
  const [isLeftPanelShow, setIsLeftPanelShow] = useState(false);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [isToolPanelVisible, setIsToolPanelVisible] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<"tools" | "browser" | "files">("tools");
  const [showTakeOver, setShowTakeOver] = useState(false);
  const [vncSession, setVncSession] = useState<VncSessionInfo | null>(null);
  const insets = useSafeAreaInsets();

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelShow(v => !v);
  }, []);

  const handleNewSession = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
  }, []);

  const handleToolsChange = useCallback((newTools: ToolItem[]) => {
    setTools(newTools);
  }, []);

  // Auto-switch to browser panel when a browser tool starts executing
  const prevToolsLenRef = useRef(0);
  useEffect(() => {
    if (tools.length > prevToolsLenRef.current) {
      const latestTool = tools[tools.length - 1];
      const fnName = latestTool.function_name || latestTool.name;
      const category = getToolCategory(fnName);
      if (category === "browser" && latestTool.status === "calling") {
        // Auto-switch to browser panel when browser tool is invoked
        setRightPanelMode("browser");
        setIsToolPanelVisible(true);
      }
    }
    prevToolsLenRef.current = tools.length;
  }, [tools]);

  // Get latest browser event from tools for BrowserPanel
  const lastBrowserEvent = tools
    .filter(t => {
      const fn = t.function_name || t.name;
      return getToolCategory(fn) === "browser" && t.tool_content?.type === "browser";
    })
    .pop()?.tool_content || null;

  const handleSwitchToBrowser = useCallback(() => {
    setRightPanelMode("browser");
    setIsToolPanelVisible(true);
  }, []);

  const handleVncSessionChange = useCallback((info: VncSessionInfo | null) => {
    setVncSession(info);
    if (info) {
      // Auto-switch to browser panel when agent creates a desktop sandbox
      setRightPanelMode("browser");
      setIsToolPanelVisible(true);
    }
  }, []);

  const handleTakeOver = useCallback((targetSessionId: string) => {
    setShowTakeOver(true);
  }, []);

  const handleCloseTakeOver = useCallback(() => {
    setShowTakeOver(false);
  }, []);

  const screenWidth = Dimensions.get("window").width;

  const leftPanelWidth = isLeftPanelShow ? (Platform.OS === "web" ? 260 : Math.min(280, screenWidth * 0.75)) : 0;
  const toolPanelWidth = isToolPanelVisible ? TOOL_PANEL_WIDTH : 32;

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

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

        {/* Chat Area */}
        <View style={styles.chatArea}>
          <ChatPage
            sessionId={sessionId}
            isLeftPanelShow={isLeftPanelShow}
            onToggleLeftPanel={toggleLeftPanel}
            onToolsChange={handleToolsChange}
            onVncSessionChange={handleVncSessionChange}
          />
        </View>

        {/* Right Panel - Tools or Browser */}
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
      </View>

      {/* TakeOver Overlay */}
      {showTakeOver && sessionId && (
        <TakeOverView
          sessionId={sessionId}
          onClose={handleCloseTakeOver}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#edebe3",
  },
  mainContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#edebe3",
  },
  leftPanel: {
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderRightColor: "#ddd9d0",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    backgroundColor: "#edebe3",
    minWidth: 0,
  },
  toolPanel: {
    backgroundColor: "#ffffff",
    borderLeftWidth: 1,
    borderLeftColor: "#ddd9d0",
    overflow: "hidden",
  },
  panelSwitcher: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#ddd9d0",
    backgroundColor: "#ffffff",
  },
  switchTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  switchTabActive: {
    borderTopWidth: 2,
    borderTopColor: "#1a1916",
  },
  switchTabText: {
    fontSize: 11,
    color: "#8a8780",
  },
  switchTabTextActive: {
    color: "#1a1916",
  },
});
