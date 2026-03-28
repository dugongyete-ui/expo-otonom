import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { MainLayout } from "@/components/MainLayout";
import { initAgentService } from "@/lib/agent-service";

export default function HomeScreen() {
  useEffect(() => {
    // Initialize agent service with API configuration
    const apiUrl = process.env.EXPO_PUBLIC_DOMAIN || "http://localhost:5000";
    const apiKey = process.env.EXPO_PUBLIC_API_KEY || "";

    if (apiKey) {
      initAgentService(apiUrl, apiKey);
    }
  }, []);

  return (
    <View style={styles.container}>
      <MainLayout />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0C",
  },
});
