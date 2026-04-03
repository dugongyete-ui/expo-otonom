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

// ─── Tool Category → Color (monochrome) ────────────────────────────────────
export const TOOL_COLOR_MAP: Record<string, string> = {
  shell: "#888888",
  file: "#888888",
  browser: "#888888",
  desktop: "#888888",
  search: "#888888",
  info: "#888888",
  message: "#888888",
  mcp: "#888888",
  todo: "#888888",
  task: "#888888",
  image: "#888888",
  multimedia: "#888888",
  email: "#888888",
  idle: "#888888",
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
  shell_exec:             { icon: "terminal-outline",         color: "#888888", label: "Terminal",       argKey: "command" },
  shell_view:             { icon: "terminal-outline",         color: "#888888", label: "Terminal",       argKey: "id" },
  shell_wait:             { icon: "time-outline",             color: "#888888", label: "Terminal",       argKey: "id" },
  shell_write_to_process: { icon: "terminal-outline",         color: "#888888", label: "Terminal",       argKey: "input" },
  shell_kill_process:     { icon: "close-circle-outline",     color: "#888888", label: "Terminal",       argKey: "id" },

  // File tools
  file_read:              { icon: "document-text-outline",    color: "#888888", label: "File Editor",    argKey: "file" },
  file_write:             { icon: "save-outline",             color: "#888888", label: "File Editor",    argKey: "file" },
  file_str_replace:       { icon: "create-outline",           color: "#888888", label: "File Editor",    argKey: "file" },
  file_find_by_name:      { icon: "folder-open-outline",      color: "#888888", label: "File Editor",    argKey: "path" },
  file_find_in_content:   { icon: "search-outline",           color: "#888888", label: "File Editor",    argKey: "file" },
  image_view:             { icon: "image-outline",            color: "#888888", label: "Image Viewer",   argKey: "image" },

  // Browser tools
  browser_navigate:       { icon: "globe-outline",            color: "#888888", label: "Browser",        argKey: "url" },
  browser_view:           { icon: "eye-outline",              color: "#888888", label: "Browser",        argKey: "" },
  browser_click:          { icon: "hand-left-outline",        color: "#888888", label: "Browser",        argKey: "" },
  browser_input:          { icon: "create-outline",           color: "#888888", label: "Browser",        argKey: "text" },
  browser_scroll_up:      { icon: "arrow-up-outline",         color: "#888888", label: "Browser",        argKey: "" },
  browser_scroll_down:    { icon: "arrow-down-outline",       color: "#888888", label: "Browser",        argKey: "" },
  browser_console_exec:   { icon: "code-slash-outline",       color: "#888888", label: "Browser",        argKey: "javascript" },
  browser_console_view:   { icon: "code-slash-outline",       color: "#888888", label: "Browser",        argKey: "" },
  browser_save_image:     { icon: "image-outline",            color: "#888888", label: "Browser",        argKey: "save_dir" },
  browser_move_mouse:     { icon: "locate-outline",           color: "#888888", label: "Browser",        argKey: "" },
  browser_press_key:      { icon: "keypad-outline",           color: "#888888", label: "Browser",        argKey: "key" },
  browser_select_option:  { icon: "list-outline",             color: "#888888", label: "Browser",        argKey: "option" },
  browser_restart:        { icon: "refresh-outline",          color: "#888888", label: "Browser",        argKey: "" },
  browser_screenshot:     { icon: "camera-outline",           color: "#888888", label: "Browser",        argKey: "" },
  browser_tab_list:       { icon: "browsers-outline",         color: "#888888", label: "Browser",        argKey: "" },
  browser_tab_new:        { icon: "add-circle-outline",       color: "#888888", label: "Browser",        argKey: "url" },
  browser_tab_close:      { icon: "close-circle-outline",     color: "#888888", label: "Browser",        argKey: "tab_id" },
  browser_tab_switch:     { icon: "swap-horizontal-outline",  color: "#888888", label: "Browser",        argKey: "tab_id" },
  browser_drag:           { icon: "move-outline",             color: "#888888", label: "Browser",        argKey: "element" },
  browser_file_upload:    { icon: "cloud-upload-outline",     color: "#888888", label: "Browser",        argKey: "element" },

  // Desktop tools
  desktop_open_app:       { icon: "desktop-outline",          color: "#888888", label: "Desktop",        argKey: "app_name" },
  desktop_app_type:       { icon: "create-outline",           color: "#888888", label: "Desktop",        argKey: "text" },
  desktop_app_screenshot: { icon: "camera-outline",           color: "#888888", label: "Desktop",        argKey: "" },

  // Search tools
  web_search:             { icon: "search-outline",           color: "#888888", label: "Web Search",     argKey: "query" },
  info_search_web:        { icon: "search-outline",           color: "#888888", label: "Web Search",     argKey: "query" },
  web_browse:             { icon: "globe-outline",            color: "#888888", label: "Web Search",     argKey: "url" },

  // MCP tools
  mcp_call_tool:          { icon: "extension-puzzle-outline", color: "#888888", label: "MCP",            argKey: "tool_name" },
  mcp_list_tools:         { icon: "list-outline",             color: "#888888", label: "MCP",            argKey: "" },

  // Message tools
  message_notify_user:    { icon: "chatbubble-outline",       color: "#888888", label: "Message",        argKey: "text" },
  message_ask_user:       { icon: "chatbubble-ellipses-outline", color: "#888888", label: "Message",     argKey: "text" },

  // Todo tools
  todo_write:             { icon: "checkmark-circle-outline", color: "#888888", label: "Todo",           argKey: "title" },
  todo_update:            { icon: "checkmark-circle-outline", color: "#888888", label: "Todo",           argKey: "item_text" },
  todo_read:              { icon: "checkmark-circle-outline", color: "#888888", label: "Todo",           argKey: "" },

  // Task tools
  task_create:            { icon: "list-circle-outline",      color: "#888888", label: "Task",           argKey: "description" },
  task_complete:          { icon: "list-circle-outline",      color: "#888888", label: "Task",           argKey: "task_id" },
  task_list:              { icon: "list-circle-outline",      color: "#888888", label: "Task",           argKey: "" },

  // Multimedia tools
  export_pdf:             { icon: "document-outline",         color: "#888888", label: "Multimedia",     argKey: "file" },
  render_diagram:         { icon: "git-branch-outline",       color: "#888888", label: "Multimedia",     argKey: "code" },
  speech_to_text:         { icon: "mic-outline",              color: "#888888", label: "Multimedia",     argKey: "audio_file" },
  export_slides:          { icon: "easel-outline",            color: "#888888", label: "Multimedia",     argKey: "file" },
  upload_file:            { icon: "cloud-upload-outline",     color: "#888888", label: "Multimedia",     argKey: "file" },

  // Email tools
  send_email:             { icon: "mail-outline",             color: "#888888", label: "Email",          argKey: "to" },

  // Idle tool
  idle:                   { icon: "time-outline",             color: "#888888", label: "Idle",           argKey: "duration" },
};

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Get the tool category from a function name (e.g. "shell_exec" → "shell")
 */
