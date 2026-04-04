"""
Event builders and tool content formatters for Dzeck AI Agent.

- make_event: creates SSE event dicts
- build_tool_content: formats tool results for frontend display
- _infer_language: infers code language from file extension
- _make_e2b_proxy_url: builds download proxy URLs for E2B sandbox files
"""
import os
from typing import Any, Dict, Optional, List
import urllib.parse as _up

from server.agent.models.tool_result import ToolResult
from server.agent.models.event import ToolStatus


_LANG_MAP = {
    "py": "python", "js": "javascript", "ts": "typescript", "tsx": "typescript",
    "jsx": "javascript", "html": "html", "css": "css", "json": "json",
    "yaml": "yaml", "yml": "yaml", "sh": "bash", "bash": "bash",
    "sql": "sql", "md": "markdown", "xml": "xml", "svg": "xml",
    "java": "java", "cpp": "cpp", "c": "c", "go": "go", "rs": "rust",
    "rb": "ruby", "php": "php", "swift": "swift", "kt": "kotlin",
    "csv": "csv", "txt": "text",
}

_MAX_SCREENSHOT_B64 = 204800


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


def _normalize_screenshot_b64(raw: str) -> str:
    """Ensure screenshot_b64 is a valid data URI, prefixed with data:image/png;base64,.
    If the image exceeds the size limit, truncate to the limit (producing a degraded but
    non-empty response) rather than silently dropping it to empty string.
    """
    if not raw:
        return ""
    raw_b64 = raw
    if raw_b64.startswith("data:"):
        prefix_end = raw_b64.find(",")
        if prefix_end >= 0:
            raw_b64 = raw_b64[prefix_end + 1:]
        else:
            raw_b64 = ""
    if not raw_b64:
        return ""
    if len(raw_b64) > _MAX_SCREENSHOT_B64:
        raw_b64 = raw_b64[:_MAX_SCREENSHOT_B64]
        while len(raw_b64) % 4 != 0:
            raw_b64 = raw_b64[:-1]
    return "data:image/png;base64," + raw_b64


def make_event(event_type: str, **data: Any) -> Dict[str, Any]:
    return {"type": event_type, **data}


def build_tool_lifecycle_events(
    toolkit_name: str,
    resolved_tool: str,
    fn_args: dict,
    tool_call_id: str,
    tool_result: ToolResult,
    function_result: str = "",
) -> List[Dict[str, Any]]:
    """Build the complete [calling, called|error] lifecycle event pair for a tool execution.

    Returns a list of two event dicts suitable for yielding from an async generator.
    This is the single shared emitter used by all tool execution paths so that
    calling/called/error transitions are always uniform.
    """
    calling = make_event(
        "tool",
        status=ToolStatus.CALLING.value,
        tool_name=toolkit_name,
        function_name=resolved_tool,
        function_args=fn_args,
        tool_call_id=tool_call_id,
    )
    tc = build_tool_content(resolved_tool, tool_result)
    if tool_result.success:
        terminal = make_event(
            "tool",
            status=ToolStatus.CALLED.value,
            tool_name=toolkit_name,
            function_name=resolved_tool,
            function_args=fn_args,
            tool_call_id=tool_call_id,
            function_result=function_result,
            tool_content=tc,
        )
    else:
        terminal = make_event(
            "tool",
            status=ToolStatus.ERROR.value,
            tool_name=toolkit_name,
            function_name=resolved_tool,
            function_args=fn_args,
            tool_call_id=tool_call_id,
            function_result=function_result or (tool_result.message or ""),
            tool_content=tc,
        )
    return [calling, terminal]


def build_tool_content(tool_name: str, tool_result: ToolResult) -> Optional[Dict[str, Any]]:
    content = _build_tool_content_inner(tool_name, tool_result)
    if content is not None:
        error_stack = tool_result.error_stack or ""
        if error_stack:
            content["error_stack"] = error_stack
    return content


