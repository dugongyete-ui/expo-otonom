"""
Idle tool for Dzeck AI Agent.
Provides the 'idle' action referenced in multi-agent prompts.
Used when the agent needs to wait or has no immediate action to take.
"""
from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool


# ─── Backward-compatible function ────────────────────────────────────────────

def idle(success: bool = True, result: str = "Step completed") -> ToolResult:
    """Signal that the agent is idle / all tasks completed. Returns success status and result summary."""
    return ToolResult(
        success=success,
        message=result,
        data={"type": "idle", "success": success, "result": result},
    )


# ─── Class-based IdleTool (Manus pattern) ────────────────────────────────────

class IdleTool(BaseTool):
    """Idle tool class - signals the agent has no immediate action."""

    name: str = "idle"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="idle",
        description=(
            "Alat khusus untuk menandakan bahwa semua tugas telah selesai dan agen siap kembali ke idle.\n\n"
            "Hanya gunakan saat SEMUA kondisi ini terpenuhi:\n"
            "1. Semua tugas sudah selesai sempurna, ditest, dan terverifikasi\n"
            "2. Semua hasil dan output sudah dikirim ke user melalui message tools\n"
            "3. Tidak ada tindakan lanjut yang diperlukan"
        ),
        parameters={
            "success": {
                "type": "boolean",
                "description": "Apakah langkah berhasil",
            },
            "result": {
                "type": "string",
                "description": "Ringkasan apa yang sudah dikerjakan",
            },
        },
        required=["success", "result"],
    )
    def _idle(self, success: bool = True, result: str = "Step completed") -> ToolResult:
        return idle(success=success, result=result)
