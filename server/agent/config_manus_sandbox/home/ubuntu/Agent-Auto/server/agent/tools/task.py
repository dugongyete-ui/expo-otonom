"""
Task/Subagent tools for Dzeck AI Agent.
Provides sub-task spawning and management for complex multi-step workflows.
"""
import os
import json
import uuid
from typing import Optional, Dict, Any, List
from datetime import datetime

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

TASK_DIR = "/home/user/dzeck-ai/.tasks"


def _ensure_task_dir():
    os.makedirs(TASK_DIR, exist_ok=True)


def task_create(
    description: str,
    task_type: str = "general",
    context: Optional[str] = None,
) -> ToolResult:
    """Create a sub-task for structured parallel/sequential work."""
    _ensure_task_dir()
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    task_data = {
        "id": task_id,
        "description": description,
        "type": task_type,
        "context": context or "",
        "status": "pending",
        "result": None,
        "created_at": datetime.now().isoformat(),
        "completed_at": None,
    }
    task_file = os.path.join(TASK_DIR, f"{task_id}.json")
    try:
        with open(task_file, "w", encoding="utf-8") as f:
            json.dump(task_data, f, indent=2, ensure_ascii=False)
        return ToolResult(
            success=True,
            message=f"Sub-task created: [{task_id}] {description}",
            data={"type": "task_create", "task_id": task_id, "task": task_data},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to create task: {e}")


def task_complete(
    task_id: str,
    result: str,
    success: bool = True,
) -> ToolResult:
    """Mark a sub-task as completed with its result."""
    task_file = os.path.join(TASK_DIR, f"{task_id}.json")
    if not os.path.exists(task_file):
        return ToolResult(
            success=False,
            message=f"Task not found: {task_id}",
        )
    try:
        with open(task_file, "r", encoding="utf-8") as f:
            task_data = json.load(f)
        task_data["status"] = "completed" if success else "failed"
        task_data["result"] = result
        task_data["completed_at"] = datetime.now().isoformat()
        with open(task_file, "w", encoding="utf-8") as f:
            json.dump(task_data, f, indent=2, ensure_ascii=False)
        return ToolResult(
            success=True,
            message=f"Task [{task_id}] marked as {'completed' if success else 'failed'}: {result}",
            data={"type": "task_complete", "task_id": task_id, "task": task_data},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to complete task: {e}")


def task_list() -> ToolResult:
    """List all sub-tasks and their current status."""
    _ensure_task_dir()
    tasks = []
    try:
        for fname in sorted(os.listdir(TASK_DIR)):
            if fname.endswith(".json"):
                fpath = os.path.join(TASK_DIR, fname)
                with open(fpath, "r", encoding="utf-8") as f:
                    tasks.append(json.load(f))

        if not tasks:
            return ToolResult(
                success=True,
                message="No sub-tasks exist yet.",
                data={"type": "task_list", "tasks": [], "total": 0},
            )

        pending = sum(1 for t in tasks if t["status"] == "pending")
        completed = sum(1 for t in tasks if t["status"] == "completed")
        failed = sum(1 for t in tasks if t["status"] == "failed")

        summary_lines = [f"Sub-tasks: {len(tasks)} total ({completed} completed, {pending} pending, {failed} failed)\n"]
        for t in tasks:
            marker = "✓" if t["status"] == "completed" else ("✗" if t["status"] == "failed" else "○")
            summary_lines.append(f"  {marker} [{t['id']}] {t['description']}")
            if t.get("result"):
                summary_lines.append(f"    → {t['result'][:200]}")

        return ToolResult(
            success=True,
            message="\n".join(summary_lines),
            data={
                "type": "task_list",
                "tasks": tasks,
                "total": len(tasks),
                "pending": pending,
                "completed": completed,
                "failed": failed,
            },
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to list tasks: {e}")


class TaskTool(BaseTool):
    """Task/Subagent tool class - provides sub-task management for complex workflows."""

    name: str = "task"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="task_create",
        description=(
            "Create a sub-task for complex, multi-step work. Use when:\n"
            "- Parallelization: two or more independent items need work (e.g., 'investigate competitors', 'review accounts')\n"
            "- Context separation: isolate high-token-cost subtasks from the main task\n"
            "- Verification: spawn a verification sub-task to check previous work\n"
            "Each sub-task should have a clear, independent objective."
        ),
        parameters={
            "description": {
                "type": "string",
                "description": "Clear description of what this sub-task should accomplish",
            },
            "task_type": {
                "type": "string",
                "enum": ["general", "research", "coding", "verification", "analysis"],
                "description": "(Optional) Type of sub-task. Defaults to 'general'.",
            },
            "context": {
                "type": "string",
                "description": "(Optional) Additional context or data needed for this sub-task",
            },
        },
        required=["description"],
    )
    def _task_create(
        self,
        description: str,
        task_type: str = "general",
        context: Optional[str] = None,
    ) -> ToolResult:
        return task_create(description=description, task_type=task_type, context=context)

    @tool(
        name="task_complete",
        description=(
            "Mark a sub-task as completed (or failed) with its result summary. "
            "Call this after finishing work on a sub-task to record the outcome."
        ),
        parameters={
            "task_id": {
                "type": "string",
                "description": "The ID of the sub-task to complete (e.g., 'task_a1b2c3d4')",
            },
            "result": {
                "type": "string",
                "description": "Summary of what was accomplished or why it failed",
            },
            "success": {
                "type": "boolean",
                "description": "Whether the sub-task completed successfully. Defaults to true.",
            },
        },
        required=["task_id", "result"],
    )
    def _task_complete(
        self,
        task_id: str,
        result: str,
        success: bool = True,
    ) -> ToolResult:
        return task_complete(task_id=task_id, result=result, success=success)

    @tool(
        name="task_list",
        description=(
            "List all sub-tasks and their current status. "
            "Use to check progress of parallel sub-tasks or review completed work."
        ),
        parameters={},
        required=[],
    )
    def _task_list(self) -> ToolResult:
        return task_list()
