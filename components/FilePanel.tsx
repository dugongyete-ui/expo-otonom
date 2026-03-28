/**
 * FilePanel - Sandbox file browser panel.
 * Matches ai-manus FilePanel.vue pattern.
 * Shows files created during the session in the sandbox workspace.
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl } from "@/lib/api-service";

interface FileInfo {
  name: string;
  path: string;
  size?: number;
  modified?: string;
  is_directory?: boolean;
}

interface FilePanelProps {
  sessionId?: string;
  isVisible?: boolean;
  onClose?: () => void;
  onFileSelect?: (file: FileInfo) => void;
}

export function FilePanel({
  sessionId,
  isVisible = false,
  onClose,
  onFileSelect,
}: FilePanelProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentPath, setCurrentPath] = useState("/home/ubuntu");

  const loadFiles = useCallback(async (path?: string) => {
    const targetPath = path || currentPath;
    setLoading(true);
    setError("");
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/files/list?path=${encodeURIComponent(targetPath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFiles(data.files || []);
      if (path) setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    if (isVisible && sessionId) {
      loadFiles();
    }
  }, [isVisible, sessionId]);

  const navigateToDir = useCallback((dirPath: string) => {
    loadFiles(dirPath);
  }, [loadFiles]);

  const navigateUp = useCallback(() => {
    const parent = currentPath.replace(/\/[^/]+$/, "") || "/";
    loadFiles(parent);
  }, [currentPath, loadFiles]);

  const handleFileClick = useCallback((file: FileInfo) => {
    if (file.is_directory) {
      navigateToDir(file.path);
    } else {
      onFileSelect?.(file);
    }
  }, [navigateToDir, onFileSelect]);

  const downloadFile = useCallback(async (file: FileInfo) => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/files/download?path=${encodeURIComponent(file.path)}`;
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url).catch(() => {});
    }
  }, []);

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (file: FileInfo): keyof typeof Ionicons.glyphMap => {
    if (file.is_directory) return "folder-outline";
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
      py: "logo-python",
      js: "logo-javascript",
      ts: "code-slash-outline",
      tsx: "code-slash-outline",
      html: "code-outline",
      css: "color-palette-outline",
      json: "document-text-outline",
      md: "document-text-outline",
      txt: "document-text-outline",
      png: "image-outline",
      jpg: "image-outline",
      jpeg: "image-outline",
      gif: "image-outline",
      svg: "image-outline",
      pdf: "document-outline",
      zip: "archive-outline",
      tar: "archive-outline",
      gz: "archive-outline",
    };
    return iconMap[ext] || "document-outline";
  };

  if (!isVisible) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="folder-open-outline" size={14} color="#FFD60A" />
          <Text style={styles.headerTitle}>Files</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => loadFiles()}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh-outline" size={14} color="#636366" />
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={14} color="#636366" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Breadcrumb */}
      <View style={styles.breadcrumb}>
        <TouchableOpacity onPress={() => loadFiles("/home/ubuntu")} activeOpacity={0.7}>
          <Text style={styles.breadcrumbText}>~</Text>
        </TouchableOpacity>
        {currentPath !== "/home/ubuntu" && (
          <>
            <Text style={styles.breadcrumbSep}>/</Text>
            <Text style={styles.breadcrumbCurrent} numberOfLines={1}>
              {currentPath.replace("/home/ubuntu/", "")}
            </Text>
          </>
        )}
        {currentPath !== "/home/ubuntu" && (
          <TouchableOpacity style={styles.upBtn} onPress={navigateUp} activeOpacity={0.7}>
            <Ionicons name="arrow-up-outline" size={12} color="#636366" />
          </TouchableOpacity>
        )}
      </View>

      {/* File list */}
      <ScrollView style={styles.fileList} showsVerticalScrollIndicator>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#FFD60A" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle-outline" size={20} color="#FF453A" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={24} color="#8a8780" />
            <Text style={styles.emptyText}>Empty directory</Text>
          </View>
        ) : (
          files.map((file, index) => (
            <TouchableOpacity
              key={index}
              style={styles.fileItem}
              onPress={() => handleFileClick(file)}
              activeOpacity={0.7}
            >
              <View style={[styles.fileIcon, { backgroundColor: file.is_directory ? "rgba(255,214,10,0.12)" : "rgba(90,200,250,0.12)" }]}>
                <Ionicons
                  name={getFileIcon(file)}
                  size={14}
                  color={file.is_directory ? "#FFD60A" : "#5AC8FA"}
                />
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                {!file.is_directory && file.size !== undefined && (
                  <Text style={styles.fileSize}>{formatSize(file.size)}</Text>
                )}
              </View>
              {!file.is_directory && (
                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={() => downloadFile(file)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="download-outline" size={12} color="#636366" />
                </TouchableOpacity>
              )}
              {file.is_directory && (
                <Ionicons name="chevron-forward" size={12} color="#8a8780" />
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderLeftWidth: 1,
    borderLeftColor: "#ddd9d0",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9d0",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#1a1916",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  refreshBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#f5f3ee",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9d0",
    gap: 4,
  },
  breadcrumbText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#5AC8FA",
  },
  breadcrumbSep: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#8a8780",
  },
  breadcrumbCurrent: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#4a4740",
    flex: 1,
  },
  upBtn: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#edebe3",
  },
  fileList: {
    flex: 1,
  },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0ede7",
  },
  fileIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#1a1916",
  },
  fileSize: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#8a8780",
  },
  downloadBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f3ee",
  },
  loadingState: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#8a8780",
  },
  errorState: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#FF453A",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#8a8780",
  },
});
