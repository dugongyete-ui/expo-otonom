"""
Manus Runner — ai-manus compatible agent runner using PlanActFlow.

This module provides `run_plan_act_flow_async`, the public entry point for
running the ai-manus PlanActFlow state machine (IDLE→PLANNING→EXECUTING→
UPDATING→SUMMARIZING→COMPLETED) as an async generator of raw event dicts.

Usage (from Node.js subprocess bridge or tests):
    from server.agent.runner.manus_runner import run_plan_act_flow_async
    async for event_dict in run_plan_act_flow_async(message, session_id=sid):
        ...

The flow uses all existing tools from the tool registry (Shell, Browser, File,
Message, Search, MCP) and emits events matching ai-manus's SSE schema.
"""
import os
import logging
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

    State machine: IDLE → PLANNING → EXECUTING → UPDATING → SUMMARIZING → COMPLETED
    """
    agent_id = session_id or f"agent-{user_id}"
    logger.info(f"[manus_runner] Starting for agent={agent_id}, session={session_id}")

    tools = _build_tools_for_flow()
    logger.info(f"[manus_runner] Loaded {len(tools)} tool categories")

    flow = PlanActFlow(
        agent_id=agent_id,
        tools=tools,
        session_id=session_id,
    )

    try:
        async for event in flow.run(message=user_message, attachments=attachments or []):
            yield _event_to_dict(event)
    except Exception as e:
        logger.exception(f"[manus_runner] Flow error: {e}")
        yield {"type": "error", "error": str(e)}
        yield {"type": "done", "success": False}
