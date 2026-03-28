"""
File operation tools for Dzeck AI Agent.
Upgraded to class-based architecture from Ai-DzeckV2 (Manus) pattern.
Provides: FileTool class + backward-compatible functions.
All file operations include a download_url so users can download files directly from chat.
"""
import os
import re
import base64
import shutil
import glob as glob_module
import urllib.parse
from typing import Optional, Any

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

_MIME_MAP = {
    # Text / code
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
    # Archives
    ".zip": "application/zip", ".tar": "application/x-tar",
    ".gz": "application/gzip", ".bz2": "application/x-bzip2",
    ".7z": "application/x-7z-compressed", ".rar": "application/x-rar-compressed",
    # Documents
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
    # Images
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".ico": "image/x-icon", ".tiff": "image/tiff", ".tif": "image/tiff",
    # Audio / Video
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
    ".mov": "video/quicktime", ".webm": "video/webm",
    # Data / misc
    ".parquet": "application/octet-stream", ".feather": "application/octet-stream",
    ".pkl": "application/octet-stream", ".pickle": "application/octet-stream",
    ".npy": "application/octet-stream", ".npz": "application/octet-stream",
    ".db": "application/octet-stream", ".sqlite": "application/octet-stream",
    ".bin": "application/octet-stream",
}



# ─── Utility helpers ─────────────────────────────────────────────────────────

def _to_bool(v: Any, default: bool = False) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() not in ("false", "0", "no", "none", "null", "")
    if v is None:
        return default
    return bool(v)


def _to_int_or_none(v: Any) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, str) and v.strip().lower() in ("null", "none", ""):
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


# ─── MongoDB file tracking ───────────────────────────────────────────────────

