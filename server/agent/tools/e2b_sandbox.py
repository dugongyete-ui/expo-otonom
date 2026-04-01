"""
E2B Desktop Sandbox Manager for Dzeck AI Agent.
Provides a persistent, isolated cloud desktop sandbox with VNC for shell, browser,
and GUI automation. All tool calls (shell, browser, file, GUI) are routed through
this single unified E2B Desktop environment.

Key change: Uses e2b_desktop.Sandbox instead of e2b.Sandbox so that ALL operations
(shell, file, browser, VNC desktop) run in ONE sandbox. The browser launched inside
this sandbox is visible on the VNC desktop, enabling real GUI interaction
(clicking, scrolling, browsing) — not just display.

Architecture (matching ai-manus pattern):
  - Single sandbox instance for everything (like ai-manus's single Docker container)
  - VNC stream URL exposed for frontend to connect
  - Browser runs visibly on the desktop (DISPLAY is set)
  - All tools operate on the same environment

SDK API (e2b-desktop ^2.3.0) — all options use snake_case:
  Sandbox.create(api_key=..., timeout=<seconds>, resolution=(w, h))
  sandbox.commands.run(cmd, timeout=<seconds>)  -> result.exit_code (not exitCode)
  sandbox.stream.start(require_auth=False)       # not requireAuth
  sandbox.stream.get_url(auto_connect=True, view_only=False, resize="scale")
  Sandbox.connect(sandbox_id, api_key=...)
"""
import os
import json
import logging
import threading
import base64
import time
from typing import Optional, Any, Dict

logger = logging.getLogger(__name__)

_E2B_API_KEY_AT_IMPORT = os.environ.get("E2B_API_KEY", "")
E2B_API_KEY = _E2B_API_KEY_AT_IMPORT

# MIME type map for E2B sandbox files (used when generating proxy download URLs)
_MIME_MAP_E2B: dict = {
    ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
    ".csv": "text/csv", ".tsv": "text/tab-separated-values",
    ".json": "application/json", ".jsonl": "application/json",
    ".html": "text/html", ".htm": "text/html", ".xml": "application/xml",
    ".js": "application/javascript", ".mjs": "application/javascript",
    ".ts": "application/typescript", ".tsx": "application/typescript",
    ".py": "text/x-python", ".ipynb": "application/x-ipynb+json",
    ".sql": "text/x-sql", ".sh": "application/x-sh", ".bash": "application/x-sh",
    ".yaml": "text/yaml", ".yml": "text/yaml", ".toml": "text/plain",
    ".svg": "image/svg+xml", ".css": "text/css",
    ".r": "text/plain", ".R": "text/plain",
    ".go": "text/plain", ".rs": "text/plain", ".java": "text/plain",
    ".cpp": "text/plain", ".c": "text/plain", ".h": "text/plain",
    ".rb": "text/plain", ".php": "text/plain", ".kt": "text/plain",
    ".swift": "text/plain", ".dart": "text/plain",
    ".ini": "text/plain", ".cfg": "text/plain", ".conf": "text/plain",
    ".env": "text/plain", ".log": "text/plain",
    ".zip": "application/zip", ".tar": "application/x-tar",
    ".gz": "application/gzip", ".bz2": "application/x-bzip2",
    ".7z": "application/x-7z-compressed", ".rar": "application/x-rar-compressed",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".rtf": "application/rtf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".ico": "image/x-icon", ".tiff": "image/tiff", ".tif": "image/tiff",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
    ".mov": "video/quicktime", ".webm": "video/webm",
    ".parquet": "application/octet-stream", ".feather": "application/octet-stream",
    ".pkl": "application/octet-stream", ".pickle": "application/octet-stream",
    ".npy": "application/octet-stream", ".npz": "application/octet-stream",
    ".db": "application/octet-stream", ".sqlite": "application/octet-stream",
    ".bin": "application/octet-stream",
}


def _get_api_key() -> str:
    """Re-read E2B_API_KEY from env each time — handles late-set secrets."""
    key = os.environ.get("E2B_API_KEY", "") or _E2B_API_KEY_AT_IMPORT
    if key:
        # Also update the module-level variable so functions using it directly work
        global E2B_API_KEY
        E2B_API_KEY = key
    return key

_sandbox_lock = threading.Lock()
_sandbox: Optional[Any] = None
_sandbox_create_attempts = 0
_MAX_CREATE_ATTEMPTS = 3

WORKSPACE_DIR = "/home/user"
OUTPUT_DIR = "/home/user/output"

# Runtime-detected actual home directory (populated once the sandbox is alive)
_detected_home: Optional[str] = None


