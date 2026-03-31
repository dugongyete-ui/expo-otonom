/**
 * Centralized tool constants for Dzeck AI Agent.
 * Modeled after ai-manus reference project's tool mapping system.
 * Used by AgentToolCard, AgentToolView, and ToolPanel components.
 */
import type { Ionicons } from "@expo/vector-icons";

// ─── Tool Function → Display Label ─────────────────────────────────────────
export const TOOL_FUNCTION_MAP: Record<string, string> = {
  // Shell tools
  shell_exec: "Executing command",
  shell_view: "Viewing command output",
  shell_wait: "Waiting for command completion",
  shell_write_to_process: "Writing data to process",
  shell_kill_process: "Terminating process",

  // File tools
  file_read: "Reading file",
  file_write: "Writing file",
  file_str_replace: "Replacing file content",
  file_find_in_content: "Searching file content",
  file_find_by_name: "Finding file",
  image_view: "Viewing image",

  // Browser tools
  browser_view: "Viewing webpage",
  browser_navigate: "Navigating to webpage",
  browser_restart: "Restarting browser",
  browser_click: "Clicking element",
  browser_input: "Entering text",
  browser_move_mouse: "Moving mouse",
  browser_press_key: "Pressing key",
  browser_select_option: "Selecting option",
  browser_scroll_up: "Scrolling up",
  browser_scroll_down: "Scrolling down",
  browser_console_exec: "Executing JS code",
  browser_console_view: "Viewing console output",
  browser_save_image: "Saving image",
  browser_screenshot: "Taking screenshot",
  browser_tab_list: "Listing browser tabs",
  browser_tab_new: "Opening new tab",
  browser_tab_close: "Closing tab",
  browser_tab_switch: "Switching tab",
  browser_drag: "Dragging element",
  browser_file_upload: "Uploading file",

  // Desktop tools
  desktop_open_app: "Opening application",
  desktop_app_type: "Typing in application",
  desktop_app_screenshot: "Taking desktop screenshot",

  // Search tools
  web_search: "Searching web",
  web_browse: "Browsing URL",
  info_search_web: "Searching web",

  // Message tools
  message_notify_user: "Sending notification",
  message_ask_user: "Asking question",

  // MCP tools
  mcp_call_tool: "Calling MCP tool",
  mcp_list_tools: "Listing MCP tools",

  // Todo tools
  todo_write: "Writing todo",
  todo_update: "Updating todo",
  todo_read: "Reading todos",

  // Task tools
  task_create: "Creating task",
  task_complete: "Completing task",
  task_list: "Listing tasks",

  // Multimedia tools
  export_pdf: "Exporting PDF",
  render_diagram: "Rendering diagram",
  speech_to_text: "Transcribing speech",
  export_slides: "Exporting slides",
  upload_file: "Uploading file",

  // Email tools
  send_email: "Sending email",

  // Idle tool
  idle: "Waiting",
};

// ─── Tool Function → Primary Argument Key ──────────────────────────────────
export const TOOL_FUNCTION_ARG_MAP: Record<string, string> = {
  shell_exec: "command",
  shell_view: "id",
  shell_wait: "id",
  shell_write_to_process: "input",
  shell_kill_process: "id",
  file_read: "file",
  file_write: "file",
  file_str_replace: "file",
  file_find_in_content: "file",
  file_find_by_name: "path",
  image_view: "image",
  browser_view: "page",
  browser_navigate: "url",
  browser_restart: "url",
  browser_click: "element",
  browser_input: "text",
  browser_move_mouse: "coordinate",
  browser_press_key: "key",
  browser_select_option: "option",
  browser_scroll_up: "page",
  browser_scroll_down: "page",
  browser_console_exec: "javascript",
  browser_console_view: "console",
  browser_save_image: "save_dir",
  browser_screenshot: "",
  browser_tab_list: "",
  browser_tab_new: "url",
  browser_tab_close: "tab_id",
  browser_tab_switch: "tab_id",
  browser_drag: "element",
  browser_file_upload: "element",
  desktop_open_app: "app_name",
  desktop_app_type: "text",
  desktop_app_screenshot: "",
  web_search: "query",
  web_browse: "url",
  info_search_web: "query",
  message_notify_user: "text",
  message_ask_user: "text",
  mcp_call_tool: "tool_name",
  mcp_list_tools: "",
  todo_write: "title",
  todo_update: "item_text",
  todo_read: "",
  task_create: "description",
  task_complete: "task_id",
  task_list: "",
  export_pdf: "file",
  render_diagram: "code",
  speech_to_text: "audio_file",
  export_slides: "file",
  upload_file: "file",
  send_email: "to",
  idle: "duration",
};

// ─── Tool Category → Display Name ──────────────────────────────────────────
export const TOOL_NAME_MAP: Record<string, string> = {
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

// ─── Tool Category → Ionicons Icon Name ────────────────────────────────────
export const TOOL_ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  shell: "terminal-outline",
  file: "document-text-outline",
  browser: "globe-outline",
  desktop: "desktop-outline",
  search: "search-outline",
  info: "information-circle-outline",
  message: "chatbubble-outline",
  mcp: "extension-puzzle-outline",
  todo: "checkmark-circle-outline",
  task: "list-circle-outline",
  image: "image-outline",
  multimedia: "film-outline",
  email: "mail-outline",
  idle: "time-outline",
};

