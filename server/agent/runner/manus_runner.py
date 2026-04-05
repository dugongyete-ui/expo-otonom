"""
Manus Runner — ai-manus compatible agent runner using PlanActFlow.

This module provides `run_plan_act_flow_async`, the public entry point for
running the ai-manus PlanActFlow state machine (IDLE→PLANNING→EXECUTING→
UPDATING→SUMMARIZING→COMPLETED) as an async generator of raw event dicts.

It also implements AgentTaskRunner-equivalent session persistence:
  - Title updates written to MongoDB on TitleEvent
  - Message history appended on MessageEvent
  - Status transitions written on start/complete/fail
  - Event log persisted to sessions.event_log for replay via GET /sessions/:id

Usage (from Node.js subprocess bridge or tests):
    from server.agent.runner.manus_runner import run_plan_act_flow_async
    async for event_dict in run_plan_act_flow_async(message, session_id=sid):
        ...

The flow uses all existing tools from the tool registry (Shell, Browser, File,
Message, Search, MCP) and emits events matching ai-manus's SSE schema.
"""
import os
import logging
import datetime
from typing import Any, AsyncGenerator, Dict, List, Optional

from server.agent.flows.manus_flow import PlanActFlow, AgentStatus
from server.agent.models.event import (
    PlanEvent, StepEvent, ToolEvent, MessageEvent,
    ErrorEvent, DoneEvent, TitleEvent, WaitEvent,
    PlanStatus, StepStatus, ToolStatus,
)

logger = logging.getLogger(__name__)


def _build_tools_for_flow() -> list:
    """
    Build the list of BaseTool instances for the PlanActFlow.
    Matches the six tool categories from ai-manus.
    """
    tools = []
    try:
        from server.agent.tools.shell import ShellTool
        tools.append(ShellTool())
    except Exception as e:
        logger.warning(f"[manus_runner] ShellTool unavailable: {e}")

    try:
        from server.agent.tools.browser import BrowserTool
        tools.append(BrowserTool())
    except Exception as e:
        logger.warning(f"[manus_runner] BrowserTool unavailable: {e}")

    try:
        from server.agent.tools.file import FileTool
        tools.append(FileTool())
    except Exception as e:
        logger.warning(f"[manus_runner] FileTool unavailable: {e}")

    try:
        from server.agent.tools.message import MessageTool
        tools.append(MessageTool())
    except Exception as e:
        logger.warning(f"[manus_runner] MessageTool unavailable: {e}")

    try:
        from server.agent.tools.search import SearchTool
        tools.append(SearchTool())
    except Exception as e:
        logger.warning(f"[manus_runner] SearchTool unavailable: {e}")

    try:
        from server.agent.tools.mcp import MCPTool
        tools.append(MCPTool())
    except Exception as e:
        logger.warning(f"[manus_runner] MCPTool unavailable: {e}")

    return tools


def _event_to_dict(event: Any) -> Dict[str, Any]:
    """Convert a BaseEvent to a plain dict for serialization."""
    try:
        d = event.model_dump(exclude_none=True)
        return d
    except Exception:
        return {"type": getattr(event, "type", "unknown"), "error": str(event)}


def _get_mongo_collection(collection_name: str = "sessions"):
    """
    Return the MongoDB collection if available (best-effort).
    Uses the same MONGODB_URI env var as the Node.js server.
    """
    try:
        import pymongo
        uri = os.environ.get("MONGODB_URI", "")
        db_name = os.environ.get("MONGODB_DB", "dzeck")
        if not uri:
            return None
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        return client[db_name][collection_name]
    except Exception as e:
        logger.warning(f"[manus_runner] MongoDB unavailable: {e}")
        return None


class _SessionPersistence:
    """
    AgentTaskRunner-equivalent: persists session state to MongoDB.
    Equivalent to ai-manus AgentTaskRunner responsibilities:
      - title/message updates
      - waiting-state lifecycle
      - event log for replay
    """

    def __init__(self, session_id: Optional[str], user_id: str):
        self._session_id = session_id
        self._user_id = user_id
        self._col = None
        self._event_log: List[Dict[str, Any]] = []
        self._chat_history: List[Dict[str, Any]] = []

    def _get_col(self):
        if self._col is None and self._session_id:
            self._col = _get_mongo_collection("sessions")
        return self._col

    def _update(self, fields: Dict[str, Any]) -> None:
        if not self._session_id:
            return
        try:
            col = self._get_col()
            if col is not None:
                col.update_one(
                    {"session_id": self._session_id},
                    {"$set": {**fields, "updated_at": datetime.datetime.utcnow()}},
                )
        except Exception as e:
            logger.warning(f"[manus_runner] MongoDB update failed: {e}")

    def on_start(self, user_message: str) -> None:
        self._chat_history.append({"role": "user", "content": user_message})
        self._update({"status": "running", "user_id": self._user_id})

    def on_title(self, title: str) -> None:
        self._update({"title": title})

    def on_message(self, content: str, role: str = "assistant") -> None:
        self._chat_history.append({"role": role, "content": content})
        self._update({"chat_history": self._chat_history})

    def on_wait(self) -> None:
        self._update({"status": "waiting"})

    def on_wait_resume(self) -> None:
        self._update({"status": "running"})

    def on_event(self, event_dict: Dict[str, Any]) -> None:
        self._event_log.append(event_dict)

    def on_done(self, success: bool) -> None:
        self._update({
            "status": "completed" if success else "failed",
            "chat_history": self._chat_history,
            "event_log": self._event_log[-500:],  # cap at 500 events
        })


async def run_plan_act_flow_async(
    user_message: str,
    attachments: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    user_id: str = "auto-user",
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run the ai-manus compatible PlanActFlow and yield raw event dicts.

    This is the primary entry point for the ai-manus architecture.
    Each yielded dict represents one SSE event with 'type' and payload fields.
    Session state (title, messages, events, status) is persisted to MongoDB
    matching ai-manus AgentTaskRunner lifecycle behavior.

    State machine: IDLE → PLANNING → EXECUTING → UPDATING → SUMMARIZING → COMPLETED
    """
    agent_id = session_id or f"agent-{user_id}"
    logger.info(f"[manus_runner] Starting for agent={agent_id}, session={session_id}")

    persistence = _SessionPersistence(session_id=session_id, user_id=user_id)
    persistence.on_start(user_message)

    tools = _build_tools_for_flow()
    logger.info(f"[manus_runner] Loaded {len(tools)} tool categories")

    flow = PlanActFlow(
        agent_id=agent_id,
        tools=tools,
        session_id=session_id,
    )

    success = True
    try:
        async for event in flow.run(message=user_message, attachments=attachments or []):
            event_dict = _event_to_dict(event)
            persistence.on_event(event_dict)

            # AgentTaskRunner lifecycle hooks
            if isinstance(event, TitleEvent):
                persistence.on_title(event.title)
            elif isinstance(event, MessageEvent):
                persistence.on_message(event.message, role=event.role)
            elif isinstance(event, WaitEvent):
                persistence.on_wait()
            elif isinstance(event, ErrorEvent):
                success = False

            yield event_dict
    except Exception as e:
        logger.exception(f"[manus_runner] Flow error: {e}")
        success = False
        yield {"type": "error", "error": str(e)}
        yield {"type": "done", "success": False}
    finally:
        persistence.on_done(success)
