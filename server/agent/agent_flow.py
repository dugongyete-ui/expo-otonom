#!/usr/bin/env python3
"""
Dzeck AI Agent - Async Plan-Act Flow Engine

- Language:         Python async (AsyncGenerator)
- LLM:             Cerebras AI (api.cerebras.ai) with native tool calling
- Framework:       Pydantic BaseModel + async generator streaming
- Browser:         Playwright real browser + HTTP fallback
- Architecture:    DDD: Domain / Application / Infrastructure layers
- Session mgmt:    Full session resume / rollback support
- Model:           llama-3.3-70b (default, supports native tool calling)
"""
import os
import re
import sys
import json
import time
import asyncio
import traceback
import urllib.request
import urllib.error
import concurrent.futures
from enum import Enum
from typing import AsyncGenerator, Optional, Dict, Any, List




# Force unbuffered stdout for real-time streaming to Node.js subprocess
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

from server.agent.tools.registry import (
    TOOLS,
    TOOL_ALIASES,
    TOOLKIT_MAP,
    resolve_tool_name,
    get_toolkit_name,
    execute_tool,
    get_all_tool_schemas,
)
# Individual function imports for backward compatibility
from server.agent.tools.search import web_search, web_browse, info_search_web
from server.agent.tools.shell import shell_exec, shell_view, shell_wait, shell_write_to_process, shell_kill_process
from server.agent.tools.file import file_read, file_write, file_str_replace, file_find_by_name, file_find_in_content, image_view
from server.agent.tools.message import message_notify_user, message_ask_user
from server.agent.tools.browser import browser_navigate, browser_view, browser_click, browser_input, browser_move_mouse, browser_press_key, browser_select_option, browser_scroll_up, browser_scroll_down, browser_console_exec, browser_console_view, browser_save_image, browser_restart, browser_screenshot, browser_tab_list, browser_tab_new, browser_tab_close, browser_tab_switch, browser_drag, browser_file_upload
from server.agent.tools.desktop import desktop_open_app, desktop_app_type, desktop_app_screenshot
from server.agent.tools.mcp import mcp_call_tool, mcp_list_tools

from server.agent.models.plan import Plan, Step, ExecutionStatus
from server.agent.models.event import PlanStatus, StepStatus, ToolStatus
from server.agent.models.memory import Memory
from server.agent.models.tool_result import ToolResult

from server.agent.utils.robust_json_parser import RobustJsonParser

from server.agent.prompts.system import SYSTEM_PROMPT
from server.agent.prompts.planner import (
    PLANNER_SYSTEM_PROMPT,
    CREATE_PLAN_PROMPT,
    UPDATE_PLAN_PROMPT,
)
from server.agent.prompts.execution import (
    EXECUTION_SYSTEM_PROMPT,
    EXECUTION_PROMPT,
    SUMMARIZE_PROMPT,
)
from server.agent.prompts.agents.web_agent import WEB_AGENT_SYSTEM_PROMPT, WEB_AGENT_TOOLS
from server.agent.prompts.agents.data_agent import DATA_AGENT_SYSTEM_PROMPT, DATA_AGENT_TOOLS
from server.agent.prompts.agents.code_agent import CODE_AGENT_SYSTEM_PROMPT, CODE_AGENT_TOOLS
from server.agent.prompts.agents.files_agent import FILES_AGENT_SYSTEM_PROMPT, FILES_AGENT_TOOLS


class FlowState(str, Enum):
    IDLE = "idle"
    PLANNING = "planning"
    EXECUTING = "executing"
    UPDATING = "updating"
    SUMMARIZING = "summarizing"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"


CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions"

CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")

if not CEREBRAS_API_KEY:
    _err_event = json.dumps({"type": "error", "error": "API key tidak dikonfigurasi. Tambahkan CEREBRAS_API_KEY di environment variables lalu restart server."})
    sys.stdout.write(_err_event + "\n")
    sys.stdout.flush()
    sys.stdout.write(json.dumps({"type": "done"}) + "\n")
    sys.stdout.flush()
    sys.exit(1)


def _build_tool_schemas() -> List[Dict[str, Any]]:
    """Build TOOL_SCHEMAS dynamically from class-based tool registry.
    Converts OpenAI format to CF-native format.
    """
    schemas = []
    for openai_schema in get_all_tool_schemas():
        fn = openai_schema.get("function", openai_schema)
        schemas.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {"type": "object"}),
        })
    return schemas


TOOL_SCHEMAS: List[Dict[str, Any]] = _build_tool_schemas()


# ── Multi-Agent Context Helpers ────────────────────────────────────────────────

_AGENT_CONTEXT_MAP: Dict[str, tuple] = {
    "web": (WEB_AGENT_SYSTEM_PROMPT, WEB_AGENT_TOOLS),
    "data": (DATA_AGENT_SYSTEM_PROMPT, DATA_AGENT_TOOLS),
    "code": (CODE_AGENT_SYSTEM_PROMPT, CODE_AGENT_TOOLS),
    "files": (FILES_AGENT_SYSTEM_PROMPT, FILES_AGENT_TOOLS),
    "general": (EXECUTION_SYSTEM_PROMPT, None),
}

_AGENT_DISPLAY_NAMES: Dict[str, str] = {
    "web": "Web Agent (Browsing & Extraction)",
    "data": "Data Agent (Analysis & API)",
    "code": "Code Agent (Python & Automation)",
    "files": "Files Agent (Management & Processing)",
    "general": "Execution Agent",
}


def _get_agent_context(agent_type: str) -> tuple:
    """Return (system_prompt, allowed_tools_list_or_None) for the given agent type."""
    return _AGENT_CONTEXT_MAP.get(agent_type, _AGENT_CONTEXT_MAP["general"])


def _filter_tool_schemas(allowed_tools: Optional[List[str]]) -> List[Dict[str, Any]]:
    """Filter TOOL_SCHEMAS to only the tools allowed for this agent.
    
    'idle' is always included so the agent can finish a step.
    If allowed_tools is None, return all schemas (no filter).
    """
    if allowed_tools is None:
        return TOOL_SCHEMAS
    allowed_set = set(allowed_tools)
    allowed_set.add("idle")  # always allow idle
    allowed_set.add("task_complete")  # always allow task_complete
    return [s for s in TOOL_SCHEMAS if s.get("name") in allowed_set]


def make_event(event_type: str, **data: Any) -> Dict[str, Any]:
    """Create an event dict for streaming."""
    return {"type": event_type, **data}


def _get_model_name() -> str:
    """Return the Cerebras model to use for the agent."""
    candidate = os.environ.get("CEREBRAS_AGENT_MODEL") or ""
    if candidate and "/" not in candidate:
        return candidate
    return "qwen-3-235b-a22b-instruct-2507"