def _detect_sandbox_home(sb: Any) -> str:
    """Detect the actual writable home directory inside the sandbox.
    Uses `cd && pwd` (resolves to real cwd, not just $HOME env var) as the
    primary method so we get the directory the process can actually write to.
    Falls back through several candidates before giving up with WORKSPACE_DIR.
    Also ensures ~/.dzeck_browser_scripts is on PATH via ~/.bashrc."""
    global _detected_home
    if _detected_home:
        return _detected_home

    candidates_to_try: list = []

    # Strategy 1: `cd && pwd` — change to tilde, print real current directory
    # This resolves symlinks and reflects the actual writable home for the process user.
    try:
        result = sb.commands.run("cd && pwd", timeout=8)
        home = (result.stdout or "").strip()
        if home and home.startswith("/") and home != "/":
            candidates_to_try.append(home)
    except Exception:
        pass

    # Strategy 2: python3 expanduser — most reliable cross-user resolution
    try:
        result = sb.commands.run(
            "python3 -c \"import os; print(os.path.expanduser('~'))\"",
            timeout=8,
        )
        home = (result.stdout or "").strip()
        if home and home.startswith("/") and home != "/" and home not in candidates_to_try:
            candidates_to_try.append(home)
    except Exception:
        pass

    # Strategy 3: $HOME env var (may differ from real dir but worth checking)
    try:
        result = sb.commands.run("echo $HOME", timeout=8)
        home = (result.stdout or "").strip()
        if home and home.startswith("/") and home != "/" and home not in candidates_to_try:
            candidates_to_try.append(home)
    except Exception:
        pass

    # Also add well-known E2B default directories as fallback candidates
    for default_dir in [WORKSPACE_DIR, "/root", "/tmp/dzeck_home"]:
        if default_dir not in candidates_to_try:
            candidates_to_try.append(default_dir)

    # Test each candidate — use the first one where we can actually write a test file
    for home in candidates_to_try:
        try:
            test_result = sb.commands.run(
                f"mkdir -p {home} 2>/dev/null; "
                f"touch {home}/.dzeck_probe 2>/dev/null && "
                f"rm -f {home}/.dzeck_probe && echo ok",
                timeout=8,
            )
            if "ok" in (test_result.stdout or ""):
                _detected_home = home
                # Ensure browser scripts dir is on PATH (idempotent via grep guard)
                scripts_dir = f"{home}/.dzeck_browser_scripts"
                try:
                    sb.commands.run(
                        f"grep -qF '{scripts_dir}' {home}/.bashrc 2>/dev/null || "
                        f"echo 'export PATH=\"{scripts_dir}:$PATH\"' >> {home}/.bashrc",
                        timeout=8,
                    )
                except Exception:
                    pass
                logger.info("[E2B] Detected writable sandbox home: %s", home)
                return home
        except Exception:
            continue

    # All detection failed — use WORKSPACE_DIR and try to create it
    try:
        sb.commands.run(f"mkdir -p {WORKSPACE_DIR}", timeout=8)
    except Exception:
        pass
    logger.warning("[E2B] Could not detect sandbox home dir, using default: %s", WORKSPACE_DIR)
    return WORKSPACE_DIR


def _get_workspace_dir(sb: Any = None) -> str:
    """Return the best workspace directory: detected sandbox home or module default."""
    if _detected_home:
        return _detected_home
    if sb is not None:
        return _detect_sandbox_home(sb)
    return WORKSPACE_DIR


def get_session_workspace() -> str:
    """Return per-session workspace dir: <home>/<session_id>/
    Falls back to WORKSPACE_DIR if no session is set."""
    base = _detected_home or WORKSPACE_DIR
    session_id = os.environ.get("DZECK_SESSION_ID", "")
    if session_id:
        safe_id = "".join(c for c in session_id if c.isalnum() or c in "-_")[:32]
        return os.path.join(base, safe_id)
    return base


_file_cache_lock = threading.Lock()
_file_cache: Dict[str, str] = {}


def _cache_file(path: str, content: str) -> None:
    with _file_cache_lock:
        _file_cache[path] = content


def _replay_file_cache(sb: Any) -> None:
    with _file_cache_lock:
        if not _file_cache:
            return
        logger.info("[E2B] Replaying %d cached files to new sandbox...", len(_file_cache))
        for path, content in _file_cache.items():
            try:
                import shlex
                parent = "/".join(path.split("/")[:-1])
                if parent:
                    sb.commands.run(f"mkdir -p {shlex.quote(parent)}", timeout=10)
                sb.files.write(path, content)
            except Exception as e:
                logger.warning("[E2B] Failed to replay cached file %s: %s", path, e)


def clear_file_cache() -> None:
    with _file_cache_lock:
        _file_cache.clear()
    logger.info("[E2B] File cache cleared.")


def get_cached_file_path(filepath: str) -> Optional[str]:
    """Check if a file path (or its resolved variant) exists in the file cache.
    Returns the matching cache key if found, or None."""
    resolved = _resolve_sandbox_path(filepath) if not filepath.startswith("/") else os.path.normpath(filepath)
    with _file_cache_lock:
        if resolved in _file_cache:
            return resolved
        for key in _file_cache:
            if os.path.normpath(key) == resolved:
                return key
    return None


def _is_sandbox_alive(sb: Any) -> bool:
    """Quick health check for the sandbox.
    Returns False if the sandbox has expired or is unreachable."""
    try:
        result = sb.commands.run("echo alive", timeout=8)
        return result.exit_code == 0 and "alive" in (result.stdout or "")
    except Exception as e:
        err_str = str(e).lower()
        if any(kw in err_str for kw in ("not found", "404", "sandbox not found", "expired", "does not exist")):
            logger.warning("[E2B] Sandbox has expired or been deleted: %s", e)
        else:
            logger.debug("[E2B] Sandbox health check failed: %s", e)
        return False


