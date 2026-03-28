"""
E2B Sandbox Manager for Dzeck AI Agent.
Provides a persistent, isolated cloud sandbox for shell and browser automation.
All tool calls (shell, browser) are routed through this secure E2B environment.
Uses E2B v2 API: Sandbox.create() pattern.
Enhanced with: auto-retry, health check, keepalive, robust file I/O.
"""
import os
import json
import logging
import threading
import base64
import time
from typing import Optional, Any, Dict

logger = logging.getLogger(__name__)

E2B_API_KEY = os.environ.get("E2B_API_KEY", "")

_sandbox_lock = threading.Lock()
_sandbox: Optional[Any] = None
_sandbox_create_attempts = 0
_MAX_CREATE_ATTEMPTS = 3

WORKSPACE_DIR = "/home/user/dzeck-ai"
OUTPUT_DIR = "/home/user/dzeck-ai/output"

def get_session_workspace() -> str:
    """Return per-session workspace dir: /home/user/dzeck-ai/<session_id>/
    Falls back to WORKSPACE_DIR if no session is set."""
    session_id = os.environ.get("DZECK_SESSION_ID", "")
    if session_id:
        safe_id = "".join(c for c in session_id if c.isalnum() or c in "-_")[:32]
        return os.path.join(WORKSPACE_DIR, safe_id)
    return WORKSPACE_DIR


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
    """Quick health check for the sandbox."""
    try:
        result = sb.commands.run("echo alive", timeout=8)
        return result.exit_code == 0 and "alive" in (result.stdout or "")
    except Exception:
        return False


def get_sandbox() -> Optional[Any]:
    """Get or create the E2B sandbox singleton, with auto-recovery."""
    global _sandbox
    if _sandbox is not None:
        if _is_sandbox_alive(_sandbox):
            return _sandbox
        logger.warning("[E2B] Sandbox health check failed, recreating...")
        try:
            _sandbox.kill()
        except Exception:
            pass
        _sandbox = None

    with _sandbox_lock:
        if _sandbox is None:
            _sandbox = _create_sandbox()
    return _sandbox


def _create_sandbox() -> Optional[Any]:
    """Create a new E2B sandbox instance with retry logic."""
    global _sandbox_create_attempts
    if not E2B_API_KEY:
        logger.error("[E2B] E2B_API_KEY not set. Cannot create sandbox.")
        return None

    for attempt in range(1, _MAX_CREATE_ATTEMPTS + 1):
        try:
            from e2b import Sandbox
            logger.info("[E2B] Creating new sandbox (attempt %d/%d)...", attempt, _MAX_CREATE_ATTEMPTS)
            sb = Sandbox.create(api_key=E2B_API_KEY, timeout=900)
            logger.info("[E2B] Sandbox ready (id=%s). Setting up workspace...", sb.sandbox_id)

            session_ws = get_session_workspace()
            sb.commands.run(
                f"mkdir -p {WORKSPACE_DIR} {OUTPUT_DIR} {session_ws} /tmp/dzeck_output && "
                f"cd {session_ws} && echo 'workspace ready'",
                timeout=15
            )

            sb.commands.run(
                "pip install --quiet reportlab python-docx openpyxl Pillow requests beautifulsoup4 "
                "pandas matplotlib yt-dlp 2>/dev/null || true",
                timeout=120
            )

            sb.commands.run(
                "which python3 && python3 --version && echo 'python ok'",
                timeout=10
            )

            _replay_file_cache(sb)

            logger.info("[E2B] Workspace ready (id=%s)", sb.sandbox_id)
            _sandbox_create_attempts = 0
            return sb
        except Exception as e:
            logger.error("[E2B] Failed to create sandbox (attempt %d): %s", attempt, e)
            if attempt < _MAX_CREATE_ATTEMPTS:
                time.sleep(2 ** attempt)

    logger.error("[E2B] All sandbox creation attempts failed.")
    return None


def reset_sandbox() -> Optional[Any]:
    """Force-recreate the sandbox."""
    global _sandbox
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
    """Send a keepalive ping to the sandbox to extend its lifetime."""
    sb = get_sandbox()
    if sb is None:
        return False
    try:
        sb.set_timeout(900)
        return True
    except Exception:
        try:
            return _is_sandbox_alive(sb)
        except Exception:
            return False


