"""
Shell execution tools for Dzeck AI Agent.
E2B-ONLY mode: All execution runs inside E2B cloud sandbox.
No local subprocess fallback — local execution is permanently disabled.

Provides: ShellTool class + backward-compatible functions.
"""
import os
import queue
import shlex
import subprocess
import time
import threading
from typing import Optional, Dict, Any, Callable

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

E2B_ENABLED = bool(os.environ.get("E2B_API_KEY", ""))

_shell_sessions: Dict[str, Dict[str, Any]] = {}
_sessions_lock = threading.Lock()

_stream_local = threading.local()

def set_stream_queue(q: Optional[queue.Queue]) -> None:
    """Register a streaming output queue for the current thread."""
    _stream_local.queue = q

def get_stream_queue() -> Optional[queue.Queue]:
    """Get the streaming output queue for the current thread."""
    return getattr(_stream_local, "queue", None)


def _get_or_create_session(sid: str) -> Dict[str, Any]:
    with _sessions_lock:
        if sid not in _shell_sessions:
            _shell_sessions[sid] = {
                "popen": None,
                "output": "",
                "command": "",
                "return_code": None,
                "lock": threading.Lock(),
            }
        return _shell_sessions[sid]


def _get_session(sid: str) -> Optional[Dict[str, Any]]:
    with _sessions_lock:
        return _shell_sessions.get(sid)


def _shell_quote(s: str) -> str:
    return shlex.quote(s)


def _run_e2b(command: str, exec_dir: str = "/home/user/dzeck-ai", timeout: int = 90) -> Dict[str, Any]:
    """Execute command via E2B cloud sandbox. Auto-ensures workspace dir exists.
    Streams stdout/stderr to stream_queue if one is registered on the current thread.
    Uses run_command wrapper for consistent retry/guardrail behavior."""
    try:
        from server.agent.tools.e2b_sandbox import run_command, WORKSPACE_DIR
        effective_dir = exec_dir or WORKSPACE_DIR
        stream_q = get_stream_queue()

        if stream_q is not None:
            def _on_stdout(data):
                line = data if isinstance(data, str) else getattr(data, 'line', str(data))
                stream_q.put(("stdout", line))

            def _on_stderr(data):
                line = data if isinstance(data, str) else getattr(data, 'line', str(data))
                stream_q.put(("stderr", line))

            result = run_command(command, workdir=effective_dir, timeout=timeout,
                                on_stdout=_on_stdout, on_stderr=_on_stderr)
            stream_q.put(None)
        else:
            result = run_command(command, workdir=effective_dir, timeout=timeout)

        return result
    except Exception as e:
        stream_q = get_stream_queue()
        if stream_q is not None:
            stream_q.put(None)
        return {"success": False, "stdout": "", "stderr": str(e), "exit_code": -1}


def _run_local(command: str, exec_dir: str = "/tmp", timeout: int = 90) -> Dict[str, Any]:
    """Execute command locally via subprocess with streaming output support."""
    import select
    try:
        if not os.path.isdir(exec_dir):
            exec_dir = "/tmp"

        env = {**os.environ, "PYTHONUNBUFFERED": "1", "TERM": "xterm-256color"}
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=exec_dir,
            env=env,
            bufsize=1,
        )

        stream_q = get_stream_queue()
        stdout_lines = []
        stderr_lines = []
        start = time.time()

        while True:
            elapsed = time.time() - start
            if elapsed > timeout:
                proc.kill()
                return {"success": False, "stdout": "".join(stdout_lines),
                        "stderr": "Command timed out after {}s".format(timeout), "exit_code": -1}

            try:
                reads = [proc.stdout.fileno(), proc.stderr.fileno()]
                r, _, _ = select.select(reads, [], [], 0.1)
            except Exception:
                break

            for fd in r:
                if fd == proc.stdout.fileno():
                    line = proc.stdout.readline()
                    if line:
                        stdout_lines.append(line)
                        if stream_q is not None:
                            stream_q.put(("stdout", line.rstrip()))
                elif fd == proc.stderr.fileno():
                    line = proc.stderr.readline()
                    if line:
                        stderr_lines.append(line)
                        if stream_q is not None:
                            stream_q.put(("stderr", line.rstrip()))

            if proc.poll() is not None:
                for line in proc.stdout:
                    stdout_lines.append(line)
                    if stream_q is not None:
                        stream_q.put(("stdout", line.rstrip()))
                for line in proc.stderr:
                    stderr_lines.append(line)
                    if stream_q is not None:
                        stream_q.put(("stderr", line.rstrip()))
                break

        if stream_q is not None:
            stream_q.put(None)

        return {
            "success": proc.returncode == 0,
            "stdout": "".join(stdout_lines),
            "stderr": "".join(stderr_lines),
            "exit_code": proc.returncode if proc.returncode is not None else -1,
        }
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e), "exit_code": -1}


