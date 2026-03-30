"""
Shell execution tools for Dzeck AI Agent.
E2B-ONLY mode: All execution runs inside E2B cloud sandbox.
No local subprocess fallback — local execution is permanently disabled.

Provides: ShellTool class + backward-compatible functions.
"""
import os
import queue
import shlex
import time
import threading
from typing import Optional, Dict, Any, Callable

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

_E2B_API_KEY_AT_IMPORT = os.environ.get("E2B_API_KEY", "")
E2B_ENABLED = bool(_E2B_API_KEY_AT_IMPORT)


def _is_e2b_enabled() -> bool:
    """Dynamic E2B check — always re-reads env so late-set secrets are picked up."""
    return bool(os.environ.get("E2B_API_KEY", ""))


# ─── Redis-backed shell session store ────────────────────────────────────────
# Primary store: Redis (hash per session, TTL 24 h).
# Fallback: in-memory dict when Redis is unavailable.
# Keyed as: shell:session:<sid>
import json as _json
import logging as _logging

# Process-local active session state.
# Shell sessions contain non-serializable objects (threading.Lock, subprocess handles,
# E2B stream references) that cannot be stored externally. This dict holds the LIVE
# state for sessions active in the current process. Serializable fields are also
# mirrored to Redis for cross-process visibility and durability.
_active_shell_sessions: Dict[str, Dict[str, Any]] = {}
_sessions_lock = threading.Lock()
_session_logger = _logging.getLogger(__name__)

_SESSION_TTL = 86400  # 24 hours


def _redis_session_key(sid: str) -> str:
    return f"shell:session:{sid}"


_redis_client_cache: Optional[Any] = None
_redis_client_lock = threading.Lock()


_redis_connect_failed = False  # If True, stop retrying until process restart


def _get_redis_client():
    """Get a cached synchronous Redis client. Returns None if unavailable."""
    global _redis_client_cache, _redis_connect_failed
    if _redis_connect_failed:
        return None
    with _redis_client_lock:
        if _redis_client_cache is not None:
            return _redis_client_cache
        try:
            import redis as _redis_lib  # type: ignore
            host = os.environ.get("REDIS_HOST", "")
            if not host:
                return None
            port = int(os.environ.get("REDIS_PORT", "6379"))
            password = os.environ.get("REDIS_PASSWORD", "") or None
            client = _redis_lib.Redis(
                host=host, port=port, password=password,
                socket_connect_timeout=1, socket_timeout=1,
                decode_responses=True,
            )
            client.ping()
            _redis_client_cache = client
            _session_logger.debug("[Shell] Redis session store connected to %s:%s", host, port)
            return client
        except Exception as exc:
            _session_logger.debug("[Shell] Redis session store unavailable (%s) — using in-memory fallback.", exc)
            _redis_connect_failed = True
            return None


def _session_set(sid: str, data: Dict[str, Any]) -> None:
    """Persist session state to Redis (JSON), fall back to in-memory."""
    with _sessions_lock:
        _active_shell_sessions[sid] = data
    try:
        rc = _get_redis_client()
        if rc:
            rc.setex(_redis_session_key(sid), _SESSION_TTL, _json.dumps({
                k: v for k, v in data.items()
                if k != "lock" and not callable(v)
            }, default=str))
    except Exception as exc:
        _session_logger.debug("[Shell] Redis session write failed: %s", exc)


def _session_get(sid: str) -> Optional[Dict[str, Any]]:
    """Read session state from Redis (JSON), fall back to in-memory."""
    with _sessions_lock:
        if sid in _active_shell_sessions:
            return _active_shell_sessions[sid]
    try:
        rc = _get_redis_client()
        if rc:
            raw = rc.get(_redis_session_key(sid))
            if raw:
                data = _json.loads(raw)
                data.setdefault("lock", threading.Lock())
                with _sessions_lock:
                    _active_shell_sessions[sid] = data
                return data
    except Exception as exc:
        _session_logger.debug("[Shell] Redis session read failed: %s", exc)
    return None