def _connect_existing_sandbox(sandbox_id: str, max_retries: int = 3) -> Optional[Any]:
    """Connect to an existing E2B sandbox by sandbox_id (created by TS).
    Uses Sandbox.connect() so the Python agent works in the SAME sandbox the user sees.
    Retries up to max_retries times with exponential backoff."""
    api_key = _get_api_key()
    if not api_key:
        logger.error("[E2B] Cannot connect to sandbox: E2B_API_KEY not set.")
        return None
    for attempt in range(1, max_retries + 1):
        try:
            from e2b_desktop import Sandbox
            logger.info("[E2B] Connecting to existing sandbox %s (attempt %d/%d)...", sandbox_id, attempt, max_retries)
            sb = Sandbox.connect(sandbox_id, api_key=api_key)
            logger.info("[E2B] Successfully connected to sandbox %s", sandbox_id)
            # Detect actual home directory in this sandbox
            home_dir = _detect_sandbox_home(sb)
            # Auto-create essential directories so file_write and shell tools work without errors
            try:
                import shlex as _shlex
                output_dir = f"{home_dir}/output"
                sb.commands.run(
                    f"mkdir -p {_shlex.quote(output_dir)} {_shlex.quote(home_dir + '/Downloads')} "
                    f"{_shlex.quote(home_dir + '/upload')} {_shlex.quote(home_dir + '/skills')} "
                    f"/tmp/dzeck_output 2>/dev/null || true",
                    timeout=10,
                )
                logger.info("[E2B] Essential directories created in connected sandbox.")
            except Exception as _dir_err:
                logger.warning("[E2B] Failed to create dirs in connected sandbox: %s", _dir_err)
            # Try to get the VNC stream URL for this sandbox.
            # After Sandbox.connect() the internal SDK stream state may not be initialized
            # (the TS server already started streaming, so the sandbox is live).
            # Try the SDK methods first; fall back to constructing the URL from sandbox_id
            # using the standard E2B URL pattern (6080-{id}.e2b.app).
            global _vnc_stream_url
            try:
                try:
                    sb.stream.start(require_auth=False)
                    logger.info("[E2B] VNC stream (re-)started on connected sandbox %s", sandbox_id)
                except Exception as start_err:
                    logger.debug("[E2B] stream.start() on connected sandbox: %s", start_err)
                vnc_url = sb.stream.get_url(auto_connect=True, view_only=False, resize="scale")
                _vnc_stream_url = vnc_url
                logger.info("[E2B] VNC stream URL from connected sandbox: %s", vnc_url)
            except Exception:
                # SDK stream methods unavailable after Sandbox.connect() — use the URL that
                # the TypeScript server passed via DZECK_VNC_STREAM_URL env var (set in routes.ts
                # from preLaunchStreamUrl). This is more reliable than constructing a URL from
                # the sandbox ID because the TS server got the URL directly from the E2B SDK.
                ts_vnc_url = os.environ.get("DZECK_VNC_STREAM_URL", "").strip()
                if ts_vnc_url:
                    _vnc_stream_url = ts_vnc_url
                    logger.info("[E2B] Using TS-provided VNC URL for connected sandbox: %s", ts_vnc_url)
                else:
                    # Last resort: construct from sandbox ID (may not always be correct)
                    fallback_url = (
                        f"https://6080-{sandbox_id}.e2b.app"
                        f"/vnc.html?autoconnect=true&resize=scale"
                    )
                    _vnc_stream_url = fallback_url
                    logger.info("[E2B] Using constructed VNC URL for connected sandbox: %s", fallback_url)

            # Push config files in background — same as _create_sandbox does.
            # Replay file cache so any files written before connect are available.
            _replay_file_cache(sb)
            def _bg_push_connected():
                try:
                    _push_sandbox_configs(sb)
                except Exception as _bg_exc:
                    logger.warning("[E2B] Background config push error (connected sandbox): %s", _bg_exc)
            threading.Thread(target=_bg_push_connected, daemon=True).start()
            logger.info("[E2B] Config push started in background for connected sandbox %s.", sandbox_id)

            return sb
        except Exception as e:
            logger.error("[E2B] Failed to connect to existing sandbox %s (attempt %d): %s", sandbox_id, attempt, e)
            if attempt < max_retries:
                delay = min(2 ** attempt, 8)
                logger.info("[E2B] Retrying sandbox connect in %ds...", delay)
                time.sleep(delay)
    logger.error("[E2B] All %d connect attempts to sandbox %s failed.", max_retries, sandbox_id)
    return None


def get_sandbox() -> Optional[Any]:
    """Get or create the E2B sandbox singleton, with auto-recovery and deduplication.

    Deduplication strategy (prevents running two separate E2B sandboxes):
      1. If _sandbox is already set and alive → reuse it (fast path).
      2. If DZECK_E2B_SANDBOX_ID env var is set → connect to the sandbox the
         TypeScript server created (Sandbox.connect(id)), so both TS and Python
         share the SAME sandbox and the user sees actions on the VNC desktop.
      3. If connect fails → create a new sandbox and emit its ID to TS via stdout
         so the frontend's VNC view stays in sync.
      4. If no env var → create a fresh sandbox (dev/local mode).
    """
    global _sandbox
    if _sandbox is not None:
        if _is_sandbox_alive(_sandbox):
            # Eagerly detect home directory if not yet done (handles reconnect case)
            if _detected_home is None:
                _detect_sandbox_home(_sandbox)
            return _sandbox
        logger.warning("[E2B] Sandbox health check failed, recreating...")
        try:
            _sandbox.kill()
        except Exception:
            pass
        _sandbox = None

    with _sandbox_lock:
        if _sandbox is None:
            # Check if TypeScript server has already created a sandbox for us to reuse
            existing_sandbox_id = os.environ.get("DZECK_E2B_SANDBOX_ID", "").strip()
            if existing_sandbox_id:
                logger.info(
                    "[E2B] DZECK_E2B_SANDBOX_ID=%s found — reusing TS sandbox (no duplication)",
                    existing_sandbox_id,
                )
                _sandbox = _connect_existing_sandbox(existing_sandbox_id)
                if _sandbox is None:
                    # TS created the sandbox and passed DZECK_E2B_SANDBOX_ID — if we cannot
                    # connect, do NOT silently create a new sandbox. That would cause a
                    # VNC/sandbox split-brain (user sees TS sandbox, agent runs in a different
                    # one). Emit a clear error event instead so the frontend shows the issue.
                    err_msg = (
                        "E2B sandbox '{}' created by server is not reachable after {} attempts. "
                        "The sandbox may have expired or been deleted. "
                        "Please start a new session to continue.".format(existing_sandbox_id, 3)
                    )
                    logger.error("[E2B] %s", err_msg)
                    import sys as _sys
                    _sys.stdout.write(json.dumps({
                        "type": "error",
                        "error": err_msg,
                        "sandbox_id": existing_sandbox_id,
                        "fatal": True,
                    }) + "\n")
                    _sys.stdout.flush()
                    # Return None so callers get a clear "sandbox unavailable" error
                    # from their own error handling path (run_command returns error dict etc.)
                else:
                    logger.info(
                        "[E2B] Successfully connected to existing TS sandbox %s — sharing same desktop.",
                        existing_sandbox_id,
                    )
            else:
                logger.info("[E2B] No DZECK_E2B_SANDBOX_ID set — creating new sandbox (dev/local mode).")
                _sandbox = _create_sandbox()
    return _sandbox


