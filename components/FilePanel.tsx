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
import { NativeIcon } from "@/components/icons/SvgIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  sseFiles?: Array<{ filename: string; download_url: string; sandbox_path?: string; mime?: string }>;
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
  sseFiles = [],
}: FilePanelProps) {
  const insets = useSafeAreaInsets();
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

  type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

  const getFileIconInfo = (name: string): { icon: IoniconName; color: string; bg: string } => {
    const ext = getFileExt(name);
    const codeExts = new Set(["py", "js", "ts", "tsx", "jsx", "html", "css", "json", "sh", "bash", "yaml", "yml", "go", "rs", "java", "cpp", "c", "rb"]);
    const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
    const docExts = new Set(["md", "txt", "rtf", "csv", "pdf"]);
    const archiveExts = new Set(["zip", "tar", "gz", "bz2", "rar", "7z"]);
    if (codeExts.has(ext)) return { icon: "code-slash-outline", color: "#3B82F6", bg: "rgba(59,130,246,0.08)" };
    if (imageExts.has(ext)) return { icon: "image-outline", color: "#8B5CF6", bg: "rgba(139,92,246,0.08)" };
    if (docExts.has(ext)) return { icon: "document-text-outline", color: "#22C55E", bg: "rgba(34,197,94,0.08)" };
    if (archiveExts.has(ext)) return { icon: "archive-outline", color: "#F59E0B", bg: "rgba(245,158,11,0.08)" };
    return { icon: "document-outline", color: "#9CA3AF", bg: "rgba(156,163,175,0.08)" };
  };

  const convertedSseFiles: SessionFile[] = sseFiles.map(f => ({
    name: f.filename,
    path: f.sandbox_path || f.filename,
    mime_type: f.mime,
    download_url: f.download_url,
  }));
  const dbNames = new Set(files.map(f => f.name));
  const extraSseFiles = convertedSseFiles.filter(f => !dbNames.has(f.name));
  const displayFiles = [...files, ...extraSseFiles];

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
            <Ionicons name="chevron-back" size={14} color="#6B7280" />
            <Text style={styles.backBtnText}>Files</Text>
          </TouchableOpacity>
          <View style={styles.previewHeaderCenter}>
            <Text style={styles.previewFileName} numberOfLines={1}>{previewFile.name}</Text>
          </View>
          <TouchableOpacity style={styles.downloadBtn} onPress={() => downloadFile(previewFile)} activeOpacity={0.7}>
            <Ionicons name="download-outline" size={14} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.previewArea} showsVerticalScrollIndicator>
          {isImg ? (
            <View style={styles.imageContainer}>
              <Image source={{ uri: imgUrl }} style={styles.previewImage} resizeMode="contain" />
            </View>
          ) : previewLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#888888" />
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
          <View style={styles.headerIconBox}>
            <Ionicons name="folder-open-outline" size={13} color="#6B7280" />
          </View>
          <Text style={styles.headerTitle}>Session Files</Text>
          {displayFiles.length > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{displayFiles.length}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={loadFiles} activeOpacity={0.7}>
            <Ionicons name="refresh-outline" size={14} color="#6B7280" />
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity style={styles.iconBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={14} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.fileList}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#9CA3AF" />
            <Text style={styles.loadingText}>Loading files...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle-outline" size={22} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : displayFiles.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={32} color="#D1CFC8" />
            <Text style={styles.emptyTitle}>No files yet</Text>
            <Text style={styles.emptyText}>Files created by the agent will appear here</Text>
          </View>
        ) : (
          displayFiles.map((file, index) => {
            const fileIconInfo = getFileIconInfo(file.name);
            return (
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
                activeOpacity={0.75}
              >
                <View style={[styles.fileIcon, { backgroundColor: fileIconInfo.bg }]}>
                  <Ionicons name={fileIconInfo.icon} size={14} color={fileIconInfo.color} />
                </View>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                  <View style={styles.fileMetaRow}>
                    <Text style={styles.fileExt}>{getFileExt(file.name).toUpperCase()}</Text>
                    {file.size !== undefined && (
                      <Text style={styles.fileSize}>{formatSize(file.size)}</Text>
                    )}
                  </View>
                </View>
                {canPreview(file.name) && (
                  <Ionicons name="eye-outline" size={13} color="#C4C2BA" />
                )}
                <TouchableOpacity
                  style={styles.downloadBtnSmall}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    downloadFile(file);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="download-outline" size={13} color="#9CA3AF" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F4EF",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E3DC",
    backgroundColor: "#F5F4EF",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  headerIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "#E5E3DC",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#1A1A1A",
  },
  headerBadge: {
    backgroundColor: "#E5E3DC",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  headerBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#6B7280",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E3DC",
  },
  fileList: {
    flex: 1,
  },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EAE8E1",
  },
  fileIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileInfo: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  fileName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12.5,
    color: "#1A1A1A",
    lineHeight: 16,
  },
  fileMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fileExt: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#B0ADA5",
    letterSpacing: 0.3,
  },
  fileSize: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#B0ADA5",
  },
  downloadBtnSmall: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECEAE2",
    flexShrink: 0,
  },
  loadingState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 10,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#9CA3AF",
  },
  errorState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
    paddingHorizontal: 24,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#EF4444",
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#9CA3AF",
    marginTop: 4,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#B0ADA5",
    textAlign: "center",
    lineHeight: 18,
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
    color: "#6B7280",
  },
  downloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECEAE2",
  },
  previewHeaderCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  previewFileName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#1A1A1A",
  },
  previewArea: {
    flex: 1,
    backgroundColor: "#F5F4EF",
  },
  imageContainer: {
    padding: 16,
    alignItems: "center",
    backgroundColor: "#F0EEE6",
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
  },
  textPreviewContainer: {
    padding: 16,
  },
  previewText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#374151",
    lineHeight: 22,
  },
});
