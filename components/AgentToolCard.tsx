import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  Image,
  Linking,
} from "react-native";
import {
  LockClosedIcon, ImageOutlineIcon, DocumentTextIcon, CheckCircleIcon,
  CircleOutlineIcon, ListIcon, ExtensionPuzzleIcon, ChatbubbleIcon,
  AlertCircleIcon, ChevronUpIcon, ChevronDownIcon,
} from "@/components/icons/SvgIcon";
import type { AgentEvent, ToolContent } from "@/lib/chat";
import { getToolDisplayInfo, getToolActionVerb, getToolPrimaryArg, getToolCategory, getToolCategoryColor } from "@/lib/tool-constants";
import { ShellIcon, BrowserIcon, EditIcon, SearchIcon, MessageIcon, McpIcon, SpinningIcon, SuccessIcon, ErrorIcon } from "./icons/ToolIcons";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AgentToolCardProps {
  event: AgentEvent;
  onHeaderPress?: () => void;
}

// Uses centralized tool constants from lib/tool-constants.ts

function PulsingDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View style={[styles.pulseDot, { backgroundColor: color, opacity }]} />
  );
}

function ShellContent({ content, command }: { content?: string; command?: string }) {
  return (
    <View style={styles.shellBody}>
      {command ? (
        <View style={styles.shellCommand}>
          <Text style={styles.shellPrompt}>$ </Text>
          <Text style={styles.shellCommandText} numberOfLines={2}>{command}</Text>
        </View>
      ) : null}
      {content ? (
        <ScrollView style={styles.shellOutput} showsVerticalScrollIndicator={false}>
          <Text style={styles.shellOutputText} selectable>{content.slice(0, 1500)}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function SearchContent({ query, results }: { query?: string; results?: { title: string; url: string; snippet?: string }[] }) {
  return (
    <View style={styles.searchBody}>
      {query ? <Text style={styles.searchQuery} numberOfLines={1}>{query}</Text> : null}
      {results && results.length > 0 ? (
        <ScrollView style={styles.searchResults} showsVerticalScrollIndicator={false}>
          {results.slice(0, 5).map((r, i) => (
            <TouchableOpacity
              key={i}
              style={styles.searchResultItem}
              onPress={() => r.url && Linking.openURL(r.url)}
              activeOpacity={0.7}
            >
              <Text style={styles.searchResultTitle} numberOfLines={1}>{r.title}</Text>
              <Text style={styles.searchResultUrl} numberOfLines={1}>{r.url}</Text>
              {r.snippet ? <Text style={styles.searchResultSnippet} numberOfLines={2}>{r.snippet}</Text> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function BrowserContent({ url, title, content, screenshotB64 }: { url?: string; title?: string; content?: string; screenshotB64?: string }) {
  const [imgError, setImgError] = useState(false);

  // Normalize raw base64 to data URI so screenshots render regardless of prefix
  const normalizedShot = screenshotB64
    ? (screenshotB64.startsWith("data:") ? screenshotB64 : `data:image/png;base64,${screenshotB64}`)
    : "";
  // Validate: must have proper prefix and reasonable length
  const validScreenshot = normalizedShot &&
    (normalizedShot.startsWith("data:image/jpeg;base64,") || normalizedShot.startsWith("data:image/png;base64,")) &&
    normalizedShot.length > 100;

  return (
    <View style={styles.browserBody}>
      {url ? (
        <TouchableOpacity
          style={styles.browserUrlBar}
          onPress={() => Linking.openURL(url)}
          activeOpacity={0.7}
        >
          <LockClosedIcon size={10} color="#888888" />
          <Text style={[styles.browserUrl, { textDecorationLine: "underline" }]} numberOfLines={1}>{url}</Text>
        </TouchableOpacity>
      ) : null}
      {title ? <Text style={styles.browserTitle} numberOfLines={1}>{title}</Text> : null}
      {validScreenshot && !imgError ? (
        <TouchableOpacity
          style={styles.screenshotWrapper}
          onPress={() => url && Linking.openURL(url)}
          activeOpacity={url ? 0.8 : 1}
        >
          <Image
            source={{ uri: normalizedShot }}
            style={styles.screenshotImage}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        </TouchableOpacity>
      ) : content ? (
        <ScrollView style={styles.browserContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.browserContentText} numberOfLines={10}>{content.slice(0, 1200)}</Text>
        </ScrollView>
      ) : validScreenshot && imgError ? (
        <View style={[styles.screenshotWrapper, { alignItems: "center", justifyContent: "center", height: 60 }]}>
          <ImageOutlineIcon size={20} color="#8a8780" />
          <Text style={{ fontSize: 11, color: "#a0a0a0", marginTop: 4 }}>Screenshot tersedia</Text>
        </View>
      ) : null}
    </View>
  );
}

function FileContent({ file, content, operation }: { file?: string; content?: string; operation?: string }) {
  const displayFile = file ? file.replace(/^\/home\/ubuntu\//, "~/") : "";
  return (
    <View style={styles.fileBody}>
      {displayFile ? (
        <View style={styles.fileHeader}>
          <DocumentTextIcon size={11} color="#888888" />
          <Text style={styles.fileName} numberOfLines={1}>{displayFile}</Text>
          {operation ? <Text style={styles.fileOp}>{operation}</Text> : null}
        </View>
      ) : null}
      {content ? (
        <ScrollView style={styles.fileContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.fileContentText} selectable numberOfLines={10}>{content.slice(0, 1000)}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function TodoContent({ content }: { content?: string }) {
  if (!content) return null;
  const lines = content.split("\n").filter(l => l.trim());
  return (
    <View style={styles.todoBody}>
      {lines.map((line, i) => {
        const checked = /^\s*-?\s*\[x\]/i.test(line);
        const text = line.replace(/^\s*-?\s*\[[ x]\]\s*/i, "").replace(/^#+\s*/, "").trim();
        return (
          <View key={i} style={styles.todoItem}>
            {checked
              ? <CheckCircleIcon size={14} color="#888888" />
              : <CircleOutlineIcon size={14} color="#555555" />
            }
            <Text style={[styles.todoText, checked && styles.todoChecked]}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

function TaskContent({ content }: { content?: string }) {
  if (!content) return null;
  const lines = content.split("\n").filter(l => l.trim());
  return (
    <View style={styles.todoBody}>
      {lines.map((line, i) => (
        <View key={i} style={styles.todoItem}>
          <ListIcon size={14} color="#888888" />
          <Text style={styles.todoText}>{line.trim()}</Text>
        </View>
      ))}
    </View>
  );
}

function McpContent({ tool, args, result }: { tool?: string; args?: string; result?: string }) {
  return (
    <View style={styles.mcpBody}>
      {tool ? (
        <View style={styles.mcpHeader}>
          <ExtensionPuzzleIcon size={11} color="#888888" />
          <Text style={styles.mcpToolName}>{tool}</Text>
        </View>
      ) : null}
      {args ? (
        <ScrollView style={styles.mcpArgs} showsVerticalScrollIndicator={false}>
          <Text style={styles.mcpArgsText} selectable numberOfLines={8}>{args}</Text>
        </ScrollView>
      ) : null}
      {result ? (
        <ScrollView style={styles.mcpResult} showsVerticalScrollIndicator={false}>
          <Text style={styles.mcpResultText} selectable numberOfLines={10}>{result.slice(0, 1200)}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function MessageContent({ text, isAsk }: { text?: string; isAsk?: boolean }) {
  if (!text) return null;
  return (
    <View style={styles.messageBody}>
      <View style={styles.messageHeader}>
        <ChatbubbleIcon size={11} color="#888888" />
        <Text style={styles.messageLabel}>{isAsk ? "Question" : "Notification"}</Text>
      </View>
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );
}

function ToolBody({ functionName, functionArgs, toolContent, functionResult, status }: {
  functionName: string;
  functionArgs: Record<string, unknown>;
  toolContent?: ToolContent;
  functionResult?: string;
  status: string;
}) {
  const hasCalled = status === "called" || status === "error";

  if (toolContent) {
    if (toolContent.type === "shell") {
      return <ShellContent command={toolContent.command} content={toolContent.console || ""} />;
    }
    if (toolContent.type === "search") {
      return <SearchContent query={toolContent.query} results={toolContent.results} />;
    }
    if (toolContent.type === "browser") {
      return (
        <BrowserContent
          url={String(toolContent.url || "")}
          title={toolContent.title}
          content={toolContent.content}
          screenshotB64={toolContent.screenshot_b64}
        />
      );
    }
    if (toolContent.type === "file") {
      return (
        <FileContent
          file={String(functionArgs.file || functionArgs.path || functionArgs.image || "")}
          content={toolContent.content}
          operation={toolContent.operation}
        />
      );
    }
    if (toolContent.type === "mcp") {
      return (
        <McpContent
          tool={toolContent.tool}
          args={toolContent.content}
          result={toolContent.result}
        />
      );
    }
  }

  // Message tools
  if (functionName === "message_notify_user" || functionName === "message_ask_user") {
    const text = String(functionArgs.text || functionResult || "");
    return <MessageContent text={text} isAsk={functionName === "message_ask_user"} />;
  }

  if (hasCalled && functionResult) {
    if (functionName.startsWith("todo_")) {
      return <TodoContent content={functionResult} />;
    }
    if (functionName.startsWith("task_")) {
      return <TaskContent content={functionResult} />;
    }
    // MCP fallback when no toolContent
    if (functionName.startsWith("mcp_")) {
      return (
        <McpContent
          tool={String(functionArgs.tool_name || "")}
          args={JSON.stringify(functionArgs, null, 2)}
          result={functionResult}
        />
      );
    }
    return <ShellContent content={functionResult.slice(0, 1200)} />;
  }

  return null;
}

// Helper: build descriptive label (e.g. "Mencari: indonesia news", "Membuka: https://...")
function buildDescriptiveLabel(
  functionName: string,
  functionArgs: Record<string, unknown>,
  verb: string,
  primaryArg: string,
): string {
  // Map specific functions to concise action labels
  const actionMap: Record<string, string> = {
    web_search: "Mencari",
    info_search_web: "Mencari",
    browser_navigate: "Membuka",
    browser_view: "Melihat",
    browser_click: "Klik",
    browser_input: "Mengisi",
    browser_scroll_down: "Scroll bawah",
    browser_scroll_up: "Scroll atas",
    browser_screenshot: "Screenshot",
    browser_tab_new: "Tab baru",
    shell_exec: "Jalankan",
    shell_view: "Lihat output",
    file_read: "Membaca",
    file_write: "Menulis",
    file_str_replace: "Edit",
    file_find_by_name: "Cari file",
    file_find_in_content: "Cari dalam",
    message_notify_user: "Notifikasi",
    message_ask_user: "Tanya",
    todo_write: "Tulis todo",
    todo_read: "Baca todo",
    task_create: "Buat task",
    task_complete: "Selesaikan",
    mcp_call_tool: "MCP",
  };
  const action = actionMap[functionName];
  if (action && primaryArg) return `${action}: ${primaryArg}`;
  if (action) return action;
  if (primaryArg) return `${verb}: ${primaryArg}`;
  return verb;
}

// Helper: render custom icon for tool card based on function name (colored by category)
function renderCardIcon(functionName: string) {
  const category = getToolCategory(functionName);
  const { icon: iconColor } = getToolCategoryColor(functionName);
  switch (category) {
    case "shell":
      return <ShellIcon size={15} color={iconColor} />;
    case "browser":
    case "desktop":
      return <BrowserIcon size={15} color={iconColor} />;
    case "file":
    case "image":
    case "multimedia":
      return <EditIcon size={15} color={iconColor} />;
    case "search":
    case "info":
      return <SearchIcon size={15} color={iconColor} />;
    case "mcp":
      return <McpIcon size={15} color={iconColor} />;
    case "message":
    case "todo":
    case "task":
    case "email":
      return <MessageIcon size={15} color={iconColor} />;
    default:
      return <ShellIcon size={15} color={iconColor} />;
  }
}

export function AgentToolCard({ event, onHeaderPress }: AgentToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  const functionName = event.function_name || "";
  const functionArgs = (event.function_args || {}) as Record<string, unknown>;
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const isError = event.status === "error";

  const { label } = getToolDisplayInfo(functionName);
  const categoryColor = getToolCategoryColor(functionName);
  const verb = getToolActionVerb(functionName);
  const primaryArg = getToolPrimaryArg(functionName, functionArgs);
  const descriptiveLabel = buildDescriptiveLabel(functionName, functionArgs, verb, primaryArg);

  const hasContent = !!(
    event.tool_content ||
    (event.function_result && (isCalled || isError))
  );

  // Build a short result snippet for display under the label when done
  const resultSnippet = React.useMemo(() => {
    if (!isCalled) return null;
    const tc = event.tool_content;
    if (tc) {
      if (tc.type === "search" && tc.results && tc.results.length > 0) {
        return tc.results[0].snippet || tc.results[0].title || null;
      }
      if (tc.type === "browser" && tc.title) return tc.title;
      if (tc.type === "shell" && tc.console) {
        const lines = tc.console.split("\n").filter((l: string) => l.trim());
        return lines.slice(-2).join(" ").slice(0, 120) || null;
      }
      if (tc.type === "file" && tc.content) {
        return tc.content.slice(0, 100).replace(/\n/g, " ") || null;
      }
    }
    if (event.function_result && !isError) {
      const r = event.function_result.trim();
      if (r.length > 10) {
        return r.replace(/\n/g, " ").slice(0, 120);
      }
    }
    return null;
  }, [isCalled, isError, event.tool_content, event.function_result]);

  const toggleExpand = () => {
    if (hasContent || isCalling) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded(prev => !prev);
    }
    onHeaderPress?.();
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, isError && styles.cardError]}>
        {/* Colored left accent bar */}
        <View style={[styles.accentBar, !isError && { backgroundColor: categoryColor.accent }]} />

        <View style={styles.cardContent}>
          {/* Header row */}
          <TouchableOpacity
            style={styles.header}
            onPress={toggleExpand}
            activeOpacity={hasContent || isCalling ? 0.6 : 1}
          >
            {/* Icon */}
            <View style={[styles.iconWrap, !isError && { backgroundColor: categoryColor.background }]}>
              {renderCardIcon(functionName)}
            </View>

            {/* Label + arg */}
            <View style={styles.labelArea}>
              <Text style={[styles.labelText, isCalling && styles.labelTextRunning]} numberOfLines={2}>
                {descriptiveLabel}
              </Text>
              {resultSnippet ? (
                <Text style={styles.snippetText} numberOfLines={2}>{resultSnippet}</Text>
              ) : (
                <Text style={styles.subLabelText} numberOfLines={1}>{label}</Text>
              )}
            </View>

            {/* Right: status + expand */}
            <View style={styles.rightArea}>
              {isCalling && <SpinningIcon size={14} color="#7dd3fc" />}
              {isCalled && <SuccessIcon size={14} color="#4ade80" />}
              {isError && <ErrorIcon size={14} color="#dc2626" />}
              {(hasContent || isCalling) && (
                <View style={{ marginLeft: 4 }}>
                  {expanded
                    ? <ChevronUpIcon size={12} color="#a0a0a0" />
                    : <ChevronDownIcon size={12} color="#a0a0a0" />
                  }
                </View>
              )}
            </View>
          </TouchableOpacity>

          {isError && event.function_result ? (
            <View style={styles.errorBody}>
              <AlertCircleIcon size={13} color="#dc2626" />
              <Text style={styles.errorText} numberOfLines={3}>
                {event.function_result}
              </Text>
            </View>
          ) : null}

          {expanded && !isError && (
            <ToolBody
              functionName={functionName}
              functionArgs={functionArgs}
              toolContent={event.tool_content}
              functionResult={event.function_result}
              status={event.status || "called"}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingVertical: 3,
  },
  card: {
    flexDirection: "row",
    borderRadius: 10,
    backgroundColor: "#242424",
    borderWidth: 1,
    borderColor: "#333333",
    overflow: "hidden",
  },
  cardError: {
    borderColor: "rgba(220,38,38,0.3)",
    backgroundColor: "rgba(220,38,38,0.04)",
  },
  errorBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginLeft: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(220,38,38,0.15)",
    backgroundColor: "rgba(220,38,38,0.04)",
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#dc2626",
    lineHeight: 16,
  },
  cardContent: {
    flex: 1,
    flexDirection: "column",
  },
  accentBar: {
    width: 3,
    borderRadius: 0,
    backgroundColor: "#3a3a3a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2e2e2e",
  },
  labelArea: {
    flex: 1,
    gap: 1,
  },
  labelText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#c0c0c0",
    lineHeight: 18,
  },
  labelTextRunning: {
    color: "#e8e8e8",
    fontFamily: "Inter_600SemiBold",
  },
  subLabelText: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#686868",
    lineHeight: 14,
  },
  snippetText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#909090",
    lineHeight: 15,
  },
  argText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#888888",
    lineHeight: 15,
  },
  rightArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  // Shell
  shellBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    backgroundColor: "#242424",
  },
  shellCommand: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 2,
  },
  shellPrompt: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#888888",
  },
  shellCommandText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#f3f4f6",
    lineHeight: 18,
  },
  shellOutput: {
    maxHeight: 160,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  shellOutputText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#a0a0a0",
    lineHeight: 17,
  },
  // Search
  searchBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    padding: 10,
    gap: 6,
  },
  searchQuery: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#a0a0a0",
  },
  searchResults: {
    maxHeight: 200,
  },
  searchResultItem: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
    gap: 2,
  },
  searchResultTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#c8c8c8",
    lineHeight: 17,
  },
  searchResultUrl: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#666666",
  },
  searchResultSnippet: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#888888",
    lineHeight: 16,
    marginTop: 2,
  },
  // Browser
  browserBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    padding: 10,
    gap: 6,
  },
  browserUrlBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1e1e1e",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  browserUrl: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 10,
    color: "#7a7a7a",
  },
  browserTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#c8c8c8",
    lineHeight: 17,
  },
  browserContent: {
    maxHeight: 120,
  },
  browserContentText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#a8a8a8",
    lineHeight: 16,
  },
  screenshotWrapper: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  screenshotImage: {
    width: "100%",
    height: 160,
  },
  // File
  fileBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    overflow: "hidden",
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#242424",
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
  },
  fileName: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 11,
    color: "#a0a0a0",
  },
  fileOp: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#a0a0a0",
    textTransform: "capitalize",
  },
  fileContent: {
    maxHeight: 160,
    padding: 10,
    backgroundColor: "#2a2a2a",
  },
  fileContentText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#c8c8c8",
    lineHeight: 17,
  },
  todoBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    padding: 10,
    gap: 6,
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  todoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#a8a8a8",
    lineHeight: 17,
  },
  todoChecked: {
    textDecorationLine: "line-through",
    color: "#a0a0a0",
  },
  // MCP
  mcpBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    padding: 10,
    gap: 6,
  },
  mcpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  mcpToolName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#a0a0a0",
  },
  mcpArgs: {
    maxHeight: 120,
    backgroundColor: "#2a2a2a",
    borderRadius: 5,
    padding: 8,
  },
  mcpArgsText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#c8c8c8",
    lineHeight: 16,
  },
  mcpResult: {
    maxHeight: 160,
    backgroundColor: "#2a2a2a",
    borderRadius: 5,
    padding: 8,
  },
  mcpResultText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#c8c8c8",
    lineHeight: 17,
  },
  // Message
  messageBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    padding: 10,
    gap: 6,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  messageLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#888888",
  },
  messageText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#a8a8a8",
    lineHeight: 18,
  },
});