# Commands that require a graphical display (not available in cloud sandbox)
# These would hang forever if allowed to run — intercept and provide helpful error
_GUI_COMMANDS = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "firefox", "firefox-esr", "epiphany", "midori", "opera", "brave-browser",
    "xdg-open", "xdg-launch", "xdg-email", "xdg-settings",
    "gnome-open", "kde-open", "gvfs-open",
    "xterm", "gnome-terminal", "konsole", "xfce4-terminal",
    "x-www-browser", "sensible-browser",
    "display", "eog", "feh", "sxiv",        # image viewers
    "vlc", "mpv", "mplayer", "totem",       # media players
    "evince", "okular", "zathura",           # document viewers
    "gedit", "mousepad", "kate", "kwrite",  # GUI text editors
    "gimp", "inkscape", "blender",           # GUI tools
    "startx", "xinit", "Xorg", "Xvfb",
]

def _is_gui_command(command: str) -> Optional[str]:
    """
    Check if the command is a GUI/display-dependent program that cannot run
    in a headless cloud sandbox. Returns the detected command name if GUI, else None.
    """
    import shlex
    try:
        parts = shlex.split(command.strip())
    except Exception:
        parts = command.strip().split()
    if not parts:
        return None
    # Check base command name (without path)
    base = os.path.basename(parts[0]).lower()
    for gui_cmd in _GUI_COMMANDS:
        if base == gui_cmd or base.startswith(gui_cmd + " "):
            return base
    # Also intercept "env VAR=val google-chrome ..." patterns
    for part in parts:
        base_part = os.path.basename(part).lower()
        for gui_cmd in _GUI_COMMANDS:
            if base_part == gui_cmd:
                return base_part
    return None


def _sync_e2b_output_file(file_path: str) -> str:
    """
    Transfer a file from E2B sandbox to local server and register it for download.
    Returns download_url string, or '' if failed.
    """
    try:
        import urllib.parse, shutil, hashlib, time as _time
        from server.agent.tools.e2b_sandbox import read_file_bytes

        data = read_file_bytes(file_path)
        if not data:
            return ""

        session_id = os.environ.get("DZECK_SESSION_ID", "")
        if session_id:
            local_dir = f"/tmp/dzeck_files/{session_id}"
        else:
            local_dir = "/tmp/dzeck_files"
        os.makedirs(local_dir, exist_ok=True)

        filename = os.path.basename(file_path)
        dest = os.path.join(local_dir, filename)
        if os.path.exists(dest):
            base, ext = os.path.splitext(filename)
            tag = hashlib.md5(str(_time.time()).encode()).hexdigest()[:6]
            filename = f"{base}_{tag}{ext}"
            dest = os.path.join(local_dir, filename)

        with open(dest, "wb") as f:
            f.write(data)

        encoded_path = urllib.parse.quote(dest, safe="")
        encoded_name = urllib.parse.quote(filename, safe="")
        return f"/api/files/download?path={encoded_path}&name={encoded_name}"
    except Exception as e:
        return ""


def _extract_output_paths_from_command(command: str) -> list:
    """Scan a shell command for output file paths in /home/user/dzeck-ai/output/."""
    import re
    OUTPUT_DIR = "/home/user/dzeck-ai/output/"
    pattern = r"(/home/user/dzeck-ai/output/[\w.\-/]+)"
    paths = re.findall(pattern, command)
    unique = []
    seen = set()
    for p in paths:
        p = p.rstrip("/,;\"'")
        if p not in seen and "." in os.path.basename(p):
            unique.append(p)
            seen.add(p)
    return unique


