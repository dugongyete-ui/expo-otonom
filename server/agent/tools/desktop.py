"""
Desktop application tools for Dzeck AI Agent.
Enables interaction with XFCE desktop apps (Thunar, Mousepad, xfce4-terminal, etc.)
and any application openable via xdg-open. All operations run inside the E2B Desktop sandbox
and are visible on the VNC desktop.

Provides:
  - desktop_open_app    — launch a named desktop application
  - desktop_app_type    — type text into the currently active desktop window (non-browser)
  - desktop_app_screenshot — screenshot the whole desktop or a named window
"""
import logging
import time
import os
from typing import Optional

from server.agent.models.tool_result import ToolResult

logger = logging.getLogger(__name__)

_E2B_API_KEY_AT_IMPORT = os.environ.get("E2B_API_KEY", "")

_APP_ALIASES = {
    "thunar": "thunar",
    "filemanager": "thunar",
    "file_manager": "thunar",
    "files": "thunar",
    "mousepad": "mousepad",
    "texteditor": "mousepad",
    "text_editor": "mousepad",
    "editor": "mousepad",
    "terminal": "xfce4-terminal",
    "xfce4-terminal": "xfce4-terminal",
    "xterm": "xterm",
    "gedit": "gedit",
    "nano": "xfce4-terminal",
    "calculator": "galculator",
    "galculator": "galculator",
    "evince": "evince",
    "pdfviewer": "evince",
    "pdf_viewer": "evince",
    "eog": "eog",
    "imageviewer": "eog",
    "image_viewer": "eog",
}


def _run_in_sandbox(command: str, timeout: int = 30) -> dict:
    """Execute a shell command inside the E2B sandbox."""
    from server.agent.tools.e2b_sandbox import get_sandbox
    sb = get_sandbox()
    if sb is None:
        return {"exit_code": -1, "stdout": "", "stderr": "Sandbox not available"}
    try:
        result = sb.commands.run(command, timeout=timeout)
        return {
            "exit_code": result.exit_code if hasattr(result, "exit_code") else 0,
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
        }
    except Exception as e:
        return {"exit_code": -1, "stdout": "", "stderr": str(e)}


def _detect_display() -> str:
    """Detect the active X display in the sandbox (cached after first call)."""
    for display in [":0", ":1", ":99"]:
        check = _run_in_sandbox(
            "DISPLAY={d} xdpyinfo 2>/dev/null | head -1 || "
            "DISPLAY={d} xdotool getdisplaygeometry 2>/dev/null".format(d=display),
            timeout=5,
        )
        if check["stdout"].strip():
            return display
    env = _run_in_sandbox("echo $DISPLAY", timeout=3)
    return env.get("stdout", "").strip() or ":0"


def _take_desktop_screenshot(window_name: Optional[str] = None) -> Optional[str]:
    """Take a screenshot of the full desktop or a specific window by name."""
    import base64
    from server.agent.tools.e2b_sandbox import get_sandbox, read_file_bytes

    display = _detect_display()
    path = "/tmp/dzeck_desktop_screenshot.png"

    if window_name:
        # Try to screenshot a specific window by title
        cmd = (
            "DISPLAY={d} import -window "
            "$(DISPLAY={d} xdotool search --name '{w}' 2>/dev/null | head -1) "
            "'{p}' 2>/dev/null || "
            "DISPLAY={d} scrot -z '{p}' 2>/dev/null || true"
        ).format(d=display, w=window_name.replace("'", ""), p=path)
    else:
        cmd = (
            "DISPLAY={d} scrot -z '{p}' 2>/dev/null || "
            "DISPLAY={d} import -window root '{p}' 2>/dev/null || true"
        ).format(d=display, p=path)

    _run_in_sandbox(cmd, timeout=15)
    data = read_file_bytes(path)
    if data:
        return "data:image/png;base64," + base64.b64encode(data).decode()
    return None


class DesktopTool:
    """Desktop application tool class (XFCE desktop, xdg-open, xdotool)."""

    name: str = "desktop"

    def get_tools(self) -> list:
        return [
            {"type": "function", "function": {
                "name": "desktop_open_app",
                "description": (
                    "Launch a desktop application in the E2B XFCE sandbox (visible on VNC). "
                    "Supported apps: thunar (file manager), mousepad (text editor), "
                    "xfce4-terminal (terminal), evince (PDF viewer), eog (image viewer), "
                    "galculator (calculator), or any installed app name. "
                    "Also use this with xdg-open to open files/documents in their default app."
                ),
                "parameters": {"type": "object", "properties": {
                    "app": {"type": "string", "description": "Application name or alias (e.g. 'thunar', 'mousepad', 'terminal', 'evince')."},
                    "file_path": {"type": "string", "description": "(Optional) File or URL to open with the app (e.g. '/home/user/report.pdf')."},
                }, "required": ["app"]},
            }},
            {"type": "function", "function": {
                "name": "desktop_app_type",
                "description": (
                    "Type text into the currently active desktop window (non-browser). "
                    "Useful for entering text in terminal, text editor, or other GUI apps. "
                    "Optionally press Enter after typing."
                ),
                "parameters": {"type": "object", "properties": {
                    "text": {"type": "string", "description": "Text to type into the active window."},
                    "press_enter": {"type": "boolean", "description": "(Optional) Whether to press Enter after typing. Default false."},
                    "window_name": {"type": "string", "description": "(Optional) Window title to focus before typing (e.g. 'Mousepad', 'Terminal'). If omitted, types to the current active window."},
                }, "required": ["text"]},
            }},
            {"type": "function", "function": {
                "name": "desktop_app_screenshot",
                "description": (
                    "Take a screenshot of the full XFCE desktop or a specific application window. "
                    "Returns a base64 image for visual verification of desktop state."
                ),
                "parameters": {"type": "object", "properties": {
                    "window_name": {"type": "string", "description": "(Optional) Window title to screenshot (e.g. 'Thunar', 'Mousepad'). If omitted, screenshots the entire desktop."},
                }, "required": []},
            }},
        ]


