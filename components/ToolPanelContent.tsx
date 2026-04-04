/**
 * ToolPanelContent - Rich tool content views matching ai-manus workflow.
 * Displays detailed, type-specific content for each tool execution:
 * - ShellView: Terminal output with command prompt styling
 * - BrowserView: Screenshot/URL with Take Over button
 * - FileView: File content with syntax highlighting info
 * - SearchView: Search results with clickable links
 * - McpView: MCP tool execution details
 * - TodoView: Todo list with checkboxes
 * - TaskView: Task execution details
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import { VNCViewer } from "./VNCViewer";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  Platform,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TOOL_COLOR_MAP, TOOL_ICON_MAP, getToolCategory } from "@/lib/tool-constants";
import { getApiBaseUrl, getStoredToken } from "@/lib/api-service";
import { ShellIcon, BrowserIcon, EditIcon, SearchIcon, McpIcon, TakeOverIcon } from "./icons/ToolIcons";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolContentData {
  type: string;
  // Shell
  command?: string;
  console?: string;
  stdout?: string;
  stderr?: string;
  return_code?: number;
  id?: string;
  backend?: string;
  // Browser
  url?: string;
  title?: string;
  content?: string;
  screenshot_b64?: string;
  save_path?: string;
  // File
  file?: string;
  filename?: string;
  operation?: string;
  language?: string;
  download_url?: string;
  // Search
  query?: string;
  results?: Array<{ title: string; url: string; snippet?: string }>;
  // MCP
  tool?: string;
  tool_name?: string;
  server?: string;
  arguments?: Record<string, unknown> | string;
  result?: string;
  // Image
  image_b64?: string;
  image_url?: string;
  // Todo
  todo_type?: string;
  items?: Array<{ text: string; done: boolean }>;
  total?: number;
  done?: number;
  item?: string;
  message?: string;
  // Task
  task_type?: string;
  tasks?: Array<{ id?: string; description?: string; status?: string }>;
  task_id?: string;
}

interface ToolPanelContentProps {
  toolContent: ToolContentData | null;
  toolName: string;
  functionName: string;
  functionArgs?: Record<string, unknown>;
  functionResult?: string;
  status: "calling" | "called" | "error";
  sessionId?: string;
  isLive?: boolean;
  onTakeOver?: () => void;
  onSwitchToBrowser?: () => void;
  onMinimize?: () => void;
  agentVncSession?: { e2bSessionId?: string; vncUrl?: string } | null;
}

// ─── Shell Output Renderer (green PS1 + output per line) ─────────────────────

function ShellOutput({ output }: { output: string }) {
  if (!output) return null;

  const lines = output.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line && i === lines.length - 1) continue;
    const isPrompt = line.match(/^\$\s/) || line.match(/^ubuntu@/) || line.match(/^#\s/);
    elements.push(
      <Text key={i} style={isPrompt ? shellOutputStyles.promptLine : shellOutputStyles.outputLine} selectable>
        {line || " "}
      </Text>
    );
  }

  return <View>{elements}</View>;
}

const shellOutputStyles = StyleSheet.create({
  promptLine: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#00bb00",
    lineHeight: 17,
  },
  outputLine: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#d1d5db",
    lineHeight: 17,
  },
});

// ─── Shell Tool View ─────────────────────────────────────────────────────────

function ShellToolView({
  content,
  status,
  functionArgs,
  sessionId,
  isLive,
}: {
  content: ToolContentData | null;
  status: string;
  functionArgs?: Record<string, unknown>;
  sessionId?: string;
  isLive?: boolean;
}) {
  const command = content?.command || (functionArgs?.command as string) || "";
  const stdout = content?.stdout || "";
  const stderr = content?.stderr || "";
  const [liveContent, setLiveContent] = useState("");
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const consoleOutput = liveContent || content?.console || stdout + (stderr ? "\n" + stderr : "");
  const returnCode = content?.return_code;
  const isRunning = status === "calling";
  const backend = content?.backend || "";
  const shellId = content?.id || "";

  // Live content fetching - matches ai-manus ShellToolView.vue auto-refresh
  const loadShellContent = useCallback(async () => {
    if (!sessionId || !shellId) return;
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const headers: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
      const res = await fetch(`${baseUrl}/api/sandbox/shell/${sessionId}?shell_id=${encodeURIComponent(shellId)}`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data.shells && data.shells.length > 0) {
        const latest = data.shells[data.shells.length - 1];
        if (latest.console) {
          setLiveContent(latest.console);
        }
      }
    } catch {
      // Ignore fetch errors for live content
    }
  }, [sessionId, shellId]);

  // Auto-refresh when live and running (5s intervals like ai-manus)
  useEffect(() => {
    if (isLive && isRunning && sessionId && shellId) {
      loadShellContent();
      refreshTimerRef.current = setInterval(loadShellContent, 5000);
      return () => {
        if (refreshTimerRef.current) {
          clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      };
    }
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [isLive, isRunning, sessionId, shellId, loadShellContent]);

  return (
    <View style={styles.viewContainer}>
      {/* Command header with shell ID */}
      {command ? (
        <View style={styles.shellCommandBar}>
          <View style={styles.shellPromptContainer}>
            <Text style={styles.shellPs1}>$</Text>
            <Text style={styles.shellCommandText} numberOfLines={3} selectable>
              {command}
            </Text>
          </View>
          <View style={styles.shellBadgeRow}>
            {shellId ? (
              <View style={styles.shellIdBadge}>
                <Text style={styles.shellIdText}>{shellId}</Text>
              </View>
            ) : null}
            {backend ? (
              <View style={styles.backendBadge}>
                <Text style={styles.backendBadgeText}>{backend}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Output */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.shellOutputScroll}
        showsVerticalScrollIndicator
        contentContainerStyle={styles.shellOutputContent}
      >
        {isRunning && !consoleOutput ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Executing...</Text>
          </View>
        ) : consoleOutput ? (
          <ShellOutput output={consoleOutput} />
        ) : (
          <Text style={styles.emptyOutputText}>No output</Text>
        )}
      </ScrollView>

      {/* Return code */}
      {returnCode !== undefined && returnCode !== null && (
        <View style={styles.shellFooter}>
          <View
            style={[
              styles.returnCodeBadge,
              { backgroundColor: returnCode === 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.04)" },
            ]}
          >
            <Text
              style={[
                styles.returnCodeText,
                { color: returnCode === 0 ? "#888888" : "#666666" },
              ]}
            >
              exit {returnCode}
            </Text>
          </View>
          {isLive && isRunning && (
            <TouchableOpacity onPress={loadShellContent} activeOpacity={0.7} style={styles.refreshBtn}>
              <Ionicons name="refresh-outline" size={12} color="#636366" />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Browser Tool View ───────────────────────────────────────────────────────

function BrowserToolView({
  content,
  status,
  functionArgs,
  onTakeOver,
  onSwitchToBrowser,
  agentVncSession,
}: {
  content: ToolContentData | null;
  status: string;
  functionArgs?: Record<string, unknown>;
  onTakeOver?: () => void;
  onSwitchToBrowser?: () => void;
  agentVncSession?: { e2bSessionId?: string; vncUrl?: string } | null;
}) {
  const url = content?.url || (functionArgs?.url as string) || "";
  const title = content?.title || "";
  const screenshotB64 = content?.screenshot_b64 || "";
  const isRunning = status === "calling";
  // Show live VNC stream when tool is actively running and a VNC session exists
  const hasVncSession = isRunning && !!agentVncSession?.e2bSessionId;

  return (
    <View style={styles.viewContainer}>
      {/* URL Bar */}
      {url ? (
        <TouchableOpacity
          style={styles.browserUrlBar}
          onPress={() => {
            if (Platform.OS === "web") {
              window.open(url, "_blank");
            } else {
              Linking.openURL(url).catch(() => {});
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="lock-closed" size={10} color="#888888" />
          <Text style={styles.browserUrlText} numberOfLines={1}>
            {url}
          </Text>
          <Ionicons name="open-outline" size={12} color="#636366" />
        </TouchableOpacity>
      ) : null}

      {/* Title */}
      {title ? (
        <Text style={styles.browserTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : null}

      {/* Live VNC stream, screenshot, or loading — with floating Take Over button */}
      <View style={styles.browserPreview}>
        {hasVncSession && Platform.OS === "web" ? (
          // Live mode: show VNCViewer iframe when session is active (web only)
          <VNCViewer
            sessionId={agentVncSession!.e2bSessionId!}
            enabled={true}
            viewOnly={true}
          />
        ) : screenshotB64 ? (
          <Image
            source={{ uri: screenshotB64.startsWith("data:") ? screenshotB64 : `data:image/png;base64,${screenshotB64}` }}
            style={styles.screenshotImage}
            resizeMode="contain"
          />
        ) : isRunning ? (
          <View style={styles.browserLoading}>
            <ActivityIndicator size="large" color="#888888" />
            <Text style={styles.browserLoadingText}>Loading page...</Text>
          </View>
        ) : (
          <View style={styles.browserEmpty}>
            <Ionicons name="globe-outline" size={32} color="#2A2A32" />
            <Text style={styles.browserEmptyText}>No preview available</Text>
          </View>
        )}

        {/* Floating Take Over button — bottom right overlay */}
        {onTakeOver && (
          <TouchableOpacity
            style={styles.takeOverFloating}
            onPress={onTakeOver}
            activeOpacity={0.8}
          >
            <TakeOverIcon size={16} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Switch to desktop button — bottom bar only */}
      {onSwitchToBrowser && (
        <View style={styles.browserActions}>
          <TouchableOpacity
            style={styles.browserActionBtn}
            onPress={onSwitchToBrowser}
            activeOpacity={0.7}
          >
            <Ionicons name="desktop-outline" size={14} color="#888888" />
            <Text style={styles.browserActionText}>View Desktop</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── File Tool View ──────────────────────────────────────────────────────────

function FileToolView({
  content,
  status,
  functionArgs,
  sessionId,
  isLive,
}: {
  content: ToolContentData | null;
  status: string;
  functionArgs?: Record<string, unknown>;
  sessionId?: string;
  isLive?: boolean;
}) {
  const filePath = content?.file || (functionArgs?.file as string) || (functionArgs?.path as string) || "";
  const fileName = filePath.split("/").pop() || content?.filename || "";
  const [liveContent, setLiveContent] = useState("");
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileContent = liveContent || content?.content || "";
  const operation = content?.operation || "";
  const language = content?.language || detectLanguage(fileName);
  const downloadUrl = content?.download_url || "";
  const isRunning = status === "calling";

  const operationLabel =
    operation === "write" ? "Written" :
    operation === "read" ? "Read" :
    operation === "str_replace" ? "Modified" :
    operation === "find_by_name" ? "Found" :
    operation === "find_in_content" ? "Searched" :
    operation || "File";

  // Live content fetching - matches ai-manus FileToolView.vue
  const loadFileContent = useCallback(async () => {
    if (!sessionId || !filePath) return;
    try {
      const baseUrl = getApiBaseUrl();
      const token = getStoredToken();
      const headers: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
      const res = await fetch(`${baseUrl}/api/sandbox/file/${sessionId}?path=${encodeURIComponent(filePath)}`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        const latest = data.files[data.files.length - 1];
        if (latest.content) {
          setLiveContent(latest.content);
        }
      }
    } catch {
      // Ignore fetch errors for live content
    }
  }, [sessionId, filePath]);

  // Auto-refresh when live and running
  useEffect(() => {
    if (isLive && isRunning && sessionId) {
      loadFileContent();
      refreshTimerRef.current = setInterval(loadFileContent, 5000);
      return () => {
        if (refreshTimerRef.current) {
          clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      };
    }
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [isLive, isRunning, sessionId, loadFileContent]);

  return (
    <View style={styles.viewContainer}>
      {/* File header */}
      <View style={styles.fileHeader}>
        <View style={styles.fileHeaderLeft}>
          <EditIcon size={16} color="#888888" />
          <Text style={styles.fileNameText} numberOfLines={1}>
            {fileName || filePath || "File"}
          </Text>
        </View>
        <View style={styles.fileHeaderRight}>
          {language ? (
            <View style={styles.languageBadge}>
              <Text style={styles.languageBadgeText}>{language}</Text>
            </View>
          ) : null}
          <View style={[styles.operationBadge, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
            <Text style={[styles.operationBadgeText, { color: "#888888" }]}>
              {operationLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* File path */}
      {filePath ? (
        <Text style={styles.filePathText} numberOfLines={1} selectable>
          {filePath}
        </Text>
      ) : null}

      {/* Content preview with line numbers */}
      <ScrollView
        style={styles.fileContentScroll}
        showsVerticalScrollIndicator
        contentContainerStyle={styles.fileContentContainer}
      >
        {isRunning ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Processing file...</Text>
          </View>
        ) : fileContent ? (
          <View style={styles.fileContentWithLines}>
            {/* Line numbers gutter */}
            <View style={styles.lineNumberGutter}>
              {fileContent.split("\n").map((_: string, i: number) => (
                <Text key={i} style={styles.lineNumber}>{i + 1}</Text>
              ))}
            </View>
            {/* Syntax-highlighted code content */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeScrollH}>
              <View style={styles.codeLines}>
                {fileContent.split("\n").map((line: string, i: number) => (
                  <SyntaxHighlightedLine key={i} line={line} language={language} />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : (
          <Text style={styles.emptyOutputText}>No content preview</Text>
        )}
      </ScrollView>

      {/* Download link */}
      {downloadUrl ? (
        <TouchableOpacity
          style={styles.downloadBtn}
          onPress={() => {
            if (Platform.OS === "web") {
              window.open(downloadUrl, "_blank");
            } else {
              Linking.openURL(downloadUrl).catch(() => {});
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="download-outline" size={14} color="#888888" />
          <Text style={styles.downloadBtnText}>Download</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Helper: detect language from file extension
function detectLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    py: "python", js: "javascript", ts: "typescript", tsx: "tsx", jsx: "jsx",
    html: "html", css: "css", json: "json", md: "markdown", yml: "yaml",
    yaml: "yaml", sh: "shell", bash: "shell", rs: "rust", go: "go",
    java: "java", cpp: "c++", c: "c", rb: "ruby", php: "php",
    sql: "sql", xml: "xml", toml: "toml", ini: "ini",
  };
  return langMap[ext] || "";
}

// ─── Syntax Highlighter (token-level, regex-based) ───────────────────────────
// Token types with corresponding colors (dark theme)
const TOKEN_COLORS: Record<string, string> = {
  keyword: "#C792EA",   // purple
  string: "#C3E88D",    // green
  comment: "#546E7A",   // grey-blue
  number: "#F78C6C",    // orange
  operator: "#89DDFF",  // cyan
  type: "#FFCB6B",      // yellow
  function: "#82AAFF",  // blue
  builtin: "#FF5370",   // red
  default: "#EEFFFF",   // near-white
};

type Token = { text: string; type: string };

function tokenizeLine(line: string, language: string): Token[] {
  const tokens: Token[] = [];
  let remaining = line;

  const eatToken = (text: string, type: string) => {
    tokens.push({ text, type });
    remaining = remaining.slice(text.length);
  };

  while (remaining.length > 0) {
    // Comments
    if (remaining.startsWith("//") || remaining.startsWith("#")) {
      eatToken(remaining, "comment");
      break;
    }
    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/");
      eatToken(end >= 0 ? remaining.slice(0, end + 2) : remaining, "comment");
      continue;
    }
    if (remaining.startsWith("--")) {
      eatToken(remaining, "comment");
      break;
    }

    // Strings
    const strMatch = remaining.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
    if (strMatch) { eatToken(strMatch[0], "string"); continue; }

    // Numbers
    const numMatch = remaining.match(/^\b-?\d+(\.\d+)?\b/);
    if (numMatch) { eatToken(numMatch[0], "number"); continue; }

    // Keywords by language
    let kwMatch: RegExpMatchArray | null = null;
    if (language === "python") kwMatch = remaining.match(/^(def|class|return|if|elif|else|for|while|break|continue|import|from|as|try|except|finally|raise|with|lambda|in|not|and|or|is|pass|None|True|False|global|nonlocal|yield|assert|del)\b/);
    else if (language === "go") kwMatch = remaining.match(/^(func|var|const|type|struct|interface|map|chan|if|else|for|range|return|break|continue|switch|case|default|import|package|defer|go|select|nil|true|false)\b/);
    else if (language === "rust") kwMatch = remaining.match(/^(fn|let|mut|const|struct|enum|impl|trait|use|mod|pub|priv|type|return|if|else|match|for|while|loop|break|continue|in|as|where|self|Self|super|true|false)\b/);
    else if (language === "sql") kwMatch = remaining.match(/^(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|GROUP|ORDER|BY|HAVING|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|INTO|VALUES|SET|DISTINCT|LIMIT|OFFSET|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|NULL|COUNT|SUM|AVG|MAX|MIN)\b/i);
    else kwMatch = remaining.match(/^(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|default|from|async|await|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|this|super|null|undefined|true|false|void|yield|static|get|set)\b/);
    if (kwMatch) { eatToken(kwMatch[0], "keyword"); continue; }

    // Function calls: word(
    const fnMatch = remaining.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/);
    if (fnMatch) { eatToken(fnMatch[0], "function"); continue; }

    // Types / classes (CapitalCase identifier)
    const typeMatch = remaining.match(/^[A-Z][a-zA-Z0-9_]*/);
    if (typeMatch) { eatToken(typeMatch[0], "type"); continue; }

    // Operators
    const opMatch = remaining.match(/^(===|!==|==|!=|<=|>=|=>|->|::|&&|\|\||[+\-*/<>!&|^~=:?])/);
    if (opMatch) { eatToken(opMatch[0], "operator"); continue; }

    // Identifier / word
    const wordMatch = remaining.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (wordMatch) { eatToken(wordMatch[0], "default"); continue; }

    // Eat one character as default
    eatToken(remaining[0], "default");
  }

  return tokens;
}

function SyntaxHighlightedLine({ line, language }: { line: string; language: string }) {
  if (!language || language === "markdown" || language === "text") {
    return <Text style={syntaxStyles.codeLine} selectable>{line || " "}</Text>;
  }
  const tokens = tokenizeLine(line || " ", language);
  return (
    <Text style={syntaxStyles.codeLine} selectable>
      {tokens.map((token, i) => (
        <Text key={i} style={{ color: TOKEN_COLORS[token.type] || TOKEN_COLORS.default }}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

const syntaxStyles = StyleSheet.create({
  codeLine: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 18,
    color: TOKEN_COLORS.default,
  },
});

// ─── Search Tool View ────────────────────────────────────────────────────────

function SearchToolView({
  content,
  status,
  functionArgs,
}: {
  content: ToolContentData | null;
  status: string;
  functionArgs?: Record<string, unknown>;
}) {
  const query = content?.query || (functionArgs?.query as string) || "";
  const results = content?.results || [];
  const isRunning = status === "calling";

  return (
    <View style={styles.viewContainer}>
      {/* Search query */}
      {query ? (
        <View style={styles.searchQueryBar}>
          <Ionicons name="search" size={14} color="#888888" />
          <Text style={styles.searchQueryText} numberOfLines={2}>
            {query}
          </Text>
        </View>
      ) : null}

      {/* Results */}
      <ScrollView
        style={styles.searchResultsScroll}
        showsVerticalScrollIndicator
        contentContainerStyle={styles.searchResultsContent}
      >
        {isRunning ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Searching...</Text>
          </View>
        ) : results.length > 0 ? (
          results.map((result, index) => (
            <TouchableOpacity
              key={index}
              style={styles.searchResultItem}
              onPress={() => {
                if (result.url) {
                  if (Platform.OS === "web") {
                    window.open(result.url, "_blank");
                  } else {
                    Linking.openURL(result.url).catch(() => {});
                  }
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.searchResultTitle} numberOfLines={1}>
                {result.title || result.url}
              </Text>
              <Text style={styles.searchResultUrl} numberOfLines={1}>
                {result.url}
              </Text>
              {result.snippet ? (
                <Text style={styles.searchResultSnippet} numberOfLines={3}>
                  {result.snippet}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyOutputText}>No results found</Text>
        )}
      </ScrollView>

      {/* Result count */}
      {results.length > 0 && (
        <View style={styles.searchFooter}>
          <Text style={styles.searchCountText}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── MCP Tool View ───────────────────────────────────────────────────────────

function McpToolView({
  content,
  status,
  functionArgs,
}: {
  content: ToolContentData | null;
  status: string;
  functionArgs?: Record<string, unknown>;
}) {
  const toolName = content?.tool_name || content?.tool || (functionArgs?.tool_name as string) || "";
  const server = content?.server || (functionArgs?.server as string) || "";
  const result = content?.result || "";
  const isRunning = status === "calling";
  const args = content?.arguments || functionArgs?.arguments;

  return (
    <View style={styles.viewContainer}>
      {/* MCP tool name */}
      <View style={styles.mcpHeader}>
        <Ionicons name="extension-puzzle-outline" size={14} color="#888888" />
        <Text style={styles.mcpToolName}>{toolName || "MCP Tool"}</Text>
        <View style={[styles.statusDot, { backgroundColor: "#666666" }]} />
      </View>

      {/* Server */}
      {server ? (
        <View style={styles.mcpServerRow}>
          <Ionicons name="server-outline" size={12} color="#8E8E93" />
          <Text style={styles.mcpServerText}>{server}</Text>
        </View>
      ) : null}

      {/* Arguments */}
      {args && (
        <View style={styles.mcpSection}>
          <Text style={styles.mcpSectionLabel}>Arguments</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {typeof args === "string" ? args : JSON.stringify(args, null, 2)}
            </Text>
          </View>
        </View>
      )}

      {/* Result */}
      <ScrollView style={styles.mcpResultScroll} showsVerticalScrollIndicator>
        {isRunning ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Calling MCP tool...</Text>
          </View>
        ) : result ? (
          <View style={styles.mcpSection}>
            <Text style={styles.mcpSectionLabel}>Result</Text>
            <View style={styles.codeBlock}>
              <Text style={styles.codeText} selectable>
                {result}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Todo Tool View ──────────────────────────────────────────────────────────

function TodoToolView({
  content,
  status,
}: {
  content: ToolContentData | null;
  status: string;
}) {
  const items = content?.items || [];
  const title = content?.title || "Todo List";
  const total = content?.total || items.length;
  const doneCount = content?.done || items.filter(i => i.done).length;
  const message = content?.message || "";
  const isRunning = status === "calling";

  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    <View style={styles.viewContainer}>
      <View style={styles.todoHeader}>
        <Ionicons name="checkmark-circle-outline" size={14} color="#888888" />
        <Text style={styles.todoTitle}>{title}</Text>
        <Text style={styles.todoCount}>{doneCount}/{total}</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.todoProgressBar}>
        <View style={[styles.todoProgressFill, { width: `${progress}%` }]} />
      </View>

      <ScrollView style={styles.todoListScroll} showsVerticalScrollIndicator>
        {isRunning ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Updating todo...</Text>
          </View>
        ) : items.length > 0 ? (
          items.map((item, index) => (
            <View key={index} style={styles.todoItem}>
              <Ionicons
                name={item.done ? "checkmark-circle" : "ellipse-outline"}
                size={16}
                color={item.done ? "#888888" : "#555555"}
              />
              <Text style={[styles.todoItemText, item.done && styles.todoItemDone]}>
                {item.text}
              </Text>
            </View>
          ))
        ) : message ? (
          <Text style={styles.todoMessage}>{message}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Task Tool View ──────────────────────────────────────────────────────────

function TaskToolView({
  content,
  status,
}: {
  content: ToolContentData | null;
  status: string;
}) {
  const tasks = content?.tasks || [];
  const taskType = content?.task_type || "";
  const message = content?.message || "";
  const isRunning = status === "calling";

  const typeLabel =
    taskType === "task_create" ? "Created" :
    taskType === "task_complete" ? "Completed" :
    taskType === "task_list" ? "Listed" :
    "Task";

  return (
    <View style={styles.viewContainer}>
      <View style={styles.taskHeader}>
        <Ionicons name="list-circle-outline" size={14} color="#888888" />
        <Text style={styles.taskTitle}>Tasks</Text>
        <View style={styles.taskTypeBadge}>
          <Text style={styles.taskTypeText}>{typeLabel}</Text>
        </View>
      </View>

      <ScrollView style={styles.taskListScroll} showsVerticalScrollIndicator>
        {isRunning ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Processing task...</Text>
          </View>
        ) : tasks.length > 0 ? (
          tasks.map((task, index) => (
            <View key={index} style={styles.taskItem}>
              <View style={styles.taskItemHeader}>
                <Text style={styles.taskItemId}>{task.id || `#${index + 1}`}</Text>
                {task.status && (
                  <View style={[styles.taskStatusBadge, {
                    backgroundColor: "rgba(255,255,255,0.05)"
                  }]}>
                    <Text style={[styles.taskStatusText, {
                      color: task.status === "completed" ? "#888888" :
                        task.status === "running" ? "#a0a0a0" : "#606060"
                    }]}>
                      {task.status}
                    </Text>
                  </View>
                )}
              </View>
              {task.description && (
                <Text style={styles.taskItemDesc}>{task.description}</Text>
              )}
            </View>
          ))
        ) : message ? (
          <Text style={styles.taskMessage}>{message}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Message Tool View ───────────────────────────────────────────────────────

function MessageToolView({
  content,
  functionArgs,
}: {
  content: ToolContentData | null;
  functionArgs?: Record<string, unknown>;
}) {
  const text = content?.text || (functionArgs?.text as string) || (functionArgs?.message as string) || "";
  const isAsk = content?.is_ask || false;

  return (
    <View style={styles.viewContainer}>
      <View style={styles.messageHeader}>
        <Ionicons
          name={isAsk ? "chatbubble-ellipses-outline" : "chatbubble-outline"}
          size={14}
          color="#888888"
        />
        <Text style={styles.messageType}>{isAsk ? "Question to User" : "Notification"}</Text>
      </View>
      <View style={styles.messageContent}>
        <Text style={styles.messageText} selectable>
          {text}
        </Text>
      </View>
    </View>
  );
}

// ─── Image Tool View ──────────────────────────────────────────────────────

function ImageToolView({
  content,
  status,
  functionArgs,
}: {
  content: ToolContentData | null;
  status: string;
  functionArgs?: Record<string, unknown>;
}) {
  const filePath = content?.file || (functionArgs?.image as string) || (functionArgs?.file as string) || (functionArgs?.path as string) || "";
  const fileName = filePath.split("/").pop() || content?.filename || "";
  const imageB64 = content?.image_b64 || content?.screenshot_b64 || "";
  const imageUrl = content?.image_url || "";
  const isRunning = status === "calling";

  const imageSource = imageUrl
    ? imageUrl
    : imageB64
      ? (imageB64.startsWith("data:") ? imageB64 : `data:image/png;base64,${imageB64}`)
      : "";

  return (
    <View style={styles.viewContainer}>
      {/* File name header */}
      {fileName ? (
        <View style={styles.fileHeader}>
          <View style={styles.fileHeaderLeft}>
            <Ionicons name="image-outline" size={16} color="#888888" />
            <Text style={styles.fileNameText} numberOfLines={1}>
              {fileName}
            </Text>
          </View>
        </View>
      ) : null}

      {/* File path */}
      {filePath ? (
        <Text style={styles.filePathText} numberOfLines={1} selectable>
          {filePath}
        </Text>
      ) : null}

      {/* Image preview */}
      <View style={styles.browserPreview}>
        {imageSource ? (
          <Image
            source={{ uri: imageSource }}
            style={styles.screenshotImage}
            resizeMode="contain"
          />
        ) : isRunning ? (
          <View style={styles.browserLoading}>
            <ActivityIndicator size="large" color="#888888" />
            <Text style={styles.browserLoadingText}>Loading image...</Text>
          </View>
        ) : (
          <View style={styles.browserEmpty}>
            <Ionicons name="image-outline" size={32} color="#2A2A32" />
            <Text style={styles.browserEmptyText}>No image preview</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Fallback View ───────────────────────────────────────────────────────────

function FallbackToolView({
  functionResult,
  functionArgs,
  status,
}: {
  functionResult?: string;
  functionArgs?: Record<string, unknown>;
  status: string;
}) {
  const isRunning = status === "calling";

  return (
    <View style={styles.viewContainer}>
      {functionArgs && Object.keys(functionArgs).length > 0 && (
        <View style={styles.mcpSection}>
          <Text style={styles.mcpSectionLabel}>Input</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {JSON.stringify(functionArgs, null, 2)}
            </Text>
          </View>
        </View>
      )}

      <ScrollView style={styles.mcpResultScroll} showsVerticalScrollIndicator>
        {isRunning ? (
          <View style={styles.runningIndicator}>
            <ActivityIndicator size="small" color="#888888" />
            <Text style={styles.runningLabel}>Processing...</Text>
          </View>
        ) : functionResult ? (
          <View style={styles.mcpSection}>
            <Text style={styles.mcpSectionLabel}>Output</Text>
            <View style={styles.codeBlock}>
              <Text style={styles.codeText} selectable>
                {functionResult}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Live Pulse Dot ──────────────────────────────────────────────────────────

function LivePulseDot() {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, easing: Easing.linear, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return <Animated.View style={[styles.liveIndicator, { opacity: pulseAnim, backgroundColor: "#4a7cf0" }]} />;
}

// ─── Main Component ──────────────────────────────────────────────────────────

// Helper: render custom icon based on tool category
function renderCategoryIcon(category: string, color: string) {
  switch (category) {
    case "shell":
      return <ShellIcon size={14} color={color} />;
    case "browser":
      return <BrowserIcon size={14} color={color} />;
    case "file":
      return <EditIcon size={14} color={color} />;
    case "search":
      return <SearchIcon size={14} color={color} />;
    case "mcp":
      return <McpIcon size={14} color={color} />;
    case "image":
      return <Ionicons name="image-outline" size={14} color={color} />;
    default:
      return <Ionicons name="settings-outline" size={14} color={color} />;
  }
}

// ─── Tool display name map ────────────────────────────────────────────────────

const TOOL_NAME_MAP: Record<string, string> = {
  shell: "Terminal",
  file: "File Editor",
  browser: "Browser",
  desktop: "Desktop",
  search: "Web Search",
  info: "Information",
  message: "Message",
  mcp: "MCP Tool",
  todo: "Todo",
  task: "Task",
  image: "Image Viewer",
  multimedia: "Multimedia",
  email: "Email",
  idle: "Idle",
};

// ─── Tool arg label builder for ToolPanelContent header ──────────────────────

function buildArgLabel(fnName: string, args?: Record<string, unknown>): string {
  if (!args) return "";
  const fnLower = fnName || "";
  if (fnLower === "browser_navigate" || fnLower === "web_browse") {
    const url = String(args.url || args.page || "");
    return url ? url.slice(0, 60) : "";
  }
  if (fnLower === "web_search" || fnLower === "info_search_web") {
    return String(args.query || args.q || "").slice(0, 60);
  }
  if (fnLower === "shell_exec") return String(args.command || args.cmd || "").slice(0, 60);
  if (fnLower.startsWith("file_")) {
    const file = String(args.file || args.path || "").replace(/^\/home\/ubuntu\//, "~/");
    return file.slice(0, 60);
  }
  if (fnLower === "browser_click") return String(args.selector || args.element || args.label || args.text || "").slice(0, 50);
  if (fnLower === "browser_type" || fnLower === "browser_input") return String(args.text || args.value || "").slice(0, 50);
  const firstKey = Object.keys(args).find(k => k !== "sudo" && k !== "attachments");
  return firstKey ? String(args[firstKey] || "").slice(0, 60) : "";
}

export function ToolPanelContent({
  toolContent,
  toolName,
  functionName,
  functionArgs,
  functionResult,
  status,
  sessionId,
  isLive,
  onTakeOver,
  onSwitchToBrowser,
  onMinimize,
  agentVncSession,
}: ToolPanelContentProps) {
  const contentType = toolContent?.type || getToolCategory(functionName || toolName);
  const category = getToolCategory(functionName || toolName);
  const color = TOOL_COLOR_MAP[category] || "#8E8E93";

  const argLabel = buildArgLabel(functionName || toolName, functionArgs);

  const renderContent = () => {
    switch (contentType) {
      case "shell":
        return (
          <ShellToolView
            content={toolContent}
            status={status}
            functionArgs={functionArgs}
            sessionId={sessionId}
            isLive={isLive}
          />
        );
      case "browser":
        return (
          <BrowserToolView
            content={toolContent}
            status={status}
            functionArgs={functionArgs}
            onTakeOver={onTakeOver}
            onSwitchToBrowser={onSwitchToBrowser}
            agentVncSession={agentVncSession}
          />
        );
      case "file":
        return (
          <FileToolView
            content={toolContent}
            status={status}
            functionArgs={functionArgs}
            sessionId={sessionId}
            isLive={isLive}
          />
        );
      case "search":
        return (
          <SearchToolView
            content={toolContent}
            status={status}
            functionArgs={functionArgs}
          />
        );
      case "mcp":
        return (
          <McpToolView
            content={toolContent}
            status={status}
            functionArgs={functionArgs}
          />
        );
      case "todo":
        return (
          <TodoToolView
            content={toolContent}
            status={status}
          />
        );
      case "task":
        return (
          <TaskToolView
            content={toolContent}
            status={status}
          />
        );
      case "message":
        return (
          <MessageToolView
            content={toolContent}
            functionArgs={functionArgs}
          />
        );
      case "image":
        return (
          <ImageToolView
            content={toolContent}
            status={status}
            functionArgs={functionArgs}
          />
        );
      default:
        return (
          <FallbackToolView
            functionResult={functionResult}
            functionArgs={functionArgs}
            status={status}
          />
        );
    }
  };

  return (
    <View style={styles.container}>
      {/* ai-manus style header: "Manus Computer" title + minimize button */}
      <View style={styles.panelHeader}>
        <Text style={styles.panelHeaderTitle}>Manus Computer</Text>
        {isLive && status === "calling" && (
          <View style={styles.liveBadge}>
            <LivePulseDot />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
        {onMinimize && (
          <TouchableOpacity
            style={styles.minimizeBtn}
            onPress={onMinimize}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-down" size={16} color="#636366" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tool info row: icon + category name + function badge with args */}
      <View style={styles.toolInfoRow}>
        <View style={styles.toolIconBox}>
          {renderCategoryIcon(category, color)}
        </View>
        <View style={styles.toolInfoText}>
          <Text style={styles.toolInfoUsing}>
            Manus is using <Text style={styles.toolInfoCategoryName}>{(TOOL_NAME_MAP as Record<string, string>)[category] || category}</Text>
          </Text>
          <View style={styles.toolFunctionBadge}>
            <Text style={styles.toolFunctionName}>{functionName || toolName}</Text>
            {argLabel ? (
              <Text style={styles.toolFunctionArg} numberOfLines={1}>{argLabel}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Content body in rounded container */}
      <View style={styles.contentContainer}>
        {renderContent()}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1e1e1e",
    flexDirection: "column",
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  panelHeaderTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#f3f4f6",
    flex: 1,
  },
  toolInfoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  toolIconBox: {
    width: 36,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolInfoText: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  toolInfoUsing: {
    fontSize: 11,
    color: "#9ca3af",
    lineHeight: 16,
  },
  toolInfoCategoryName: {
    color: "#d1d5db",
    fontWeight: "500",
  },
  toolFunctionBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
    maxWidth: "100%",
  },
  toolFunctionName: {
    fontSize: 12,
    color: "#d1d5db",
    fontWeight: "500",
    flexShrink: 0,
  },
  toolFunctionArg: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#9ca3af",
    flexShrink: 1,
    overflow: "hidden",
  },
  contentContainer: {
    flex: 1,
    margin: 12,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#242424",
  },
  minimizeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(74,124,240,0.1)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#4a7cf0",
    letterSpacing: 0.5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  viewContainer: {
    flex: 1,
  },

  // Shell styles
  shellCommandBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "#2a2a2a",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  shellPromptContainer: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  shellPs1: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#888888",
    fontWeight: "700",
  },
  shellCommandText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#f3f4f6",
    lineHeight: 18,
  },
  backendBadge: {
    backgroundColor: "#2a2a2a",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 8,
  },
  backendBadgeText: {
    fontSize: 9,
    color: "#d1d5db",
    fontWeight: "600",
  },
  shellOutputScroll: {
    flex: 1,
    backgroundColor: "#242424",
  },
  shellOutputContent: {
    padding: 10,
  },
  shellOutputText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#d1d5db",
    lineHeight: 17,
  },
  shellBadgeRow: {
    flexDirection: "row",
    gap: 4,
  },
  shellIdBadge: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  shellIdText: {
    fontSize: 9,
    color: "#888888",
    fontWeight: "600",
    fontFamily: "monospace",
  },
  shellFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  refreshBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a2a2a",
  },
  returnCodeBadge: {
    alignSelf: "flex-start",
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  returnCodeText: {
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "600",
  },

  // Browser styles
  browserUrlBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2a2a2a",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  browserUrlText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 11,
    color: "#9ca3af",
  },
  browserTitle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  browserPreview: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  takeOverFloating: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  screenshotImage: {
    width: "100%",
    height: "100%",
  },
  browserLoading: {
    alignItems: "center",
    gap: 10,
  },
  browserLoadingText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  browserEmpty: {
    alignItems: "center",
    gap: 8,
  },
  browserEmptyText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  browserActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  browserActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  browserActionText: {
    fontSize: 11,
    color: "#d1d5db",
    fontWeight: "500",
  },
  takeOverBtn: {
    backgroundColor: "#1a1916",
    borderColor: "#1a1916",
  },
  takeOverText: {
    color: "#FFFFFF",
  },

  // File styles
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
    backgroundColor: "#2a2a2a",
  },
  fileHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fileHeaderRight: {
    flexDirection: "row",
    gap: 4,
  },
  fileNameText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  languageBadge: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  languageBadgeText: {
    fontSize: 9,
    color: "#888888",
    fontWeight: "600",
    textTransform: "uppercase",
  },
  operationBadge: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  operationBadgeText: {
    fontSize: 9,
    fontWeight: "600",
  },
  filePathText: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontFamily: "monospace",
    fontSize: 10,
    color: "#9ca3af",
  },
  fileContentScroll: {
    flex: 1,
    backgroundColor: "#242424",
  },
  fileContentContainer: {
    padding: 10,
  },
  fileContentWithLines: {
    flexDirection: "row",
  },
  lineNumberGutter: {
    paddingRight: 8,
    borderRightWidth: 1,
    borderRightColor: "#2a2a2a",
    marginRight: 8,
    minWidth: 30,
    alignItems: "flex-end",
  },
  lineNumber: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#b0ada5",
    lineHeight: 17,
  },
  codeScrollH: {
    flex: 1,
  },
  codeLines: {
    flexDirection: "column",
  },
  fileContentText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#d1d5db",
    lineHeight: 17,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  downloadBtnText: {
    fontSize: 11,
    color: "#888888",
    fontWeight: "500",
  },

  // Search styles
  searchQueryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
    backgroundColor: "#2a2a2a",
  },
  searchQueryText: {
    flex: 1,
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  searchResultsScroll: {
    flex: 1,
  },
  searchResultsContent: {
    padding: 8,
    gap: 6,
  },
  searchResultItem: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    padding: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  searchResultTitle: {
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  searchResultUrl: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#888888",
  },
  searchResultSnippet: {
    fontSize: 11,
    color: "#9ca3af",
    lineHeight: 16,
    marginTop: 2,
  },
  searchFooter: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  searchCountText: {
    fontSize: 10,
    color: "#9ca3af",
  },

  // MCP styles
  mcpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  mcpToolName: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  mcpServerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#2a2a2a",
  },
  mcpServerText: {
    fontSize: 10,
    color: "#9ca3af",
    fontFamily: "monospace",
  },
  mcpSection: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  mcpSectionLabel: {
    fontSize: 10,
    color: "#9ca3af",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mcpResultScroll: {
    flex: 1,
  },
  codeBlock: {
    backgroundColor: "#2a2a2a",
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#d1d5db",
    lineHeight: 15,
  },

  // Todo styles
  todoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  todoTitle: {
    flex: 1,
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  todoCount: {
    fontSize: 11,
    color: "#9ca3af",
    fontWeight: "600",
  },
  todoProgressBar: {
    height: 3,
    backgroundColor: "#3a3a3a",
  },
  todoProgressFill: {
    height: 3,
    backgroundColor: "#888888",
  },
  todoListScroll: {
    flex: 1,
    padding: 8,
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  todoItemText: {
    flex: 1,
    fontSize: 12,
    color: "#f3f4f6",
    lineHeight: 18,
  },
  todoItemDone: {
    color: "#9ca3af",
    textDecorationLine: "line-through",
  },
  todoMessage: {
    fontSize: 12,
    color: "#9ca3af",
    padding: 10,
  },

  // Task styles
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  taskTitle: {
    flex: 1,
    fontSize: 12,
    color: "#f3f4f6",
    fontWeight: "500",
  },
  taskTypeBadge: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  taskTypeText: {
    fontSize: 9,
    color: "#888888",
    fontWeight: "600",
  },
  taskListScroll: {
    flex: 1,
    padding: 8,
  },
  taskItem: {
    backgroundColor: "#2a2a2a",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  taskItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  taskItemId: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#9ca3af",
    fontWeight: "600",
  },
  taskStatusBadge: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  taskStatusText: {
    fontSize: 9,
    fontWeight: "600",
  },
  taskItemDesc: {
    fontSize: 11,
    color: "#f3f4f6",
    lineHeight: 16,
  },
  taskMessage: {
    fontSize: 12,
    color: "#9ca3af",
    padding: 10,
  },

  // Message styles
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  messageType: {
    fontSize: 12,
    color: "#d1d5db",
    fontWeight: "500",
  },
  messageContent: {
    padding: 12,
  },
  messageText: {
    fontSize: 13,
    color: "#f3f4f6",
    lineHeight: 20,
  },

  // Common
  runningIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  runningLabel: {
    fontSize: 12,
    color: "#9ca3af",
  },
  emptyOutputText: {
    fontSize: 11,
    color: "#9ca3af",
    fontStyle: "italic",
  },
});