def _preflight_ensure_scripts(command: str, exec_dir: str = "/home/user/dzeck-ai") -> Optional[str]:
    """Before executing a python script command in E2B, ensure the script file exists in the sandbox.
    Returns an error message string if the file cannot be ensured, or None on success."""
    if not E2B_ENABLED:
        return None
    import re
    match = re.search(r'python[3]?\s+(?:-\w+\s+)*([^\s;|&]+\.py)', command)
    if not match:
        return None
    script_path = match.group(1)
    try:
        from server.agent.tools.e2b_sandbox import ensure_file_in_sandbox, WORKSPACE_DIR, get_cached_file_path
        import os as _os
        if not script_path.startswith("/"):
            resolved_exec = _os.path.normpath(_os.path.join(exec_dir or WORKSPACE_DIR, script_path))
            resolved_ws = _os.path.normpath(_os.path.join(WORKSPACE_DIR, script_path))
            cached_exec = get_cached_file_path(resolved_exec)
            cached_ws = get_cached_file_path(resolved_ws) if resolved_ws != resolved_exec else None
            if cached_exec:
                resolved = cached_exec
            elif cached_ws:
                resolved = cached_ws
            else:
                resolved = resolved_exec
        else:
            resolved = script_path
        ok = ensure_file_in_sandbox(resolved)
        if not ok:
            return f"Script file '{resolved}' not found in E2B sandbox and could not be restored. Please write the file first using file_write."
        return None
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[Shell] Pre-flight script check failed for %s: %s", script_path, e)
        return f"Pre-flight script check error for '{script_path}': {e}. Please ensure the file exists in E2B sandbox."


def _auto_fix_python_syntax(script_path: str, error_msg: str, exec_dir: str) -> bool:
    """Attempt to auto-fix common Python syntax errors. Returns True if fix was applied."""
    import re as _re

    try:
        if E2B_ENABLED:
            from server.agent.tools.e2b_sandbox import read_file as _e2b_read
            content = _e2b_read(script_path)
        else:
            return False  # E2B-only mode: no local file access
        if not content:
            return False
    except Exception:
        return False

    original = content
    lines = content.split("\n")

    if "IndentationError" in error_msg or "unexpected indent" in error_msg:
        fixed_lines = []
        for line in lines:
            if "\t" in line:
                fixed_lines.append(line.replace("\t", "    "))
            else:
                fixed_lines.append(line)
        content = "\n".join(fixed_lines)

    if "SyntaxError" in error_msg and "expected an indented block" in error_msg:
        match = _re.search(r"line (\d+)", error_msg)
        if match:
            line_no = int(match.group(1)) - 1
            if 0 <= line_no < len(lines):
                prev_line = lines[line_no - 1] if line_no > 0 else ""
                if prev_line.rstrip().endswith(":"):
                    indent = len(prev_line) - len(prev_line.lstrip()) + 4
                    lines.insert(line_no, " " * indent + "pass")
                    content = "\n".join(lines)

    if content == original:
        return False

    try:
        if E2B_ENABLED:
            from server.agent.tools.e2b_sandbox import write_file as _e2b_write
            return _e2b_write(script_path, content)
        else:
            return False  # E2B-only mode: no local file write
    except Exception:
        return False


