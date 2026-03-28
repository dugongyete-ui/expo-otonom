"""
TodoList tools for Dzeck AI Agent.
Provides progress tracking via todo.md file management.
"""
import os
from typing import Optional, List

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

TODO_DIR = "/tmp/dzeck-ai"
TODO_FILE = os.path.join(TODO_DIR, "todo.md")


def todo_write(items: List[str], title: Optional[str] = None) -> ToolResult:
    """Create or overwrite a todo.md checklist for tracking task progress."""
    os.makedirs(TODO_DIR, exist_ok=True)
    header = title or "Todo List"
    lines = [f"# {header}\n"]
    for item in items:
        lines.append(f"- [ ] {item}")
    content = "\n".join(lines) + "\n"
    try:
        with open(TODO_FILE, "w", encoding="utf-8") as f:
            f.write(content)
        return ToolResult(
            success=True,
            message=f"TodoList created with {len(items)} items at {TODO_FILE}",
            data={"type": "todo_write", "file": TODO_FILE, "item_count": len(items)},
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


def _find_best_match(lines: List[str], item_text: str, marker: str) -> Optional[int]:
    """
    Find the best matching line index for item_text with given marker.
    Tries (in order): exact → case-insensitive → substring → word-overlap (>=50%).
    Returns line index or None if not found.
    """
    item_stripped = item_text.strip()
    item_lower = item_stripped.lower()

    candidates = []
    for i, line in enumerate(lines):
        if not line.startswith(marker):
            continue
        line_content = line[len(marker):].strip()
        candidates.append((i, line_content))

    if not candidates:
        return None

    for i, content in candidates:
        if content == item_stripped:
            return i

    for i, content in candidates:
        if content.lower() == item_lower:
            return i

    for i, content in candidates:
        if item_lower in content.lower() or content.lower() in item_lower:
            return i

    best_idx = None
    best_score = 0.0
    for i, content in candidates:
        score = _word_overlap_score(item_stripped, content)
        if score > best_score:
            best_score = score
            best_idx = i

    if best_score >= 0.5:
        return best_idx

    return None


def todo_update(item_text: str, completed: bool = True) -> ToolResult:
    """Update a single item in todo.md by marking it completed or uncompleted."""
    if not os.path.exists(TODO_FILE):
        return ToolResult(success=False, message="No todo.md found. Create one first with todo_write.")
    try:
        with open(TODO_FILE, "r", encoding="utf-8") as f:
            content = f.read()

        old_marker = "- [ ]" if completed else "- [x]"
        new_marker = "- [x]" if completed else "- [ ]"

        lines = content.splitlines(keepends=True)

        idx = _find_best_match(lines, item_text, old_marker + " ")
        if idx is None:
            already_idx = _find_best_match(lines, item_text, new_marker + " ")
            if already_idx is not None:
                status = "completed" if completed else "uncompleted"
                matched_text = lines[already_idx][len(new_marker) + 1:].strip()
                return ToolResult(
                    success=True,
                    message=f"Item already marked as {status}: {matched_text}",
                    data={"type": "todo_update", "item": matched_text, "already_done": True},
                )
            return ToolResult(
                success=False,
                message=(
                    f"Item not found in todo.md: '{item_text}'. "
                    f"Available items: {_list_todo_items(content)}"
                ),
            )

        matched_line = lines[idx]
        matched_text = matched_line[len(old_marker) + 1:].strip()
        lines[idx] = f"{new_marker} {matched_text}\n"

        new_content = "".join(lines)
        with open(TODO_FILE, "w", encoding="utf-8") as f:
            f.write(new_content)

        status = "completed" if completed else "uncompleted"
        return ToolResult(
            success=True,
            message=f"Todo item marked {status}: {matched_text}",
            data={"type": "todo_update", "item": matched_text, "completed": completed},
        )
    except Exception as e:
        return ToolResult(success=False, message=f"Failed to update todo: {e}")


def _list_todo_items(content: str) -> str:
    """Return a readable list of all todo items for debugging."""
    items = []
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("- [ ]") or line.startswith("- [x]"):
            items.append(line[6:].strip())
    return str(items) if items else "(none)"


def todo_read() -> ToolResult:
    """Read the current todo.md to check progress."""
    if not os.path.exists(TODO_FILE):
        return ToolResult(
            success=True,
            message="No todo.md exists yet.",
            data={"type": "todo_read", "exists": False, "content": ""},
        )
    try:
        with open(TODO_FILE, "r", encoding="utf-8") as f:
            content = f.read()

        total = content.count("- [ ]") + content.count("- [x]")
        done = content.count("- [x]")
        return ToolResult(
            success=True,
            message=f"Todo progress: {done}/{total} items completed.\n\n{content}",
            data={
                "type": "todo_read",
                "exists": True,
                "content": content,
                "total": total,
                "done": done,
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
            "Create or overwrite a TodoList (todo.md) for tracking task progress. "
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
            "Returns the full todo.md content with completion counts."
        ),
        parameters={},
        required=[],
    )
    def _todo_read(self) -> ToolResult:
        return todo_read()
