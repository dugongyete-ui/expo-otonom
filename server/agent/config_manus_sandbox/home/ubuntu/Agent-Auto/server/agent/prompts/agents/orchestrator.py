"""
Orchestrator — Manus Multi-Agent Coordination Layer.

Full implementation of the Manus autonomous agent orchestrator with:
- EventType, AgentType, TaskStatus enums
- TaskSession, PlannerModule, AgentRouter, SpecialistAgent, Orchestrator classes
- KEYWORD_MAP for routing, AGENT_PROMPTS dictionary
- CerebrasClient: replaces Anthropic — all LLM calls via Cerebras AI
- Entry point for standalone execution
"""

import os
import uuid
import json
import time
import urllib.request
import urllib.error
from enum import Enum
from typing import Optional, List, Dict, Any


# ── Cerebras AI Client (replaces Anthropic) ──────────────────────────────────

class CerebrasClient:
    """
    Cerebras AI client — drop-in replacement for the Anthropic client.
    All LLM calls go through Cerebras AI API using CEREBRAS_API_KEY.
    """

    def __init__(self):
        self.api_key = os.environ.get("CEREBRAS_API_KEY", "")
        self.model = (
            os.environ.get("CEREBRAS_AGENT_MODEL")
            or os.environ.get("CEREBRAS_CHAT_MODEL")
            or "qwen-3-235b-a22b-instruct-2507"
        )
        self.url = "https://api.cerebras.ai/v1/chat/completions"

    def complete(
        self,
        system: str,
        messages: List[Dict[str, str]],
        max_tokens: int = 4096,
    ) -> str:
        """Send request to Cerebras AI and return text response."""
        api_messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
        api_messages.extend(messages)

        body: Dict[str, Any] = {
            "model": self.model,
            "messages": api_messages,
            "max_tokens": max_tokens,
            "stream": False,
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            self.url,
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
                parsed = result.get("result", result)
                if isinstance(parsed, dict):
                    text = parsed.get("response", "")
                    if isinstance(text, dict):
                        text = text.get("message") or text.get("text") or json.dumps(text)
                    elif not isinstance(text, str):
                        text = str(text)
                    if not text:
                        choices = result.get("choices", [])
                        if choices:
                            text = choices[0].get("message", {}).get("content", "")
                    return text.strip()
                return str(parsed).strip()
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


WEB_AGENT_SYSTEM_PROMPT = """
You are a web browsing agent. Your job is to navigate the internet, extract information, and interact with web pages to complete tasks.

BROWSER RULES
- Always use browser tools to access and read every URL provided by the user
- Always use browser tools to access URLs found in search results before using their content
- Actively explore valuable links for deeper information by clicking elements or accessing URLs directly
- Browser tools only return elements visible in the current viewport by default
- Visible elements are returned as index[:]<tag>text</tag> where index is used for interactive actions
- Not all interactive elements may be identified due to technical limitations; use X/Y coordinates to interact with unlisted elements
- Browser tools automatically extract page content in Markdown format when possible
- If extracted Markdown is complete and sufficient for the task, no scrolling is needed; otherwise actively scroll to view the entire page
- Suggest user to take over the browser for sensitive operations or actions with side effects when necessary

INFORMATION RULES
- Information priority: authoritative datasource API first, then web search, then internal model knowledge as last resort
- Search result snippets are not valid sources — always visit the original page via browser before using any information
- Access multiple URLs from search results for comprehensive information or cross-validation
- Search multiple attributes of a single entity separately rather than in one broad query
- Process multiple entities one by one, not all at once
"""

FILE_AGENT_SYSTEM_PROMPT = """
You are a file management agent. Your job is to read, write, edit, search, and organize files to complete tasks.

FILE RULES
- Always use file tools for reading, writing, appending, and editing to avoid string escape issues in shell commands
- Actively save intermediate results and store different types of reference information in separate files
- When merging text files, always use append mode of the file writing tool to concatenate content to the target file
- Never use list formats in any files except todo.md
- Provide all relevant files as attachments in messages, as users may not have direct access to the local filesystem
"""

DATA_AGENT_SYSTEM_PROMPT = """
You are a data agent. Your job is to access authoritative data sources, process data, perform analysis, and produce visualizations and reports.

DATASOURCE MODULE RULES
- Only use data APIs already existing in the event stream; fabricating non-existent APIs is strictly prohibited
- Prioritize using APIs for data retrieval; only use the public internet when data APIs cannot meet requirements
- Data API usage costs are covered by the system, no login or authorization needed
- Data APIs must be called through Python code only and cannot be used as direct tools
- Python libraries for data APIs are pre-installed in the environment, ready to use after import
- Always save retrieved data to files instead of outputting intermediate results

INFORMATION PRIORITY RULES
- Priority order: authoritative data from datasource API first, then web search, then model internal knowledge as last resort
- Prefer dedicated search tools over browser access to search engine result pages
- Search result snippets are not valid sources; always access original pages via browser
- Access multiple URLs from search results for comprehensive information or cross-validation
- Conduct searches step by step: search multiple attributes of a single entity separately, process multiple entities one by one

CODING RULES FOR DATA PROCESSING
- Always save code to files before execution; passing raw code directly to interpreter commands is forbidden
- Write Python code for all complex mathematical calculations and data analysis
- Use search tools to find solutions when encountering unfamiliar problems
- Use pandas, numpy, and visualization libraries for data processing tasks
"""

CODE_AGENT_SYSTEM_PROMPT = """
You are a code execution agent. Your job is to write, execute, debug, and automate code to complete tasks using shell and programming environments.

CODING RULES
- Always save code to files before execution; passing raw code directly to interpreter commands is strictly forbidden
- Write Python code for all complex mathematical calculations and analysis
- Use search tools to find solutions when encountering unfamiliar problems
- For index.html referencing local resources, use deployment tools directly, or package everything into a zip file and provide it as a message attachment

SHELL RULES
- Avoid commands requiring confirmation; actively use -y or -f flags for automatic confirmation
- Avoid commands with excessive output; save output to files when necessary
- Chain multiple commands with && operator to minimize interruptions
- Use pipe operator to pass command outputs, simplifying operations
- Use non-interactive bc for simple calculations, Python for complex math; never calculate mentally
- Use uptime command when users explicitly request sandbox status check or wake-up

SANDBOX ENVIRONMENT
System Environment:
- Ubuntu 22.04 (linux/amd64) with internet access
- User: ubuntu, with sudo privileges
- Home directory: /home/ubuntu

Development Environment:
- Python 3.10.12 (commands: python3, pip3)
- Node.js 20.18.0 (commands: node, npm)
- Basic calculator (command: bc)

Sleep Settings:
- Sandbox environment is immediately available at task start, no check needed
- Inactive sandbox environments automatically sleep and wake up

ERROR HANDLING FOR CODE
- Tool execution failures are provided as events in the event stream
- When errors occur, first verify tool names and arguments
- Attempt to fix issues based on error messages; if unsuccessful, try alternative methods
- When multiple approaches fail, report failure reasons to user and request assistance
"""

ORCHESTRATOR_SYSTEM_PROMPT = """
You are Manus, an AI agent created by the Manus team.

You excel at the following tasks:
1. Information gathering, fact-checking, and research
2. Data processing, analysis, and visualization
3. Writing, editing, and content creation in all formats
4. Code programming and debugging across multiple languages
5. File creation, management, organization, and conversion
6. Web browsing, search, and online information extraction

LANGUAGE SETTINGS
- Default working language is English
- Use the language specified by the user in their messages
- All thinking and reasoning should match the working language

AGENT LOOP
You operate in a continuous loop with these steps:
1. Analyze all events in the event stream including messages, actions, observations, and results
2. Select the most appropriate specialist agent for each sub-task
3. Delegate work to the selected agent using clear, specific instructions
4. Collect and review the observations returned by agents
5. Synthesize all results into a coherent final response for the user
6. Enter standby when all tasks are complete and await next user message

PLANNER MODULE RULES
- Always create a plan before executing complex multi-step tasks
- Break tasks into atomic, executable steps using numbered pseudocode
- Update the plan after each step completes with status and reflection
- Adapt the plan if observations reveal new information or blockers

TODO RULES
- Maintain a todo list to track progress through multi-step tasks
- Mark items complete only after verifying successful execution
- Never skip steps; always execute the plan in sequence

MESSAGE RULES
- Always communicate results clearly and completely to the user
- Provide progress updates for long-running tasks
- Ask for clarification when requirements are ambiguous

WRITING RULES
- Write all responses in continuous prose without bullet points
- Use clear, natural language that matches the user's style
- Synthesize information into coherent narratives, not lists

ERROR HANDLING RULES
- When an agent fails, analyze the error and try an alternative approach
- Report failures transparently and explain what went wrong
- Request user assistance only when all automated approaches are exhausted

TOOL USE RULES
- Plain text responses are forbidden; always use available tools
- Never mention tool names or implementation details to users
- Use the most appropriate specialist agent for each task type
"""

AGENT_PROMPTS = {
    AgentType.WEB: WEB_AGENT_SYSTEM_PROMPT,
    AgentType.FILE: FILE_AGENT_SYSTEM_PROMPT,
    AgentType.DATA: DATA_AGENT_SYSTEM_PROMPT,
    AgentType.CODE: CODE_AGENT_SYSTEM_PROMPT,
}


class TaskSession:
    def __init__(self, task_id: str, language: str = "English"):
        self.task_id = task_id
        self.language = language
        self.status = TaskStatus.RUNNING
        self.event_stream = []
        self.messages = []
        self.current_step = 0
        self.total_steps = 0
        self.result = None
        self.attachments = []
        self.todo = []
        self.created_at = time.time()

    def add_event(self, event_type: EventType, content: str, role: str = "system") -> dict:
        event = {
            "id": str(uuid.uuid4())[:8],
            "type": event_type.value,
            "content": content,
            "role": role,
            "timestamp": time.time(),
        }
        self.event_stream.append(event)
        return event

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "current_step": self.current_step,
            "total_steps": self.total_steps,
            "result": self.result,
            "attachments": self.attachments,
            "event_count": len(self.event_stream),
            "created_at": self.created_at,
        }


