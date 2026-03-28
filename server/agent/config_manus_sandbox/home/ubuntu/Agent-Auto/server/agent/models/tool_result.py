"""
ToolResult model matching ai-manus architecture.
Generic result type for all tool operations.
"""
from typing import Generic, TypeVar, Optional
from pydantic import BaseModel

T = TypeVar("T")


class ToolResult(BaseModel):
    """Generic result from tool execution."""

    success: bool = True
    message: Optional[str] = None
    data: Optional[dict] = None

    def __str__(self) -> str:
        if self.message:
            return self.message
        return "Success" if self.success else "Failed"