_configs_pushed_sandboxes: set = set()


def _push_sandbox_configs(sb: Any) -> None:
    """Push all config files from server/agent/config_manus_sandbox/ into the E2B sandbox.
    This applies Manus-standard skills, Chromium policies, and other configs.
    Idempotent: skips push if already done for this sandbox instance."""
    import hashlib as _hashlib
    import pathlib
    import shlex as _shlex

    # Idempotency guard: skip if already successfully pushed for this sandbox.
    # Note: the sandbox ID is only added to the set AFTER a successful push
    # (see end of function), so failed/partial pushes will be retried.
    sb_id = getattr(sb, "sandbox_id", None) or id(sb)
    if sb_id in _configs_pushed_sandboxes:
        logger.debug("[E2B] Config push already done for sandbox %s, skipping.", sb_id)
        return

    config_root = pathlib.Path(__file__).parent.parent / "config_manus_sandbox"
    if not config_root.exists():
        logger.warning("[E2B] config_manus_sandbox dir not found, skipping config push.")
        return

    # Runtime dirs and files that should NOT be pushed as config
    _SKIP_TOP_DIRS = {"terminal_full_output", "upload", "Agent-Auto"}
    _SKIP_FILES = {"sandbox.txt"}

    # etc/ subdirectories that are large, system-managed, and wasteful to push
    # (e.g. SSL certs: E2B already has its own CA bundle, ~295 files = ~590 API calls)
    _SKIP_ETC_SUBDIRS = {"ssl", "java-11-openjdk", "ca-certificates"}

    # Special system files/paths that cannot be written to (virtual/proc-backed or read-only)
    _SKIP_DEST_PATHS = {
        "/etc/mtab",       # symlink to /proc/self/mounts, not writable
        "/etc/resolv.conf", # managed by the sandbox network stack
    }

    pushed = 0
    failed = 0
    for src in config_root.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(config_root)
        parts = rel.parts

        # Skip runtime directories and files
        if parts[0] in _SKIP_TOP_DIRS:
            continue
        # For paths under home/ubuntu/, skip runtime subdirs precisely
        if len(parts) >= 3 and parts[0] == "home" and parts[2] in _SKIP_TOP_DIRS:
            continue
        if parts[-1] in _SKIP_FILES:
            continue

        # Skip large system-managed etc/ subdirs (SSL certs, java cacerts, etc.)
        # E2B already has its own CA bundle; pushing ~295 SSL files wastes ~590 API calls
        if parts[0] == "etc" and len(parts) >= 2 and parts[1] in _SKIP_ETC_SUBDIRS:
            continue

        # config_manus_sandbox/ already uses real filesystem structure (home/, etc/, usr/, var/)
        # Remap home/ubuntu/ or home/user/ to the actual detected home directory.
        actual_home = _detected_home or WORKSPACE_DIR
        if parts[0] == "home" and len(parts) >= 2:
            # Strip the hardcoded user dir (ubuntu, user, etc.) and replace with actual home
            # e.g. home/ubuntu/.bashrc → /home/user/.bashrc (if actual_home = /home/user)
            remaining = parts[2:]  # skip "home" and username parts
            dest = actual_home + ("/" + "/".join(remaining) if remaining else "")
        else:
            dest = "/" + "/".join(parts)

        # Skip special system files that cannot be overwritten
        if dest in _SKIP_DEST_PATHS:
            continue

        try:
            raw_bytes = src.read_bytes()
            parent = dest.rsplit("/", 1)[0]
            needs_sudo = dest.startswith("/etc/") or dest.startswith("/usr/") or dest.startswith("/opt/") or dest.startswith("/var/")
            if needs_sudo:
                # E2B sandbox does not allow sudo shell execution (fork/exec /bin/sh: permission denied).
                # Skip all system-owned paths silently — they are pre-configured in the E2B template.
                continue
            else:
                sb.commands.run(f"mkdir -p {_shlex.quote(parent)}", timeout=10)
                sb.files.write(dest, raw_bytes)
            pushed += 1
        except Exception as exc:
            logger.warning("[E2B] Config push failed for %s → %s: %s", src.name, dest, exc)
            failed += 1

    logger.info("[E2B] Config push complete: %d pushed, %d failed.", pushed, failed)

    # Ensure browser scripts are executable (chmod +x)
    home = _detected_home or WORKSPACE_DIR
    scripts_dir = f"{home}/.dzeck_browser_scripts"
    try:
        sb.commands.run(
            f"chmod +x {scripts_dir}/* 2>/dev/null || true",
            timeout=10
        )
    except Exception:
        pass

    # Mark idempotency only when all files pushed with zero failures.
    # Partial failures allow the next call to retry the full push.
    if failed == 0:
        _configs_pushed_sandboxes.add(sb_id)


# VNC stream URL storage — set after sandbox creation with desktop streaming
_vnc_stream_url: Optional[str] = None