class PlannerModule:
    def __init__(self, client: CerebrasClient):
        self.client = client

    def create_plan(self, task: str, session: TaskSession) -> list:
        system = (
            "You are a task planner. Break the given task into clear numbered pseudocode steps. "
            "Return ONLY a JSON array of step strings. Example: [\"Step 1: ...\", \"Step 2: ...\"]"
        )
        steps = self.client.complete_json(
            system=system,
            messages=[{"role": "user", "content": task}],
            max_tokens=1024,
        )
        if not isinstance(steps, list):
            steps = [str(steps)]
        session.total_steps = len(steps)
        session.todo = [{"step": s, "done": False} for s in steps]
        session.add_event(
            EventType.PLAN,
            "\n".join(str(s) for s in steps),
            role="planner",
        )
        return steps

    def update_step(self, session: TaskSession, step_index: int, reflection: str) -> None:
        session.current_step = step_index + 1
        if step_index < len(session.todo):
            session.todo[step_index]["done"] = True
        session.add_event(
            EventType.PLAN,
            json.dumps({
                "current_step": session.current_step,
                "status": "completed",
                "reflection": reflection,
            }),
            role="planner",
        )


class AgentRouter:
    KEYWORD_MAP = {
        AgentType.WEB: [
            "browse", "search", "url", "website", "web", "scrape",
            "extract", "navigate", "http", "internet", "page", "link",
        ],
        AgentType.FILE: [
            "file", "read", "write", "save", "load", "folder",
            "directory", "path", "document", "upload", "download", "zip",
        ],
        AgentType.DATA: [
            "data", "analyze", "analysis", "chart", "graph", "plot",
            "dataset", "csv", "excel", "statistics", "api", "database",
        ],
        AgentType.CODE: [
            "code", "script", "run", "execute", "python", "javascript",
            "install", "debug", "automate", "shell", "terminal", "bash",
        ],
    }

    def route(self, task_description: str) -> AgentType:
        lower = task_description.lower()
        scores = {agent_type: 0 for agent_type in AgentType}
        for agent_type, keywords in self.KEYWORD_MAP.items():
            for keyword in keywords:
                if keyword in lower:
                    scores[agent_type] += 1
        best = max(scores, key=lambda k: scores[k])
        if scores[best] == 0:
            return AgentType.WEB
        return best