export function getToolCategory(functionName: string): string {
  if (functionName.startsWith("mcp_")) return "mcp";
  if (functionName === "image_view") return "image";
  if (functionName === "idle") return "idle";
  if (functionName === "send_email") return "email";
  const multimediaTools = ["export_pdf", "render_diagram", "speech_to_text", "export_slides", "upload_file"];
  if (multimediaTools.includes(functionName)) return "multimedia";
  const parts = functionName.split("_");
  if (parts.length >= 2) {
    const category = parts[0];
    if (TOOL_NAME_MAP[category]) return category;
  }
  for (const cat of Object.keys(TOOL_NAME_MAP)) {
    if (functionName.toLowerCase().includes(cat)) return cat;
  }
  return "shell";
}

/**
 * Get display info for a tool function.
 */
export function getToolDisplayInfo(functionName: string): ToolDisplayInfo {
  if (TOOL_DISPLAY_MAP[functionName]) {
    return TOOL_DISPLAY_MAP[functionName];
  }
  if (functionName.startsWith("mcp_")) {
    return {
      icon: "extension-puzzle-outline",
      color: "#888888",
      label: "MCP",
      argKey: "tool_name",
    };
  }
  const category = getToolCategory(functionName);
  return {
    icon: TOOL_ICON_MAP[category] || "construct-outline",
    color: "#888888",
    label: TOOL_NAME_MAP[category] || functionName,
    argKey: TOOL_FUNCTION_ARG_MAP[functionName] || "",
  };
}

// ─── Tool Category Color Palette (monochrome) ───────────────────────────────
export interface ToolCategoryColor {
  icon: string;
  background: string;
  accent: string;
}

/**
 * Get monochrome colors for a tool category.
 */
export function getToolCategoryColor(functionName: string): ToolCategoryColor {
  return { icon: "#888888", background: "rgba(255,255,255,0.05)", accent: "#555555" };
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
  val = val.replace(/^\/home\/ubuntu\//, "~/");
  if (val.length > 60) val = val.slice(0, 60) + "\u2026";
  return val;
}