def _track_file_in_mongo(file_path: str, content_size: int, mime_type: str = "") -> None:
    """Upsert a file record into MongoDB session_files for tracking.
    This is best-effort — failures are logged but not raised."""
    session_id = os.environ.get("DZECK_SESSION_ID", "")
    if not session_id:
        return
    try:
        from server.agent.db.mongo import get_collection as _get_col
        from datetime import datetime, timezone
        col = _get_col("session_files")
        if col is None:
            return
        sandbox_id = os.environ.get("DZECK_E2B_SANDBOX_ID", "")
        name = os.path.basename(file_path)
        ext = os.path.splitext(name)[1].lower()
        if not mime_type:
            mime_type = _MIME_MAP.get(ext, "application/octet-stream")
        import urllib.parse
        download_url = ""
        if sandbox_id:
            ep = urllib.parse.quote(file_path, safe="")
            en = urllib.parse.quote(name, safe="")
            es = urllib.parse.quote(sandbox_id, safe="")
            download_url = f"/api/files/download?sandbox_id={es}&path={ep}&name={en}"
        col.update_one(
            {"session_id": session_id, "path": file_path},
            {"$set": {
                "session_id": session_id,
                "name": name,
                "path": file_path,
                "size": content_size,
                "mime_type": mime_type,
                "sandbox_id": sandbox_id,
                "download_url": download_url,
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except Exception as exc:
        import logging
        import traceback
        logger_ft = logging.getLogger(__name__)
        logger_ft.warning(
            "[file_tracking] MongoDB upsert FAILED for session=%s path=%s: %s\n%s",
            session_id, file_path, exc, traceback.format_exc()
        )


# ─── E2B dependency preflight ────────────────────────────────────────────────

def _preflight_e2b_sandbox() -> Optional[str]:
    """Check that E2B sandbox is configured and importable before file operations.
    Returns an error message string if the preflight fails, None if all is OK."""
    e2b_key = os.environ.get("E2B_API_KEY", "")
    if not e2b_key:
        return (
            "E2B_API_KEY is not set. File operations require E2B sandbox. "
            "Please configure E2B_API_KEY in environment variables."
        )
    try:
        from server.agent.tools.e2b_sandbox import get_sandbox, _resolve_sandbox_path  # noqa: F401
    except ImportError as exc:
        return f"E2B sandbox module could not be imported: {exc}. Check server dependencies."
    return None


# ─── Backward-compatible functions ───────────────────────────────────────────

def file_read(
    file: str,
    start_line: Optional[Any] = None,
    end_line: Optional[Any] = None,
    sudo: Optional[Any] = None,
    **kwargs,
) -> ToolResult:
    """Read the contents of a file."""
    start_line = _to_int_or_none(start_line)
    end_line = _to_int_or_none(end_line)
    try:
        preflight_err = _preflight_e2b_sandbox()
        if preflight_err:
            return ToolResult(
                success=False,
                message=preflight_err,
                data={"error": "e2b_preflight_failed", "file": file},
            )
        _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))
        is_sandbox_path = file.startswith("/home/") or file.startswith("~/") or not file.startswith("/")

        file_content = None
        if _e2b_enabled:
            try:
                from server.agent.tools.e2b_sandbox import read_file as e2b_read, _resolve_sandbox_path
                sandbox_path = _resolve_sandbox_path(file)
                file_content = e2b_read(sandbox_path)
            except Exception as e2b_exc:
                return ToolResult(
                    success=False,
                    message=f"E2B sandbox read failed for file: {file}. Error: {e2b_exc}",
                    data={"error": "e2b_read_error", "file": file, "detail": str(e2b_exc)},
                )
        else:
            return ToolResult(
                success=False,
                message=f"E2B sandbox is not available (E2B_API_KEY not set). File operations MUST run inside E2B sandbox. File: {file}",
                data={"error": "e2b_not_available", "file": file},
            )

        if file_content is None:
            return ToolResult(success=False, message=f"File not found: {file}", data={"error": "not_found", "file": file})

        lines = file_content.splitlines(keepends=True)

        total_lines = len(lines)

        if start_line is not None or end_line is not None:
            start = max(0, (start_line or 1) - 1)
            end = end_line if end_line is not None else total_lines
            selected_lines = lines[start:end]
            numbered = [f"{i:4d} | {line.rstrip()}" for i, line in enumerate(selected_lines, start=start + 1)]
        else:
            numbered = [f"{i:4d} | {line.rstrip()}" for i, line in enumerate(lines, start=1)]

        content = "\n".join(numbered)
        max_chars = 15000
        if len(content) > max_chars:
            content = content[:max_chars] + "\n\n[File truncated - use start_line/end_line to read more]"

        return ToolResult(
            success=True,
            message=f"File: {file} ({total_lines} lines)\n\n{content}",
            data={"file": file, "content": content, "total_lines": total_lines},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to read file: {str(e)}", data={"error": str(e), "file": file})


def file_write(
    file: str,
    content: str,
    append: Any = False,
    leading_newline: Any = False,
    trailing_newline: Any = True,
    sudo: Optional[Any] = None,
    **kwargs,
) -> ToolResult:
    """Overwrite or append content to a file."""
    append = _to_bool(append, default=False)
    leading_newline = _to_bool(leading_newline, default=False)
    trailing_newline = _to_bool(trailing_newline, default=True)
    try:
        preflight_err = _preflight_e2b_sandbox()
        if preflight_err:
            return ToolResult(
                success=False,
                message=preflight_err,
                data={"error": "e2b_preflight_failed", "file": file},
            )

        write_content = content
        if leading_newline:
            write_content = "\n" + write_content
        if trailing_newline and not write_content.endswith("\n"):
            write_content = write_content + "\n"

        _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))
        is_sandbox_path = file.startswith("/home/") or file.startswith("~/") or not file.startswith("/")
        is_output_path = "/output/" in file or file.startswith("~/output")

        if not _e2b_enabled:
            return ToolResult(
                success=False,
                message=f"E2B sandbox is not available (E2B_API_KEY not set). File operations MUST run inside E2B sandbox. File: {file}",
                data={"error": "e2b_not_available", "file": file},
            )

        e2b_ok = False
        e2b_error = ""
        try:
            from server.agent.tools.e2b_sandbox import write_file as e2b_write, _resolve_sandbox_path
            sandbox_path = _resolve_sandbox_path(file)
            e2b_ok = e2b_write(sandbox_path, write_content, append=append)
            if not e2b_ok:
                e2b_error = f"E2B sandbox write failed for {sandbox_path} after retries."
        except Exception as e:
            e2b_ok = False
            e2b_error = str(e)

        if not e2b_ok:
            return ToolResult(
                success=False,
                message=f"Failed to write file to E2B sandbox: {file}. {e2b_error}\nPlease retry or check E2B sandbox status.",
                data={"error": e2b_error, "file": file, "e2b_write_failed": True},
            )

        operation = "appended" if append else "written"
        content_preview = content[:1000]
        if len(content) > 1000:
            content_preview += "\n... (truncated, total {} chars)".format(len(content))

        ext = os.path.splitext(file)[1].lstrip(".") if "." in os.path.basename(file) else ""
        lang_hint = ext if ext in ("py", "js", "ts", "tsx", "jsx", "html", "css", "json", "yaml", "yml", "sh", "bash", "sql", "md", "xml", "svg", "java", "cpp", "c", "go", "rs", "rb") else ""

        msg = "File {op} successfully: {f} ({b} bytes)".format(op=operation, f=file, b=len(write_content))
        msg += "\n✅ File tersimpan di E2B sandbox."
        msg += "\n\nContent preview:\n```{lang}\n{preview}\n```".format(
            lang=lang_hint, preview=content_preview
        )

        # Track file in MongoDB for FilePanel
        try:
            from server.agent.tools.e2b_sandbox import _resolve_sandbox_path as _rsp_fw
            _track_file_in_mongo(_rsp_fw(file), len(write_content))
        except Exception:
            pass

        return ToolResult(
            success=True,
            message=msg,
            data={
                "file": file,
                "operation": operation,
                "bytes_written": len(write_content),
                "filename": os.path.basename(file),
                "content_preview": content_preview,
            },
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to write file: {str(e)}", data={"error": str(e), "file": file})


def file_str_replace(
    file: str,
    old_str: str,
    new_str: str,
    sudo: Optional[Any] = None,
    **kwargs,
) -> ToolResult:
    """Replace a string in a file."""
    try:
        _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))
        is_sandbox_path = file.startswith("/home/") or file.startswith("~/") or not file.startswith("/")

        if not _e2b_enabled:
            return ToolResult(
                success=False,
                message=f"E2B sandbox is not available (E2B_API_KEY not set). File operations MUST run inside E2B sandbox. File: {file}",
                data={"error": "e2b_not_available", "file": file},
            )

        content = None
        try:
            from server.agent.tools.e2b_sandbox import read_file as e2b_read, _resolve_sandbox_path
            sandbox_path = _resolve_sandbox_path(file)
            content = e2b_read(sandbox_path)
        except Exception:
            pass
        if content is None:
            return ToolResult(success=False, message=f"File not found: {file}", data={"error": "not_found", "file": file})

        if old_str not in content:
            return ToolResult(
                success=False,
                message=f"String not found in file: {file}",
                data={"error": "not_found", "file": file, "search_string": old_str[:100]},
            )

        count = content.count(old_str)
        new_content = content.replace(old_str, new_str)

        e2b_replace_ok = False
        e2b_replace_err = ""
        try:
            from server.agent.tools.e2b_sandbox import write_file as e2b_write, _resolve_sandbox_path as _rsp
            sandbox_path = _rsp(file)
            e2b_replace_ok = e2b_write(sandbox_path, new_content)
            if not e2b_replace_ok:
                e2b_replace_err = f"E2B sandbox write failed for {sandbox_path} after retries."
        except Exception as e:
            e2b_replace_err = str(e)
        if not e2b_replace_ok:
            return ToolResult(
                success=False,
                message=f"Failed to write replaced content to E2B sandbox: {file}. {e2b_replace_err}",
                data={"error": e2b_replace_err, "file": file, "e2b_write_failed": True},
            )

        ext = os.path.splitext(file)[1].lstrip(".") if "." in os.path.basename(file) else ""
        lang_hint = ext if ext in ("py", "js", "ts", "tsx", "jsx", "html", "css", "json", "yaml", "yml", "sh", "bash", "sql", "md", "xml", "svg", "java", "cpp", "c", "go", "rs", "rb") else ""
        content_preview = new_content[:1000]
        if len(new_content) > 1000:
            content_preview += "\n... (truncated, total {} chars)".format(len(new_content))

        msg = f"Replaced {count} occurrence(s) in {file}"
        msg += "\n✅ File tersimpan di E2B sandbox."
        msg += "\n\nContent preview:\n```{lang}\n{preview}\n```".format(
            lang=lang_hint, preview=content_preview
        )

        # Track file in MongoDB for FilePanel
        try:
            from server.agent.tools.e2b_sandbox import _resolve_sandbox_path as _rsp_fsr
            _track_file_in_mongo(_rsp_fsr(file), len(new_content))
        except Exception:
            pass

        return ToolResult(
            success=True,
            message=msg,
            data={
                "file": file,
                "replacements": count,
                "filename": os.path.basename(file),
            },
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to replace in file: {str(e)}", data={"error": str(e), "file": file})


def file_find_in_content(
    path: str,
    glob: str = "**/*",
    pattern: str = "",
    **kwargs,
) -> ToolResult:
    """Search for pattern in files matching glob under path. Uses E2B sandbox when available."""
    _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))

    # E2B path: use grep inside sandbox
    if _e2b_enabled and (path.startswith("/home/") or path.startswith("/tmp") or path.startswith("~/") or not path.startswith("/")):  # noqa: E501
        try:
            from server.agent.tools.e2b_sandbox import run_command as e2b_run
            import shlex as _shlex
            glob_pattern = glob.replace("**", "*").replace("*/*", "*")
            if pattern:
                grep_pattern = _shlex.quote(pattern)
                if glob_pattern and glob_pattern != "**/*" and glob_pattern != "*":
                    cmd = f"grep -r --include={_shlex.quote(glob_pattern)} -n {grep_pattern} {_shlex.quote(path)} 2>/dev/null | head -100"
                else:
                    cmd = f"grep -r -n {grep_pattern} {_shlex.quote(path)} 2>/dev/null | head -100"
            else:
                if glob_pattern and glob_pattern != "**/*" and glob_pattern != "*":
                    cmd = f"find {_shlex.quote(path)} -name {_shlex.quote(glob_pattern)} -type f 2>/dev/null | head -100"
                else:
                    cmd = f"find {_shlex.quote(path)} -type f 2>/dev/null | head -100"
            result = e2b_run(cmd, workdir=path, timeout=20)
            stdout = result.get("stdout", "").strip()
            matches = [l.strip() for l in stdout.split("\n") if l.strip()] if stdout else []
            matches_text = "\n".join(matches[:50])
            if pattern:
                msg = "Found {} match(es) for '{}' in {} (E2B sandbox):\n{}".format(len(matches), pattern, path, matches_text)
            else:
                msg = "Found {} file(s) in {} (E2B sandbox):\n{}".format(len(matches), path, matches_text)
            return ToolResult(
                success=True,
                message=msg,
                data={"path": path, "glob": glob, "pattern": pattern, "matches": matches[:50], "count": len(matches)},
            )
        except Exception as e:
            return ToolResult(success=False, message=f"E2B content search failed: {str(e)}", data={"error": str(e), "path": path})

    return ToolResult(
        success=False,
        message="Local file search is disabled. E2B_API_KEY is required for sandbox file operations.",
        data={"error": "e2b_not_available", "path": path}
    )


