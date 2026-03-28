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
import { Ionicons } from "@expo/vector-icons";
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
      console.log("[BrowserPanel] Starting screenshot polling (5s interval) for session:", sessionId);
      autoRefreshRef.current = setInterval(() => {
        refreshScreenshot();
      }, 5000);
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
    if (shouldSkipPolling && sessionState === "ready" && sessionId) {
      console.log("[BrowserPanel] Screenshot polling suppressed — VNCViewer is active (useVNC:", useVNC, "vncViewerActive:", vncViewerActive, ")");
    }
  }, [sessionState, sessionId, useVNC, vncViewerActive, refreshScreenshot]);

  // Auto-connect to agent's sandbox when vnc_stream_url event is received
  useEffect(() => {
    if (agentVncSession && agentVncSession.e2bSessionId) {
      // Agent has created a sandbox — connect to it directly
      setSessionId(agentVncSession.e2bSessionId);
      setSessionState("connecting");
      setStatusMsg("Menghubungkan ke sandbox agen...");

      // Poll for readiness then transition to ready
      e2bService.waitForReady(
        agentVncSession.e2bSessionId,
        20,
        2000,
        (attempt, max) => {
          setStatusMsg(`Menunggu desktop siap... (${attempt}/${max})`);
        },
      ).then((health) => {
        if (health && health.ready) {
          setSessionState("ready");
          setStatusMsg("Desktop agen terhubung!");
          refreshScreenshot(agentVncSession.e2bSessionId);
        } else {
          // Even if health check times out, if we have a session ID it may still work
          setSessionState("ready");
          setStatusMsg("Desktop agen aktif");
          refreshScreenshot(agentVncSession.e2bSessionId);
        }
      }).catch(() => {
        setSessionState("ready");
        setStatusMsg("Desktop agen aktif");
      });
    }
  }, [agentVncSession]);

  // Update screenshot from agent browser events
  useEffect(() => {
    if (lastBrowserEvent?.screenshot_b64) {
      setScreenshotUri(lastBrowserEvent.screenshot_b64);
      if (sessionState === "idle") {
        setSessionState("ready");
        setStatusMsg("Browser aktif dari agen");
      }
    }
  }, [lastBrowserEvent, sessionState]);

  const startSession = useCallback(async () => {
    setSessionState("creating");
    setStatusMsg("Membuat E2B Desktop Sandbox...");
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
  }, []);

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
    if (!sessionId || Platform.OS !== "web") return;
    const viewerUrl = `/e2b-viewer?session=${sessionId}&takeover=1`;
    window.open(viewerUrl, "_blank");
  }, [sessionId]);

  const handleTakeOver = useCallback(() => {
    const targetId = sessionId || agentSessionId;
    if (onTakeOver && targetId) {
      onTakeOver(targetId);
    } else if (targetId && Platform.OS === "web") {
      const viewerUrl = `/e2b-viewer?session=${targetId}&takeover=1`;
      window.open(viewerUrl, "_blank");
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
        <Ionicons name="chevron-back" size={16} color="#636366" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="desktop-outline" size={14} color="#6C5CE7" />
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
          <Ionicons name="chevron-forward" size={16} color="#636366" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {sessionState === "idle" && (
          <View style={styles.emptyState}>
            <Ionicons name="globe-outline" size={32} color="#2A2A32" />
            <Text style={styles.emptyTitle}>E2B Desktop</Text>
            <Text style={styles.emptyText}>
              Buat sandbox desktop cloud untuk browser automation secara visual
            </Text>
            <TouchableOpacity
              style={styles.startButton}
              onPress={startSession}
              activeOpacity={0.7}
            >
              <Ionicons name="play" size={14} color="#fff" />
              <Text style={styles.startButtonText}>Mulai Desktop</Text>
            </TouchableOpacity>
          </View>
        )}

        {(sessionState === "creating" || sessionState === "waiting" || sessionState === "connecting") && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.loadingText}>{statusMsg}</Text>
          </View>
        )}

        {sessionState === "error" && (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle" size={32} color="#FF453A" />
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={startSession}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={styles.retryButtonText}>Coba Lagi</Text>
            </TouchableOpacity>
          </View>
        )}

        {sessionState === "ready" && (
          <View style={styles.readyState}>
            {/* VNC Live View or Screenshot */}
            {useVNC && Platform.OS === "web" && sessionId ? (
              <View style={styles.vncContainer}>
                <VNCViewer
                  sessionId={sessionId}
                  enabled={useVNC}
                  viewOnly={true}
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
                  <Ionicons name="expand" size={16} color="#fff" />
                  <Text style={styles.screenshotOverlayText}>Buka Fullscreen</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.noScreenshot}>
                <ActivityIndicator size="small" color="#6C5CE7" />
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
                  <Ionicons name="lock-closed" size={10} color="#34C759" />
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
                <Ionicons name="camera-outline" size={14} color="#8E8EA0" />
                <Text style={styles.actionText}>Screenshot</Text>
              </TouchableOpacity>

              {/* VNC Toggle - Live view */}
              {Platform.OS === "web" && sessionId && (
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    useVNC && styles.vncActiveBtn,
                  ]}
                  onPress={toggleVNCMode}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={useVNC ? "videocam" : "videocam-outline"}
                    size={14}
                    color={useVNC ? "#FFFFFF" : "#6C5CE7"}
                  />
                  <Text style={[
                    styles.actionText,
                    useVNC && styles.vncActiveText,
                  ]}>{useVNC ? "Live" : "VNC"}</Text>
                </TouchableOpacity>
              )}

              {/* Take Over button - like ai-manus */}
              <TouchableOpacity
                style={[styles.actionButton, styles.takeOverBtn]}
                onPress={handleTakeOver}
                activeOpacity={0.7}
              >
                <TakeOverIcon size={14} color="#FF9F0A" />
                <Text style={[styles.actionText, styles.takeOverText]}>Take Over</Text>
              </TouchableOpacity>

              {Platform.OS === "web" && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={openInBrowser}
                  activeOpacity={0.7}
                >
                  <Ionicons name="open-outline" size={14} color="#8E8EA0" />
                  <Text style={styles.actionText}>Fullscreen</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionButton, styles.dangerButton]}
                onPress={destroyCurrentSession}
                activeOpacity={0.7}
              >
                <Ionicons name="close-circle-outline" size={14} color="#FF453A" />
                <Text style={[styles.actionText, styles.dangerText]}>Tutup</Text>
              </TouchableOpacity>
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
    backgroundColor: "#ffffff",
  },
  collapsedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 16,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9d0",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#1a1916",
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
    backgroundColor: "#f5f3ee",
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
    color: "#8a8780",
    marginTop: 4,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#8a8780",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 8,
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1a1916",
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
    color: "#8a8780",
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
    color: "#dc2626",
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#8a8780",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 8,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f5f3ee",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#ddd9d0",
  },
  retryButtonText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#1a1916",
  },
  readyState: {
    flex: 1,
    padding: 10,
    gap: 10,
  },
  screenshotContainer: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f5f3ee",
    borderWidth: 1,
    borderColor: "#ddd9d0",
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
    backgroundColor: "#f5f3ee",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    paddingVertical: 30,
    gap: 8,
  },
  noScreenshotText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#8a8780",
  },
  sessionInfo: {
    backgroundColor: "#f5f3ee",
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
    color: "#8a8780",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoValue: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#4a4740",
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
    backgroundColor: "#f5f3ee",
    borderRadius: 6,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    minWidth: 80,
  },
  actionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#4a4740",
  },
  dangerButton: {
    borderColor: "rgba(220,38,38,0.2)",
  },
  dangerText: {
    color: "#dc2626",
  },
  takeOverBtn: {
    borderColor: "rgba(217,119,6,0.3)",
  },
  takeOverText: {
    color: "#d97706",
  },
  vncContainer: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#ddd9d0",
    height: 200,
  },
  vncActiveBtn: {
    backgroundColor: "#6C5CE7",
    borderColor: "#6C5CE7",
  },
  vncActiveText: {
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  currentUrl: {
    backgroundColor: "#f5f3ee",
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
    color: "#8a8780",
  },
  pageTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#1a1916",
  },
});