def _validate_python_syntax(command: str, exec_dir: str = "/home/user/dzeck-ai") -> Optional[ToolResult]:
    """Pre-validate Python script syntax with up to 3 auto-fix attempts.
    Returns ToolResult on failure after all attempts, None on success."""
    import re as _re
    match = _re.search(r'python[3]?\s+(?:-\w+\s+)*([^\s;|&]+\.py)', command)
    if not match:
        return None
    script_path = match.group(1)
    if not script_path.startswith("/"):
        script_path = os.path.join(exec_dir, script_path)

    max_attempts = 3
    last_stderr = ""

    for attempt in range(1, max_attempts + 1):
        compile_cmd = f"python3 -m py_compile {script_path}"
        if E2B_ENABLED:
            res = _run_e2b(compile_cmd, exec_dir=exec_dir, timeout=30)
        else:
            return ToolResult(
                success=False,
                message="[Shell] E2B sandbox diperlukan untuk validasi syntax. Tidak ada local execution.",
                data={"error": "e2b_required", "command": command},
            )

        if res.get("success", False) or res.get("exit_code", -1) == 0:
            if attempt > 1:
                import logging
                logging.getLogger(__name__).info(
                    "[Shell] Python syntax fixed on attempt %d for %s", attempt, script_path)
            return None

        last_stderr = res.get("stderr", "")

        if attempt < max_attempts:
            fixed = _auto_fix_python_syntax(script_path, last_stderr, exec_dir)
            if not fixed:
                break

    msg = (
        f"[Shell] Python syntax validation FAILED for {script_path} "
        f"(after {min(attempt, max_attempts)} attempt(s)).\n"
        f"Error: {last_stderr}\n\n"
        f"FIX REQUIRED: The script has syntax errors. You MUST:\n"
        f"1. Read the error message above carefully\n"
        f"2. Fix the script using file_write or file_str_replace\n"
        f"3. Re-run the command after fixing\n"
        f"Do NOT retry with the same broken script."
    )
    return ToolResult(
        success=False,
        message=msg,
        data={"stdout": "", "stderr": last_stderr, "return_code": 1,
              "command": command, "error": "syntax_validation_failed",
              "script_path": script_path, "attempts": attempt},
    )


_recent_errors: Dict[str, int] = {}
_recent_errors_lock = threading.Lock()


def _session_error_prefix() -> str:
    """Return a session-scoped prefix for error tracking keys."""
    session_id = os.environ.get("DZECK_SESSION_ID", "")
    return f"{session_id}::" if session_id else ""


def _check_repeated_error(command: str, error_output: str) -> Optional[str]:
    """Track repeated errors (session-scoped). Returns warning message if same error seen 2+ times."""
    if not error_output or not error_output.strip():
        return None
    prefix = _session_error_prefix()
    error_sig = error_output.strip()[:200]
    error_key = f"{prefix}{command}::{error_sig}"
    with _recent_errors_lock:
        _recent_errors[error_key] = _recent_errors.get(error_key, 0) + 1
        count = _recent_errors[error_key]
        if len(_recent_errors) > 200:
            oldest = list(_recent_errors.keys())[:50]
            for k in oldest:
                _recent_errors.pop(k, None)
    if count >= 3:
        return (
            f"\n🛑 REPEATED ERROR BLOCKED ({count} times): This exact error has occurred {count} times. "
            f"You MUST completely change your approach — do NOT retry with the same command or similar strategy. "
            f"Consider: different library, different algorithm, skip this step, or ask the user."
        )
    if count >= 2:
        return (
            f"\n⚠️ REPEATED ERROR DETECTED ({count} times): This exact error has occurred before. "
            f"You MUST change your approach — do NOT retry with the same command. "
            f"Analyze the error, try a different solution, or report to the user."
        )
    return None


def _check_repeated_command_prerun(command: str) -> Optional[ToolResult]:
    """Block execution of a command that has failed with the same error 3+ times (session-scoped)."""
    prefix = _session_error_prefix()
    with _recent_errors_lock:
        for key, count in _recent_errors.items():
            if key.startswith(f"{prefix}{command}::") and count >= 3:
                msg = (
                    f"[Shell] BLOCKED: identical command/error seen {count} times — change approach entirely. "
                    f"This command has failed repeatedly with the same error. "
                    f"You MUST use a completely different approach, different tool, or skip this step.\n"
                    f"Previous error: {key.split('::', 1)[-1][:300]}"
                )
                return ToolResult(
                    success=False,
                    message=msg,
                    data={"stdout": "", "stderr": msg, "return_code": 1,
                          "command": command, "error": "repeated_failure_blocked"},
                )
    return None


def _check_error_in_output(stdout: str, stderr: str) -> bool:
    """Check if output contains error indicators."""
    combined = (stdout + stderr).lower()
    error_indicators = ["traceback", "error:", "failed", "exception:", "syntaxerror", "indentationerror"]
    return any(indicator in combined for indicator in error_indicators)


