/**
 * TakeOverView - Full-screen interactive VNC overlay.
 * Matches ai-manus TakeOverView.vue pattern.
 * Provides full interactive desktop control (viewOnly=false).
 *
 * Props:
 *  - agentSessionId: agent session ID used for pause/resume API calls
 *  - e2bSessionId:   E2B desktop session ID used for VNC WebSocket connection
 *  - visible, onClose: standard overlay lifecycle
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VNCViewer } from "./VNCViewer";
import { getApiBaseUrl, getStoredToken } from "@/lib/api-service";

interface TakeOverViewProps {
  /** Agent session ID (for pause/resume API calls). */
  agentSessionId: string;
  /** E2B desktop session ID (for VNC WebSocket connection). Defaults to agentSessionId if not provided. */
  e2bSessionId?: string;
  visible?: boolean;
  onClose: () => void;
}

async function callPauseResume(agentSessionId: string, action: "pause" | "resume"): Promise<boolean> {
  if (!agentSessionId) return false;
  try {
    const baseUrl = getApiBaseUrl();
    const token = getStoredToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetch(`${baseUrl}/api/agent/sessions/${agentSessionId}/${action}`, {
      method: "POST",
      headers,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[TakeOverView] ${action} failed (${resp.status}): ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[TakeOverView] ${action} call failed:`, err);
    return false;
  }
}

export function TakeOverView({
  agentSessionId,
  e2bSessionId,
  visible = true,
  onClose,
}: TakeOverViewProps) {
  const [vncConnected, setVncConnected] = useState(false);
  const pausedRef = useRef(false);

  // The VNC viewer connects to the E2B desktop session (not the agent session)
  const vncSessionId = e2bSessionId || agentSessionId;

  const handleVNCConnected = useCallback(() => {
    setVncConnected(true);
  }, []);

  const handleVNCDisconnected = useCallback((reason?: string) => {
    setVncConnected(false);
    if (reason) {
      console.log("[TakeOverView] VNC disconnected:", reason);
    }
  }, []);

  const handleVNCCredentialsRequired = useCallback(() => {
    console.log("[TakeOverView] VNC credentials required");
  }, []);

  // Pause agent when takeover opens; resume when it closes
  useEffect(() => {
    if (!agentSessionId) return;
    if (visible && !pausedRef.current) {
      pausedRef.current = true;
      callPauseResume(agentSessionId, "pause");
    } else if (!visible && pausedRef.current) {
      pausedRef.current = false;
      setVncConnected(false);
      callPauseResume(agentSessionId, "resume");
    }
  }, [visible, agentSessionId]);

  const handleClose = useCallback(() => {
    if (agentSessionId && pausedRef.current) {
      pausedRef.current = false;
      callPauseResume(agentSessionId, "resume");
    }
    onClose();
  }, [agentSessionId, onClose]);

  if (!visible || !agentSessionId) return null;

  const content = (
    <View style={styles.container}>
      {/* VNC Viewer - full screen, interactive, connected via E2B session ID */}
      <View style={styles.vncContainer}>
        <VNCViewer
          sessionId={vncSessionId}
          enabled={visible}
          viewOnly={false}
          onConnected={handleVNCConnected}
          onDisconnected={handleVNCDisconnected}
          onCredentialsRequired={handleVNCCredentialsRequired}
        />
      </View>

      {/* Connection status */}
      {vncConnected && (
        <View style={styles.connectedBadge}>
          <View style={styles.connectedDot} />
          <Text style={styles.connectedText}>Interactive Mode</Text>
        </View>
      )}

      {/* Pause indicator */}
      <View style={styles.pauseBadge}>
        <Ionicons name="pause-circle" size={14} color="#FF9F0A" />
        <Text style={styles.pauseText}>Agent Dijeda</Text>
      </View>

      {/* Exit button at bottom center */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.exitButton}
          onPress={handleClose}
          activeOpacity={0.8}
        >
          <Ionicons name="exit-outline" size={16} color="#ffffff" />
          <Text style={styles.exitButtonText}>Exit Takeover</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // On web, use a portal-like approach with fixed positioning
  if (Platform.OS === "web") {
    return (
      <View style={styles.webOverlay}>
        {content}
      </View>
    );
  }

  // On native, use Modal
  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    position: "relative",
  },
  webOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: "#000000",
  },
  vncContainer: {
    flex: 1,
  },
  connectedBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 10,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#30D158",
  },
  connectedText: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  pauseBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 10,
  },
  pauseText: {
    color: "#FF9F0A",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  bottomBar: {
    position: "absolute",
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  exitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(26,25,22,0.9)",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 8,
  },
  exitButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
