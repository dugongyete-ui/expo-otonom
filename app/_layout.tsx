import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Animated,
  Text,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KeyboardProviderWrapper } from "@/components/KeyboardProviderWrapper";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AuthScreen } from "@/components/AuthScreen";
import type { AuthUser } from "@/lib/auth-service";

SplashScreen.preventAutoHideAsync();

function SplashLoader() {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.85)).current;
  const dot1 = React.useRef(new Animated.Value(0.3)).current;
  const dot2 = React.useRef(new Animated.Value(0.3)).current;
  const dot3 = React.useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    const dotAnimation = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      );

    dotAnimation(dot1, 0).start();
    dotAnimation(dot2, 200).start();
    dotAnimation(dot3, 400).start();
  }, []);

  return (
    <View style={splashStyles.container}>
      <Animated.View
        style={[
          splashStyles.logoWrap,
          { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Image
          source={require("../assets/images/dzeck-logo.jpg")}
          style={splashStyles.logo}
          resizeMode="contain"
        />
      </Animated.View>
      <Animated.Text style={[splashStyles.title, { opacity: fadeAnim }]}>
        Dzeck AI
      </Animated.Text>
      <Animated.Text style={[splashStyles.sub, { opacity: fadeAnim }]}>
        AUTONOMOUS AI AGENT
      </Animated.Text>
      <View style={splashStyles.dotsRow}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[splashStyles.dot, { opacity: dot, transform: [{ scale: dot }] }]}
          />
        ))}
      </View>
    </View>
  );
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="share/[sessionId]" options={{ headerShown: false }} />
    </Stack>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, refreshUser } = useAuth();
  const pathname = usePathname();

  const isPublicRoute = pathname?.startsWith("/share/") || pathname?.startsWith("/share");

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#1a1a1a" }} />
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        onAuthenticated={(_user: AuthUser) => {
          refreshUser();
        }}
      />
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
  });
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
      setTimeout(() => setShowSplash(false), 800);
    }
  }, [fontsLoaded, fontError]);

  // Failsafe: never show splash for more than 5 seconds
  useEffect(() => {
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
      setShowSplash(false);
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  if (showSplash) {
    return (
      <>
        <StatusBar style="light" />
        <SplashLoader />
      </>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView>
          <SafeAreaProvider>
            <KeyboardProviderWrapper>
              <AuthProvider>
                <View style={layoutStyles.root}>
                  <StatusBar style="light" />
                  <AuthGate>
                    <RootLayoutNav />
                  </AuthGate>
                </View>
              </AuthProvider>
            </KeyboardProviderWrapper>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  logoWrap: {
    width: 160,
    height: 160,
    marginBottom: 8,
    borderRadius: 16,
    overflow: "hidden",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  title: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: "700",
    color: "#e0e0e0",
    letterSpacing: -0.5,
  },
  sub: {
    marginTop: 4,
    fontSize: 11,
    color: "#666666",
    letterSpacing: 2,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 32,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#4a7cf0",
  },
});

const layoutStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
});
