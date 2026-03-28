import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ToolContent } from "@/lib/chat";

interface AgentToolViewProps {
  toolName: string;
  functionName: string;
  functionArgs: Record<string, unknown>;
  status: string;
  toolContent?: ToolContent;
  functionResult?: string;
}

function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case "shell_exec":
      return <Ionicons name="terminal" size={14} color="#30D158" />;
    case "web_search":
      return <Ionicons name="search" size={14} color="#5AC8FA" />;
    case "web_browse":
    case "browser_navigate":
    case "browser_view":
    case "browser_restart":
      return <Ionicons name="globe" size={14} color="#FF9F0A" />;
    case "file_read":
    case "file_write":
    case "file_str_replace":
    case "file_find_by_name":
    case "file_find_in_content":
      return <Ionicons name="document-text" size={14} color="#FFD60A" />;
    case "message_notify_user":
    case "message_ask_user":
      return <Ionicons name="chatbubble" size={14} color="#BF5AF2" />;
    case "mcp_call_tool":
    case "mcp_list_tools":
      return <Ionicons name="extension-puzzle" size={14} color="#64D2FF" />;
    default:
      return <Ionicons name="construct" size={14} color="#8E8E93" />;
  }
}

const KEYWORD_COLOR = "#FF79C6";
const STRING_COLOR = "#F1FA8C";
const COMMENT_COLOR = "#6272A4";
const NUMBER_COLOR = "#BD93F9";
const FUNC_COLOR = "#50FA7B";
const DEFAULT_COLOR = "#F8F8F2";
const PUNCTUATION_COLOR = "#8E8E93";

interface TokenSpan {
  text: string;
  color: string;
}

function tokenizeLine(line: string, lang: string): TokenSpan[] {
  if (!lang || lang === "text") {
    return [{ text: line, color: DEFAULT_COLOR }];
  }

  const tokens: TokenSpan[] = [];
  const keywords = new Set([
    "import", "from", "def", "class", "return", "if", "else", "elif", "for",
    "while", "try", "except", "finally", "with", "as", "in", "not", "and",
    "or", "is", "None", "True", "False", "async", "await", "yield", "raise",
    "pass", "break", "continue", "lambda", "global", "nonlocal", "del", "assert",
    "const", "let", "var", "function", "export", "default", "new", "this",
    "typeof", "instanceof", "void", "null", "undefined", "true", "false",
    "interface", "type", "enum", "extends", "implements", "abstract", "static",
    "public", "private", "protected", "readonly", "override",
    "echo", "fi", "then", "do", "done", "case", "esac",
    "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP",
    "TABLE", "INTO", "VALUES", "SET", "JOIN", "ON", "AND", "OR", "ORDER", "BY",
    "GROUP", "HAVING", "LIMIT", "OFFSET", "ALTER", "INDEX",
  ]);

  let i = 0;
  while (i < line.length) {
    if (line[i] === "#" || (line[i] === "/" && line[i + 1] === "/")) {
      tokens.push({ text: line.slice(i), color: COMMENT_COLOR });
      break;
    }

    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      tokens.push({ text: line.slice(i, j), color: STRING_COLOR });
      i = j;
      continue;
    }

    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=:+\-*/<>[\]{}]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[0-9.xXa-fA-F_eE+\-]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), color: NUMBER_COLOR });
      i = j;
      continue;
    }

    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        tokens.push({ text: word, color: KEYWORD_COLOR });
      } else if (j < line.length && line[j] === "(") {
        tokens.push({ text: word, color: FUNC_COLOR });
      } else {
        tokens.push({ text: word, color: DEFAULT_COLOR });
      }
      i = j;
      continue;
    }

    if (/[{}()\[\];:.,=<>+\-*/%!&|^~?@]/.test(line[i])) {
      tokens.push({ text: line[i], color: PUNCTUATION_COLOR });
      i++;
      continue;
    }

    tokens.push({ text: line[i], color: DEFAULT_COLOR });
    i++;
  }

  return tokens;
}

interface CodeBlock {
  type: "code";
  lang: string;
  content: string;
}

interface TextBlock {
  type: "text";
  content: string;
}

type ContentBlock = CodeBlock | TextBlock;

function parseMarkdownBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) blocks.push({ type: "text", content: before });
    }
    blocks.push({ type: "code", lang: match[1] || "text", content: match[2].replace(/\n$/, "") });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim();
    if (after) blocks.push({ type: "text", content: after });
  }

  if (blocks.length === 0 && text.trim()) {
    blocks.push({ type: "text", content: text.trim() });
  }

  return blocks;
}

