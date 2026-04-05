import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Modal,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LeftPanel } from "./LeftPanel";
import { ChatPage } from "./ChatPage";
import { ToolPanel } from "./ToolPanel";
import { BrowserPanel } from "./BrowserPanel";
import { FilePanel } from "./FilePanel";
import { PlanPanel } from "./PlanPanel";
import { TakeOverView } from "./TakeOverView";
import { ChatBox } from "./ChatBox";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CloseIcon } from "@/components/icons/SvgIcon";
import { getToolCategory } from "@/lib/tool-constants";
import type { VncSessionInfo } from "./ChatPage";
import type { AgentPlan } from "@/lib/chat";
import { useAuth } from "@/lib/auth-context";

import type { ToolItem } from "./ToolPanel";

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
  const [rightPanelMode, setRightPanelMode] = useState<"tools" | "browser" | "files" | "plan">("tools");
  const [showTakeOver, setShowTakeOver] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<AgentPlan | null>(null);
  const [planStepNotifyMessages, setPlanStepNotifyMessages] = useState<{ stepId: string; text: string }[]>([]);
  const [planNotifyMessages, setPlanNotifyMessages] = useState<string[]>([]);
  const [isPlanRunning, setIsPlanRunning] = useState(false);
  const [isPlanPanelExpanded, setIsPlanPanelExpanded] = useState(true);
  const hasPlanAutoSwitchedRef = useRef(false);
  const [takeOverE2bSessionId, setTakeOverE2bSessionId] = useState<string | undefined>(undefined);
  const [vncSession, setVncSession] = useState<VncSessionInfo | null>(null);
  const [externalToolId, setExternalToolId] = useState<string | null>(null);
  const [liveBrowserEvent, setLiveBrowserEvent] = useState<{ url?: string; screenshot_b64?: string; title?: string; ts: number } | null>(null);
  const [toolBrowserEventTs, setToolBrowserEventTs] = useState<number>(0);
  const [showToolsModal, setShowToolsModal] = useState(false);
  const [sseFiles, setSseFiles] = useState<Array<{ filename: string; download_url: string; sandbox_path?: string; mime?: string }>>([]);
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Home page input state (greeting page before first session)
  const [homeInput, setHomeInput] = useState("");
  // Persist the submitted home input so ChatPage can auto-send it as the first message
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>(undefined);

  const isNarrowScreen = screenWidth < NARROW_BREAKPOINT;
  const isNarrowScreenRef = useRef(isNarrowScreen);
  useEffect(() => {
    isNarrowScreenRef.current = isNarrowScreen;
  }, [isNarrowScreen]);

  // Home page state: show greeting when no session is active
  const isHomePage = !sessionId;

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelShow(v => !v);
  }, []);

  const handleNewSession = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
  }, []);

  const handleHomeSubmit = useCallback((submittedText?: string) => {
    const text = submittedText ?? homeInput;
    if (!text.trim()) return;
    const newSessionId = `session_${Date.now()}`;
    setChatInitialMessage(text.trim());
    setSessionId(newSessionId);
  }, [homeInput]);

  const toolsRef = useRef<ToolItem[]>([]);
  const handleToolsChange = useCallback((newTools: ToolItem[]) => {
    if (newTools.length === 0 && toolsRef.current.length > 0) {
      setLiveBrowserEvent(null);
      setToolBrowserEventTs(0);
      prevBrowserScreenshotRef.current = null;
      prevBrowserToolIdRef.current = null;
      prevToolsLenRef.current = 0;
    }
    toolsRef.current = newTools;
    setTools(newTools);
  }, []);

  const handleBrowserEventChange = useCallback((event: { url?: string; screenshot_b64?: string; title?: string } | null) => {
    if (event?.screenshot_b64) {
      setLiveBrowserEvent({ ...event, ts: Date.now() });
      if (!isNarrowScreenRef.current) {
        setRightPanelMode("browser");
        setIsToolPanelVisible(true);
      }
    }
  }, []);

  const handlePlanChange = useCallback((
    plan: AgentPlan | null,
    stepNotifyMsgs: { stepId: string; text: string }[],
    notifyMsgs: string[],
    running: boolean,
  ) => {
    setCurrentPlan(plan);
    setPlanStepNotifyMessages(stepNotifyMsgs);
    setPlanNotifyMessages(notifyMsgs);
    setIsPlanRunning(running);
    if (plan && !hasPlanAutoSwitchedRef.current && !isNarrowScreenRef.current) {
      hasPlanAutoSwitchedRef.current = true;
      setRightPanelMode("plan");
      setIsToolPanelVisible(true);
      setIsPlanPanelExpanded(true);
    }
    if (!plan) {
      hasPlanAutoSwitchedRef.current = false;
    }
  }, []);

  const prevToolsLenRef = useRef(0);
  const prevBrowserToolIdRef = useRef<string | null>(null);
  const prevBrowserScreenshotRef = useRef<string | null>(null);

  useEffect(() => {
    const isNewTool = tools.length > prevToolsLenRef.current;
    prevToolsLenRef.current = tools.length;

    const latestBrowserWithScreenshot = [...tools]
      .reverse()
      .find(t => {
        const fn = t.function_name || t.name;
        return getToolCategory(fn) === "browser" && t.tool_content?.screenshot_b64;
      });
    if (latestBrowserWithScreenshot) {
      const shot = latestBrowserWithScreenshot.tool_content?.screenshot_b64;
      if (shot !== prevBrowserScreenshotRef.current) {
        prevBrowserScreenshotRef.current = shot;
        setToolBrowserEventTs(Date.now());
      }
    }

    if (isNarrowScreenRef.current) return;

    if (isNewTool && tools.length > 0) {
      const latestTool = tools[tools.length - 1];
      const fnName = latestTool.function_name || latestTool.name;
      const category = getToolCategory(fnName);
      if (category === "browser" && latestTool.status === "calling") {
        prevBrowserToolIdRef.current = latestTool.tool_call_id;
        setRightPanelMode("browser");
        setIsToolPanelVisible(true);
      }
    }

    if (latestBrowserWithScreenshot) {
      if (latestBrowserWithScreenshot.tool_call_id !== prevBrowserToolIdRef.current) {
        prevBrowserToolIdRef.current = latestBrowserWithScreenshot.tool_call_id;
        setRightPanelMode("browser");
        setIsToolPanelVisible(true);
      }
    }
  }, [tools]);

  const rawToolBrowserEvent = tools
    .filter(t => {
      const fn = t.function_name || t.name;
      return getToolCategory(fn) === "browser" && t.tool_content?.type === "browser";
    })
    .pop()?.tool_content || null;

  const lastBrowserEvent = (() => {
    if (!liveBrowserEvent && !rawToolBrowserEvent) return null;
    if (!liveBrowserEvent) return rawToolBrowserEvent;
    if (!rawToolBrowserEvent?.screenshot_b64) return liveBrowserEvent;
    return liveBrowserEvent.ts >= toolBrowserEventTs
      ? liveBrowserEvent
      : rawToolBrowserEvent;
  })();

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

  const handleSelectTool = useCallback((toolCallId: string) => {
    setExternalToolId(toolCallId);
    setRightPanelMode("tools");
    setIsToolPanelVisible(true);
    if (isNarrowScreenRef.current) {
      setShowToolsModal(true);
    }
  }, []);

  const handleToolPanelTakeOver = useCallback(() => {
    const e2bId = vncSession?.e2bSessionId || sessionId;
    if (e2bId) handleTakeOver(e2bId);
  }, [vncSession, sessionId, handleTakeOver]);

  const leftPanelWidth = isLeftPanelShow ? (Platform.OS === "web" ? 260 : Math.min(280, screenWidth * 0.75)) : 0;
  const toolPanelWidth = isToolPanelVisible ? TOOL_PANEL_WIDTH : 32;

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  const activeToolsCount = tools.filter(t => t.status === "calling").length;
  const totalToolsCount = tools.length;

  // User display name
  const userName = user?.fullname || user?.email?.split("@")[0] || "User";
  const avatarLetter = userName.charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
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
              onNewSession={(newId) => {
                handleNewSession(newId);
                setIsLeftPanelShow(false);
              }}
            />
          </View>
        )}

        {/* Main Content Area */}
        <View style={styles.chatArea}>
          {isHomePage ? (
            /* Home Page - ai-manus greeting layout */
            <View style={styles.homeContainer}>
              {/* Greeting area — clean, no top bar (ai-manus minimal home style) */}
              <ScrollView
                style={styles.homeScroll}
                contentContainerStyle={styles.homeScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.greetingBlock}>
                  <Text style={styles.greetingText}>Hello, {userName}</Text>
                  <Text style={styles.greetingSubText}>What can I do for you?</Text>
                </View>

                {/* ChatBox */}
                <View style={styles.homeChatBoxWrap}>
                  <ChatBox
                    value={homeInput}
                    onChangeText={setHomeInput}
                    onSubmit={() => handleHomeSubmit(homeInput)}
                    isLoading={false}
                    isAgentMode={true}
                    placeholder="Give Manus a task to work on..."
                  />
                </View>
              </ScrollView>
            </View>
          ) : (
            /* Chat Page */
            <ChatPage
              sessionId={sessionId}
              isAgentMode={isAgentMode}
              onAgentModeChange={setIsAgentMode}
              isLeftPanelShow={isLeftPanelShow}
              onToggleLeftPanel={toggleLeftPanel}
              onToolsChange={handleToolsChange}
              onVncSessionChange={handleVncSessionChange}
              onBrowserEventChange={handleBrowserEventChange}
              onSessionFilesChange={setSseFiles}
              onOpenTools={isNarrowScreen ? handleOpenTools : undefined}
              toolsCount={totalToolsCount}
              activeToolsCount={activeToolsCount}
              onPlanChange={handlePlanChange}
              onSelectTool={handleSelectTool}
              initialMessage={chatInitialMessage}
            />
          )}
        </View>

        {/* Right Panel - only on wide screens */}
        {!isNarrowScreen && !isHomePage && (
          <View style={[styles.toolPanel, { width: toolPanelWidth }]}>
            {rightPanelMode === "tools" ? (
              <ToolPanel
                tools={tools}
                isVisible={isToolPanelVisible}
                onToggleVisible={() => setIsToolPanelVisible(v => !v)}
                sessionId={sessionId}
                onSwitchToBrowser={handleSwitchToBrowser}
                onTakeOver={handleToolPanelTakeOver}
                externalToolId={externalToolId}
                agentVncSession={vncSession}
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
            ) : rightPanelMode === "plan" && currentPlan ? (
              <PlanPanel
                plan={currentPlan}
                stepNotifyMessages={planStepNotifyMessages}
                notifyMessages={planNotifyMessages}
                isRunning={isPlanRunning}
                isVisible={isPlanPanelExpanded}
                onToggleVisible={() => setIsPlanPanelExpanded(v => !v)}
              />
            ) : (
              <FilePanel
                sessionId={sessionId}
                isVisible={isToolPanelVisible}
                sseFiles={sseFiles}
              />
            )}
            {isToolPanelVisible && (
              <View style={styles.panelSwitcher}>
                {/* Tool panel tab switcher — ai-manus style tabs */}
                <TouchableOpacity
                  style={[
                    styles.switchTab,
                    rightPanelMode === "tools" && styles.switchTabActive,
                  ]}
                  onPress={() => setRightPanelMode("tools")}
                  activeOpacity={0.7}
                >
                  <View style={styles.switchTabInner}>
                    <Ionicons
                      name="terminal-outline"
                      size={12}
                      color={rightPanelMode === "tools" ? "#1A1A1A" : "#9CA3AF"}
                    />
                    <Text style={[
                      styles.switchTabText,
                      rightPanelMode === "tools" && styles.switchTabTextActive,
                    ]}>Tools</Text>
                  </View>
                </TouchableOpacity>
                {currentPlan && (
                  <TouchableOpacity
                    style={[
                      styles.switchTab,
                      rightPanelMode === "plan" && styles.switchTabActive,
                    ]}
                    onPress={() => { setRightPanelMode("plan"); setIsPlanPanelExpanded(true); }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.switchTabInner}>
                      <Ionicons
                        name="list-outline"
                        size={12}
                        color={rightPanelMode === "plan" ? "#1A1A1A" : "#9CA3AF"}
                      />
                      <Text style={[
                        styles.switchTabText,
                        rightPanelMode === "plan" && styles.switchTabTextActive,
                      ]}>Plan</Text>
                      {isPlanRunning && <View style={styles.liveIndicator} />}
                    </View>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[
                    styles.switchTab,
                    rightPanelMode === "browser" && styles.switchTabActive,
                  ]}
                  onPress={() => setRightPanelMode("browser")}
                  activeOpacity={0.7}
                >
                  <View style={styles.switchTabInner}>
                    <Ionicons
                      name="globe-outline"
                      size={12}
                      color={rightPanelMode === "browser" ? "#1A1A1A" : "#9CA3AF"}
                    />
                    <Text style={[
                      styles.switchTabText,
                      rightPanelMode === "browser" && styles.switchTabTextActive,
                    ]}>Browser</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.switchTab,
                    rightPanelMode === "files" && styles.switchTabActive,
                  ]}
                  onPress={() => setRightPanelMode("files")}
                  activeOpacity={0.7}
                >
                  <View style={styles.switchTabInner}>
                    <Ionicons
                      name="document-text-outline"
                      size={12}
                      color={rightPanelMode === "files" ? "#1A1A1A" : "#9CA3AF"}
                    />
                    <Text style={[
                      styles.switchTabText,
                      rightPanelMode === "files" && styles.switchTabTextActive,
                    ]}>Files</Text>
                  </View>
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
          presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
          onRequestClose={handleCloseToolsModal}
        >
          <View style={[styles.toolsModalContainer, {
            paddingTop: Platform.OS === "android" ? insets.top : 0,
            paddingBottom: insets.bottom,
          }]}>
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
                {currentPlan && (
                  <TouchableOpacity
                    style={[styles.modalTab, rightPanelMode === "plan" && styles.modalTabActive]}
                    onPress={() => { setRightPanelMode("plan"); setIsPlanPanelExpanded(true); }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.switchTabInner}>
                      <Text style={[styles.modalTabText, rightPanelMode === "plan" && styles.modalTabTextActive]}>
                        Plan
                      </Text>
                      {isPlanRunning && <View style={styles.liveIndicator} />}
                    </View>
                  </TouchableOpacity>
                )}
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
                <CloseIcon size={20} color="#6b7280" />
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
                  onTakeOver={handleToolPanelTakeOver}
                  externalToolId={externalToolId}
                  agentVncSession={vncSession}
                />
              ) : rightPanelMode === "plan" && currentPlan ? (
                <PlanPanel
                  plan={currentPlan}
                  stepNotifyMessages={planStepNotifyMessages}
                  notifyMessages={planNotifyMessages}
                  isRunning={isPlanRunning}
                  isVisible={isPlanPanelExpanded}
                  onToggleVisible={() => setIsPlanPanelExpanded(v => !v)}
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
                  sseFiles={sseFiles}
                />
              )}
            </View>
          </View>
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
    backgroundColor: "#F0EEE6",
  },
  mainContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#F0EEE6",
  },
  leftPanel: {
    backgroundColor: "#F5F4EF",
    borderRightWidth: 1,
    borderRightColor: "#E5E3DC",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    backgroundColor: "#F0EEE6",
    minWidth: 0,
  },
  homeContainer: {
    flex: 1,
    backgroundColor: "#F0EEE6",
  },
  homeTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  homeTopBarBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  homeTopBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  homeScroll: {
    flex: 1,
  },
  homeScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 80,
    paddingBottom: 32,
    justifyContent: "flex-start",
  },
  greetingBlock: {
    paddingLeft: 2,
    marginBottom: 28,
  },
  greetingText: {
    fontSize: 34,
    lineHeight: 42,
    color: "#1A1A1A",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    letterSpacing: -0.5,
  },
  greetingSubText: {
    fontSize: 34,
    lineHeight: 42,
    color: "#C4C2BA",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    letterSpacing: -0.5,
  },
  homeChatBoxWrap: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  toolPanel: {
    backgroundColor: "#F5F4EF",
    borderLeftWidth: 1,
    borderLeftColor: "#E5E3DC",
    overflow: "hidden",
  },
  panelSwitcher: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#E5E3DC",
    backgroundColor: "#F5F4EF",
  },
  switchTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  switchTabActive: {
    borderTopWidth: 2,
    borderTopColor: "#1A1A1A",
  },
  switchTabText: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  switchTabTextActive: {
    color: "#1A1A1A",
  },
  toolsModalContainer: {
    flex: 1,
    backgroundColor: "#F5F4EF",
  },
  toolsModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#F5F4EF",
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
    backgroundColor: "#E5E3DC",
  },
  modalTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#9CA3AF",
  },
  modalTabTextActive: {
    color: "#1A1A1A",
  },
  toolsModalClose: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E3DC",
    marginLeft: 8,
  },
  toolsModalContent: {
    flex: 1,
  },
  switchTabInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#3B82F6",
  },
});
