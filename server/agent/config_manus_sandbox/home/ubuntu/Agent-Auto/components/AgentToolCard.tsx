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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AgentEvent, ToolContent } from "@/lib/chat";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AgentToolCardProps {
  event: AgentEvent;
}

function getToolDisplay(functionName: string): {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  argKey: string;
} {
  const map: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; argKey: string }> = {
    shell_exec:            { icon: "terminal-outline",        color: "#34C759", label: "Terminal",       argKey: "command" },
    shell_view:            { icon: "terminal-outline",        color: "#34C759", label: "Terminal",       argKey: "id" },
    shell_wait:            { icon: "time-outline",            color: "#34C759", label: "Terminal",       argKey: "id" },
    shell_write_to_process:{ icon: "terminal-outline",        color: "#34C759", label: "Terminal",       argKey: "input" },
    shell_kill_process:    { icon: "close-circle-outline",    color: "#FF453A", label: "Terminal",       argKey: "id" },
    file_read:             { icon: "document-text-outline",   color: "#FFD60A", label: "File Editor",    argKey: "file" },
    file_write:            { icon: "save-outline",            color: "#FFD60A", label: "File Editor",    argKey: "file" },
    file_str_replace:      { icon: "create-outline",          color: "#FFD60A", label: "File Editor",    argKey: "file" },
    file_find_by_name:     { icon: "folder-open-outline",     color: "#FFD60A", label: "File Editor",    argKey: "path" },
    file_find_in_content:  { icon: "search-outline",          color: "#FFD60A", label: "File Editor",    argKey: "file" },
    image_view:            { icon: "image-outline",           color: "#FFD60A", label: "File Editor",    argKey: "image" },
    browser_navigate:      { icon: "globe-outline",           color: "#FF9F0A", label: "Browser",        argKey: "url" },
    browser_view:          { icon: "eye-outline",             color: "#FF9F0A", label: "Browser",        argKey: "" },
    browser_click:         { icon: "hand-left-outline",       color: "#FF9F0A", label: "Browser",        argKey: "" },
    browser_input:         { icon: "create-outline",          color: "#FF9F0A", label: "Browser",        argKey: "text" },
    browser_scroll_up:     { icon: "arrow-up-outline",        color: "#FF9F0A", label: "Browser",        argKey: "" },
    browser_scroll_down:   { icon: "arrow-down-outline",      color: "#FF9F0A", label: "Browser",        argKey: "" },
    browser_console_exec:  { icon: "code-slash-outline",      color: "#FF9F0A", label: "Browser",        argKey: "javascript" },
    browser_console_view:  { icon: "code-slash-outline",      color: "#FF9F0A", label: "Browser",        argKey: "" },
    browser_save_image:    { icon: "image-outline",           color: "#FF9F0A", label: "Browser",        argKey: "save_dir" },
    browser_move_mouse:    { icon: "locate-outline",          color: "#FF9F0A", label: "Browser",        argKey: "" },
    browser_press_key:     { icon: "keypad-outline",          color: "#FF9F0A", label: "Browser",        argKey: "key" },
    browser_select_option: { icon: "list-outline",            color: "#FF9F0A", label: "Browser",        argKey: "option" },
    browser_restart:       { icon: "refresh-outline",         color: "#FF9F0A", label: "Browser",        argKey: "" },
    web_search:            { icon: "search-outline",          color: "#5AC8FA", label: "Web Search",     argKey: "query" },
    info_search_web:       { icon: "search-outline",          color: "#5AC8FA", label: "Web Search",     argKey: "query" },
    web_browse:            { icon: "globe-outline",           color: "#5AC8FA", label: "Web Search",     argKey: "url" },
    mcp_call_tool:         { icon: "extension-puzzle-outline",color: "#64D2FF", label: "MCP",            argKey: "tool_name" },
    mcp_list_tools:        { icon: "list-outline",            color: "#64D2FF", label: "MCP",            argKey: "" },
    message_notify_user:   { icon: "chatbubble-outline",      color: "#BF5AF2", label: "Message",        argKey: "text" },
    message_ask_user:      { icon: "chatbubble-ellipses-outline", color: "#BF5AF2", label: "Message",    argKey: "text" },
    todo_write:            { icon: "checkmark-circle-outline",color: "#30D158", label: "Todo",           argKey: "title" },
    todo_update:           { icon: "checkmark-circle-outline",color: "#30D158", label: "Todo",           argKey: "item_text" },
    todo_read:             { icon: "checkmark-circle-outline",color: "#30D158", label: "Todo",           argKey: "" },
    task_create:           { icon: "list-circle-outline",     color: "#0A84FF", label: "Task",           argKey: "description" },
    task_complete:         { icon: "list-circle-outline",     color: "#0A84FF", label: "Task",           argKey: "task_id" },
    task_list:             { icon: "list-circle-outline",     color: "#0A84FF", label: "Task",           argKey: "" },
  };
  return map[functionName] || { icon: "construct-outline", color: "#8E8E93", label: functionName, argKey: "" };
}