function HighlightedCode({ content, lang, maxLines }: { content: string; lang: string; maxLines?: number }) {
  const lines = useMemo(() => {
    const allLines = content.split("\n");
    const limited = maxLines ? allLines.slice(0, maxLines) : allLines;
    return limited.map((line) => tokenizeLine(line, lang));
  }, [content, lang, maxLines]);

  const truncated = maxLines && content.split("\n").length > maxLines;

  return (
    <View style={styles.codeBlockContainer}>
      {lang ? (
        <View style={styles.langBadge}>
          <Text style={styles.langBadgeText}>{lang}</Text>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((lineTokens, lineIdx) => (
            <View key={lineIdx} style={styles.codeLine}>
              <Text style={styles.lineNumber}>{lineIdx + 1}</Text>
              <Text style={styles.codeText} selectable>
                {lineTokens.map((token, tIdx) => (
                  <Text key={tIdx} style={{ color: token.color }}>{token.text}</Text>
                ))}
              </Text>
            </View>
          ))}
          {truncated ? (
            <Text style={styles.truncatedIndicator}>... (more lines)</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function RichContent({ content, language, isShell }: { content: string; language?: string; isShell?: boolean }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  const effectiveLang = language || (isShell ? "bash" : "");

  if (blocks.length === 1 && blocks[0].type === "text") {
    if (effectiveLang || isShell) {
      return <HighlightedCode content={content || "(no output)"} lang={effectiveLang || "bash"} maxLines={30} />;
    }
    return <HighlightedCode content={content || "(empty)"} lang="text" maxLines={30} />;
  }

  return (
    <View style={styles.richContentContainer}>
      {blocks.map((block, idx) => {
        if (block.type === "code") {
          return <HighlightedCode key={idx} content={block.content} lang={block.lang || effectiveLang} maxLines={30} />;
        }
        const trimmed = block.content.trim();
        if (!trimmed) return null;
        return (
          <Text key={idx} style={styles.textContent} selectable>{trimmed}</Text>
        );
      })}
    </View>
  );
}

function ShellContent({ content }: { content: string }) {
  return <RichContent content={content} language="bash" isShell />;
}

function SearchContent({
  results,
}: {
  results: { title: string; url: string; snippet: string }[];
}) {
  return (
    <View style={styles.searchContainer}>
      {results.slice(0, 5).map((result, i) => (
        <View key={i} style={styles.searchResult}>
          <Text style={styles.searchTitle} numberOfLines={1}>
            {result.title}
          </Text>
          <Text style={styles.searchUrl} numberOfLines={1}>
            {result.url}
          </Text>
          {result.snippet ? (
            <Text style={styles.searchSnippet} numberOfLines={2}>
              {result.snippet}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function BrowserContent({
  title,
  content,
}: {
  title?: string;
  content?: string;
}) {
  return (
    <View style={styles.browserContainer}>
      {title ? (
        <Text style={styles.browserTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      <Text style={styles.browserContent} numberOfLines={8}>
        {content || "(empty page)"}
      </Text>
    </View>
  );
}

function FileContent({ content, language }: { content: string; language?: string }) {
  return <RichContent content={content} language={language} />;
}

function getToolFunctionArg(functionName: string, args: Record<string, unknown>): string {
  const argKeyMap: Record<string, string> = {
    shell_exec: "command",
    shell_view: "id",
    shell_wait: "id",
    shell_write_to_process: "input",
    shell_kill_process: "id",
    file_read: "file",
    file_write: "file",
    file_str_replace: "file",
    file_find_by_name: "path",
    file_find_in_content: "file",
    browser_navigate: "url",
    browser_view: "page",
    browser_restart: "url",
    browser_click: "element",
    browser_type: "text",
    browser_scroll: "direction",
    browser_scroll_to_bottom: "page",
    browser_read_links: "page",
    browser_console_view: "console",
    browser_save_image: "save_dir",
    web_search: "query",
    web_browse: "url",
    message_notify_user: "text",
    message_ask_user: "text",
    mcp_call_tool: "tool_name",
    mcp_list_tools: "",
  };
  const key = argKeyMap[functionName] || "";
  if (!key) {
    const firstKey = Object.keys(args)[0];
    if (firstKey) {
      const val = String(args[firstKey] ?? "");
      return val.length > 60 ? val.slice(0, 60) + "..." : val;
    }
    return "";
  }
  const val = String(args[key] ?? "");
  const cleaned = val.replace(/^\/home\/ubuntu\//, "");
  return cleaned.length > 60 ? cleaned.slice(0, 60) + "..." : cleaned;
}

function getToolFunctionLabel(functionName: string): string {
  const labelMap: Record<string, string> = {
    shell_exec: "Executing command",
    shell_view: "Viewing output",
    shell_wait: "Waiting for command",
    shell_write_to_process: "Writing to process",
    shell_kill_process: "Terminating process",
    file_read: "Reading file",
    file_write: "Writing file",
    file_str_replace: "Replacing content",
    file_find_by_name: "Finding file",
    file_find_in_content: "Searching content",
    browser_navigate: "Navigating to page",
    browser_view: "Viewing page",
    browser_click: "Clicking element",
    browser_type: "Entering text",
    browser_scroll: "Scrolling page",
    browser_scroll_to_bottom: "Scrolling to bottom",
    browser_read_links: "Reading links",
    browser_console_view: "Viewing console",
    browser_restart: "Restarting browser",
    browser_save_image: "Saving image",
    web_search: "Searching web",
    web_browse: "Browsing URL",
    message_notify_user: "Sending notification",
    message_ask_user: "Asking question",
    mcp_call_tool: "Calling MCP tool",
    mcp_list_tools: "Listing MCP tools",
  };
  return labelMap[functionName] || functionName;
}

function CallingArgsPreview({ functionName, args }: { functionName: string; args: Record<string, unknown> }) {
  if (functionName === "shell_exec") {
    const cmd = String(args.command ?? "");
    if (cmd) {
      return <HighlightedCode content={cmd} lang="bash" maxLines={5} />;
    }
  }
  if (functionName === "file_write") {
    const file = String(args.file ?? "");
    const contentStr = String(args.content ?? "");
    const preview = contentStr.length > 500 ? contentStr.slice(0, 500) + "..." : contentStr;
    const ext = file.split(".").pop() || "";
    return (
      <View>
        <Text style={styles.callingFileLabel}>{file}</Text>
        {preview ? <HighlightedCode content={preview} lang={ext} maxLines={10} /> : null}
      </View>
    );
  }
  return null;
}

export function AgentToolView({
  toolName,
  functionName,
  functionArgs,
  status,
  toolContent,
  functionResult,
}: AgentToolViewProps) {
  const [expanded, setExpanded] = useState(false);
  const isCalling = status === "calling";
  const isCalled = status === "called";
  const isError = status === "error";

  const functionLabel = getToolFunctionLabel(functionName);
  const primaryArg = getToolFunctionArg(functionName, functionArgs);

  return (
    <View style={[styles.container, isCalling && styles.containerCalling, isError && styles.containerError]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <ToolIcon name={functionName} />
          <Text style={styles.toolLabel}>{functionLabel}</Text>
          {primaryArg ? (
            <Text style={styles.primaryArg} numberOfLines={1}>
              <Text style={styles.primaryArgCode}>{primaryArg}</Text>
            </Text>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          {isCalling && (
            <Ionicons name="sync" size={12} color="#6C5CE7" />
          )}
          {isCalled && (
            <Ionicons name="checkmark-circle" size={14} color="#30D158" />
          )}
          {isError && (
            <Ionicons name="close-circle" size={14} color="#FF453A" />
          )}
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color="#636366"
          />
        </View>
      </TouchableOpacity>

      {isCalling && (
        <View style={styles.callingPreview}>
          <CallingArgsPreview functionName={functionName} args={functionArgs} />
        </View>
      )}

      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.argsContainer}>
            <Text style={styles.argsLabel}>Arguments:</Text>
            {Object.entries(functionArgs).map(([key, val]) => {
              const valStr = String(val ?? "");
              const isLong = valStr.length > 200;
              return (
                <Text key={key} style={styles.argItem}>
                  <Text style={styles.argKey}>{key}: </Text>
                  {isLong ? valStr.slice(0, 200) + "..." : valStr}
                </Text>
              );
            })}
          </View>

          {toolContent && (isCalled || isError) && (
            <View style={styles.resultContainer}>
              {toolContent.type === "shell" && toolContent.console != null && (
                <ShellContent content={toolContent.console} />
              )}
              {toolContent.type === "search" && toolContent.results && (
                <SearchContent results={toolContent.results} />
              )}
              {toolContent.type === "browser" && (
                <BrowserContent
                  title={toolContent.title}
                  content={toolContent.content}
                />
              )}
              {toolContent.type === "file" && toolContent.content != null && (
                <FileContent
                  content={toolContent.content}
                  language={toolContent.language}
                />
              )}
              {toolContent.type === "mcp" && toolContent.result != null && (
                <RichContent content={toolContent.result || "(no result)"} language="json" />
              )}
            </View>
          )}

          {functionResult && (isCalled || isError) && (() => {
            const hasToolContent = toolContent && (
              (toolContent.type === "shell" && toolContent.console) ||
              (toolContent.type === "file" && toolContent.content) ||
              (toolContent.type === "search" && toolContent.results) ||
              (toolContent.type === "browser" && toolContent.content)
            );
            if (hasToolContent) return null;
            const resultLang = functionName.startsWith("shell") ? "bash" :
              functionName.startsWith("file") ? (toolContent?.language || "") : "";
            return (
              <View style={styles.resultContainer}>
                <RichContent content={functionResult.slice(0, 2000)} language={resultLang} isShell={functionName.startsWith("shell")} />
              </View>
            );
          })()}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#141418",
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 2,
    borderWidth: 1,
    borderColor: "#2C2C30",
  },
  containerCalling: {
    borderColor: "rgba(108, 92, 231, 0.3)",
    backgroundColor: "rgba(108, 92, 231, 0.04)",
  },
  containerError: {
    borderColor: "rgba(255, 69, 58, 0.3)",
    backgroundColor: "rgba(255, 69, 58, 0.04)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  toolLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#E8E8ED",
  },
  primaryArg: {
    flex: 1,
    minWidth: 0,
  },
  primaryArgCode: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#8E8E93",
  },
  errorResultText: {
    color: "#FF6B6B",
  },
  callingPreview: {
    marginTop: 6,
  },
  callingFileLabel: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#FFD60A",
    marginBottom: 4,
  },
  expandedContent: {
    marginTop: 8,
    gap: 8,
  },
  argsContainer: {
    backgroundColor: "#1A1A20",
    borderRadius: 6,
    padding: 8,
  },
  argsLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "#8E8E93",
    marginBottom: 4,
  },
  argItem: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#A0A0A8",
    lineHeight: 16,
  },
  argKey: {
    color: "#5AC8FA",
    fontFamily: "Inter_600SemiBold",
  },
  resultContainer: {
    marginTop: 4,
  },
  shellContainer: {
    backgroundColor: "#0D0D10",
    borderRadius: 6,
    padding: 8,
    maxHeight: 200,
  },
  shellText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#30D158",
    lineHeight: 16,
  },
  searchContainer: {
    gap: 6,
  },
  searchResult: {
    backgroundColor: "#1A1A20",
    borderRadius: 6,
    padding: 8,
  },
  searchTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#5AC8FA",
  },
  searchUrl: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "#636366",
    marginTop: 2,
  },
  searchSnippet: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#A0A0A8",
    marginTop: 4,
    lineHeight: 16,
  },
  browserContainer: {
    backgroundColor: "#1A1A20",
    borderRadius: 6,
    padding: 8,
    maxHeight: 150,
  },
  browserTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#FF9F0A",
    marginBottom: 4,
  },
  browserContent: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#A0A0A8",
    lineHeight: 16,
  },
  fileContainer: {
    backgroundColor: "#0D0D10",
    borderRadius: 6,
    padding: 8,
    maxHeight: 150,
  },
  fileText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#FFD60A",
    lineHeight: 16,
  },
  codeBlockContainer: {
    backgroundColor: "#0D0D10",
    borderRadius: 8,
    padding: 8,
    maxHeight: 250,
    overflow: "hidden",
  },
  langBadge: {
    position: "absolute",
    top: 4,
    right: 8,
    backgroundColor: "rgba(108, 92, 231, 0.2)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 1,
  },
  langBadgeText: {
    fontFamily: "monospace",
    fontSize: 9,
    color: "#6C5CE7",
    textTransform: "uppercase",
  },
  codeLine: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  lineNumber: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#3A3A44",
    width: 28,
    textAlign: "right",
    marginRight: 8,
    lineHeight: 16,
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
    flexShrink: 1,
  },
  truncatedIndicator: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#636366",
    marginTop: 4,
    fontStyle: "italic",
  },
  richContentContainer: {
    gap: 6,
  },
  textBlock: {
    backgroundColor: "#0D0D10",
    borderRadius: 6,
    padding: 8,
    maxHeight: 200,
  },
  textContent: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#A0A0A8",
    lineHeight: 16,
  },
});
