import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Dimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import { LeftPanel } from "./LeftPanel";
import { ChatPage } from "./ChatPage";
import { ToolPanel } from "./ToolPanel";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ToolItem {
  tool_call_id: string;
  name: string;
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
          />
        </View>

        {/* Tool Panel - Right Side */}
        <View style={[styles.toolPanel, { width: toolPanelWidth }]}>
          <ToolPanel
            tools={tools}
            isVisible={isToolPanelVisible}
            onToggleVisible={() => setIsToolPanelVisible(v => !v)}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0C",
  },
  mainContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#0A0A0C",
  },
  leftPanel: {
    backgroundColor: "#111116",
    borderRightWidth: 1,
    borderRightColor: "#1E1E26",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    backgroundColor: "#0A0A0C",
    minWidth: 0,
  },
  toolPanel: {
    backgroundColor: "#0D0D12",
    borderLeftWidth: 1,
    borderLeftColor: "#1E1E26",
    overflow: "hidden",
  },
});