def _session_list() -> list:
    """List all known session IDs (in-memory + Redis if reachable)."""
    with _sessions_lock:
        local_keys = set(_active_shell_sessions.keys())
    try:
        rc = _get_redis_client()
        if rc:
            pattern = "shell:session:*"
            redis_keys = {k.replace("shell:session:", "") for k in (rc.keys(pattern) or [])}
            return list(local_keys | redis_keys)
    except Exception:
        pass
    return list(local_keys)


def _session_del(sid: str) -> Optional[Dict[str, Any]]:
    """Remove a session from both in-memory and Redis."""
    with _sessions_lock:
        session = _active_shell_sessions.pop(sid, None)
    try:
        rc = _get_redis_client()
        if rc:
            rc.delete(_redis_session_key(sid))
    except Exception as exc:
        _session_logger.debug("[Shell] Redis session delete failed: %s", exc)
    return session


def _get_or_create_session(sid: str) -> Dict[str, Any]:
    existing = _session_get(sid)
    if existing is not None:
        return existing
    data: Dict[str, Any] = {
        "output": "",
        "command": "",
        "return_code": None,
        "lock": threading.Lock(),
    }
    _session_set(sid, data)
    return data


def _get_session(sid: str) -> Optional[Dict[str, Any]]:
    return _session_get(sid)


_stream_local = threading.local()

def set_stream_queue(q: Optional[queue.Queue]) -> None:
    """Register a streaming output queue for the current thread."""
    _stream_local.queue = q

def get_stream_queue() -> Optional[queue.Queue]:
    """Get the streaming output queue for the current thread."""
    return getattr(_stream_local, "queue", None)


def _shell_quote(s: str) -> str:
    return shlex.quote(s)


def _run_e2b(command: str, exec_dir: str = "", timeout: int = 90) -> Dict[str, Any]:
    """Execute command via E2B cloud sandbox. Auto-ensures workspace dir exists.
    Streams stdout/stderr to stream_queue if one is registered on the current thread.
    Uses run_command wrapper for consistent retry/guardrail behavior."""
    try:
        from server.agent.tools.e2b_sandbox import run_command, WORKSPACE_DIR, _detected_home
        effective_dir = exec_dir or _detected_home or WORKSPACE_DIR
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
    """Local execution is disabled. All commands MUST run in E2B sandbox."""
    return {
        "success": False,
        "stdout": "",
        "stderr": "Local execution is disabled. E2B_API_KEY is required for shell operations.",
        "exit_code": -1
    }


# Commands that require a graphical display (not available in cloud sandbox)
# These would hang forever if allowed to run — intercept and provide helpful error
# NOTE: E2B Desktop sandbox HAS a full desktop (XFCE4 + VNC), so GUI commands
# can actually run there. We only block them when there's no desktop available.
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
    "code", "code-insiders", "cursor",       # GUI code editors (VS Code, Cursor)
]

# Terminal-based editors that work fine in any terminal (NOT GUI commands)
_TERMINAL_EDITORS = ["nano", "vim", "nvim", "vi", "subl", "atom"]

def _is_gui_command(command: str) -> Optional[str]:
    """
    Check if the command is a GUI/display-dependent program that cannot run
    in a headless cloud sandbox. Returns the detected command name if GUI, else None.
    
    E2B Desktop sandbox has a full XFCE4 desktop with VNC, so GUI commands
    CAN run there. This check is skipped when E2B Desktop is active.
    """
    # E2B Desktop sandbox has a full graphical desktop — GUI commands work fine
    if _is_e2b_enabled():
        return None
    
    import shlex
    try:
        parts = shlex.split(command.strip())
    except Exception:
        parts = command.strip().split()
    if not parts:
        return None
    # Check base command name (without path)
    base = os.path.basename(parts[0]).lower()
    # Terminal editors are NOT GUI commands — they work in any terminal
    if base in _TERMINAL_EDITORS:
        return None
    for gui_cmd in _GUI_COMMANDS:
        if base == gui_cmd or base.startswith(gui_cmd + " "):
            return base
    # Also intercept "env VAR=val google-chrome ..." patterns
    for part in parts:
        base_part = os.path.basename(part).lower()
        if base_part in _TERMINAL_EDITORS:
            continue
        for gui_cmd in _GUI_COMMANDS:
            if base_part == gui_cmd:
                return base_part
    return None


