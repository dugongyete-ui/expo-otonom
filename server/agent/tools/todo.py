"""
TodoList tools for Dzeck AI Agent.
Provides progress tracking via MongoDB collection `agent_todos`.
All state is stored in MongoDB — no local filesystem writes.
"""
import os
from typing import Optional, List

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool
from server.agent.db.mongo import get_collection as _mongo_get_collection


def _get_session_id() -> str:
    return os.environ.get("DZECK_SESSION_ID", "default")


def _get_mongo_collection():
    """Return a pymongo collection for agent_todos, or None if unavailable."""
    return _mongo_get_collection("agent_todos")


def _get_doc(col, session_id: str) -> Optional[dict]:
    """Fetch the todo document for this session."""
    doc = col.find_one({"session_id": session_id}, {"_id": 0})
    return doc


def todo_write(items: List[str], title: Optional[str] = None) -> ToolResult:
    """Create or overwrite a todo checklist for tracking task progress."""
    session_id = _get_session_id()
    col = _get_mongo_collection()
    if col is None:
        return ToolResult(success=False, message="MongoDB unavailable — cannot write todo list")
    header = title or "Todo List"
    todo_items = [{"text": item, "completed": False} for item in items]
    try:
        col.update_one(
            {"session_id": session_id},
            {"$set": {
                "session_id": session_id,
                "title": header,
                "items": todo_items,
                "updated_at": __import__("datetime").datetime.now().isoformat(),
            }},
            upsert=True,
        )
        return ToolResult(
            success=True,
            message=f"TodoList created with {len(items)} items",
            data={"type": "todo_write", "item_count": len(items), "title": header},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to write todo: {e}")


def _word_overlap_score(a: str, b: str) -> float:
    """Return ratio of shared words between two strings (0.0 to 1.0)."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    shared = words_a & words_b
    return len(shared) / max(len(words_a), len(words_b))


def _find_best_match_idx(todo_items: List[dict], item_text: str, want_completed: bool) -> Optional[int]:
    """
    Find best matching item index that currently has completion status == (not want_completed).
    Tries: exact → case-insensitive → substring → word-overlap (>=50%).
    Returns index into todo_items list or None.
    """
    item_stripped = item_text.strip()
    item_lower = item_stripped.lower()

    candidates = [
        (i, item)
        for i, item in enumerate(todo_items)
        if item.get("completed") != want_completed
    ]

    if not candidates:
        return None

    for i, item in candidates:
        if item["text"].strip() == item_stripped:
            return i

    for i, item in candidates:
        if item["text"].strip().lower() == item_lower:
            return i

    for i, item in candidates:
        content = item["text"].strip().lower()
        if item_lower in content or content in item_lower:
            return i

    best_idx = None
    best_score = 0.0
    for i, item in candidates:
        score = _word_overlap_score(item_stripped, item["text"].strip())
        if score > best_score:
            best_score = score
            best_idx = i

    if best_score >= 0.5:
        return best_idx

    return None


def todo_update(item_text: str, completed: bool = True) -> ToolResult:
    """Update a single item in the todo list by marking it completed or uncompleted."""
    session_id = _get_session_id()
    col = _get_mongo_collection()
    if col is None:
        return ToolResult(success=False, message="MongoDB unavailable — cannot update todo")
    try:
        doc = _get_doc(col, session_id)
        if not doc:
            return ToolResult(success=False, message="No todo list found. Create one first with todo_write.")

        todo_items = doc.get("items", [])

        idx = _find_best_match_idx(todo_items, item_text, completed)
        if idx is None:
            # Check if item is already in the desired state
            already_candidates = [
                item for item in todo_items
                if item.get("completed") == completed
            ]
            for item in already_candidates:
                text = item["text"].strip()
                item_lower = item_text.strip().lower()
                if text.lower() == item_lower or item_lower in text.lower() or text.lower() in item_lower:
                    status = "completed" if completed else "uncompleted"
                    return ToolResult(
                        success=True,
                        message=f"Item already marked as {status}: {text}",
                        data={"type": "todo_update", "item": text, "already_done": True},
                    )
            available = [item["text"] for item in todo_items]
            return ToolResult(
                success=False,
                message=f"Item not found in todo list: '{item_text}'. Available items: {available}",
            )

        matched_text = todo_items[idx]["text"]
        todo_items[idx]["completed"] = completed

        col.update_one(
            {"session_id": session_id},
            {"$set": {
                "items": todo_items,
                "updated_at": __import__("datetime").datetime.now().isoformat(),
            }},
        )

        status = "completed" if completed else "uncompleted"
        return ToolResult(
            success=True,
            message=f"Todo item marked {status}: {matched_text}",
            data={"type": "todo_update", "item": matched_text, "completed": completed},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to update todo: {e}")


def todo_read() -> ToolResult:
    """Read the current todo list to check progress."""
    session_id = _get_session_id()
    col = _get_mongo_collection()
    if col is None:
        return ToolResult(
            success=True,
            message="No todo list exists yet (MongoDB unavailable).",
            data={"type": "todo_read", "exists": False, "content": ""},
        )
    try:
        doc = _get_doc(col, session_id)
        if not doc:
            return ToolResult(
                success=True,
                message="No todo list exists yet.",
                data={"type": "todo_read", "exists": False, "content": ""},
            )

        items = doc.get("items", [])
        title = doc.get("title", "Todo List")
        total = len(items)
        done = sum(1 for item in items if item.get("completed"))

        lines = [f"# {title}\n"]
        for item in items:
            marker = "- [x]" if item.get("completed") else "- [ ]"
            lines.append(f"{marker} {item['text']}")
        content = "\n".join(lines) + "\n"

        return ToolResult(
            success=True,
            message=f"Todo progress: {done}/{total} items completed.\n\n{content}",
            data={
                "type": "todo_read",
                "exists": True,
                "content": content,
                "total": total,
                "done": done,
                "items": items,
            },
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to read todo: {e}")


class TodoTool(BaseTool):
    """TodoList tool class - provides task progress tracking capabilities."""

    name: str = "todo"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="todo_write",
        description=(
            "Create or overwrite a TodoList for tracking task progress. "
            "Use this at the START of any multi-step task to create a visible checklist. "
            "Each item should be a clear, actionable step. "
            "The TodoList is rendered as a widget visible to the user."
        ),
        parameters={
            "items": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of todo items (each a clear, actionable step)",
            },
            "title": {
                "type": "string",
                "description": "(Optional) Title for the todo list. Defaults to 'Todo List'.",
            },
        },
        required=["items"],
    )
    def _todo_write(self, items: List[str], title: Optional[str] = None) -> ToolResult:
        return todo_write(items=items, title=title)

    @tool(
        name="todo_update",
        description=(
            "Mark a specific todo item as completed or uncompleted. "
            "Use the text of the item as it appears in the TodoList — "
            "partial or approximate text is accepted if exact match is not found. "
            "Call this immediately after completing each step to keep progress visible."
        ),
        parameters={
            "item_text": {
                "type": "string",
                "description": "Text of the todo item to update (exact or approximate)",
            },
            "completed": {
                "type": "boolean",
                "description": "True to mark as done (default), False to mark as not done",
            },
        },
        required=["item_text"],
    )
    def _todo_update(self, item_text: str, completed: bool = True) -> ToolResult:
        return todo_update(item_text=item_text, completed=completed)

    @tool(
        name="todo_read",
        description=(
            "Read the current TodoList to check progress. "
            "Returns the full todo list with completion counts."
        ),
        parameters={},
        required=[],
    )
    def _todo_read(self) -> ToolResult:
        return todo_read()
