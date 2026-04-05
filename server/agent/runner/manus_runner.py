"""
Manus Runner — ai-manus compatible agent runner using PlanActFlow.

This module provides `run_plan_act_flow_async`, the public entry point for
running the ai-manus PlanActFlow state machine (IDLE→PLANNING→EXECUTING→
UPDATING→SUMMARIZING→COMPLETED) as an async generator of raw event dicts.

Session persistence matches ai-manus AgentTaskRunner lifecycle:
  - Title updates written to MongoDB on TitleEvent
  - Messages appended (not overwritten) on MessageEvent
  - Plan state persisted on WaitEvent — status="waiting", plan_state saved
  - Plan state loaded on resume — flow resumes EXECUTING from saved plan
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


def _load_session_plan_state(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Load persisted plan state for a session (for wait/resume).
    Returns the plan dict if status=waiting and plan_state is stored, else None.
    """
    try:
        col = _get_mongo_collection("sessions")
        if col is None:
            return None
        doc = col.find_one(
            {"session_id": session_id, "status": "waiting"},
            {"plan_state": 1, "_id": 0},
        )
        if doc and doc.get("plan_state"):
            return doc["plan_state"]
    except Exception as e:
        logger.warning(f"[manus_runner] plan state load failed: {e}")
    return None


class _SessionPersistence:
    """
    AgentTaskRunner-equivalent: persists session state to MongoDB.
    Matches ai-manus AgentTaskRunner lifecycle:
      - on_start: set status=running, append user message
      - on_title: update title field
      - on_message: $push to chat_history (append, never overwrite)
      - on_plan_wait: set status=waiting, persist plan_state for resume
      - on_event: accumulate event log for replay
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
                # Merge $set fields with updated_at
                update_doc.setdefault("$set", {})
                update_doc["$set"]["updated_at"] = datetime.datetime.utcnow()
                col.update_one({"session_id": self._session_id}, update_doc)
        except Exception as e:
            logger.warning(f"[manus_runner] MongoDB update failed: {e}")

    def on_start(self, user_message: str) -> None:
        self._update({
            "$set": {"status": "running", "user_id": self._user_id},
            "$push": {"chat_history": {"role": "user", "content": user_message}},
        })

    def on_title(self, title: str) -> None:
        self._update({"$set": {"title": title}})

    def on_message(self, content: str, role: str = "assistant") -> None:
        self._update({
            "$push": {"chat_history": {"role": role, "content": content}},
        })

    def on_plan_wait(self, plan_state: Optional[Dict[str, Any]]) -> None:
        """Persist waiting state and plan snapshot for resume."""
        self._waiting = True
        update: Dict[str, Any] = {"$set": {"status": "waiting"}}
        if plan_state is not None:
            update["$set"]["plan_state"] = plan_state
        if self._event_log:
            update["$push"] = {"event_log": {"$each": self._event_log}}
        self._update(update)

    def on_event(self, event_dict: Dict[str, Any]) -> None:
        self._event_log.append(event_dict)

    def is_waiting(self) -> bool:
        return self._waiting

    def on_done(self, success: bool) -> None:
        update: Dict[str, Any] = {
            "$set": {
                "status": "completed" if success else "failed",
                "plan_state": None,  # clear persisted plan state on completion
            },
        }
        if self._event_log:
            update["$push"] = {"event_log": {"$each": self._event_log[-500:]}}
        self._update(update)


async def run_plan_act_flow_async(
    user_message: str,
    attachments: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    user_id: str = "auto-user",
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run the ai-manus compatible PlanActFlow and yield raw event dicts.

    Resume semantics (ai-manus AgentTaskRunner parity):
    - If session_id has status=waiting and plan_state is stored, the flow
      is restored to EXECUTING state with the saved plan, rather than
      creating a new plan from scratch.

    Terminal behavior:
    - WaitEvent: yields event, persists plan_state + status=waiting, returns.
      No done event is emitted. Subsequent chat calls resume.
    - DoneEvent: emitted exactly once by the flow; route does NOT re-emit.
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

    # Wait/resume: if session has persisted plan state, restore flow to EXECUTING
    if session_id:
        saved_plan_state = _load_session_plan_state(session_id)
        if saved_plan_state is not None:
            try:
                from server.agent.models.plan import Plan
                flow.plan = Plan.from_dict(saved_plan_state)
                flow.status = AgentStatus.EXECUTING
                logger.info(f"[manus_runner] Resumed session {session_id} from EXECUTING with saved plan")
            except Exception as e:
                logger.warning(f"[manus_runner] Could not restore plan state: {e}")

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
                yield event_dict
                # Persist plan state for resume on next chat call
                plan_state = flow.plan.to_dict() if flow.plan is not None else None
                persistence.on_plan_wait(plan_state)
                # Return without done event — session is paused, not completed
                return
            elif isinstance(event, ErrorEvent):
                success = False

            yield event_dict

    except Exception as e:
        logger.exception(f"[manus_runner] Flow error: {e}")
        success = False
        yield {"type": "error", "error": str(e)}
        yield {"type": "done", "success": False}
    finally:
        # Finalize only on true terminal exit — wait path returns early
        if not persistence.is_waiting():
            persistence.on_done(success)
