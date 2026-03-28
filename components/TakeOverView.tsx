/**
 * TakeOverView - Full-screen interactive VNC overlay.
 * Matches ai-manus TakeOverView.vue pattern.
 * Provides full interactive desktop control (viewOnly=false).
 */
import React, { useState, useEffect, useCallback } from "react";
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

interface TakeOverViewProps {
  sessionId: string;
  visible?: boolean;
  onClose: () => void;
}

export function TakeOverView({
  sessionId,
  visible = true,
  onClose,
}: TakeOverViewProps) {
  const [vncConnected, setVncConnected] = useState(false);

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

  // Reset state when visibility changes
  useEffect(() => {
    if (!visible) {
      setVncConnected(false);
    }
  }, [visible]);

  if (!visible || !sessionId) return null;

  const content = (
    <View style={styles.container}>
      {/* VNC Viewer - full screen, interactive */}
      <View style={styles.vncContainer}>
        <VNCViewer
          sessionId={sessionId}
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

      {/* Exit button at bottom center */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.exitButton}
          onPress={onClose}
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
      onRequestClose={onClose}
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