def _sync_e2b_output_file(file_path: str) -> str:
    """
    Generate a proxy download URL for a file inside the E2B sandbox.
    No local disk copy — file is served directly from the sandbox via the download endpoint.
    Returns download_url string, or '' if sandbox is not available.
    """
    try:
        import urllib.parse
        from server.agent.tools.e2b_sandbox import get_sandbox

        sb = get_sandbox()
        if sb is None:
            return ""

        sandbox_id = getattr(sb, "sandbox_id", "") or os.environ.get("DZECK_E2B_SANDBOX_ID", "")
        if not sandbox_id:
            return ""

        filename = os.path.basename(file_path)
        encoded_sandbox_id = urllib.parse.quote(sandbox_id, safe="")
        encoded_path = urllib.parse.quote(file_path, safe="")
        encoded_name = urllib.parse.quote(filename, safe="")
        return f"/api/files/download?sandbox_id={encoded_sandbox_id}&path={encoded_path}&name={encoded_name}"
    except Exception:
        return ""


def _extract_output_paths_from_command(command: str) -> list:
    """Scan a shell command for output file paths in ~/output/ or /home/*/output/."""
    import re
    from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR
    home = _detected_home or WORKSPACE_DIR
    # Match paths under the detected home/output or any /home/user/output pattern
    patterns = [
        r"(" + re.escape(home) + r"/output/[\w.\-/]+)",
        r"((?:/home/[^/]+)/output/[\w.\-/]+)",
        r"(~/output/[\w.\-/]+)",
    ]
    paths = []
    for pat in patterns:
        paths.extend(re.findall(pat, command))
    unique = []
    seen = set()
    for p in paths:
        p = p.rstrip("/,;\"'")
        if p not in seen and "." in os.path.basename(p):
            unique.append(p)
            seen.add(p)
    return unique


def _preflight_requirements_file(command: str, exec_dir: str = "") -> Optional[str]:
    """Before executing `pip install -r <file>`, verify the requirements file exists in the sandbox.
    Returns an error message string if the file does not exist, or None if OK."""
    if not _is_e2b_enabled():
        return None
    import re as _re
    import shlex as _shlex
    from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR as _WS
    _fallback_dir = _detected_home or _WS
    match = _re.search(r'pip[3]?\s+install\s+(?:\S+\s+)*-r\s+(\S+)', command)
    if not match:
        return None
    req_file = match.group(1).strip("'\"")
    if not req_file.startswith("/"):
        req_file = os.path.normpath(os.path.join(exec_dir or _fallback_dir, req_file))
    try:
        from server.agent.tools.e2b_sandbox import get_sandbox as _get_sb
        sb = _get_sb()
        if sb is None:
            return None
        r = sb.commands.run(f"test -f {_shlex.quote(req_file)} && echo EXISTS", timeout=8)
        if r.exit_code == 0 and "EXISTS" in (r.stdout or ""):
            return None
        msg = (
            f"[Shell] Requirements file tidak ditemukan di sandbox: {req_file}\n\n"
            f"SOLUSI WAJIB — pilih salah satu:\n"
            f"  1. Buat file requirements.txt terlebih dahulu dengan file_write, lalu jalankan lagi:\n"
            f"     file_write(file='{req_file}', content='requests\\npandas\\n...')\n"
            f"  2. ATAU langsung install tanpa file (lebih aman):\n"
            f"     pip install --break-system-packages <paket1> <paket2> ...\n\n"
            f"JANGAN retry dengan perintah yang sama — file harus dibuat dulu."
        )
        return msg
    except Exception:
        return None


