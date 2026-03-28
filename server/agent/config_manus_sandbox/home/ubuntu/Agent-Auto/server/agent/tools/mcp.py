"""
MCP (Model Context Protocol) tools for Dzeck AI Agent.
Upgraded to class-based architecture from Ai-DzeckV2 (Manus) pattern.
Supports: HTTP, stdio-over-HTTP, SSE transport via MCP_SERVER_URL env var.
Provides: MCPTool class + backward-compatible functions.
"""
import os
import json
import asyncio
import subprocess
import threading
import urllib.request
import urllib.error
import ssl
import logging
from typing import Optional, List, Dict, Any

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

logger = logging.getLogger(__name__)

MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "")
MCP_AUTH_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")
CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")


def _make_ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    return ctx


class MCPClientManager:
    """Manages MCP server connections and tool execution."""

    def __init__(self) -> None:
        self._servers: Dict[str, Dict[str, Any]] = {}
        self._registered_tools: Dict[str, Dict[str, Any]] = {}
        self._stdio_processes: Dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def register_server(self, name: str, config: Dict[str, Any]) -> None:
        with self._lock:
            self._servers[name] = config

    def register_tool(self, name: str, description: str, server: str,
                      parameters: Optional[Dict[str, Any]] = None) -> None:
        with self._lock:
            self._registered_tools[name] = {
                "name": name,
                "description": description,
                "server": server,
                "parameters": parameters or {},
            }

    def get_all_tools(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._registered_tools.values())

    @staticmethod
    def _get_auth_token(server_url: str) -> str:
        """Get the appropriate auth token for a given MCP server URL."""
        if MCP_AUTH_TOKEN:
            return MCP_AUTH_TOKEN
        return ""

    def _call_http_mcp(self, server_url: str, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        """Call an HTTP/SSE MCP server endpoint."""
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }).encode("utf-8")

        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": "DzeckAI/2.0",
        }
        auth_token = self._get_auth_token(server_url)
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        req = urllib.request.Request(server_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=30) as resp:
                raw = resp.read().decode("utf-8")

            # Handle SSE format
            if raw.startswith("data:"):
                lines = [l.strip() for l in raw.split("\n") if l.strip().startswith("data:")]
                if lines:
                    raw = lines[0][5:].strip()

            result = json.loads(raw)
            if "result" in result:
                content = result["result"].get("content", result["result"])
                return ToolResult(
                    success=True,
                    message=f"MCP '{tool_name}' result: {json.dumps(content, default=str)[:2000]}",
                    data={"tool_name": tool_name, "content": content},
                )
            elif "error" in result:
                return ToolResult(success=False, message=f"MCP error: {result['error']}", data={"error": result["error"]})
        except urllib.error.HTTPError as e:
            return ToolResult(success=False, message=f"MCP HTTP {e.code}: {e.reason}", data={"error": str(e)})
        except Exception as e:
            return ToolResult(success=False, message=f"MCP call failed: {str(e)}", data={"error": str(e)})

        return ToolResult(success=False, message="MCP call returned no result")

    def _list_http_tools(self, server_url: str) -> ToolResult:
        """Fetch tool list from HTTP MCP server."""
        body = json.dumps({
            "jsonrpc": "2.0", "id": 1,
            "method": "tools/list", "params": {},
        }).encode("utf-8")
        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        auth_token = self._get_auth_token(server_url)
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        req = urllib.request.Request(server_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=15) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            tools = result.get("result", {}).get("tools", [])
            return ToolResult(
                success=True,
                message=f"MCP tools from {server_url} ({len(tools)} tools):\n{json.dumps(tools, indent=2)[:3000]}",
                data={"tools": tools, "count": len(tools), "server": server_url},
            )
        except Exception as e:
            return ToolResult(success=False, message=f"Failed to list MCP tools: {str(e)}", data={"error": str(e)})

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        """Execute an MCP tool by name."""
        with self._lock:
            tool_info = self._registered_tools.get(tool_name)

        if tool_info:
            server_name = tool_info.get("server", "")
            with self._lock:
                server_cfg = self._servers.get(server_name, {})
            server_url = server_cfg.get("url", "")
            if server_url:
                return self._call_http_mcp(server_url, tool_name, arguments)

        # Fallback to MCP_SERVER_URL
        if MCP_SERVER_URL:
            return self._call_http_mcp(MCP_SERVER_URL, tool_name, arguments)

        return ToolResult(
            success=False,
            message=(
                "MCP tool '{}' tidak dapat dijalankan: belum ada MCP server yang dikonfigurasi. "
                "Set environment variable MCP_SERVER_URL untuk mengaktifkan MCP tools eksternal. "
                "Set MCP_AUTH_TOKEN jika MCP server memerlukan autentikasi.".format(tool_name)
            ),
            data={"tool_name": tool_name, "arguments": arguments, "configured": False},
        )

    def list_remote_tools(self) -> ToolResult:
        """Fetch available tools from the configured MCP server."""
        if MCP_SERVER_URL:
            return self._list_http_tools(MCP_SERVER_URL)

        local_tools = self.get_all_tools()
        if not local_tools:
            return ToolResult(
                success=True,
                message=(
                    "No MCP server configured (set MCP_SERVER_URL in environment). "
                    "No local MCP tools registered. "
                    "MCP allows connecting to external services via Model Context Protocol."
                ),
                data={"tools": [], "count": 0, "configured": False},
            )

        return ToolResult(
            success=True,
            message=f"Registered local MCP tools ({len(local_tools)}):\n{json.dumps(local_tools, indent=2)[:3000]}",
            data={"tools": local_tools, "count": len(local_tools), "configured": False},
        )

    def cleanup(self) -> None:
        with self._lock:
            self._servers.clear()
            self._registered_tools.clear()
        for proc in self._stdio_processes.values():
            try:
                proc.terminate()
            except Exception:
                pass
        self._stdio_processes.clear()


