/**
 * Settings Panel — Model selection and global config.
 * Reads from GET /api/config, saves to PUT /api/config.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  Platform,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl } from "@/lib/api-service";

interface AppConfig {
  CEREBRAS_CHAT_MODEL?: string;
  CEREBRAS_AGENT_MODEL?: string;
  SEARCH_PROVIDER?: string;
  MODEL_PROVIDER?: string;
  SHOW_GITHUB_BUTTON?: string;
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_SEARCH_ENGINE_ID?: string;
  E2B_ENABLED?: boolean;
  EMAIL_ENABLED?: boolean;
  authProvider?: string;
  modelName?: string;
  modelProvider?: string;
  searchProvider?: string;
}

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  authToken: string;
}

const MODEL_PRESETS = [
  { label: "Qwen 3 235B (Default)", value: "qwen-3-235b-a22b-instruct-2507" },
  { label: "Qwen 3 32B", value: "qwen-3-32b" },
  { label: "Llama 4 Scout", value: "llama-4-scout-17b-16e-instruct" },
  { label: "Llama 4 Maverick", value: "llama-4-maverick-17b-128e-instruct" },
  { label: "Llama 3.3 70B", value: "llama-3.3-70b" },
];

const PROVIDER_PRESETS = [
  { label: "Cerebras", value: "cerebras" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
];

const SEARCH_PRESETS = [
  { label: "Bing Web", value: "bing_web" },
  { label: "Google", value: "google" },
  { label: "DuckDuckGo", value: "duckduckgo" },
];

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function OptionPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.optionRow}>
          {options.map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.optionChip, value === opt.value && styles.optionChipActive]}
              onPress={() => onChange(opt.value)}
            >
              <Text style={[styles.optionChipText, value === opt.value && styles.optionChipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function FieldInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.textInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#636366"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

function StatusRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={[styles.statusBadge, enabled ? styles.statusOk : styles.statusOff]}>
        <Text style={[styles.statusBadgeText, enabled ? styles.statusOkText : styles.statusOffText]}>
          {enabled ? "Configured" : "Not Configured"}
        </Text>
      </View>
    </View>
  );
}

export function SettingsPanel({ visible, onClose, authToken }: SettingsPanelProps) {
  const [config, setConfig] = useState<AppConfig>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [agentModel, setAgentModel] = useState("qwen-3-235b-a22b-instruct-2507");
  const [chatModel, setChatModel] = useState("qwen-3-235b-a22b-instruct-2507");
  const [modelProvider, setModelProvider] = useState("cerebras");
  const [searchProvider, setSearchProvider] = useState("bing_web");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [googleEngineId, setGoogleEngineId] = useState("");

  const apiBase = getApiBaseUrl();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AppConfig = await res.json();
      setConfig(data);
      setAgentModel(data.CEREBRAS_AGENT_MODEL || data.modelName || "qwen-3-235b-a22b-instruct-2507");
      setChatModel(data.CEREBRAS_CHAT_MODEL || "qwen-3-235b-a22b-instruct-2507");
      setModelProvider(data.MODEL_PROVIDER || data.modelProvider || "cerebras");
      setSearchProvider(data.SEARCH_PROVIDER || data.searchProvider || "bing_web");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (visible) fetchConfig();
  }, [visible, fetchConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const body: Record<string, string> = {
        CEREBRAS_AGENT_MODEL: agentModel,
        CEREBRAS_CHAT_MODEL: chatModel,
        MODEL_PROVIDER: modelProvider,
        SEARCH_PROVIDER: searchProvider,
      };
      if (googleApiKey.trim()) body.GOOGLE_SEARCH_API_KEY = googleApiKey.trim();
      if (googleEngineId.trim()) body.GOOGLE_SEARCH_ENGINE_ID = googleEngineId.trim();

      const res = await fetch(`${apiBase}/api/config`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setSuccessMsg("Settings saved successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
      await fetchConfig();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#AEAEB2" />
          </Pressable>
          <Text style={styles.headerTitle}>Settings</Text>
          <Pressable
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={14} color="#FF453A" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError(null)}><Ionicons name="close" size={14} color="#FF453A" /></Pressable>
          </View>
        )}

        {successMsg && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={14} color="#30D158" />
            <Text style={styles.successText}>{successMsg}</Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.loadingText}>Loading settings...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <SectionHeader title="Model Configuration" />
            <OptionPicker label="Model Provider" options={PROVIDER_PRESETS} value={modelProvider} onChange={setModelProvider} />
            <OptionPicker label="Agent Model" options={MODEL_PRESETS} value={agentModel} onChange={setAgentModel} />
            <FieldInput label="Agent Model (Custom)" value={agentModel} onChangeText={setAgentModel} placeholder="model-name" />
            <OptionPicker label="Chat Model" options={MODEL_PRESETS} value={chatModel} onChange={setChatModel} />
            <FieldInput label="Chat Model (Custom)" value={chatModel} onChangeText={setChatModel} placeholder="model-name" />

            <SectionHeader title="Search" />
            <OptionPicker label="Search Provider" options={SEARCH_PRESETS} value={searchProvider} onChange={setSearchProvider} />
            {searchProvider === "google" && (
              <>
                <FieldInput label="Google Search API Key" value={googleApiKey} onChangeText={setGoogleApiKey} placeholder="AIza..." secureTextEntry />
                <FieldInput label="Google CSE Engine ID" value={googleEngineId} onChangeText={setGoogleEngineId} placeholder="Search engine ID" />
              </>
            )}

            <SectionHeader title="Service Status" />
            <StatusRow label="E2B Sandbox" enabled={!!config.E2B_ENABLED} />
            <StatusRow label="Email" enabled={!!config.EMAIL_ENABLED} />
            <StatusRow label="Google Search" enabled={!!config.GOOGLE_SEARCH_CONFIGURED} />

            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0C" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#2C2C30",
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: "#FFFFFF" },
  saveBtn: { backgroundColor: "#6C5CE7", paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,69,58,0.1)", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,69,58,0.2)",
  },
  errorText: { color: "#FF453A", fontSize: 13, flex: 1 },
  successBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(48,209,88,0.1)", paddingHorizontal: 16, paddingVertical: 10,
  },
  successText: { color: "#30D158", fontSize: 13 },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#8E8E93", fontSize: 14 },
  content: { padding: 16 },
  sectionHeader: {
    color: "#636366", fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8,
    marginTop: 20, marginBottom: 12,
  },
  fieldContainer: { marginBottom: 16 },
  fieldLabel: { color: "#8E8E93", fontSize: 11, fontWeight: "600", marginBottom: 8, textTransform: "uppercase" },
  textInput: {
    backgroundColor: "#1A1A20", borderWidth: 1, borderColor: "#2C2C30",
    borderRadius: 8, color: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  optionRow: { flexDirection: "row", gap: 8 },
  optionChip: {
    paddingVertical: 7, paddingHorizontal: 12,
    backgroundColor: "#1A1A20", borderWidth: 1, borderColor: "#2C2C30", borderRadius: 8,
  },
  optionChipActive: { backgroundColor: "rgba(108,92,231,0.15)", borderColor: "#6C5CE7" },
  optionChipText: { color: "#636366", fontSize: 12, fontWeight: "500" },
  optionChipTextActive: { color: "#6C5CE7", fontWeight: "600" },
  statusRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1A1A20",
  },
  statusLabel: { color: "#AEAEB2", fontSize: 14 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  statusOk: { backgroundColor: "rgba(48,209,88,0.12)" },
  statusOff: { backgroundColor: "rgba(142,142,147,0.12)" },
  statusBadgeText: { fontSize: 11, fontWeight: "600" },
  statusOkText: { color: "#30D158" },
  statusOffText: { color: "#636366" },
});