def _preflight_ensure_scripts(command: str, exec_dir: str = "") -> Optional[str]:
    """Before executing a python script command in E2B, ensure the script file exists in the sandbox.
    Returns an error message string if the file cannot be ensured, or None on success."""
    if not _is_e2b_enabled():
        return None
    import re
    match = re.search(r'python[3]?\s+(?:-\w+\s+)*([^\s;|&]+\.py)', command)
    if not match:
        return None
    script_path = match.group(1)
    try:
        from server.agent.tools.e2b_sandbox import ensure_file_in_sandbox, WORKSPACE_DIR, get_cached_file_path, _detected_home, _resolve_sandbox_path as _rsp2
        import os as _os
        _eff_dir = exec_dir or _detected_home or WORKSPACE_DIR
        # Handle tilde expansion first to avoid /home/user/~/path bugs
        if script_path.startswith("~/") or script_path == "~":
            resolved = _rsp2(script_path)
        elif not script_path.startswith("/"):
            resolved_exec = _os.path.normpath(_os.path.join(_eff_dir, script_path))
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
        if _is_e2b_enabled():
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
        if _is_e2b_enabled():
            from server.agent.tools.e2b_sandbox import write_file as _e2b_write
            return _e2b_write(script_path, content)
        else:
            return False  # E2B-only mode: no local file write
    except Exception:
        return False


def _validate_python_syntax(command: str, exec_dir: str = "") -> Optional[ToolResult]:
    """Pre-validate Python script syntax with up to 3 auto-fix attempts.
    Returns ToolResult on failure after all attempts, None on success.
    Distinguishes between 'file not found' and actual syntax errors."""
    import re as _re
    match = _re.search(r'python[3]?\s+(?:-\w+\s+)*([^\s;|&]+\.py)', command)
    if not match:
        return None
    script_path = match.group(1)

    # Resolve to absolute path: handle tilde expansion first, then relative paths
    from server.agent.tools.e2b_sandbox import WORKSPACE_DIR as _WS, _detected_home as _dh, _resolve_sandbox_path as _rsp
    # If path contains ~, resolve it via _resolve_sandbox_path to get correct absolute path
    # (avoids bug: os.path.join("/home/user", "~/output/file.py") → "/home/user/~/output/file.py")
    if script_path.startswith("~/") or script_path == "~":
        script_path = _rsp(script_path)
        _fallback_path = None
    elif not script_path.startswith("/"):
        _eff_dir = exec_dir or _dh or _WS
        candidate_exec = os.path.normpath(os.path.join(_eff_dir, script_path))
        candidate_ws   = os.path.normpath(os.path.join(_WS, script_path))
        # Prefer exec_dir path; we'll verify existence inside the loop
        script_path = candidate_exec
        _fallback_path = candidate_ws if candidate_ws != candidate_exec else None
    else:
        _fallback_path = None

    if not _is_e2b_enabled():
        return ToolResult(
            success=False,
            message="[Shell] E2B sandbox diperlukan untuk validasi syntax. Tidak ada local execution.",
            data={"error": "e2b_required", "command": command},
        )

    # ── Step 0: Quickly check if the file actually exists in E2B ─────────────
    def _check_file_exists_in_e2b(path: str) -> bool:
        try:
            import shlex as _shlex
            from server.agent.tools.e2b_sandbox import get_sandbox as _get_sb
            sb = _get_sb()
            if sb is None:
                return False
            r = sb.commands.run(f"test -f {_shlex.quote(path)} && echo EXISTS", timeout=8)
            return r.exit_code == 0 and "EXISTS" in (r.stdout or "")
        except Exception:
            return False

    resolved_path = script_path
    if not _check_file_exists_in_e2b(resolved_path):
        # Try fallback workspace path
        if _fallback_path and _check_file_exists_in_e2b(_fallback_path):
            resolved_path = _fallback_path
        else:
            # File truly does not exist — give a clear "write it first" error
            msg = (
                f"[Shell] File tidak ditemukan di sandbox: {resolved_path}\n\n"
                f"SOLUSI: Tulis file terlebih dahulu menggunakan file_write, kemudian jalankan lagi.\n"
                f"Contoh: file_write(file='{resolved_path}', content='...')"
            )
            return ToolResult(
                success=False,
                message=msg,
                data={"stdout": "", "stderr": msg, "return_code": 1,
                      "command": command, "error": "file_not_found",
                      "script_path": resolved_path},
            )

    max_attempts = 3
    last_stderr = ""

    for attempt in range(1, max_attempts + 1):
        compile_cmd = f"python3 -m py_compile {resolved_path}"
        res = _run_e2b(compile_cmd, exec_dir=exec_dir, timeout=30)

        if res.get("success", False) or res.get("exit_code", -1) == 0:
            if attempt > 1:
                import logging
                logging.getLogger(__name__).info(
                    "[Shell] Python syntax fixed on attempt %d for %s", attempt, resolved_path)
            return None

        last_stderr = res.get("stderr", "") or res.get("stdout", "")

        # If py_compile itself says "No such file" → file disappeared mid-check
        if "No such file or directory" in last_stderr or "errno 2" in last_stderr.lower():
            msg = (
                f"[Shell] File hilang dari sandbox saat validasi: {resolved_path}\n"
                f"Kemungkinan sandbox di-reset. Tulis ulang file dengan file_write lalu coba lagi."
            )
            return ToolResult(
                success=False,
                message=msg,
                data={"stdout": "", "stderr": last_stderr, "return_code": 1,
                      "command": command, "error": "file_disappeared",
                      "script_path": resolved_path},
            )

        if attempt < max_attempts:
            fixed = _auto_fix_python_syntax(resolved_path, last_stderr, exec_dir)
            if not fixed:
                break

    msg = (
        f"[Shell] Python syntax validation FAILED for {resolved_path} "
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
              "script_path": resolved_path, "attempts": attempt},
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


