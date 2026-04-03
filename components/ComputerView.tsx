import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  SafeAreaView,
  StatusBar,
  Animated,
  Image,
  ScrollView,
} from "react-native";
import { WebView } from "react-native-webview";
import {
  CloseIcon,
  DesktopIcon,
  ExpandIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronBackIcon,
  ChevronForwardIcon,
  CheckCircleIcon,
  HandIcon,
} from "@/components/icons/SvgIcon";
import { getApiUrl } from "@/lib/query-client";
import type { AgentPlan } from "@/lib/chat";

interface ComputerViewProps {
  plan?: AgentPlan | null;
  onClose?: () => void;
  visible?: boolean;
  agentSessionId?: string;
  lastScreenshot?: string | null;
}

function LiveDot({ connected }: { connected: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!connected) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, connected]);

  return (
    <Animated.View
      style={[
        styles.liveDotInner,
        { opacity: connected ? opacity : 1 },
        { backgroundColor: connected ? "#4CAF50" : "#555555" },
      ]}
    />
  );
}

function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <View style={styles.liveRow}>
      <LiveDot connected={connected} />
      <Text style={[styles.liveText, { color: connected ? "#e0e0e0" : "#888888" }]}>
        {connected ? "Live" : "Menghubungkan"}
      </Text>
    </View>
  );
}

function RunningDot() {
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.8, duration: 500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={[styles.stepDot, { backgroundColor: "#4a7cf0", transform: [{ scale: scaleAnim }] }]} />
  );
}

function StepStatusDot({ status }: { status: string }) {
  if (status === "running") return <RunningDot />;
  if (status === "completed") return <CheckCircleIcon size={14} color="#4CAF50" />;
  if (status === "failed") return <View style={[styles.stepDot, { backgroundColor: "#e05c5c" }]} />;
  return <View style={[styles.stepDot, { backgroundColor: "#444444" }]} />;
}