def file_find_by_name(
    path: str,
    glob: str = "*",
    **kwargs,
) -> ToolResult:
    """Find files matching a glob pattern in a directory. Uses E2B sandbox when available."""
    _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))

    # E2B path: run find command inside sandbox
    if _e2b_enabled and (path.startswith("/home/") or path.startswith("/tmp") or path.startswith("~/") or not path.startswith("/")):  # noqa: E501
        try:
            from server.agent.tools.e2b_sandbox import run_command as e2b_run
            import shlex as _shlex
            # Convert glob to find-compatible pattern
            glob_pattern = glob.replace("**", "*")
            if glob_pattern and glob_pattern != "*":
                find_cmd = f"find {_shlex.quote(path)} -name {_shlex.quote(glob_pattern)} -type f 2>/dev/null | head -100"
            else:
                find_cmd = f"find {_shlex.quote(path)} -type f 2>/dev/null | head -100"
            result = e2b_run(find_cmd, workdir=path, timeout=20)
            stdout = result.get("stdout", "").strip()
            if result.get("exit_code", -1) == -1 and not stdout:
                return ToolResult(
                    success=False,
                    message=f"Directory not found in E2B sandbox: {path}",
                    data={"error": "not_found", "path": path},
                )
            files = [f.strip() for f in stdout.split("\n") if f.strip()] if stdout else []
            file_list = "\n".join(files)
            msg = f"Found {len(files)} file(s) matching '{glob}' in {path} (E2B sandbox):\n{file_list}"
            return ToolResult(
                success=True,
                message=msg,
                data={"path": path, "pattern": glob, "files": files, "count": len(files), "truncated": len(files) >= 100},
            )
        except Exception as e:
            return ToolResult(success=False, message=f"E2B file search failed: {str(e)}", data={"error": str(e), "path": path})

    return ToolResult(
        success=False,
        message="Local file search is disabled. E2B_API_KEY is required for sandbox file operations.",
        data={"error": "e2b_not_available", "path": path}
    )


