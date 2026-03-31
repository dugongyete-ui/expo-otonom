"""
Multimedia tools for Dzeck AI Agent.
All operations run inside the E2B sandbox via shell commands.
Replaces manus-* CLI binaries with portable alternatives:
  - export_pdf     -> pandoc (md -> pdf via wkhtmltopdf or weasyprint) or python-pdfkit
  - render_diagram -> mermaid-js CLI (mmdc) or graphviz dot
  - speech_to_text -> openai-whisper or faster-whisper (runs in E2B sandbox)
  - export_slides  -> pandoc (md/html -> pdf/pptx)
  - upload_file    -> multipart HTTP POST to /api/files endpoint or base64 embed
"""
import logging
import shlex
from typing import Optional

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

logger = logging.getLogger(__name__)


def _shell_run(command: str, timeout: int = 120) -> dict:
    """Run command in E2B sandbox."""
    from server.agent.tools.e2b_sandbox import get_sandbox
    sb = get_sandbox()
    if sb is None:
        return {"exit_code": -1, "stdout": "", "stderr": "E2B sandbox not available"}
    try:
        result = sb.commands.run(command, timeout=timeout)
        return {
            "exit_code": result.exit_code if hasattr(result, "exit_code") else 0,
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
        }
    except Exception as e:
        return {"exit_code": -1, "stdout": "", "stderr": str(e)}


def _file_exists(path: str) -> bool:
    r = _shell_run(f"test -f {path} && echo 'exists'", timeout=10)
    return "exists" in r["stdout"]


