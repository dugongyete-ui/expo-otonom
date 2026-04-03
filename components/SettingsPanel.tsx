/**
 * Settings Panel — Model selection and global config.
 * Loads from GET /api/config (global defaults) + GET /api/user/prefs (per-user override).
 * Saves model/provider preferences to PUT /api/user/prefs (per-user, requireAuth).
 * Admin API key settings (Google CSE) are saved to PUT /api/config (requireAdmin).
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

interface SelectOption {
  label: string;
  value: string;
}

interface ServiceStatus {
  configured: boolean;
  message: string;
}

interface AppConfig {
  G4F_MODEL?: string;
  G4F_API_URL?: string;
  SEARCH_PROVIDER?: string;
  MODEL_PROVIDER?: string;
  SHOW_GITHUB_BUTTON?: string;
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_SEARCH_ENGINE_ID?: string;
  GOOGLE_SEARCH_CONFIGURED?: boolean;
  E2B_ENABLED?: boolean;
  EMAIL_ENABLED?: boolean;
  authProvider?: string;
  modelName?: string;
  modelProvider?: string;
  searchProvider?: string;
  available_models?: SelectOption[];
  available_providers?: SelectOption[];
  available_search_providers?: SelectOption[];
}

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  authToken: string;
}

const FALLBACK_MODELS: SelectOption[] = [
  { label: "Qwen 3 235B (Default)", value: "qwen-3-235b-a22b-instruct-2507" },
  { label: "Llama 3.1 8B (Fast)", value: "llama3.1-8b" },
];

const FALLBACK_PROVIDERS: SelectOption[] = [
  { label: "G4F Space", value: "g4f" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
];

const FALLBACK_SEARCH_PROVIDERS: SelectOption[] = [
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

function StatusRow({ label, enabled, message }: { label: string; enabled: boolean; message?: string }) {
  const badgeText = enabled ? "Configured" : (message || "Not Configured");
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={[styles.statusBadge, enabled ? styles.statusOk : styles.statusOff]}>
        <Text style={[styles.statusBadgeText, enabled ? styles.statusOkText : styles.statusOffText]} numberOfLines={1}>
          {badgeText}
        </Text>
      </View>
    </View>
  );
}

export function SettingsPanel({ visible, onClose, authToken }: SettingsPanelProps) {
  const [config, setConfig] = useState<AppConfig>({});
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, ServiceStatus>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [agentModel, setAgentModel] = useState("qwen-3-235b-a22b-instruct-2507");
  const [chatModel, setChatModel] = useState("qwen-3-235b-a22b-instruct-2507");
  const [modelProvider, setModelProvider] = useState("g4f");
  const [searchProvider, setSearchProvider] = useState("bing_web");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [googleEngineId, setGoogleEngineId] = useState("");

  const [modelOptions, setModelOptions] = useState<SelectOption[]>(FALLBACK_MODELS);
  const [providerOptions, setProviderOptions] = useState<SelectOption[]>(FALLBACK_PROVIDERS);
  const [searchOptions, setSearchOptions] = useState<SelectOption[]>(FALLBACK_SEARCH_PROVIDERS);

  const apiBase = getApiBaseUrl();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [configRes, prefsRes, healthRes] = await Promise.all([
        fetch(`${apiBase}/api/config`),
        fetch(`${apiBase}/api/user/prefs`, { headers }),
        fetch(`${apiBase}/api/health`).catch(() => null),
      ]);
      if (!configRes.ok) throw new Error(`HTTP ${configRes.status}`);
      const data: AppConfig = await configRes.json();
      const health = healthRes && healthRes.ok ? await healthRes.json().catch(() => null) : null;
      const statuses: Record<string, ServiceStatus> = {};
      if (health?.services) {
        const svcMap: Record<string, string> = {
          g4f: "g4f",
          mongodb: "mongodb",
          redis: "redis",
        };
        for (const [key, svcKey] of Object.entries(svcMap)) {
          const svc = health.services[svcKey];
          if (svc) {
            const ok = svc.status === "configured" || svc.status === "ok" || svc.status === "connected";
            statuses[key] = { configured: ok, message: svc.message || (ok ? "Connected" : "Not configured") };
          }
        }
        statuses.e2b = {
          configured: !!data.E2B_ENABLED,
          message: data.E2B_ENABLED ? "E2B API key set" : "E2B_API_KEY not configured",
        };
        statuses.email = {
          configured: !!data.EMAIL_ENABLED,
          message: data.EMAIL_ENABLED ? "SMTP configured" : "EMAIL_HOST not configured",
        };
        statuses.google = {
          configured: !!data.GOOGLE_SEARCH_CONFIGURED,
          message: data.GOOGLE_SEARCH_CONFIGURED ? "Google CSE configured" : "API key not configured",
        };
      }
      setServiceStatuses(statuses);
      setConfig(data);
      if (data.available_models?.length) setModelOptions(data.available_models);
      if (data.available_providers?.length) setProviderOptions(data.available_providers);
      if (data.available_search_providers?.length) setSearchOptions(data.available_search_providers);
      const prefs = prefsRes.ok ? await prefsRes.json().catch(() => ({})) : {};
      setAgentModel(prefs.model || data.G4F_MODEL || data.modelName || "auto");
      setChatModel(data.G4F_MODEL || "auto");
      setModelProvider(prefs.modelProvider || data.MODEL_PROVIDER || data.modelProvider || "g4f");
      setSearchProvider(prefs.searchProvider || data.SEARCH_PROVIDER || data.searchProvider || "bing_web");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, headers]);

  useEffect(() => {
    if (visible) fetchConfig();
  }, [visible, fetchConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const prefsBody: Record<string, string> = {
        model: agentModel,
        modelProvider,
        searchProvider,
      };
      const prefsRes = await fetch(`${apiBase}/api/user/prefs`, {
        method: "PUT",
        headers,
        body: JSON.stringify(prefsBody),
      });
      if (!prefsRes.ok) {
        const errJson = await prefsRes.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${prefsRes.status}`);
      }

      if (googleApiKey.trim() || googleEngineId.trim()) {
        const adminBody: Record<string, string> = {};
        if (googleApiKey.trim()) adminBody.GOOGLE_SEARCH_API_KEY = googleApiKey.trim();
        if (googleEngineId.trim()) adminBody.GOOGLE_SEARCH_ENGINE_ID = googleEngineId.trim();
        const adminRes = await fetch(`${apiBase}/api/config`, {
          method: "PUT",
          headers,
          body: JSON.stringify(adminBody),
        });
        if (!adminRes.ok && adminRes.status !== 403) {
          const errJson = await adminRes.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${adminRes.status}`);
        }
      }

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
            <Ionicons name="warning-outline" size={14} color="#888888" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError(null)}><Ionicons name="close" size={14} color="#888888" /></Pressable>
          </View>
        )}

        {successMsg && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={14} color="#888888" />
            <Text style={styles.successText}>{successMsg}</Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#888888" />
            <Text style={styles.loadingText}>Loading settings...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <SectionHeader title="Model Configuration" />
            <OptionPicker label="Model Provider" options={providerOptions} value={modelProvider} onChange={setModelProvider} />
            <OptionPicker label="Agent Model" options={modelOptions} value={agentModel} onChange={setAgentModel} />
            <FieldInput label="Agent Model (Custom)" value={agentModel} onChangeText={setAgentModel} placeholder="model-name" />
            <OptionPicker label="Chat Model" options={modelOptions} value={chatModel} onChange={setChatModel} />
            <FieldInput label="Chat Model (Custom)" value={chatModel} onChangeText={setChatModel} placeholder="model-name" />

            <SectionHeader title="Search" />
            <OptionPicker label="Search Provider" options={searchOptions} value={searchProvider} onChange={setSearchProvider} />
            {searchProvider === "google" && (
              <>
                <FieldInput label="Google Search API Key" value={googleApiKey} onChangeText={setGoogleApiKey} placeholder="AIza..." secureTextEntry />
                <FieldInput label="Google CSE Engine ID" value={googleEngineId} onChangeText={setGoogleEngineId} placeholder="Search engine ID" />
              </>
            )}

            <SectionHeader title="Service Status" />
            <StatusRow label="G4F Space AI" enabled={serviceStatuses.g4f?.configured ?? false} message={serviceStatuses.g4f?.message} />
            <StatusRow label="MongoDB" enabled={serviceStatuses.mongodb?.configured ?? false} message={serviceStatuses.mongodb?.message} />
            <StatusRow label="Redis" enabled={serviceStatuses.redis?.configured ?? false} message={serviceStatuses.redis?.message} />
            <StatusRow label="E2B Sandbox" enabled={serviceStatuses.e2b?.configured ?? !!config.E2B_ENABLED} message={serviceStatuses.e2b?.message} />
            <StatusRow label="Email" enabled={serviceStatuses.email?.configured ?? !!config.EMAIL_ENABLED} message={serviceStatuses.email?.message} />
            <StatusRow label="Google Search" enabled={serviceStatuses.google?.configured ?? !!config.GOOGLE_SEARCH_CONFIGURED} message={serviceStatuses.google?.message} />

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
  saveBtn: { backgroundColor: "#3a3a3a", paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
  },
  errorText: { color: "#a0a0a0", fontSize: 13, flex: 1 },
  successBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 16, paddingVertical: 10,
  },
  successText: { color: "#888888", fontSize: 13 },
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
  optionChipActive: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "#555555" },
  optionChipText: { color: "#636366", fontSize: 12, fontWeight: "500" },
  optionChipTextActive: { color: "#d1d5db", fontWeight: "600" },
  statusRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1A1A20",
  },
  statusLabel: { color: "#AEAEB2", fontSize: 14 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  statusOk: { backgroundColor: "rgba(255,255,255,0.06)" },
  statusOff: { backgroundColor: "rgba(142,142,147,0.12)" },
  statusBadgeText: { fontSize: 11, fontWeight: "600" },
  statusOkText: { color: "#888888" },
  statusOffText: { color: "#555555" },
});