def image_view(image: str, **kwargs) -> ToolResult:
    """View an image file (returns base64 encoded content). Reads from E2B sandbox when available."""
    try:
        ext = os.path.splitext(image)[1].lower()
        mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml"}
        mime = mime_map.get(ext, "image/png")

        raw_data: Optional[bytes] = None
        _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))

        if _e2b_enabled:
            try:
                from server.agent.tools.e2b_sandbox import read_file_bytes as e2b_read_bytes, _resolve_sandbox_path
                sandbox_path = _resolve_sandbox_path(image)
                raw_data = e2b_read_bytes(sandbox_path)
            except Exception:
                pass

        if raw_data is None:
            return ToolResult(success=False, message=f"Image not found: {image}", data={"error": "not_found", "image": image})

        chunk = raw_data[:102400]
        b64 = base64.b64encode(chunk).decode()
        data_uri = f"data:{mime};base64,{b64}"
        size = len(raw_data)

        return ToolResult(
            success=True,
            message=f"Image: {image} ({size} bytes, {mime})",
            data={"image": image, "size": size, "mime": mime, "data_uri": data_uri},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to view image: {str(e)}", data={"error": str(e), "image": image})


# ─── Class-based FileTool (Ai-DzeckV2 / Manus pattern) ──────────────────────

class FileTool(BaseTool):
    """File tool class - provides file system operation capabilities."""

    name: str = "file"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="file_read",
        description="Read file content. Use for checking file contents, analyzing logs, or reading configuration files.",
        parameters={
            "file": {"type": "string", "description": "Absolute path of the file to read"},
            "start_line": {"type": "integer", "description": "(Optional) Starting line number (1-based)"},
            "end_line": {"type": "integer", "description": "(Optional) Ending line number (inclusive)"},
            "sudo": {"type": "boolean", "description": "(Optional) Whether to use sudo privileges"},
        },
        required=["file"],
    )
    def _file_read(self, file: str, start_line: Optional[int] = None, end_line: Optional[int] = None, sudo: Optional[bool] = False) -> ToolResult:
        return file_read(file=file, start_line=start_line, end_line=end_line)

    @tool(
        name="file_write",
        description="Overwrite or append content to a file. Use for creating new files, appending content, or modifying existing files.",
        parameters={
            "file": {"type": "string", "description": "Absolute path of the file to write to"},
            "content": {"type": "string", "description": "Text content to write"},
            "append": {"type": "boolean", "description": "(Optional) Whether to use append mode (default: false)"},
            "leading_newline": {"type": "boolean", "description": "(Optional) Whether to add a leading newline"},
            "trailing_newline": {"type": "boolean", "description": "(Optional) Whether to add a trailing newline (default: true)"},
            "sudo": {"type": "boolean", "description": "(Optional) Whether to use sudo privileges"},
        },
        required=["file", "content"],
    )
    def _file_write(self, file: str, content: str, append: Optional[bool] = False, leading_newline: Optional[bool] = False, trailing_newline: Optional[bool] = True, sudo: Optional[bool] = False) -> ToolResult:
        return file_write(file=file, content=content, append=append, leading_newline=leading_newline, trailing_newline=trailing_newline)

    @tool(
        name="file_str_replace",
        description="Replace specific string in file. Use for making targeted edits to files.",
        parameters={
            "file": {"type": "string", "description": "Absolute path of the file to modify"},
            "old_str": {"type": "string", "description": "String to find and replace"},
            "new_str": {"type": "string", "description": "Replacement string"},
            "sudo": {"type": "boolean", "description": "(Optional) Whether to use sudo privileges"},
        },
        required=["file", "old_str", "new_str"],
    )
    def _file_str_replace(self, file: str, old_str: str, new_str: str, sudo: Optional[bool] = False) -> ToolResult:
        return file_str_replace(file=file, old_str=old_str, new_str=new_str)

    @tool(
        name="file_find_by_name",
        description="Find files by name pattern under a directory. Use for locating files by their names.",
        parameters={
            "path": {"type": "string", "description": "Directory path to search in"},
            "glob": {"type": "string", "description": "Glob pattern e.g. *.py, **/*.ts, *.json"},
        },
        required=["path"],
    )
    def _file_find_by_name(self, path: str, glob: str = "*") -> ToolResult:
        return file_find_by_name(path=path, glob=glob)

    @tool(
        name="file_find_in_content",
        description="Search for text or regex pattern inside files matching a glob pattern under a directory.",
        parameters={
            "path": {"type": "string", "description": "Directory path to search in"},
            "glob": {"type": "string", "description": "Glob pattern to filter files e.g. **/*.py"},
            "pattern": {"type": "string", "description": "Text or regex pattern to search for in file content"},
        },
        required=["path", "pattern"],
    )
    def _file_find_in_content(self, path: str, pattern: str, glob: str = "**/*") -> ToolResult:
        return file_find_in_content(path=path, pattern=pattern, glob=glob)

    @tool(
        name="image_view",
        description="View an image file. Returns the image content as base64 for display.",
        parameters={"image": {"type": "string", "description": "Absolute path to the image file"}},
        required=["image"],
    )
    def _image_view(self, image: str) -> ToolResult:
        return image_view(image=image)
