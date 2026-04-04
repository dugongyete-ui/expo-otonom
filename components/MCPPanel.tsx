/**
 * MCP Server Management Panel.
 * Allows adding, editing, enabling/disabling, and deleting MCP servers.
 * Backend endpoints: GET/POST /api/mcp/config, PUT/DELETE /api/mcp/config/:name
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
  Alert,
  Platform,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiService, McpServer as MCPServer, McpServerInput } from "@/lib/api-service";

interface MCPPanelProps {
  visible: boolean;
  onClose: () => void;
}

const TRANSPORT_OPTIONS = ["sse", "streamable_http", "stdio"];

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: any;
}) {
  return (
    <View style={fieldStyles.container}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        style={fieldStyles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#636366"
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize || "none"}
        autoCorrect={false}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  container: { marginBottom: 12 },
  label: { color: "#8E8E93", fontSize: 11, fontWeight: "600", marginBottom: 5, textTransform: "uppercase" },
  input: {
    backgroundColor: "#1A1A20",
    borderWidth: 1,
    borderColor: "#2C2C30",
    borderRadius: 8,
    color: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
});

export function MCPPanel({ visible, onClose }: MCPPanelProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);

  const [form, setForm] = useState({
    name: "",
    url: "",
    auth_token: "",
    description: "",
    transport: "sse",
    enabled: true,
  });
  const [tokenChanged, setTokenChanged] = useState(false);

  const fetchServers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiService.getMcpConfig();
      setServers(data.servers || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchServers();
  }, [visible, fetchServers]);

  const resetForm = () => {
    setForm({ name: "", url: "", auth_token: "", description: "", transport: "sse", enabled: true });
    setEditingServer(null);
    setTokenChanged(false);
  };

  const openAddForm = () => {
    resetForm();
    setShowAddForm(true);
  };

  const openEditForm = (server: MCPServer) => {
    setForm({
      name: server.name,
      url: server.url,
      auth_token: "",
      description: server.description || "",
      transport: server.transport || "sse",
      enabled: server.enabled,
    });
    setEditingServer(server);
    setTokenChanged(false);
    setShowAddForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      Alert.alert("Validation", "Name and URL are required");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const isEdit = !!editingServer;
      const baseFields: Partial<McpServerInput> = {
        name: form.name.trim(),
        url: form.url.trim(),
        description: form.description,
        transport: form.transport,
        enabled: form.enabled,
      };
      if (!isEdit || tokenChanged) {
        baseFields.auth_token = form.auth_token;
      }
      if (isEdit) {
        await apiService.updateMcpConfig(editingServer!.name, baseFields);
      } else {
        await apiService.addMcpConfig(baseFields as McpServerInput);
      }
      await fetchServers();
      setShowAddForm(false);
      resetForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (server: MCPServer) => {
    if (Platform.OS === "web") {
      if (!window.confirm(`Delete MCP server "${server.name}"?`)) return;
      doDelete(server.name);
    } else {
      Alert.alert("Delete MCP Server", `Delete "${server.name}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => doDelete(server.name) },
      ]);
    }
  };

  const doDelete = async (name: string) => {
    try {
      await apiService.deleteMcpConfig(name);
      await fetchServers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleEnabled = async (server: MCPServer) => {
    try {
      await apiService.updateMcpConfig(server.name, { enabled: !server.enabled });
      await fetchServers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#AEAEB2" />
          </Pressable>
          <Text style={styles.headerTitle}>MCP Servers</Text>
          <Pressable onPress={openAddForm} style={styles.addBtn}>
            <Ionicons name="add" size={22} color="#888888" />
          </Pressable>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={14} color="#888888" />
            <Text style={styles.errorBannerText}>{error}</Text>
            <Pressable onPress={() => setError(null)}>
              <Ionicons name="close" size={14} color="#888888" />
            </Pressable>
          </View>
        )}

        {showAddForm ? (
          <ScrollView contentContainerStyle={styles.formContainer}>
            <Text style={styles.formTitle}>{editingServer ? `Edit "${editingServer.name}"` : "Add MCP Server"}</Text>
            <FormField label="Name *" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="my-mcp-server" />
            <FormField label="URL *" value={form.url} onChangeText={(v) => setForm((f) => ({ ...f, url: v }))} placeholder="https://mcp.example.com/sse" />
            <FormField
              label={editingServer?.has_auth_token ? "Auth Token (configured — leave blank to keep)" : "Auth Token"}
              value={form.auth_token}
              onChangeText={(v) => { setForm((f) => ({ ...f, auth_token: v })); setTokenChanged(true); }}
              placeholder={editingServer?.has_auth_token ? "Enter new token to replace..." : "Bearer token (optional)"}
              secureTextEntry
            />
            <FormField label="Description" value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="What does this MCP server do?" />

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Transport</Text>
              <View style={styles.segmentRow}>
                {TRANSPORT_OPTIONS.map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.segment, form.transport === t && styles.segmentActive]}
                    onPress={() => setForm((f) => ({ ...f, transport: t }))}
                  >
                    <Text style={[styles.segmentText, form.transport === t && styles.segmentTextActive]}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Enabled</Text>
              <Switch
                value={form.enabled}
                onValueChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                trackColor={{ false: "#2C2C30", true: "#444444" }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.formActions}>
              <Pressable style={styles.cancelBtn} onPress={() => { setShowAddForm(false); resetForm(); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]} onPress={handleSave} disabled={isSaving}>
                {isSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.saveBtnText}>{editingServer ? "Save Changes" : "Add Server"}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.listContainer}>
            {isLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color="#888888" />
                <Text style={styles.loadingText}>Loading MCP servers...</Text>
              </View>
            ) : servers.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="server-outline" size={48} color="#3A3A40" />
                <Text style={styles.emptyTitle}>No MCP Servers</Text>
                <Text style={styles.emptyText}>Add a Model Context Protocol server to extend agent capabilities.</Text>
                <Pressable style={styles.emptyAddBtn} onPress={openAddForm}>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                  <Text style={styles.emptyAddBtnText}>Add Server</Text>
                </Pressable>
              </View>
            ) : (
              servers.map((server) => (
                <View key={server.name} style={[styles.serverCard, !server.enabled && styles.serverCardDisabled]}>
                  <View style={styles.serverCardHeader}>
                    <View style={styles.serverNameRow}>
                      <View style={[styles.statusDot, { backgroundColor: server.enabled ? "#888888" : "#444444" }]} />
                      <Text style={styles.serverName}>{server.name}</Text>
                      <View style={styles.transportBadge}>
                        <Text style={styles.transportText}>{server.transport || "sse"}</Text>
                      </View>
                    </View>
                    <Switch
                      value={server.enabled}
                      onValueChange={() => handleToggleEnabled(server)}
                      trackColor={{ false: "#2C2C30", true: "#444444" }}
                      thumbColor="#FFFFFF"
                      style={{ transform: [{ scale: 0.8 }] }}
                    />
                  </View>

                  <Text style={styles.serverUrl} numberOfLines={1}>{server.url}</Text>
                  {server.description ? <Text style={styles.serverDesc}>{server.description}</Text> : null}

                  <View style={styles.serverActions}>
                    <Pressable style={styles.actionBtn} onPress={() => openEditForm(server)}>
                      <Ionicons name="pencil-outline" size={14} color="#8E8E93" />
                      <Text style={styles.actionBtnText}>Edit</Text>
                    </Pressable>
                    <Pressable style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => handleDelete(server)}>
                      <Ionicons name="trash-outline" size={14} color="#888888" />
                      <Text style={[styles.actionBtnText, { color: "#888888" }]}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
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
  addBtn: { padding: 4 },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
  },
  errorBannerText: { color: "#a0a0a0", fontSize: 13, flex: 1 },
  listContainer: { padding: 16, gap: 12 },
  formContainer: { padding: 16 },
  formTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600", marginBottom: 20 },
  fieldRow: { marginBottom: 12 },
  fieldLabel: { color: "#8E8E93", fontSize: 11, fontWeight: "600", marginBottom: 8, textTransform: "uppercase" },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, paddingVertical: 8, backgroundColor: "#1A1A20", borderWidth: 1, borderColor: "#2C2C30", borderRadius: 8, alignItems: "center" },
  segmentActive: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "#444444" },
  segmentText: { color: "#636366", fontSize: 12 },
  segmentTextActive: { color: "#c0c0c0", fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, marginBottom: 16 },
  switchLabel: { color: "#AEAEB2", fontSize: 14 },
  formActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: "#2C2C30", borderRadius: 10, alignItems: "center" },
  cancelBtnText: { color: "#AEAEB2", fontSize: 14, fontWeight: "500" },
  saveBtn: { flex: 2, paddingVertical: 12, backgroundColor: "#3a3a3a", borderRadius: 10, alignItems: "center" },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  loadingState: { alignItems: "center", paddingVertical: 60, gap: 12 },
  loadingText: { color: "#8E8E93", fontSize: 14 },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  emptyText: { color: "#8E8E93", fontSize: 14, textAlign: "center", paddingHorizontal: 32, lineHeight: 20 },
  emptyAddBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#3a3a3a", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, marginTop: 8 },
  emptyAddBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  serverCard: {
    backgroundColor: "#1A1A20", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#2C2C30",
  },
  serverCardDisabled: { opacity: 0.6 },
  serverCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  serverNameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  serverName: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  transportBadge: { backgroundColor: "#2C2C30", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  transportText: { color: "#636366", fontSize: 10, fontWeight: "600" },
  serverUrl: { color: "#a0a0a0", fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginBottom: 4 },
  serverDesc: { color: "#636366", fontSize: 12, lineHeight: 16, marginBottom: 8 },
  serverActions: { flexDirection: "row", gap: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: "#2C2C30", paddingTop: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: "#2C2C30", borderRadius: 6 },
  actionBtnDanger: { borderColor: "#2a2a2a" },
  actionBtnText: { color: "#8E8E93", fontSize: 12 },
});