def run_command(command: str, workdir: str = WORKSPACE_DIR, timeout: int = 120,
                on_stdout=None, on_stderr=None) -> Dict[str, Any]:
    """Run a shell command in the E2B sandbox and return result dict. Auto-retries on failure.
    If on_stdout/on_stderr callbacks are provided, they are called with each line of output
    in real-time as it arrives from the sandbox."""
    for attempt in range(2):
        sb = get_sandbox()
        if sb is None:
            return {
                "success": False,
                "stdout": "",
                "stderr": "E2B sandbox not available. Check E2B_API_KEY.",
                "exit_code": -1,
            }
        try:
            if workdir and workdir.startswith("/home/user/dzeck-ai"):
                import shlex
                try:
                    sb.commands.run(f"mkdir -p {shlex.quote(workdir)}", timeout=10)
                except Exception:
                    pass

            if "yt-dlp" in command:
                try:
                    sb.commands.run("yt-dlp --version >/dev/null 2>&1 || pip install -q yt-dlp", timeout=60)
                except Exception:
                    pass

            run_kwargs: Dict[str, Any] = {"cwd": workdir, "timeout": timeout}
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
        script_path = "/tmp/dzeck_browser_script.py"
        sb.files.write(script_path, script)
        result = sb.commands.run(f"python3 {script_path}", timeout=timeout)
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


def list_output_files() -> list:
    """List files in the E2B sandbox output directory. Returns full absolute paths."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        result = sb.commands.run("ls -1 /home/user/dzeck-ai/output/ 2>/dev/null || echo ''", timeout=10)
        stdout = getattr(result, "stdout", "") or ""
        return [
            "{}/{}".format(OUTPUT_DIR, f.strip())
            for f in stdout.strip().split("\n") if f.strip()
        ]
    except Exception:
        return []


def _resolve_sandbox_path(path: str) -> str:
    """Resolve a path to an absolute sandbox path under WORKSPACE_DIR."""
    if not path.startswith("/"):
        return os.path.normpath(os.path.join(WORKSPACE_DIR, path))
    return os.path.normpath(path)


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
    if not E2B_API_KEY:
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


def sync_file_from_sandbox(sandbox_path: str, local_path: str = "") -> Optional[str]:
    """Copy a file from E2B sandbox to local filesystem (binary-safe via base64). Returns local path or None."""
    if not E2B_API_KEY:
        return None
    sb = get_sandbox()
    if sb is None:
        return None
    try:
        import shlex
        if not local_path:
            _sess = os.environ.get("DZECK_SESSION_ID", "")
            _base = f"/tmp/dzeck_files/{_sess}" if _sess else "/tmp/dzeck_files"
            local_path = os.path.join(_base, os.path.basename(sandbox_path))
        parent = os.path.dirname(local_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        result = sb.commands.run(
            f"base64 -w0 {shlex.quote(sandbox_path)}",
            timeout=60
        )
        if result.exit_code != 0 or not result.stdout:
            content = sb.files.read(sandbox_path)
            if content is None:
                return None
            with open(local_path, "w", encoding="utf-8") as f:
                f.write(content)
        else:
            raw = base64.b64decode(result.stdout.strip())
            with open(local_path, "wb") as f:
                f.write(raw)
        logger.info("[E2B] Synced sandbox %s → local %s", sandbox_path, local_path)
        return local_path
    except Exception as e:
        logger.warning("[E2B] Failed to sync file from sandbox: %s", e)
        return None


def list_workspace_files() -> list:
    """List files in the E2B workspace directory."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        result = sb.commands.run(
            f"find {WORKSPACE_DIR} -type f -maxdepth 4 2>/dev/null | head -100",
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
        result = sb.commands.run(
            f"find {OUTPUT_DIR} /tmp/dzeck_output -type f -maxdepth 4 2>/dev/null | head -100",
            timeout=15
        )
        if result.stdout:
            files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
            return [f if f.startswith("/") else os.path.join(OUTPUT_DIR, f) for f in files]
        return []
    except Exception:
        return []


def list_output_files_with_info() -> list:
    """List output files with size and extension info for download URL generation."""
    sb = get_sandbox()
    if sb is None:
        return []
    try:
        result = sb.commands.run(
            f"find {OUTPUT_DIR} /tmp/dzeck_output -type f -maxdepth 4 "
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
                    filepath = os.path.join(OUTPUT_DIR, filepath)
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
        check = sb.commands.run(
            f"find {OUTPUT_DIR} -maxdepth 1 -name '*.zip' -type f 2>/dev/null | head -1",
            timeout=10
        )
        if check.stdout and check.stdout.strip():
            return check.stdout.strip()

        file_count = sb.commands.run(
            f"find {OUTPUT_DIR} -type f 2>/dev/null | wc -l",
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

        zip_path = os.path.join(OUTPUT_DIR, zip_filename)
        result = sb.commands.run(
            f'cd {OUTPUT_DIR} && zip -r "{zip_path}" . -x "*.zip" 2>/dev/null',
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