def get_vnc_stream_url() -> Optional[str]:
    """Get the VNC stream URL for the current desktop sandbox.
    Returns None if sandbox is not created or stream not started."""
    return _vnc_stream_url


def _create_sandbox() -> Optional[Any]:
    """Create a new E2B Desktop sandbox instance with retry logic.
    Uses e2b_desktop.Sandbox to get a unified sandbox with VNC + shell + files."""
    global _sandbox_create_attempts, _vnc_stream_url
    api_key = _get_api_key()
    if not api_key:
        logger.error("[E2B] E2B_API_KEY not set. Cannot create sandbox. "
                     "Set E2B_API_KEY in Replit Secrets then restart the backend.")
        return None

    for attempt in range(1, _MAX_CREATE_ATTEMPTS + 1):
        try:
            from e2b_desktop import Sandbox
            logger.info("[E2B-Desktop] Creating new desktop sandbox (attempt %d/%d) with API key (%d chars)...",
                        attempt, _MAX_CREATE_ATTEMPTS, len(api_key))
            sb = Sandbox.create(api_key=api_key, timeout=3600, resolution=(1280, 720))
            logger.info("[E2B-Desktop] Desktop sandbox ready (id=%s). Setting up workspace...", sb.sandbox_id)

            # Start VNC streaming so the desktop is accessible.
            # Failures are logged as errors and propagated to _vnc_stream_url = None
            # so callers can detect that VNC is unavailable (no silent success assumed).
            _vnc_stream_url = None
            try:
                sb.stream.start(require_auth=False)
                logger.info("[E2B-Desktop] VNC stream started successfully.")
                try:
                    vnc_url = sb.stream.get_url(
                        auto_connect=True,
                        view_only=False,
                        resize="scale",
                    )
                    _vnc_stream_url = vnc_url
                    logger.info("[E2B-Desktop] VNC stream URL: %s", vnc_url)
                except Exception as vnc_err:
                    logger.error("[E2B-Desktop] stream.get_url() failed — VNC unavailable: %s", vnc_err)
            except Exception as stream_start_err:
                logger.error("[E2B-Desktop] stream.start() failed — VNC unavailable: %s", stream_start_err)

            # Detect actual home directory before creating workspace dirs
            home_dir = _detect_sandbox_home(sb)
            output_dir = f"{home_dir}/output"
            session_ws = get_session_workspace()
            sb.commands.run(
                f"mkdir -p {home_dir} 2>/dev/null || true && "
                f"mkdir -p {output_dir} /tmp/dzeck_output "
                f"{home_dir}/skills {home_dir}/Downloads {home_dir}/upload && "
                f"([ -n '{session_ws}' ] && mkdir -p {session_ws} 2>/dev/null || true) && "
                f"echo 'sandbox_ready=true\\nworkspace={home_dir}\\noutput={output_dir}' > {home_dir}/sandbox.txt 2>/dev/null || true && "
                f"echo 'export PS1=\"user@sandbox:~\\$ \"' >> ~/.bashrc && "
                f"echo 'export PS1=\"user@sandbox:~\\$ \"' >> ~/.profile && "
                f"echo 'workspace ready'",
                timeout=20
            )

            # E2B Desktop template already has Chrome/Chromium pre-installed on XFCE4.
            # Only install minimal Python packages actually needed — skip playwright/chromium
            # install (takes 6-11 min) since we control the existing browser via xdotool/xdg-open.
            sb.commands.run(
                "pip install --quiet --break-system-packages "
                "requests beautifulsoup4 lxml 2>/dev/null || true",
                timeout=60
            )
            try:
                sb.set_timeout(3600)
            except Exception:
                pass

            # Ensure xdotool, wmctrl, scrot are available for browser control
            sb.commands.run(
                "which xdotool >/dev/null 2>&1 || "
                "(apt-get install -y -q xdotool wmctrl scrot 2>/dev/null || true)",
                timeout=30
            )
            try:
                sb.set_timeout(3600)
            except Exception:
                pass

            sb.commands.run(
                "which python3 && python3 --version && echo 'python ok'",
                timeout=10
            )

            _replay_file_cache(sb)

            # Push config files in a background thread so the sandbox is immediately
            # usable for the first user command. Config push (skills, Chromium policies,
            # etc.) is non-critical for initial responsiveness.
            def _bg_push():
                try:
                    _push_sandbox_configs(sb)
                except Exception as _bg_exc:
                    logger.warning("[E2B] Background config push error: %s", _bg_exc)
            threading.Thread(target=_bg_push, daemon=True).start()
            logger.info("[E2B] Config push started in background — sandbox ready for first command.")

            # ── T6: Pre-launch Chrome with CDP port so browser.py can connect immediately ──
            # This prevents the CDP race condition where browser.py tries to connect before
            # Chrome is ready. Chrome is launched here with the required flags and we verify
            # the CDP port is accepting connections before marking the sandbox as ready.
            _cdp_port = 9222
            _chrome_launch_cmd = (
                f"DISPLAY=:0 nohup bash -c '"
                f"for b in google-chrome chromium chromium-browser; do "
                f"  which $b >/dev/null 2>&1 && "
                f"  $b --no-sandbox --disable-dev-shm-usage --remote-debugging-port={_cdp_port} "
                f"  --disable-gpu --disable-software-rasterizer about:blank "
                f"  >/dev/null 2>&1 & break; done' "
                f">/dev/null 2>&1 &"
            )
            try:
                sb.commands.run(_chrome_launch_cmd, timeout=10)
                # Poll CDP endpoint until ready (max 30s = 10 × 3s)
                _cdp_ready = False
                for _attempt in range(10):
                    try:
                        _cdp_result = sb.commands.run(
                            f"curl -s --max-time 2 http://localhost:{_cdp_port}/json/version",
                            timeout=5,
                        )
                        _cdp_out = getattr(_cdp_result, "stdout", "") or str(_cdp_result)
                        if '"Browser"' in _cdp_out or '"webSocketDebuggerUrl"' in _cdp_out:
                            _cdp_ready = True
                            logger.info("[E2B] Chrome CDP ready on port %s (attempt %d)", _cdp_port, _attempt + 1)
                            break
                    except Exception:
                        pass
                    time.sleep(3)
                if not _cdp_ready:
                    logger.warning("[E2B] Chrome CDP not confirmed ready — browser.py will retry on first use")
            except Exception as _chrome_err:
                logger.warning("[E2B] Chrome pre-launch failed (browser.py will handle): %s", _chrome_err)

            logger.info("[E2B-Desktop] Desktop workspace ready (id=%s, vnc=%s)", sb.sandbox_id, bool(_vnc_stream_url))
            _sandbox_create_attempts = 0

            # Always emit sandbox_ready event to stdout so TypeScript can sync state.
            # Include vnc_url if available (may be null if VNC stream start failed).
            import sys as _sys
            _sys.stdout.write(json.dumps({
                "type": "vnc_stream_url",
                "vnc_url": _vnc_stream_url,
                "sandbox_id": sb.sandbox_id,
                "reason": "new_sandbox_created",
            }) + "\n")
            _sys.stdout.flush()
            return sb
        except Exception as e:
            import traceback
            logger.error("[E2B-Desktop] Failed to create sandbox (attempt %d): %s", attempt, e)
            logger.error("[E2B-Desktop] Traceback: %s", traceback.format_exc())
            # Emit error as JSON to stdout so the frontend can display it
            import sys as _sys
            _sys.stdout.write(json.dumps({
                "type": "e2b_error",
                "error": f"E2B sandbox creation failed (attempt {attempt}/{_MAX_CREATE_ATTEMPTS}): {e}",
                "attempt": attempt,
                "max_attempts": _MAX_CREATE_ATTEMPTS,
            }) + "\n")
            _sys.stdout.flush()
            if attempt < _MAX_CREATE_ATTEMPTS:
                delay = min(2 ** attempt, 10)
                logger.info("[E2B-Desktop] Retrying in %d seconds...", delay)
                time.sleep(delay)

    logger.error("[E2B-Desktop] All %d sandbox creation attempts failed.", _MAX_CREATE_ATTEMPTS)
    return None


