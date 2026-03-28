"""
Message tools for Dzeck AI Agent.
Upgraded to class-based architecture from Ai-DzeckV2 (Manus) pattern.
Provides: MessageTool class + backward-compatible functions.
"""
from typing import Optional, List

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool


# ─── Backward-compatible functions ───────────────────────────────────────────

def message_notify_user(text: str, attachments: Optional[List[str]] = None) -> ToolResult:
    """Send a progress notification to the user (non-blocking)."""
    return ToolResult(
        success=True,
        message=text,
        data={"type": "notify", "text": text, "attachments": attachments or []},
    )


def message_ask_user(
    text: str,
    attachments: Optional[List[str]] = None,
    suggest_user_takeover: str = "none",
) -> ToolResult:
    """Ask the user a question and wait for response (blocking)."""
    return ToolResult(
        success=True,
        message=text,
        data={
            "type": "ask",
            "text": text,
            "attachments": attachments or [],
            "suggest_user_takeover": suggest_user_takeover,
        },
    )


# ─── Class-based MessageTool (Ai-DzeckV2 / Manus pattern) ───────────────────

class MessageTool(BaseTool):
    """Message tool class - provides user communication capabilities."""

    name: str = "message"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="message_notify_user",
        description=(
            "Send a message/notification to the user (non-blocking). "
            "Use for: acknowledging tasks, reporting progress milestones, sharing interim results, "
            "explaining strategy changes, or delivering final outputs. "
            "This does NOT pause agent execution."
        ),
        parameters={
            "text": {"type": "string", "description": "Message text to send to the user"},
            "attachments": {
                "type": "array",
                "items": {"type": "string"},
                "description": "(Optional) List of file paths to attach to the message",
            },
        },
        required=["text"],
    )
    def _message_notify_user(self, text: str, attachments: Optional[List[str]] = None) -> ToolResult:
        return message_notify_user(text=text, attachments=attachments)

    @tool(
        name="message_ask_user",
        description=(
            "Ask the user a question and WAIT for their response (blocking). "
            "Use only when user input is essential to proceed. "
            "Use for: clarifying ambiguous requirements, requesting credentials/permissions, "
            "or suggesting browser takeover for sensitive operations."
        ),
        parameters={
            "text": {"type": "string", "description": "Question to ask the user"},
            "attachments": {
                "type": "array",
                "items": {"type": "string"},
                "description": "(Optional) List of file paths to attach to the question",
            },
            "suggest_user_takeover": {
                "type": "string",
                "enum": ["none", "browser", "shell"],
                "description": "(Optional) Suggest user takes over the browser or shell",
            },
        },
        required=["text"],
    )
    def _message_ask_user(self, text: str, attachments: Optional[List[str]] = None, suggest_user_takeover: str = "none") -> ToolResult:
        return message_ask_user(text=text, attachments=attachments, suggest_user_takeover=suggest_user_takeover)