_PROTECTED_SYSTEM_DIRS = [
    "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc",
    "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var",
]

def _check_system_dir_deletion(command: str) -> Optional[str]:
    """Block rm -rf commands targeting system directories outside the sandbox home."""
    import re
    from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR
    safe_home = _detected_home or WORKSPACE_DIR
    pattern = r'\brm\s+(?:-[\w]+\s+)*(-rf?|-fr?)\s+([\S]+)'
    for match in re.finditer(pattern, command):
        target = match.group(2).rstrip("/")
        if not target.startswith(safe_home) and not target.startswith("/home/") and not target.startswith("/tmp/dzeck"):
            for sys_dir in _PROTECTED_SYSTEM_DIRS:
                if target == sys_dir or target.startswith(sys_dir + "/"):
                    return (
                        f"[Shell] BLOCKED: Attempted to delete protected system directory '{target}'. "
                        f"Only paths under {safe_home} are allowed for deletion. "
                        f"Refusing to execute this command."
                    )
    return None


def _validate_exec_dir_writable(exec_dir: str) -> Optional[str]:
    """Validate that exec_dir is writable in the sandbox. Returns error message or None if ok.
    Uses _resolve_workdir (same resolver as run_command) to canonicalize the path,
    then does a quick test -w check in E2B to detect permission problems early."""
    try:
        from server.agent.tools.e2b_sandbox import get_sandbox, _detected_home, WORKSPACE_DIR, _resolve_workdir
        sb = get_sandbox()
        if sb is None:
            return None  # Let run_command handle the no-sandbox case
        import shlex as _shlex
        # Resolve path using same logic as run_command (handles ~, $HOME, relative paths)
        canonical_dir = _resolve_workdir(exec_dir)
        # First ensure the directory exists
        sb.commands.run(
            f"mkdir -p {_shlex.quote(canonical_dir)} 2>/dev/null || true",
            timeout=8
        )
        # Then check writability against the canonicalized path
        r = sb.commands.run(
            f"test -d {_shlex.quote(canonical_dir)} && test -w {_shlex.quote(canonical_dir)} && echo WRITABLE || echo NOT_WRITABLE",
            timeout=8
        )
        out = (r.stdout or "").strip()
        if "NOT_WRITABLE" in out:
            safe_home = _detected_home or WORKSPACE_DIR
            return (
                f"[Shell] Direktori exec_dir '{canonical_dir}' tidak writable di sandbox. "
                f"Gunakan exec_dir=\"\" (otomatis ke {safe_home}) atau exec_dir=\"~/subfolder\"."
            )
    except Exception:
        pass  # Don't block execution on validation failure
    return None


