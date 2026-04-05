"""
Execution agent matching ai-manus ExecutionAgent.
Executes individual steps of the plan using tools.
"""
import logging
from typing import List, AsyncGenerator, Optional

from server.agent.agents.base import BaseAgent
from server.agent.models.plan import Plan, Step, ExecutionStatus
from server.agent.models.event import (
    BaseEvent,
    StepEvent,
    StepStatus,
    ErrorEvent,
    MessageEvent,
    ToolEvent,
    ToolStatus,
    WaitEvent,
)
from server.agent.tools.base import BaseTool
from server.agent.prompts.execution import (
    EXECUTION_SYSTEM_PROMPT,
    EXECUTION_PROMPT,
    SUMMARIZE_PROMPT,
)

logger = logging.getLogger(__name__)


class ExecutionAgent(BaseAgent):
    """
    Execution agent — executes steps using available tools and emits StepEvents.
    Matches ai-manus ExecutionAgent pattern.
    """

    name: str = "execution"

    def __init__(
        self,
        agent_id: str,
        tools: List[BaseTool] = None,
    ):
        super().__init__(agent_id=agent_id, tools=tools)
        self.system_prompt = EXECUTION_SYSTEM_PROMPT

    async def execute_step(self, plan: Plan, step: Step, message: str, attachments: List[str] = None) -> AsyncGenerator[BaseEvent, None]:
        """
        Execute a single step. Yields StepEvents, ToolEvents, MessageEvents.
        Matches ai-manus ExecutionAgent.execute_step().
        """
        attachments_str = "\n".join(attachments or [])
        attachments_info = f"Attachments:\n{attachments_str}" if attachments_str else ""
        prompt = EXECUTION_PROMPT.format(
            step=step.description,
            message=message,
            attachments_info=attachments_info,
            language=plan.language or "en",
            context="",
        )

        step.status = ExecutionStatus.RUNNING
        yield StepEvent(status=StepStatus.RUNNING, step=step.to_dict())

        async for event in self.execute(prompt):
            if isinstance(event, ErrorEvent):
                step.status = ExecutionStatus.FAILED
                step.error = event.error
                yield StepEvent(status=StepStatus.FAILED, step=step.to_dict())
            elif isinstance(event, MessageEvent):
                try:
                    parsed = await self._parse_json(event.message)
                    if parsed:
                        new_step = Step(**{
                            k: v for k, v in parsed.items()
                            if k in Step.model_fields
                        })
                        step.success = new_step.success
                        step.result = new_step.result or event.message
                        if new_step.attachments:
                            step.attachments = new_step.attachments
                    else:
                        step.result = event.message
                        step.success = True
                except Exception:
                    step.result = event.message
                    step.success = True

                step.status = ExecutionStatus.COMPLETED if step.success else ExecutionStatus.FAILED
                status = StepStatus.COMPLETED if step.success else StepStatus.FAILED
                yield StepEvent(status=status, step=step.to_dict())
                if step.result:
                    yield MessageEvent(role="assistant", message=step.result)
                continue
            elif isinstance(event, ToolEvent):
                if event.function_name == "message_ask_user":
                    if event.status == ToolStatus.CALLING:
                        text = event.function_args.get("text", "")
                        if text:
                            yield MessageEvent(role="assistant", message=text)
                    elif event.status == ToolStatus.CALLED:
                        yield WaitEvent()
                        return
                    continue
                yield event
                continue
            else:
                yield event

        if step.status == ExecutionStatus.RUNNING:
            step.status = ExecutionStatus.COMPLETED
            step.success = True

    async def summarize(self, plan: Optional[Plan] = None, message: str = "") -> AsyncGenerator[BaseEvent, None]:
        """Generate a summary of the completed plan execution."""
        if plan is not None:
            step_results = "\n".join(
                f"- {s.description}: {s.result or 'completed'}"
                for s in plan.steps if s.is_done()
            )
            output_files = "\n".join(
                a for s in plan.steps if s.is_done() for a in (s.attachments or [])
            )
            prompt = SUMMARIZE_PROMPT.format(
                step_results=step_results or "(no steps)",
                message=message or "No message",
                output_files=output_files or "(none)",
            )
        else:
            prompt = SUMMARIZE_PROMPT.format(
                step_results="(no steps recorded)",
                message=message or "No message",
                output_files="(none)",
            )
        async for event in self.execute(prompt):
            if isinstance(event, MessageEvent):
                try:
                    parsed = await self._parse_json(event.message)
                    if parsed:
                        summary_message = parsed.get("message", event.message)
                        attachments = [a for a in parsed.get("attachments", []) if isinstance(a, str)]
                        yield MessageEvent(
                            role="assistant",
                            message=summary_message,
                            attachments=[{"file_path": a} for a in attachments],
                        )
                    else:
                        yield MessageEvent(role="assistant", message=event.message)
                except Exception:
                    yield MessageEvent(role="assistant", message=event.message)
            else:
                yield event