def _build_request_body(messages: list, stream: bool = True, tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Build a Cerebras-compatible request body."""
    body: Dict[str, Any] = {
        "model": _get_model_name(),
        "messages": messages,
        "stream": stream,
        "max_tokens": 8192,
        "temperature": 0.7,
        "top_p": 1,
    }
    if tools:
        converted = []
        for t in tools:
            if "type" in t:
                converted.append(t)
            else:
                converted.append({"type": "function", "function": t})
        body["tools"] = converted
    return body


def _make_cerebras_request(url: str, body: Dict[str, Any]) -> urllib.request.Request:
    """Create a pre-configured urllib Request for the Cerebras API."""
    return urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer {}".format(CEREBRAS_API_KEY),
            "User-Agent": "DzeckAI/2.0",
        },
        method="POST",
    )


def call_cerebras_streaming(messages: list) -> str:
    """Synchronous Cerebras streaming call. Returns full accumulated text."""
    last_error: Optional[Exception] = None
    for attempt in range(4):
        body = _build_request_body(messages, stream=True)
        req = _make_cerebras_request(CEREBRAS_API_URL, body)
        full_text = ""
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                buf = ""
                for raw_line in resp:
                    buf += raw_line.decode("utf-8", errors="replace")
                    while "\n" in buf:
                        chunk_line, buf = buf.split("\n", 1)
                        chunk_line = chunk_line.strip()
                        if not chunk_line or not chunk_line.startswith("data: "):
                            continue
                        payload = chunk_line[6:]
                        if payload == "[DONE]":
                            break
                        try:
                            parsed = json.loads(payload)
                            content = parsed.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                            if isinstance(content, str):
                                full_text += content
                        except (json.JSONDecodeError, IndexError, KeyError):
                            pass
            return full_text
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429 or e.code >= 500:
                wait = 2 ** attempt
                sys.stderr.write("[agent] Cerebras streaming error (attempt {}): {} — retrying in {}s\n".format(attempt + 1, e, wait))
                sys.stderr.flush()
                time.sleep(wait)
            else:
                sys.stderr.write("[agent] Cerebras streaming error: {}\n".format(e))
                sys.stderr.flush()
                break
        except Exception as e:
            last_error = e
            sys.stderr.write("[agent] Cerebras streaming error: {}\n".format(e))
            sys.stderr.flush()
            break
    return full_text


async def call_cerebras_streaming_realtime(
    messages: list,
) -> AsyncGenerator[str, None]:
    """True async streaming from Cerebras AI. Yields text chunks in real-time."""
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def _stream_worker() -> None:
        for attempt in range(4):
            body = _build_request_body(messages, stream=True)
            req = _make_cerebras_request(CEREBRAS_API_URL, body)
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    buf = ""
                    for raw_line in resp:
                        buf += raw_line.decode("utf-8", errors="replace")
                        while "\n" in buf:
                            chunk_line, buf = buf.split("\n", 1)
                            chunk_line = chunk_line.strip()
                            if not chunk_line or not chunk_line.startswith("data: "):
                                continue
                            payload = chunk_line[6:]
                            if payload == "[DONE]":
                                loop.call_soon_threadsafe(queue.put_nowait, None)
                                return
                            try:
                                parsed = json.loads(payload)
                                content = parsed.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                                if content and isinstance(content, str):
                                    loop.call_soon_threadsafe(queue.put_nowait, content)
                            except (json.JSONDecodeError, IndexError, KeyError):
                                pass
                return
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    wait = 2 ** attempt
                    sys.stderr.write("[agent] Cerebras realtime streaming error (attempt {}): {} — retrying in {}s\n".format(attempt + 1, e, wait))
                    sys.stderr.flush()
                    time.sleep(wait)
                else:
                    sys.stderr.write("[agent] Cerebras realtime streaming error: {}\n".format(e))
                    sys.stderr.flush()
                    break
            except Exception as e:
                sys.stderr.write("[agent] Cerebras realtime streaming error: {}\n".format(e))
                sys.stderr.flush()
                break
        loop.call_soon_threadsafe(queue.put_nowait, None)

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = loop.run_in_executor(executor, _stream_worker)
    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk
    finally:
        try:
            await future
        except Exception:
            pass
        executor.shutdown(wait=False)


def call_cerebras_api(
    messages: list,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Synchronous Cerebras API call. Returns full response dict."""
    body = _build_request_body(messages, stream=False, tools=tools)
    req = _make_cerebras_request(CEREBRAS_API_URL, body)
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def _normalize_response_text(value: Any) -> str:
    """Normalize response content field to always return a plain string."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def call_cerebras_text(messages: list) -> str:
    result = call_cerebras_api(messages)
    choices = result.get("choices", [])
    if choices:
        content = choices[0].get("message", {}).get("content", "")
        return _normalize_response_text(content)
    return ""


def call_text_with_retry(messages: list, max_retries: int = 7) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            return call_cerebras_text(messages)
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429:
                # Use longer backoff for rate limits: 5, 10, 20, 40, 60, 60, 60
                wait_time = min(5 * (2 ** attempt), 60)
                sys.stderr.write(f"[agent] Rate limited (429), retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})\n")
                sys.stderr.flush()
                time.sleep(wait_time)
            elif e.code >= 500:
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("LLM call failed after {} retries".format(max_retries))


# Models known NOT to support native function-calling tool schemas on Cerebras.
_NO_TOOL_CALL_MODELS = {"llama3.1-8b", "llama-3.1-8b-instruct"}
_TOOLS_SUPPORTED: Optional[bool] = None if _get_model_name() not in _NO_TOOL_CALL_MODELS else False


def call_api_with_retry(
    messages: list,
    tools: Optional[List[Dict[str, Any]]] = None,
    max_retries: int = 7,
) -> Dict[str, Any]:
    """Call Cerebras API with retry. Falls back to text-only if tools cause 400."""
    global _TOOLS_SUPPORTED
    last_error: Optional[Exception] = None
    effective_tools = tools if _TOOLS_SUPPORTED is not False else None

    for attempt in range(max_retries):
        try:
            result = call_cerebras_api(messages, tools=effective_tools)
            if effective_tools is not None:
                _TOOLS_SUPPORTED = True
            return result
        except urllib.error.HTTPError as e:
            if e.code == 400 and effective_tools is not None:
                _TOOLS_SUPPORTED = False
                sys.stderr.write("[agent] Model doesn't support native tool schemas (400). Falling back to text-based tool calling.\n")
                sys.stderr.flush()
                effective_tools = None
                try:
                    return call_cerebras_api(messages, tools=None)
                except Exception as e2:
                    last_error = e2
                    continue
            last_error = e
            if e.code == 429:
                # Use longer backoff for rate limits: 5, 10, 20, 40, 60, 60, 60
                wait_time = min(5 * (2 ** attempt), 60)
                sys.stderr.write(f"[agent] Rate limited (429), retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})\n")
                sys.stderr.flush()
                time.sleep(wait_time)
            elif e.code >= 500:
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("LLM call failed")


def _extract_cerebras_response(api_result: Dict[str, Any]) -> tuple:
    """Extract (text, tool_calls) from Cerebras API response."""
    text = ""
    tool_calls = None
    choices = api_result.get("choices", [])
    if choices:
        msg = choices[0].get("message", {})
        text = _normalize_response_text(msg.get("content", ""))
        oa_calls = msg.get("tool_calls")
        if oa_calls:
            tool_calls = []
            for tc in oa_calls:
                fn = tc.get("function", {})
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except Exception:
                    args = {}
                tool_calls.append({"name": fn.get("name", ""), "arguments": args})
    return text, tool_calls


_LANG_MAP = {
    "py": "python", "js": "javascript", "ts": "typescript", "tsx": "typescript",
    "jsx": "javascript", "html": "html", "css": "css", "json": "json",
    "yaml": "yaml", "yml": "yaml", "sh": "bash", "bash": "bash",
    "sql": "sql", "md": "markdown", "xml": "xml", "svg": "xml",
    "java": "java", "cpp": "cpp", "c": "c", "go": "go", "rs": "rust",
    "rb": "ruby", "php": "php", "swift": "swift", "kt": "kotlin",
    "csv": "csv", "txt": "text",
}


def _make_e2b_proxy_url(sandbox_path: str, filename: str, sandbox_id: str = "") -> str:
    """Generate a proxy download URL that streams file content directly from E2B sandbox.
    The server endpoint reads from sandbox_id + path without copying to local disk."""
    import urllib.parse as _up
    encoded_path = _up.quote(sandbox_path, safe="")
    encoded_name = _up.quote(filename, safe="")
    if sandbox_id:
        encoded_sid = _up.quote(sandbox_id, safe="")
        return f"/api/files/download?sandbox_id={encoded_sid}&path={encoded_path}&name={encoded_name}"
    return f"/api/files/download?path={encoded_path}&name={encoded_name}"


def _infer_language(filepath: str) -> str:
    if not filepath:
        return ""
    import os as _os
    ext = _os.path.splitext(filepath)[1].lstrip(".")
    return _LANG_MAP.get(ext, ext)


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
        return {
            "type": "browser",
            "url": data.get("url", ""),
            "title": data.get("title", ""),
            "content": str(data.get("content", data.get("content_snippet", "")))[:2000],
            "save_path": data.get("save_path", ""),
            "screenshot_b64": data.get("screenshot_b64", ""),
        }
    elif tool_name in ("desktop_open_app", "desktop_app_type", "desktop_app_screenshot"):
        return {
            "type": "browser",
            "url": "",
            "title": data.get("app", data.get("window", "")),
            "content": "",
            "save_path": "",
            "screenshot_b64": data.get("screenshot_b64", ""),
        }
    elif tool_name == "image_view":
        # image_view returns data_uri (e.g. "data:image/png;base64,...")
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


def _coerce_bool(value: Any, default: bool = True) -> bool:
    """Safely coerce a value (including LLM string 'true'/'false') to Python bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no", "")
    if value is None:
        return default
    return bool(value)


def _compact_exec_messages(messages: list) -> list:
    """Compact exec_messages when they exceed 16 messages to prevent token overflow.

    Inspired by ai-manus compact_memory approach:
    - Keeps system prompt + initial user prompt ALWAYS (full context)
    - Keeps last 6 messages ALWAYS (most recent context)
    - Middle messages: truncate BROWSER content (huge HTML), keep FILE/SHELL results (agent needs paths)
    - Never truncate file_write results — agent must track which files it created and where
    """
    if len(messages) <= 16:
        return messages

    system_msg = messages[0]
    first_user_msg = messages[1] if len(messages) > 1 else None
    last_6 = messages[-6:]
    middle = messages[2:-6] if len(messages) > 8 else []
    if not middle:
        return messages

    compacted_middle = []
    for msg in middle:
        role = msg.get("role", "")
        content = str(msg.get("content", ""))

        is_browser_result = any(kw in content for kw in [
            "browser_navigate", "browser_view", "browser_click",
            "<html", "<!DOCTYPE", "document.querySelector",
        ])
        is_file_write = "file_write" in content or "Wrote file" in content or "File written" in content
        is_shell_result = "return_code:" in content or "stdout:" in content

        if is_browser_result and not is_file_write:
            truncated = content[:200] + "...[browser content truncated]" if len(content) > 200 else content
            compacted_middle.append({"role": role, "content": truncated})
        elif is_file_write:
            compacted_middle.append(msg)
        elif is_shell_result:
            truncated = content[:800] + "...[truncated]" if len(content) > 800 else content
            compacted_middle.append({"role": role, "content": truncated})
        else:
            truncated = content[:400] + "...[truncated]" if len(content) > 400 else content
            compacted_middle.append({"role": role, "content": truncated})

    result = [system_msg]
    if first_user_msg:
        result.append(first_user_msg)
    result.extend(compacted_middle)
    result.extend(last_6)
    return result


def safe_plan_dict(plan: Plan) -> Dict[str, Any]:
    d = plan.to_dict()
    d.pop("goal", None)
    return d


class DzeckAgent:
    """
    Async AI Agent implementing Plan-Act flow.
    
    Upgraded from synchronous to AsyncGenerator-based streaming.
    Supports:
    - Full session persistence (MongoDB)
    - Redis state caching
    - Session resume / rollback
    - Real Playwright browser automation
    - DDD architecture (domain / application / infrastructure)
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        max_tool_iterations: int = 20,
    ) -> None:
        self.session_id = session_id
        self.memory = Memory()
        self.max_tool_iterations = max_tool_iterations
        self.plan: Optional[Plan] = None
        self.state = FlowState.IDLE
        self.parser = RobustJsonParser()
        self._session_service: Any = None
        self._created_files: List[Dict[str, Any]] = []
        self.chat_history: List[Dict[str, Any]] = []

    async def _get_session_service(self) -> Any:
        """Lazy-load session service."""
        if self._session_service is None:
            try:
                from server.agent.services.session_service import get_session_service
                self._session_service = await get_session_service()
            except Exception as e:
                sys.stderr.write("[agent] Session service unavailable: {}\n".format(e))
                sys.stderr.flush()
        return self._session_service

    def _is_explicitly_actionable(self, user_message: str) -> bool:
        """Return True when the message is clearly actionable and should NEVER
        trigger clarification — e.g. contains a URL plus an action verb, or
        explicit "langsung"/"tanpa bertanya" directives."""
        msg = user_message.strip().lower()
        raw = user_message.strip()

        has_url = bool(re.search(r'https?://', raw))

        action_kw = re.search(
            r'\b(buka|navigasi|navigate|go to|open|browse|visit|scroll|klik|click'
            r'|jalankan|run|execute|gunakan browser|langsung|tanpa bertanya'
            r'|lakukan langsung)\b',
            msg,
        )

        if has_url and action_kw:
            return True

        # Explicit "do it now" directives
        if re.search(r'\b(lakukan langsung|tanpa bertanya|langsung saja|just do it|do it now)\b', msg):
            return True

        return False

    async def _pre_plan_clarification_check(
        self,
        user_message: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[str]:
        """
        Before creating any plan, quickly check if the user's request is too vague
        to act on without clarification. If yes, return the clarification question
        to ask. If the request is clear enough, return None.
        """
        # Skip clarification entirely when the request is explicitly actionable
        if self._is_explicitly_actionable(user_message):
            return None
        sys_msg = {
            "role": "system",
            "content": (
                "Kamu adalah asisten yang membantu menentukan apakah permintaan user cukup spesifik "
                "untuk dikerjakan langsung, atau perlu klarifikasi terlebih dahulu.\n\n"
                "Jawab HANYA dengan JSON valid:\n"
                "{\"needs_clarification\": true/false, \"question\": \"pertanyaan klarifikasi jika perlu\"}\n\n"
                "Perlu klarifikasi JIKA permintaan terlalu umum dan detail penting tidak diketahui, "
                "misalnya: 'buat script Python' (tapi tidak tahu untuk apa), "
                "'buat presentasi' (tapi tidak tahu topik/slide/tujuannya), "
                "'kumpulkan riset' (tapi tidak tahu tentang apa).\n\n"
                "TIDAK perlu klarifikasi JIKA: permintaan sudah spesifik, "
                "user sudah menyebutkan tujuan/detail yang cukup, "
                "atau ini pertanyaan faktual sederhana."
            ),
        }
        messages: List[Dict[str, Any]] = [sys_msg]
        if chat_history:
            for h in (chat_history or [])[-6:]:
                role = h.get("role", "")
                content = h.get("content", "")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": str(content)[:800]})
        messages.append({
            "role": "user",
            "content": "Permintaan user: \"{}\"".format(user_message),
        })
        try:
            loop = asyncio.get_event_loop()
            body = _build_request_body(messages, stream=False)
            body["max_tokens"] = 200
            req = _make_cerebras_request(CEREBRAS_API_URL, body)

            def _do_request() -> Optional[str]:
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        parsed = json.loads(resp.read().decode("utf-8", errors="replace"))
                    choices = parsed.get("choices", [])
                    content = choices[0].get("message", {}).get("content", "") if choices else ""
                    if not content:
                        return None
                    content = content.strip()
                    if content.startswith("```"):
                        content = content.split("```")[1]
                        if content.startswith("json"):
                            content = content[4:]
                    result = json.loads(content)
                    if result.get("needs_clarification") and result.get("question"):
                        return str(result["question"])
                    return None
                except Exception as e:
                    sys.stderr.write("[agent] Clarification check error: {}\n".format(e))
                    return None

            return await loop.run_in_executor(None, _do_request)
        except Exception:
            return None

    async def _persist_event(self, event_type: str, data: Dict[str, Any]) -> None:
        """Persist event to MongoDB (non-blocking, best-effort)."""
        if not self.session_id:
            return
        try:
            svc = await self._get_session_service()
            if svc:
                store = await svc._get_session_store()
                if store:
                    await store.save_event(self.session_id, event_type, data)
        except Exception:
            pass

    def _parse_response(self, text: str) -> Dict[str, Any]:
        result, _ = self.parser.parse(text)
        return result if result is not None else {}

    def _detect_language(self, text: str) -> str:
        id_words = [
            "saya", "anda", "untuk", "yang", "dengan", "dari", "ini",
            "itu", "bisa", "akan", "sudah", "tidak", "ada", "juga",
            "atau", "harus", "karena", "supaya", "seperti", "bantu",
            "tolong", "projek", "bagaimana", "silakan", "terima", "kasih",
        ]
        text_lower = text.lower()
        id_count = sum(1 for w in id_words if w in text_lower)
        if id_count >= 2:
            return "id"
        if any("\u4e00" <= c <= "\u9fff" for c in text):
            return "zh"
        if any("\u3040" <= c <= "\u309f" or "\u30a0" <= c <= "\u30ff" for c in text):
            return "ja"
        if any("\uac00" <= c <= "\ud7af" for c in text):
            return "ko"
        return "id"

    def _is_simple_query(self, user_message: str) -> bool:
        """
        Determine if a query can be answered directly without Plan-Act tools.
        
        Returns True (respond directly) when:
        - Conversational / social messages
        - Knowledge/explanation questions answerable from training data
        - Math, translations, creative writing, code explanation
        
        Returns False (use Plan-Act) when:
        - Real-time info needed (news, prices, weather, current events)
        - Web browsing / URL access requested
        - File system operations
        - Shell/code execution
        - Complex multi-step creation tasks
        - Research tasks that need web search
        - Any URL present in the message
        """
        msg = user_message.strip().lower()
        raw = user_message.strip()

        # 0. Any URL in message → needs browser/search tool
        if re.search(r'https?://', raw):
            return False

        # 1. Explicit tool-requiring patterns → ALWAYS use Plan-Act
        tool_required_patterns = [
            # Real-time / current info
            r'\b(today|sekarang|hari ini|saat ini|terbaru|latest|current|now|live)\b',
            r'\b(news|berita|harga|price|cuaca|weather|stock|saham|kurs|exchange rate)\b',
            r'\b(trending|viral|populer|terkini|breaking)\b',
            # Action-based tasks
            r'\b(buka|buka situs|browse|visit|navigat|go to|open|akses|cek website|kunjungi)\b',
            r'\b(download|unduh|upload|scrape|crawl)\b',
            r'\b(install|uninstall|pip install|apt-get|npm install)\b',
            r'\b(run|execute|jalankan|eksekusi|exec)\b',
            r'\b(buat file|create file|write file|tulis file|simpan file|save file)\b',
            r'\b(buat folder|create folder|mkdir|hapus file|delete file)\b',
            r'\b(deploy|publish|hosting|server|api endpoint)\b',
            r'\b(bash|shell|command|cmd|terminal|script\.sh|\.py|\.js|\.ts)\b',
            # Complex creation
            r'\b(buat website|create website|build website|buat aplikasi|create app|build app)\b',
            r'\b(buat program|create program|tulis program|write program|code this|coding)\b',
            r'\b(research|riset|investigasi|investigate|analisis mendalam|analyze)\b',
            # File references (paths)
            r'[/\\][a-zA-Z0-9_.-]+\.[a-zA-Z]{2,4}',
        ]
        for pattern in tool_required_patterns:
            if re.search(pattern, msg):
                return False

        # 2. Pure conversational → always direct
        conversational = [
            r'^\s*(hi|hello|hey|halo|hai|hei|howdy)\s*[!.]?\s*$',
            r'^\s*(thanks?|thank you|terima kasih|makasih|thx)\s*[!.]?\s*$',
            r'^\s*(ok|okay|oke|baik|siap|noted|got it|paham)\s*[!.]?\s*$',
            r'^\s*(yes|no|ya|tidak|nope|yep|sure)\s*[!.]?\s*$',
            r'^\s*(bye|goodbye|sampai jumpa|dadah|see you)\s*[!.]?\s*$',
            r'^\s*(good morning|good night|selamat pagi|selamat malam|selamat siang|selamat sore)\s*[!.]?\s*$',
            r'\b(how are you|apa kabar|kabar gimana|how\'s it going)\b',
            r'\b(who are you|siapa kamu|siapa anda|kamu siapa|anda siapa)\b',
            r'\b(what can you do|apa yang bisa kamu|kemampuan kamu|fitur kamu)\b',
            r'\b(are you (an )?ai|kamu ai|kamu robot|apakah kamu)\b',
        ]
        for pattern in conversational:
            if re.search(pattern, msg):
                return True

        # 3. Knowledge/explanation questions — answerable from training data
        #    Only if they don't contain real-time signals
        knowledge_starters = [
            "what is", "what are", "what does", "what was",
            "who is", "who are", "who was",
            "when was", "when did", "where is", "where was",
            "why is", "why are", "why does", "why did",
            "how does", "how do", "how is", "how was",
            "explain", "define", "describe", "tell me about",
            "what's the difference", "compare",
            "apa itu", "apa yang", "apa bedanya",
            "siapa", "kapan", "dimana", "mengapa", "kenapa",
            "jelaskan", "ceritakan", "definisikan", "apa artinya",
            "bagaimana cara", "bagaimana",
        ]
        # Signals that a "what is" question still needs real-time data
        realtime_signals = [
            r'\b(now|today|current|latest|2024|2025|2026|terbaru|sekarang|hari ini|saat ini)\b',
            r'\b(price|harga|cost|biaya|rate|nilai|kurs)\b',
            r'\b(news|berita|update|terkini|terbaru)\b',
        ]
        for starter in knowledge_starters:
            if msg.startswith(starter) or f' {starter} ' in msg:
                if not any(re.search(p, msg) for p in realtime_signals):
                    return True

        # 4. Math/calculation questions → direct
        if re.search(r'(\d+[\s]*[\+\-\*\/\^%][\s]*\d+|berapa|calculate|hitung|compute|convert)', msg):
            if not re.search(r'\b(currency|mata uang|kurs|exchange|rate)\b', msg):
                return True

        # 5. Translation requests → direct
        if re.search(r'\b(translate|terjemahkan|translation|terjemahan|in english|dalam bahasa|ke bahasa)\b', msg):
            return True

        # 6. Creative writing (short) → direct
        if re.search(r'\b(write a poem|write a story|puisi|cerita pendek|story about|poem about|buat puisi|buat cerita)\b', msg):
            word_count = len(msg.split())
            if word_count < 20:  # Only short creative prompts — long ones might need research
                return True

        # 7. Code explanation (not execution) → direct
        if re.search(r'\b(explain (this )?code|what does this code|apa fungsi|fungsi dari|code ini|kode ini)\b', msg):
            return True

        # 8. Short simple messages (≤ 6 words with no action signals) → direct
        word_count = len(msg.split())
        if word_count <= 6:
            simple_action = re.search(
                r'\b(cari|search|find|buka|open|buat|create|make|build|tulis|write|jalankan|run)\b',
                msg
            )
            if not simple_action:
                return True

        return False

    def _build_attachments_info(self, attachments: Optional[List] = None) -> str:
        """Build a human-readable attachments description from a list of dicts or strings."""
        if not attachments:
            return ""
        parts = []
        for a in attachments:
            if isinstance(a, dict):
                fname = a.get("filename") or a.get("name") or "file"
                fpath = a.get("path") or ""
                mime = a.get("mime") or ""
                preview = a.get("preview") or ""
                desc = fname
                if fpath:
                    desc += f" (saved at {fpath})"
                if mime:
                    desc += f" [{mime}]"
                if preview:
                    snippet = preview[:500] + ("..." if len(preview) > 500 else "")
                    desc += f"\nContent preview:\n{snippet}"
                parts.append(desc)
            elif isinstance(a, str):
                parts.append(a)
        return "Lampiran:\n" + "\n---\n".join(parts) if parts else ""

    async def run_planner_async(
        self,
        user_message: str,
        attachments: Optional[List] = None,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> Plan:
        """Create plan asynchronously (runs sync LLM call in thread pool)."""
        self.state = FlowState.PLANNING
        language = self._detect_language(user_message)
        attachments_info = self._build_attachments_info(attachments)
        history_context = ""
        if chat_history:
            history_parts = []
            for h in chat_history[-6:]:
                role = h.get("role", "")
                content = h.get("content", "")
                if role in ("user", "assistant") and content:
                    label = "User" if role == "user" else "Dzeck"
                    history_parts.append("{}: {}".format(label, str(content)[:500]))
            if history_parts:
                history_context = "\n\nKonteks percakapan sebelumnya:\n" + "\n".join(history_parts)
        prompt = CREATE_PLAN_PROMPT.format(
            message=user_message + history_context,
            language=language,
            attachments_info=attachments_info,
        )
        json_instruction = "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation."
        # Inject detected sandbox home so planner generates correct paths
        from server.agent.tools.e2b_sandbox import _detected_home as _planner_home, WORKSPACE_DIR as _planner_wsdir
        _planner_sandbox_home = _planner_home or _planner_wsdir
        _sandbox_ctx = (
            f"\n\n[SANDBOX_CONTEXT] Home directory = {_planner_sandbox_home} | "
            f"Output dir = {_planner_sandbox_home}/output | "
            f"Gunakan '{_planner_sandbox_home}' atau ~ untuk semua path. "
            f"JANGAN hardcode path home lainnya dalam rencana."
        )
        messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT + json_instruction + _sandbox_ctx},
            {"role": "user", "content": prompt},
        ]

        loop = asyncio.get_event_loop()
        response_text = await loop.run_in_executor(
            None, lambda: call_text_with_retry(messages)
        )
        parsed = self._parse_response(response_text)

        if not parsed:
            return Plan(
                title="Task Execution",
                goal=user_message[:100],
                language=language,
                steps=[Step(id="1", description=user_message)],
                message="I'll work on this task for you.",
            )

        steps = [
            Step(
                id=str(s.get("id", "")),
                description=s.get("description", ""),
                agent_type=s.get("agent_type", "general"),
            )
            for s in parsed.get("steps", [])
        ]
        if not steps:
            steps = [Step(id="1", description=user_message)]

        return Plan(
            title=parsed.get("title", "Task"),
            goal=parsed.get("goal", user_message[:100]),
            language=parsed.get("language", language),
            steps=steps,
            message=parsed.get("message", ""),
        )

    async def _run_tool_streaming(
        self,
        fn_name: str,
        fn_args: Dict[str, Any],
        tool_call_id: str,
        step: Step,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Execute a single tool call and yield events in real-time:
        1. Yields "calling" event IMMEDIATELY (shows spinner to user)
        2. Awaits tool execution
        3. Yields "called" or "error" event with results
        4. Yields a special "__result__" event with result_summary for exec_messages
        5. If idle/task_complete, yields "__step_done__" sentinel
        """
        if fn_name in ("idle", "task_complete"):
            step.status = ExecutionStatus.COMPLETED
            step.success = _coerce_bool(fn_args.get("success"), default=True)
            step.result = fn_args.get("result", "Step completed")
            if not step.success:
                step.status = ExecutionStatus.FAILED

            if step.success and step.result:
                _result_lower = step.result.lower()
                _error_markers = ["traceback", "error:", "failed", "exception:", "syntaxerror", "indentationerror"]
                if any(marker in _result_lower for marker in _error_markers):
                    step.success = False
                    step.status = ExecutionStatus.FAILED
                    step.result += " [AUTO-REJECTED: Output contains unresolved error indicators]"

            status_enum = StepStatus.COMPLETED if step.success else StepStatus.FAILED
            yield make_event("step", status=status_enum.value, step=step.to_dict())
            yield {"type": "__step_done__"}
            return

        resolved = resolve_tool_name(fn_name)
        if resolved is None:
            yield {"type": "__result__", "value": "Unknown tool '{}'.".format(fn_name)}
            return

        # ── Special: message_notify_user → emit as inline "notify" event (not a chat bubble) ──
        # This prevents mid-execution notifications from rendering as final AI responses
        if resolved == "message_notify_user":
            text = fn_args.get("text", "") or fn_args.get("message", "")
            # Convert attachment file paths to download URLs so frontend can show download buttons
            raw_attachments = fn_args.get("attachments") or []
            attachment_urls = []
            if raw_attachments:
                try:
                    from server.agent.tools.e2b_sandbox import get_sandbox, _resolve_sandbox_path
                    _sb = get_sandbox()
                    _sandbox_id = _sb.sandbox_id if _sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
                    for fpath in raw_attachments:
                        if not fpath:
                            continue
                        fname = os.path.basename(fpath)
                        sandbox_path = _resolve_sandbox_path(fpath) if not fpath.startswith("/") else fpath
                        durl = _make_e2b_proxy_url(sandbox_path, fname, _sandbox_id)
                        attachment_urls.append({"filename": fname, "download_url": durl, "sandbox_path": sandbox_path})
                        # Also track in _created_files for the end-of-task files event
                        already = any(f.get("filename") == fname for f in self._created_files)
                        if not already:
                            try:
                                from server.agent.tools.e2b_sandbox import _MIME_MAP_E2B
                                ext = os.path.splitext(fname)[1].lower()
                                mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                            except Exception:
                                mime = "application/octet-stream"
                            self._created_files.append({
                                "filename": fname,
                                "sandbox_path": sandbox_path,
                                "sandbox_id": _sandbox_id,
                                "download_url": durl,
                                "mime": mime,
                            })
                except Exception:
                    pass
            if text or attachment_urls:
                yield make_event("notify", text=text, attachments=attachment_urls if attachment_urls else None)
            _res = resolved
            _args = dict(fn_args)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: execute_tool(_res, _args))
            yield {"type": "__result__", "value": text or "Done"}
            return

        # ── Special: message_ask_user → emit as "ask" role bubble, then halt execution ──
        if resolved == "message_ask_user":
            text = fn_args.get("text", "") or fn_args.get("message", "")
            if text:
                yield make_event("message_start", role="ask")
                chunk_size = 10
                for i in range(0, len(text), chunk_size):
                    yield make_event("message_chunk", chunk=text[i:i + chunk_size], role="ask")
                    await asyncio.sleep(0.008)
                yield make_event("message_end", role="ask")
            step.status = ExecutionStatus.PENDING
            step.success = False
            step.result = "Menunggu jawaban user: " + (text[:200] if text else "")
            yield make_event("step", status=StepStatus.PENDING.value, step=step.to_dict())
            yield make_event("waiting_for_user", text=text or "Menunggu balasan Anda...")
            yield {"type": "__step_done__"}
            return

        toolkit_name = get_toolkit_name(resolved)

        # ── 1. Emit "calling" IMMEDIATELY so user sees the spinner right away ──
        yield make_event(
            "tool",
            status=ToolStatus.CALLING.value,
            tool_name=toolkit_name,
            function_name=resolved,
            function_args=fn_args,
            tool_call_id=tool_call_id,
        )

        # ── 2. Execute the tool (await = real async, unblocks event loop) ──
        loop = asyncio.get_event_loop()
        _res = resolved
        _args = dict(fn_args)

        _is_shell_exec = _res == "shell_exec"
        _is_e2b = bool(os.environ.get("E2B_API_KEY", ""))

        if _is_shell_exec and not _is_e2b:
            import queue as _queue_mod
            from server.agent.tools.shell import set_stream_queue
            stream_q: "_queue_mod.Queue" = _queue_mod.Queue()
            stream_lines: list = []

            def _run_shell_with_stream():
                set_stream_queue(stream_q)
                try:
                    return execute_tool(_res, _args)
                finally:
                    set_stream_queue(None)

            future = loop.run_in_executor(None, _run_shell_with_stream)

            while not future.done():
                await asyncio.sleep(0.15)
                batch = []
                try:
                    while True:
                        item = stream_q.get_nowait()
                        if item is None:
                            break
                        batch.append(item)
                except _queue_mod.Empty:
                    pass
                if batch:
                    chunk = "\n".join(("[stderr] " if t == "stderr" else "") + l for t, l in batch)
                    stream_lines.extend(batch)
                    yield make_event("tool_stream", tool_call_id=tool_call_id, chunk=chunk)

            try:
                while True:
                    item = stream_q.get_nowait()
                    if item is None:
                        break
                    stream_lines.append(item)
            except _queue_mod.Empty:
                pass

            tool_result = await future
        elif _is_shell_exec and _is_e2b:
            import queue as _queue_mod
            e2b_q: "_queue_mod.Queue" = _queue_mod.Queue()

            def _run_e2b_streaming():
                from server.agent.tools.e2b_sandbox import get_sandbox
                from server.agent.tools.shell import (
                    _validate_python_syntax, _check_repeated_command_prerun,
                    _check_repeated_error, _check_error_in_output,
                    _preflight_requirements_file,
                )
                sb = get_sandbox()
                cmd = _args.get("command", "")
                from server.agent.tools.e2b_sandbox import _resolve_workdir as _rwd
                workdir = _rwd(_args.get("exec_dir", "") or "")
                timeout_s = _args.get("timeout", 90)
                if not sb:
                    return execute_tool(_res, _args)

                from server.agent.models.tool_result import ToolResult

                req_err = _preflight_requirements_file(cmd, workdir)
                if req_err:
                    e2b_q.put(None)
                    return ToolResult(
                        success=False,
                        message=req_err,
                        data={"stdout": "", "stderr": req_err, "return_code": 1,
                              "command": cmd, "backend": "E2B",
                              "error": "requirements_file_not_found"},
                    )

                blocked = _check_repeated_command_prerun(cmd)
                if blocked:
                    e2b_q.put(None)
                    return blocked

                syntax_err = _validate_python_syntax(cmd, workdir)
                if syntax_err:
                    e2b_q.put(None)
                    return syntax_err

                try:
                    import shlex
                    sb.commands.run(f"mkdir -p {shlex.quote(workdir)} 2>/dev/null || true", timeout=10)
                    result = sb.commands.run(
                        cmd, cwd=workdir, timeout=timeout_s,
                        on_stdout=lambda data: e2b_q.put(("stdout", data if isinstance(data, str) else getattr(data, 'line', str(data)))),
                        on_stderr=lambda data: e2b_q.put(("stderr", data if isinstance(data, str) else getattr(data, 'line', str(data)))),
                    )
                    e2b_q.put(None)
                    combined = ""
                    if result.stdout and result.stdout.strip():
                        combined += "stdout:\n{}".format(result.stdout)
                    if result.stderr and result.stderr.strip():
                        combined += "\nstderr:\n{}".format(result.stderr)
                    combined += "\nreturn_code: {}".format(result.exit_code)

                    stdout_str = result.stdout or ""
                    stderr_str = result.stderr or ""
                    repeat_warn = _check_repeated_error(cmd, stderr_str)
                    if repeat_warn:
                        combined += repeat_warn
                    has_error = _check_error_in_output(stdout_str, stderr_str)
                    if has_error and result.exit_code == 0:
                        combined += "\n⚠️ WARNING: Output contains error indicators despite exit_code=0. Verify output carefully."

                    return ToolResult(
                        success=(result.exit_code == 0),
                        message=combined,
                        data={"stdout": stdout_str, "stderr": stderr_str,
                              "return_code": result.exit_code, "command": cmd, "backend": "E2B"},
                    )
                except Exception as e:
                    e2b_q.put(None)
                    return ToolResult(
                        success=False,
                        message=f"E2B error: {e}",
                        data={"stdout": "", "stderr": str(e), "return_code": -1, "command": cmd, "backend": "E2B"},
                    )

            future = loop.run_in_executor(None, _run_e2b_streaming)

            while not future.done():
                await asyncio.sleep(0.15)
                batch = []
                try:
                    while True:
                        item = e2b_q.get_nowait()
                        if item is None:
                            break
                        batch.append(item)
                except _queue_mod.Empty:
                    pass
                if batch:
                    chunk = "\n".join(("[stderr] " if t == "stderr" else "") + l for t, l in batch)
                    yield make_event("tool_stream", tool_call_id=tool_call_id, chunk=chunk)

            # Drain any remaining items after future completes (prevents output loss)
            final_batch = []
            try:
                while True:
                    item = e2b_q.get_nowait()
                    if item is None:
                        break
                    final_batch.append(item)
            except _queue_mod.Empty:
                pass
            if final_batch:
                chunk = "\n".join(("[stderr] " if t == "stderr" else "") + l for t, l in final_batch)
                yield make_event("tool_stream", tool_call_id=tool_call_id, chunk=chunk)

            tool_result = await future
        else:
            tool_result = await loop.run_in_executor(
                None, lambda: execute_tool(_res, _args)
            )

        tool_content = build_tool_content(resolved, tool_result)
        result_status = ToolStatus.CALLED if tool_result.success else ToolStatus.ERROR
        fn_result = str(tool_result.message)[:3000] if tool_result.message else ""

        # ── Track ALL files created by file_write / file_str_replace ──
        # Files are collected here and only shown via the `files` event at task end,
        # preventing premature download links from appearing in chat mid-task.
        if tool_result.success and resolved in ("file_write", "file_str_replace"):
            data = tool_result.data or {}
            fpath = data.get("file", data.get("path", fn_args.get("file", fn_args.get("path", ""))))
            fname = os.path.basename(fpath) if fpath else ""
            if fname and fpath:
                already = any(f.get("filename") == fname for f in self._created_files)
                if not already:
                    try:
                        from server.agent.tools.e2b_sandbox import get_sandbox, _resolve_sandbox_path
                        sb = get_sandbox()
                        sandbox_id = sb.sandbox_id if sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
                        sandbox_path = _resolve_sandbox_path(fpath) if not fpath.startswith("/") else fpath
                    except Exception:
                        sandbox_id = ""
                        sandbox_path = fpath
                    ext = os.path.splitext(fname)[1].lower()
                    try:
                        from server.agent.tools.e2b_sandbox import _MIME_MAP_E2B
                        mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                    except Exception:
                        mime = "application/octet-stream"
                    durl = _make_e2b_proxy_url(sandbox_path, fname, sandbox_id)
                    self._created_files.append({
                        "filename": fname,
                        "sandbox_path": sandbox_path,
                        "sandbox_id": sandbox_id,
                        "download_url": durl,
                        "mime": mime,
                    })
            # Also strip download_url from tool_content to prevent premature display
            if tool_content and tool_content.get("type") == "file":
                tool_content = {k: v for k, v in tool_content.items() if k != "download_url"}

        # ── Track E2B OUTPUT files created by shell commands ──
        if tool_result.success and resolved == "shell_exec" and bool(os.environ.get("E2B_API_KEY", "")):
            try:
                from server.agent.tools.e2b_sandbox import list_output_files, get_sandbox, _MIME_MAP_E2B
                e2b_files = list_output_files()
                sb = get_sandbox()
                sandbox_id = sb.sandbox_id if sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
                synced_fnames = {f.get("filename", "") for f in self._created_files}
                for ef in e2b_files:
                    fname = os.path.basename(ef)
                    if fname and fname not in synced_fnames:
                        ext = os.path.splitext(fname)[1].lower()
                        mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                        durl = _make_e2b_proxy_url(ef, fname, sandbox_id)
                        self._created_files.append({
                            "filename": fname,
                            "sandbox_path": ef,
                            "sandbox_id": sandbox_id,
                            "download_url": durl,
                            "mime": mime,
                        })
                        synced_fnames.add(fname)
            except Exception:
                pass

        # ── 2b. After tool execution, check if E2B Desktop sandbox was created ──
        # If so, emit the VNC stream URL so the frontend can connect to the desktop
        if _is_e2b:
            try:
                from server.agent.tools.e2b_sandbox import get_vnc_stream_url, get_sandbox
                vnc_url = get_vnc_stream_url()
                sb = get_sandbox()
                sandbox_id = sb.sandbox_id if sb else None
                if vnc_url and not getattr(self, '_vnc_url_emitted', False):
                    yield make_event("vnc_stream_url",
                                     vnc_url=vnc_url,
                                     sandbox_id=sandbox_id)
                    self._vnc_url_emitted = True
            except Exception:
                pass

        # ── 3. Emit result event ──
        yield make_event(
            "tool",
            status=result_status.value,
            tool_name=toolkit_name,
            function_name=resolved,
            function_args=fn_args,
            tool_call_id=tool_call_id,
            function_result=fn_result,
            tool_content=tool_content,
        )

        result_summary = tool_result.message or "No result"
        if len(result_summary) > 4000:
            result_summary = result_summary[:4000] + "...[truncated]"

        yield {"type": "__result__", "value": result_summary}

    async def execute_step_async(
        self,
        plan: Plan,
        step: Step,
        user_message: str,
        user_reply: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Execute a step and yield SSE events as they happen (AsyncGenerator)."""
        self.state = FlowState.EXECUTING
        step.status = ExecutionStatus.RUNNING
        yield make_event("step", status=StepStatus.RUNNING.value, step=step.to_dict())

        # ── Multi-Agent: determine which specialized agent handles this step ──
        _agent_type = str(step.agent_type or "general").lower()
        _agent_sys_prompt_base, _agent_allowed_tools = _get_agent_context(_agent_type)
        _agent_tool_schemas = _filter_tool_schemas(_agent_allowed_tools)
        _agent_display = _AGENT_DISPLAY_NAMES.get(_agent_type, "Execution Agent")

        # ── Inject detected sandbox home directory into system prompt ──
        # Ensures LLM knows the actual home path and uses ~ or $HOME in all commands.
        _sandbox_home = "/home/user"  # safe default for E2B Desktop
        if bool(os.environ.get("E2B_API_KEY", "")):
            try:
                from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR
                _sandbox_home = _detected_home or WORKSPACE_DIR
            except Exception:
                pass
        _sandbox_home_injection = (
            f"\n\n[SANDBOX_CONTEXT] "
            f"Home directory = {_sandbox_home} | "
            f"Output dir = {_sandbox_home}/output | "
            f"Always use '{_sandbox_home}' or ~ for all paths. "
            f"Never hardcode any absolute home path — always use {_sandbox_home} or ~ in commands."
        )
        _agent_sys_prompt = _agent_sys_prompt_base + _sandbox_home_injection

        # Notify user which agent is taking over this step
        if _agent_type not in ("general",):
            yield make_event("notify", text="[{}] menangani langkah ini...".format(_agent_display))

        context_parts: List[str] = []
        for s in plan.steps:
            if s.is_done() and s.result:
                context_parts.append("- {}: {}".format(s.description, s.result))
        if user_reply:
            context_parts.append("- User replied to agent question: {}".format(user_reply))
        context = "\n".join(context_parts) if context_parts else "No previous context."

        prompt = EXECUTION_PROMPT.format(
            step=step.description,
            message=user_message,
            language=plan.language or "en",
            context=context,
            attachments_info="",
        )

        # Build tool list description for text-based mode (when native tools not supported)
        _TEXT_TOOL_INSTRUCTION = """
IMPORTANT: This model uses TEXT-BASED tool calling. You do NOT have native function calling.
To call a tool, respond with ONLY a JSON object in this format:
{"tool": "tool_name", "args": {"param": "value"}}

To signal step completion, respond with:
{"done": true, "success": true, "result": "summary of what was done"}

Available tools:
- file_read: Read a file. Args: {"file": "/path/to/file"}
- file_write: Write/create a file. Args: {"file": "/path/to/file", "content": "..."}
- file_str_replace: Replace string in file. Args: {"file": "/path/to/file", "old_str": "old", "new_str": "new"}
- file_find_by_name: Find files by glob. Args: {"path": "/dir", "glob": "*.py"}
- file_find_in_content: Search in files. Args: {"path": "/dir", "pattern": "search_regex", "glob": "**/*"}
- image_view: View an image. Args: {"image": "/path/to/image"}
- shell_exec: Run shell command. Args: {"id": "sess1", "exec_dir": "", "command": "ls -la"}
- shell_view: View shell session output. Args: {"id": "sess1"}
- shell_wait: Wait then view session. Args: {"id": "sess1", "seconds": 5}
- shell_write_to_process: Send input to process. Args: {"id": "sess1", "input": "text", "press_enter": true}
- shell_kill_process: Kill shell session. Args: {"id": "sess1"}
- info_search_web: Search the web. Args: {"query": "search query"}
- web_search: Search the web (alias for info_search_web). Args: {"query": "search query"}
- web_browse: Open/browse a URL. Args: {"url": "https://..."}
- browser_navigate: Navigate browser to URL. Args: {"url": "https://..."}
- browser_view: View current page content. Args: {}
- browser_click: Click element on page. Args: {"index": 5} or {"coordinate_x": 100, "coordinate_y": 200}
- browser_input: Type text into element. Args: {"index": 5, "text": "hello", "press_enter": false} or {"coordinate_x": 100, "coordinate_y": 200, "text": "hello"}
- browser_move_mouse: Move mouse. Args: {"coordinate_x": 100, "coordinate_y": 200}
- browser_press_key: Press keyboard key. Args: {"key": "Enter"}
- browser_select_option: Select dropdown option. Args: {"index": 0, "option": 1}
- browser_scroll_up: Scroll page up. Args: {} or {"to_top": true}
- browser_scroll_down: Scroll page down. Args: {} or {"to_bottom": true}
- browser_console_exec: Execute JS in browser console. Args: {"javascript": "document.title"}
- browser_console_view: View browser console logs. Args: {}
- browser_save_image: Save screenshot of browser. Args: {"path": "/path/to/save.png"}
- browser_restart: Restart browser and navigate to URL. Args: {"url": "https://..."}
- message_notify_user: Send a message to user. Args: {"text": "message"}
- message_ask_user: Ask user a question and wait for reply. Args: {"text": "question"}
- todo_write: Create todo checklist. Args: {"items": ["step 1", "step 2"], "title": "Task"}
- todo_update: Update todo item. Args: {"item_text": "step 1", "completed": true}
- todo_read: Read current todo list. Args: {}
- task_create: Create sub-task. Args: {"description": "task desc", "task_type": "general"}
- task_complete: Complete sub-task. Args: {"task_id": "task_xxx", "result": "summary"}
- task_list: List all sub-tasks. Args: {}
- mcp_list_tools: List available MCP tools. Args: {}
- mcp_call_tool: Call an MCP tool. Args: {"tool_name": "name", "arguments": {}}
- idle: Mark step done. Args: {"success": true, "result": "summary"}

ONLY respond with JSON. No explanations, no markdown, ONLY the JSON object.
"""
        def _build_system_content() -> str:
            return _agent_sys_prompt + (_TEXT_TOOL_INSTRUCTION if _TOOLS_SUPPORTED is False else "")

        exec_messages: List[Dict[str, Any]] = [
            {"role": "system", "content": _build_system_content()},
            {"role": "user", "content": prompt},
        ]

        loop = asyncio.get_event_loop()
        _prev_tools_supported = _TOOLS_SUPPORTED

        for iteration in range(self.max_tool_iterations):
            try:
                if iteration % 3 == 0 and bool(os.environ.get("E2B_API_KEY", "")):
                    try:
                        from server.agent.tools.e2b_sandbox import keepalive as _e2b_keepalive
                        _e2b_keepalive()
                    except Exception:
                        pass

                if _TOOLS_SUPPORTED != _prev_tools_supported:
                    _prev_tools_supported = _TOOLS_SUPPORTED
                    exec_messages[0] = {"role": "system", "content": _build_system_content()}

                _msgs = list(exec_messages)
                api_result = await loop.run_in_executor(
                    None,
                    lambda: call_api_with_retry(_msgs, tools=_agent_tool_schemas),
                )
                text, tool_calls = _extract_cerebras_response(api_result)

                # After first call, check if tools support changed (fallback happened)
                if _TOOLS_SUPPORTED != _prev_tools_supported:
                    _prev_tools_supported = _TOOLS_SUPPORTED
                    exec_messages[0] = {"role": "system", "content": _build_system_content()}

                if tool_calls:
                    step_done = False
                    for tc_idx, tc in enumerate(tool_calls):
                        fn_name = tc.get("name", "")
                        fn_args = tc.get("arguments", {})
                        if isinstance(fn_args, str):
                            try:
                                fn_args = json.loads(fn_args)
                            except Exception:
                                fn_args = {}

                        tc_id = "tc_{}_{}_{}".format(step.id, iteration, tc_idx)
                        result_str = "Done"

                        async for ev in self._run_tool_streaming(fn_name, fn_args, tc_id, step):
                            if ev.get("type") == "__step_done__":
                                step_done = True
                                break
                            elif ev.get("type") == "__result__":
                                result_str = ev.get("value", "Done")
                            else:
                                yield ev

                        if step_done:
                            break

                        exec_messages.append({
                            "role": "user",
                            "content": (
                                "Result of {}: {}\n\n"
                                "Continue. Call idle when step is fully done."
                            ).format(fn_name, result_str),
                        })

                    if step_done:
                        return
                    if iteration > 0 and iteration % 5 == 0:
                        self.memory.compact()
                    # Compact exec_messages if context is getting too long (>12 messages)
                    if len(exec_messages) > 12:
                        exec_messages = _compact_exec_messages(exec_messages)
                    continue

                if text:
                    parsed = self._parse_response(text)

                    if parsed.get("done"):
                        step.status = ExecutionStatus.COMPLETED
                        step.success = _coerce_bool(parsed.get("success"), default=True)
                        step.result = parsed.get("result", "Step completed")
                        if not step.success:
                            step.status = ExecutionStatus.FAILED

                        if step.success and step.result:
                            _result_lower = step.result.lower()
                            _error_markers = ["traceback", "error:", "failed", "exception:", "syntaxerror", "indentationerror"]
                            if any(marker in _result_lower for marker in _error_markers):
                                step.success = False
                                step.status = ExecutionStatus.FAILED
                                step.result += " [AUTO-REJECTED: Output contains unresolved error indicators]"

                        status_enum = StepStatus.COMPLETED if step.success else StepStatus.FAILED
                        yield make_event("step", status=status_enum.value, step=step.to_dict())
                        return

                    if parsed.get("thinking"):
                        exec_messages.append({"role": "assistant", "content": text})
                        exec_messages.append({"role": "user", "content": "Good. Now execute using a tool."})
                        continue

                    if parsed.get("tool"):
                        tool_name = parsed["tool"]
                        tool_args = parsed.get("args", {})
                        resolved_name = resolve_tool_name(tool_name)

                        if resolved_name is None:
                            exec_messages.append({"role": "assistant", "content": text})
                            exec_messages.append({
                                "role": "user",
                                "content": "Unknown tool '{}'. Available: {}. Try again.".format(
                                    tool_name, ", ".join(TOOLS.keys()))
                            })
                            continue

                        tc_id = "tc_{}_{}_json".format(step.id, iteration)
                        result_str = "Done"
                        step_done = False

                        async for ev in self._run_tool_streaming(resolved_name, tool_args, tc_id, step):
                            if ev.get("type") == "__step_done__":
                                step_done = True
                                break
                            elif ev.get("type") == "__result__":
                                result_str = ev.get("value", "Done")
                            else:
                                yield ev

                        if step_done:
                            return

                        exec_messages.append({
                            "role": "user",
                            "content": "Result of {}: {}\n\nContinue. Use another tool or call idle when step is fully done.".format(resolved_name, result_str)
                        })
                        if iteration > 0 and iteration % 5 == 0:
                            self.memory.compact()
                        # Compact exec_messages if context is getting too long (>12 messages)
                        if len(exec_messages) > 12:
                            exec_messages = _compact_exec_messages(exec_messages)
                        continue

                if text:
                    yield make_event("notify", message=text[:500])
                exec_messages.append({"role": "assistant", "content": text or "(empty response)"})
                exec_messages.append({
                    "role": "user",
                    "content": (
                        "You responded with plain text instead of a tool call. "
                        "You MUST respond with a JSON object to call a tool or signal completion. "
                        "Use {\"tool\": \"tool_name\", \"args\": {...}} to call a tool, "
                        "or {\"done\": true, \"success\": true, \"result\": \"summary\"} to finish. "
                        "Try again now."
                    ),
                })
                continue

            except Exception as e:
                yield make_event("error", error="Step execution error: {}".format(e))
                step.status = ExecutionStatus.FAILED
                step.error = str(e)
                yield make_event("step", status=StepStatus.FAILED.value, step=step.to_dict())
                return

        step.status = ExecutionStatus.FAILED
        step.result = "Step incomplete (max iterations reached)"
        yield make_event("step", status=StepStatus.FAILED.value, step=step.to_dict())

    async def update_plan_async(
        self,
        plan: Plan,
        completed_step: Step,
    ) -> Optional[Dict[str, Any]]:
        """Update plan based on completed step. Returns plan event or None."""
        self.state = FlowState.UPDATING
        completed_steps_info = []
        for s in plan.steps:
            if s.is_done():
                status = "Success" if s.success else "Failed"
                completed_steps_info.append(
                    "Step {} ({}): {} - {}".format(s.id, s.description, status, s.result or ""))

        current_step_info = "Step {}: {}".format(completed_step.id, completed_step.description)
        step_result_info = completed_step.result or "No result"
        remaining = [s for s in plan.steps if not s.is_done()]
        plan_info = json.dumps({
            "language": plan.language,
            "completed_steps": [s.to_dict() for s in plan.steps if s.is_done()],
            "remaining_steps": [s.to_dict() for s in remaining],
        }, default=str)

        json_instruction = "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation."
        prompt = UPDATE_PLAN_PROMPT.format(
            current_plan=plan_info,
            completed_steps="\n".join(completed_steps_info),
            current_step=current_step_info,
            step_result=step_result_info,
        )
        # Inject sandbox home for update-plan context too
        from server.agent.tools.e2b_sandbox import _detected_home as _upd_home, WORKSPACE_DIR as _upd_wsdir
        _upd_sandbox_home = _upd_home or _upd_wsdir
        _upd_sandbox_ctx = (
            f"\n\n[SANDBOX_CONTEXT] Home directory = {_upd_sandbox_home} | "
            f"Gunakan '{_upd_sandbox_home}' atau ~ untuk semua path."
        )
        messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT + json_instruction + _upd_sandbox_ctx},
            {"role": "user", "content": prompt},
        ]

        loop = asyncio.get_event_loop()
        try:
            response_text = await loop.run_in_executor(
                None, lambda: call_text_with_retry(messages)
            )
            parsed = self._parse_response(response_text)
            if parsed and "steps" in parsed:
                new_steps = [
                    Step(
                        id=str(s.get("id", "")),
                        description=s.get("description", ""),
                        agent_type=s.get("agent_type", "general"),
                    )
                    for s in parsed["steps"]
                ]
                first_pending = None
                for i, s in enumerate(plan.steps):
                    if not s.is_done():
                        first_pending = i
                        break
                if first_pending is not None and new_steps:
                    seen_ids = {s.id for s in plan.steps[:first_pending]}
                    for idx, ns in enumerate(new_steps):
                        while ns.id in seen_ids or not ns.id:
                            ns.id = "step_{}_{}".format(first_pending + idx + 1, int(time.time()) % 10000)
                        seen_ids.add(ns.id)
                    plan.steps = plan.steps[:first_pending] + new_steps
                return make_event("plan", status=PlanStatus.UPDATED.value, plan=safe_plan_dict(plan))
        except Exception as e:
            sys.stderr.write("Plan update error: {}\n".format(e))
        return None

    async def summarize_async(
        self,
        plan: Plan,
        user_message: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Generate summary and yield streaming message events (real-time streaming)."""
        self.state = FlowState.SUMMARIZING
        step_results = []
        for s in plan.steps:
            status = "Success" if s.success else "Failed"
            step_results.append("- Step {} ({}): {} - {}".format(
                s.id, s.description, status, s.result or "No result"))

        output_files_info = "(tidak ada file output)"
        try:
            from server.agent.tools.e2b_sandbox import (
                list_output_files as _list_output,
                list_workspace_files as _list_workspace,
                ensure_zip_output,
                get_sandbox as _get_sb,
                OUTPUT_DIR as _OUTPUT_DIR,
                WORKSPACE_DIR as _WS_DIR,
                _MIME_MAP_E2B,
            )

            try:
                ensure_zip_output()
            except Exception:
                pass

            # Get sandbox_id for proxy URL generation
            try:
                _sb = _get_sb()
                _sandbox_id = _sb.sandbox_id if _sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
            except Exception:
                _sandbox_id = os.environ.get("DZECK_E2B_SANDBOX_ID", "")

            # ── 1. Output dir files (primary deliverables) ──
            output_files = _list_output()
            # ── 2. Workspace root files (scripts, docs, etc. not in /output/) ──
            try:
                workspace_files_raw = _list_workspace()
            except Exception:
                workspace_files_raw = []

            # Filter workspace files: skip system/hidden/skills dirs
            _skip_prefixes = (
                f"{_WS_DIR}/skills/", f"{_WS_DIR}/.local", f"{_WS_DIR}/.cache",
                f"{_WS_DIR}/.npm", f"{_WS_DIR}/.config", f"{_WS_DIR}/.bashrc",
                f"{_WS_DIR}/.profile", f"{_WS_DIR}/upload/",
            )
            _skip_exact = {f"{_WS_DIR}/sandbox.txt"}
            workspace_files = []
            for wf in workspace_files_raw:
                if wf in _skip_exact:
                    continue
                if any(wf.startswith(p) for p in _skip_prefixes):
                    continue
                if wf.startswith(_OUTPUT_DIR):
                    continue  # already covered by output_files
                workspace_files.append(wf)

            all_e2b_files = output_files + workspace_files

            if all_e2b_files:
                output_files_info = "\n".join(
                    f"- {os.path.basename(f)} ({f})" for f in all_e2b_files
                )
                synced_fnames = {f.get("filename", "") for f in self._created_files}
                for ef in all_e2b_files:
                    fname = os.path.basename(ef)
                    if not fname:
                        continue
                    if fname in synced_fnames:
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                    durl = _make_e2b_proxy_url(ef, fname, _sandbox_id)
                    self._created_files.append({
                        "filename": fname,
                        "sandbox_path": ef,
                        "sandbox_id": _sandbox_id,
                        "download_url": durl,
                        "mime": mime,
                    })
                    synced_fnames.add(fname)
        except Exception:
            pass

        prompt = SUMMARIZE_PROMPT.format(
            step_results="\n".join(step_results),
            message=user_message,
            output_files=output_files_info,
        )
        summarize_system = (
            "Kamu adalah Dzeck, asisten AI yang membantu. "
            "Tulis ringkasan yang jelas dan natural dalam teks biasa. "
            "JANGAN pernah keluarkan JSON atau code block. "
            "Gunakan bahasa yang sama dengan user (default Bahasa Indonesia). "
            "Langsung tulis teksnya saja tanpa format JSON apapun."
        )
        messages = [
            {"role": "system", "content": summarize_system},
            {"role": "user", "content": prompt},
        ]

        def _strip_json_wrapper(text: str) -> str:
            """If the model accidentally wraps response in JSON, extract the text value."""
            t = text.strip()
            if t.startswith("{") and t.endswith("}"):
                try:
                    obj = json.loads(t)
                    for key in ("message", "text", "response", "content", "summary", "result"):
                        if key in obj and isinstance(obj[key], str):
                            return obj[key]
                except Exception:
                    pass
            if t.startswith("```") and t.endswith("```"):
                inner = t[3:]
                if inner.startswith("json"):
                    inner = inner[4:]
                inner = inner.rstrip("`").strip()
                try:
                    obj = json.loads(inner)
                    for key in ("message", "text", "response", "content", "summary", "result"):
                        if key in obj and isinstance(obj[key], str):
                            return obj[key]
                except Exception:
                    pass
                return inner
            return text

        try:
            yield make_event("message_start", role="assistant")
            got_any = False
            accumulated = []
            async for chunk in call_cerebras_streaming_realtime(messages):
                if chunk:
                    got_any = True
                    accumulated.append(chunk)
                    yield make_event("message_chunk", chunk=chunk, role="assistant")
            # If the full response happens to be JSON-wrapped, correct via final chunk
            if accumulated:
                full = "".join(accumulated)
                stripped = _strip_json_wrapper(full)
                if stripped != full:
                    # Model outputted JSON — replace with clean text via correction chunk
                    # Emit a special correction: instruct client to clear and re-render
                    yield make_event("message_correct", text=stripped, role="assistant")
            if not got_any:
                yield make_event("message_chunk", chunk="Task selesai.", role="assistant")
            yield make_event("message_end", role="assistant")
        except Exception:
            yield make_event("message_start", role="assistant")
            yield make_event("message_chunk", chunk="Task selesai.", role="assistant")
            yield make_event("message_end", role="assistant")

    async def respond_directly_async(
        self,
        user_message: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Respond directly without Plan-Act for simple queries (real-time streaming)."""
        sys_msg = {
            "role": "system",
            "content": (
                "Kamu adalah Dzeck, asisten AI yang membantu. Balas secara alami dan bermanfaat dalam Bahasa Indonesia. "
                "Gunakan bahasa yang sama dengan user jika user menggunakan bahasa lain. "
                "Jangan keluarkan JSON — balas dengan teks biasa saja."
            ),
        }
        messages: List[Dict[str, Any]] = [sys_msg]
        if chat_history:
            for h in chat_history[-10:]:
                role = h.get("role", "")
                content = h.get("content", "")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": str(content)[:2000]})
        messages.append({"role": "user", "content": user_message})
        try:
            yield make_event("message_start", role="assistant")
            got_any = False
            async for chunk in call_cerebras_streaming_realtime(messages):
                if chunk:
                    got_any = True
                    yield make_event("message_chunk", chunk=chunk, role="assistant")
            if not got_any:
                yield make_event("message_chunk", chunk="I'm sorry, I couldn't generate a response.", role="assistant")
            yield make_event("message_end", role="assistant")
        except Exception as e:
            yield make_event("error", error="Response error: {}".format(e))

    async def run_async(
        self,
        user_message: str,
        attachments: Optional[List[str]] = None,
        resume_from_session: Optional[str] = None,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        is_continuation: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Main async agent flow using AsyncGenerator.
        
        Yields SSE events as they happen:
        - plan events (creating/created/running/updated/completed)
        - step events (running/completed/failed)
        - tool events (calling/called/error)
        - message events (start/chunk/end)
        - done event
        
        Supports:
        - Session persistence (MongoDB + Redis)
        - Resume from saved session state
        - Conversation memory (chat_history across messages)
        """
        svc = await self._get_session_service()

        # ── Load / merge chat history ──────────────────────────────────────────
        loaded_history: List[Dict[str, Any]] = []
        if self.session_id and svc:
            try:
                loaded_history = await svc.load_chat_history(self.session_id) or []
            except Exception:
                loaded_history = []

        if chat_history:
            self.chat_history = chat_history
        elif loaded_history:
            self.chat_history = loaded_history

        try:
            if resume_from_session and svc:
                session = await svc.resume_session(resume_from_session)
                if session and session.get("plan"):
                    self.plan = Plan.from_dict(session["plan"])
                    yield make_event("session", action="resumed", session_id=resume_from_session)

            waiting_state = None
            if self.session_id:
                if svc:
                    waiting_state = await svc.load_waiting_state(self.session_id)
                if waiting_state is None:
                    from server.agent.services.session_service import _file_load_waiting_state
                    waiting_state = _file_load_waiting_state(self.session_id)

            if is_continuation and waiting_state and self.session_id:
                if svc:
                    await svc.clear_waiting_state(self.session_id)
                else:
                    from server.agent.services.session_service import _file_clear_waiting_state
                    _file_clear_waiting_state(self.session_id)

                if waiting_state.get("clarification_mode"):
                    original_message = waiting_state.get("user_message", user_message)
                    user_message = "{}\n\nKlarifikasi dari user: {}".format(original_message, user_message)
                    is_continuation = False
                else:
                    self.plan = Plan.from_dict(waiting_state["plan"])
                    original_user_message = waiting_state.get("user_message", user_message)

                    saved_step_id = self.plan.current_step_id
                    if saved_step_id:
                        for s in self.plan.steps:
                            if s.id == saved_step_id and s.status == ExecutionStatus.PENDING:
                                s.status = ExecutionStatus.RUNNING

                    yield make_event("plan", status=PlanStatus.RUNNING.value, plan=safe_plan_dict(self.plan))

                    step_waiting = False
                    while True:
                        step = self.plan.get_next_step()
                        if not step:
                            break

                        self.plan.current_step_id = step.id
                        step_waiting = False
                        async for event in self.execute_step_async(self.plan, step, original_user_message, user_reply=user_message):
                            if event.get("type") == "waiting_for_user":
                                step_waiting = True
                            yield event

                        if not step_waiting and self.session_id and svc:
                            await svc.save_step_completed(self.session_id, step.to_dict())

                        if step_waiting:
                            pending = [s.to_dict() for s in self.plan.steps if not s.is_done()]
                            if self.session_id:
                                if svc:
                                    await svc.save_waiting_state(
                                        self.session_id,
                                        self.plan.to_dict(),
                                        pending,
                                        original_user_message,
                                        chat_history=self.chat_history,
                                    )
                                    await svc.save_plan_snapshot(self.session_id, self.plan.to_dict())
                                else:
                                    from server.agent.services.session_service import _file_save_waiting_state
                                    _file_save_waiting_state(self.session_id, {
                                        "waiting_for_user": True,
                                        "plan": self.plan.to_dict(),
                                        "pending_steps": pending,
                                        "user_message": original_user_message,
                                        "chat_history": self.chat_history,
                                    })
                            yield make_event("done", success=True, session_id=self.session_id, waiting_for_user=True)
                            return

                        if step.status == ExecutionStatus.COMPLETED:
                            yield make_event("notify", text=f"✓ {step.description}")

                        next_step = self.plan.get_next_step()
                        if next_step:
                            yield make_event("plan", status=PlanStatus.UPDATING.value,
                                             plan=safe_plan_dict(self.plan))
                            plan_event = await self.update_plan_async(self.plan, step)
                            if plan_event:
                                yield plan_event

                    for s in self.plan.steps:
                        if s.status == ExecutionStatus.RUNNING:
                            s.status = ExecutionStatus.FAILED
                            s.success = False
                            if not s.result:
                                s.result = "Step did not complete"
                            yield make_event("step", status=StepStatus.FAILED.value, step=s.to_dict())

                    self.plan.status = ExecutionStatus.COMPLETED
                    yield make_event("plan", status=PlanStatus.COMPLETED.value,
                                     plan=safe_plan_dict(self.plan))

                    summary_chunks: List[str] = []
                    async def _summarize_cont():
                        async for event in self.summarize_async(self.plan, original_user_message):
                            if event.get("type") == "message_chunk":
                                summary_chunks.append(event.get("chunk", ""))
                            yield event
                    async for event in _summarize_cont():
                        yield event

                    self.state = FlowState.COMPLETED
                    summary_text = "".join(summary_chunks)
                    if summary_text:
                        self.chat_history.append({"role": "user", "content": original_user_message})
                        self.chat_history.append({"role": "assistant", "content": summary_text})
                        if self.session_id and svc:
                            try:
                                await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                            except Exception:
                                pass
                    if self.session_id and svc:
                        await svc.complete_session(self.session_id, success=True)
                    if self._created_files:
                        yield make_event("files", files=self._created_files)

                    yield make_event("done", success=True, session_id=self.session_id)
                    return

            if not waiting_state and self.session_id and svc:
                await svc.create_session(user_message, session_id=self.session_id)

            # ── E2B Sandbox startup self-test ──────────────────────────────────
            # Run quick diagnostics on first message to verify sandbox is ready.
            # Emit results as a notify event so frontend can see sandbox is live.
            if (
                not is_continuation
                and not waiting_state
                and not getattr(self, "_sandbox_selftest_done", False)
                and bool(os.environ.get("E2B_API_KEY", ""))
            ):
                self._sandbox_selftest_done = True
                try:
                    def _run_selftest():
                        from server.agent.tools.e2b_sandbox import (
                            get_sandbox, _detect_sandbox_home, _detected_home, WORKSPACE_DIR
                        )
                        sb = get_sandbox()
                        if sb is None:
                            return None
                        home = _detected_home or _detect_sandbox_home(sb) or WORKSPACE_DIR
                        # Ensure output dir exists
                        try:
                            sb.commands.run(
                                f"mkdir -p {home}/output {home}/skills 2>/dev/null || true",
                                timeout=10
                            )
                        except Exception:
                            pass
                        # Quick checks
                        results = {}
                        for name, cmd in [
                            ("echo", "echo ok"),
                            ("pwd", "cd && pwd"),
                            ("python3", "python3 --version"),
                            ("pip3", "pip3 --version 2>&1 | head -1"),
                            ("chromium", "which chromium-browser || which google-chrome || which chromium || echo NOT_FOUND"),
                        ]:
                            try:
                                r = sb.commands.run(cmd, timeout=10)
                                results[name] = (r.stdout or "").strip()[:80]
                            except Exception as exc:
                                results[name] = f"ERR: {exc}"
                        return {"home": home, "checks": results}

                    loop = asyncio.get_event_loop()
                    selftest_result = await loop.run_in_executor(None, _run_selftest)
                    if selftest_result:
                        home = selftest_result.get("home", "unknown")
                        checks = selftest_result.get("checks", {})
                        failed = [k for k, v in checks.items() if "ERR" in v or v == "NOT_FOUND"]
                        sandbox_ok = len(failed) == 0
                        status_icon = "✓" if sandbox_ok else "⚠"
                        checks_str = " | ".join(f"{k}: {v}" for k, v in checks.items())
                        failed_str = (f" | FAILED: {', '.join(failed)}" if failed else "")
                        yield make_event(
                            "sandbox_ready",
                            home=home,
                            checks=checks,
                            failed=failed,
                            status="ok" if sandbox_ok else "partial",
                            message=f"{status_icon} Sandbox ready — home={home} | {checks_str}{failed_str}",
                        )
                        if failed:
                            sys.stderr.write(f"[sandbox_selftest] Some checks failed: {failed}\n")
                    else:
                        sys.stderr.write("[sandbox_selftest] Sandbox not available or self-test returned None\n")
                        yield make_event(
                            "sandbox_ready",
                            home="unknown",
                            checks={},
                            failed=[],
                            status="unavailable",
                            message="⚠ Sandbox not connected — E2B_API_KEY set but sandbox returned None",
                        )
                except Exception as selftest_err:
                    sys.stderr.write(f"[sandbox_selftest] Error during self-test: {selftest_err}\n")
                    yield make_event(
                        "sandbox_ready",
                        home="unknown",
                        checks={},
                        failed=["selftest"],
                        status="error",
                        message=f"⚠ Sandbox self-test failed: {selftest_err}",
                    )

            if not is_continuation and not attachments and self._is_simple_query(user_message):
                assistant_reply = []

                async def _collect_and_yield():
                    async for event in self.respond_directly_async(
                        user_message, chat_history=self.chat_history
                    ):
                        if event.get("type") == "message_chunk":
                            assistant_reply.append(event.get("chunk", ""))
                        yield event

                async for event in _collect_and_yield():
                    yield event

                reply_text = "".join(assistant_reply)
                if reply_text:
                    self.chat_history.append({"role": "user", "content": user_message})
                    self.chat_history.append({"role": "assistant", "content": reply_text})
                    if self.session_id and svc:
                        try:
                            await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                        except Exception:
                            pass

                yield make_event("done", success=True, session_id=self.session_id)
                return

            if not is_continuation:
                clarification_q = await self._pre_plan_clarification_check(
                    user_message, chat_history=self.chat_history
                )
                if clarification_q:
                    if self.session_id:
                        from server.agent.services.session_service import _file_save_waiting_state
                        _file_save_waiting_state(self.session_id, {
                            "waiting_for_user": True,
                            "plan": None,
                            "pending_steps": [],
                            "user_message": user_message,
                            "chat_history": self.chat_history,
                            "clarification_mode": True,
                        })
                    yield make_event("message_start", role="ask")
                    yield make_event("message_chunk", chunk=clarification_q, role="ask")
                    yield make_event("message_end", role="ask")
                    yield make_event("waiting_for_user", text=clarification_q)
                    yield make_event("done", success=True, session_id=self.session_id)
                    return

            # ── T5: Session Resume — if plan was restored from resume_data, skip replanning ──
            # When a verified resumed session injects a plan (via run_agent_async), we bypass
            # the planner and continue execution directly from the last unfinished step.
            if self.plan is not None and resume_from_session and self.plan.steps:
                _pending_steps = [s for s in self.plan.steps if not s.is_done()]
                if _pending_steps:
                    self.state = FlowState.EXECUTING
                    yield make_event("plan", status=PlanStatus.RUNNING.value, plan=safe_plan_dict(self.plan))
                    step_waiting = False
                    _step_consecutive_failures: Dict[str, int] = {}
                    _global_consecutive_failures = 0
                    _MAX_GLOBAL_FAILURES = 4
                    while True:
                        step = self.plan.get_next_step()
                        if not step:
                            break
                        self.plan.current_step_id = step.id
                        step_waiting = False
                        async for event in self.execute_step_async(self.plan, step, user_message):
                            if event.get("type") == "waiting_for_user":
                                step_waiting = True
                            yield event
                        if step_waiting:
                            pending = [s.to_dict() for s in self.plan.steps if not s.is_done()]
                            if self.session_id:
                                if svc:
                                    await svc.save_waiting_state(
                                        self.session_id, self.plan.to_dict(), pending,
                                        user_message=user_message,
                                    )
                            yield make_event("done", success=True, session_id=self.session_id, waiting_for_user=True)
                            return
                        if not step_waiting and self.session_id and svc:
                            await svc.save_step_completed(self.session_id, step.to_dict())

                    self.plan.status = ExecutionStatus.COMPLETED
                    yield make_event("plan", status=PlanStatus.COMPLETED.value, plan=safe_plan_dict(self.plan))
                    summary_text_r = ""
                    async for event in self.summarize_async(self.plan, user_message):
                        if event.get("type") == "message_chunk":
                            summary_text_r += event.get("chunk", "")
                        yield event
                    if summary_text_r:
                        self.chat_history.append({"role": "user", "content": user_message})
                        self.chat_history.append({"role": "assistant", "content": summary_text_r})
                        if self.session_id and svc:
                            try:
                                await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                            except Exception:
                                pass
                    if self.session_id and svc:
                        await svc.complete_session(self.session_id, success=True)
                    if self._created_files:
                        yield make_event("files", files=self._created_files)
                    yield make_event("done", success=True, session_id=self.session_id)
                    return

            self.state = FlowState.PLANNING
            yield make_event("plan", status=PlanStatus.CREATING.value)

            # Eagerly detect sandbox home before planner LLM call to ensure
            # _detected_home is populated for SANDBOX_CONTEXT injection.
            if bool(os.environ.get("E2B_API_KEY", "")):
                try:
                    def _eager_detect_home():
                        from server.agent.tools.e2b_sandbox import (
                            get_sandbox, _detected_home, _detect_sandbox_home, WORKSPACE_DIR
                        )
                        if _detected_home:
                            return  # Already detected
                        sb = get_sandbox()
                        if sb is not None and not _detected_home:
                            _detect_sandbox_home(sb)
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, _eager_detect_home)
                except Exception:
                    pass

            self.plan = await self.run_planner_async(
                user_message, attachments, chat_history=self.chat_history
            )

            if self.session_id and svc:
                await svc.save_plan_snapshot(self.session_id, self.plan.to_dict())

            yield make_event("title", title=self.plan.title)

            if self.plan.message:
                yield make_event("message_start", role="assistant")
                yield make_event("message_chunk", chunk=self.plan.message, role="assistant")
                yield make_event("message_end", role="assistant")

            yield make_event("plan", status=PlanStatus.CREATED.value, plan=safe_plan_dict(self.plan))

            if not self.plan.steps:
                yield make_event("message_start", role="assistant")
                yield make_event("message_chunk", chunk="No actionable steps needed.", role="assistant")
                yield make_event("message_end", role="assistant")
                yield make_event("done", success=True, session_id=self.session_id)
                return

            yield make_event("plan", status=PlanStatus.RUNNING.value, plan=safe_plan_dict(self.plan))

            step_waiting = False
            _step_consecutive_failures: Dict[str, int] = {}
            _global_consecutive_failures = 0
            _MAX_GLOBAL_FAILURES = 4
            while True:
                step = self.plan.get_next_step()
                if not step:
                    break

                self.plan.current_step_id = step.id
                step_waiting = False
                async for event in self.execute_step_async(self.plan, step, user_message):
                    if event.get("type") == "waiting_for_user":
                        step_waiting = True
                    yield event

                if not step_waiting and step.status == ExecutionStatus.FAILED:
                    _global_consecutive_failures += 1
                    fail_count = _step_consecutive_failures.get(step.id, 0) + 1
                    _step_consecutive_failures[step.id] = fail_count
                    if _global_consecutive_failures >= _MAX_GLOBAL_FAILURES:
                        sys.stderr.write("[agent] Circuit breaker: {} consecutive failures, aborting plan\n".format(_global_consecutive_failures))
                        yield make_event("notify", text="Terlalu banyak kegagalan berturut-turut. Menghentikan eksekusi.")
                        break
                    elif fail_count < 2:
                        error_ctx = step.result or step.error or "Unknown failure"
                        retry_msg = (
                            f"{user_message}\n\n"
                            f"[RETRY] Previous attempt for this step FAILED with: {error_ctx}. "
                            f"Take a DIFFERENT approach. Do NOT repeat the same command or strategy."
                        )
                        step.status = ExecutionStatus.PENDING
                        step.result = None
                        step.error = None
                        yield make_event("step", status="retrying", step=step.to_dict())
                        async for event in self.execute_step_async(self.plan, step, retry_msg):
                            if event.get("type") == "waiting_for_user":
                                step_waiting = True
                            yield event
                    else:
                        _step_consecutive_failures.pop(step.id, None)
                elif not step_waiting:
                    _global_consecutive_failures = 0
                    _step_consecutive_failures.pop(step.id, None)

                if not step_waiting and self.session_id and svc:
                    await svc.save_step_completed(self.session_id, step.to_dict())

                if step_waiting:
                    pending = [s.to_dict() for s in self.plan.steps if not s.is_done()]
                    if self.session_id:
                        if svc:
                            await svc.save_waiting_state(
                                self.session_id,
                                self.plan.to_dict(),
                                pending,
                                user_message,
                                chat_history=self.chat_history,
                            )
                            await svc.save_plan_snapshot(self.session_id, self.plan.to_dict())
                        else:
                            from server.agent.services.session_service import _file_save_waiting_state
                            _file_save_waiting_state(self.session_id, {
                                "waiting_for_user": True,
                                "plan": self.plan.to_dict(),
                                "pending_steps": pending,
                                "user_message": user_message,
                                "chat_history": self.chat_history,
                            })
                    yield make_event("done", success=True, session_id=self.session_id, waiting_for_user=True)
                    return

                if step.status == ExecutionStatus.COMPLETED:
                    yield make_event("notify", text=f"✓ {step.description}")

                next_step = self.plan.get_next_step()
                if next_step:
                    yield make_event("plan", status=PlanStatus.UPDATING.value,
                                     plan=safe_plan_dict(self.plan))
                    plan_event = await self.update_plan_async(self.plan, step)
                    if plan_event:
                        yield plan_event

            for s in self.plan.steps:
                if s.status == ExecutionStatus.RUNNING:
                    s.status = ExecutionStatus.FAILED
                    s.success = False
                    if not s.result:
                        s.result = "Step did not complete"
                    yield make_event("step", status=StepStatus.FAILED.value, step=s.to_dict())

            self.plan.status = ExecutionStatus.COMPLETED
            yield make_event("plan", status=PlanStatus.COMPLETED.value,
                             plan=safe_plan_dict(self.plan))

            summary_chunks: List[str] = []

            async def _summarize_and_collect():
                async for event in self.summarize_async(self.plan, user_message):
                    if event.get("type") == "message_chunk":
                        summary_chunks.append(event.get("chunk", ""))
                    yield event

            async for event in _summarize_and_collect():
                yield event

            self.state = FlowState.COMPLETED

            summary_text = "".join(summary_chunks)
            if summary_text:
                self.chat_history.append({"role": "user", "content": user_message})
                self.chat_history.append({"role": "assistant", "content": summary_text})
                if self.session_id and svc:
                    try:
                        await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                    except Exception:
                        pass

            if self.session_id and svc:
                await svc.complete_session(self.session_id, success=True)

            if self._created_files:
                yield make_event("files", files=self._created_files)

            yield make_event("done", success=True, session_id=self.session_id)

        except Exception as e:
            self.state = FlowState.FAILED
            if self.session_id:
                try:
                    svc2 = await self._get_session_service()
                    if svc2:
                        await svc2.complete_session(self.session_id, success=False)
                except Exception:
                    pass
            yield make_event("error", error="Agent error: {}".format(e))
            traceback.print_exc(file=sys.stderr)
            # ── Always emit created files even on error path ──
            if self._created_files:
                yield make_event("files", files=self._created_files)
            yield make_event("done", success=False, session_id=self.session_id)


async def run_agent_async(
    user_message: str,
    attachments: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    user_id: str = "auto-user",
    resume_from_session: Optional[str] = None,
    resume_data: Optional[Dict[str, Any]] = None,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    is_continuation: bool = False,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Public entry point for running the agent as an async generator.
    Used by both the CLI main() and the Node.js subprocess bridge.
    """
    agent = DzeckAgent(session_id=session_id)
    # If resume_data was pre-loaded by Node.js from MongoDB, inject it into the agent
    if resume_data:
        if resume_data.get("chat_history") and not chat_history:
            chat_history = resume_data["chat_history"]
        if resume_data.get("plan") and resume_from_session:
            try:
                agent.plan = Plan.from_dict(resume_data["plan"])
            except Exception:
                pass
    # ── T2: Load cross-session memories and prepend to chat history ──────────
    _memory_context = ""
    try:
        from server.agent.services.memory_service import (
            load_memories as _load_mem,
            format_memories_for_prompt as _fmt_mem,
        )
        _memories = await _load_mem(user_id=user_id, limit=10)
        if _memories:
            _memory_context = _fmt_mem(_memories)
    except Exception as _load_mem_err:
        import logging as _lmlog
        _lmlog.getLogger(__name__).warning("[memory] Failed to load memories: %s", _load_mem_err)

    if _memory_context:
        _mem_msg = {"role": "assistant", "content": f"[Memory context from previous sessions]\n{_memory_context}"}
        if chat_history:
            chat_history = [_mem_msg] + list(chat_history)
        else:
            chat_history = [_mem_msg]

    all_events: list = []
    async for event in agent.run_async(
        user_message,
        attachments=attachments,
        resume_from_session=resume_from_session,
        chat_history=chat_history,
        is_continuation=is_continuation,
    ):
        all_events.append(event)
        yield event

    # ── T2: Auto-save cross-session memory after agent run completes ────────
    # Reconstruct full assistant messages by accumulating message_chunk streams.
    # agent emits: message_start → message_chunk* → message_end (no text in message_end).
    if session_id:
        try:
            from server.agent.services.memory_service import extract_and_save_insights as _save_mem
            # Build full assistant reply text by accumulating chunks between start/end markers
            _assistant_msgs: list = []
            _chunk_buf: list = []
            for ev in all_events:
                etype = ev.get("type", "")
                if etype == "message_start":
                    _chunk_buf = []
                elif etype == "message_chunk":
                    chunk = ev.get("chunk", "")
                    if chunk:
                        _chunk_buf.append(chunk)
                elif etype in ("message_end", "message_correct"):
                    # message_correct has corrected full text
                    if etype == "message_correct" and ev.get("text"):
                        _assistant_msgs.append({"role": "assistant", "content": ev["text"]})
                    elif _chunk_buf:
                        _assistant_msgs.append({"role": "assistant", "content": "".join(_chunk_buf)})
                    _chunk_buf = []
            # Also include agent's own accumulated chat_history (most complete source)
            if not _assistant_msgs and hasattr(agent, "chat_history"):
                for msg in agent.chat_history:
                    if msg.get("role") == "assistant" and msg.get("content"):
                        _assistant_msgs.append({"role": "assistant", "content": msg["content"]})

            _messages = [{"role": "user", "content": user_message}] + _assistant_msgs
            if len(_messages) > 1:
                await _save_mem(session_id=session_id, messages=_messages, user_id=user_id)
        except Exception as _mem_err:
            import logging as _mlog
            _mlog.getLogger(__name__).warning("[memory] Failed to save cross-session memory: %s", _mem_err)


def main() -> None:
    """
    Synchronous entry point for Node.js subprocess bridge.
    Reads JSON from stdin, runs async agent, writes events to stdout.
    """
    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)

        user_message = input_data.get("message", "")
        messages = input_data.get("messages", [])
        attachments = input_data.get("attachments", [])
        session_id = input_data.get("session_id")
        user_id = input_data.get("user_id", "auto-user")
        resume_from_session = input_data.get("resume_from_session")
        resume_data = input_data.get("resume_data")  # pre-loaded from Node.js MongoDB fetch
        is_continuation = bool(input_data.get("is_continuation", False))

        if messages and not user_message:
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    user_message = msg.get("content", "")
                    break

        if not user_message:
            event = json.dumps({"type": "error", "error": "No user message provided"})
            sys.stdout.write(event + "\n")
            sys.stdout.flush()
            event = json.dumps({"type": "done", "success": False})
            sys.stdout.write(event + "\n")
            sys.stdout.flush()
            return

        # Build chat_history from messages array (exclude the last user message — it's user_message)
        chat_history: List[Dict[str, Any]] = []
        if messages:
            for m in messages:
                role = m.get("role", "")
                content = m.get("content", "")
                if role in ("user", "assistant") and content:
                    chat_history.append({"role": role, "content": content})
            # Remove the last user message (it's user_message, avoid duplication)
            if chat_history and chat_history[-1].get("role") == "user":
                last_content = chat_history[-1].get("content", "")
                if last_content.strip() == user_message.strip():
                    chat_history = chat_history[:-1]

        async def _run():
            # Initialize Redis Stream queue — Python is the authoritative stream publisher.
            # Node.js reads from stdout for live SSE delivery; Redis Streams serve durable replay.
            _stream_q = None
            if session_id:
                try:
                    from server.agent.db.redis_stream_queue import get_stream_queue as _get_sq
                    _stream_q = await _get_sq(session_id)
                except Exception as _sq_err:
                    import logging as _sqlog
                    _sqlog.getLogger(__name__).warning(
                        "[agent_flow] Redis stream queue unavailable (replay disabled): %s", _sq_err
                    )

            async for event in run_agent_async(
                user_message,
                attachments=attachments or [],
                session_id=session_id,
                user_id=user_id,
                resume_from_session=resume_from_session,
                resume_data=resume_data,
                chat_history=chat_history or None,
                is_continuation=is_continuation,
            ):
                line = json.dumps(event, default=str)
                # Write to stdout first for immediate Node.js SSE delivery
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
                # Publish to Redis Stream for durable replay/resume (authoritative publisher)
                if _stream_q is not None and _stream_q.is_connected:
                    try:
                        await _stream_q.xadd(event)
                    except Exception as _xadd_err:
                        import logging as _xlog
                        _xlog.getLogger(__name__).warning(
                            "[agent_flow] Redis XADD failed (event not durable): %s", _xadd_err
                        )

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(asyncio.run, _run())
                    future.result()
            else:
                loop.run_until_complete(_run())
        except RuntimeError:
            asyncio.run(_run())

    except Exception as e:
        event = json.dumps({"type": "error", "error": "Fatal error: {}".format(e)})
        sys.stdout.write(event + "\n")
        sys.stdout.flush()
        traceback.print_exc(file=sys.stderr)
        event = json.dumps({"type": "done", "success": False})
        sys.stdout.write(event + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