def shell_exec(command: str, exec_dir: str = "", id: str = "default") -> ToolResult:
    """Execute a shell command. Uses E2B cloud sandbox when available, refuses local execution."""
    from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR
    exec_dir = exec_dir or _detected_home or WORKSPACE_DIR
    # Dynamic check — re-reads env in case secret was set after module import
    global E2B_ENABLED
    E2B_ENABLED = _is_e2b_enabled()

    gui_detected = _is_gui_command(command)
    if gui_detected:
        _editor_cmds = {"code", "code-insiders", "cursor", "subl", "atom", "nano", "vim", "nvim", "vi"}
        _base_cmd = os.path.basename(command.strip().split()[0]).lower() if command.strip() else ""
        if _base_cmd in _editor_cmds:
            msg = (
                f"[Shell] Command '{gui_detected}' is a GUI/interactive text editor not available in the sandbox.\n\n"
                f"SOLUTION: Gunakan file tools untuk membaca dan menulis file:\n"
                f"  - file_write(file='~/path/to/file.py', content='...')  ← tulis file\n"
                f"  - file_read(file='~/path/to/file.py')                  ← baca file\n"
                f"  - file_str_replace(file='...', old_str='...', new_str='...')      ← edit file\n\n"
                f"Jangan pernah menggunakan editor interaktif (nano, vim, code) — selalu gunakan file_write."
            )
        else:
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

    sys_del_err = _check_system_dir_deletion(command)
    if sys_del_err:
        return ToolResult(
            success=False,
            message=sys_del_err,
            data={"stdout": "", "stderr": sys_del_err, "return_code": 1,
                  "command": command, "id": id, "error": "system_dir_deletion_blocked"},
        )

    blocked = _check_repeated_command_prerun(command)
    if blocked:
        return blocked

    if not _is_e2b_enabled():
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

    # Validate CWD writability before execution — catches permission/path issues early
    writable_err = _validate_exec_dir_writable(exec_dir)
    if writable_err:
        return ToolResult(
            success=False,
            message=writable_err,
            data={"stdout": "", "stderr": writable_err, "return_code": 1,
                  "command": command, "id": id, "error": "exec_dir_not_writable"},
        )

    req_err = _preflight_requirements_file(command, exec_dir=exec_dir)
    if req_err:
        return ToolResult(
            success=False,
            message=req_err,
            data={"stdout": "", "stderr": req_err, "return_code": 1,
                  "command": command, "id": id, "error": "requirements_file_not_found"},
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
    _session_set(id, sess)

    backend = "E2B"

    synced_files = []
    if _is_e2b_enabled() and res.get("success", False):
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
        available = _session_list()
        if len(available) == 1:
            fallback_id = available[0]
            session = _get_session(fallback_id)
            if session:
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
        available = _session_list()
        if len(available) == 1:
            fallback_id = available[0]
            session = _get_session(fallback_id)
            if session:
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
        if not _is_e2b_enabled():
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
        _session_set(id, session)
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
    session = _session_del(id)
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
            "exec_dir": {"type": "string", "description": "Working directory for command execution. Use empty string '' for home directory (recommended). Use '~/subdir' for subdirectories. Never hardcode absolute home directory paths."},
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