def reset_sandbox() -> Optional[Any]:
    """Force-recreate the sandbox."""
    global _sandbox, _vnc_stream_url
    _vnc_stream_url = None
    with _sandbox_lock:
        if _sandbox:
            try:
                _sandbox.kill()
            except Exception:
                pass
        _sandbox = None
        _sandbox = _create_sandbox()
    return _sandbox


def keepalive() -> bool:
    """Send a keepalive ping to the sandbox to extend its lifetime.

    Uses the already-initialised _sandbox global directly so it never
    creates a new sandbox when none has been acquired yet.
    """
    with _sandbox_lock:
        sb = _sandbox
    if sb is None:
        return False
    try:
        sb.set_timeout(3600)
        return True
    except Exception:
        try:
            return _is_sandbox_alive(sb)
        except Exception:
            return False


def run_command(command: str, workdir: str = "", timeout: int = 120,
                on_stdout=None, on_stderr=None) -> Dict[str, Any]:
    """Run a shell command in the E2B sandbox and return result dict. Auto-retries on failure.
    If on_stdout/on_stderr callbacks are provided, they are called with each line of output
    in real-time as it arrives from the sandbox."""
    for attempt in range(2):
        sb = get_sandbox()
        if sb is None:
            api_key = _get_api_key()
            if not api_key:
                err_detail = ("E2B sandbox not available. E2B_API_KEY is not set. "
                              "Please set E2B_API_KEY in environment variables then restart.")
            else:
                err_detail = ("E2B sandbox not available. API key is set (%d chars) but sandbox "
                              "creation failed. Check server logs for details. "
                              "Possible causes: API key expired/invalid, E2B service down, "
                              "or rate limiting." % len(api_key))
            return {
                "success": False,
                "stdout": "",
                "stderr": err_detail,
                "exit_code": -1,
            }
        try:
            abs_workdir = _resolve_workdir(workdir)
            import shlex as _shlex
            try:
                sb.commands.run(f"mkdir -p {_shlex.quote(abs_workdir)} 2>/dev/null || true", timeout=10)
            except Exception:
                pass

            if "yt-dlp" in command:
                try:
                    sb.commands.run("yt-dlp --version >/dev/null 2>&1 || pip install -q yt-dlp", timeout=60)
                except Exception:
                    pass

            run_kwargs: Dict[str, Any] = {"cwd": abs_workdir, "timeout": timeout}
            if on_stdout is not None:
                run_kwargs["on_stdout"] = on_stdout
            if on_stderr is not None:
                run_kwargs["on_stderr"] = on_stderr

            result = sb.commands.run(command, **run_kwargs)
            return {
                "success": (result.exit_code == 0),
                "stdout": result.stdout or "",
                "stderr": result.stderr or "",
                "exit_code": result.exit_code,
            }
        except Exception as e:
            err_msg = str(e)
            logger.warning("[E2B] Command failed (attempt %d): %s", attempt + 1, err_msg)
            if attempt == 0:
                global _sandbox
                _sandbox = None
            else:
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"E2B command error: {err_msg}",
                    "exit_code": -1,
                }


