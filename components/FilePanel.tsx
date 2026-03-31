/**
 * FilePanel - Session file tracker panel.
 * Displays files written during the session, sourced from MongoDB session_files.
 * Uses GET /api/sessions/:sessionId/files endpoint.
 * Supports inline preview: code (via CodeBlock), images, markdown (via MarkdownText).
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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl, getStoredToken } from "@/lib/api-service";
import { CodeBlock } from "@/components/CodeBlock";
import { MarkdownText } from "@/components/MarkdownText";

interface SessionFile {
  name: string;
  path: string;
  size?: number;
  mime_type?: string;
  created_at?: string;
  download_url?: string;
}

interface FilePanelProps {
  sessionId?: string;
  isVisible?: boolean;
  onClose?: () => void;
  onFileSelect?: (file: SessionFile) => void;
}

const CODE_EXTENSIONS = new Set([
  "py", "js", "ts", "tsx", "jsx", "html", "css", "json", "yaml", "yml",
  "sh", "bash", "sql", "xml", "toml", "ini", "conf", "env", "log",
  "go", "rs", "java", "cpp", "c", "h", "rb", "php", "kt", "swift",
  "dart", "r", "scala", "lua", "zig", "vue", "svelte",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const TEXT_EXTENSIONS = new Set(["txt", "rtf", "csv", "tsv"]);

function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

function isCodeFile(name: string): boolean { return CODE_EXTENSIONS.has(getFileExt(name)); }
function isImageFile(name: string): boolean { return IMAGE_EXTENSIONS.has(getFileExt(name)); }
function isMarkdownFile(name: string): boolean { return MARKDOWN_EXTENSIONS.has(getFileExt(name)); }
function isTextFile(name: string): boolean { return TEXT_EXTENSIONS.has(getFileExt(name)); }

function canPreview(name: string): boolean {
  return isCodeFile(name) || isImageFile(name) || isMarkdownFile(name) || isTextFile(name);
}

export function FilePanel({
  sessionId,
  isVisible = false,
  onClose,
  onFileSelect,
}: FilePanelProps) {
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewFile, setPreviewFile] = useState<SessionFile | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewIsMarkdown, setPreviewIsMarkdown] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      const baseUrl = getApiBaseUrl();
      const headers: Record<string, string> = {};
      try {
        const tok = getStoredToken?.();
        if (tok) headers["Authorization"] = `Bearer ${tok}`;
      } catch {}
      const [sandboxRes, gridfsRes] = await Promise.allSettled([
        fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/files`, { credentials: "include", headers }),
        fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gridfs-files`, { credentials: "include", headers }),
      ]);
      const sandboxFiles: SessionFile[] =
        sandboxRes.status === "fulfilled" && sandboxRes.value.ok
          ? ((await sandboxRes.value.json()).files || [])
          : [];
      // GridFS download URL: /api/files/:fileId → GET /api/files/:fileId in routes.ts
      // getDownloadUrl() below prepends getApiBaseUrl() to make it absolute.
      const gridfsFiles: SessionFile[] =
        gridfsRes.status === "fulfilled" && gridfsRes.value.ok
          ? ((await gridfsRes.value.json()).files || []).map((f: any) => ({
              name: f.filename || f.name,
              path: f.filename || f.name,
              size: f.size,
              mime_type: f.mime_type,
              created_at: f.upload_date || f.created_at,
              download_url: f.download_url || `/api/files/${f.file_id}`,
            }))
          : [];
      const seen = new Set<string>();
      const merged: SessionFile[] = [];
      for (const f of [...gridfsFiles, ...sandboxFiles]) {
        const key = f.download_url || f.path || f.name;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      setFiles(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (isVisible && sessionId) {
      loadFiles();
    }
  }, [isVisible, sessionId, loadFiles]);

  const getDownloadUrl = useCallback((file: SessionFile): string => {
    const baseUrl = getApiBaseUrl();
    if (file.download_url) {
      if (file.download_url.startsWith("http")) {
        return file.download_url;
      }
      if (file.download_url.startsWith("/api/files/") && !file.download_url.startsWith("/api/files/download")) {
        return `${baseUrl}${file.download_url}`;
      }
      const normalised = file.download_url.replace("/api/files/download", "/api/sandbox/download");
      return `${baseUrl}${normalised}`;
    }
    return `${baseUrl}/api/sandbox/download?path=${encodeURIComponent(file.path)}&name=${encodeURIComponent(file.name)}`;
  }, []);

  const downloadFile = useCallback(async (file: SessionFile) => {
    const url = getDownloadUrl(file);
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url).catch(() => {});
    }
  }, [getDownloadUrl]);

  const openPreview = useCallback(async (file: SessionFile) => {
    setPreviewFile(file);
    setPreviewContent("");
    setPreviewIsMarkdown(false);
    if (isImageFile(file.name)) return;

    setPreviewLoading(true);
    try {
      const url = getDownloadUrl(file);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n\n[truncated...]" : text;
      setPreviewIsMarkdown(isMarkdownFile(file.name));
      setPreviewContent(truncated);
    } catch (e) {
      setPreviewContent(`Failed to load preview: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  }, [getDownloadUrl]);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewContent("");
  }, []);

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (name: string): keyof typeof Ionicons.glyphMap => {
    const ext = getFileExt(name);
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

  if (previewFile) {
    const isImg = isImageFile(previewFile.name);
    const isCode = isCodeFile(previewFile.name);
    const ext = getFileExt(previewFile.name);
    const imgUrl = isImg ? getDownloadUrl(previewFile) : "";

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={closePreview} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={14} color="#636366" />
            <Text style={styles.backBtnText}>Files</Text>
          </TouchableOpacity>
          <View style={styles.previewHeaderCenter}>
            <Text style={styles.previewFileName} numberOfLines={1}>{previewFile.name}</Text>
          </View>
          <TouchableOpacity style={styles.downloadBtn} onPress={() => downloadFile(previewFile)} activeOpacity={0.7}>
            <Ionicons name="download-outline" size={14} color="#636366" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.previewArea} showsVerticalScrollIndicator>
          {isImg ? (
            <View style={styles.imageContainer}>
              <Image source={{ uri: imgUrl }} style={styles.previewImage} resizeMode="contain" />
            </View>
          ) : previewLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#FFD60A" />
              <Text style={styles.loadingText}>Loading preview...</Text>
            </View>
          ) : isCode ? (
            <View style={styles.codePreviewContainer}>
              <CodeBlock code={previewContent} language={ext} />
            </View>
          ) : previewIsMarkdown ? (
            <View style={styles.markdownPreviewContainer}>
              <MarkdownText text={previewContent} />
            </View>
          ) : (
            <View style={styles.textPreviewContainer}>
              <Text style={styles.previewText} selectable>{previewContent}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="folder-open-outline" size={14} color="#FFD60A" />
          <Text style={styles.headerTitle}>Session Files</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={loadFiles} activeOpacity={0.7}>
            <Ionicons name="refresh-outline" size={14} color="#636366" />
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity style={styles.iconBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={14} color="#636366" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.fileList} showsVerticalScrollIndicator>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#FFD60A" />
            <Text style={styles.loadingText}>Loading files...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle-outline" size={20} color="#FF453A" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={24} color="#8a8780" />
            <Text style={styles.emptyText}>No files created yet</Text>
          </View>
        ) : (
          files.map((file, index) => (
            <TouchableOpacity
              key={index}
              style={styles.fileItem}
              onPress={() => {
                if (canPreview(file.name)) {
                  openPreview(file);
                } else {
                  onFileSelect?.(file);
                }
              }}
              activeOpacity={0.7}
            >
              <View style={styles.fileIcon}>
                <Ionicons name={getFileIcon(file.name)} size={14} color="#5AC8FA" />
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                {file.size !== undefined && (
                  <Text style={styles.fileSize}>{formatSize(file.size)}</Text>
                )}
              </View>
              {canPreview(file.name) && (
                <Ionicons name="eye-outline" size={12} color="#8a8780" style={styles.eyeIcon} />
              )}
              <TouchableOpacity
                style={styles.downloadBtnSmall}
                onPress={(e) => {
                  e.stopPropagation?.();
                  downloadFile(file);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="download-outline" size={12} color="#636366" />
              </TouchableOpacity>
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
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: "rgba(90,200,250,0.12)",
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
  eyeIcon: {
    marginHorizontal: 2,
  },
  downloadBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f3ee",
  },
  downloadBtnSmall: {
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
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  backBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#636366",
  },
  previewHeaderCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  previewFileName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#1a1916",
  },
  previewArea: {
    flex: 1,
    backgroundColor: "#f8f7f4",
  },
  imageContainer: {
    padding: 12,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  previewImage: {
    width: "100%",
    height: 300,
    borderRadius: 8,
  },
  codePreviewContainer: {
    padding: 8,
  },
  markdownPreviewContainer: {
    padding: 16,
    backgroundColor: "#ffffff",
  },
  textPreviewContainer: {
    padding: 16,
    backgroundColor: "#ffffff",
  },
  previewText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#1a1916",
    lineHeight: 22,
  },
});
