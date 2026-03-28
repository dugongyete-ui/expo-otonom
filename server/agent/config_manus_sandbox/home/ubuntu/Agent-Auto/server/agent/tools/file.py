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

# Directory where files are copied for serving via the download API
def _get_files_dir() -> str:
    session_id = os.environ.get("DZECK_SESSION_ID", "")
    if session_id:
        d = f"/tmp/dzeck_files/{session_id}"
    else:
        d = "/tmp/dzeck_files"
    os.makedirs(d, exist_ok=True)
    return d

DZECK_FILES_DIR = _get_files_dir()


_MIME_MAP = {
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".html": "text/html", ".xml": "application/xml",
    ".js": "application/javascript", ".py": "text/x-python", ".sql": "text/x-sql",
    ".yaml": "text/yaml", ".yml": "text/yaml", ".svg": "image/svg+xml",
    ".zip": "application/zip", ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
}


def _make_download_url(file_path: str) -> str:
    """Generate a download URL for a file with proper MIME type handling."""
    filename = os.path.basename(file_path)
    ext = os.path.splitext(filename)[1].lower()
    mime_type = _MIME_MAP.get(ext, "application/octet-stream")
    encoded_path = urllib.parse.quote(file_path, safe="")
    encoded_name = urllib.parse.quote(filename, safe="")
    return f"/api/files/download?path={encoded_path}&name={encoded_name}&type={urllib.parse.quote(mime_type, safe='')}"


