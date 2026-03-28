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
  Dimensions,
  Platform,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { getApiUrl } from "@/lib/query-client";
import type { AgentPlan } from "@/lib/chat";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface ComputerViewProps {
  plan?: AgentPlan | null;
  onClose?: () => void;
  visible?: boolean;
}

function LiveIndicator({ connected }: { connected: boolean }) {
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
    <View style={styles.liveRow}>
      <Animated.View
        style={[
          styles.liveDot,
          { opacity: connected ? opacity : 1 },
          { backgroundColor: connected ? "#30D158" : "#636366" },
        ]}
      />
      <Text style={[styles.liveText, { color: connected ? "#FFFFFF" : "#636366" }]}>
        {connected ? "Live" : "Menghubungkan"}
      </Text>
    </View>
  );
}

function PlanBottomBar({ plan }: { plan: AgentPlan }) {
  const [expanded, setExpanded] = useState(false);
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalCount = plan.steps.length;
  const currentStep =
    plan.steps.find((s) => s.status === "running") ||
    plan.steps[plan.steps.length - 1];

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

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
          <Ionicons
            name={completedCount === totalCount ? "checkmark-circle" : "layers-outline"}
            size={15}
            color={completedCount === totalCount ? "#30D158" : "#8E8E93"}
          />
          <Text style={styles.planBarTitle} numberOfLines={1}>
            {currentStep?.description || plan.title || "Menjalankan tugas"}
          </Text>
        </View>
        <View style={styles.planBarRight}>
          <Text style={styles.planBarCount}>{completedCount} / {totalCount}</Text>
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-up"}
            size={13}
            color="#636366"
          />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.planBarSteps}>
          {plan.steps.map((step, i) => (
            <View key={step.id || i} style={styles.planBarStep}>
              <Ionicons
                name={
                  step.status === "completed" ? "checkmark-circle" :
                  step.status === "running" ? "radio-button-on" :
                  step.status === "failed" ? "close-circle" : "radio-button-off"
                }
                size={13}
                color={
                  step.status === "completed" ? "#30D158" :
                  step.status === "running" ? "#6C5CE7" :
                  step.status === "failed" ? "#FF453A" : "#3A3A3F"
                }
              />
              <Text
                style={[
                  styles.planBarStepText,
                  step.status === "completed" && styles.planBarStepDone,
                  step.status === "running" && styles.planBarStepRunning,
                ]}
                numberOfLines={1}
              >
                {step.description}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function VNCViewer({
  isTakeover,
  onConnected,
  onDisconnected,
  onTakeoverChange,
}: {
  isTakeover: boolean;
  onConnected: () => void;
  onDisconnected: () => void;
  onTakeoverChange: (on: boolean) => void;
}) {
  const webviewRef = useRef<any>(null);
  const baseUrl = getApiUrl().replace(/\/$/, "");
  const vncUrl = `${baseUrl}/vnc-view${isTakeover ? "?takeover=1" : ""}`;

  const handleMessage = useCallback(
    (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "vnc_connected") onConnected();
        else if (msg.type === "vnc_disconnected") onDisconnected();
        else if (msg.type === "takeover_enabled") onTakeoverChange(true);
        else if (msg.type === "takeover_released") onTakeoverChange(false);
      } catch {}
    },
    [onConnected, onDisconnected, onTakeoverChange],
  );

  useEffect(() => {
    if (webviewRef.current) {
      const msg = isTakeover ? '{"type":"takeover"}' : '{"type":"release"}';
      webviewRef.current.postMessage(msg);
    }
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
}: {
  plan?: AgentPlan | null;
  onClose?: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [isTakeover, setIsTakeover] = useState(false);

  return (
    <View style={styles.fullContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <SafeAreaView style={styles.fullHeader}>
        <View style={styles.fullHeaderInner}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.fullHeaderCenter}>
            <Ionicons name="desktop-outline" size={16} color="#6C5CE7" />
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
        />
      </View>

      <View style={styles.navBar}>
        <TouchableOpacity style={styles.navBtn} activeOpacity={0.7}>
          <Ionicons name="play-skip-back" size={18} color="#636366" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.takeoverBtn, isTakeover && styles.takeoverBtnActive]}
          onPress={() => setIsTakeover(!isTakeover)}
          activeOpacity={0.75}
        >
          <Ionicons
            name={isTakeover ? "pause-circle-outline" : "hand-left-outline"}
            size={15}
            color={isTakeover ? "#6C5CE7" : "#FFFFFF"}
          />
          <Text style={[styles.takeoverText, isTakeover && styles.takeoverTextActive]}>
            {isTakeover ? "Lepas Kendali" : "Ambil Kendali"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} activeOpacity={0.7}>
          <Ionicons name="play-skip-forward" size={18} color="#636366" />
        </TouchableOpacity>
      </View>

      {plan && plan.steps.length > 0 && <PlanBottomBar plan={plan} />}
    </View>
  );
}

export function ComputerView({ plan, onClose, visible = false }: ComputerViewProps) {
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
            <Ionicons name="desktop-outline" size={14} color="#6C5CE7" />
            <Text style={styles.compactTitle}>Komputer Dzeck</Text>
            <View style={styles.liveBadge}>
              <View style={[styles.liveBadgeDot, connected && styles.liveBadgeDotOn]} />
              <Text style={styles.liveBadgeText}>{connected ? "Live" : "Tap buka"}</Text>
            </View>
          </View>
          <Ionicons name="expand-outline" size={13} color="#636366" />
        </View>
        <View style={styles.compactPreview}>
          <Ionicons name="desktop-outline" size={32} color="#1E1E2A" />
          <Text style={styles.compactPreviewText}>
            Tap untuk buka VNC live
          </Text>
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
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ─── Compact card ─────────────────────────────────────────────────────────
  compactCard: {
    backgroundColor: "#0E0E13",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E1E28",
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
    backgroundColor: "#13131A",
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E28",
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
    color: "#E8E8ED",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(108,92,231,0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(108,92,231,0.25)",
  },
  liveBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#3A3A45",
  },
  liveBadgeDotOn: {
    backgroundColor: "#30D158",
  },
  liveBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: "#6C5CE7",
  },
  compactPreview: {
    height: 100,
    backgroundColor: "#080810",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  compactPreviewText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#3A3A45",
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
    borderColor: "#1E1E2A",
    marginBottom: 8,
    backgroundColor: "#0a0a0f",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0a0a0f",
  },

  // ─── Live indicator ───────────────────────────────────────────────────────
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
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
    paddingVertical: 10,
    backgroundColor: "#0B0B10",
    borderTopWidth: 1,
    borderTopColor: "#1A1A22",
  },
  navBtn: {
    padding: 4,
    width: 34,
    alignItems: "center",
  },
  takeoverBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  takeoverBtnActive: {
    backgroundColor: "rgba(108,92,231,0.18)",
    borderColor: "rgba(108,92,231,0.4)",
  },
  takeoverText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#FFFFFF",
  },
  takeoverTextActive: {
    color: "#6C5CE7",
  },

  // ─── Plan bottom bar ──────────────────────────────────────────────────────
  planBar: {
    backgroundColor: "#0E0E13",
    borderTopWidth: 1,
    borderTopColor: "#1E1E28",
    paddingBottom: 8,
  },
  progressBarTrack: {
    height: 2,
    backgroundColor: "#1A1A22",
  },
  progressBarFill: {
    height: 2,
    backgroundColor: "#6C5CE7",
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
  planBarTitle: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#E8E8ED",
    letterSpacing: -0.2,
  },
  planBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  planBarCount: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#636366",
  },
  planBarSteps: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    gap: 6,
  },
  planBarStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planBarStepText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#636366",
    lineHeight: 17,
  },
  planBarStepDone: { color: "#3A3A45" },
  planBarStepRunning: { color: "#E8E8ED" },
});
