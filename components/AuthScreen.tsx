/**
 * AuthScreen - Login, Register, and Reset Password screens
 * Supports auth_provider modes:
 *   - none: never shown (AuthProvider handles auto-login)
 *   - local: login form only (no register, no forgot password)
 *   - password: full form (login + register + forgot password)
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { authService, AuthUser } from "@/lib/auth-service";
import { t } from "@/lib/i18n";

type Screen = "login" | "register" | "reset";

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [screen, setScreen] = useState<Screen>("login");
  const [authMode, setAuthMode] = useState<"none" | "local" | "password" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullname, setFullname] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    authService.getAuthMode().then((mode) => {
      setAuthMode(mode);
    });
  }, []);

  const canRegister = authMode === "password";
  const canResetPassword = authMode === "password";

  const handleLogin = useCallback(async () => {
    setError("");
    if (!email.trim()) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }
    setIsLoading(true);
    try {
      const result = await authService.login(email.trim(), password);
      setSuccess(t("Login successful! Welcome back"));
      setTimeout(() => onAuthenticated(result.user), 500);
    } catch (err: any) {
      setError(err.message || t("Authentication failed"));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, onAuthenticated]);

  const handleRegister = useCallback(async () => {
    setError("");
    if (!fullname.trim() || fullname.trim().length < 2) { setError("Full name must be at least 2 characters"); return; }
    if (!email.trim() || !email.includes("@")) { setError("Please enter a valid email"); return; }
    if (password.length < 8) { setError(t("Password must be at least 8 characters")); return; }
    if (password !== confirmPassword) { setError(t("Passwords do not match")); return; }
    setIsLoading(true);
    try {
      const result = await authService.register(email.trim(), password, fullname.trim());
      setSuccess(t("Registration successful!"));
      setTimeout(() => onAuthenticated(result.user), 500);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  }, [email, password, confirmPassword, fullname, onAuthenticated]);

  const handleResetPassword = useCallback(async () => {
    setError("");
    if (!email.trim()) { setError("Email is required"); return; }
    setIsLoading(true);
    try {
      await authService.resetPassword(email.trim());
      setSuccess("If this email exists, a reset link has been sent.");
    } catch {
      setSuccess("If this email exists, a reset link has been sent.");
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  if (authMode === null) {
    return (
      <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color="#4a7cf0" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoContainer}>
          <Image
            source={require("../assets/images/dzeck-logo-transparent.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.logoSubtitle}>AUTONOMOUS AI AGENT</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>
            {screen === "login" ? t("Login to Dzeck AI") :
             screen === "register" ? t("Register to Dzeck AI") :
             t("Reset Password")}
          </Text>

          {error ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {success ? (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle" size={16} color="#30D158" />
              <Text style={styles.successText}>{success}</Text>
            </View>
          ) : null}

          {screen === "register" && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("Full Name")}</Text>
              <TextInput
                style={styles.input}
                placeholder={t("Enter your full name")}
                placeholderTextColor="#636366"
                value={fullname}
                onChangeText={setFullname}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t("Email")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("Enter your email")}
              placeholderTextColor="#636366"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {screen !== "reset" && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("Password")}</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder={t("Enter password")}
                  placeholderTextColor="#636366"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(v => !v)}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#636366"
                  />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {screen === "register" && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("Confirm Password")}</Text>
              <TextInput
                style={styles.input}
                placeholder={t("Enter password again")}
                placeholderTextColor="#636366"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {screen === "login" && canResetPassword && (
            <TouchableOpacity
              style={styles.forgotLink}
              onPress={() => { setScreen("reset"); setError(""); setSuccess(""); }}
            >
              <Text style={styles.forgotLinkText}>{t("Forgot Password?")}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={screen === "login" ? handleLogin : screen === "register" ? handleRegister : handleResetPassword}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>
                {screen === "login" ? t("Login") :
                 screen === "register" ? t("Register") :
                 t("Send Verification Code")}
              </Text>
            )}
          </TouchableOpacity>

          {screen === "login" && canRegister && (
            <TouchableOpacity
              style={styles.switchLink}
              onPress={() => { setScreen("register"); setError(""); setSuccess(""); }}
            >
              <Text style={styles.switchLinkText}>
                {t("Don't have an account?")} <Text style={styles.switchLinkBold}>{t("Register")}</Text>
              </Text>
            </TouchableOpacity>
          )}

          {screen === "register" && (
            <TouchableOpacity
              style={styles.switchLink}
              onPress={() => { setScreen("login"); setError(""); setSuccess(""); }}
            >
              <Text style={styles.switchLinkText}>
                {t("Already have an account?")} <Text style={styles.switchLinkBold}>{t("Login")}</Text>
              </Text>
            </TouchableOpacity>
          )}

          {screen === "reset" && (
            <TouchableOpacity
              style={styles.switchLink}
              onPress={() => { setScreen("login"); setError(""); setSuccess(""); }}
            >
              <Text style={styles.switchLinkText}>
                <Text style={styles.switchLinkBold}>{t("Back to Login")}</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 40,
    gap: 10,
  },
  logoImage: {
    width: 180,
    height: 72,
  },
  logoSubtitle: {
    fontSize: 11,
    color: "#606060",
    letterSpacing: 2,
  },
  card: {
    backgroundColor: "#242424",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF453A20",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#FF453A40",
    gap: 8,
  },
  errorText: {
    color: "#FF453A",
    fontSize: 13,
    flex: 1,
  },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#30D15820",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#30D15840",
    gap: 8,
  },
  successText: {
    color: "#30D158",
    fontSize: 13,
    flex: 1,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    color: "#8E8E93",
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#FFFFFF",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#FFFFFF",
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: -8,
  },
  forgotLinkText: {
    color: "#4a7cf0",
    fontSize: 13,
  },
  button: {
    backgroundColor: "#4a7cf0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  switchLink: {
    alignItems: "center",
  },
  switchLinkText: {
    color: "#636366",
    fontSize: 13,
  },
  switchLinkBold: {
    color: "#4a7cf0",
    fontWeight: "600",
  },
});
