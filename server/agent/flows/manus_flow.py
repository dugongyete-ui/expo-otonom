"""
PlanActFlow — ai-manus compatible Plan-Act flow with exact AgentStatus states.

State machine: IDLE → PLANNING → EXECUTING → UPDATING → SUMMARIZING → COMPLETED

This flow wraps the existing DzeckAgent infrastructure and provides a clean
ai-manus compatible interface using PlannerAgent and ExecutionAgent.
"""
import logging
from enum import Enum
from typing import AsyncGenerator, List, Optional, Any

from server.agent.agents.planner import PlannerAgent
from server.agent.agents.execution import ExecutionAgent
from server.agent.models.plan import Plan, Step, ExecutionStatus
from server.agent.models.event import (
    BaseEvent,
    PlanEvent,
    PlanStatus,
    StepEvent,
    StepStatus,
    MessageEvent,
    DoneEvent,
    TitleEvent,
    ErrorEvent,
    WaitEvent,
)
from server.agent.tools.base import BaseTool

logger = logging.getLogger(__name__)


class AgentStatus(str, Enum):
    """Exact ai-manus AgentStatus enum values."""
    IDLE = "idle"
    PLANNING = "planning"
    EXECUTING = "executing"
    UPDATING = "updating"
    SUMMARIZING = "summarizing"
    COMPLETED = "completed"


class PlanActFlow:
    """
    Plan-Act flow matching ai-manus PlanActFlow exactly.

    State machine:
        IDLE → PLANNING → EXECUTING → UPDATING → SUMMARIZING → COMPLETED

    At each state:
    - IDLE: Transition to PLANNING
    - PLANNING: planner.create_plan() → emit PlanEvent(CREATED), TitleEvent, MessageEvent
    - EXECUTING: executor.execute_step() per step → emit StepEvents and ToolEvents
    - UPDATING: planner.update_plan() → emit PlanEvent(UPDATED)
    - SUMMARIZING: executor.summarize() → emit MessageEvent
    - COMPLETED: emit PlanEvent(COMPLETED), DoneEvent, break
    """

    def __init__(
        self,
        agent_id: str,
        tools: List[BaseTool] = None,
        session_id: Optional[str] = None,
    ):
        self._agent_id = agent_id
        self._session_id = session_id
        self.status = AgentStatus.IDLE
        self.plan: Optional[Plan] = None

        _tools = tools or []

        self.planner = PlannerAgent(agent_id=agent_id, tools=_tools)
        self.executor = ExecutionAgent(agent_id=agent_id, tools=_tools)

        logger.debug(f"[PlanActFlow] Created for agent {agent_id}, session {session_id}")

    def is_done(self) -> bool:
        return self.status == AgentStatus.IDLE

    async def run(
        self,
        message: str,
        attachments: Optional[List[str]] = None,
    ) -> AsyncGenerator[BaseEvent, None]:
        """
        Run the full Plan-Act flow for a user message.

        Yields:
            BaseEvent subclasses (PlanEvent, StepEvent, ToolEvent, MessageEvent, DoneEvent, etc.)
        """
        logger.info(f"[PlanActFlow] Starting for agent {self._agent_id}: {message[:60]}...")

        step: Optional[Step] = None

        while True:
            if self.status == AgentStatus.IDLE:
                logger.info(f"[PlanActFlow] {AgentStatus.IDLE} → {AgentStatus.PLANNING}")
                self.status = AgentStatus.PLANNING

            elif self.status == AgentStatus.PLANNING:
                logger.info(f"[PlanActFlow] Creating plan...")
                async for event in self.planner.create_plan(message, attachments=attachments):
                    if isinstance(event, PlanEvent) and event.status == PlanStatus.CREATED:
                        self.plan = Plan.from_dict(event.plan) if isinstance(event.plan, dict) else event.plan
                        logger.info(
                            f"[PlanActFlow] Plan created: {len(self.plan.steps)} steps"
                        )
                    yield event

                self.status = AgentStatus.EXECUTING
                logger.info(f"[PlanActFlow] {AgentStatus.PLANNING} → {AgentStatus.EXECUTING}")

                if self.plan is None or len(self.plan.steps) == 0:
                    logger.info(f"[PlanActFlow] No steps — moving to COMPLETED")
                    self.status = AgentStatus.COMPLETED

            elif self.status == AgentStatus.EXECUTING:
                if self.plan is None:
                    logger.warning(f"[PlanActFlow] No plan found during EXECUTING")
                    self.status = AgentStatus.COMPLETED
                    continue

                self.plan.status = ExecutionStatus.RUNNING
                step = self.plan.get_next_step()

                if step is None:
                    logger.info(f"[PlanActFlow] All steps done → {AgentStatus.SUMMARIZING}")
                    self.status = AgentStatus.SUMMARIZING
                    continue

                logger.info(
                    f"[PlanActFlow] Executing step {step.id}: {step.description[:60]}..."
                )

                wait_requested = False
                async for event in self.executor.execute_step(self.plan, step, message, attachments=attachments):
                    if isinstance(event, WaitEvent):
                        wait_requested = True
                    yield event

                await self.executor.compact_memory()
                logger.info(
                    f"[PlanActFlow] Step {step.id} done → {AgentStatus.UPDATING}"
                )
                self.status = AgentStatus.UPDATING

                if wait_requested:
                    # Pause execution — consumer must resume with a new message
                    logger.info(f"[PlanActFlow] Waiting for user input after step {step.id}")
                    return

            elif self.status == AgentStatus.UPDATING:
                logger.info(f"[PlanActFlow] Updating plan...")
                if self.plan is not None and step is not None:
                    async for event in self.planner.update_plan(self.plan, step):
                        if isinstance(event, PlanEvent) and event.status == PlanStatus.UPDATED:
                            if isinstance(event.plan, dict):
                                updated_plan = Plan.from_dict(event.plan)
                                self.plan.steps = updated_plan.steps
                        yield event

                self.status = AgentStatus.EXECUTING
                logger.info(f"[PlanActFlow] {AgentStatus.UPDATING} → {AgentStatus.EXECUTING}")

            elif self.status == AgentStatus.SUMMARIZING:
                logger.info(f"[PlanActFlow] Summarizing...")
                async for event in self.executor.summarize(plan=self.plan, message=message):
                    yield event
                self.status = AgentStatus.COMPLETED
                logger.info(f"[PlanActFlow] {AgentStatus.SUMMARIZING} → {AgentStatus.COMPLETED}")

            elif self.status == AgentStatus.COMPLETED:
                if self.plan is not None:
                    self.plan.status = ExecutionStatus.COMPLETED
                    yield PlanEvent(
                        status=PlanStatus.COMPLETED,
                        plan=self.plan.to_dict(),
                    )

                logger.info(f"[PlanActFlow] Completed for agent {self._agent_id}")
                self.status = AgentStatus.IDLE
                break

        yield DoneEvent()
        logger.info(f"[PlanActFlow] Done for agent {self._agent_id}")
