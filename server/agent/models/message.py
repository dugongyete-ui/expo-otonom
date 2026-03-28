"""
Message model for the AI agent.
Matching ai-manus message architecture.
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class FileInfo(BaseModel):
    """File attachment information."""
    name: str = ""
    path: str = ""
    content_type: str = ""
    size: int = 0


class Message(BaseModel):
    """Chat message with optional attachments."""
    role: str = "user"
    content: str = ""
    attachments: List[FileInfo] = Field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()
