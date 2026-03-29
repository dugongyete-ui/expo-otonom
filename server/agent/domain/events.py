"""
Event builders and tool content formatters for Dzeck AI Agent.

- make_event: creates SSE event dicts
- build_tool_content: formats tool results for frontend display
- _infer_language: infers code language from file extension
- _make_e2b_proxy_url: builds download proxy URLs for E2B sandbox files
"""
import os
from typing import Any, Dict, Optional
import urllib.parse as _up

from server.agent.models.tool_result import ToolResult


_LANG_MAP = {
    "py": "python", "js": "javascript", "ts": "typescript", "tsx": "typescript",
    "jsx": "javascript", "html": "html", "css": "css", "json": "json",
    "yaml": "yaml", "yml": "yaml", "sh": "bash", "bash": "bash",
    "sql": "sql", "md": "markdown", "xml": "xml", "svg": "xml",
    "java": "java", "cpp": "cpp", "c": "c", "go": "go", "rs": "rust",
    "rb": "ruby", "php": "php", "swift": "swift", "kt": "kotlin",
    "csv": "csv", "txt": "text",
}


def _infer_language(filepath: str) -> str:
    if not filepath:
        return ""
    ext = os.path.splitext(filepath)[1].lstrip(".")
    return _LANG_MAP.get(ext, ext)


def _make_e2b_proxy_url(sandbox_path: str, filename: str, sandbox_id: str = "") -> str:
    encoded_path = _up.quote(sandbox_path, safe="")
    encoded_name = _up.quote(filename, safe="")
    if sandbox_id:
        encoded_sid = _up.quote(sandbox_id, safe="")
        return f"/api/files/download?sandbox_id={encoded_sid}&path={encoded_path}&name={encoded_name}"
    return f"/api/files/download?path={encoded_path}&name={encoded_name}"


def make_event(event_type: str, **data: Any) -> Dict[str, Any]:
    return {"type": event_type, **data}


def build_tool_content(tool_name: str, tool_result: ToolResult) -> Optional[Dict[str, Any]]:
    data = tool_result.data or {}

    if tool_name in ("shell_exec", "shell_view", "shell_wait",
                     "shell_write_to_process", "shell_kill_process"):
        console = data.get("stdout", "") or data.get("output", "")
        if data.get("stderr"):
            console += "\n" + data["stderr"]
        return {
            "type": "shell",
            "command": data.get("command", ""),
            "console": console,
            "stdout": data.get("stdout", ""),
            "stderr": data.get("stderr", ""),
            "return_code": data.get("return_code", 0),
            "id": data.get("id", ""),
            "backend": data.get("backend", ""),
        }
    elif tool_name in ("info_search_web", "web_search"):
        return {"type": "search", "query": data.get("query", ""), "results": data.get("results", [])}
    elif tool_name in (
        "web_browse", "browser_navigate", "browser_view",
        "browser_click", "browser_input", "browser_move_mouse",
        "browser_press_key", "browser_select_option",
        "browser_scroll_up", "browser_scroll_down",
        "browser_console_exec", "browser_console_view",
        "browser_save_image", "browser_restart", "browser_screenshot",
        "browser_tab_list", "browser_tab_new", "browser_tab_close", "browser_tab_switch",
        "browser_drag", "browser_file_upload",
    ):
        _MAX_SCREENSHOT_B64 = 204800
        raw_shot = data.get("screenshot_b64", "")
        if raw_shot and len(raw_shot) > _MAX_SCREENSHOT_B64:
            raw_shot = ""
        return {
            "type": "browser",
            "url": data.get("url", ""),
            "title": data.get("title", ""),
            "content": str(data.get("content", data.get("content_snippet", "")))[:2000],
            "save_path": data.get("save_path", ""),
            "screenshot_b64": raw_shot,
        }
    elif tool_name in ("desktop_open_app", "desktop_app_type", "desktop_app_screenshot"):
        _MAX_SCREENSHOT_B64 = 204800
        raw_shot = data.get("screenshot_b64", "")
        if raw_shot and len(raw_shot) > _MAX_SCREENSHOT_B64:
            raw_shot = ""
        return {
            "type": "browser",
            "url": "",
            "title": data.get("app", data.get("window", "")),
            "content": "",
            "save_path": "",
            "screenshot_b64": raw_shot,
        }
    elif tool_name == "image_view":
        data_uri = data.get("data_uri", "")
        return {
            "type": "image",
            "file": data.get("file", data.get("image", data.get("path", ""))),
            "filename": data.get("filename", ""),
            "image_b64": data.get("image_b64", data.get("screenshot_b64", "")),
            "image_url": data_uri or data.get("image_url", data.get("url", "")),
        }
    elif tool_name in ("file_read", "file_write", "file_str_replace",
                       "file_find_by_name", "file_find_in_content"):
        return {
            "type": "file",
            "file": data.get("file", data.get("image", data.get("path", ""))),
            "filename": data.get("filename", ""),
            "content": str(data.get("content_preview", "") or data.get("content", ""))[:2000],
            "operation": tool_name.replace("file_", ""),
            "language": _infer_language(data.get("file", data.get("filename", ""))),
            "download_url": data.get("download_url", ""),
        }
    elif tool_name in ("mcp_call_tool", "mcp_list_tools"):
        return {
            "type": "mcp",
            "tool_name": data.get("tool_name", ""),
            "server": data.get("server", ""),
            "arguments": data.get("arguments", data.get("args", {})),
            "result": str(data.get("result", data.get("output", "")))[:2000],
        }
    elif tool_name in ("todo_write", "todo_update", "todo_read"):
        content = data.get("content", "")
        items = []
        if content:
            for line in content.splitlines():
                ls = line.strip()
                if ls.startswith("- [x]"):
                    items.append({"text": ls[5:].strip(), "done": True})
                elif ls.startswith("- [ ]"):
                    items.append({"text": ls[5:].strip(), "done": False})
        return {
            "type": "todo",
            "todo_type": tool_name,
            "title": data.get("title", "Todo List"),
            "items": items,
            "total": data.get("total", len(items)),
            "done": data.get("done", sum(1 for i in items if i["done"])),
            "item": data.get("item", ""),
            "message": tool_result.message or "",
        }
    elif tool_name in ("task_create", "task_complete", "task_list"):
        tasks = data.get("tasks", [])
        if not tasks and data.get("task"):
            tasks = [data["task"]]
        return {
            "type": "task",
            "task_type": tool_name,
            "tasks": tasks,
            "total": data.get("total", len(tasks)),
            "task_id": data.get("task_id", ""),
            "message": tool_result.message or "",
        }

    return None
