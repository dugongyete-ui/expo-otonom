"""
Event models for the AI agent.
Matching ai-manus event architecture with typed events for SSE streaming.

Ported from ai-manus: app/domain/models/event.py
Provides complete event hierarchy for Plan-Act flow communication.
"""
import uuid
import time
from enum import Enum
from typing import Optional, Dict, Any, List, Union
from pydantic import BaseModel, Field


class PlanStatus(str, Enum):
    CREATING = "creating"
    CREATED = "created"
    UPDATING = "updating"
    UPDATED = "updated"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ToolStatus(str, Enum):
    CALLING = "calling"
    CALLED = "called"
    ERROR = "error"


# Tool content models matching ai-manus
class BrowserToolContent(BaseModel):
    """Content for browser tool events."""
    url: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    screenshot: Optional[str] = None


class SearchToolContent(BaseModel):
    """Content for search tool events."""
    query: Optional[str] = None
    results: List[Dict[str, Any]] = Field(default_factory=list)


class ShellToolContent(BaseModel):
    """Content for shell tool events."""
    command: Optional[str] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    return_code: Optional[int] = None


class FileToolContent(BaseModel):
    """Content for file tool events."""
    file: Optional[str] = None
    content: Optional[str] = None
    operation: Optional[str] = None


class McpToolContent(BaseModel):
    """Content for MCP tool events."""
    server: Optional[str] = None
    tool: Optional[str] = None
    result: Optional[Any] = None


# Union type for tool content
ToolContent = Union[
    BrowserToolContent, SearchToolContent, ShellToolContent,
    FileToolContent, McpToolContent, Dict[str, Any]
]


class BaseEvent(BaseModel):
    """Base event class for all agent events."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: float = Field(default_factory=time.time)
    type: str = "base"

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump(exclude_none=True)

    def to_json(self) -> str:
        return self.model_dump_json(exclude_none=True)


class PlanEvent(BaseEvent):
    """Event for plan creation/updates."""
    type: str = "plan"
    plan: Optional[Dict[str, Any]] = None
    status: PlanStatus = PlanStatus.CREATING
    step: Optional[Dict[str, Any]] = None


class StepEvent(BaseEvent):
    """Event for step status changes."""
    type: str = "step"
    step: Optional[Dict[str, Any]] = None
    status: StepStatus = StepStatus.PENDING


class ToolEvent(BaseEvent):
    """Event for tool calls and results."""
    type: str = "tool"
    tool_call_id: Optional[str] = None
    tool_name: str = ""
    tool_content: Optional[Dict[str, Any]] = None
    function_name: str = ""
    function_args: Dict[str, Any] = Field(default_factory=dict)
    status: ToolStatus = ToolStatus.CALLING
    function_result: Optional[Any] = None


class MessageEvent(BaseEvent):
    """Event for messages to/from user."""
    type: str = "message"
    role: str = "assistant"
    message: str = ""
    attachments: List[Dict[str, Any]] = Field(default_factory=list)


class ErrorEvent(BaseEvent):
    """Event for errors."""
    type: str = "error"
    error: str = ""
    details: Optional[str] = None


class DoneEvent(BaseEvent):
    """Event signaling agent completion."""
    type: str = "done"
    success: bool = True


class TitleEvent(BaseEvent):
    """Event for setting conversation title."""
    type: str = "title"
    title: str = ""


class ThinkingEvent(BaseEvent):
    """Event for agent thinking/reasoning."""
    type: str = "thinking"
    content: str = ""


class WaitEvent(BaseEvent):
    """Event for waiting on user input (matching ai-manus)."""
    type: str = "wait"
    prompt: Optional[str] = None


# Union type for all agent events
AgentEvent = Union[
    ErrorEvent, PlanEvent, ToolEvent, StepEvent,
    MessageEvent, DoneEvent, TitleEvent, ThinkingEvent, WaitEvent
]
