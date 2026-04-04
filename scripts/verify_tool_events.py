#!/usr/bin/env python3
"""
Verification script for SSE tool event completeness.

Tests that build_tool_content produces correct structures for every tool type,
and that all event lifecycle transitions (calling/called/error) would be emitted
correctly by plan_act.py.

Run from the project root:
  python scripts/verify_tool_events.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.agent.models.tool_result import ToolResult
from server.agent.domain.events import (
    build_tool_content, build_tool_lifecycle_events, _normalize_screenshot_b64, make_event,
)
from server.agent.models.event import ToolStatus


PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

_failures = []
_passes = []


def _assert(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        _passes.append(label)
        print(f"  {PASS}: {label}")
    else:
        _failures.append(label)
        msg = f"  {FAIL}: {label}"
        if detail:
            msg += f" — {detail}"
        print(msg)


def _check_tool_content(tool_name: str, result: ToolResult, expected_type: str, required_keys: list) -> dict:
    content = build_tool_content(tool_name, result)
    _assert(content is not None, f"{tool_name}: build_tool_content returns non-None")
    if content is None:
        return {}
    _assert(content.get("type") == expected_type,
            f"{tool_name}: type=={expected_type!r}",
            f"got {content.get('type')!r}")
    for key in required_keys:
        _assert(key in content, f"{tool_name}: has field '{key}'", f"keys={list(content.keys())}")
    return content


def test_shell_tools():
    print("\n=== Shell tools ===")
    for tool_name in ("shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process"):
        r = ToolResult(success=True, message="ok", data={
            "stdout": "hello", "stderr": "", "return_code": 0,
            "command": "echo hello", "backend": "E2B",
        })
        c = _check_tool_content(tool_name, r, "shell", ["command", "console", "stdout", "stderr", "return_code"])
        if c:
            _assert(c.get("console") == "hello", f"{tool_name}: console==stdout when no stderr")


def test_search_tools():
    print("\n=== Search tools ===")
    for tool_name in ("info_search_web", "web_search"):
        r = ToolResult(success=True, message="ok", data={
            "query": "test query",
            "results": [{"title": "T", "url": "https://example.com", "snippet": "S"}],
        })
        c = _check_tool_content(tool_name, r, "search", ["query", "results"])
        if c:
            _assert(isinstance(c.get("results"), list), f"{tool_name}: results is list")
            if c.get("results"):
                first = c["results"][0]
                for k in ("title", "url", "snippet"):
                    _assert(k in first, f"{tool_name}: result item has '{k}'")


def test_browser_tools():
    print("\n=== Browser tools ===")
    browser_tools = [
        "web_browse", "browser_navigate", "browser_view", "browser_click",
        "browser_input", "browser_move_mouse", "browser_press_key",
        "browser_select_option", "browser_scroll_up", "browser_scroll_down",
        "browser_console_exec", "browser_console_view", "browser_save_image",
        "browser_restart", "browser_screenshot", "browser_tab_list",
        "browser_tab_new", "browser_tab_close", "browser_tab_switch",
        "browser_drag", "browser_file_upload",
    ]
    for tool_name in browser_tools:
        r = ToolResult(success=True, message="ok", data={
            "url": "https://example.com",
            "title": "Example",
            "content": "page content",
            "screenshot_b64": "data:image/png;base64,iVBORw0KGgo=",
        })
        c = _check_tool_content(tool_name, r, "browser", ["url", "title", "content", "screenshot_b64"])
        if c:
            scr = c.get("screenshot_b64", "")
            if scr:
                _assert(scr.startswith("data:image/png;base64,"),
                        f"{tool_name}: screenshot_b64 has correct prefix")


def test_browser_screenshot_normalization():
    print("\n=== Screenshot normalization ===")
    raw_b64 = "iVBORw0KGgo="
    result = _normalize_screenshot_b64(raw_b64)
    _assert(result.startswith("data:image/png;base64,"),
            "normalize: adds prefix for bare b64")

    already = "data:image/png;base64,iVBORw0KGgo="
    result2 = _normalize_screenshot_b64(already)
    _assert(result2.startswith("data:image/png;base64,"),
            "normalize: preserves prefix for already-prefixed string")

    oversized = "A" * 300000
    result3 = _normalize_screenshot_b64(oversized)
    _assert(result3.startswith("data:image/png;base64,"),
            "normalize: oversized screenshot returns degraded (not empty) result")
    _assert(len(result3) <= 204800 + len("data:image/png;base64,") + 4,
            "normalize: oversized screenshot respects size limit")

    empty = _normalize_screenshot_b64("")
    _assert(empty == "", "normalize: empty string returns empty string")


def test_file_tools():
    print("\n=== File tools ===")
    for tool_name in ("file_read", "file_write", "file_str_replace",
                      "file_find_by_name", "file_find_in_content",
                      "file_find", "file_delete", "file_list"):
        r = ToolResult(success=True, message="ok", data={
            "file": "/home/user/test.py",
            "content": "print('hello')",
            "content_preview": "print('hello')",
            "filename": "test.py",
        })
        c = _check_tool_content(tool_name, r, "file", ["file", "content", "operation", "language"])
        if c:
            _assert(c.get("language") == "python",
                    f"{tool_name}: language inferred as python from .py extension")


def test_mcp_tools():
    print("\n=== MCP tools ===")
    for tool_name in ("mcp_call_tool", "mcp_list_tools"):
        r = ToolResult(success=True, message="ok", data={
            "tool_name": "my_tool",
            "server": "my_server",
            "arguments": {"key": "val"},
            "result": "some result",
        })
        c = _check_tool_content(tool_name, r, "mcp", ["tool", "server", "arguments", "result"])


def test_todo_tools():
    print("\n=== Todo tools ===")
    for tool_name in ("todo_write", "todo_update", "todo_read"):
        r = ToolResult(success=True, message="ok", data={
            "content": "- [x] Done item\n- [ ] Pending item",
            "title": "My Todos",
        })
        c = _check_tool_content(tool_name, r, "todo", ["items", "todo_type", "title"])
        if c:
            _assert(isinstance(c.get("items"), list), f"{tool_name}: items is list")
            if c.get("items"):
                _assert(len(c["items"]) == 2, f"{tool_name}: parsed 2 items")


def test_task_tools():
    print("\n=== Task tools ===")
    for tool_name in ("task_create", "task_complete", "task_list", "task_done", "task_update"):
        r = ToolResult(success=True, message="ok", data={
            "tasks": [{"id": "1", "description": "test task"}],
            "task_id": "1",
        })
        c = _check_tool_content(tool_name, r, "task", ["task_type", "tasks"])


def test_multimedia_tools():
    print("\n=== Multimedia tools ===")
    for tool_name in ("export_pdf", "render_diagram", "speech_to_text", "export_slides", "upload_file"):
        r = ToolResult(success=True, message="ok", data={
            "file": "/home/user/output/result.pdf",
            "download_url": "/api/files/download?path=...",
        })
        c = _check_tool_content(tool_name, r, "file", ["file", "operation"])
        if c:
            _assert(c.get("operation") == tool_name, f"{tool_name}: operation field matches tool_name")


def test_send_email():
    print("\n=== send_email tool ===")
    r = ToolResult(success=True, message="ok", data={
        "to": "test@example.com",
        "subject": "Hello",
    })
    c = _check_tool_content("send_email", r, "file", ["operation", "content"])
    if c:
        _assert("test@example.com" in (c.get("content") or ""),
                "send_email: content includes recipient")


def test_error_fallback():
    print("\n=== Error fallback (failed tool) ===")
    r = ToolResult(success=False, message="Something went wrong", data={})
    c = build_tool_content("unknown_future_tool", r)
    _assert(c is not None, "error fallback: failed tool returns non-None content")
    if c:
        _assert(c.get("type") in ("shell", "file", "browser", "search", "mcp", "todo", "task"),
                "error fallback: has a known type",
                f"got {c.get('type')!r}")


def test_desktop_tools():
    print("\n=== Desktop tools ===")
    for tool_name in ("desktop_open_app", "desktop_app_type", "desktop_app_screenshot"):
        r = ToolResult(success=True, message="ok", data={
            "app": "thunar",
            "screenshot_b64": "data:image/png;base64,iVBORw0KGgo=",
        })
        c = _check_tool_content(tool_name, r, "browser", ["url", "title", "screenshot_b64"])


def test_make_event_tool_call_id():
    print("\n=== make_event tool_call_id stability ===")
    tool_call_id = "tc_step1_0_0"
    ev_calling = make_event("tool", status=ToolStatus.CALLING.value,
                            tool_name="shell", function_name="shell_exec",
                            function_args={"command": "ls"}, tool_call_id=tool_call_id)
    ev_called = make_event("tool", status=ToolStatus.CALLED.value,
                           tool_name="shell", function_name="shell_exec",
                           function_args={"command": "ls"}, tool_call_id=tool_call_id,
                           tool_content={"type": "shell", "command": "ls"})
    _assert(ev_calling.get("tool_call_id") == tool_call_id,
            "calling event: tool_call_id is stable")
    _assert(ev_called.get("tool_call_id") == tool_call_id,
            "called event: tool_call_id matches calling event")
    _assert(ev_called.get("tool_content") is not None,
            "called event: has tool_content")
    _assert(ev_calling.get("type") == "tool", "calling event: type=tool")
    _assert(ev_called.get("type") == "tool", "called event: type=tool")


def test_error_content_includes_message():
    """Validate that failed ToolResult includes error_message in every tool type branch."""
    print("\n=== Error content includes error_message ===")
    error_msg = "Connection refused"

    for tool_name in ("shell_exec", "shell_view", "shell_wait",
                      "shell_write_to_process", "shell_kill_process"):
        r = ToolResult(success=False, message=error_msg, data={})
        c = build_tool_content(tool_name, r)
        _assert(c is not None, f"{tool_name} failed: returns content")
        if c:
            _assert(c.get("error_message") == error_msg,
                    f"{tool_name} failed: error_message propagated")
            _assert(error_msg in (c.get("stderr") or "") or error_msg in (c.get("console") or ""),
                    f"{tool_name} failed: error in stderr or console")

    for tool_name in ("info_search_web", "web_search"):
        r = ToolResult(success=False, message=error_msg, data={})
        c = build_tool_content(tool_name, r)
        _assert(c is not None, f"{tool_name} failed: returns content")
        if c:
            _assert(c.get("error_message") == error_msg, f"{tool_name} failed: error_message propagated")

    for tool_name in ("browser_navigate", "web_browse"):
        r = ToolResult(success=False, message=error_msg, data={})
        c = build_tool_content(tool_name, r)
        _assert(c is not None, f"{tool_name} failed: returns content")
        if c:
            _assert(c.get("error_message") == error_msg, f"{tool_name} failed: error_message propagated")
            _assert(error_msg in (c.get("content") or ""), f"{tool_name} failed: error in content")

    for tool_name in ("file_read", "file_write", "file_str_replace"):
        r = ToolResult(success=False, message=error_msg, data={})
        c = build_tool_content(tool_name, r)
        _assert(c is not None, f"{tool_name} failed: returns content")
        if c:
            _assert(c.get("error_message") == error_msg, f"{tool_name} failed: error_message propagated")
            _assert(error_msg in (c.get("content") or ""), f"{tool_name} failed: error in content")

    for tool_name in ("mcp_call_tool", "mcp_list_tools"):
        r = ToolResult(success=False, message=error_msg, data={})
        c = build_tool_content(tool_name, r)
        _assert(c is not None, f"{tool_name} failed: returns content")
        if c:
            _assert(c.get("error_message") == error_msg, f"{tool_name} failed: error_message propagated")
            _assert(error_msg in (c.get("result") or ""), f"{tool_name} failed: error in result")

    r = ToolResult(success=False, message=error_msg, data={})
    c = build_tool_content("unknown_future_tool", r)
    _assert(c is not None, "unknown tool failed: returns content")
    if c:
        _assert(c.get("error_message") == error_msg, "unknown tool failed: error_message propagated")
        _assert(error_msg in (c.get("stderr") or "") or error_msg in (c.get("console") or ""),
                "unknown tool failed: error in stderr or console")


def test_message_tool_lifecycle_events():
    """Validate that message_notify_user and message_ask_user emit calling/called lifecycle."""
    print("\n=== message tool lifecycle events ===")
    from server.agent.models.event import ToolStatus

    tool_call_id = "tc_step1_0_0"
    for tool_name in ("message_notify_user", "message_ask_user"):
        calling_ev = make_event("tool",
                                status=ToolStatus.CALLING.value,
                                tool_name=tool_name,
                                function_name=tool_name,
                                function_args={"text": "Hello!"},
                                tool_call_id=tool_call_id)
        called_ev = make_event("tool",
                               status=ToolStatus.CALLED.value,
                               tool_name=tool_name,
                               function_name=tool_name,
                               function_args={"text": "Hello!"},
                               tool_call_id=tool_call_id,
                               function_result="Notification sent",
                               tool_content={"type": "shell", "command": "", "console": "Hello!",
                                             "stdout": "Hello!", "stderr": "", "return_code": 0})
        _assert(calling_ev.get("status") == ToolStatus.CALLING.value,
                f"{tool_name}: calling event has CALLING status")
        _assert(called_ev.get("status") == ToolStatus.CALLED.value,
                f"{tool_name}: called event has CALLED status")
        _assert(calling_ev.get("tool_call_id") == tool_call_id,
                f"{tool_name}: calling tool_call_id stable")
        _assert(called_ev.get("tool_call_id") == tool_call_id,
                f"{tool_name}: called tool_call_id stable")
        _assert(called_ev.get("tool_content") is not None,
                f"{tool_name}: called event has tool_content")


def test_build_tool_lifecycle_events_helper():
    """Test the shared build_tool_lifecycle_events helper used by all tool paths."""
    print("\n=== build_tool_lifecycle_events shared helper ===")
    tool_call_id = "tc_step99_2_3"

    r_ok = ToolResult(success=True, message="Done", data={"stdout": "hello", "command": "echo hello"})
    evts = build_tool_lifecycle_events("shell", "shell_exec", {"command": "echo hello"},
                                       tool_call_id, r_ok, function_result="Done")
    _assert(len(evts) == 2, "lifecycle helper: returns exactly 2 events")
    calling, called = evts
    _assert(calling.get("status") == ToolStatus.CALLING.value, "lifecycle helper: first event is CALLING")
    _assert(called.get("status") == ToolStatus.CALLED.value, "lifecycle helper: second event is CALLED for success")
    _assert(calling.get("tool_call_id") == tool_call_id, "lifecycle helper: calling has correct tool_call_id")
    _assert(called.get("tool_call_id") == tool_call_id, "lifecycle helper: called has correct tool_call_id")
    _assert(called.get("tool_content") is not None, "lifecycle helper: called has tool_content")
    _assert(called.get("tool_content", {}).get("type") == "shell", "lifecycle helper: tool_content.type is shell")

    r_fail = ToolResult(success=False, message="Permission denied", data={},
                        error_stack="Traceback...\nPermissionError: [Errno 13]")
    evts_err = build_tool_lifecycle_events("shell", "shell_exec", {"command": "rm -rf /"},
                                           tool_call_id, r_fail, function_result="")
    _assert(len(evts_err) == 2, "lifecycle helper error: returns 2 events")
    calling_e, error_e = evts_err
    _assert(calling_e.get("status") == ToolStatus.CALLING.value, "lifecycle helper error: first is CALLING")
    _assert(error_e.get("status") == ToolStatus.ERROR.value, "lifecycle helper error: second is ERROR for failure")
    tc_err = error_e.get("tool_content", {})
    _assert(tc_err.get("error_message") == "Permission denied",
            "lifecycle helper error: error_message in tool_content")
    _assert(tc_err.get("error_stack") == "Traceback...\nPermissionError: [Errno 13]",
            "lifecycle helper error: error_stack in tool_content")


def test_error_stack_propagation():
    """Test that error_stack from ToolResult appears in build_tool_content output."""
    print("\n=== error_stack propagation ===")
    stack = "Traceback (most recent call last):\n  File 'tools/shell.py', line 42\nIOError: [Errno 5] Input/output error"
    for tool_name in ("shell_exec", "file_read", "browser_navigate", "mcp_call_tool",
                      "info_search_web", "todo_write", "task_create"):
        r = ToolResult(success=False, message="I/O error", data={}, error_stack=stack)
        c = build_tool_content(tool_name, r)
        _assert(c is not None, f"{tool_name}: content not None with error_stack")
        if c:
            _assert(c.get("error_stack") == stack, f"{tool_name}: error_stack propagated to content")


def main():
    print("=== Dzeck SSE Tool Event Verification ===")
    test_shell_tools()
    test_search_tools()
    test_browser_tools()
    test_browser_screenshot_normalization()
    test_file_tools()
    test_mcp_tools()
    test_todo_tools()
    test_task_tools()
    test_multimedia_tools()
    test_send_email()
    test_error_fallback()
    test_desktop_tools()
    test_make_event_tool_call_id()
    test_error_content_includes_message()
    test_message_tool_lifecycle_events()
    test_build_tool_lifecycle_events_helper()
    test_error_stack_propagation()

    print(f"\n=== Results: {len(_passes)} passed, {len(_failures)} failed ===")
    if _failures:
        print("Failed assertions:")
        for f in _failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("All assertions passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
