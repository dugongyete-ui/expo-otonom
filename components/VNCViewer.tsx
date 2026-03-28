/**
 * VNCViewer - Real-time VNC desktop viewer using noVNC.
 * Matches ai-manus VNCViewer.vue pattern.
 * Uses @novnc/novnc RFB library for WebSocket-based VNC streaming.
 * Falls back to screenshot polling on non-web platforms.
 */
import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { e2bService } from "@/lib/e2b-service";

interface VNCViewerProps {
  sessionId: string;
  enabled: boolean;
  viewOnly?: boolean;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onCredentialsRequired?: () => void;
}

const SCREENSHOT_POLL_INTERVAL_MS = 2000;

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

  // Screenshot polling state (mobile fallback)
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initVNCConnection = useCallback(async () => {
    if (!containerRef.current || !enabled || Platform.OS !== "web") return;

    // Disconnect existing connection
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {
        // ignore
      }
      rfbRef.current = null;
    }

    setStatus("connecting");
    setErrorMsg("");

    try {
      // Use the local WebSocket proxy endpoint which properly bridges to the
      // E2B sandbox VNC. The E2B stream URL is an HTML page, not a raw VNC
      // WebSocket, so we must go through the server's WS proxy at
      // /api/e2b/sessions/:id/ws  which strips the HTML path and connects to
      // the underlying websockify endpoint.
      const wsUrl = e2bService.getLocalWsProxyUrl(sessionId);

      // Dynamically import noVNC RFB
      const { default: RFB } = await import("@novnc/novnc/core/rfb.js");

      // Create noVNC connection
      const rfb = new RFB(containerRef.current, wsUrl, {
        credentials: { password: "" },
        shared: true,
        wsProtocols: ["binary"],
      });

      rfb.viewOnly = viewOnly;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;

      rfb.addEventListener("connect", () => {
        setStatus("connected");
        onConnected?.();
      });

      rfb.addEventListener("disconnect", (e: any) => {
        setStatus("disconnected");
        onDisconnected?.(e?.detail?.reason);
      });

      rfb.addEventListener("credentialsrequired", () => {
        onCredentialsRequired?.();
      });

      rfbRef.current = rfb;
    } catch (err) {
      console.error("[VNCViewer] Connection error:", err);
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "VNC connection failed");
    }
  }, [sessionId, enabled, viewOnly, onConnected, onDisconnected, onCredentialsRequired]);

  // Initialize VNC connection when enabled (web only)
  useEffect(() => {
    if (enabled && sessionId && Platform.OS === "web") {
      initVNCConnection();
    }

    return () => {
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {
          // ignore
        }
        rfbRef.current = null;
      }
    };
  }, [enabled, sessionId, initVNCConnection]);

  // Update viewOnly when prop changes
  useEffect(() => {
    if (rfbRef.current) {
      rfbRef.current.viewOnly = viewOnly;
    }
  }, [viewOnly]);

  // Screenshot polling for non-web platforms (Expo Go / mobile)
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
          setStatus("connected");
          onConnected?.();
        }
      } catch (err) {
        // Silently retry — screenshot endpoint may not be ready yet
        if (active) {
          setStatus("connecting");
        }
      }
    };

    // First poll immediately
    poll();
    pollTimerRef.current = setInterval(poll, SCREENSHOT_POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, sessionId, onConnected]);

  // Non-web platforms: show screenshot polling view
  if (Platform.OS !== "web") {
    return (
      <View style={styles.container}>
        {status === "connecting" && !screenshotUri && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.statusText}>Loading desktop snapshot...</Text>
          </View>
        )}
        {screenshotUri ? (
          <Image
            source={{ uri: screenshotUri }}
            style={styles.screenshot}
            resizeMode="contain"
          />
        ) : null}
        {status === "error" && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>{errorMsg || "Connection failed"}</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {status === "connecting" && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.statusText}>Connecting to desktop...</Text>
        </View>
      )}
      {status === "error" && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>{errorMsg || "Connection failed"}</Text>
        </View>
      )}
      {status === "disconnected" && (
        <View style={styles.overlay}>
          <Text style={styles.statusText}>Disconnected</Text>
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
  },
  statusText: {
    color: "#ffffff",
    fontSize: 13,
    marginTop: 12,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    color: "#FF453A",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  screenshot: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f3ee",
    padding: 20,
  },
  fallbackText: {
    color: "#8a8780",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
