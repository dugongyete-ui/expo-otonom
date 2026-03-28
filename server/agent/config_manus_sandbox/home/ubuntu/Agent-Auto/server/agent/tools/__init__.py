"""
Dzeck AI Agent Tools Package.
Upgraded to class-based architecture from Ai-DzeckV2 (Manus) pattern.
Exports all tool classes and registry functions.
"""
from server.agent.tools.base import BaseTool, tool
from server.agent.tools.shell import ShellTool
from server.agent.tools.file import FileTool
from server.agent.tools.search import SearchTool
from server.agent.tools.message import MessageTool
from server.agent.tools.mcp import MCPTool, MCPClientManager, get_mcp_manager
from server.agent.tools.browser import BrowserTool
from server.agent.tools.todo import TodoTool
from server.agent.tools.task import TaskTool
from server.agent.tools.registry import (
    TOOLS,
    TOOL_ALIASES,
    TOOLKIT_MAP,
    ALL_TOOL_INSTANCES,
    get_all_tool_schemas,
    resolve_tool_name,
    get_toolkit_name,
    execute_tool,
)

message_notify = TOOLS.get("message_notify_user")
file_find = TOOLS.get("file_find_by_name")

__all__ = [
    "BaseTool",
    "tool",
    "ShellTool",
    "FileTool",
    "SearchTool",
    "MessageTool",
    "MCPTool",
    "MCPClientManager",
    "get_mcp_manager",
    "BrowserTool",
    "TodoTool",
    "TaskTool",
    "TOOLS",
    "TOOL_ALIASES",
    "TOOLKIT_MAP",
    "ALL_TOOL_INSTANCES",
    "get_all_tool_schemas",
    "resolve_tool_name",
    "get_toolkit_name",
    "execute_tool",
    "message_notify",
    "file_find",
]
