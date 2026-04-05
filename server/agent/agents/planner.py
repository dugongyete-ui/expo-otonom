"""
Planner agent matching ai-manus PlannerAgent.
Creates and updates multi-step execution plans.
"""
import logging
from typing import List, AsyncGenerator, Optional, Any

from server.agent.agents.base import BaseAgent
from server.agent.models.plan import Plan, Step
from server.agent.models.event import (
    BaseEvent,
    PlanEvent,
    PlanStatus,
    TitleEvent,
    MessageEvent,
    ErrorEvent,
)
from server.agent.tools.base import BaseTool
from server.agent.prompts.planner import (
    PLANNER_SYSTEM_PROMPT,
    CREATE_PLAN_PROMPT,
    UPDATE_PLAN_PROMPT,
)

logger = logging.getLogger(__name__)


class PlannerAgent(BaseAgent):
    """
    Planner agent — creates structured plans and emits PlanEvents.
    Matches ai-manus PlannerAgent pattern.
    """

    name: str = "planner"
    tool_choice: Optional[str] = "none"

    def __init__(
        self,
        agent_id: str,
        tools: List[BaseTool] = None,
    ):
        super().__init__(agent_id=agent_id, tools=tools)
        self.system_prompt = PLANNER_SYSTEM_PROMPT

    async def create_plan(self, message: str, attachments: List[str] = None) -> AsyncGenerator[BaseEvent, None]:
        """Create a new plan from user message. Yields PlanEvent and TitleEvent."""
        attachments_info = ""
        if attachments:
            attachments_info = "Attachments:\n" + "\n".join(attachments)

        prompt = CREATE_PLAN_PROMPT.format(
            message=message,
            attachments_info=attachments_info,
            language="en",
        )

        async for event in self.execute(prompt):
            if isinstance(event, MessageEvent):
                try:
                    parsed = await self._parse_json(event.message)
                    if not parsed:
                        logger.warning("[PlannerAgent] Empty parsed plan response")
                        plan = Plan(
                            title="Task Execution",
                            goal=message[:100],
                            steps=[Step(description=message)],
                            message="I'll work on this task for you.",
                        )
                    else:
                        raw_steps = parsed.get("steps", [])
                        steps = [
                            Step(
                                id=str(s.get("id", "")),
                                description=s.get("description", ""),
                                agent_type=s.get("agent_type", "general"),
                            )
                            for s in raw_steps
                        ]
                        if not steps:
                            steps = [Step(description=message)]
                        plan = Plan(
                            title=parsed.get("title", "Task"),
                            goal=parsed.get("goal", message[:100]),
                            language=parsed.get("language", "en"),
                            steps=steps,
                            message=parsed.get("message", ""),
                        )

                    yield TitleEvent(title=plan.title)
                    if plan.message:
                        yield MessageEvent(role="assistant", message=plan.message)
                    yield PlanEvent(status=PlanStatus.CREATED, plan=plan.to_dict())
                except Exception as e:
                    logger.error(f"[PlannerAgent] Failed to parse plan: {e}")
                    plan = Plan(
                        title="Task Execution",
                        goal=message[:100],
                        steps=[Step(description=message)],
                        message="I'll work on this task for you.",
                    )
                    yield TitleEvent(title=plan.title)
                    yield PlanEvent(status=PlanStatus.CREATED, plan=plan.to_dict())
            else:
                yield event

    async def update_plan(self, plan: Plan, step: Step) -> AsyncGenerator[BaseEvent, None]:
        """Update an existing plan after step completion."""
        completed_steps = [s for s in plan.steps if s.is_done()]
        pending_steps = [s for s in plan.steps if not s.is_done()]
        prompt = UPDATE_PLAN_PROMPT.format(
            current_plan=plan.dump_json(),
            completed_steps="\n".join(s.model_dump_json() for s in completed_steps),
            current_step=step.model_dump_json(),
            step_result=step.result or "",
        )

        async for event in self.execute(prompt):
            if isinstance(event, MessageEvent):
                try:
                    parsed = await self._parse_json(event.message)
                    if not parsed:
                        yield PlanEvent(status=PlanStatus.UPDATED, plan=plan.to_dict())
                        continue

                    new_steps = [
                        Step(
                            id=str(s.get("id", "")),
                            description=s.get("description", ""),
                            agent_type=s.get("agent_type", "general"),
                        )
                        for s in parsed.get("steps", [])
                    ]

                    first_pending_index = None
                    for i, s in enumerate(plan.steps):
                        if not s.is_done():
                            first_pending_index = i
                            break

                    if first_pending_index is not None:
                        plan.steps = plan.steps[:first_pending_index] + new_steps

                    yield PlanEvent(status=PlanStatus.UPDATED, plan=plan.to_dict())
                except Exception as e:
                    logger.error(f"[PlannerAgent] Failed to parse updated plan: {e}")
                    yield PlanEvent(status=PlanStatus.UPDATED, plan=plan.to_dict())
            else:
                yield event
