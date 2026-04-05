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

# All MCP env vars are read at call time (not module-load time) so that
# runtime environment changes take effect without a process restart.
def _get_mcp_server_url() -> str:
    return os.environ.get("MCP_SERVER_URL", "")

def _get_mcp_auth_token() -> str:
    return os.environ.get("MCP_AUTH_TOKEN", "")

def _get_mcp_config_path() -> str:
    return os.environ.get("MCP_CONFIG_PATH", "")

# Module-level aliases kept for backward-compatibility with direct imports.
MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "")
MCP_AUTH_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")


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
        token = _get_mcp_auth_token()
        if token:
            return token
        return ""

    def _call_http_mcp(self, server_url: str, tool_name: str, arguments: Dict[str, Any], auth_token: str = "") -> ToolResult:
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
        # Prefer caller-supplied token, then global env token
        effective_token = auth_token or self._get_auth_token(server_url)
        if effective_token:
            headers["Authorization"] = f"Bearer {effective_token}"

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

    def _get_servers_from_config_path(self) -> List[Dict[str, Any]]:
        """Load MCP server configs from MCP_CONFIG_PATH JSON file (highest priority)."""
        cfg_path = _get_mcp_config_path()
        if not cfg_path:
            return []
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            # Support both {servers: [...]} and {mcpServers: {name: {url:...}}} formats
            if isinstance(cfg.get("servers"), list):
                return cfg["servers"]
            if isinstance(cfg.get("mcpServers"), dict):
                return [
                    {"name": k, **v}
                    for k, v in cfg["mcpServers"].items()
                    if isinstance(v, dict)
                ]
            return []
        except FileNotFoundError:
            logger.warning(
                "[MCP] MCP_CONFIG_PATH='%s' set but file not found. "
                "Create the file or unset the env var.", cfg_path
            )
            return []
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("[MCP] Failed to parse MCP_CONFIG_PATH='%s': %s", cfg_path, exc)
            return []

    def _get_servers_from_mongo(self) -> List[Dict[str, Any]]:
        """Load MCP server configs from MongoDB at call time (authoritative source)."""
        try:
            import pymongo  # type: ignore
            mongo_uri = os.environ.get("MONGODB_URI", "")
            if not mongo_uri:
                return []
            client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=2000)
            db = client.get_default_database()
            servers = list(db["mcp_configs"].find({}, {"_id": 0}))
            client.close()
            return servers
        except Exception as exc:
            logger.debug("[MCP] Could not load servers from MongoDB: %s", exc)
            return []

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        """Execute an MCP tool by name.
        
        Resolution order:
        1. Locally registered tools (in-memory via register_tool/register_server)
        2. MCP_CONFIG_PATH JSON file (highest-priority static config)
        3. MCP servers from MongoDB (mcp_configs collection) — dynamic, no restart needed
        4. MCP_SERVER_URL env var (legacy fallback)
        """
        with self._lock:
            tool_info = self._registered_tools.get(tool_name)

        if tool_info:
            server_name = tool_info.get("server", "")
            with self._lock:
                server_cfg = self._servers.get(server_name, {})
            server_url = server_cfg.get("url", "")
            if server_url:
                return self._call_http_mcp(server_url, tool_name, arguments)

        def _try_servers(servers: List[Dict[str, Any]]) -> Optional[ToolResult]:
            last_result = None
            for server in servers:
                url = server.get("url", "")
                auth_token = server.get("auth_token", "")
                if not url:
                    continue
                result = self._call_http_mcp(url, tool_name, arguments, auth_token=auth_token)
                if result.success:
                    return result
                last_result = result
            return last_result

        # Highest priority: MCP_CONFIG_PATH static JSON file
        if _get_mcp_config_path():
            cfg_servers = self._get_servers_from_config_path()
            if cfg_servers:
                res = _try_servers(cfg_servers)
                if res is not None:
                    return res

        # Check MongoDB for dynamically configured MCP servers
        mongo_servers = self._get_servers_from_mongo()
        if mongo_servers:
            res = _try_servers(mongo_servers)
            if res is not None:
                return res

        # Fallback to MCP_SERVER_URL env var
        _srv_url = _get_mcp_server_url()
        if _srv_url:
            return self._call_http_mcp(_srv_url, tool_name, arguments)

        # No server configured — return explicit error with actionable message
        _cfg_path = _get_mcp_config_path()
        if _cfg_path:
            configured_hint = (
                "MCP_CONFIG_PATH='{}' disetel tetapi tidak ada server yang dapat dihubungi. "
                "Periksa koneksi dan konfigurasi server.".format(_cfg_path)
            )
        else:
            configured_hint = (
                "Set MCP_CONFIG_PATH ke path file JSON berisi daftar server MCP, "
                "atau set MCP_SERVER_URL untuk server tunggal."
            )
        return ToolResult(
            success=False,
            message=(
                "MCP tool '{}' tidak dapat dijalankan: belum ada MCP server yang dikonfigurasi. {}".format(
                    tool_name, configured_hint
                )
            ),
            data={"tool_name": tool_name, "arguments": arguments, "configured": False},
        )

    def list_remote_tools(self) -> ToolResult:
        """Fetch available tools from all configured MCP servers.
        
        Checks MCP_CONFIG_PATH (highest priority), MongoDB, then falls back to
        MCP_SERVER_URL env var. Returns merged tool list from all sources.
        """
        all_tools: List[Dict[str, Any]] = []

        def _fetch_tools_from_servers(servers: List[Dict[str, Any]]) -> None:
            for server in servers:
                url = server.get("url", "")
                auth_token = server.get("auth_token", "")
                if not url:
                    continue
                try:
                    body = json.dumps({
                        "jsonrpc": "2.0", "id": 1,
                        "method": "tools/list", "params": {},
                    }).encode("utf-8")
                    headers: Dict[str, str] = {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    }
                    effective_token = auth_token or self._get_auth_token(url)
                    if effective_token:
                        headers["Authorization"] = f"Bearer {effective_token}"
                    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                    with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=10) as resp:
                        result = json.loads(resp.read().decode("utf-8"))
                    tools = result.get("result", {}).get("tools", [])
                    all_tools.extend(tools)
                except Exception as exc:
                    logger.debug("[MCP] Could not list tools from %s: %s", url, exc)

        # MCP_CONFIG_PATH JSON file (highest priority)
        if _get_mcp_config_path():
            _fetch_tools_from_servers(self._get_servers_from_config_path())

        # Load from MongoDB (authoritative — includes tools added via REST API)
        _fetch_tools_from_servers(self._get_servers_from_mongo())

        _fallback_url = _get_mcp_server_url()
        if not all_tools and _fallback_url:
            return self._list_http_tools(_fallback_url)

        local_tools = self.get_all_tools()
        all_tools.extend(local_tools)

        if not all_tools:
            _cfg_path_list = _get_mcp_config_path()
            if _cfg_path_list:
                hint = (
                    "MCP_CONFIG_PATH='{}' disetel tetapi tidak ada tools yang ditemukan. "
                    "Periksa file konfigurasi dan koneksi server.".format(_cfg_path_list)
                )
            else:
                hint = (
                    "Set MCP_CONFIG_PATH ke path file JSON berisi daftar server MCP, "
                    "atau set MCP_SERVER_URL untuk server tunggal, "
                    "atau gunakan POST /api/mcp/config untuk mendaftarkan server secara dinamis."
                )
            return ToolResult(
                success=False,
                message="Tidak ada MCP server yang dikonfigurasi. " + hint,
                data={"tools": [], "count": 0, "configured": False},
            )

        return ToolResult(
            success=True,
            message=f"Available MCP tools ({len(all_tools)}):\n{json.dumps(all_tools, indent=2)[:3000]}",
            data={"tools": all_tools, "count": len(all_tools), "configured": True},
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

    @tool(
        name="mcp_tool",
        description=(
            "Call a specific MCP (Model Context Protocol) tool by name with arguments. "
            "Alias for mcp_call_tool — use when the tool name is known. "
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
    def _mcp_tool(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> ToolResult:
        return self._manager.call_tool(tool_name, arguments or {})