class SpecialistAgent:
    def __init__(self, agent_type: AgentType, client: CerebrasClient):
        self.agent_type = agent_type
        self.client = client
        self.system_prompt = AGENT_PROMPTS[agent_type]

    def execute(self, step: str, session: TaskSession) -> str:
        task_context = ""
        if session.event_stream:
            first_event = session.event_stream[0]
            task_context = first_event.get("content", "")

        user_content = (
            f"Task context: {task_context}\n\n"
            f"Current step to execute: {step}\n\n"
            f"Language: {session.language}\n\n"
            "Execute this step and provide a detailed result."
        )
        result_text = self.client.complete(
            system=self.system_prompt,
            messages=[{"role": "user", "content": user_content}],
            max_tokens=2048,
        )

        session.add_event(
            EventType.ACTION,
            f"[{self.agent_type.value.upper()} AGENT] Executing: {step}",
            role="agent",
        )
        session.add_event(
            EventType.OBSERVATION,
            result_text,
            role="agent",
        )
        return result_text


class Orchestrator:
    def __init__(self):
        self.client = CerebrasClient()
        self.planner = PlannerModule(self.client)
        self.router = AgentRouter()
        self.sessions: dict = {}

    def create_task(self, message: str, language: str = "English") -> str:
        task_id = str(uuid.uuid4())
        session = TaskSession(task_id=task_id, language=language)
        session.add_event(EventType.MESSAGE, message, role="user")
        self.sessions[task_id] = session
        return task_id

    def get_status(self, task_id: str) -> dict:
        session = self._get_session(task_id)
        return session.to_dict()

    def get_result(self, task_id: str) -> dict:
        session = self._get_session(task_id)
        return {
            "task_id": task_id,
            "status": session.status.value,
            "result": session.result,
            "attachments": session.attachments,
            "todo": session.todo,
        }

    def reply_to_agent(self, task_id: str, user_reply: str) -> None:
        session = self._get_session(task_id)
        session.add_event(EventType.MESSAGE, user_reply, role="user")
        session.status = TaskStatus.RUNNING

    def run_task(self, task_id: str) -> None:
        session = self._get_session(task_id)
        try:
            user_message = session.event_stream[0]["content"] if session.event_stream else ""
            steps = self.planner.create_plan(user_message, session)
            step_results = []
            for i, step in enumerate(steps):
                agent_type = self.router.route(step)
                agent = SpecialistAgent(agent_type, self.client)
                result = agent.execute(step, session)
                step_results.append((i + 1, step, result))
                self.planner.update_step(session, i, result[:200])

            compiled = self._compile_results(step_results, session)
            session.result = compiled
            session.status = TaskStatus.COMPLETE
        except Exception as e:
            session.status = TaskStatus.ERROR
            session.result = str(e)

    def _compile_results(self, step_results: list, session: TaskSession) -> str:
        results_text = "\n\n".join(
            f"Step {num}: {step}\nResult: {result}"
            for num, step, result in step_results
        )
        compile_prompt = (
            f"The following are the results of each step in a multi-step task.\n\n"
            f"{results_text}\n\n"
            f"Synthesize all these results into a coherent, detailed response in {session.language}. "
            f"Write in continuous prose without bullet points. "
            f"Provide a complete and unified answer to the original task."
        )
        return self.client.complete(
            system=ORCHESTRATOR_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": compile_prompt}],
            max_tokens=4096,
        )

    def _get_session(self, task_id: str) -> TaskSession:
        if task_id not in self.sessions:
            raise ValueError(f"Task ID '{task_id}' not found.")
        return self.sessions[task_id]


if __name__ == "__main__":
    orchestrator = Orchestrator()
    task_id = orchestrator.create_task(
        message="Research the latest developments in AI language models and summarize key findings.",
        language="English",
    )
    print(f"Task ID: {task_id}")
    orchestrator.run_task(task_id)
    result = orchestrator.get_result(task_id)
    print(f"Status: {result['status']}")
    print(f"Result:\n{result['result']}")
