"""
Manus Runner — ai-manus compatible agent runner using PlanActFlow.

This module provides `run_plan_act_flow_async`, the public entry point for
running the ai-manus PlanActFlow state machine (IDLE→PLANNING→EXECUTING→
UPDATING→SUMMARIZING→COMPLETED) as an async generator of raw event dicts.

Session persistence matches ai-manus AgentTaskRunner lifecycle:
  - Title updates written to MongoDB on TitleEvent
  - Messages appended (not overwritten) on MessageEvent
  - Status set to "waiting" on WaitEvent — finalize is skipped
  - Event log persisted for replay via GET /sessions/:id
  - Status finalized to completed/failed only on true terminal exit

Usage:
    from server.agent.runner.manus_runner import run_plan_act_flow_async
    async for event_dict in run_plan_act_flow_async(message, session_id=sid):
        ...
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
    """Return the MongoDB collection if available (best-effort)."""
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
    Matches ai-manus AgentTaskRunner lifecycle:
      - on_start: set status=running, persist user message
      - on_title: update title field
      - on_message: $push to chat_history (append, never overwrite)
      - on_event: accumulate event log for replay
      - on_wait: set status=waiting — do NOT finalize
      - on_done: only called on true terminal exit (not on WaitEvent)
    """

    def __init__(self, session_id: Optional[str], user_id: str):
        self._session_id = session_id
        self._user_id = user_id
        self._col = None
        self._event_log: List[Dict[str, Any]] = []
        self._waiting = False

    def _get_col(self):
        if self._col is None and self._session_id:
            self._col = _get_mongo_collection("sessions")
        return self._col

    def _update(self, update_doc: Dict[str, Any]) -> None:
        if not self._session_id:
            return
        try:
            col = self._get_col()
            if col is not None:
                col.update_one(
                    {"session_id": self._session_id},
                    {**update_doc, "$set": {**update_doc.get("$set", {}), "updated_at": datetime.datetime.utcnow()}},
                )
        except Exception as e:
            logger.warning(f"[manus_runner] MongoDB update failed: {e}")

    def on_start(self, user_message: str) -> None:
        # Push user message and set running status
        self._update({
            "$set": {"status": "running", "user_id": self._user_id},
            "$push": {"chat_history": {"role": "user", "content": user_message}},
        })

    def on_title(self, title: str) -> None:
        self._update({"$set": {"title": title}})

    def on_message(self, content: str, role: str = "assistant") -> None:
        # Append to chat_history — never overwrite
        self._update({
            "$push": {"chat_history": {"role": role, "content": content}},
        })

    def on_wait(self) -> None:
        # Pause state — do NOT proceed to on_done
        self._waiting = True
        self._update({"$set": {"status": "waiting"}})
        # Flush accumulated event_log to DB so replay works
        if self._event_log:
            try:
                col = self._get_col()
                if col is not None:
                    col.update_one(
                        {"session_id": self._session_id},
                        {"$push": {"event_log": {"$each": self._event_log}}},
                    )
            except Exception as e:
                logger.warning(f"[manus_runner] event_log flush failed: {e}")

    def on_event(self, event_dict: Dict[str, Any]) -> None:
        self._event_log.append(event_dict)

    def is_waiting(self) -> bool:
        return self._waiting

    def on_done(self, success: bool) -> None:
        # Only called on true terminal exit (completed/failed), NOT on wait
        final_events = self._event_log[-500:]  # cap at 500
        try:
            col = self._get_col()
            if col is not None:
                col.update_one(
                    {"session_id": self._session_id},
                    {
                        "$set": {
                            "status": "completed" if success else "failed",
                            "updated_at": datetime.datetime.utcnow(),
                        },
                        "$push": {"event_log": {"$each": final_events}},
                    },
                )
        except Exception as e:
            logger.warning(f"[manus_runner] on_done persistence failed: {e}")


async def run_plan_act_flow_async(
    user_message: str,
    attachments: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    user_id: str = "auto-user",
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run the ai-manus compatible PlanActFlow and yield raw event dicts.

    Terminal behavior:
    - WaitEvent: yields the event, persists "waiting" status, returns WITHOUT done event.
      The route's on-close handler detects this via is_waiting() flag.
    - DoneEvent from flow: yielded once; route's subprocess close handler does NOT re-emit done.
    - Exception: yields error + done{success:false}, persists "failed".

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
    emitted_done = False
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
                yield event_dict
                persistence.on_wait()
                # Return immediately — do NOT finalize session as done
                return
            elif isinstance(event, ErrorEvent):
                success = False
            elif isinstance(event, DoneEvent):
                emitted_done = True

            yield event_dict

    except Exception as e:
        logger.exception(f"[manus_runner] Flow error: {e}")
        success = False
        if not emitted_done:
            yield {"type": "error", "error": str(e)}
            yield {"type": "done", "success": False}
            emitted_done = True
    finally:
        # Only finalize if we did NOT pause for user input (WaitEvent path returns early)
        if not persistence.is_waiting():
            persistence.on_done(success)
        # Signal to route handler whether done was already emitted by the flow
        # (used to prevent duplicate done SSE from the subprocess-close handler)
        # Write sentinel to stdout so route can detect it
        if emitted_done:
            import sys
            print('{"type":"_done_emitted"}', flush=True)