def run_browser_script(script: str, timeout: int = 120) -> Dict[str, Any]:
    """Run a Playwright Python script inside E2B sandbox and return JSON output."""
    sb = get_sandbox()
    if sb is None:
        return {"success": False, "error": "E2B sandbox not available."}
    try:
        import hashlib as _hs
        # Use a unique script path under detected home to avoid /tmp permission issues
        home = _detected_home or WORKSPACE_DIR
        script_hash = _hs.md5(script.encode()).hexdigest()[:8]
        script_dir = f"{home}/.dzeck_scripts"
        script_path = f"{script_dir}/browser_script_{script_hash}.py"
        try:
            sb.commands.run(f"mkdir -p {script_dir}", timeout=10)
        except Exception:
            pass
        sb.files.write(script_path, script)
        result = sb.commands.run(f"python3 {script_path}", timeout=timeout)
        # Clean up script file after execution
        try:
            sb.commands.run(f"rm -f {script_path}", timeout=5)
        except Exception:
            pass
        stdout = result.stdout or ""
        if result.exit_code != 0:
            err = result.stderr or result.stdout or "Script failed"
            return {"success": False, "error": err}
        try:
            return json.loads(stdout)
        except Exception:
            return {"success": True, "output": stdout}
    except Exception as e:
        return {"success": False, "error": str(e)}


def read_file(path: str) -> Optional[str]:
    """Read a file from the E2B sandbox."""
    sb = get_sandbox()
    if sb is None:
        return None
    try:
        return sb.files.read(path)
    except Exception:
        return None


def read_file_bytes(path: str) -> Optional[bytes]:
    """Read a binary file from the E2B sandbox as bytes."""
    sb = get_sandbox()
    if sb is None:
        return None
    try:
        result = sb.files.read(path, format="bytes")
        if isinstance(result, bytes):
            return result
        if isinstance(result, str):
            return result.encode("utf-8", errors="replace")
        return bytes(result) if result is not None else None
    except Exception as e:
        logger.warning("[E2B] Failed to read binary file %s: %s", path, e)
        return None