function getActionVerb(functionName: string): string {
  const verbs: Record<string, string> = {
    shell_exec: "Executing",
    shell_view: "Viewing output",
    shell_wait: "Waiting",
    shell_write_to_process: "Writing input",
    shell_kill_process: "Killing process",
    file_read: "Reading",
    file_write: "Writing",
    file_str_replace: "Editing",
    file_find_by_name: "Finding",
    file_find_in_content: "Searching",
    image_view: "Viewing image",
    browser_navigate: "Navigating to",
    browser_view: "Viewing page",
    browser_click: "Clicking",
    browser_input: "Typing",
    browser_scroll_up: "Scrolling up",
    browser_scroll_down: "Scrolling down",
    browser_console_exec: "Running JS",
    browser_console_view: "Viewing console",
    browser_save_image: "Saving image",
    web_search: "Searching",
    info_search_web: "Searching",
    web_browse: "Browsing",
    mcp_call_tool: "Calling tool",
    mcp_list_tools: "Listing tools",
    message_notify_user: "Notifying user",
    message_ask_user: "Asking user",
    todo_write: "Writing todo",
    todo_update: "Updating todo",
    todo_read: "Reading todos",
    task_create: "Creating task",
    task_complete: "Completing task",
    task_list: "Listing tasks",
  };
  return verbs[functionName] || functionName;
}

