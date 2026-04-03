import React from "react";
import { View, StyleSheet } from "react-native";
import { MainLayout } from "@/components/MainLayout";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <MainLayout />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0D",
  },
});
