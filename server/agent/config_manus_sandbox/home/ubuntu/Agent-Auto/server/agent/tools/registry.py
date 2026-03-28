"""
Tool Registry for Dzeck AI Agent.
Provides centralized tool instantiation and schema building.
Based on Ai-DzeckV2 (Manus) pattern.
"""
from typing import Dict, Any, List, Callable, Optional

from server.agent.models.tool_result import ToolResult
from server.agent.tools.shell import ShellTool, shell_exec, shell_view, shell_wait, shell_write_to_process, shell_kill_process
from server.agent.tools.file import FileTool, file_read, file_write, file_str_replace, file_find_by_name, file_find_in_content, image_view
from server.agent.tools.search import SearchTool, info_search_web, web_search, web_browse
from server.agent.tools.message import MessageTool, message_notify_user, message_ask_user
from server.agent.tools.mcp import MCPTool, mcp_call_tool, mcp_list_tools, get_mcp_manager
from server.agent.tools.todo import TodoTool, todo_write, todo_update, todo_read
from server.agent.tools.task import TaskTool, task_create, task_complete, task_list
from server.agent.tools.browser import (
    BrowserTool,
    browser_navigate, browser_view, browser_click, browser_input,
    browser_move_mouse, browser_press_key, browser_select_option,
    browser_scroll_up, browser_scroll_down, browser_console_exec,
    browser_console_view, browser_save_image, image_view as browser_image_view,
)


# ─── Singleton tool instances ─────────────────────────────────────────────────

_shell_tool = ShellTool()
_file_tool = FileTool()
_search_tool = SearchTool()
_message_tool = MessageTool()
_mcp_tool = MCPTool()
_browser_tool = BrowserTool()
_todo_tool = TodoTool()
_task_tool = TaskTool()

ALL_TOOL_INSTANCES = [
    _shell_tool,
    _file_tool,
    _search_tool,
    _message_tool,
    _mcp_tool,
    _browser_tool,
    _todo_tool,
    _task_tool,
]


def get_all_tool_schemas() -> List[Dict[str, Any]]:
    """Get all tool schemas from registered tool instances."""
    schemas = []
    for tool_instance in ALL_TOOL_INSTANCES:
        schemas.extend(tool_instance.get_tools())
    return schemas


# ─── Function-based TOOLS dict (backward compat with agent_flow.py) ──────────

TOOLS: Dict[str, Callable] = {
    "message_notify_user": message_notify_user,
    "message_ask_user": message_ask_user,
    "shell_exec": shell_exec,
    "shell_view": shell_view,
    "shell_wait": shell_wait,
    "shell_write_to_process": shell_write_to_process,
    "shell_kill_process": shell_kill_process,
    "file_read": file_read,
    "file_write": file_write,
    "file_str_replace": file_str_replace,
    "file_find_by_name": file_find_by_name,
    "file_find_in_content": file_find_in_content,
    "image_view": image_view,
    "info_search_web": info_search_web,
    "web_search": web_search,
    "web_browse": web_browse,
    "browser_navigate": browser_navigate,
    "browser_view": browser_view,
    "browser_click": browser_click,
    "browser_input": browser_input,
    "browser_move_mouse": browser_move_mouse,
    "browser_press_key": browser_press_key,
    "browser_select_option": browser_select_option,
    "browser_scroll_up": browser_scroll_up,
    "browser_scroll_down": browser_scroll_down,
    "browser_console_exec": browser_console_exec,
    "browser_console_view": browser_console_view,
    "browser_save_image": browser_save_image,
    "mcp_call_tool": mcp_call_tool,
    "mcp_list_tools": mcp_list_tools,
    "todo_write": todo_write,
    "todo_update": todo_update,
    "todo_read": todo_read,
    "task_create": task_create,
    "task_complete": task_complete,
    "task_list": task_list,
}

TOOL_ALIASES: Dict[str, str] = {
    "message_notify": "message_notify_user",
    "message_ask": "message_ask_user",
    "file_find": "file_find_by_name",
    "browser_open": "browser_navigate",
    "browse": "web_browse",
    "search": "info_search_web",
    "web_search": "info_search_web",
    "browser_type": "browser_input",
    "browser_scroll": "browser_scroll_down",
    "browser_scroll_to_bottom": "browser_scroll_down",
    "browser_read_links": "browser_view",
    "browser_restart": "browser_navigate",
    "todo": "todo_read",
    "tasks": "task_list",
}

TOOLKIT_MAP: Dict[str, str] = {
    "shell_exec": "shell", "shell_view": "shell", "shell_wait": "shell",
    "shell_write_to_process": "shell", "shell_kill_process": "shell",
    "file_read": "file", "file_write": "file", "file_str_replace": "file",
    "file_find_by_name": "file", "file_find_in_content": "file",
    "image_view": "file",
    "info_search_web": "search", "web_search": "search", "web_browse": "search",
    "browser_navigate": "browser", "browser_view": "browser",
    "browser_click": "browser", "browser_input": "browser",
    "browser_move_mouse": "browser", "browser_press_key": "browser",
    "browser_select_option": "browser",
    "browser_scroll_up": "browser", "browser_scroll_down": "browser",
    "browser_console_exec": "browser", "browser_console_view": "browser",
    "browser_save_image": "browser",
    "message_notify_user": "message", "message_ask_user": "message",
    "mcp_call_tool": "mcp", "mcp_list_tools": "mcp",
    "todo_write": "todo", "todo_update": "todo", "todo_read": "todo",
    "task_create": "task", "task_complete": "task", "task_list": "task",
}


def resolve_tool_name(name: str) -> Optional[str]:
    """Resolve tool name (handles aliases)."""
    if name in TOOLS:
        return name
    if name in TOOL_ALIASES:
        return TOOL_ALIASES[name]
    return None


def get_toolkit_name(function_name: str) -> str:
    """Get toolkit category name for a function."""
    return TOOLKIT_MAP.get(function_name, "unknown")


def execute_tool(tool_name: str, tool_args: Dict[str, Any]) -> ToolResult:
    """Execute a tool by name with given arguments."""
    resolved = resolve_tool_name(tool_name)
    if resolved is None:
        return ToolResult(
            success=False,
            message="Unknown tool '{}'. Available: {}".format(tool_name, ", ".join(TOOLS.keys())),
        )
    tool_fn = TOOLS[resolved]
    try:
        result = tool_fn(**tool_args)
        if isinstance(result, ToolResult):
            return result
        if isinstance(result, dict):
            return ToolResult(
                success=result.get("success", True),
                message=str(result),
                data=result,
            )
        return ToolResult(success=True, message=str(result))
    except TypeError as e:
        return ToolResult(success=False, message="Invalid args for '{}': {}".format(tool_name, e))
    except Exception as e:
        return ToolResult(success=False, message="Tool '{}' failed: {}".format(tool_name, e))
