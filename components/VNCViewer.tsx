/**
 * VNCViewer - Real-time VNC desktop viewer using noVNC.
 * Matches ai-manus VNCViewer.vue pattern.
 * Uses @novnc/novnc RFB library for WebSocket-based VNC streaming.
 * Falls back to screenshot polling on non-web platforms.
 * Auto-reconnects with exponential backoff (up to 5 retries).
 * Mobile: touch layer translates taps to mouse clicks and shows keyboard for typing.
 */
import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
  TouchableOpacity,
  TextInput,
  Modal,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { e2bService } from "@/lib/e2b-service";
import { SANDBOX_DESKTOP_WIDTH, SANDBOX_DESKTOP_HEIGHT } from "@/lib/sandbox-constants";

interface VNCViewerProps {
  sessionId: string;
  enabled: boolean;
  viewOnly?: boolean;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onCredentialsRequired?: () => void;
}

const SCREENSHOT_POLL_INTERVAL_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

export function VNCViewer({
  sessionId,
  enabled,
  viewOnly = false,
  onConnected,
  onDisconnected,
  onCredentialsRequired,
}: VNCViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const screenshotRef = useRef<string | null>(null);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showKeyboardModal, setShowKeyboardModal] = useState(false);
  const [keyboardText, setKeyboardText] = useState("");
  const [isSendingInput, setIsSendingInput] = useState(false);
  const [containerLayout, setContainerLayout] = useState({ width: SANDBOX_DESKTOP_WIDTH, height: SANDBOX_DESKTOP_HEIGHT });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
    };
  }, []);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      if (mountedRef.current) {
        setStatus("error");
        setErrorMsg(`Connection lost after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      }
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
    reconnectAttemptsRef.current += 1;
    if (mountedRef.current) {
      setStatus("connecting");
    }
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && enabled) {
        initVNCConnection();
      }
    }, delay);
  }, [enabled]);

  const initVNCConnection = useCallback(async () => {
    if (!containerRef.current || !enabled || Platform.OS !== "web") return;

    if (rfbRef.current) {
      try { rfbRef.current.disconnect(); } catch {}
      rfbRef.current = null;
    }

    setStatus("connecting");
    setErrorMsg("");

    try {
      const wsUrl = e2bService.getLocalWsProxyUrl(sessionId);
      const { default: RFB } = await import("@novnc/novnc/core/rfb.js");

      const rfb = new RFB(containerRef.current, wsUrl, {
        credentials: { password: "" },
        shared: true,
        wsProtocols: ["binary"],
      });

      rfb.viewOnly = viewOnly;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;

      rfb.addEventListener("connect", () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setStatus("connected");
        onConnected?.();
      });

      rfb.addEventListener("disconnect", (e: any) => {
        if (!mountedRef.current) return;
        const reason = e?.detail?.reason;
        setStatus("disconnected");
        onDisconnected?.(reason);
        if (enabled && mountedRef.current) {
          scheduleReconnect();
        }
      });

      rfb.addEventListener("credentialsrequired", () => {
        onCredentialsRequired?.();
      });

      rfbRef.current = rfb;
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("[VNCViewer] Connection error:", err);
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "VNC connection failed");
      scheduleReconnect();
    }
  }, [sessionId, enabled, viewOnly, onConnected, onDisconnected, onCredentialsRequired, scheduleReconnect]);

  useEffect(() => {
    if (enabled && sessionId && Platform.OS === "web") {
      reconnectAttemptsRef.current = 0;
      initVNCConnection();
    }

    return () => {
      clearReconnectTimer();
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch {}
        rfbRef.current = null;
      }
    };
  }, [enabled, sessionId, initVNCConnection]);

  useEffect(() => {
    if (rfbRef.current) {
      rfbRef.current.viewOnly = viewOnly;
    }
  }, [viewOnly]);

  const handleMobileTap = useCallback(async (evt: any) => {
    if (viewOnly || !enabled || !sessionId) return;
    const { locationX, locationY } = evt.nativeEvent;
    const scaleX = SANDBOX_DESKTOP_WIDTH / (containerLayout.width || SANDBOX_DESKTOP_WIDTH);
    const scaleY = SANDBOX_DESKTOP_HEIGHT / (containerLayout.height || SANDBOX_DESKTOP_HEIGHT);
    const sandboxX = Math.round(locationX * scaleX);
    const sandboxY = Math.round(locationY * scaleY);
    try {
      await e2bService.click(sessionId, sandboxX, sandboxY);
    } catch {
      // ignore click errors
    }
  }, [viewOnly, enabled, sessionId, containerLayout]);

  const handleSendKeyboard = useCallback(async () => {
    if (!keyboardText || !sessionId) return;
    setIsSendingInput(true);
    try {
      await e2bService.type(sessionId, keyboardText);
      setKeyboardText("");
      setShowKeyboardModal(false);
    } catch {
      // ignore
    } finally {
      setIsSendingInput(false);
    }
  }, [keyboardText, sessionId]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!enabled || !sessionId) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const dataUri = await e2bService.captureScreenshot(sessionId);
        if (active) {
          setScreenshotUri(dataUri);
          screenshotRef.current = dataUri;
          setStatus("connected");
          if (reconnectAttemptsRef.current === 0) {
            onConnected?.();
          }
          reconnectAttemptsRef.current = 0;
        }
      } catch (err: any) {
        if (active) {
          reconnectAttemptsRef.current += 1;
          if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            setStatus("error");
            setErrorMsg(err?.message || "Failed to connect to desktop");
          } else {
            setStatus("connecting");
          }
        }
      }
    };

    const scheduleNext = () => {
      if (!active) return;
      // Recompute delay after every attempt so backoff actually increases on errors
      const delayMs = Math.min(
        SCREENSHOT_POLL_INTERVAL_MS * Math.pow(1.5, Math.min(reconnectAttemptsRef.current, 4)),
        10000,
      );
      pollTimerRef.current = setTimeout(async () => {
        await poll();
        scheduleNext();
      }, delayMs) as unknown as ReturnType<typeof setInterval>;
    };

    // Kick off immediately then recurse
    poll().then(scheduleNext);

    return () => {
      active = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current as unknown as ReturnType<typeof setTimeout>);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, sessionId, onConnected]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.container}>
        {status === "connecting" && !screenshotUri && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.statusText}>Loading desktop snapshot...</Text>
            {reconnectAttemptsRef.current > 0 && (
              <Text style={styles.reconnectText}>
                Reconnecting... ({reconnectAttemptsRef.current}/{MAX_RECONNECT_ATTEMPTS})
              </Text>
            )}
          </View>
        )}

        {screenshotUri ? (
          <TouchableOpacity
            style={styles.screenshotTouchable}
            onPress={viewOnly ? undefined : handleMobileTap}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (width > 0 && height > 0) setContainerLayout({ width, height });
            }}
            activeOpacity={viewOnly ? 1 : 0.9}
          >
            <Image
              source={{ uri: screenshotUri }}
              style={styles.screenshot}
              resizeMode="contain"
            />
          </TouchableOpacity>
        ) : null}

        {status === "error" && (
          <View style={styles.overlay}>
            <Ionicons name="alert-circle" size={32} color="#FF453A" />
            <Text style={styles.errorText}>{errorMsg || "Connection failed"}</Text>
          </View>
        )}

        {!viewOnly && screenshotUri && (
          <View style={styles.mobileControls}>
            <TouchableOpacity
              style={styles.keyboardBtn}
              onPress={() => setShowKeyboardModal(true)}
            >
              <Ionicons name="keypad-outline" size={20} color="#FFFFFF" />
              <Text style={styles.keyboardBtnText}>Type</Text>
            </TouchableOpacity>
          </View>
        )}

        <Modal
          visible={showKeyboardModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowKeyboardModal(false)}
        >
          <View style={styles.keyboardModal}>
            <View style={styles.keyboardModalContent}>
              <Text style={styles.keyboardModalTitle}>Send to Desktop</Text>
              <TextInput
                style={styles.keyboardModalInput}
                placeholder="Type here..."
                placeholderTextColor="#636366"
                value={keyboardText}
                onChangeText={setKeyboardText}
                multiline
                autoFocus
              />
              <View style={styles.keyboardModalActions}>
                <TouchableOpacity
                  style={styles.keyboardModalCancel}
                  onPress={() => setShowKeyboardModal(false)}
                >
                  <Text style={styles.keyboardModalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.keyboardModalSend, isSendingInput && styles.keyboardModalSendDisabled]}
                  onPress={handleSendKeyboard}
                  disabled={isSendingInput || !keyboardText}
                >
                  {isSendingInput ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.keyboardModalSendText}>Send to Desktop</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {status === "connecting" && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.statusText}>
            {reconnectAttemptsRef.current > 0
              ? `Reconnecting... (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
              : "Connecting to desktop..."}
          </Text>
        </View>
      )}
      {status === "error" && (
        <View style={styles.overlay}>
          <Ionicons name="alert-circle" size={32} color="#FF453A" />
          <Text style={styles.errorText}>{errorMsg || "Connection failed"}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              reconnectAttemptsRef.current = 0;
              initVNCConnection();
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {status === "disconnected" && (
        <View style={styles.overlay}>
          <Ionicons name="wifi-outline" size={32} color="#636366" />
          <Text style={styles.statusText}>Reconnecting...</Text>
        </View>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: "relative",
    backgroundColor: "#1a1a1a",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    zIndex: 10,
    gap: 12,
  },
  statusText: {
    color: "#ffffff",
    fontSize: 13,
    marginTop: 8,
    fontFamily: "Inter_400Regular",
  },
  reconnectText: {
    color: "#8E8E93",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    color: "#FF453A",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  retryBtn: {
    backgroundColor: "#6C5CE7",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  screenshot: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  screenshotTouchable: {
    flex: 1,
    width: "100%",
  },
  mobileControls: {
    position: "absolute",
    bottom: 16,
    right: 16,
    zIndex: 20,
  },
  keyboardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(26,25,22,0.9)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  keyboardBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
  },
  keyboardModal: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  keyboardModalContent: {
    backgroundColor: "#1A1A20",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
  },
  keyboardModalTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
  keyboardModalInput: {
    backgroundColor: "#0A0A0C",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2C2C30",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#FFFFFF",
    minHeight: 80,
  },
  keyboardModalActions: {
    flexDirection: "row",
    gap: 10,
  },
  keyboardModalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2C2C30",
    alignItems: "center",
  },
  keyboardModalCancelText: {
    color: "#8E8E93",
    fontSize: 15,
    fontWeight: "500",
  },
  keyboardModalSend: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
  },
  keyboardModalSendDisabled: {
    opacity: 0.5,
  },
  keyboardModalSendText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