def shell_exec(command: str, exec_dir: str = "/home/user/dzeck-ai", id: str = "default") -> ToolResult:
    """Execute a shell command. Uses E2B cloud sandbox when available, refuses local execution."""
    exec_dir = exec_dir or "/home/user/dzeck-ai"

    gui_detected = _is_gui_command(command)
    if gui_detected:
        msg = (
            f"[Shell] Command '{gui_detected}' requires a graphical display (GUI) which is "
            f"not available in the cloud sandbox.\n\n"
            f"For web browsing, use the 'web_browse' tool instead of launching a browser via shell.\n"
            f"Example: web_browse(url='https://www.google.com') to navigate to Google.\n\n"
            f"For opening files, use 'file_read' tool to read file contents directly.\n"
            f"For images/screenshots, use the browser tool's built-in screenshot capability."
        )
        return ToolResult(
            success=False,
            message=msg,
            data={"stdout": "", "stderr": msg, "return_code": 1, "command": command,
                  "id": id, "error": "gui_not_available"},
        )

    blocked = _check_repeated_command_prerun(command)
    if blocked:
        return blocked

    if not E2B_ENABLED:
        msg = (
            "[Shell] E2B sandbox is not available (E2B_API_KEY not set). "
            "All shell execution MUST run inside E2B sandbox for security. "
            "Local execution is disabled. Please configure E2B_API_KEY."
        )
        return ToolResult(
            success=False,
            message=msg,
            data={"stdout": "", "stderr": msg, "return_code": 1, "command": command,
                  "id": id, "error": "e2b_not_available"},
        )

    preflight_err = _preflight_ensure_scripts(command, exec_dir=exec_dir)
    if preflight_err:
        return ToolResult(
            success=False,
            message=preflight_err,
            data={"stdout": "", "stderr": preflight_err, "return_code": 1,
                  "command": command, "id": id, "error": "script_not_found"},
        )

    syntax_err = _validate_python_syntax(command, exec_dir=exec_dir)
    if syntax_err is not None:
        return syntax_err

    res = _run_e2b(command, exec_dir=exec_dir)

    stdout = res.get("stdout", "")
    stderr = res.get("stderr", "")
    exit_code = res.get("exit_code", -1)

    max_chars = 8000
    if len(stdout) > max_chars:
        stdout = stdout[:max_chars] + "\n[Output truncated...]"
    if len(stderr) > max_chars:
        stderr = stderr[:max_chars] + "\n[Error output truncated...]"

    combined = ""
    if stdout.strip():
        combined += "stdout:\n{}".format(stdout)
    if stderr.strip():
        combined += "\nstderr:\n{}".format(stderr)
    combined += "\nreturn_code: {}".format(exit_code)

    if _check_error_in_output(stdout, stderr):
        repeated_warning = _check_repeated_error(command, stderr or stdout)
        if repeated_warning:
            combined += repeated_warning

    if not res.get("success", False) and _check_error_in_output(stdout, stderr):
        combined += (
            "\n\n⚠️ OUTPUT CONTAINS ERRORS: Do NOT mark this step as completed. "
            "Analyze the error, fix the issue, and verify before proceeding."
        )

    sess = _get_or_create_session(id)
    sess["output"] = combined
    sess["return_code"] = exit_code
    sess["command"] = command

    backend = "E2B"

    synced_files = []
    if E2B_ENABLED and res.get("success", False):
        output_paths = _extract_output_paths_from_command(command)
        try:
            from server.agent.tools.e2b_sandbox import list_output_files as _list_out
            sandbox_output_files = _list_out()
            for sf in sandbox_output_files:
                if sf not in output_paths:
                    output_paths.append(sf)
        except Exception:
            pass

        for path in output_paths:
            dl_url = _sync_e2b_output_file(path)
            if dl_url:
                synced_files.append({
                    "path": path,
                    "filename": os.path.basename(path),
                    "download_url": dl_url,
                })
                combined += f"\n📎 File siap didownload: {os.path.basename(path)}"

    result_data = {
        "stdout": stdout,
        "stderr": stderr,
        "return_code": exit_code,
        "command": command,
        "id": id,
        "backend": backend,
    }
    if synced_files:
        result_data["synced_files"] = synced_files
        result_data["download_url"] = synced_files[0]["download_url"]
        result_data["filename"] = synced_files[0]["filename"]

    return ToolResult(
        success=res.get("success", False),
        message=combined,
        data=result_data,
    )