def _register_file_for_download(file_path: str) -> str:
    """
    Copy the file to DZECK_FILES_DIR so it's accessible for download,
    and return the download URL pointing to the copy in DZECK_FILES_DIR.
    """
    dest = file_path
    try:
        if os.path.isfile(file_path):
            filename = os.path.basename(file_path)
            dest = os.path.join(DZECK_FILES_DIR, filename)
            if os.path.exists(dest) and os.path.abspath(dest) != os.path.abspath(file_path):
                base, ext = os.path.splitext(filename)
                import hashlib, time
                tag = hashlib.md5(str(time.time()).encode()).hexdigest()[:6]
                filename = f"{base}_{tag}{ext}"
                dest = os.path.join(DZECK_FILES_DIR, filename)
            if os.path.abspath(file_path) != os.path.abspath(dest):
                shutil.copy2(file_path, dest)
    except Exception:
        pass
    return _make_download_url(dest)


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
        _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))
        is_sandbox_path = file.startswith("/home/user")

        file_content = None
        if _e2b_enabled:
            try:
                from server.agent.tools.e2b_sandbox import read_file as e2b_read, _resolve_sandbox_path
                sandbox_path = _resolve_sandbox_path(file)
                file_content = e2b_read(sandbox_path)
            except Exception:
                pass
            if file_content is None:
                local_fallback = os.path.join(DZECK_FILES_DIR, os.path.basename(file))
                if os.path.isfile(local_fallback) and DZECK_FILES_DIR.startswith("/tmp/"):
                    with open(local_fallback, "r", encoding="utf-8", errors="replace") as f:
                        file_content = f.read()
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
        write_content = content
        if leading_newline:
            write_content = "\n" + write_content
        if trailing_newline and not write_content.endswith("\n"):
            write_content = write_content + "\n"

        _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))
        is_sandbox_path = file.startswith("/home/user")
        is_output_path = "/output/" in file or file.startswith("/home/user/dzeck-ai/output")

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

        is_deliverable = is_output_path or file.startswith("/tmp/dzeck_files")

        if _e2b_enabled:
            local_path = os.path.join(DZECK_FILES_DIR, os.path.basename(file))
            is_deliverable = True
        elif is_deliverable:
            local_path = os.path.join(DZECK_FILES_DIR, os.path.basename(file))
        elif is_sandbox_path:
            local_path = os.path.join(DZECK_FILES_DIR, os.path.basename(file))
        else:
            local_path = file

        parent_dir = os.path.dirname(local_path)
        if parent_dir and not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)

        mode = "a" if append else "w"
        with open(local_path, mode, encoding="utf-8") as f:
            f.write(write_content)

        operation = "appended" if append else "written"
        download_url = ""
        if is_deliverable:
            download_url = _register_file_for_download(local_path)

        content_preview = content[:1000]
        if len(content) > 1000:
            content_preview += "\n... (truncated, total {} chars)".format(len(content))

        ext = os.path.splitext(file)[1].lstrip(".") if "." in os.path.basename(file) else ""
        lang_hint = ext if ext in ("py", "js", "ts", "tsx", "jsx", "html", "css", "json", "yaml", "yml", "sh", "bash", "sql", "md", "xml", "svg", "java", "cpp", "c", "go", "rs", "rb") else ""

        msg = "File {op} successfully: {f} ({b} bytes)".format(op=operation, f=file, b=len(write_content))
        if _e2b_enabled and e2b_ok:
            msg += "\n✅ File tersimpan di E2B sandbox (tidak di project lokal)."
        if is_deliverable and download_url:
            msg += "\n📎 File siap didownload."
        msg += "\n\nContent preview:\n```{lang}\n{preview}\n```".format(
            lang=lang_hint, preview=content_preview
        )

        return ToolResult(
            success=True,
            message=msg,
            data={
                "file": file,
                "local_path": local_path,
                "operation": operation,
                "bytes_written": len(write_content),
                "download_url": download_url,
                "filename": os.path.basename(file),
                "is_deliverable": is_deliverable,
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
        is_sandbox_path = file.startswith("/home/user")

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
            local_fallback = os.path.join(DZECK_FILES_DIR, os.path.basename(file))
            if os.path.isfile(local_fallback) and DZECK_FILES_DIR.startswith("/tmp/"):
                with open(local_fallback, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()

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

        is_output_path = "/output/" in file or file.startswith("/home/user/dzeck-ai/output")
        is_deliverable = is_output_path or file.startswith("/tmp/dzeck_files")

        local_path = os.path.join(DZECK_FILES_DIR, os.path.basename(file))
        if is_output_path:
            is_deliverable = True

        parent_dir = os.path.dirname(local_path)
        if parent_dir and not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)

        with open(local_path, "w", encoding="utf-8") as f:
            f.write(new_content)

        download_url = ""
        if is_deliverable:
            download_url = _register_file_for_download(local_path)

        return ToolResult(
            success=True,
            message=f"Replaced {count} occurrence(s) in {file}",
            data={
                "file": file,
                "local_path": local_path,
                "replacements": count,
                "download_url": download_url,
                "filename": os.path.basename(file),
                "is_deliverable": is_deliverable,
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
    if _e2b_enabled and (path.startswith("/home/user") or path.startswith("/tmp")):
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

    try:
        if not os.path.isdir(path):
            return ToolResult(success=False, message=f"Directory not found: {path}", data={"error": "not_found", "path": path})

        search_pattern = os.path.join(path, glob)
        files = glob_module.glob(search_pattern, recursive=True)
        files = [f for f in files if os.path.isfile(f)]

        if not pattern:
            file_list = "\n".join(files[:50])
            return ToolResult(
                success=True,
                message=f"Found {len(files)} files matching '{glob}' in {path}:\n{file_list}",
                data={"path": path, "glob": glob, "files": files[:50], "count": len(files)},
            )

        try:
            regex = re.compile(pattern)
        except re.error:
            regex = re.compile(re.escape(pattern))

        matches = []
        for fpath in files[:200]:
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    for i, line in enumerate(f, start=1):
                        if regex.search(line):
                            matches.append(f"{fpath}:{i}: {line.rstrip()}")
                            if len(matches) >= 100:
                                break
            except Exception:
                continue
            if len(matches) >= 100:
                break

        if not matches:
            return ToolResult(
                success=True,
                message=f"No matches found for '{pattern}' in {path}/{glob}",
                data={"path": path, "glob": glob, "pattern": pattern, "matches": [], "count": 0},
            )

        result_text = "\n".join(matches[:50])
        return ToolResult(
            success=True,
            message=f"Found {len(matches)} match(es) for '{pattern}':\n{result_text}",
            data={"path": path, "glob": glob, "pattern": pattern, "matches": matches[:50], "count": len(matches)},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to search: {str(e)}", data={"error": str(e), "path": path})


def file_find_by_name(
    path: str,
    glob: str = "*",
    **kwargs,
) -> ToolResult:
    """Find files matching a glob pattern in a directory. Uses E2B sandbox when available."""
    _e2b_enabled = bool(os.environ.get("E2B_API_KEY", ""))

    # E2B path: run find command inside sandbox
    if _e2b_enabled and (path.startswith("/home/user") or path.startswith("/tmp")):
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

    # Local fallback
    try:
        if not os.path.isdir(path):
            return ToolResult(success=False, message=f"Directory not found: {path}", data={"error": "not_found", "path": path})

        search_pattern = os.path.join(path, glob)
        files = glob_module.glob(search_pattern, recursive=True)

        max_files = 100
        truncated = len(files) > max_files
        files = sorted(files)[:max_files]

        file_list = "\n".join(files)
        msg = f"Found {len(files)} file(s) matching '{glob}' in {path}"
        if truncated:
            msg += f" (truncated to {max_files})"
        msg += f":\n{file_list}"

        return ToolResult(
            success=True,
            message=msg,
            data={"path": path, "pattern": glob, "files": files, "count": len(files), "truncated": truncated},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to find files: {str(e)}", data={"error": str(e), "path": path})


def image_view(image: str, **kwargs) -> ToolResult:
    """View an image file (returns base64 encoded content)."""
    try:
        if not os.path.isfile(image):
            return ToolResult(success=False, message=f"Image not found: {image}", data={"error": "not_found", "image": image})

        ext = os.path.splitext(image)[1].lower()
        mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml"}
        mime = mime_map.get(ext, "image/png")
        size = os.path.getsize(image)

        with open(image, "rb") as f:
            data = f.read(102400)  # Read up to 100KB
        b64 = base64.b64encode(data).decode()
        data_uri = f"data:{mime};base64,{b64}"

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