class MultimediaTool(BaseTool):
    """Multimedia processing tools (PDF, diagram, speech, slides, upload)."""

    @tool(
        name="export_pdf",
        description=(
            "Convert a Markdown or HTML file to PDF inside the E2B sandbox. "
            "Uses pandoc with wkhtmltopdf or weasyprint as the PDF engine. "
            "The input file must exist in the E2B sandbox. "
            "If output_path is not provided, it defaults to the same name as input with .pdf extension. "
            "Returns the path of the generated PDF."
        ),
        parameters={
            "input_path": {
                "type": "string",
                "description": "Absolute path to the Markdown (.md) or HTML file inside the sandbox",
            },
            "output_path": {
                "type": "string",
                "description": "Absolute path for the output PDF file. Defaults to input_path with .pdf extension.",
            },
        },
        required=["input_path"],
    )
    def export_pdf(self, input_path: str, output_path: Optional[str] = None) -> ToolResult:
        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + ".pdf" if "." in input_path else input_path + ".pdf"

        # Ensure pandoc is available, install if needed
        check = _shell_run("which pandoc 2>/dev/null && echo ok", timeout=10)
        if "ok" not in check["stdout"]:
            _shell_run(
                "pip install --break-system-packages weasyprint 2>/dev/null; "
                "apt-get install -y -q pandoc 2>/dev/null || true",
                timeout=120,
            )

        parent_dir = "/".join(output_path.split("/")[:-1])
        if parent_dir:
            _shell_run(f"mkdir -p {shlex.quote(parent_dir)}", timeout=10)

        inp_q = shlex.quote(input_path)
        out_q = shlex.quote(output_path)
        # Try pandoc with weasyprint engine first (no X11 needed)
        cmd = (
            f"pandoc {inp_q} -o {out_q} "
            f"--pdf-engine=weasyprint 2>&1 || "
            f"pandoc {inp_q} -o {out_q} "
            f"--pdf-engine=wkhtmltopdf 2>&1 || "
            f"pandoc {inp_q} -o {out_q} 2>&1"
        )
        result = _shell_run(cmd, timeout=120)

        if _file_exists(output_path):
            return ToolResult(
                success=True,
                message=f"PDF generated successfully: {output_path}",
                data={"output_path": output_path, "input_path": input_path},
            )

        # Pandoc failed — try pdfkit (wkhtmltopdf Python wrapper) as last resort
        pkg_check = _shell_run("python3 -c 'import pdfkit; print(\"ok\")' 2>/dev/null", timeout=10)
        if "ok" not in pkg_check["stdout"]:
            _shell_run("pip install --break-system-packages pdfkit 2>/dev/null || true", timeout=60)
        _pdfkit_script = (
            "import pdfkit, sys; "
            "pdfkit.from_file(sys.argv[1], sys.argv[2])"
        )
        pdfkit_result = _shell_run(
            f"python3 -c {shlex.quote(_pdfkit_script)} {inp_q} {out_q} 2>&1",
            timeout=60,
        )
        if _file_exists(output_path):
            return ToolResult(
                success=True,
                message=f"PDF generated via pdfkit: {output_path}",
                data={"output_path": output_path, "input_path": input_path},
            )

        return ToolResult(
            success=False,
            message=(
                f"PDF conversion failed with all engines (pandoc + pdfkit). "
                f"Pandoc error: {result['stderr'] or result['stdout']}. "
                f"pdfkit error: {pdfkit_result['stderr'] or pdfkit_result['stdout']}"
            ),
        )

    @tool(
        name="render_diagram",
        description=(
            "Render a diagram file to PNG inside the E2B sandbox. "
            "Supports Mermaid (.mmd) using mmdc (mermaid-js CLI) and "
            "GraphViz dot (.dot/.gv) using the graphviz package. "
            "Returns the path of the generated PNG image."
        ),
        parameters={
            "input_path": {
                "type": "string",
                "description": "Absolute path to the diagram file (.mmd, .dot, .gv) inside the sandbox",
            },
            "output_path": {
                "type": "string",
                "description": "Absolute path for the output PNG. Defaults to input_path with .png extension.",
            },
        },
        required=["input_path"],
    )
    def render_diagram(self, input_path: str, output_path: Optional[str] = None) -> ToolResult:
        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + ".png" if "." in input_path else input_path + ".png"

        parent_dir = "/".join(output_path.split("/")[:-1])
        if parent_dir:
            _shell_run(f"mkdir -p {shlex.quote(parent_dir)}", timeout=10)

        ext = input_path.rsplit(".", 1)[-1].lower() if "." in input_path else ""
        inp_q = shlex.quote(input_path)
        out_q = shlex.quote(output_path)

        if ext == "mmd":
            # Try mmdc (mermaid CLI) — install via npm if missing
            check = _shell_run("which mmdc 2>/dev/null && echo ok", timeout=10)
            if "ok" not in check["stdout"]:
                _shell_run(
                    "npm install -g @mermaid-js/mermaid-cli 2>/dev/null || "
                    "npx @mermaid-js/mermaid-cli --help 2>/dev/null || true",
                    timeout=120,
                )
            result = _shell_run(
                f"mmdc -i {inp_q} -o {out_q} --puppeteerConfig '{{\"args\":[\"--no-sandbox\"]}}' 2>&1 || "
                f"npx mmdc -i {inp_q} -o {out_q} 2>&1",
                timeout=120,
            )
            if _file_exists(output_path):
                return ToolResult(
                    success=True,
                    message=f"Diagram rendered successfully: {output_path}",
                    data={"output_path": output_path, "input_path": input_path},
                )
            # mmdc failed — fall back to Graphviz by converting Mermaid to a simple dot graph
            _mmd_to_dot_script = (
                "import sys, re; "
                "src = open(sys.argv[1]).read(); "
                "nodes = re.findall(r'([A-Za-z0-9_]+)\\s*-->\\s*\\|?[^|]*\\|?\\s*([A-Za-z0-9_]+)', src); "
                "edges = '\\n'.join(f'  {a} -> {b};' for a,b in nodes) or '  placeholder;'; "
                "open(sys.argv[2], 'w').write(f'digraph G {{\\n{edges}\\n}}')"
            )
            dot_tmp = output_path.replace(".png", "_fallback.dot")
            _shell_run(
                f"python3 -c {shlex.quote(_mmd_to_dot_script)} {inp_q} {shlex.quote(dot_tmp)} 2>&1",
                timeout=15,
            )
            gv_check = _shell_run("which dot 2>/dev/null && echo ok", timeout=10)
            if "ok" not in gv_check["stdout"]:
                _shell_run("apt-get install -y -q graphviz 2>/dev/null || true", timeout=120)
            gv_result = _shell_run(f"dot -Tpng {shlex.quote(dot_tmp)} -o {out_q} 2>&1", timeout=60)
            if _file_exists(output_path):
                return ToolResult(
                    success=True,
                    message=f"Diagram rendered via Graphviz fallback (mmdc unavailable): {output_path}",
                    data={"output_path": output_path, "input_path": input_path, "engine": "graphviz_fallback"},
                )
            return ToolResult(
                success=False,
                message=(
                    f"Diagram rendering failed — mmdc error: {result['stderr'] or result['stdout']}; "
                    f"Graphviz fallback error: {gv_result['stderr'] or gv_result['stdout']}"
                ),
            )
        else:
            # GraphViz dot for .dot/.gv and fallback
            check = _shell_run("which dot 2>/dev/null && echo ok", timeout=10)
            if "ok" not in check["stdout"]:
                _shell_run("apt-get install -y -q graphviz 2>/dev/null || true", timeout=120)
            result = _shell_run(f"dot -Tpng {inp_q} -o {out_q} 2>&1", timeout=120)

        if _file_exists(output_path):
            return ToolResult(
                success=True,
                message=f"Diagram rendered successfully: {output_path}",
                data={"output_path": output_path, "input_path": input_path},
            )
        return ToolResult(
            success=False,
            message=f"Diagram rendering failed: {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="speech_to_text",
        description=(
            "Transcribe an audio file to text inside the E2B sandbox using openai-whisper. "
            "Supports common audio formats (MP3, WAV, OGG, M4A, FLAC). "
            "Returns the transcribed text."
        ),
        parameters={
            "input_path": {
                "type": "string",
                "description": "Absolute path to the audio file inside the sandbox",
            },
        },
        required=["input_path"],
    )
    def speech_to_text(self, input_path: str) -> ToolResult:
        # Check if whisper is available; install with a shorter timeout to avoid silent hang
        check = _shell_run("python3 -c 'import whisper; print(\"ok\")' 2>/dev/null", timeout=15)
        if "ok" not in check["stdout"]:
            inst = _shell_run(
                "pip install --break-system-packages openai-whisper 2>&1 | tail -5",
                timeout=120,
            )
            # Re-verify import after install attempt (catches silent install failures)
            check2 = _shell_run("python3 -c 'import whisper; print(\"ok\")' 2>/dev/null", timeout=15)
            if "ok" not in check2["stdout"]:
                return ToolResult(
                    success=False,
                    message=(
                        "openai-whisper tidak tersedia di sandbox dan gagal diinstall. "
                        "Pastikan pip bisa mengakses PyPI di dalam sandbox E2B. "
                        f"Detail: {inst.get('stderr') or inst.get('stdout') or 'unknown error'}"
                    ),
                )

        script = (
            "import whisper, json, sys; "
            "model = whisper.load_model('base'); "
            "result = model.transcribe(sys.argv[1]); "
            "print(result['text'])"
        )
        result = _shell_run(f"python3 -c \"{script}\" {shlex.quote(input_path)} 2>&1", timeout=300)

        if result["exit_code"] == 0:
            transcript = result["stdout"].strip()
            if transcript:
                return ToolResult(
                    success=True,
                    message="Audio transcribed successfully",
                    data={"transcript": transcript, "input_path": input_path},
                )
            return ToolResult(
                success=False,
                message="Whisper returned empty transcript",
            )
        return ToolResult(
            success=False,
            message=f"Speech-to-text failed (exit {result['exit_code']}): {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="export_slides",
        description=(
            "Export a Markdown or HTML presentation to PDF or PPTX inside the E2B sandbox. "
            "Uses pandoc for conversion. "
            "Returns the path of the exported file."
        ),
        parameters={
            "input_path": {
                "type": "string",
                "description": "Absolute path to the input presentation file",
            },
            "output_path": {
                "type": "string",
                "description": "Absolute path for the exported file. Defaults to input_path with appropriate extension.",
            },
            "format": {
                "type": "string",
                "enum": ["pdf", "pptx"],
                "description": "Output format: 'pdf' or 'pptx'. Defaults to 'pdf'.",
            },
        },
        required=["input_path"],
    )
    def export_slides(self, input_path: str, output_path: Optional[str] = None, format: str = "pdf") -> ToolResult:
        fmt = format.lower() if format else "pdf"
        if fmt not in ("pdf", "pptx"):
            fmt = "pdf"

        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + f".{fmt}" if "." in input_path else input_path + f".{fmt}"

        # Ensure pandoc is available (same guard as export_pdf)
        check = _shell_run("which pandoc 2>/dev/null && echo ok", timeout=10)
        if "ok" not in check["stdout"]:
            _shell_run(
                "pip install --break-system-packages weasyprint 2>/dev/null; "
                "apt-get install -y -q pandoc 2>/dev/null || true",
                timeout=120,
            )

        parent_dir = "/".join(output_path.split("/")[:-1])
        if parent_dir:
            _shell_run(f"mkdir -p {shlex.quote(parent_dir)}", timeout=10)

        inp_q = shlex.quote(input_path)
        out_q = shlex.quote(output_path)
        if fmt == "pdf":
            cmd = (
                f"pandoc {inp_q} -o {out_q} "
                f"--pdf-engine=weasyprint 2>&1 || "
                f"pandoc {inp_q} -o {out_q} "
                f"--pdf-engine=wkhtmltopdf 2>&1 || "
                f"pandoc {inp_q} -o {out_q} 2>&1"
            )
        else:
            cmd = f"pandoc {inp_q} -o {out_q} 2>&1"

        result = _shell_run(cmd, timeout=180)

        if _file_exists(output_path):
            return ToolResult(
                success=True,
                message=f"Slides exported successfully: {output_path}",
                data={"output_path": output_path, "input_path": input_path, "format": fmt},
            )
        return ToolResult(
            success=False,
            message=f"Slides export failed: {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="upload_file",
        description=(
            "Make a file from the E2B sandbox available for download by generating a proxy download URL. "
            "Returns the download URL that can be used to retrieve the file."
        ),
        parameters={
            "input_path": {
                "type": "string",
                "description": "Absolute path to the file to upload inside the sandbox",
            },
        },
        required=["input_path"],
    )
    def upload_file(self, input_path: str) -> ToolResult:
        import os
        import urllib.parse
        import urllib.request
        import json as _json
        from server.agent.tools.e2b_sandbox import get_sandbox

        sb = get_sandbox()
        if sb is None:
            return ToolResult(success=False, message="E2B sandbox not available")

        sandbox_id = getattr(sb, "sandbox_id", "") or os.environ.get("DZECK_E2B_SANDBOX_ID", "")
        if not sandbox_id:
            return ToolResult(success=False, message="Cannot determine sandbox ID for download URL")

        # Verify file exists in sandbox
        if not _file_exists(input_path):
            return ToolResult(success=False, message=f"File not found in sandbox: {input_path}")

        filename = os.path.basename(input_path)
        encoded_sandbox_id = urllib.parse.quote(sandbox_id, safe="")
        encoded_path = urllib.parse.quote(input_path, safe="")
        encoded_name = urllib.parse.quote(filename, safe="")
        raw_download_url = (
            f"/api/files/download?sandbox_id={encoded_sandbox_id}"
            f"&path={encoded_path}&name={encoded_name}"
        )

        # Attempt to exchange for a one-time token via internal API (no auth required —
        # the internal call goes to localhost and the token endpoint generates a TTL token
        # so mobile clients (Expo Go) can use Linking.openURL without Bearer headers).
        # We use localhost for the token exchange HTTP call, but return only the *relative*
        # /api/files/download?...&token=... path — the client prepends its own origin.
        one_time_url = raw_download_url
        one_time_token: Optional[str] = None
        try:
            backend_port = os.environ.get("PORT", "5000")
            token_endpoint = f"http://localhost:{backend_port}/api/files/one-time-token"
            # Internal absolute URL used only for token exchange — not exposed to clients
            abs_download_url = (
                f"http://localhost:{backend_port}/api/files/download"
                f"?sandbox_id={encoded_sandbox_id}&path={encoded_path}&name={encoded_name}"
            )
            internal_secret = os.environ.get("DZECK_INTERNAL_SECRET", "")
            payload = _json.dumps({"download_url": abs_download_url}).encode("utf-8")
            req = urllib.request.Request(
                token_endpoint,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Internal-Secret": internal_secret,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp_data = _json.loads(resp.read().decode("utf-8"))
                tok = resp_data.get("token", "")
                if tok:
                    one_time_token = tok
                    # Build a relative URL so the client appends its own origin
                    one_time_url = (
                        f"/api/files/download?sandbox_id={encoded_sandbox_id}"
                        f"&path={encoded_path}&name={encoded_name}&token={urllib.parse.quote(tok, safe='')}"
                    )
        except Exception as _tok_err:
            # Token exchange failed — log as warning (not silent debug) so ops can diagnose
            logger.warning(
                "[MultimediaTool] One-time token exchange failed (%s) — "
                "returning raw download URL; mobile clients will need Bearer authorization header.",
                _tok_err,
            )

        return ToolResult(
            success=True,
            message=f"File ready for download: {one_time_url}",
            data={
                "url": one_time_url,
                "download_url": one_time_url,
                "token": one_time_token,
                "input_path": input_path,
                "filename": filename,
            },
        )


_multimedia_tool = MultimediaTool()


def export_pdf(input_path: str, output_path: Optional[str] = None) -> ToolResult:
    return _multimedia_tool.export_pdf(input_path=input_path, output_path=output_path)


def render_diagram(input_path: str, output_path: Optional[str] = None) -> ToolResult:
    return _multimedia_tool.render_diagram(input_path=input_path, output_path=output_path)


def speech_to_text(input_path: str) -> ToolResult:
    return _multimedia_tool.speech_to_text(input_path=input_path)


def export_slides(input_path: str, output_path: Optional[str] = None, format: str = "pdf") -> ToolResult:
    return _multimedia_tool.export_slides(input_path=input_path, output_path=output_path, format=format)


def upload_file(input_path: str) -> ToolResult:
    return _multimedia_tool.upload_file(input_path=input_path)