def shell_view(id: str = "default") -> ToolResult:
    """View the current output/status of a shell session."""
    session = _get_session(id)
    fallback_warning = ""
    if not session:
        with _sessions_lock:
            available = list(_shell_sessions.keys())
            if len(available) == 1:
                fallback_id = available[0]
                session = _shell_sessions[fallback_id]
                fallback_warning = "[Peringatan] Session '{}' tidak ditemukan, menampilkan session '{}' yang tersedia. ".format(id, fallback_id)
                id = fallback_id
        if not session:
            hint = (
                "Session yang tersedia: {}. Gunakan id yang sesuai.".format(available)
                if available
                else "Tidak ada session aktif. Buat session baru dengan shell_exec terlebih dahulu (contoh: shell_exec id=\"main\" command=\"...\")."
            )
            return ToolResult(
                success=False,
                message="Session '{}' tidak ditemukan. {}".format(id, hint),
                data={"id": id, "found": False, "available_sessions": available},
            )
    output = session.get("output", "(belum ada output)")
    return ToolResult(
        success=True,
        message="{}Session '{}' (perintah: {})\n\n{}".format(fallback_warning, id, session.get("command", ""), output),
        data={
            "id": id,
            "command": session.get("command", ""),
            "output": output,
            "return_code": session.get("return_code"),
            "found": True,
        },
    )


def shell_wait(id: str = "default", seconds: int = 5) -> ToolResult:
    """Wait N seconds then show session status. Always returns success=True."""
    seconds = max(1, min(int(seconds) if seconds else 5, 120))
    time.sleep(seconds)
    return shell_view(id)


def shell_write_to_process(id: str, input: str, press_enter: bool = True) -> ToolResult:
    """Send input to an existing session by re-running with piped input."""
    session = _get_session(id)
    fallback_warning = ""
    if not session:
        with _sessions_lock:
            available = list(_shell_sessions.keys())
            if len(available) == 1:
                fallback_id = available[0]
                session = _shell_sessions[fallback_id]
                fallback_warning = "[Peringatan] Session '{}' tidak ditemukan, menggunakan session '{}' yang tersedia. ".format(id, fallback_id)
                id = fallback_id
        if not session:
            hint = (
                "Session yang tersedia: {}. Gunakan id yang sesuai.".format(available)
                if available
                else "Tidak ada session aktif. Buat session baru dengan shell_exec terlebih dahulu (contoh: shell_exec id=\"main\" command=\"...\")."
            )
            return ToolResult(
                success=False,
                message="Session '{}' tidak ditemukan. {}".format(id, hint),
                data={"id": id, "found": False, "input": input, "available_sessions": available},
            )
    last_command = session.get("command", "")
    if last_command:
        if not E2B_ENABLED:
            return ToolResult(
                success=False,
                message="[Shell] E2B sandbox is not available. All shell operations require E2B sandbox.",
                data={"id": id, "error": "e2b_not_available"},
            )
        if press_enter:
            combined_cmd = "printf '%s\\n' {} | {}".format(
                _shell_quote(input), last_command
            )
        else:
            combined_cmd = "printf '%s' {} | {}".format(
                _shell_quote(input), last_command
            )
        res = _run_e2b(combined_cmd)
        out = (res.get("stdout") or "") + (res.get("stderr") or "")
        session["output"] = out
        return ToolResult(
            success=res.get("success", False),
            message="{}Input '{}' dikirim. Output: {}".format(fallback_warning, input, out[:500]),
            data={"id": id, "input": input, "output": out},
        )
    return ToolResult(
        success=True,
        message="{}Session '{}' tidak memiliki command aktif.".format(fallback_warning, id),
        data={"id": id, "found": True, "active": False},
    )


def shell_kill_process(id: str = "default") -> ToolResult:
    """Remove/terminate a shell session."""
    with _sessions_lock:
        session = _shell_sessions.pop(id, None)
    if not session:
        return ToolResult(
            success=True,
            message="Session '{}' tidak ada atau sudah dihentikan.".format(id),
            data={"id": id, "found": False},
        )
    return ToolResult(
        success=True,
        message="Session '{}' berhasil dihentikan.".format(id),
        data={"id": id, "found": True},
    )