// ─── Tool Category → Color ─────────────────────────────────────────────────
export const TOOL_COLOR_MAP: Record<string, string> = {
  shell: "#34C759",
  file: "#FFD60A",
  browser: "#FF9F0A",
  desktop: "#6E4FF6",
  search: "#5AC8FA",
  info: "#5AC8FA",
  message: "#BF5AF2",
  mcp: "#64D2FF",
  todo: "#30D158",
  task: "#0A84FF",
  image: "#FF9F0A",
  multimedia: "#FF6B6B",
  email: "#1E90FF",
  idle: "#8E8E93",
};

// ─── Tool Function → Detailed Display Info ─────────────────────────────────
export interface ToolDisplayInfo {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  argKey: string;
}

export const TOOL_DISPLAY_MAP: Record<string, ToolDisplayInfo> = {
  // Shell tools
  shell_exec:             { icon: "terminal-outline",         color: "#34C759", label: "Terminal",       argKey: "command" },
  shell_view:             { icon: "terminal-outline",         color: "#34C759", label: "Terminal",       argKey: "id" },
  shell_wait:             { icon: "time-outline",             color: "#34C759", label: "Terminal",       argKey: "id" },
  shell_write_to_process: { icon: "terminal-outline",         color: "#34C759", label: "Terminal",       argKey: "input" },
  shell_kill_process:     { icon: "close-circle-outline",     color: "#FF453A", label: "Terminal",       argKey: "id" },

  // File tools
  file_read:              { icon: "document-text-outline",    color: "#FFD60A", label: "File Editor",    argKey: "file" },
  file_write:             { icon: "save-outline",             color: "#FFD60A", label: "File Editor",    argKey: "file" },
  file_str_replace:       { icon: "create-outline",           color: "#FFD60A", label: "File Editor",    argKey: "file" },
  file_find_by_name:      { icon: "folder-open-outline",      color: "#FFD60A", label: "File Editor",    argKey: "path" },
  file_find_in_content:   { icon: "search-outline",           color: "#FFD60A", label: "File Editor",    argKey: "file" },
  image_view:             { icon: "image-outline",            color: "#FF9F0A", label: "Image Viewer",   argKey: "image" },

  // Browser tools
  browser_navigate:       { icon: "globe-outline",            color: "#FF9F0A", label: "Browser",        argKey: "url" },
  browser_view:           { icon: "eye-outline",              color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_click:          { icon: "hand-left-outline",        color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_input:          { icon: "create-outline",           color: "#FF9F0A", label: "Browser",        argKey: "text" },
  browser_scroll_up:      { icon: "arrow-up-outline",         color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_scroll_down:    { icon: "arrow-down-outline",       color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_console_exec:   { icon: "code-slash-outline",       color: "#FF9F0A", label: "Browser",        argKey: "javascript" },
  browser_console_view:   { icon: "code-slash-outline",       color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_save_image:     { icon: "image-outline",            color: "#FF9F0A", label: "Browser",        argKey: "save_dir" },
  browser_move_mouse:     { icon: "locate-outline",           color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_press_key:      { icon: "keypad-outline",           color: "#FF9F0A", label: "Browser",        argKey: "key" },
  browser_select_option:  { icon: "list-outline",             color: "#FF9F0A", label: "Browser",        argKey: "option" },
  browser_restart:        { icon: "refresh-outline",          color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_screenshot:     { icon: "camera-outline",           color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_tab_list:       { icon: "browsers-outline",         color: "#FF9F0A", label: "Browser",        argKey: "" },
  browser_tab_new:        { icon: "add-circle-outline",       color: "#FF9F0A", label: "Browser",        argKey: "url" },
  browser_tab_close:      { icon: "close-circle-outline",     color: "#FF9F0A", label: "Browser",        argKey: "tab_id" },
  browser_tab_switch:     { icon: "swap-horizontal-outline",  color: "#FF9F0A", label: "Browser",        argKey: "tab_id" },
  browser_drag:           { icon: "move-outline",             color: "#FF9F0A", label: "Browser",        argKey: "element" },
  browser_file_upload:    { icon: "cloud-upload-outline",     color: "#FF9F0A", label: "Browser",        argKey: "element" },

  // Desktop tools
  desktop_open_app:       { icon: "desktop-outline",          color: "#6E4FF6", label: "Desktop",        argKey: "app_name" },
  desktop_app_type:       { icon: "create-outline",           color: "#6E4FF6", label: "Desktop",        argKey: "text" },
  desktop_app_screenshot: { icon: "camera-outline",           color: "#6E4FF6", label: "Desktop",        argKey: "" },

  // Search tools
  web_search:             { icon: "search-outline",           color: "#5AC8FA", label: "Web Search",     argKey: "query" },
  info_search_web:        { icon: "search-outline",           color: "#5AC8FA", label: "Web Search",     argKey: "query" },
  web_browse:             { icon: "globe-outline",            color: "#5AC8FA", label: "Web Search",     argKey: "url" },

  // MCP tools
  mcp_call_tool:          { icon: "extension-puzzle-outline", color: "#64D2FF", label: "MCP",            argKey: "tool_name" },
  mcp_list_tools:         { icon: "list-outline",             color: "#64D2FF", label: "MCP",            argKey: "" },

  // Message tools
  message_notify_user:    { icon: "chatbubble-outline",       color: "#BF5AF2", label: "Message",        argKey: "text" },
  message_ask_user:       { icon: "chatbubble-ellipses-outline", color: "#BF5AF2", label: "Message",     argKey: "text" },

  // Todo tools
  todo_write:             { icon: "checkmark-circle-outline", color: "#30D158", label: "Todo",           argKey: "title" },
  todo_update:            { icon: "checkmark-circle-outline", color: "#30D158", label: "Todo",           argKey: "item_text" },
  todo_read:              { icon: "checkmark-circle-outline", color: "#30D158", label: "Todo",           argKey: "" },

  // Task tools
  task_create:            { icon: "list-circle-outline",      color: "#0A84FF", label: "Task",           argKey: "description" },
  task_complete:          { icon: "list-circle-outline",      color: "#0A84FF", label: "Task",           argKey: "task_id" },
  task_list:              { icon: "list-circle-outline",      color: "#0A84FF", label: "Task",           argKey: "" },

  // Multimedia tools
  export_pdf:             { icon: "document-outline",         color: "#FF6B6B", label: "Multimedia",     argKey: "file" },
  render_diagram:         { icon: "git-branch-outline",       color: "#FF6B6B", label: "Multimedia",     argKey: "code" },
  speech_to_text:         { icon: "mic-outline",              color: "#FF6B6B", label: "Multimedia",     argKey: "audio_file" },
  export_slides:          { icon: "easel-outline",            color: "#FF6B6B", label: "Multimedia",     argKey: "file" },
  upload_file:            { icon: "cloud-upload-outline",     color: "#FF6B6B", label: "Multimedia",     argKey: "file" },

  // Email tools
  send_email:             { icon: "mail-outline",             color: "#1E90FF", label: "Email",          argKey: "to" },

  // Idle tool
  idle:                   { icon: "time-outline",             color: "#8E8E93", label: "Idle",           argKey: "duration" },
};

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Get the tool category from a function name (e.g. "shell_exec" → "shell")
 */
export function getToolCategory(functionName: string): string {
  // Handle MCP tools that start with mcp_
  if (functionName.startsWith("mcp_")) return "mcp";
  // Handle image_view specifically
  if (functionName === "image_view") return "image";
  // Handle idle specifically
  if (functionName === "idle") return "idle";
  // Handle email
  if (functionName === "send_email") return "email";
  // Handle multimedia tools
  const multimediaTools = ["export_pdf", "render_diagram", "speech_to_text", "export_slides", "upload_file"];
  if (multimediaTools.includes(functionName)) return "multimedia";
  // Handle standard tool names
  const parts = functionName.split("_");
  if (parts.length >= 2) {
    const category = parts[0];
    if (TOOL_NAME_MAP[category]) return category;
  }
  // Fallback: check if the function name contains any known category
  for (const cat of Object.keys(TOOL_NAME_MAP)) {
    if (functionName.toLowerCase().includes(cat)) return cat;
  }
  return "shell"; // default fallback
}

/**
 * Get display info for a tool function.
 * Falls back to sensible defaults if not found.
 */
export function getToolDisplayInfo(functionName: string): ToolDisplayInfo {
  if (TOOL_DISPLAY_MAP[functionName]) {
    return TOOL_DISPLAY_MAP[functionName];
  }
  // MCP dynamic tools
  if (functionName.startsWith("mcp_")) {
    return {
      icon: "extension-puzzle-outline",
      color: "#64D2FF",
      label: "MCP",
      argKey: "tool_name",
    };
  }
  const category = getToolCategory(functionName);
  return {
    icon: TOOL_ICON_MAP[category] || "construct-outline",
    color: TOOL_COLOR_MAP[category] || "#8E8E93",
    label: TOOL_NAME_MAP[category] || functionName,
    argKey: TOOL_FUNCTION_ARG_MAP[functionName] || "",
  };
}

/**
 * Get the action verb for a tool function.
 */
export function getToolActionVerb(functionName: string): string {
  return TOOL_FUNCTION_MAP[functionName] || functionName;
}

/**
 * Get the primary argument value from function args, cleaned up for display.
 */
export function getToolPrimaryArg(
  functionName: string,
  args: Record<string, unknown>,
): string {
  const info = getToolDisplayInfo(functionName);
  let val = info.argKey && args[info.argKey] ? String(args[info.argKey]) : "";
  if (!val) {
    const firstKey = Object.keys(args).find(
      (k) => k !== "attachments" && k !== "sudo",
    );
    val = firstKey ? String(args[firstKey] ?? "") : "";
  }
  // Clean up paths
  val = val.replace(/^\/home\/ubuntu\//, "~/");
  if (val.length > 60) val = val.slice(0, 60) + "\u2026";
  return val;
}