function getPrimaryArg(functionName: string, args: Record<string, unknown>): string {
  const { argKey } = getToolDisplay(functionName);
  let val = argKey && args[argKey] ? String(args[argKey]) : "";
  if (!val) {
    const firstKey = Object.keys(args).find(k => k !== "attachments" && k !== "sudo");
    val = firstKey ? String(args[firstKey] ?? "") : "";
  }
  val = val.replace(/^\/home\/ubuntu\//, "~/");
  if (val.length > 52) val = val.slice(0, 52) + "…";
  return val;
}

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
            <View key={i} style={styles.searchResultItem}>
              <Text style={styles.searchResultTitle} numberOfLines={1}>{r.title}</Text>
              <Text style={styles.searchResultUrl} numberOfLines={1}>{r.url}</Text>
              {r.snippet ? <Text style={styles.searchResultSnippet} numberOfLines={2}>{r.snippet}</Text> : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function BrowserContent({ url, title, content, screenshotB64 }: { url?: string; title?: string; content?: string; screenshotB64?: string }) {
  return (
    <View style={styles.browserBody}>
      {url ? (
        <View style={styles.browserUrlBar}>
          <Ionicons name="lock-closed" size={10} color="#34C759" />
          <Text style={styles.browserUrl} numberOfLines={1}>{url}</Text>
        </View>
      ) : null}
      {title ? <Text style={styles.browserTitle} numberOfLines={1}>{title}</Text> : null}
      {screenshotB64 ? (
        <View style={styles.screenshotWrapper}>
          <Image
            source={{ uri: screenshotB64 }}
            style={styles.screenshotImage}
            resizeMode="contain"
          />
        </View>
      ) : content ? (
        <ScrollView style={styles.browserContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.browserContentText} numberOfLines={8}>{content.slice(0, 800)}</Text>
        </ScrollView>
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
          <Ionicons name="document-text-outline" size={11} color="#FFD60A" />
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
            <Ionicons
              name={checked ? "checkmark-circle" : "ellipse-outline"}
              size={14}
              color={checked ? "#30D158" : "rgba(255,255,255,0.3)"}
            />
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
          <Ionicons name="list-circle-outline" size={14} color="#0A84FF" />
          <Text style={styles.todoText}>{line.trim()}</Text>
        </View>
      ))}
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
  }

  if (hasCalled && functionResult) {
    if (functionName.startsWith("todo_")) {
      return <TodoContent content={functionResult} />;
    }
    if (functionName.startsWith("task_")) {
      return <TaskContent content={functionResult} />;
    }
    return <ShellContent content={functionResult.slice(0, 1200)} />;
  }

  return null;
}

export function AgentToolCard({ event }: AgentToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  const functionName = event.function_name || "";
  const functionArgs = (event.function_args || {}) as Record<string, unknown>;
  const isCalling = event.status === "calling";
  const isCalled = event.status === "called";
  const isError = event.status === "error";

  const { icon, color, label } = getToolDisplay(functionName);
  const verb = getActionVerb(functionName);
  const primaryArg = getPrimaryArg(functionName, functionArgs);

  const hasContent = !!(
    event.tool_content ||
    (event.function_result && (isCalled || isError))
  );

  const toggleExpand = () => {
    if (!hasContent && !isCalling) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => !prev);
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, isError && styles.cardError]}>
        {/* Colored left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: color }]} />

        <View style={styles.cardContent}>
          {/* Header row */}
          <TouchableOpacity
            style={styles.header}
            onPress={toggleExpand}
            activeOpacity={hasContent || isCalling ? 0.6 : 1}
          >
            {/* Icon */}
            <View style={[styles.iconWrap, { backgroundColor: color + "18" }]}>
              <Ionicons name={icon} size={13} color={color} />
            </View>

            {/* Label + arg */}
            <View style={styles.labelArea}>
              <Text style={styles.labelText}>{label}</Text>
              {primaryArg ? (
                <Text style={[styles.argText, { color: color + "CC" }]} numberOfLines={1}>
                  {verb} {primaryArg}
                </Text>
              ) : (
                <Text style={styles.argText} numberOfLines={1}>{verb}</Text>
              )}
            </View>

            {/* Right: status + expand */}
            <View style={styles.rightArea}>
              {isCalling && <PulsingDot color={color} />}
              {isCalled && <Ionicons name="checkmark-circle" size={14} color="#34C759" />}
              {isError && <Ionicons name="close-circle" size={14} color="#FF453A" />}
              {(hasContent || isCalling) && (
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={12}
                  color="rgba(255,255,255,0.25)"
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          </TouchableOpacity>

          {isError && event.function_result ? (
            <View style={styles.errorBody}>
              <Ionicons name="alert-circle" size={13} color="#FF453A" />
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
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  cardError: {
    borderColor: "rgba(255,69,58,0.25)",
    backgroundColor: "rgba(255,69,58,0.05)",
  },
  errorBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginLeft: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,69,58,0.15)",
    backgroundColor: "rgba(255,69,58,0.06)",
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "#FF6961",
    lineHeight: 16,
  },
  cardContent: {
    flex: 1,
    flexDirection: "column",
  },
  accentBar: {
    width: 3,
    borderRadius: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  labelArea: {
    flex: 1,
    gap: 1,
  },
  labelText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    lineHeight: 16,
  },
  argText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
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
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "#0A0A0F",
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
    color: "#34C759",
  },
  shellCommandText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#E8E8ED",
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
    color: "rgba(255,255,255,0.6)",
    lineHeight: 17,
  },
  // Search
  searchBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    padding: 10,
    gap: 6,
  },
  searchQuery: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#5AC8FA",
  },
  searchResults: {
    maxHeight: 200,
  },
  searchResultItem: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
    gap: 2,
  },
  searchResultTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    lineHeight: 17,
  },
  searchResultUrl: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
  },
  searchResultSnippet: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    lineHeight: 16,
    marginTop: 2,
  },
  // Browser
  browserBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    padding: 10,
    gap: 6,
  },
  browserUrlBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  browserUrl: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
  },
  browserTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#FF9F0A",
    lineHeight: 17,
  },
  browserContent: {
    maxHeight: 120,
  },
  browserContentText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.55)",
    lineHeight: 16,
  },
  screenshotWrapper: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  screenshotImage: {
    width: "100%",
    height: 160,
  },
  // File
  fileBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  fileName: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 11,
    color: "#FFD60A",
  },
  fileOp: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    textTransform: "capitalize",
  },
  fileContent: {
    maxHeight: 160,
    padding: 10,
  },
  fileContentText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "rgba(255,255,255,0.65)",
    lineHeight: 17,
  },
  todoBody: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
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
    color: "rgba(255,255,255,0.75)",
    lineHeight: 17,
  },
  todoChecked: {
    textDecorationLine: "line-through",
    color: "rgba(255,255,255,0.35)",
  },
});