class ShellTool(BaseTool):
    """Shell tool class - routes to E2B cloud sandbox."""

    name: str = "shell"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="shell_exec",
        description=(
            "Execute commands in a specified shell session via E2B cloud sandbox. "
            "Use for: running code/scripts, installing packages, file management, "
            "starting services, checking system status. "
            "Commands run in an isolated cloud environment. "
            "This creates a new session or reuses an existing one with the given id. "
            "Sessions are NOT persistent across backend restarts — if a session is lost, "
            "call shell_exec again to recreate it."
        ),
        parameters={
            "id": {"type": "string", "description": "Unique session identifier (e.g. 'main', 'build', 'test'). Use the SAME id across shell_exec, shell_view, shell_wait, shell_write_to_process, and shell_kill_process to operate on the same session. A session must be created with shell_exec before it can be used by other shell tools."},
            "exec_dir": {"type": "string", "description": "Working directory for command execution. Default: /home/user/dzeck-ai"},
            "command": {"type": "string", "description": "Shell command to execute (bash syntax supported)"},
        },
        required=["id", "exec_dir", "command"],
    )
    def _shell_exec(self, id: str, exec_dir: str, command: str) -> ToolResult:
        return shell_exec(command=command, exec_dir=exec_dir, id=id)

    @tool(
        name="shell_view",
        description=(
            "View the current output/status of a shell session. "
            "The session must have been created first with shell_exec using the same id. "
            "Sessions are NOT persistent across backend restarts — if a session is not found, "
            "recreate it with shell_exec."
        ),
        parameters={"id": {"type": "string", "description": "Session identifier — must match the id used in shell_exec when the session was created. Use the SAME id consistently across all shell tool calls for the same session."}},
        required=["id"],
    )
    def _shell_view(self, id: str) -> ToolResult:
        return shell_view(id=id)

    @tool(
        name="shell_wait",
        description=(
            "Wait N seconds then show session status. "
            "The session must have been created first with shell_exec using the same id. "
            "Sessions are NOT persistent across backend restarts."
        ),
        parameters={
            "id": {"type": "string", "description": "Session identifier — must match the id used in shell_exec when the session was created. Use the SAME id consistently across all shell tool calls for the same session."},
            "seconds": {"type": "integer", "description": "Seconds to wait (1-120, default 5)"},
        },
        required=["id"],
    )
    def _shell_wait(self, id: str, seconds: Optional[int] = None) -> ToolResult:
        return shell_wait(id=id, seconds=seconds or 5)

    @tool(
        name="shell_write_to_process",
        description=(
            "Send input to a running process in a shell session. "
            "The session must have been created first with shell_exec using the same id. "
            "If the given id is not found but exactly one session exists, it will automatically "
            "use that session. Sessions are NOT persistent across backend restarts — if a session "
            "is not found, recreate it with shell_exec."
        ),
        parameters={
            "id": {"type": "string", "description": "Session identifier — must match the id used in shell_exec when the session was created. Use the SAME id consistently across all shell tool calls for the same session."},
            "input": {"type": "string", "description": "Input content to send"},
            "press_enter": {"type": "boolean", "description": "Whether to press Enter after input (default true)"},
        },
        required=["id", "input", "press_enter"],
    )
    def _shell_write_to_process(self, id: str, input: str, press_enter: bool = True) -> ToolResult:
        return shell_write_to_process(id=id, input=input, press_enter=press_enter)

    @tool(
        name="shell_kill_process",
        description=(
            "Terminate a shell session and remove it from active sessions. "
            "The session must have been created first with shell_exec using the same id. "
            "Sessions are NOT persistent across backend restarts."
        ),
        parameters={"id": {"type": "string", "description": "Session identifier — must match the id used in shell_exec when the session was created. Use the SAME id consistently across all shell tool calls for the same session."}},
        required=["id"],
    )
    def _shell_kill_process(self, id: str) -> ToolResult:
        return shell_kill_process(id=id)