def list_output_files_simple() -> list:
    """List files in the E2B sandbox output directory (simple ls). Returns full absolute paths."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        home = _detected_home or WORKSPACE_DIR
        output_dir = f"{home}/output"
        result = sb.commands.run(f"ls -1 {output_dir}/ 2>/dev/null || echo ''", timeout=10)
        stdout = getattr(result, "stdout", "") or ""
        return [
            "{}/{}".format(output_dir, f.strip())
            for f in stdout.strip().split("\n") if f.strip()
        ]
    except Exception:
        return []


def _resolve_sandbox_path(path: str) -> str:
    """Resolve a path to an absolute sandbox path under the detected home directory.
    Handles ~ expansion and relative paths."""
    home = _detected_home or WORKSPACE_DIR
    if path.startswith("~/") or path == "~":
        return os.path.normpath(path.replace("~", home, 1))
    if not path.startswith("/"):
        return os.path.normpath(os.path.join(home, path))
    return os.path.normpath(path)


def _resolve_workdir(workdir: str) -> str:
    """Resolve a working directory string to an absolute sandbox path.

    Expands ~/... and relative paths using the detected home dir.
    Always returns an absolute path safe to use as cwd= and with mkdir -p.
    Empty or None returns the detected home directory.
    """
    if not workdir:
        return _detected_home or WORKSPACE_DIR
    return _resolve_sandbox_path(workdir)


def write_file(path: str, content: str, append: bool = False) -> bool:
    """Write a file to the E2B sandbox with retry. If append=True, appends to existing content."""
    path = _resolve_sandbox_path(path)
    max_retries = 2
    last_error = None
    for attempt in range(1, max_retries + 1):
        sb = get_sandbox()
        if sb is None:
            last_error = "E2B sandbox not available"
            logger.error("[E2B] write_file failed: sandbox not available (attempt %d/%d)", attempt, max_retries)
            continue
        try:
            import shlex
            parent = "/".join(path.split("/")[:-1])
            if parent:
                sb.commands.run(f"mkdir -p {shlex.quote(parent)}", timeout=10)
            write_content = content
            if append:
                existing = ""
                try:
                    existing = sb.files.read(path) or ""
                except Exception:
                    pass
                write_content = existing + content
            sb.files.write(path, write_content)
            verify = sb.commands.run(f"test -f {shlex.quote(path)} && echo EXISTS", timeout=10)
            if verify.exit_code != 0 or "EXISTS" not in (verify.stdout or ""):
                raise RuntimeError(f"File verification failed after write: {path}")
            _cache_file(path, write_content)
            return True
        except Exception as e:
            last_error = str(e)
            logger.warning("[E2B] Failed to write file %s (attempt %d/%d): %s", path, attempt, max_retries, e)
            if attempt < max_retries:
                global _sandbox
                _sandbox = None
                time.sleep(1)
    logger.error("[E2B] All write attempts failed for %s: %s", path, last_error)
    return False


def ensure_file_in_sandbox(filepath: str) -> bool:
    """Ensure a file exists in the E2B sandbox. If missing, restore from _file_cache."""
    filepath = _resolve_sandbox_path(filepath)
    sb = get_sandbox()
    if sb is None:
        return False
    try:
        import shlex
        check = sb.commands.run(f"test -f {shlex.quote(filepath)} && echo EXISTS", timeout=10)
        if check.exit_code == 0 and "EXISTS" in (check.stdout or ""):
            return True
    except Exception:
        pass
    with _file_cache_lock:
        cached_content = _file_cache.get(filepath)
    if cached_content is not None:
        logger.info("[E2B] File %s missing in sandbox, restoring from cache...", filepath)
        return write_file(filepath, cached_content, append=False)
    logger.warning("[E2B] File %s not found in sandbox and not in cache.", filepath)
    return False


def sync_file_to_sandbox(local_path: str, sandbox_path: str = "") -> bool:
    """Copy a local file into the E2B sandbox (binary-safe via base64)."""
    if not _get_api_key():
        return False
    sb = get_sandbox()
    if sb is None:
        return False
    try:
        import shlex
        if not os.path.isfile(local_path):
            return False
        with open(local_path, "rb") as f:
            raw = f.read()
        if not sandbox_path:
            sandbox_path = os.path.join(WORKSPACE_DIR, os.path.basename(local_path))
        parent = "/".join(sandbox_path.split("/")[:-1])
        if parent:
            sb.commands.run(f"mkdir -p {shlex.quote(parent)}", timeout=10)
        b64 = base64.b64encode(raw).decode("ascii")
        chunk_size = 32768
        if len(b64) <= chunk_size:
            sb.commands.run(
                f"echo {shlex.quote(b64)} | base64 -d > {shlex.quote(sandbox_path)}",
                timeout=30
            )
        else:
            sb.commands.run(f"rm -f {shlex.quote(sandbox_path)}.b64_chunk*", timeout=5)
            for i, start in enumerate(range(0, len(b64), chunk_size)):
                chunk = b64[start:start + chunk_size]
                sb.commands.run(
                    f"echo {shlex.quote(chunk)} >> {shlex.quote(sandbox_path)}.b64",
                    timeout=15
                )
            sb.commands.run(
                f"base64 -d {shlex.quote(sandbox_path)}.b64 > {shlex.quote(sandbox_path)} && "
                f"rm -f {shlex.quote(sandbox_path)}.b64",
                timeout=30
            )
        logger.info("[E2B] Synced local %s → sandbox %s", local_path, sandbox_path)
        return True
    except Exception as e:
        logger.warning("[E2B] Failed to sync file to sandbox: %s", e)
        return False



def list_workspace_files() -> list:
    """List user-created files in the E2B workspace directory.
    Excludes hidden dirs (.cache, .npm, .local, .config), skills/, upload/, and sandbox.txt."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        home = _detected_home or WORKSPACE_DIR
        # Exclude hidden directories and system dirs to avoid noise
        result = sb.commands.run(
            f"find {home} -type f -maxdepth 4 "
            r"-not -path '*/\.*' "
            f"-not -path '{home}/skills/*' "
            f"-not -path '{home}/upload/*' "
            f"-not -name 'sandbox.txt' "
            f"2>/dev/null | head -200",
            timeout=15
        )
        if result.stdout:
            return [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        return []
    except Exception:
        return []


def list_output_files() -> list:
    """List files in the E2B output directory (deliverables only). Returns absolute paths."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        home = _detected_home or WORKSPACE_DIR
        output_dir = f"{home}/output"
        result = sb.commands.run(
            f"find {output_dir} /tmp/dzeck_output -type f -maxdepth 4 2>/dev/null | head -100",
            timeout=15
        )
        if result.stdout:
            files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
            return [f if f.startswith("/") else os.path.join(output_dir, f) for f in files]
        return []
    except Exception:
        return []


def list_output_files_with_info() -> list:
    """List output files with size and extension info for download URL generation."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        home = _detected_home or WORKSPACE_DIR
        output_dir = f"{home}/output"
        result = sb.commands.run(
            f"find {output_dir} /tmp/dzeck_output -type f -maxdepth 4 "
            f"-exec stat -c '%n|%s' {{}} \\; 2>/dev/null | head -100",
            timeout=15
        )
        files_info = []
        if result.stdout:
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if not line or "|" not in line:
                    continue
                parts = line.split("|", 1)
                filepath = parts[0]
                size = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
                if not filepath.startswith("/"):
                    filepath = os.path.join(output_dir, filepath)
                ext = os.path.splitext(filepath)[1].lower()
                files_info.append({
                    "path": filepath,
                    "filename": os.path.basename(filepath),
                    "size": size,
                    "extension": ext,
                })
        return files_info
    except Exception:
        return []


def ensure_zip_output(zip_filename: str = "output.zip") -> Optional[str]:
    """If output dir has multiple files but no .zip, auto-create a zip archive.
    Only creates zip when there are 2+ output files (single files don't need archiving).
    Returns the zip file path if created/found, None otherwise."""
    sb = get_sandbox()
    if sb is None:
        return None
    try:
        home = _detected_home or WORKSPACE_DIR
        output_dir = f"{home}/output"
        check = sb.commands.run(
            f"find {output_dir} -maxdepth 1 -name '*.zip' -type f 2>/dev/null | head -1",
            timeout=10
        )
        if check.stdout and check.stdout.strip():
            return check.stdout.strip()

        file_count = sb.commands.run(
            f"find {output_dir} -type f 2>/dev/null | wc -l",
            timeout=10
        )
        count = 0
        if file_count.stdout:
            try:
                count = int(file_count.stdout.strip())
            except ValueError:
                pass
        if count < 2:
            return None

        zip_path = os.path.join(output_dir, zip_filename)
        result = sb.commands.run(
            f'cd {output_dir} && zip -r "{zip_path}" . -x "*.zip" 2>/dev/null',
            timeout=60
        )
        if result.exit_code == 0:
            logger.info("[E2B] Auto-created zip archive: %s", zip_path)
            return zip_path
        return None
    except Exception as e:
        logger.warning("[E2B] ensure_zip_output failed: %s", e)
        return None


def install_packages(packages: list) -> bool:
    """Install Python packages in the E2B sandbox."""
    if not packages:
        return True
    sb = get_sandbox()
    if sb is None:
        return False
    try:
        pkg_str = " ".join(packages)
        result = sb.commands.run(
            f"pip install --quiet {pkg_str} 2>&1 | tail -5",
            timeout=180
        )
        return result.exit_code == 0
    except Exception as e:
        logger.warning("[E2B] Failed to install packages %s: %s", packages, e)
        return False