# Module-level singleton
_mcp_manager = MCPClientManager()


# ─── Backward-compatible functions ───────────────────────────────────────────

def mcp_call_tool(tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> ToolResult:
    """Call an MCP tool by name."""
    return _mcp_manager.call_tool(tool_name, arguments or {})


def mcp_list_tools() -> ToolResult:
    """List available MCP tools."""
    return _mcp_manager.list_remote_tools()


def get_mcp_manager() -> MCPClientManager:
    return _mcp_manager


# ─── Class-based MCPTool (Ai-DzeckV2 / Manus pattern) ───────────────────────

class MCPTool(BaseTool):
    """MCP tool class - provides Model Context Protocol integration."""

    name: str = "mcp"

    def __init__(self, manager: Optional[MCPClientManager] = None) -> None:
        super().__init__()
        self._manager = manager or _mcp_manager

    @tool(
        name="mcp_list_tools",
        description=(
            "List all available MCP (Model Context Protocol) tools from connected servers. "
            "Call this before using mcp_call_tool to discover what tools are available. "
            "MCP tools can include specialized services, APIs, databases, and external integrations."
        ),
        parameters={},
        required=[],
    )
    def _mcp_list_tools(self) -> ToolResult:
        return self._manager.list_remote_tools()

    @tool(
        name="mcp_call_tool",
        description=(
            "Call a specific MCP tool by name with arguments. "
            "First use mcp_list_tools to discover available tools and their parameters. "
            "MCP tools extend agent capabilities with external services."
        ),
        parameters={
            "tool_name": {"type": "string", "description": "Name of the MCP tool to call"},
            "arguments": {
                "type": "object",
                "description": "Arguments to pass to the MCP tool (key-value pairs)",
            },
        },
        required=["tool_name"],
    )
    def _mcp_call_tool(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> ToolResult:
        return self._manager.call_tool(tool_name, arguments or {})
