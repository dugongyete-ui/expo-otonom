import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { NativeIcon } from "@/components/icons/SvgIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { e2bService } from "../lib/e2b-service";
import type { E2BSession } from "../lib/e2b-service";
import { VNCViewer } from "./VNCViewer";
import { TakeOverIcon } from "./icons/ToolIcons";
import type { VncSessionInfo } from "./ChatPage";
import { SANDBOX_DESKTOP_WIDTH, SANDBOX_DESKTOP_HEIGHT } from "@/lib/sandbox-constants";

interface BrowserPanelProps {
  isVisible?: boolean;
  onToggleVisible?: () => void;
  agentSessionId?: string;
  lastBrowserEvent?: { url?: string; screenshot_b64?: string; title?: string } | null;
  onTakeOver?: (sessionId: string) => void;
  isLive?: boolean;
  agentVncSession?: VncSessionInfo | null;
  /** If true, a VNCViewer is already actively polling screenshots — suppress BrowserPanel's own polling to avoid double requests. */
  vncViewerActive?: boolean;
}

type SessionState = "idle" | "creating" | "waiting" | "ready" | "error" | "connecting";

export function BrowserPanel({
  isVisible = true,
  onToggleVisible,
  agentSessionId,
  lastBrowserEvent,
  onTakeOver,
  isLive = false,
  agentVncSession,
  vncViewerActive = false,
}: BrowserPanelProps) {
  const insets = useSafeAreaInsets();
  const [isTakeOverActive, setIsTakeOverActive] = useState(false);
  const [useVNC, setUseVNC] = useState(false);
  const [vncConnected, setVncConnected] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [resolution, setResolution] = useState({ width: SANDBOX_DESKTOP_WIDTH, height: SANDBOX_DESKTOP_HEIGHT });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // refreshScreenshot must be declared before any useEffect that depends on it
  const refreshScreenshot = useCallback(async (sid?: string) => {
    const targetId = sid || sessionId;
    if (!targetId) return;
    try {
      const uri = await e2bService.captureScreenshot(targetId);
      setScreenshotUri(uri);
    } catch {
      // Screenshot may not be available yet
    }
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, []);

  // Auto-refresh screenshots when session is ready.
  // Skip if VNCViewer is active (either via useVNC toggle or vncViewerActive prop)
  // to avoid double polling.
  useEffect(() => {
    const shouldSkipPolling = useVNC || vncViewerActive;
    if (sessionState === "ready" && sessionId && !shouldSkipPolling) {
      autoRefreshRef.current = setInterval(() => {
        refreshScreenshot();
      }, 2000);
      return () => {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
          autoRefreshRef.current = null;
        }
      };
    }
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  }, [sessionState, sessionId, useVNC, vncViewerActive, refreshScreenshot]);

  // Auto-connect to agent's sandbox when vnc_stream_url event is received
  useEffect(() => {
    if (agentVncSession && agentVncSession.e2bSessionId) {
      setSessionId(agentVncSession.e2bSessionId);
      setSessionState("connecting");
      setStatusMsg("Menghubungkan ke sandbox agen...");

      e2bService.waitForReady(
        agentVncSession.e2bSessionId,
        20,
        2000,
        (attempt, max) => {
          setStatusMsg(`Menunggu desktop siap... (${attempt}/${max})`);
        },
      ).then((health) => {
        setSessionState("ready");
        setStatusMsg(health?.ready ? "Desktop agen terhubung!" : "Desktop agen aktif");
        refreshScreenshot(agentVncSession.e2bSessionId);
      }).catch(() => {
        setSessionState("ready");
        setStatusMsg("Desktop agen aktif");
      });
    }
  }, [agentVncSession, refreshScreenshot]);

  // Update screenshot from agent browser events — always update, not just when idle
  useEffect(() => {
    if (lastBrowserEvent?.screenshot_b64) {
      setScreenshotUri(lastBrowserEvent.screenshot_b64);
      // Auto-activate panel to show agent's browser without requiring manual session start
      if (sessionState === "idle" || sessionState === "error") {
        setSessionState("ready");
        setStatusMsg("Browser aktif dari agen");
      }
    }
  }, [lastBrowserEvent]);

  const startSession = useCallback(async () => {
    setSessionState("creating");
    setStatusMsg("Membuat Cloud Desktop Sandbox...");
    setErrorMsg("");
    setScreenshotUri(null);

    try {
      const res = { width: SANDBOX_DESKTOP_WIDTH, height: SANDBOX_DESKTOP_HEIGHT };

      const session = await e2bService.createSession({
        resolution: res,
        timeout: 3600,
        startUrl: "https://www.google.com",
      });

      setSessionId(session.session_id);
      setResolution(res);
      setSessionState("waiting");
      setStatusMsg("Menunggu desktop siap...");

      // Poll for readiness
      const health = await e2bService.waitForReady(
        session.session_id,
        30,
        2000,
        (attempt, max) => {
          setStatusMsg(`Menunggu desktop siap... (${attempt}/${max})`);
        },
      );

      if (health && health.ready) {
        setSessionState("ready");
        setStatusMsg("Desktop siap!");
        // Capture initial screenshot
        refreshScreenshot(session.session_id);
      } else {
        setSessionState("error");
        setErrorMsg(health?.error || "Timeout menunggu desktop");
      }
    } catch (err: unknown) {
      setSessionState("error");
      setErrorMsg(err instanceof Error ? err.message : "Gagal membuat session");
    }
  }, [refreshScreenshot]);

  const destroyCurrentSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      await e2bService.destroySession(sessionId);
    } catch {
      // Ignore errors during cleanup
    }
    setSessionId(null);
    setSessionState("idle");
    setStatusMsg("");
    setErrorMsg("");
    setScreenshotUri(null);
  }, [sessionId]);

  const openInBrowser = useCallback(() => {
    if (!sessionId) return;
    if (Platform.OS === "web") {
      const viewerUrl = `/e2b-viewer?session=${sessionId}&takeover=1`;
      window.open(viewerUrl, "_blank");
    } else {
      // Native: open screenshot in system browser or activate takeover
      setIsTakeOverActive(true);
      setUseVNC(true);
    }
  }, [sessionId]);

  const handleTakeOver = useCallback(() => {
    const targetId = sessionId || agentSessionId;
    if (onTakeOver && targetId) {
      // Open TakeOverView modal — it handles VNC internally, don't enable VNC in panel
      setIsTakeOverActive(true);
      onTakeOver(targetId);
    } else if (targetId && Platform.OS === "web") {
      const viewerUrl = `/e2b-viewer?session=${targetId}&takeover=1`;
      window.open(viewerUrl, "_blank");
    } else if (targetId) {
      // Native fallback with no onTakeOver: show fullscreen modal
      setIsTakeOverActive(true);
    }
  }, [sessionId, agentSessionId, onTakeOver]);

  // Toggle between VNC live view and screenshot mode
  const toggleVNCMode = useCallback(() => {
    setUseVNC(prev => !prev);
  }, []);

  if (!isVisible) {
    return (
      <TouchableOpacity
        style={styles.collapsedContainer}
        onPress={onToggleVisible}
        activeOpacity={0.7}
      >
        <NativeIcon name="chevron-back" size={16} color="#888888" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NativeIcon name="desktop" size={14} color="#4a7cf0" />
          <Text style={styles.headerTitle}>Browser</Text>
          {sessionState === "ready" && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>Live</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.collapseButton}
          onPress={onToggleVisible}
          activeOpacity={0.7}
        >
          <NativeIcon name="chevron-forward" size={16} color="#888888" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {sessionState === "idle" && (
          <View style={styles.emptyState}>
            <NativeIcon name="globe" size={32} color="#2A2A32" />
            {agentVncSession ? (
              <>
                <Text style={styles.emptyTitle}>Desktop Agen Aktif</Text>
                <Text style={styles.emptyText}>
                  Agen sedang menggunakan desktop ini. Screenshot akan muncul otomatis saat agen berinteraksi dengan browser.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>Cloud Desktop</Text>
                <Text style={styles.emptyText}>
                  Buat sandbox desktop cloud untuk browser automation secara visual
                </Text>
                <TouchableOpacity
                  style={styles.startButton}
                  onPress={startSession}
                  activeOpacity={0.7}
                >
                  <NativeIcon name="play" size={14} color="#fff" />
                  <Text style={styles.startButtonText}>Mulai Desktop</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {(sessionState === "creating" || sessionState === "waiting" || sessionState === "connecting") && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#4a7cf0" />
            <Text style={styles.loadingText}>{statusMsg}</Text>
          </View>
        )}

        {sessionState === "error" && (
          <View style={styles.errorState}>
            <NativeIcon name="alert-circle" size={32} color="#FF453A" />
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={startSession}
              activeOpacity={0.7}
            >
              <NativeIcon name="refresh" size={14} color="#fff" />
              <Text style={styles.retryButtonText}>Coba Lagi</Text>
            </TouchableOpacity>
          </View>
        )}

        {sessionState === "ready" && (
          <View style={[styles.readyState, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {/* VNC Live View (web only) or Screenshot (native always) */}
            {useVNC && sessionId && Platform.OS === "web" ? (
              <View style={styles.vncContainer}>
                <VNCViewer
                  sessionId={sessionId}
                  enabled={useVNC}
                  viewOnly={!isTakeOverActive}
                  onConnected={() => setVncConnected(true)}
                  onDisconnected={() => setVncConnected(false)}
                />
              </View>
            ) : screenshotUri ? (
              <TouchableOpacity
                style={styles.screenshotContainer}
                onPress={openInBrowser}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: screenshotUri }}
                  style={styles.screenshot}
                  resizeMode="contain"
                />
                <View style={styles.screenshotOverlay}>
                  <NativeIcon name="expand" size={16} color="#fff" />
                  <Text style={styles.screenshotOverlayText}>Buka Fullscreen</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.noScreenshot}>
                <ActivityIndicator size="small" color="#4a7cf0" />
                <Text style={styles.noScreenshotText}>Memuat preview...</Text>
              </View>
            )}

            {/* Session info */}
            <View style={styles.sessionInfo}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Session</Text>
                <Text style={styles.infoValue}>{sessionId}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Resolusi</Text>
                <Text style={styles.infoValue}>{resolution.width}x{resolution.height}</Text>
              </View>
            </View>

            {/* Current URL from agent */}
            {lastBrowserEvent?.url ? (
              <View style={styles.currentUrl}>
                <View style={styles.urlRow}>
                  <NativeIcon name="lock-closed" size={10} color="#34C759" />
                  <Text style={styles.urlText} numberOfLines={1}>{lastBrowserEvent.url}</Text>
                </View>
                {lastBrowserEvent.title ? (
                  <Text style={styles.pageTitle} numberOfLines={1}>{lastBrowserEvent.title}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => refreshScreenshot()}
                activeOpacity={0.7}
              >
                <NativeIcon name="camera" size={14} color="#888888" />
                <Text style={styles.actionText}>Screenshot</Text>
              </TouchableOpacity>

              {/* VNC Toggle - Live view (web) / Screenshot polling (native) */}
              {sessionId && (
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    useVNC && styles.vncActiveBtn,
                  ]}
                  onPress={toggleVNCMode}
                  activeOpacity={0.7}
                >
                  <NativeIcon
                    name={useVNC ? "videocam" : "videocam"}
                    size={14}
                    color={useVNC ? "#FFFFFF" : "#4a7cf0"}
                  />
                  <Text style={[
                    styles.actionText,
                    useVNC && styles.vncActiveText,
                  ]}>{useVNC ? "Live" : "Desktop"}</Text>
                </TouchableOpacity>
              )}

              {/* Take Over / Exit Control button */}
              {isTakeOverActive ? (
                <TouchableOpacity
                  style={[styles.actionButton, styles.takeOverBtn]}
                  onPress={() => { setIsTakeOverActive(false); }}
                  activeOpacity={0.7}
                >
                  <NativeIcon name="exit" size={14} color="#FF9F0A" />
                  <Text style={[styles.actionText, styles.takeOverText]}>Keluar</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionButton, styles.takeOverBtn]}
                  onPress={handleTakeOver}
                  activeOpacity={0.7}
                >
                  <TakeOverIcon size={14} color="#FF9F0A" />
                  <Text style={[styles.actionText, styles.takeOverText]}>Take Over</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.actionButton}
                onPress={openInBrowser}
                activeOpacity={0.7}
              >
                <NativeIcon name="open" size={14} color="#888888" />
                <Text style={styles.actionText}>{Platform.OS === "web" ? "Fullscreen" : "Control"}</Text>
              </TouchableOpacity>

              {/* Only show Destroy button for manually-started sessions, not the agent's session */}
              {sessionId && sessionId !== agentVncSession?.e2bSessionId && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={destroyCurrentSession}
                  activeOpacity={0.7}
                >
                  <NativeIcon name="close-circle" size={14} color="#FF453A" />
                  <Text style={[styles.actionText, styles.dangerText]}>Tutup</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
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
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(48,209,88,0.15)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#30D158",
  },
  liveBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
    color: "#30D158",
  },
  collapseButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a2a2a",
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#888888",
    marginTop: 4,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#606060",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 8,
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#4a7cf0",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  startButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#fff",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 20,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#888888",
    textAlign: "center",
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  errorTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#FF453A",
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#888888",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 8,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  retryButtonText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#e0e0e0",
  },
  readyState: {
    flex: 1,
    padding: 10,
    gap: 10,
  },
  screenshotContainer: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    position: "relative",
  },
  screenshot: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  screenshotOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  screenshotOverlayText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#fff",
  },
  noScreenshot: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: 30,
    gap: 8,
  },
  noScreenshotText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#888888",
  },
  sessionInfo: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoValue: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#a0a0a0",
  },
  actions: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#2a2a2a",
    borderRadius: 6,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    minWidth: 80,
  },
  actionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#a0a0a0",
  },
  dangerButton: {
    borderColor: "rgba(255,69,58,0.25)",
  },
  dangerText: {
    color: "#FF453A",
  },
  takeOverBtn: {
    borderColor: "rgba(255,159,10,0.3)",
  },
  takeOverText: {
    color: "#FF9F0A",
  },
  vncContainer: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    height: 200,
  },
  vncActiveBtn: {
    backgroundColor: "#4a7cf0",
    borderColor: "#4a7cf0",
  },
  vncActiveText: {
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  currentUrl: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  urlText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 10,
    color: "#888888",
  },
  pageTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#e0e0e0",
  },
});
