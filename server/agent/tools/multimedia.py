"""
Multimedia tools for Dzeck AI Agent.
Wrappers for manus-* CLI binaries available in the E2B sandbox:
  - manus-md-to-pdf      -> export_pdf
  - manus-render-diagram -> render_diagram
  - manus-speech-to-text -> speech_to_text
  - manus-export-slides  -> export_slides
  - manus-upload-file    -> upload_file

All operations run inside the E2B sandbox via shell_exec.
"""
import logging
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


class MultimediaTool(BaseTool):
    """Multimedia processing tools (PDF, diagram, speech, slides, upload)."""

    @tool(
        name="export_pdf",
        description=(
            "Convert a Markdown file to PDF using manus-md-to-pdf. "
            "The input file must exist in the E2B sandbox. "
            "If output_path is not provided, it defaults to the same name as input with .pdf extension. "
            "Returns the path of the generated PDF."
        ),
        parameters={
            "type": "object",
            "properties": {
                "input_path": {
                    "type": "string",
                    "description": "Absolute path to the Markdown (.md) file inside the sandbox",
                },
                "output_path": {
                    "type": "string",
                    "description": "Absolute path for the output PDF file. Defaults to input_path with .pdf extension.",
                },
            },
            "required": ["input_path"],
        },
    )
    def export_pdf(self, input_path: str, output_path: Optional[str] = None) -> ToolResult:
        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + ".pdf" if "." in input_path else input_path + ".pdf"

        cmd = f"manus-md-to-pdf {input_path} {output_path} 2>&1"
        result = _shell_run(cmd, timeout=120)

        if result["exit_code"] == 0:
            verify = _shell_run(f"test -f {output_path} && echo 'exists'", timeout=10)
            if "exists" in verify["stdout"]:
                return ToolResult(
                    success=True,
                    message=f"PDF generated successfully: {output_path}",
                    data={"output_path": output_path, "input_path": input_path},
                )
            return ToolResult(
                success=False,
                message=f"manus-md-to-pdf ran but output file not found at {output_path}",
            )
        return ToolResult(
            success=False,
            message=f"PDF conversion failed (exit {result['exit_code']}): {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="render_diagram",
        description=(
            "Render a diagram file to PNG using manus-render-diagram. "
            "Supports Mermaid (.mmd), D2 (.d2), PlantUML (.puml), and Markdown with diagram fences (.md). "
            "Returns the path of the generated PNG image."
        ),
        parameters={
            "type": "object",
            "properties": {
                "input_path": {
                    "type": "string",
                    "description": "Absolute path to the diagram file (.mmd, .d2, .puml, or .md)",
                },
                "output_path": {
                    "type": "string",
                    "description": "Absolute path for the output PNG. Defaults to input_path with .png extension.",
                },
            },
            "required": ["input_path"],
        },
    )
    def render_diagram(self, input_path: str, output_path: Optional[str] = None) -> ToolResult:
        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + ".png" if "." in input_path else input_path + ".png"

        cmd = f"manus-render-diagram {input_path} {output_path} 2>&1"
        result = _shell_run(cmd, timeout=120)

        if result["exit_code"] == 0:
            verify = _shell_run(f"test -f {output_path} && echo 'exists'", timeout=10)
            if "exists" in verify["stdout"]:
                return ToolResult(
                    success=True,
                    message=f"Diagram rendered successfully: {output_path}",
                    data={"output_path": output_path, "input_path": input_path},
                )
            return ToolResult(
                success=False,
                message=f"manus-render-diagram ran but output not found at {output_path}",
            )
        return ToolResult(
            success=False,
            message=f"Diagram rendering failed (exit {result['exit_code']}): {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="speech_to_text",
        description=(
            "Transcribe an audio/speech file to text using manus-speech-to-text. "
            "Supports common audio formats (MP3, WAV, OGG, M4A, FLAC). "
            "Returns the transcribed text."
        ),
        parameters={
            "type": "object",
            "properties": {
                "input_path": {
                    "type": "string",
                    "description": "Absolute path to the audio file inside the sandbox",
                },
            },
            "required": ["input_path"],
        },
    )
    def speech_to_text(self, input_path: str) -> ToolResult:
        cmd = f"manus-speech-to-text {input_path} 2>&1"
        result = _shell_run(cmd, timeout=300)

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
                message="manus-speech-to-text returned empty transcript",
            )
        return ToolResult(
            success=False,
            message=f"Speech-to-text failed (exit {result['exit_code']}): {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="export_slides",
        description=(
            "Export a presentation file to slides format using manus-export-slides. "
            "Supports converting Markdown or HTML presentations to PDF or PPTX. "
            "Returns the path of the exported file."
        ),
        parameters={
            "type": "object",
            "properties": {
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
            "required": ["input_path"],
        },
    )
    def export_slides(self, input_path: str, output_path: Optional[str] = None, format: str = "pdf") -> ToolResult:
        fmt = format.lower() if format else "pdf"
        if fmt not in ("pdf", "pptx"):
            fmt = "pdf"

        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + f".{fmt}" if "." in input_path else input_path + f".{fmt}"

        cmd = f"manus-export-slides {input_path} {output_path} 2>&1"
        result = _shell_run(cmd, timeout=180)

        if result["exit_code"] == 0:
            verify = _shell_run(f"test -f {output_path} && echo 'exists'", timeout=10)
            if "exists" in verify["stdout"]:
                return ToolResult(
                    success=True,
                    message=f"Slides exported successfully: {output_path}",
                    data={"output_path": output_path, "input_path": input_path, "format": fmt},
                )
            return ToolResult(
                success=False,
                message=f"manus-export-slides ran but output not found at {output_path}",
            )
        return ToolResult(
            success=False,
            message=f"Slides export failed (exit {result['exit_code']}): {result['stderr'] or result['stdout']}",
        )

    @tool(
        name="upload_file",
        description=(
            "Upload a file from the E2B sandbox to public storage using manus-upload-file. "
            "Returns the public URL of the uploaded file."
        ),
        parameters={
            "type": "object",
            "properties": {
                "input_path": {
                    "type": "string",
                    "description": "Absolute path to the file to upload inside the sandbox",
                },
            },
            "required": ["input_path"],
        },
    )
    def upload_file(self, input_path: str) -> ToolResult:
        cmd = f"manus-upload-file {input_path} 2>&1"
        result = _shell_run(cmd, timeout=120)

        if result["exit_code"] == 0:
            url = result["stdout"].strip()
            if url.startswith("http"):
                return ToolResult(
                    success=True,
                    message=f"File uploaded successfully: {url}",
                    data={"url": url, "input_path": input_path},
                )
            return ToolResult(
                success=False,
                message=f"Upload completed but no URL returned: {url}",
            )
        return ToolResult(
            success=False,
            message=f"File upload failed (exit {result['exit_code']}): {result['stderr'] or result['stdout']}",
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