function PlanBottomBar({
  plan,
  planIndex,
  planCount,
  onPrevPlan,
  onNextPlan,
}: {
  plan: AgentPlan;
  planIndex?: number;
  planCount?: number;
  onPrevPlan?: () => void;
  onNextPlan?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalCount = plan.steps.length;

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

  const isAllDone = plan.status === "completed" || completedCount === totalCount;
  const idx = planIndex ?? 0;
  const count = planCount ?? 1;

  return (
    <View style={styles.planBar}>
      <View style={styles.progressBarTrack}>
        <Animated.View
          style={[
            styles.progressBarFill,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
      <TouchableOpacity
        style={styles.planBarHeader}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.planBarLeft}>
          {isAllDone
            ? <CheckCircleIcon size={14} color="#4CAF50" />
            : <View style={styles.planBarRunningDot} />
          }
          <Text style={styles.planBarTitle} numberOfLines={1}>
            {plan.title || "Menjalankan tugas"}
          </Text>
        </View>
        <View style={styles.planBarRight}>
          {count > 1 && (
            <View style={styles.planNavRow}>
              <TouchableOpacity onPress={onPrevPlan} style={styles.planNavBtn} activeOpacity={0.7}>
                <ChevronBackIcon size={13} color={idx > 0 ? "#a0a0a0" : "#444444"} />
              </TouchableOpacity>
              <Text style={styles.planBarCount}>{idx + 1} / {count}</Text>
              <TouchableOpacity onPress={onNextPlan} style={styles.planNavBtn} activeOpacity={0.7}>
                <ChevronForwardIcon size={13} color={idx < count - 1 ? "#a0a0a0" : "#444444"} />
              </TouchableOpacity>
            </View>
          )}
          {count <= 1 && (
            <Text style={styles.planBarCount}>{completedCount} / {totalCount}</Text>
          )}
          {expanded
            ? <ChevronDownIcon size={13} color="#8a8780" />
            : <ChevronUpIcon size={13} color="#8a8780" />
          }
        </View>
      </TouchableOpacity>
      {expanded && (
        <ScrollView style={styles.planBarSteps} showsVerticalScrollIndicator={false}>
          {plan.steps.map((step, i) => (
            <View key={step.id || i} style={styles.planBarStep}>
              <StepStatusDot status={step.status} />
              <Text
                style={[
                  styles.planBarStepText,
                  step.status === "completed" && styles.planBarStepDone,
                  step.status === "running" && styles.planBarStepRunning,
                  step.status === "failed" && styles.planBarStepFailed,
                ]}
                numberOfLines={2}
              >
                {step.description}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function VNCViewer({
  isTakeover,
  onConnected,
  onDisconnected,
  onTakeoverChange,
  e2bSessionId,
}: {
  isTakeover: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
  onTakeoverChange: (on: boolean) => void;
  e2bSessionId?: string;
}) {
  const webviewRef = useRef<any>(null);
  const baseUrl = getApiUrl().replace(/\/$/, "");

  const queryParams: string[] = [];
  if (isTakeover) queryParams.push("takeover=1");
  if (e2bSessionId) queryParams.push(`session=${e2bSessionId}`);
  const qs = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
  const vncUrl = `${baseUrl}/vnc-view${qs}`;

  const handleMessage = useCallback(
    (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "vnc_connected") onConnected();
        else if (msg.type === "vnc_disconnected") onDisconnected();
        else if (msg.type === "vnc_takeover_changed") onTakeoverChange(!!msg.takeover);
      } catch {}
    },
    [onConnected, onDisconnected, onTakeoverChange],
  );

  const prevTakeoverRef = useRef(isTakeover);
  useEffect(() => {
    if (prevTakeoverRef.current !== isTakeover && webviewRef.current) {
      const msg = isTakeover ? '{"type":"takeover"}' : '{"type":"release"}';
      webviewRef.current.postMessage(msg);
    }
    prevTakeoverRef.current = isTakeover;
  }, [isTakeover]);

  return (
    <WebView
      ref={webviewRef}
      source={{ uri: vncUrl }}
      style={styles.webview}
      onMessage={handleMessage}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mixedContentMode="always"
      originWhitelist={["*"]}
      scalesPageToFit={false}
      scrollEnabled={false}
      bounces={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    />
  );
}

function FullScreenVNC({
  plan,
  onClose,
  agentSessionId,
}: {
  plan?: AgentPlan | null;
  onClose?: () => void;
  agentSessionId?: string;
}) {
  const [connected, setConnected] = useState(false);
  const [isTakeover, setIsTakeover] = useState(false);

  return (
    <View style={styles.fullContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <SafeAreaView style={styles.fullHeader}>
        <View style={styles.fullHeaderInner}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} activeOpacity={0.7}>
            <CloseIcon size={18} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.fullHeaderCenter}>
            <DesktopIcon size={16} color="#888888" />
            <Text style={styles.fullHeaderTitle}>Komputer Dzeck</Text>
          </View>

          <LiveIndicator connected={connected} />
        </View>
      </SafeAreaView>

      <View style={styles.browserViewport}>
        <VNCViewer
          isTakeover={isTakeover}
          onConnected={() => setConnected(true)}
          onDisconnected={() => setConnected(false)}
          onTakeoverChange={setIsTakeover}
          e2bSessionId={agentSessionId}
        />
      </View>

      {/* Bottom nav bar: prev | • Live | next */}
      <View style={styles.navBar}>
        <TouchableOpacity style={styles.navBtn} activeOpacity={0.7}>
          <ChevronBackIcon size={18} color="#8a8780" />
        </TouchableOpacity>

        <View style={styles.navCenterArea}>
          <View style={styles.navLiveRow}>
            <LiveDot connected={connected} />
            <Text style={styles.navLiveText}>Live</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.navBtn} activeOpacity={0.7}>
          <ChevronForwardIcon size={18} color="#8a8780" />
        </TouchableOpacity>
      </View>

      {/* Ambil Kendali button */}
      <View style={styles.takeoverContainer}>
        <TouchableOpacity
          style={[styles.takeoverBtn, isTakeover && styles.takeoverBtnActive]}
          onPress={() => setIsTakeover(!isTakeover)}
          activeOpacity={0.75}
        >
          <HandIcon size={15} color={isTakeover ? "#888888" : "#f3f4f6"} />
          <Text style={[styles.takeoverText, isTakeover && styles.takeoverTextActive]}>
            {isTakeover ? "Lepas Kendali" : "Ambil Kendali"}
          </Text>
        </TouchableOpacity>
      </View>

      {plan && plan.steps.length > 0 && <PlanBottomBar plan={plan} />}
    </View>
  );
}

export function ComputerView({ plan, onClose, visible = false, agentSessionId, lastScreenshot }: ComputerViewProps) {
  const [fullScreen, setFullScreen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isTakeover, setIsTakeover] = useState(false);

  if (!visible && !fullScreen) {
    return (
      <TouchableOpacity
        style={styles.compactCard}
        onPress={() => setFullScreen(true)}
        activeOpacity={0.8}
      >
        <View style={styles.compactHeader}>
          <View style={styles.compactHeaderLeft}>
            <DesktopIcon size={14} color="#888888" />
            <Text style={styles.compactTitle}>Komputer Dzeck</Text>
            <View style={styles.liveBadge}>
              <View style={[styles.liveBadgeDot, connected && styles.liveBadgeDotOn]} />
              <Text style={styles.liveBadgeText}>{connected ? "Live" : "Tap buka"}</Text>
            </View>
          </View>
          <ExpandIcon size={13} color="#8a8780" />
        </View>
        <View style={styles.compactPreview}>
          {lastScreenshot ? (
            <Image
              source={{ uri: lastScreenshot }}
              style={styles.compactScreenshot}
              resizeMode="contain"
            />
          ) : (
            <>
              <DesktopIcon size={32} color="#3a3a3a" />
              <Text style={styles.compactPreviewText}>
                Tap untuk buka VNC live
              </Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <Modal
      visible={fullScreen || visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => { setFullScreen(false); onClose?.(); }}
    >
      <FullScreenVNC
        plan={plan}
        onClose={() => { setFullScreen(false); onClose?.(); }}
        agentSessionId={agentSessionId}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ─── Compact card ─────────────────────────────────────────────────────────
  compactCard: {
    backgroundColor: "#242424",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    overflow: "hidden",
    marginHorizontal: 16,
    marginVertical: 6,
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#2a2a2a",
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  compactHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  compactTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#f3f4f6",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  liveBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#ccc8be",
  },
  liveBadgeDotOn: {
    backgroundColor: "#4CAF50",
  },
  liveBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: "#888888",
  },
  compactPreview: {
    height: 100,
    backgroundColor: "#ece9e1",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  compactPreviewText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#a0a0a0",
  },
  compactScreenshot: {
    width: "100%",
    height: 100,
  },

  // ─── Full screen ──────────────────────────────────────────────────────────
  fullContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  fullHeader: {
    backgroundColor: "#000000",
  },
  fullHeaderInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fullHeaderCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullHeaderTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  browserViewport: {
    flex: 1,
    marginHorizontal: 10,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#3a3a3a",
    marginBottom: 8,
    backgroundColor: "#2a2a2a",
  },
  webview: {
    flex: 1,
    backgroundColor: "#2a2a2a",
  },

  // ─── Live indicator ───────────────────────────────────────────────────────
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },

  // ─── Nav bar ──────────────────────────────────────────────────────────────
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "#141414",
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  navBtn: {
    padding: 4,
    width: 34,
    alignItems: "center",
  },
  navCenterArea: {
    flex: 1,
    alignItems: "center",
  },
  navLiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  navLiveText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#e0e0e0",
  },

  // ─── Takeover button ──────────────────────────────────────────────────────
  takeoverContainer: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: "#141414",
    borderTopWidth: 1,
    borderTopColor: "#1e1e1e",
  },
  takeoverBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#2a2a2a",
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  takeoverBtnActive: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "#2a2a2a",
  },
  takeoverText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#f3f4f6",
  },
  takeoverTextActive: {
    color: "#888888",
  },

  // ─── Plan bottom bar ──────────────────────────────────────────────────────
  planBar: {
    backgroundColor: "#141414",
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
    paddingBottom: 8,
    maxHeight: 240,
  },
  progressBarTrack: {
    height: 2,
    backgroundColor: "#2a2a2a",
  },
  progressBarFill: {
    height: 2,
    backgroundColor: "#4a7cf0",
  },
  planBarHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  planBarLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planBarRunningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4a7cf0",
  },
  planBarTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#f3f4f6",
    letterSpacing: -0.2,
  },
  planBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  planNavRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  planNavBtn: {
    padding: 2,
  },
  planBarCount: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#a0a0a0",
  },
  planBarSteps: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    maxHeight: 150,
  },
  planBarStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  planBarStepText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#666666",
    lineHeight: 17,
  },
  planBarStepDone: { color: "#3a3a3a" },
  planBarStepRunning: { color: "#f3f4f6" },
  planBarStepFailed: { color: "#e05c5c" },
});