def _is_e2b_enabled() -> bool:
    return bool(os.environ.get("E2B_API_KEY", "") or _E2B_API_KEY_AT_IMPORT)


def desktop_open_app(app: str, file_path: str = "") -> ToolResult:
    """Launch a desktop application in the E2B XFCE sandbox.
    Uses xdg-open for files and direct app launch for named apps.
    """
    if not _is_e2b_enabled():
        return ToolResult(
            success=False,
            message="[Desktop] E2B sandbox not available. Desktop app tools require E2B sandbox.",
        )

    display = _detect_display()
    resolved_app = _APP_ALIASES.get(app.lower().replace("-", "_"), app)

    if file_path:
        safe_path = file_path.replace("'", "")
        safe_app = resolved_app.replace("'", "")
        if resolved_app in ("xdg-open",) or not resolved_app:
            cmd = "DISPLAY={d} nohup xdg-open '{f}' >/dev/null 2>&1 &".format(d=display, f=safe_path)
        else:
            cmd = "DISPLAY={d} nohup {a} '{f}' >/dev/null 2>&1 &".format(d=display, a=safe_app, f=safe_path)
    else:
        safe_app = resolved_app.replace("'", "")
        cmd = "DISPLAY={d} nohup {a} >/dev/null 2>&1 &".format(d=display, a=safe_app)

    res = _run_in_sandbox(cmd, timeout=10)
    time.sleep(1.5)

    screenshot_data = _take_desktop_screenshot()
    result_data: dict = {"app": resolved_app, "file_path": file_path}
    if screenshot_data:
        result_data["screenshot_b64"] = screenshot_data

    if res["exit_code"] != 0 and res["stderr"]:
        return ToolResult(
            success=False,
            message="Failed to launch '{}': {}".format(resolved_app, res["stderr"]),
            data=result_data,
        )
    msg = "Launched '{}'".format(resolved_app)
    if file_path:
        msg += " with '{}'".format(file_path)
    return ToolResult(success=True, message=msg, data=result_data)


def desktop_app_type(text: str, press_enter: bool = False, window_name: str = "") -> ToolResult:
    """Type text into a desktop window via xdotool type.
    Optionally focuses a window by name first.
    """
    if not _is_e2b_enabled():
        return ToolResult(
            success=False,
            message="[Desktop] E2B sandbox not available. Desktop app tools require E2B sandbox.",
        )

    display = _detect_display()

    if window_name:
        safe_name = window_name.replace("'", "")
        focus_cmd = (
            "DISPLAY={d} wmctrl -a '{w}' 2>/dev/null || "
            "DISPLAY={d} xdotool search --name '{w}' 2>/dev/null | head -1 | "
            "xargs -I{{}} DISPLAY={d} xdotool windowfocus --sync {{}} 2>/dev/null || true"
        ).format(d=display, w=safe_name)
        _run_in_sandbox(focus_cmd, timeout=5)
        time.sleep(0.3)

    safe_text = text.replace("'", "'\\''")
    type_res = _run_in_sandbox(
        "DISPLAY={d} xdotool type --clearmodifiers --delay 20 '{t}'".format(d=display, t=safe_text),
        timeout=20,
    )
    if type_res["exit_code"] != 0:
        return ToolResult(
            success=False,
            message="Typing failed: {}".format(type_res["stderr"]),
        )

    if press_enter:
        time.sleep(0.1)
        _run_in_sandbox("DISPLAY={d} xdotool key Return".format(d=display), timeout=5)
        time.sleep(0.3)

    screenshot_data = _take_desktop_screenshot(window_name or None)
    result_data: dict = {"text": text, "window": window_name}
    if screenshot_data:
        result_data["screenshot_b64"] = screenshot_data

    return ToolResult(
        success=True,
        message="Typed into '{}'{}".format(window_name or "active window", " (Enter pressed)" if press_enter else ""),
        data=result_data,
    )


def desktop_app_screenshot(window_name: str = "") -> ToolResult:
    """Take a screenshot of the desktop or a named window."""
    if not _is_e2b_enabled():
        return ToolResult(
            success=False,
            message="[Desktop] E2B sandbox not available. Desktop app tools require E2B sandbox.",
        )

    screenshot_data = _take_desktop_screenshot(window_name or None)
    if screenshot_data:
        return ToolResult(
            success=True,
            message="Desktop screenshot captured{}.".format(
                " (window: {})".format(window_name) if window_name else ""
            ),
            data={"screenshot_b64": screenshot_data, "window": window_name},
        )
    return ToolResult(
        success=False,
        message="Screenshot failed. Ensure the E2B sandbox is running with a VNC desktop.",
    )
