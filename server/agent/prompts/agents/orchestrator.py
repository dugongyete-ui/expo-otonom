"""
Orchestrator — Manus Multi-Agent Coordination Layer.

Full implementation of the Manus autonomous agent orchestrator with:
- EventType, AgentType, TaskStatus enums
- TaskSession, PlannerModule, AgentRouter, SpecialistAgent, Orchestrator classes
- KEYWORD_MAP for routing, AGENT_PROMPTS dictionary
- CerebrasClient: all LLM calls via Cerebras AI API
- Entry point for standalone execution
Sinkronisasi penuh dengan standar Manus.im untuk E2B Sandbox.
"""

import os
import uuid
import json
import time
import urllib.request
import urllib.error
from enum import Enum
from typing import Optional, List, Dict, Any


# ── Cerebras AI Client ────────────────────────────────────────────────────────

class CerebrasClient:
    """
    Cerebras AI client — all LLM calls go through api.cerebras.ai using CEREBRAS_API_KEY.
    """

    def __init__(self):
        self.api_key = os.environ.get("CEREBRAS_API_KEY", "")
        self.model = (
            os.environ.get("CEREBRAS_AGENT_MODEL")
            or "qwen-3-235b-a22b-instruct-2507"
        )

    def _build_url(self) -> str:
        return "https://api.cerebras.ai/v1/chat/completions"

    def complete(
        self,
        system: str,
        messages: List[Dict[str, str]],
        max_tokens: int = 4096,
    ) -> str:
        """Send request to Cerebras AI and return text response."""
        cerebras_messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
        cerebras_messages.extend(messages)

        url = self._build_url()
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": cerebras_messages,
            "max_tokens": max_tokens,
            "stream": False,
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "User-Agent": "DzeckAI-Orchestrator/1.0",
            },
            method="POST",
        )

        last_error: Optional[Exception] = None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    raw = resp.read().decode("utf-8")
                result = json.loads(raw)
                choices = result.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "").strip()
                return ""
            except urllib.error.HTTPError as e:
                last_error = e
                if e.code == 429 or e.code >= 500:
                    time.sleep(2 ** attempt)
                else:
                    raise
            except Exception as e:
                last_error = e
                time.sleep(2 ** attempt)

        raise RuntimeError(f"Cerebras API failed after retries: {last_error}")

    def complete_json(
        self,
        system: str,
        messages: List[Dict[str, str]],
        max_tokens: int = 2048,
    ) -> Any:
        """Send request and parse JSON from response."""
        import re
        raw = self.complete(system, messages, max_tokens)
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r'(\[.*\]|\{.*\})', cleaned, re.DOTALL)
            if match:
                return json.loads(match.group(1))
            raise


class EventType(str, Enum):
    MESSAGE = "message"
    ACTION = "action"
    OBSERVATION = "observation"
    PLAN = "plan"
    KNOWLEDGE = "knowledge"
    DATASOURCE = "datasource"
    SYSTEM = "system"


class AgentType(str, Enum):
    WEB = "web"
    FILE = "file"
    DATA = "data"
    CODE = "code"


class TaskStatus(str, Enum):
    RUNNING = "running"
    IDLE = "idle"
    WAITING = "waiting"
    ERROR = "error"
    COMPLETE = "complete"


# Specialist Agent Prompts (Imported from prompts/agents/ sub-modules in main flow)
from server.agent.prompts.agents.web_agent import WEB_AGENT_SYSTEM_PROMPT
from server.agent.prompts.agents.files_agent import FILES_AGENT_SYSTEM_PROMPT
from server.agent.prompts.agents.data_agent import DATA_AGENT_SYSTEM_PROMPT
from server.agent.prompts.agents.code_agent import CODE_AGENT_SYSTEM_PROMPT

AGENT_PROMPTS = {
    AgentType.WEB: WEB_AGENT_SYSTEM_PROMPT,
    AgentType.FILE: FILES_AGENT_SYSTEM_PROMPT,
    AgentType.DATA: DATA_AGENT_SYSTEM_PROMPT,
    AgentType.CODE: CODE_AGENT_SYSTEM_PROMPT,
}

ORCHESTRATOR_SYSTEM_PROMPT = """
You are the Orchestrator Agent. Your job is to decompose complex user requests into manageable tasks and coordinate specialized agents to complete them.
You operate as the brain of the multi-agent system, ensuring efficiency and quality across all operations.

ORCHESTRATION CAPABILITIES
You can analyze complex requests and identify required expertise, create detailed plans with clear task dependencies, assign tasks to specialized agents (Web, Code, Files, Data), monitor progress and resolve conflicts between agents, and synthesize final results from multiple agent outputs.

SPECIALIZED AGENTS
- **Web Agent**: For browser automation, web search, and information extraction.
- **Code Agent**: For Python execution, automation scripts, and technical tasks.
- **Files Agent**: For file management, organization, and document processing.
- **Data Agent**: For data analysis, API interaction, and visualization.

TRANSPARENCY RULES (MANDATORY)
- Explain your high-level strategy via message_notify_user before assigning tasks.
- Report task assignments and expected outcomes to the user.
- Provide regular updates on the overall progress of the project.

ORCHESTRATION RULES
- Always start by creating a task list using task_create.
- Assign tasks based on the specific strengths of each agent.
- Ensure all prerequisite tasks are completed before starting dependent tasks.
- Use todo_write to maintain a visual progress checklist for the user.
- Review agent outputs for quality and consistency before final delivery.

AVAILABLE ORCHESTRATION TOOLS

task_create: Create a new task or subtask. Required parameters: title (string), description (string), assigned_to (agent type string).

task_complete: Mark a task as completed. Required parameter: id (task ID string).

task_list: List all current tasks and their status.

todo_write/todo_update: Maintain a progress checklist for the user.

message_notify_user: Communicate strategy and progress to the user.

SANDBOX CONTEXT
All agents operate within the same E2B Sandbox environment, allowing them to share files and resources seamlessly.
"""

ORCHESTRATOR_TOOLS = [
    "task_create", "task_complete", "task_list",
    "todo_write", "todo_update", "todo_read",
    "message_notify_user", "message_ask_user", "idle",
]