def _build_tool_content_inner(tool_name: str, tool_result: ToolResult) -> Optional[Dict[str, Any]]:
    data = tool_result.data or {}
    error_msg = "" if tool_result.success else (tool_result.message or "Tool execution failed")

    if tool_name in ("shell_exec", "shell_view", "shell_wait",
                     "shell_write_to_process", "shell_kill_process"):
        stdout = data.get("stdout", "") or data.get("output", "")
        stderr = data.get("stderr", "")
        if error_msg and not stderr:
            stderr = error_msg
        console = stdout
        if stderr:
            console = (console + "\n" + stderr).strip() if console else stderr
        return {
            "type": "shell",
            "command": data.get("command", ""),
            "console": console,
            "stdout": stdout,
            "stderr": stderr,
            "return_code": data.get("return_code", -1 if error_msg else 0),
            "id": data.get("id", ""),
            "backend": data.get("backend", ""),
            "error_message": error_msg,
        }
    elif tool_name in ("info_search_web", "web_search"):
        results = data.get("results", [])
        if not isinstance(results, list):
            results = []
        normalized = []
        for r in results:
            if isinstance(r, dict):
                normalized.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("snippet", r.get("description", "")),
                })
        return {
            "type": "search",
            "query": data.get("query", ""),
            "results": normalized,
            "error_message": error_msg,
        }
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
        raw_shot = data.get("screenshot_b64", "")
        screenshot = _normalize_screenshot_b64(raw_shot)
        content_str = str(data.get("content", data.get("content_snippet", "")))[:2000]
        if error_msg and not content_str:
            content_str = error_msg
        return {
            "type": "browser",
            "url": data.get("url", ""),
            "title": data.get("title", ""),
            "content": content_str,
            "save_path": data.get("save_path", ""),
            "screenshot_b64": screenshot,
            "error_message": error_msg,
        }
    elif tool_name in ("desktop_open_app", "desktop_app_type", "desktop_app_screenshot"):
        raw_shot = data.get("screenshot_b64", "")
        screenshot = _normalize_screenshot_b64(raw_shot)
        return {
            "type": "browser",
            "url": "",
            "title": data.get("app", data.get("window", "")),
            "content": error_msg,
            "save_path": "",
            "screenshot_b64": screenshot,
            "error_message": error_msg,
        }
    elif tool_name == "image_view":
        data_uri = data.get("data_uri", "")
        raw_b64 = data.get("image_b64", data.get("screenshot_b64", ""))
        image_b64 = _normalize_screenshot_b64(raw_b64) if raw_b64 else ""
        return {
            "type": "image",
            "file": data.get("file", data.get("image", data.get("path", ""))),
            "filename": data.get("filename", ""),
            "image_b64": image_b64,
            "image_url": data_uri or data.get("image_url", data.get("url", "")),
            "error_message": error_msg,
        }
    elif tool_name in (
        "file_read", "file_write", "file_str_replace",
        "file_find_by_name", "file_find_in_content",
        "file_find", "file_delete", "file_list",
    ):
        file_path = data.get("file", data.get("path", data.get("image", "")))
        operation = tool_name.replace("file_", "")
        matches = data.get("matches", data.get("files", []))
        content_val = data.get("content_preview", "") or data.get("content", "")
        if not content_val and matches:
            content_val = "\n".join(str(m) for m in matches[:50])
        if not content_val and error_msg:
            content_val = error_msg
        return {
            "type": "file",
            "file": file_path,
            "filename": data.get("filename", os.path.basename(file_path) if file_path else ""),
            "content": str(content_val)[:2000],
            "operation": operation,
            "language": _infer_language(file_path or data.get("filename", "")),
            "download_url": data.get("download_url", ""),
            "error_message": error_msg,
        }
    elif tool_name in ("mcp_call_tool", "mcp_list_tools"):
        result_val = data.get("result", data.get("content", data.get("output", "")))
        if not result_val and error_msg:
            result_val = error_msg
        return {
            "type": "mcp",
            "tool": data.get("tool_name", ""),
            "server": data.get("server", ""),
            "arguments": data.get("arguments", data.get("args", {})),
            "result": str(result_val)[:2000] if result_val is not None else "",
            "error_message": error_msg,
        }
    elif tool_name in ("todo_write", "todo_update", "todo_read"):
        content = data.get("content", "")
        items = data.get("items", [])
        if not items and content:
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
            "done": data.get("done", sum(1 for i in items if isinstance(i, dict) and i.get("done"))),
            "item": data.get("item", ""),
            "message": tool_result.message or "",
            "error_message": error_msg,
        }
    elif tool_name in ("task_create", "task_complete", "task_list", "task_done", "task_update"):
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
            "error_message": error_msg,
        }
    elif tool_name in (
        "export_pdf", "render_diagram", "speech_to_text",
        "export_slides", "upload_file",
    ):
        file_path = data.get("file", data.get("path", data.get("output_path", "")))
        content_val = str(data.get("content", data.get("result", data.get("text", ""))))[:2000]
        if not content_val and error_msg:
            content_val = error_msg
        return {
            "type": "file",
            "file": file_path,
            "filename": data.get("filename", os.path.basename(file_path) if file_path else ""),
            "content": content_val,
            "operation": tool_name,
            "language": _infer_language(file_path or ""),
            "download_url": data.get("download_url", ""),
            "error_message": error_msg,
        }
    elif tool_name == "send_email":
        recipient = data.get("to", data.get("recipient", ""))
        content_val = "Email sent to: {}".format(recipient) if not error_msg else error_msg
        return {
            "type": "file",
            "file": "",
            "filename": "",
            "content": content_val,
            "operation": "send_email",
            "language": "",
            "download_url": "",
            "error_message": error_msg,
        }

    return {
        "type": "shell",
        "command": "",
        "console": error_msg or tool_result.message or "Tool completed",
        "stdout": "",
        "stderr": error_msg,
        "return_code": -1 if error_msg else 0,
        "id": "",
        "backend": "",
        "error_message": error_msg,
    }
