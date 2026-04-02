"""
Plan-Act Flow for Dzeck AI Agent.

DzeckAgent: async Plan-Act orchestrator that:
- Builds a multi-step plan via Cerebras LLM (planner)
- Executes each step with specialized sub-agents (web/code/files/data)
- Persists all state to MongoDB + Redis (no local fallback)
- Streams SSE events in real time
"""
import os
import re
import sys
import json
import time
import asyncio
import traceback
from enum import Enum
from typing import AsyncGenerator, Any, Dict, List, Optional

from server.agent.tools.registry import (
    TOOLS,
    resolve_tool_name,
    get_toolkit_name,
    execute_tool,
    get_all_tool_schemas,
)
from server.agent.tools.executor import ToolCallParser as _ToolCallParser

from server.agent.models.plan import Plan, Step, ExecutionStatus
from server.agent.models.event import PlanStatus, StepStatus, ToolStatus
from server.agent.models.memory import Memory
from server.agent.models.tool_result import ToolResult

from server.agent.utils.robust_json_parser import RobustJsonParser

from server.agent.prompts.system import SYSTEM_PROMPT
from server.agent.prompts.planner import (
    PLANNER_SYSTEM_PROMPT,
    CREATE_PLAN_PROMPT,
    UPDATE_PLAN_PROMPT,
)
from server.agent.prompts.execution import (
    EXECUTION_SYSTEM_PROMPT,
    EXECUTION_PROMPT,
    SUMMARIZE_PROMPT,
)
from server.agent.prompts.agents.web_agent import WEB_AGENT_SYSTEM_PROMPT, WEB_AGENT_TOOLS
from server.agent.prompts.agents.data_agent import DATA_AGENT_SYSTEM_PROMPT, DATA_AGENT_TOOLS
from server.agent.prompts.agents.code_agent import CODE_AGENT_SYSTEM_PROMPT, CODE_AGENT_TOOLS
from server.agent.prompts.agents.files_agent import FILES_AGENT_SYSTEM_PROMPT, FILES_AGENT_TOOLS
from server.agent.prompts.agents.orchestrator import ORCHESTRATOR_SYSTEM_PROMPT, ORCHESTRATOR_TOOLS

from server.agent.domain.cohere import (
    CEREBRAS_API_URL,
    _build_request_body,
    _make_cerebras_request,
    call_text_with_retry,
    call_api_with_retry,
    call_cerebras_streaming_realtime,
    _extract_cerebras_response,
    _TOOLS_SUPPORTED,
)
from server.agent.domain.events import make_event, build_tool_content, _make_e2b_proxy_url
from server.agent.services import memory_service as _memory_service


class FlowState(str, Enum):
    IDLE = "idle"
    PLANNING = "planning"
    EXECUTING = "executing"
    UPDATING = "updating"
    SUMMARIZING = "summarizing"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"


_AGENT_CONTEXT_MAP: Dict[str, tuple] = {
    "orchestrator": (ORCHESTRATOR_SYSTEM_PROMPT, ORCHESTRATOR_TOOLS),
    "web": (WEB_AGENT_SYSTEM_PROMPT, WEB_AGENT_TOOLS),
    "data": (DATA_AGENT_SYSTEM_PROMPT, DATA_AGENT_TOOLS),
    "code": (CODE_AGENT_SYSTEM_PROMPT, CODE_AGENT_TOOLS),
    "files": (FILES_AGENT_SYSTEM_PROMPT, FILES_AGENT_TOOLS),
    "general": (EXECUTION_SYSTEM_PROMPT, None),
}

_AGENT_DISPLAY_NAMES: Dict[str, str] = {
    "orchestrator": "Orchestrator Agent (Routing & Coordination)",
    "web": "Web Agent (Browsing & Extraction)",
    "data": "Data Agent (Analysis & API)",
    "code": "Code Agent (Python & Automation)",
    "files": "Files Agent (Management & Processing)",
    "general": "Execution Agent",
}


def _get_agent_context(agent_type: str) -> tuple:
    return _AGENT_CONTEXT_MAP.get(agent_type, _AGENT_CONTEXT_MAP["general"])


def _filter_tool_schemas(allowed_tools: Optional[List[str]]) -> List[Dict[str, Any]]:
    schemas = _build_tool_schemas()
    if allowed_tools is None:
        return schemas
    allowed_set = set(allowed_tools)
    allowed_set.add("idle")
    allowed_set.add("task_complete")
    return [s for s in schemas if s.get("name") in allowed_set]


def _build_tool_schemas() -> List[Dict[str, Any]]:
    schemas = []
    for openai_schema in get_all_tool_schemas():
        fn = openai_schema.get("function", openai_schema)
        schemas.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {"type": "object"}),
        })
    return schemas


_redis_pause_client = None
_redis_pause_client_lock = None


def _get_redis_pause_client():
    """Get or create a cached synchronous Redis client for pause/stop checks."""
    global _redis_pause_client, _redis_pause_client_lock
    import threading
    if _redis_pause_client_lock is None:
        _redis_pause_client_lock = threading.Lock()
    with _redis_pause_client_lock:
        if _redis_pause_client is not None:
            return _redis_pause_client
        _redis_host = os.environ.get("REDIS_HOST", "")
        if not _redis_host:
            return None
        try:
            import redis as _redis_lib
            _client = _redis_lib.Redis(
                host=_redis_host,
                port=int(os.environ.get("REDIS_PORT", "6379")),
                password=os.environ.get("REDIS_PASSWORD") or os.environ.get("REDIS_PASS") or None,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            _client.ping()
            _redis_pause_client = _client
            return _redis_pause_client
        except Exception:
            return None


def _is_session_paused(session_id: str) -> bool:
    if not session_id:
        return False
    try:
        rc = _get_redis_pause_client()
        if rc is None:
            return False
        _val = rc.get("agent:{}:paused".format(session_id))
        return bool(_val)
    except Exception:
        return False


def _is_session_stopped(session_id: str) -> bool:
    """Check if the agent has received a stop signal via Redis.
    Key: agent:<session_id>:stop (matches routes.ts POST /api/sessions/:id/stop).
    Called at the start of every iteration in PlanActAgent._run_agent_loop().
    """
    if not session_id:
        return False
    try:
        rc = _get_redis_pause_client()
        if rc is None:
            return False
        _val = rc.get("agent:{}:stop".format(session_id))
        return bool(_val)
    except Exception:
        return False


def _coerce_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no", "")
    if value is None:
        return default
    return bool(value)


def _compact_exec_messages(messages: list) -> list:
    if len(messages) <= 6:
        return messages

    system_msg = messages[0]
    first_user_msg = messages[1] if len(messages) > 1 else None
    last_2 = messages[-2:]
    middle = messages[2:-2] if len(messages) > 4 else []
    if not middle:
        return messages

    compacted_middle = []
    for msg in middle:
        role = msg.get("role", "")
        content = str(msg.get("content", ""))

        is_browser_result = any(kw in content for kw in [
            "browser_navigate", "browser_view", "browser_click",
            "<html", "<!DOCTYPE", "document.querySelector",
        ])
        is_file_write = "file_write" in content or "Wrote file" in content or "File written" in content
        is_shell_result = "return_code:" in content or "stdout:" in content

        if is_browser_result and not is_file_write:
            truncated = content[:200] + "...[browser content truncated]" if len(content) > 200 else content
            compacted_middle.append({"role": role, "content": truncated})
        elif is_file_write:
            compacted_middle.append(msg)
        elif is_shell_result:
            truncated = content[:800] + "...[truncated]" if len(content) > 800 else content
            compacted_middle.append({"role": role, "content": truncated})
        else:
            truncated = content[:400] + "...[truncated]" if len(content) > 400 else content
            compacted_middle.append({"role": role, "content": truncated})

    result = [system_msg]
    if first_user_msg:
        result.append(first_user_msg)
    result.extend(compacted_middle)

    # Cap browser content in the last 2 messages as well (max 1500 chars each)
    for msg in last_2:
        role = msg.get("role", "")
        content = str(msg.get("content", ""))
        is_browser_result = any(kw in content for kw in [
            "browser_navigate", "browser_view", "browser_click",
            "<html", "<!DOCTYPE", "document.querySelector",
        ])
        if is_browser_result and len(content) > 1500:
            result.append({"role": role, "content": content[:1500] + "...[browser content truncated]"})
        else:
            result.append(msg)

    return result


def _estimate_payload_chars(messages: list, tools: Optional[List[Dict[str, Any]]] = None) -> int:
    """Estimate total character count of the payload to be sent to the API."""
    total = sum(len(str(m.get("content", ""))) for m in messages)
    if tools:
        total += sum(len(json.dumps(t)) for t in tools)
    return total


def _compact_exec_messages_aggressive(messages: list) -> list:
    """More aggressive compaction: apply browser caps across all non-system messages.

    The system message (index 0, role='system') is preserved intact to avoid
    degrading instruction fidelity. All other messages are capped aggressively.
    """
    result = []
    for i, msg in enumerate(messages):
        role = msg.get("role", "")
        content = str(msg.get("content", ""))
        if i == 0 and role == "system":
            result.append(msg)
            continue
        is_browser_result = any(kw in content for kw in [
            "browser_navigate", "browser_view", "browser_click",
            "<html", "<!DOCTYPE", "document.querySelector",
        ])
        is_shell_result = "return_code:" in content or "stdout:" in content
        if is_browser_result:
            new_content = content[:300] + "...[browser content truncated]" if len(content) > 300 else content
            result.append({"role": role, "content": new_content})
        elif is_shell_result:
            new_content = content[:500] + "...[truncated]" if len(content) > 500 else content
            result.append({"role": role, "content": new_content})
        else:
            new_content = content[:400] + "...[truncated]" if len(content) > 400 else content
            result.append({"role": role, "content": new_content})
    return result


_AGENT_TOOL_ALLOWLIST: Dict[str, Optional[List[str]]] = {
    "web": WEB_AGENT_TOOLS,
    "data": DATA_AGENT_TOOLS,
    "code": CODE_AGENT_TOOLS,
    "files": FILES_AGENT_TOOLS,
    "general": None,
    "orchestrator": None,
}


_MANDATORY_TOOLS = {"idle", "task_complete"}


def _filter_tools_for_agent(
    tools: List[Dict[str, Any]],
    agent_type: str,
) -> List[Dict[str, Any]]:
    """Filter tool schemas to only those relevant for the given agent_type.

    Uses canonical agent tool allowlists (same lists used by _AGENT_CONTEXT_MAP)
    to reduce tool schema payload before sending to the API. For agent types
    without a defined allowlist (general, orchestrator), returns the full list.
    Mandatory control tools (idle, task_complete) are always included regardless
    of the allowlist to preserve step-completion semantics.
    Falls back to the full list if the filter produces an empty result.
    """
    allowlist = _AGENT_TOOL_ALLOWLIST.get(agent_type)
    if allowlist is None:
        return tools
    allowed_set = set(allowlist) | _MANDATORY_TOOLS
    filtered = [t for t in tools if t.get("name", "") in allowed_set]
    if not filtered:
        return tools
    return filtered


def _enforce_payload_limit(
    messages: list,
    tools: Optional[List[Dict[str, Any]]],
    limit: int = 60000,
) -> list:
    """Ensure total payload chars stay under limit by iteratively compacting messages.

    Strategy (in order):
    1. Return immediately if already under limit.
    2. Apply aggressive compaction (system msg preserved, non-system capped).
    3. If still over, emergency trim: system + last 3 messages only.
    4. Final guard: iteratively drop oldest non-system messages until under limit
       or only system + 1 message remains.
    4. Log to stderr at each escalation level.
    """
    if _estimate_payload_chars(messages, tools) <= limit:
        return messages
    sys.stderr.write("[agent] Payload too large (>{}), applying aggressive compaction before send\n".format(limit))
    sys.stderr.flush()
    compacted = _compact_exec_messages_aggressive(messages)
    if _estimate_payload_chars(compacted, tools) <= limit:
        return compacted
    # Emergency trim: keep system message + the last 3 messages only
    sys.stderr.write("[agent] Payload still too large after aggressive compaction — applying emergency trim\n")
    sys.stderr.flush()
    if len(compacted) <= 4:
        emergency = compacted
    else:
        emergency = [compacted[0]] + compacted[-3:]
    # Final guard: iteratively drop oldest non-system messages until under limit
    while len(emergency) > 2 and _estimate_payload_chars(emergency, tools) > limit:
        sys.stderr.write("[agent] Emergency trim: dropping oldest non-system message to fit payload limit\n")
        sys.stderr.flush()
        emergency = [emergency[0]] + emergency[2:]
    final_size = _estimate_payload_chars(emergency, tools)
    if final_size > limit:
        sys.stderr.write(
            "[agent] WARNING: payload ({} chars) still exceeds limit ({}) after all trimming "
            "(likely large system msg or tool schemas). Sending anyway.\n".format(final_size, limit)
        )
        sys.stderr.flush()
    return emergency


def safe_plan_dict(plan: Optional["Plan"]) -> Dict[str, Any]:
    """Convert a Plan to a dict safe for JSON serialization.

    Returns an empty-but-valid plan dict if plan is None, so callers
    never receive a non-dict value (prevents frontend crashes on None plan).
    """
    if plan is None:
        return {"title": "", "steps": [], "status": "creating"}
    try:
        d = plan.to_dict()
    except Exception:
        return {"title": "", "steps": [], "status": "creating"}
    d.pop("goal", None)
    return d


class DzeckAgent:
    """
    Async AI Agent implementing Plan-Act flow.

    Supports:
    - Full session persistence (MongoDB)
    - Redis state caching
    - Session resume / rollback
    - Real Playwright browser automation via E2B Desktop
    - Multi-agent dispatch (web/code/files/data)
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        max_tool_iterations: int = 20,
    ) -> None:
        self.session_id = session_id
        self.memory = Memory()
        self.max_tool_iterations = max_tool_iterations
        self.plan: Optional[Plan] = None
        self.state = FlowState.IDLE
        self.parser = RobustJsonParser()
        self._session_service: Any = None
        self._created_files: List[Dict[str, Any]] = []
        self.chat_history: List[Dict[str, Any]] = []

    async def _get_session_service(self) -> Any:
        if self._session_service is None:
            try:
                from server.agent.services.session_service import get_session_service
                self._session_service = await get_session_service()
            except Exception as e:
                sys.stderr.write("[agent] Session service unavailable: {}\n".format(e))
                sys.stderr.flush()
        return self._session_service

    def _is_explicitly_actionable(self, user_message: str) -> bool:
        msg = user_message.strip().lower()
        raw = user_message.strip()
        has_url = bool(re.search(r'https?://', raw))
        action_kw = re.search(
            r'\b(buka|navigasi|navigate|go to|open|browse|visit|scroll|klik|click'
            r'|jalankan|run|execute|gunakan browser|langsung|tanpa bertanya'
            r'|lakukan langsung)\b',
            msg,
        )
        if has_url and action_kw:
            return True
        if re.search(r'\b(lakukan langsung|tanpa bertanya|langsung saja|just do it|do it now)\b', msg):
            return True
        return False

    async def _pre_plan_clarification_check(
        self,
        user_message: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[str]:
        if self._is_explicitly_actionable(user_message):
            return None
        import urllib.request as _ur
        sys_msg = {
            "role": "system",
            "content": (
                "Kamu adalah asisten yang membantu menentukan apakah permintaan user cukup spesifik "
                "untuk dikerjakan langsung, atau perlu klarifikasi terlebih dahulu.\n\n"
                "Jawab HANYA dengan JSON valid:\n"
                "{\"needs_clarification\": true/false, \"question\": \"pertanyaan klarifikasi jika perlu\"}\n\n"
                "Perlu klarifikasi JIKA permintaan terlalu umum dan detail penting tidak diketahui, "
                "misalnya: 'buat script Python' (tapi tidak tahu untuk apa), "
                "'buat presentasi' (tapi tidak tahu topik/slide/tujuannya), "
                "'kumpulkan riset' (tapi tidak tahu tentang apa).\n\n"
                "TIDAK perlu klarifikasi JIKA: permintaan sudah spesifik, "
                "user sudah menyebutkan tujuan/detail yang cukup, "
                "atau ini pertanyaan faktual sederhana."
            ),
        }
        messages: List[Dict[str, Any]] = [sys_msg]
        if chat_history:
            for h in (chat_history or [])[-6:]:
                role = h.get("role", "")
                content = h.get("content", "")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": str(content)[:800]})
        messages.append({
            "role": "user",
            "content": "Permintaan user: \"{}\"".format(user_message),
        })
        try:
            loop = asyncio.get_running_loop()
            body = _build_request_body(messages, stream=False)
            body["max_tokens"] = 200
            req = _make_cerebras_request(CEREBRAS_API_URL, body)

            def _do_request() -> Optional[str]:
                try:
                    with _ur.urlopen(req, timeout=15) as resp:
                        parsed = json.loads(resp.read().decode("utf-8", errors="replace"))
                    choices = parsed.get("choices", [])
                    content = choices[0].get("message", {}).get("content", "") if choices else ""
                    if not content:
                        return None
                    content = content.strip()
                    if content.startswith("```"):
                        content = content.split("```")[1]
                        if content.startswith("json"):
                            content = content[4:]
                    result = json.loads(content)
                    if result.get("needs_clarification") and result.get("question"):
                        return str(result["question"])
                    return None
                except Exception as e:
                    sys.stderr.write("[agent] Clarification check error: {}\n".format(e))
                    return None

            return await loop.run_in_executor(None, _do_request)
        except Exception:
            return None

    async def _persist_event(self, event_type: str, data: Dict[str, Any]) -> None:
        if not self.session_id:
            return
        try:
            from server.agent.db.session_store import get_session_store as _get_store
            store = await _get_store()
            if store:
                await store.save_event(self.session_id, event_type, data)
        except RuntimeError as _pe:
            import logging as _pelog
            _pelog.getLogger(__name__).warning(
                "[agent_flow] _persist_event failed — event not saved (session=%s type=%s): %s",
                self.session_id, event_type, _pe,
            )
        except Exception as _pe:
            import logging as _pelog
            _pelog.getLogger(__name__).error(
                "[agent_flow] _persist_event unexpected error (session=%s type=%s): %s",
                self.session_id, event_type, _pe,
            )

    def _parse_response(self, text: str) -> Dict[str, Any]:
        result, _ = self.parser.parse(text)
        return result if result is not None else {}

    async def _route_with_orchestrator_async(self, user_message: str) -> str:
        """Use a lightweight LLM call to determine the best agent_type for the task.

        Returns one of: "web", "data", "code", "files", "orchestrator", "general".
        Falls back to "general" on any error or ambiguity.
        """
        import urllib.request as _ur
        valid_types = {"web", "data", "code", "files", "orchestrator", "general"}
        sys_msg = {
            "role": "system",
            "content": (
                "Kamu adalah router agent. Tentukan SATU agent type yang paling cocok "
                "untuk mengerjakan task ini. Agent types yang tersedia:\n"
                "- web: browsing internet, scraping, web search, visit URL\n"
                "- data: analisis data, API calls, SQL, visualisasi\n"
                "- code: tulis/jalankan kode Python, automation, file programming\n"
                "- files: manajemen file, baca/tulis file, konversi dokumen\n"
                "- orchestrator: task kompleks yang butuh koordinasi multi-agent\n"
                "- general: task umum, pertanyaan, tugas sederhana\n\n"
                "Jawab HANYA dengan JSON: {\"agent_type\": \"<type>\"}"
            ),
        }
        messages = [
            sys_msg,
            {"role": "user", "content": "Task: {}".format(user_message[:600])},
        ]
        try:
            loop = asyncio.get_running_loop()
            body = _build_request_body(messages, stream=False)
            body["max_tokens"] = 60
            req = _make_cerebras_request(CEREBRAS_API_URL, body)

            def _do_request() -> str:
                try:
                    with _ur.urlopen(req, timeout=10) as resp:
                        parsed = json.loads(resp.read().decode("utf-8", errors="replace"))
                    choices = parsed.get("choices", [])
                    content = choices[0].get("message", {}).get("content", "") if choices else ""
                    content = content.strip()
                    if content.startswith("```"):
                        parts = content.split("```")
                        content = parts[1] if len(parts) > 1 else content
                        if content.startswith("json"):
                            content = content[4:]
                    result = json.loads(content)
                    agent_type = str(result.get("agent_type", "general")).strip().lower()
                    return agent_type if agent_type in valid_types else "general"
                except Exception:
                    return "general"

            return await loop.run_in_executor(None, _do_request)
        except Exception:
            return "general"

    def _detect_language(self, text: str) -> str:
        id_words = [
            "saya", "anda", "untuk", "yang", "dengan", "dari", "ini",
            "itu", "bisa", "akan", "sudah", "tidak", "ada", "juga",
            "atau", "harus", "karena", "supaya", "seperti", "bantu",
            "tolong", "projek", "bagaimana", "silakan", "terima", "kasih",
        ]
        text_lower = text.lower()
        id_count = sum(1 for w in id_words if w in text_lower)
        if id_count >= 2:
            return "id"
        if any("\u4e00" <= c <= "\u9fff" for c in text):
            return "zh"
        if any("\u3040" <= c <= "\u309f" or "\u30a0" <= c <= "\u30ff" for c in text):
            return "ja"
        if any("\uac00" <= c <= "\ud7af" for c in text):
            return "ko"
        return "id"

    def _is_simple_query(self, user_message: str) -> bool:
        msg = user_message.strip().lower()
        raw = user_message.strip()

        if re.search(r'https?://', raw):
            return False

        tool_required_patterns = [
            r'\b(today|sekarang|hari ini|saat ini|terbaru|latest|current|now|live)\b',
            r'\b(news|berita|harga|price|cuaca|weather|stock|saham|kurs|exchange rate)\b',
            r'\b(trending|viral|populer|terkini|breaking)\b',
            r'\b(buka|buka situs|browse|visit|navigat|go to|open|akses|cek website|kunjungi)\b',
            r'\b(download|unduh|upload|scrape|crawl)\b',
            r'\b(install|uninstall|pip install|apt-get|npm install)\b',
            r'\b(run|execute|jalankan|eksekusi|exec)\b',
            r'\b(buat file|create file|write file|tulis file|simpan file|save file)\b',
            r'\b(buat folder|create folder|mkdir|hapus file|delete file)\b',
            r'\b(deploy|publish|hosting|server|api endpoint)\b',
            r'\b(bash|shell|command|cmd|terminal|script\.sh|\.py|\.js|\.ts)\b',
            r'\b(buat website|create website|build website|buat aplikasi|create app|build app)\b',
            r'\b(buat program|create program|tulis program|write program|code this|coding)\b',
            r'\b(research|riset|investigasi|investigate|analisis mendalam|analyze)\b',
            r'[/\\][a-zA-Z0-9_.-]+\.[a-zA-Z]{2,4}',
        ]
        for pattern in tool_required_patterns:
            if re.search(pattern, msg):
                return False

        conversational = [
            r'^\s*(hi|hello|hey|halo|hai|hei|howdy)\s*[!.]?\s*$',
            r'^\s*(thanks?|thank you|terima kasih|makasih|thx)\s*[!.]?\s*$',
            r'^\s*(ok|okay|oke|baik|siap|noted|got it|paham)\s*[!.]?\s*$',
            r'^\s*(yes|no|ya|tidak|nope|yep|sure)\s*[!.]?\s*$',
            r'^\s*(bye|goodbye|sampai jumpa|dadah|see you)\s*[!.]?\s*$',
            r'^\s*(good morning|good night|selamat pagi|selamat malam|selamat siang|selamat sore)\s*[!.]?\s*$',
            r'\b(how are you|apa kabar|kabar gimana|how\'s it going)\b',
            r'\b(who are you|siapa kamu|siapa anda|kamu siapa|anda siapa)\b',
            r'\b(what can you do|apa yang bisa kamu|kemampuan kamu|fitur kamu)\b',
            r'\b(are you (an )?ai|kamu ai|kamu robot|apakah kamu)\b',
        ]
        for pattern in conversational:
            if re.search(pattern, msg):
                return True

        knowledge_starters = [
            "what is", "what are", "what does", "what was",
            "who is", "who are", "who was",
            "when was", "when did", "where is", "where was",
            "why is", "why are", "why does", "why did",
            "how does", "how do", "how is", "how was",
            "explain", "define", "describe", "tell me about",
            "what's the difference", "compare",
            "apa itu", "apa yang", "apa bedanya",
            "siapa", "kapan", "dimana", "mengapa", "kenapa",
            "jelaskan", "ceritakan", "definisikan", "apa artinya",
            "bagaimana cara", "bagaimana",
        ]
        realtime_signals = [
            r'\b(now|today|current|latest|2024|2025|2026|terbaru|sekarang|hari ini|saat ini)\b',
            r'\b(price|harga|cost|biaya|rate|nilai|kurs)\b',
            r'\b(news|berita|update|terkini|terbaru)\b',
        ]
        for starter in knowledge_starters:
            if msg.startswith(starter) or f' {starter} ' in msg:
                if not any(re.search(p, msg) for p in realtime_signals):
                    return True

        if re.search(r'(\d+[\s]*[\+\-\*\/\^%][\s]*\d+|berapa|calculate|hitung|compute|convert)', msg):
            if not re.search(r'\b(currency|mata uang|kurs|exchange|rate)\b', msg):
                return True

        if re.search(r'\b(translate|terjemahkan|translation|terjemahan|in english|dalam bahasa|ke bahasa)\b', msg):
            return True

        if re.search(r'\b(write a poem|write a story|puisi|cerita pendek|story about|poem about|buat puisi|buat cerita)\b', msg):
            word_count = len(msg.split())
            if word_count < 20:
                return True

        if re.search(r'\b(explain (this )?code|what does this code|apa fungsi|fungsi dari|code ini|kode ini)\b', msg):
            return True

        word_count = len(msg.split())
        if word_count <= 6:
            simple_action = re.search(
                r'\b(cari|search|find|buka|open|buat|create|make|build|tulis|write|jalankan|run)\b',
                msg
            )
            if not simple_action:
                return True

        return False

    def _build_attachments_info(self, attachments: Optional[List] = None) -> str:
        if not attachments:
            return ""
        parts = []
        for a in attachments:
            if isinstance(a, dict):
                fname = a.get("filename") or a.get("name") or "file"
                fpath = a.get("path") or ""
                mime = a.get("mime") or ""
                preview = a.get("preview") or ""
                desc = fname
                if fpath:
                    desc += f" (saved at {fpath})"
                if mime:
                    desc += f" [{mime}]"
                if preview:
                    snippet = preview[:500] + ("..." if len(preview) > 500 else "")
                    desc += f"\nContent preview:\n{snippet}"
                parts.append(desc)
            elif isinstance(a, str):
                parts.append(a)
        return "Lampiran:\n" + "\n---\n".join(parts) if parts else ""

    async def run_planner_async(
        self,
        user_message: str,
        attachments: Optional[List] = None,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> Plan:
        self.state = FlowState.PLANNING
        language = self._detect_language(user_message)
        attachments_info = self._build_attachments_info(attachments)
        history_context = ""
        if chat_history:
            history_parts = []
            for h in chat_history[-6:]:
                role = h.get("role", "")
                content = h.get("content", "")
                if role in ("user", "assistant") and content:
                    label = "User" if role == "user" else "Dzeck"
                    history_parts.append("{}: {}".format(label, str(content)[:500]))
            if history_parts:
                history_context = "\n\nKonteks percakapan sebelumnya:\n" + "\n".join(history_parts)
        prompt = CREATE_PLAN_PROMPT.format(
            message=user_message + history_context,
            language=language,
            attachments_info=attachments_info,
        )
        json_instruction = "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation."
        from server.agent.tools.e2b_sandbox import _detected_home as _planner_home, WORKSPACE_DIR as _planner_wsdir
        _planner_sandbox_home = _planner_home or _planner_wsdir
        _sandbox_ctx = (
            f"\n\n[SANDBOX_CONTEXT] Home directory = {_planner_sandbox_home} | "
            f"Output dir = {_planner_sandbox_home}/output | "
            f"Gunakan '{_planner_sandbox_home}' atau ~ untuk semua path. "
            f"JANGAN hardcode path home lainnya dalam rencana."
        )

        # Inject cross-session memories into planner context (best-effort)
        _memory_ctx = ""
        try:
            _user_id = os.environ.get("DZECK_USER_ID", "") or "auto-user"
            _memories = await _memory_service.load_memories(user_id=_user_id)
            if _memories:
                _memory_ctx = "\n\n" + _memory_service.format_memories_for_prompt(_memories)
        except Exception:
            pass

        messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT + json_instruction + _sandbox_ctx + _memory_ctx},
            {"role": "user", "content": prompt},
        ]

        loop = asyncio.get_running_loop()
        response_text = await loop.run_in_executor(
            None, lambda: call_text_with_retry(messages)
        )
        parsed = self._parse_response(response_text)

        if not parsed:
            return Plan(
                title="Task Execution",
                goal=user_message[:100],
                language=language,
                steps=[Step(id="1", description=user_message)],
                message="I'll work on this task for you.",
            )

        steps = [
            Step(
                id=str(s.get("id", "")),
                description=s.get("description", ""),
                agent_type=s.get("agent_type", "general"),
            )
            for s in parsed.get("steps", [])
        ]
        if not steps:
            steps = [Step(id="1", description=user_message)]

        return Plan(
            title=parsed.get("title", "Task"),
            goal=parsed.get("goal", user_message[:100]),
            language=parsed.get("language", language),
            steps=steps,
            message=parsed.get("message", ""),
        )

    async def _run_tool_streaming(
        self,
        fn_name: str,
        fn_args: Dict[str, Any],
        tool_call_id: str,
        step: Step,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        import queue as _queue_mod

        if fn_name in ("idle", "task_complete"):
            step.status = ExecutionStatus.COMPLETED
            step.success = _coerce_bool(fn_args.get("success"), default=True)
            step.result = fn_args.get("result", "Step completed")
            if not step.success:
                step.status = ExecutionStatus.FAILED

            if step.success and step.result:
                _result_lower = step.result.lower()
                _error_markers = ["traceback", "error:", "failed", "exception:", "syntaxerror", "indentationerror"]
                if any(marker in _result_lower for marker in _error_markers):
                    step.success = False
                    step.status = ExecutionStatus.FAILED
                    step.result += " [AUTO-REJECTED: Output contains unresolved error indicators]"

            status_enum = StepStatus.COMPLETED if step.success else StepStatus.FAILED
            yield make_event("step", status=status_enum.value, step=step.to_dict())
            yield {"type": "__step_done__"}
            return

        resolved = resolve_tool_name(fn_name)
        if resolved is None:
            yield {"type": "__result__", "value": "Unknown tool '{}'.".format(fn_name)}
            return

        if resolved == "message_notify_user":
            text = fn_args.get("text", "") or fn_args.get("message", "")
            raw_attachments = fn_args.get("attachments") or []
            attachment_urls = []
            if raw_attachments:
                try:
                    from server.agent.tools.e2b_sandbox import get_sandbox, _resolve_sandbox_path
                    _sb = get_sandbox()
                    _sandbox_id = _sb.sandbox_id if _sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
                    for fpath in raw_attachments:
                        if not fpath:
                            continue
                        fname = os.path.basename(fpath)
                        sandbox_path = _resolve_sandbox_path(fpath) if not fpath.startswith("/") else fpath
                        durl = _make_e2b_proxy_url(sandbox_path, fname, _sandbox_id)
                        attachment_urls.append({"filename": fname, "download_url": durl, "sandbox_path": sandbox_path})
                        already = any(f.get("filename") == fname for f in self._created_files)
                        if not already:
                            try:
                                from server.agent.tools.e2b_sandbox import _MIME_MAP_E2B
                                ext = os.path.splitext(fname)[1].lower()
                                mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                            except Exception:
                                mime = "application/octet-stream"
                            self._created_files.append({
                                "filename": fname,
                                "sandbox_path": sandbox_path,
                                "sandbox_id": _sandbox_id,
                                "download_url": durl,
                                "mime": mime,
                            })
                except Exception:
                    pass
            if text or attachment_urls:
                yield make_event("notify", text=text, attachments=attachment_urls if attachment_urls else None)
            _res = resolved
            _args = dict(fn_args)
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: execute_tool(_res, _args))
            yield {"type": "__result__", "value": text or "Done"}
            return

        if resolved == "message_ask_user":
            text = fn_args.get("text", "") or fn_args.get("message", "")
            if text:
                yield make_event("message_start", role="ask")
                chunk_size = 10
                for i in range(0, len(text), chunk_size):
                    yield make_event("message_chunk", chunk=text[i:i + chunk_size], role="ask")
                    await asyncio.sleep(0.008)
                yield make_event("message_end", role="ask")
            step.status = ExecutionStatus.PENDING
            step.success = False
            step.result = "Menunggu jawaban user: " + (text[:200] if text else "")
            # Transition state machine to WAITING so callers can check self.state
            self.state = FlowState.WAITING
            yield make_event("step", status=StepStatus.PENDING.value, step=step.to_dict())
            yield make_event("waiting_for_user", text=text or "Menunggu balasan Anda...")
            yield {"type": "__step_done__"}
            return

        toolkit_name = get_toolkit_name(resolved)

        yield make_event(
            "tool",
            status=ToolStatus.CALLING.value,
            tool_name=toolkit_name,
            function_name=resolved,
            function_args=fn_args,
            tool_call_id=tool_call_id,
        )

        loop = asyncio.get_running_loop()
        _res = resolved
        _args = dict(fn_args)

        _is_shell_exec = _res == "shell_exec"
        _is_e2b = bool(os.environ.get("E2B_API_KEY", ""))

        if _is_shell_exec and not _is_e2b:
            from server.agent.tools.shell import set_stream_queue
            stream_q: "_queue_mod.Queue" = _queue_mod.Queue()

            def _run_shell_with_stream():
                set_stream_queue(stream_q)
                try:
                    return execute_tool(_res, _args)
                finally:
                    set_stream_queue(None)

            future = loop.run_in_executor(None, _run_shell_with_stream)

            while not future.done():
                await asyncio.sleep(0.15)
                batch = []
                try:
                    while True:
                        item = stream_q.get_nowait()
                        if item is None:
                            break
                        batch.append(item)
                except _queue_mod.Empty:
                    pass
                if batch:
                    chunk = "\n".join(("[stderr] " if t == "stderr" else "") + l for t, l in batch)
                    yield make_event("tool_stream", tool_call_id=tool_call_id, chunk=chunk)

            try:
                while True:
                    item = stream_q.get_nowait()
                    if item is None:
                        break
            except _queue_mod.Empty:
                pass

            tool_result = await future
        elif _is_shell_exec and _is_e2b:
            e2b_q: "_queue_mod.Queue" = _queue_mod.Queue()

            def _run_e2b_streaming():
                from server.agent.tools.e2b_sandbox import get_sandbox
                from server.agent.tools.shell import (
                    _validate_python_syntax, _check_repeated_command_prerun,
                    _check_repeated_error, _check_error_in_output,
                    _preflight_requirements_file,
                )
                sb = get_sandbox()
                cmd = _args.get("command", "")
                from server.agent.tools.e2b_sandbox import _resolve_workdir as _rwd
                workdir = _rwd(_args.get("exec_dir", "") or "")
                timeout_s = _args.get("timeout", 90)
                if not sb:
                    return execute_tool(_res, _args)

                from server.agent.models.tool_result import ToolResult as _TR

                req_err = _preflight_requirements_file(cmd, workdir)
                if req_err:
                    e2b_q.put(None)
                    return _TR(
                        success=False,
                        message=req_err,
                        data={"stdout": "", "stderr": req_err, "return_code": 1,
                              "command": cmd, "backend": "E2B",
                              "error": "requirements_file_not_found"},
                    )

                blocked = _check_repeated_command_prerun(cmd)
                if blocked:
                    e2b_q.put(None)
                    return blocked

                syntax_err = _validate_python_syntax(cmd, workdir)
                if syntax_err:
                    e2b_q.put(None)
                    return syntax_err

                try:
                    import shlex
                    sb.commands.run(f"mkdir -p {shlex.quote(workdir)} 2>/dev/null || true", timeout=10)
                    result = sb.commands.run(
                        cmd, cwd=workdir, timeout=timeout_s,
                        on_stdout=lambda data: e2b_q.put(("stdout", data if isinstance(data, str) else getattr(data, 'line', str(data)))),
                        on_stderr=lambda data: e2b_q.put(("stderr", data if isinstance(data, str) else getattr(data, 'line', str(data)))),
                    )
                    e2b_q.put(None)
                    combined = ""
                    if result.stdout and result.stdout.strip():
                        combined += "stdout:\n{}".format(result.stdout)
                    if result.stderr and result.stderr.strip():
                        combined += "\nstderr:\n{}".format(result.stderr)
                    combined += "\nreturn_code: {}".format(result.exit_code)

                    stdout_str = result.stdout or ""
                    stderr_str = result.stderr or ""
                    repeat_warn = _check_repeated_error(cmd, stderr_str)
                    if repeat_warn:
                        combined += repeat_warn
                    has_error = _check_error_in_output(stdout_str, stderr_str)
                    if has_error and result.exit_code == 0:
                        combined += "\n⚠️ WARNING: Output contains error indicators despite exit_code=0. Verify output carefully."

                    return _TR(
                        success=(result.exit_code == 0),
                        message=combined,
                        data={"stdout": stdout_str, "stderr": stderr_str,
                              "return_code": result.exit_code, "command": cmd, "backend": "E2B"},
                    )
                except Exception as e:
                    e2b_q.put(None)
                    return _TR(
                        success=False,
                        message=f"E2B error: {e}",
                        data={"stdout": "", "stderr": str(e), "return_code": -1, "command": cmd, "backend": "E2B"},
                    )

            future = loop.run_in_executor(None, _run_e2b_streaming)

            while not future.done():
                await asyncio.sleep(0.15)
                batch = []
                try:
                    while True:
                        item = e2b_q.get_nowait()
                        if item is None:
                            break
                        batch.append(item)
                except _queue_mod.Empty:
                    pass
                if batch:
                    chunk = "\n".join(("[stderr] " if t == "stderr" else "") + l for t, l in batch)
                    yield make_event("tool_stream", tool_call_id=tool_call_id, chunk=chunk)
                    yield make_event("shell_output", tool_call_id=tool_call_id, chunk=chunk,
                                     lines=[{"type": t, "line": l} for t, l in batch])

            final_batch = []
            try:
                while True:
                    item = e2b_q.get_nowait()
                    if item is None:
                        break
                    final_batch.append(item)
            except _queue_mod.Empty:
                pass
            if final_batch:
                chunk = "\n".join(("[stderr] " if t == "stderr" else "") + l for t, l in final_batch)
                yield make_event("tool_stream", tool_call_id=tool_call_id, chunk=chunk)
                yield make_event("shell_output", tool_call_id=tool_call_id, chunk=chunk,
                                 lines=[{"type": t, "line": l} for t, l in final_batch])

            tool_result = await future
        else:
            tool_result = await loop.run_in_executor(
                None, lambda: execute_tool(_res, _args)
            )

        tool_content = build_tool_content(resolved, tool_result)
        result_status = ToolStatus.CALLED if tool_result.success else ToolStatus.ERROR
        fn_result = str(tool_result.message)[:3000] if tool_result.message else ""

        if tool_result.success and resolved in ("file_write", "file_str_replace"):
            data = tool_result.data or {}
            fpath = data.get("file", data.get("path", fn_args.get("file", fn_args.get("path", ""))))
            fname = os.path.basename(fpath) if fpath else ""
            if fname and fpath:
                already = any(f.get("filename") == fname for f in self._created_files)
                if not already:
                    try:
                        from server.agent.tools.e2b_sandbox import get_sandbox, _resolve_sandbox_path
                        sb = get_sandbox()
                        sandbox_id = sb.sandbox_id if sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
                        sandbox_path = _resolve_sandbox_path(fpath) if not fpath.startswith("/") else fpath
                    except Exception:
                        sandbox_id = ""
                        sandbox_path = fpath
                    ext = os.path.splitext(fname)[1].lower()
                    try:
                        from server.agent.tools.e2b_sandbox import _MIME_MAP_E2B
                        mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                    except Exception:
                        mime = "application/octet-stream"
                    durl = _make_e2b_proxy_url(sandbox_path, fname, sandbox_id)
                    self._created_files.append({
                        "filename": fname,
                        "sandbox_path": sandbox_path,
                        "sandbox_id": sandbox_id,
                        "download_url": durl,
                        "mime": mime,
                    })
            if tool_content and tool_content.get("type") == "file":
                tool_content = {k: v for k, v in tool_content.items() if k != "download_url"}

        if tool_result.success and resolved == "shell_exec" and _is_e2b:
            try:
                from server.agent.tools.e2b_sandbox import list_output_files, get_sandbox, _MIME_MAP_E2B
                e2b_files = list_output_files()
                sb = get_sandbox()
                sandbox_id = sb.sandbox_id if sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
                synced_fnames = {f.get("filename", "") for f in self._created_files}
                for ef in e2b_files:
                    fname = os.path.basename(ef)
                    if fname and fname not in synced_fnames:
                        ext = os.path.splitext(fname)[1].lower()
                        mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                        durl = _make_e2b_proxy_url(ef, fname, sandbox_id)
                        self._created_files.append({
                            "filename": fname,
                            "sandbox_path": ef,
                            "sandbox_id": sandbox_id,
                            "download_url": durl,
                            "mime": mime,
                        })
                        synced_fnames.add(fname)
            except Exception:
                pass

        if _is_e2b:
            try:
                from server.agent.tools.e2b_sandbox import get_vnc_stream_url, get_sandbox
                vnc_url = get_vnc_stream_url()
                sb = get_sandbox()
                sandbox_id = sb.sandbox_id if sb else None
                if vnc_url and not getattr(self, '_vnc_url_emitted', False):
                    yield make_event("vnc_stream_url", vnc_url=vnc_url, sandbox_id=sandbox_id)
                    self._vnc_url_emitted = True
            except Exception:
                pass

        _tool_data = tool_result.data or {}
        # Fix #9: browser screenshot streaming — emit browser_screenshot SSE event
        # whenever a browser tool returns screenshot_b64. browser.py._take_screenshot()
        # populates this field for all browser actions. Frontend handles it in
        # agent-event-processor.ts BROWSER_SCREENSHOT → ChatPage.tsx / MainLayout.tsx.
        if resolved in ("browser_navigate", "browser_click", "browser_type", "browser_scroll",
                        "browser_view", "browser_screenshot", "browser_fill", "browser_select",
                        "browser_hover", "browser_back", "browser_forward", "browser_refresh"):
            _scr = _tool_data.get("screenshot_b64", "")
            if _scr:
                yield make_event("browser_screenshot",
                                 screenshot_b64=_scr,
                                 url=_tool_data.get("url", ""),
                                 title=_tool_data.get("title", ""),
                                 tool_call_id=tool_call_id)

        if resolved in ("desktop_screenshot", "desktop_click", "desktop_type", "desktop_move",
                        "desktop_scroll", "desktop_key", "desktop_drag", "desktop_open_app",
                        "computer_use", "computer_screenshot"):
            _scr = _tool_data.get("screenshot_b64", "")
            if _scr:
                yield make_event("desktop_screenshot",
                                 screenshot_b64=_scr,
                                 tool_call_id=tool_call_id)

        if resolved in ("web_search", "search", "search_web", "info_search_web"):
            _results = _tool_data.get("results", [])
            if _results:
                yield make_event("search_results",
                                 results=_results,
                                 query=fn_args.get("query", ""),
                                 tool_call_id=tool_call_id)

        if resolved in ("todo_write", "todo_update", "todo_read"):
            _todo_session = os.environ.get("DZECK_SESSION_ID", "")
            if _todo_session:
                yield make_event("todo_update",
                                 session_id=_todo_session,
                                 action=resolved,
                                 data=_tool_data)

        if resolved in ("task_create", "task_complete", "task_list"):
            _task_session = os.environ.get("DZECK_SESSION_ID", "")
            if _task_session:
                yield make_event("task_update",
                                 session_id=_task_session,
                                 action=resolved,
                                 data=_tool_data)

        yield make_event(
            "tool",
            status=result_status.value,
            tool_name=toolkit_name,
            function_name=resolved,
            function_args=fn_args,
            tool_call_id=tool_call_id,
            function_result=fn_result,
            tool_content=tool_content,
        )

        result_summary = tool_result.message or "No result"
        if len(result_summary) > 4000:
            result_summary = result_summary[:4000] + "...[truncated]"

        yield {"type": "__result__", "value": result_summary}

    async def execute_step_async(
        self,
        plan: Plan,
        step: Step,
        user_message: str,
        user_reply: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        self.state = FlowState.EXECUTING
        step.status = ExecutionStatus.RUNNING
        yield make_event("step", status=StepStatus.RUNNING.value, step=step.to_dict())

        _agent_type = str(step.agent_type or "general").lower()
        _agent_sys_prompt_base, _agent_allowed_tools = _get_agent_context(_agent_type)
        _agent_tool_schemas = _filter_tool_schemas(_agent_allowed_tools)
        _agent_display = _AGENT_DISPLAY_NAMES.get(_agent_type, "Execution Agent")

        _sandbox_home = "/home/user"
        if bool(os.environ.get("E2B_API_KEY", "")):
            try:
                from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR
                _sandbox_home = _detected_home or WORKSPACE_DIR
            except Exception:
                pass
        _sandbox_home_injection = (
            f"\n\n[SANDBOX_CONTEXT] "
            f"Home directory = {_sandbox_home} | "
            f"Output dir = {_sandbox_home}/output | "
            f"Always use '{_sandbox_home}' or ~ for all paths. "
            f"Never hardcode any absolute home path — always use {_sandbox_home} or ~ in commands."
        )
        _agent_sys_prompt = _agent_sys_prompt_base + _sandbox_home_injection

        if _agent_type not in ("general",):
            yield make_event("notify", text="[{}] menangani langkah ini...".format(_agent_display))

        context_parts: List[str] = []
        for s in plan.steps:
            if s.is_done() and s.result:
                context_parts.append("- {}: {}".format(s.description, s.result))
        if user_reply:
            context_parts.append("- User replied to agent question: {}".format(user_reply))
        context = "\n".join(context_parts) if context_parts else "No previous context."

        prompt = EXECUTION_PROMPT.format(
            step=step.description,
            message=user_message,
            language=plan.language or "en",
            context=context,
            attachments_info="",
        )

        _TEXT_TOOL_INSTRUCTION = """
IMPORTANT: This model uses TEXT-BASED tool calling. You do NOT have native function calling.
To call a tool, respond with ONLY a JSON object in this format:
{"tool": "tool_name", "args": {"param": "value"}}

To signal step completion, respond with:
{"done": true, "success": true, "result": "summary of what was done"}

Available tools:
- file_read: Read a file. Args: {"file": "/path/to/file"}
- file_write: Write/create a file. Args: {"file": "/path/to/file", "content": "..."}
- file_str_replace: Replace string in file. Args: {"file": "/path/to/file", "old_str": "old", "new_str": "new"}
- file_find_by_name: Find files by glob. Args: {"path": "/dir", "glob": "*.py"}
- file_find_in_content: Search in files. Args: {"path": "/dir", "pattern": "search_regex", "glob": "**/*"}
- image_view: View an image. Args: {"image": "/path/to/image"}
- shell_exec: Run shell command. Args: {"id": "sess1", "exec_dir": "", "command": "ls -la"}
- shell_view: View shell session output. Args: {"id": "sess1"}
- shell_wait: Wait then view session. Args: {"id": "sess1", "seconds": 5}
- shell_write_to_process: Send input to process. Args: {"id": "sess1", "input": "text", "press_enter": true}
- shell_kill_process: Kill shell session. Args: {"id": "sess1"}
- info_search_web: Search the web. Args: {"query": "search query"}
- web_search: Search the web (alias for info_search_web). Args: {"query": "search query"}
- web_browse: Open/browse a URL. Args: {"url": "https://..."}
- browser_navigate: Navigate browser to URL. Args: {"url": "https://..."}
- browser_view: View current page content. Args: {}
- browser_click: Click element on page. Args: {"index": 5} or {"coordinate_x": 100, "coordinate_y": 200}
- browser_input: Type text into element. Args: {"index": 5, "text": "hello", "press_enter": false} or {"coordinate_x": 100, "coordinate_y": 200, "text": "hello"}
- browser_move_mouse: Move mouse. Args: {"coordinate_x": 100, "coordinate_y": 200}
- browser_press_key: Press keyboard key. Args: {"key": "Enter"}
- browser_select_option: Select dropdown option. Args: {"index": 0, "option": 1}
- browser_scroll_up: Scroll page up. Args: {} or {"to_top": true}
- browser_scroll_down: Scroll page down. Args: {} or {"to_bottom": true}
- browser_console_exec: Execute JS in browser console. Args: {"javascript": "document.title"}
- browser_console_view: View browser console logs. Args: {}
- browser_save_image: Save screenshot of browser. Args: {"path": "/path/to/save.png"}
- browser_restart: Restart browser and navigate to URL. Args: {"url": "https://..."}
- message_notify_user: Send a message to user. Args: {"text": "message"}
- message_ask_user: Ask user a question and wait for reply. Args: {"text": "question"}
- todo_write: Create todo checklist. Args: {"items": ["step 1", "step 2"], "title": "Task"}
- todo_update: Update todo item. Args: {"item_text": "step 1", "completed": true}
- todo_read: Read current todo list. Args: {}
- task_create: Create sub-task. Args: {"description": "task desc", "task_type": "general"}
- task_complete: Complete sub-task. Args: {"task_id": "task_xxx", "result": "summary"}
- task_list: List all sub-tasks. Args: {}
- mcp_list_tools: List available MCP tools. Args: {}
- mcp_call_tool: Call an MCP tool. Args: {"tool_name": "name", "arguments": {}}
- idle: Mark step done. Args: {"success": true, "result": "summary"}

ONLY respond with JSON. No explanations, no markdown, ONLY the JSON object.
"""

        def _build_system_content() -> str:
            from server.agent.domain.cohere import _TOOLS_SUPPORTED as _ts
            return _agent_sys_prompt + (_TEXT_TOOL_INSTRUCTION if _ts is False else "")

        exec_messages: List[Dict[str, Any]] = [
            {"role": "system", "content": _build_system_content()},
            {"role": "user", "content": prompt},
        ]

        loop = asyncio.get_running_loop()
        from server.agent.domain.cohere import _TOOLS_SUPPORTED as _ts_init
        _prev_tools_supported = _ts_init

        async def _wait_if_paused():
            if not self.session_id:
                return
            _emitted = False
            _waited = 0
            while _is_session_paused(self.session_id):
                # Also exit immediately if a stop signal was received while paused
                if _is_session_stopped(self.session_id):
                    return
                if not _emitted:
                    _emitted = True
                    yield make_event("notify", content="[Takeover] Agent dijeda. Menunggu kontrol dikembalikan...")
                await asyncio.sleep(1)
                _waited += 1
                if _waited > 3600:
                    break

        for iteration in range(self.max_tool_iterations):
            try:
                if self.session_id and _is_session_stopped(self.session_id):
                    yield make_event("notify", content="Agent dihentikan oleh pengguna.")
                    self.state = FlowState.COMPLETED
                    break

                async for _pev in _wait_if_paused():
                    yield _pev

                # Re-check stop signal immediately after pause exits (stop during pause)
                if self.session_id and _is_session_stopped(self.session_id):
                    yield make_event("notify", content="Agent dihentikan oleh pengguna.")
                    self.state = FlowState.COMPLETED
                    break

                if iteration % 3 == 0 and bool(os.environ.get("E2B_API_KEY", "")):
                    try:
                        from server.agent.tools.e2b_sandbox import keepalive as _e2b_keepalive
                        _e2b_keepalive()
                    except Exception:
                        pass

                from server.agent.domain.cohere import _TOOLS_SUPPORTED as _ts_cur
                if _ts_cur != _prev_tools_supported:
                    _prev_tools_supported = _ts_cur
                    exec_messages[0] = {"role": "system", "content": _build_system_content()}

                _msgs = list(exec_messages)
                _send_tools = _filter_tools_for_agent(_agent_tool_schemas, _agent_type)
                _msgs = _enforce_payload_limit(_msgs, _send_tools)
                api_result = await loop.run_in_executor(
                    None,
                    lambda: call_api_with_retry(_msgs, tools=_send_tools),
                )
                text, tool_calls = _extract_cerebras_response(api_result)

                from server.agent.domain.cohere import _TOOLS_SUPPORTED as _ts_after
                if _ts_after != _prev_tools_supported:
                    _prev_tools_supported = _ts_after
                    exec_messages[0] = {"role": "system", "content": _build_system_content()}

                if tool_calls:
                    step_done = False
                    for tc_idx, tc in enumerate(tool_calls):
                        async for _pev2 in _wait_if_paused():
                            yield _pev2

                        # Stop signal check after per-tool-call pause
                        if self.session_id and _is_session_stopped(self.session_id):
                            yield make_event("notify", content="Agent dihentikan oleh pengguna.")
                            self.state = FlowState.COMPLETED
                            step_done = True
                            break

                        fn_name = tc.get("name", "")
                        fn_args = tc.get("arguments", {})
                        if isinstance(fn_args, str):
                            try:
                                fn_args = json.loads(fn_args)
                            except Exception:
                                fn_args = {}

                        tc_id = "tc_{}_{}_{}".format(step.id, iteration, tc_idx)
                        result_str = "Done"

                        async for ev in self._run_tool_streaming(fn_name, fn_args, tc_id, step):
                            if ev.get("type") == "__step_done__":
                                step_done = True
                                break
                            elif ev.get("type") == "__result__":
                                result_str = ev.get("value", "Done")
                            else:
                                yield ev

                        if step_done:
                            break

                        exec_messages.append({
                            "role": "user",
                            "content": (
                                "Result of {}: {}\n\n"
                                "Continue. Call idle when step is fully done."
                            ).format(fn_name, result_str),
                        })

                    if step_done:
                        return
                    if iteration > 0 and iteration % 5 == 0:
                        self.memory.compact()
                    if len(exec_messages) > 6:
                        exec_messages = _compact_exec_messages(exec_messages)
                    continue

                if text:
                    parsed = self._parse_response(text)

                    if parsed.get("done"):
                        step.status = ExecutionStatus.COMPLETED
                        step.success = _coerce_bool(parsed.get("success"), default=True)
                        step.result = parsed.get("result", "Step completed")
                        if not step.success:
                            step.status = ExecutionStatus.FAILED

                        if step.success and step.result:
                            _result_lower = step.result.lower()
                            _error_markers = ["traceback", "error:", "failed", "exception:", "syntaxerror", "indentationerror"]
                            if any(marker in _result_lower for marker in _error_markers):
                                step.success = False
                                step.status = ExecutionStatus.FAILED
                                step.result += " [AUTO-REJECTED: Output contains unresolved error indicators]"

                        status_enum = StepStatus.COMPLETED if step.success else StepStatus.FAILED
                        yield make_event("step", status=status_enum.value, step=step.to_dict())
                        return

                    if parsed.get("thinking"):
                        exec_messages.append({"role": "assistant", "content": text})
                        exec_messages.append({"role": "user", "content": "Good. Now execute using a tool."})
                        continue

                    if parsed.get("tool"):
                        tool_name = parsed["tool"]
                        tool_args = parsed.get("args", {})
                        resolved_name = resolve_tool_name(tool_name)

                        if resolved_name is None:
                            exec_messages.append({"role": "assistant", "content": text})
                            exec_messages.append({
                                "role": "user",
                                "content": "Unknown tool '{}'. Available: {}. Try again.".format(
                                    tool_name, ", ".join(TOOLS.keys()))
                            })
                            continue

                        tc_id = "tc_{}_{}_json".format(step.id, iteration)
                        result_str = "Done"
                        step_done = False

                        async for ev in self._run_tool_streaming(resolved_name, tool_args, tc_id, step):
                            if ev.get("type") == "__step_done__":
                                step_done = True
                                break
                            elif ev.get("type") == "__result__":
                                result_str = ev.get("value", "Done")
                            else:
                                yield ev

                        if step_done:
                            return

                        exec_messages.append({
                            "role": "user",
                            "content": "Result of {}: {}\n\nContinue. Use another tool or call idle when step is fully done.".format(resolved_name, result_str)
                        })
                        if iteration > 0 and iteration % 5 == 0:
                            self.memory.compact()
                        if len(exec_messages) > 6:
                            exec_messages = _compact_exec_messages(exec_messages)
                        continue

                    # Try XML-format tool calls: <invoke name="tool">...</invoke>
                    if text and "<invoke" in text:
                        xml_tool_calls = _ToolCallParser.extract_tool_calls(text)
                        if xml_tool_calls:
                            step_done = False
                            for xml_tc_idx, xml_tc in enumerate(xml_tool_calls):
                                resolved_xml = resolve_tool_name(xml_tc.name)
                                if resolved_xml is None:
                                    exec_messages.append({"role": "assistant", "content": text})
                                    exec_messages.append({
                                        "role": "user",
                                        "content": "Unknown tool '{}'. Available: {}. Try again.".format(
                                            xml_tc.name, ", ".join(TOOLS.keys()))
                                    })
                                    continue
                                tc_id_xml = "tc_{}_{}_xml_{}".format(step.id, iteration, xml_tc_idx)
                                result_str_xml = "Done"
                                async for ev in self._run_tool_streaming(resolved_xml, xml_tc.parameters, tc_id_xml, step):
                                    if ev.get("type") == "__step_done__":
                                        step_done = True
                                        break
                                    elif ev.get("type") == "__result__":
                                        result_str_xml = ev.get("value", "Done")
                                    else:
                                        yield ev
                                if step_done:
                                    break
                                exec_messages.append({
                                    "role": "user",
                                    "content": "Result of {}: {}\n\nContinue. Use another tool or call idle when step is fully done.".format(
                                        resolved_xml, result_str_xml),
                                })
                            if step_done:
                                return
                            if iteration > 0 and iteration % 5 == 0:
                                self.memory.compact()
                            if len(exec_messages) > 6:
                                exec_messages = _compact_exec_messages(exec_messages)
                            continue

                if text:
                    yield make_event("notify", message=text[:500])
                exec_messages.append({"role": "assistant", "content": text or "(empty response)"})
                exec_messages.append({
                    "role": "user",
                    "content": (
                        "You responded with plain text instead of a tool call. "
                        "You MUST respond with a JSON object to call a tool or signal completion. "
                        "Use {\"tool\": \"tool_name\", \"args\": {...}} to call a tool, "
                        "or {\"done\": true, \"success\": true, \"result\": \"summary\"} to finish. "
                        "Try again now."
                    ),
                })
                continue

            except Exception as e:
                yield make_event("error", error="Step execution error: {}".format(e))
                step.status = ExecutionStatus.FAILED
                step.error = str(e)
                yield make_event("step", status=StepStatus.FAILED.value, step=step.to_dict())
                return

        step.status = ExecutionStatus.FAILED
        step.result = "Step incomplete (max iterations reached)"
        yield make_event("step", status=StepStatus.FAILED.value, step=step.to_dict())

    async def update_plan_async(
        self,
        plan: Plan,
        completed_step: Step,
    ) -> Optional[Dict[str, Any]]:
        self.state = FlowState.UPDATING
        completed_steps_info = []
        for s in plan.steps:
            if s.is_done():
                status = "Success" if s.success else "Failed"
                completed_steps_info.append(
                    "Step {} ({}): {} - {}".format(s.id, s.description, status, s.result or ""))

        current_step_info = "Step {}: {}".format(completed_step.id, completed_step.description)
        step_result_info = completed_step.result or "No result"
        remaining = [s for s in plan.steps if not s.is_done()]
        plan_info = json.dumps({
            "language": plan.language,
            "completed_steps": [s.to_dict() for s in plan.steps if s.is_done()],
            "remaining_steps": [s.to_dict() for s in remaining],
        }, default=str)

        json_instruction = "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation."
        prompt = UPDATE_PLAN_PROMPT.format(
            current_plan=plan_info,
            completed_steps="\n".join(completed_steps_info),
            current_step=current_step_info,
            step_result=step_result_info,
        )
        from server.agent.tools.e2b_sandbox import _detected_home as _upd_home, WORKSPACE_DIR as _upd_wsdir
        _upd_sandbox_home = _upd_home or _upd_wsdir
        _upd_sandbox_ctx = (
            f"\n\n[SANDBOX_CONTEXT] Home directory = {_upd_sandbox_home} | "
            f"Gunakan '{_upd_sandbox_home}' atau ~ untuk semua path."
        )
        messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT + json_instruction + _upd_sandbox_ctx},
            {"role": "user", "content": prompt},
        ]

        loop = asyncio.get_running_loop()
        try:
            response_text = await loop.run_in_executor(
                None, lambda: call_text_with_retry(messages)
            )
            parsed = self._parse_response(response_text)
            if parsed and "steps" in parsed:
                new_steps = [
                    Step(
                        id=str(s.get("id", "")),
                        description=s.get("description", ""),
                        agent_type=s.get("agent_type", "general"),
                    )
                    for s in parsed["steps"]
                ]
                first_pending = None
                for i, s in enumerate(plan.steps):
                    if not s.is_done():
                        first_pending = i
                        break
                if first_pending is not None and new_steps:
                    seen_ids = {s.id for s in plan.steps[:first_pending]}
                    for idx, ns in enumerate(new_steps):
                        while ns.id in seen_ids or not ns.id:
                            ns.id = "step_{}_{}".format(first_pending + idx + 1, int(time.time()) % 10000)
                        seen_ids.add(ns.id)
                    plan.steps = plan.steps[:first_pending] + new_steps
                return make_event("plan", status=PlanStatus.UPDATED.value, plan=safe_plan_dict(plan))
        except Exception as e:
            sys.stderr.write("Plan update error: {}\n".format(e))
        return None

    async def summarize_async(
        self,
        plan: Plan,
        user_message: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        self.state = FlowState.SUMMARIZING
        step_results = []
        for s in plan.steps:
            status = "Success" if s.success else "Failed"
            step_results.append("- Step {} ({}): {} - {}".format(
                s.id, s.description, status, s.result or "No result"))

        output_files_info = "(tidak ada file output)"
        try:
            from server.agent.tools.e2b_sandbox import (
                list_output_files as _list_output,
                list_workspace_files as _list_workspace,
                ensure_zip_output,
                get_sandbox as _get_sb,
                OUTPUT_DIR as _OUTPUT_DIR,
                WORKSPACE_DIR as _WS_DIR,
                _MIME_MAP_E2B,
            )

            try:
                ensure_zip_output()
            except Exception:
                pass

            try:
                _sb = _get_sb()
                _sandbox_id = _sb.sandbox_id if _sb else os.environ.get("DZECK_E2B_SANDBOX_ID", "")
            except Exception:
                _sandbox_id = os.environ.get("DZECK_E2B_SANDBOX_ID", "")

            output_files = _list_output()
            try:
                workspace_files_raw = _list_workspace()
            except Exception:
                workspace_files_raw = []

            _skip_prefixes = (
                f"{_WS_DIR}/skills/", f"{_WS_DIR}/.local", f"{_WS_DIR}/.cache",
                f"{_WS_DIR}/.npm", f"{_WS_DIR}/.config", f"{_WS_DIR}/.bashrc",
                f"{_WS_DIR}/.profile", f"{_WS_DIR}/upload/",
            )
            _skip_exact = {f"{_WS_DIR}/sandbox.txt"}
            workspace_files = []
            for wf in workspace_files_raw:
                if wf in _skip_exact:
                    continue
                if any(wf.startswith(p) for p in _skip_prefixes):
                    continue
                if wf.startswith(_OUTPUT_DIR):
                    continue
                workspace_files.append(wf)

            all_e2b_files = output_files + workspace_files

            if all_e2b_files:
                output_files_info = "\n".join(
                    f"- {os.path.basename(f)} ({f})" for f in all_e2b_files
                )
                synced_fnames = {f.get("filename", "") for f in self._created_files}
                for ef in all_e2b_files:
                    fname = os.path.basename(ef)
                    if not fname:
                        continue
                    if fname in synced_fnames:
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    mime = _MIME_MAP_E2B.get(ext, "application/octet-stream")
                    durl = _make_e2b_proxy_url(ef, fname, _sandbox_id)
                    self._created_files.append({
                        "filename": fname,
                        "sandbox_path": ef,
                        "sandbox_id": _sandbox_id,
                        "download_url": durl,
                        "mime": mime,
                    })
                    synced_fnames.add(fname)
        except Exception:
            pass

        prompt = SUMMARIZE_PROMPT.format(
            step_results="\n".join(step_results),
            message=user_message,
            output_files=output_files_info,
        )
        summarize_system = (
            "Kamu adalah Dzeck, asisten AI yang membantu. "
            "Tulis ringkasan yang jelas dan natural dalam teks biasa. "
            "JANGAN pernah keluarkan JSON atau code block. "
            "Gunakan bahasa yang sama dengan user (default Bahasa Indonesia). "
            "Langsung tulis teksnya saja tanpa format JSON apapun."
        )
        messages = [
            {"role": "system", "content": summarize_system},
            {"role": "user", "content": prompt},
        ]

        def _strip_json_wrapper(text: str) -> str:
            t = text.strip()
            if t.startswith("{") and t.endswith("}"):
                try:
                    obj = json.loads(t)
                    for key in ("message", "text", "response", "content", "summary", "result"):
                        if key in obj and isinstance(obj[key], str):
                            return obj[key]
                except Exception:
                    pass
            if t.startswith("```") and t.endswith("```"):
                inner = t[3:]
                if inner.startswith("json"):
                    inner = inner[4:]
                inner = inner.rstrip("`").strip()
                try:
                    obj = json.loads(inner)
                    for key in ("message", "text", "response", "content", "summary", "result"):
                        if key in obj and isinstance(obj[key], str):
                            return obj[key]
                except Exception:
                    pass
                return inner
            return text

        try:
            yield make_event("message_start", role="assistant")
            got_any = False
            accumulated = []
            async for chunk in call_cerebras_streaming_realtime(messages):
                if chunk:
                    got_any = True
                    accumulated.append(chunk)
                    yield make_event("message_chunk", chunk=chunk, role="assistant")
            if accumulated:
                full = "".join(accumulated)
                stripped = _strip_json_wrapper(full)
                if stripped != full:
                    yield make_event("message_correct", text=stripped, role="assistant")
            if not got_any:
                yield make_event("message_chunk", chunk="Task selesai.", role="assistant")
            yield make_event("message_end", role="assistant")
        except Exception:
            yield make_event("message_start", role="assistant")
            yield make_event("message_chunk", chunk="Task selesai.", role="assistant")
            yield make_event("message_end", role="assistant")

    async def respond_directly_async(
        self,
        user_message: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        sys_msg = {
            "role": "system",
            "content": (
                "Kamu adalah Dzeck, asisten AI yang membantu. Balas secara alami dan bermanfaat dalam Bahasa Indonesia. "
                "Gunakan bahasa yang sama dengan user jika user menggunakan bahasa lain. "
                "Jangan keluarkan JSON — balas dengan teks biasa saja."
            ),
        }
        messages: List[Dict[str, Any]] = [sys_msg]
        if chat_history:
            for h in chat_history[-10:]:
                role = h.get("role", "")
                content = h.get("content", "")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": str(content)[:2000]})
        messages.append({"role": "user", "content": user_message})
        try:
            yield make_event("message_start", role="assistant")
            got_any = False
            async for chunk in call_cerebras_streaming_realtime(messages):
                if chunk:
                    got_any = True
                    yield make_event("message_chunk", chunk=chunk, role="assistant")
            if not got_any:
                yield make_event("message_chunk", chunk="I'm sorry, I couldn't generate a response.", role="assistant")
            yield make_event("message_end", role="assistant")
        except Exception as e:
            yield make_event("error", error="Response error: {}".format(e))

    async def run_async(
        self,
        user_message: str,
        attachments: Optional[List[str]] = None,
        resume_from_session: Optional[str] = None,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        is_continuation: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        svc = await self._get_session_service()

        loaded_history: List[Dict[str, Any]] = []
        if self.session_id and svc:
            try:
                loaded_history = await svc.load_chat_history(self.session_id) or []
            except Exception:
                loaded_history = []

        if chat_history:
            self.chat_history = chat_history
        elif loaded_history:
            self.chat_history = loaded_history

        try:
            if resume_from_session and svc:
                session = await svc.resume_session(resume_from_session)
                if session and session.get("plan"):
                    self.plan = Plan.from_dict(session["plan"])
                    yield make_event("session", action="resumed", session_id=resume_from_session)

            waiting_state = None
            # Use preloaded waiting_state from resume_data (passed by agent_runner)
            # as the primary source — saves a DB round-trip on continuation.
            _preloaded = getattr(self, "_preloaded_waiting_state", None)
            if _preloaded is not None:
                waiting_state = _preloaded
            elif self.session_id and svc:
                waiting_state = await svc.load_waiting_state(self.session_id)

            # Create session record in MongoDB (best-effort; lifecycle tracking)
            # Pass user_id so ownership is guaranteed even if Python doc lands first.
            if not waiting_state and self.session_id and svc:
                _session_user_id = os.environ.get("DZECK_USER_ID", "") or ""
                await svc.create_session(user_message, session_id=self.session_id, user_id=_session_user_id or None)

            if is_continuation and waiting_state and self.session_id:
                # NOTE: clear_waiting_state is called AFTER we have successfully
                # restored plan/state — not before — so a crash during restoration
                # leaves the waiting state intact for the next retry.
                if waiting_state.get("clarification_mode"):
                    original_message = waiting_state.get("user_message", user_message)
                    user_message = "{}\n\nKlarifikasi dari user: {}".format(original_message, user_message)
                    is_continuation = False
                    # State successfully consumed — clear it now
                    if svc:
                        await svc.clear_waiting_state(self.session_id)
                else:
                    self.plan = Plan.from_dict(waiting_state["plan"])
                    original_user_message = waiting_state.get("user_message", user_message)

                    saved_step_id = self.plan.current_step_id
                    if saved_step_id:
                        for s in self.plan.steps:
                            if s.id == saved_step_id and s.status == ExecutionStatus.PENDING:
                                s.status = ExecutionStatus.RUNNING

                    # Plan restored successfully — safe to clear waiting state now.
                    # Any failure between here and the next save_waiting_state is a
                    # fresh agent error, not a lost-resume scenario.
                    if svc:
                        await svc.clear_waiting_state(self.session_id)

                    self.state = FlowState.EXECUTING
                    yield make_event("plan", status=PlanStatus.RUNNING.value, plan=safe_plan_dict(self.plan))

                    step_waiting = False
                    _step_consecutive_failures: Dict[str, int] = {}
                    _global_consecutive_failures = 0
                    _MAX_GLOBAL_FAILURES = 4
                    while True:
                        step = self.plan.get_next_step()
                        if not step:
                            break
                        self.plan.current_step_id = step.id
                        step_waiting = False
                        async for event in self.execute_step_async(self.plan, step, original_user_message, user_reply=user_message):
                            if event.get("type") == "waiting_for_user":
                                step_waiting = True
                            yield event
                        if step_waiting:
                            pending = [s.to_dict() for s in self.plan.steps if not s.is_done()]
                            if self.session_id and svc:
                                await svc.save_waiting_state(
                                    self.session_id, self.plan.to_dict(), pending,
                                    user_message=original_user_message,
                                    chat_history=self.chat_history,
                                )
                            yield make_event("done", success=True, session_id=self.session_id, waiting_for_user=True)
                            return

                        if not step_waiting and step.status == ExecutionStatus.FAILED:
                            _global_consecutive_failures += 1
                            fail_count = _step_consecutive_failures.get(step.id, 0) + 1
                            _step_consecutive_failures[step.id] = fail_count
                            if _global_consecutive_failures >= _MAX_GLOBAL_FAILURES:
                                break
                            elif fail_count < 2:
                                error_ctx = step.result or step.error or "Unknown failure"
                                retry_msg = (
                                    f"{original_user_message}\n\n"
                                    f"[RETRY] Previous attempt for this step FAILED with: {error_ctx}. "
                                    f"Take a DIFFERENT approach. Do NOT repeat the same command or strategy."
                                )
                                step.status = ExecutionStatus.PENDING
                                step.result = None
                                step.error = None
                                yield make_event("step", status="retrying", step=step.to_dict())
                                async for event in self.execute_step_async(self.plan, step, retry_msg):
                                    if event.get("type") == "waiting_for_user":
                                        step_waiting = True
                                    yield event
                        elif not step_waiting:
                            _global_consecutive_failures = 0
                            _step_consecutive_failures.pop(step.id, None)

                        if not step_waiting and self.session_id and svc:
                            try:
                                await svc.save_step_completed(self.session_id, step.to_dict())
                            except Exception as _db_err:
                                import logging as _dblog
                                _dblog.getLogger(__name__).warning(
                                    "[agent_flow] save_step_completed failed for %s: %s", self.session_id, _db_err
                                )

                    self.plan.status = ExecutionStatus.COMPLETED
                    yield make_event("plan", status=PlanStatus.COMPLETED.value, plan=safe_plan_dict(self.plan))
                    summary_text_c = ""
                    async for event in self.summarize_async(self.plan, original_user_message):
                        if event.get("type") == "message_chunk":
                            summary_text_c += event.get("chunk", "")
                        yield event
                    if summary_text_c:
                        self.chat_history.append({"role": "user", "content": original_user_message})
                        self.chat_history.append({"role": "assistant", "content": summary_text_c})
                        if self.session_id and svc:
                            try:
                                await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                            except Exception:
                                pass
                    if self.session_id and svc:
                        await svc.complete_session(self.session_id, success=True)
                    if self._created_files:
                        yield make_event(
                            "notify",
                            text="Berikut file yang dibuat oleh agent:",
                            attachments=self._created_files,
                        )
                        yield make_event("files", files=self._created_files)
                    yield make_event("done", success=True, session_id=self.session_id)
                    return

            if not is_continuation and not attachments and self._is_simple_query(user_message):
                assistant_reply: List[str] = []

                async def _collect_and_yield():
                    async for event in self.respond_directly_async(
                        user_message, chat_history=self.chat_history
                    ):
                        if event.get("type") == "message_chunk":
                            assistant_reply.append(event.get("chunk", ""))
                        yield event

                async for event in _collect_and_yield():
                    yield event

                reply_text = "".join(assistant_reply)
                if reply_text:
                    self.chat_history.append({"role": "user", "content": user_message})
                    self.chat_history.append({"role": "assistant", "content": reply_text})
                    if self.session_id and svc:
                        try:
                            await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                        except Exception:
                            pass

                yield make_event("done", success=True, session_id=self.session_id)
                return

            if not is_continuation:
                clarification_q = await self._pre_plan_clarification_check(
                    user_message, chat_history=self.chat_history
                )
                if clarification_q:
                    if self.session_id and svc:
                        await svc.save_waiting_state(
                            self.session_id,
                            {},
                            [],
                            user_message,
                            chat_history=self.chat_history,
                            clarification_mode=True,
                        )
                    yield make_event("message_start", role="ask")
                    yield make_event("message_chunk", chunk=clarification_q, role="ask")
                    yield make_event("message_end", role="ask")
                    yield make_event("waiting_for_user", text=clarification_q)
                    yield make_event("done", success=True, session_id=self.session_id)
                    return

            if self.plan is not None and resume_from_session and self.plan.steps:
                _pending_steps = [s for s in self.plan.steps if not s.is_done()]
                if _pending_steps:
                    self.state = FlowState.EXECUTING
                    yield make_event("plan", status=PlanStatus.RUNNING.value, plan=safe_plan_dict(self.plan))
                    step_waiting = False
                    _step_consecutive_failures = {}
                    _global_consecutive_failures = 0
                    _MAX_GLOBAL_FAILURES = 4
                    while True:
                        step = self.plan.get_next_step()
                        if not step:
                            break
                        self.plan.current_step_id = step.id
                        step_waiting = False
                        async for event in self.execute_step_async(self.plan, step, user_message):
                            if event.get("type") == "waiting_for_user":
                                step_waiting = True
                            yield event
                        if step_waiting:
                            pending = [s.to_dict() for s in self.plan.steps if not s.is_done()]
                            if self.session_id and svc:
                                await svc.save_waiting_state(
                                    self.session_id, self.plan.to_dict(), pending,
                                    user_message=user_message,
                                )
                            yield make_event("done", success=True, session_id=self.session_id, waiting_for_user=True)
                            return
                        if not step_waiting and self.session_id and svc:
                            try:
                                await svc.save_step_completed(self.session_id, step.to_dict())
                            except Exception as _db_err:
                                import logging as _dblog
                                _dblog.getLogger(__name__).warning(
                                    "[agent_flow] save_step_completed failed for %s: %s", self.session_id, _db_err
                                )

                    self.plan.status = ExecutionStatus.COMPLETED
                    yield make_event("plan", status=PlanStatus.COMPLETED.value, plan=safe_plan_dict(self.plan))
                    summary_text_r = ""
                    async for event in self.summarize_async(self.plan, user_message):
                        if event.get("type") == "message_chunk":
                            summary_text_r += event.get("chunk", "")
                        yield event
                    if summary_text_r:
                        self.chat_history.append({"role": "user", "content": user_message})
                        self.chat_history.append({"role": "assistant", "content": summary_text_r})
                        if self.session_id and svc:
                            try:
                                await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                            except Exception:
                                pass
                    if self.session_id and svc:
                        await svc.complete_session(self.session_id, success=True)
                    if self._created_files:
                        yield make_event(
                            "notify",
                            text="Berikut file yang dibuat oleh agent:",
                            attachments=self._created_files,
                        )
                        yield make_event("files", files=self._created_files)
                    yield make_event("done", success=True, session_id=self.session_id)
                    return

            self.state = FlowState.PLANNING
            yield make_event("plan", status=PlanStatus.CREATING.value)

            if bool(os.environ.get("E2B_API_KEY", "")):
                try:
                    def _eager_detect_home():
                        from server.agent.tools.e2b_sandbox import (
                            get_sandbox, _detected_home, _detect_sandbox_home, WORKSPACE_DIR
                        )
                        if _detected_home:
                            return
                        sb = get_sandbox()
                        if sb is not None and not _detected_home:
                            _detect_sandbox_home(sb)
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, _eager_detect_home)
                except Exception:
                    pass

            # Use orchestrator routing to determine the best agent_type for each step.
            # This runs a quick LLM call before planning so the planner can generate
            # steps with the correct agent_type already set.
            _routed_agent_type = "general"
            try:
                _routed_agent_type = await self._route_with_orchestrator_async(user_message)
            except Exception:
                _routed_agent_type = "general"

            self.plan = await self.run_planner_async(
                user_message, attachments, chat_history=self.chat_history
            )

            # Apply routed agent type to steps that still use "general" fallback.
            # Steps with an explicit non-general type from the planner are not overridden.
            if _routed_agent_type and _routed_agent_type != "general":
                for _step in self.plan.steps:
                    if not _step.agent_type or _step.agent_type == "general":
                        _step.agent_type = _routed_agent_type

            if self.session_id and svc:
                try:
                    await svc.save_plan_snapshot(self.session_id, self.plan.to_dict())
                except Exception as _db_err:
                    import logging as _dblog
                    _dblog.getLogger(__name__).warning(
                        "[agent_flow] save_plan_snapshot failed for %s: %s", self.session_id, _db_err
                    )

            yield make_event("title", title=self.plan.title)

            # Persist title to MongoDB so session list can display it
            if self.session_id and self.plan.title:
                try:
                    from server.agent.db.session_store import get_session_store as _gss_title
                    _title_store = await _gss_title()
                    if _title_store:
                        await _title_store.update_session(self.session_id, {"title": self.plan.title})
                except Exception:
                    pass

            if self.plan.message:
                yield make_event("message_start", role="assistant")
                yield make_event("message_chunk", chunk=self.plan.message, role="assistant")
                yield make_event("message_end", role="assistant")

            yield make_event("plan", status=PlanStatus.CREATED.value, plan=safe_plan_dict(self.plan))

            if not self.plan.steps:
                yield make_event("message_start", role="assistant")
                yield make_event("message_chunk", chunk="No actionable steps needed.", role="assistant")
                yield make_event("message_end", role="assistant")
                yield make_event("done", success=True, session_id=self.session_id)
                return

            yield make_event("plan", status=PlanStatus.RUNNING.value, plan=safe_plan_dict(self.plan))

            step_waiting = False
            _step_consecutive_failures: Dict[str, int] = {}
            _global_consecutive_failures = 0
            _MAX_GLOBAL_FAILURES = 4
            while True:
                step = self.plan.get_next_step()
                if not step:
                    break

                self.plan.current_step_id = step.id
                step_waiting = False
                async for event in self.execute_step_async(self.plan, step, user_message):
                    if event.get("type") == "waiting_for_user":
                        step_waiting = True
                    yield event

                if not step_waiting and step.status == ExecutionStatus.FAILED:
                    _global_consecutive_failures += 1
                    fail_count = _step_consecutive_failures.get(step.id, 0) + 1
                    _step_consecutive_failures[step.id] = fail_count
                    if _global_consecutive_failures >= _MAX_GLOBAL_FAILURES:
                        sys.stderr.write("[agent] Circuit breaker: {} consecutive failures, aborting plan\n".format(_global_consecutive_failures))
                        yield make_event("notify", text="Terlalu banyak kegagalan berturut-turut. Menghentikan eksekusi.")
                        break
                    elif fail_count < 2:
                        error_ctx = step.result or step.error or "Unknown failure"
                        retry_msg = (
                            f"{user_message}\n\n"
                            f"[RETRY] Previous attempt for this step FAILED with: {error_ctx}. "
                            f"Take a DIFFERENT approach. Do NOT repeat the same command or strategy."
                        )
                        step.status = ExecutionStatus.PENDING
                        step.result = None
                        step.error = None
                        yield make_event("step", status="retrying", step=step.to_dict())
                        async for event in self.execute_step_async(self.plan, step, retry_msg):
                            if event.get("type") == "waiting_for_user":
                                step_waiting = True
                            yield event
                    else:
                        _step_consecutive_failures.pop(step.id, None)
                elif not step_waiting:
                    _global_consecutive_failures = 0
                    _step_consecutive_failures.pop(step.id, None)

                if not step_waiting and self.session_id and svc:
                    try:
                        await svc.save_step_completed(self.session_id, step.to_dict())
                    except Exception as _db_err:
                        import logging as _dblog
                        _dblog.getLogger(__name__).warning(
                            "[agent_flow] save_step_completed failed for %s: %s", self.session_id, _db_err
                        )

                if step_waiting:
                    pending = [s.to_dict() for s in self.plan.steps if not s.is_done()]
                    if self.session_id and svc:
                        try:
                            await svc.save_waiting_state(
                                self.session_id,
                                self.plan.to_dict(),
                                pending,
                                user_message,
                                chat_history=self.chat_history,
                            )
                            await svc.save_plan_snapshot(self.session_id, self.plan.to_dict())
                        except Exception as _db_err2:
                            import logging as _dblog2
                            _dblog2.getLogger(__name__).warning(
                                "[agent_flow] save_waiting_state/snapshot failed for %s: %s",
                                self.session_id, _db_err2
                            )
                    else:
                        import logging as _svclog2
                        _svclog2.getLogger(__name__).warning(
                            "[agent_flow] No session service — waiting state for session %s not saved "
                            "(DB-only mode, resume unavailable for this pause)", self.session_id
                        )
                    yield make_event("done", success=True, session_id=self.session_id, waiting_for_user=True)
                    return

                if step.status == ExecutionStatus.COMPLETED:
                    yield make_event("notify", text=f"✓ {step.description}")
                    # Persist step completion as a cross-session memory fact (best-effort)
                    if self.session_id and step.result:
                        try:
                            _uid = os.environ.get("DZECK_USER_ID", "") or "auto-user"
                            await _memory_service.save_memory(
                                content="Completed: {} — {}".format(
                                    step.description[:120],
                                    str(step.result)[:200],
                                ),
                                session_id=self.session_id,
                                user_id=_uid,
                                tags=["step_completed", step.agent_type or "general"],
                                importance=2,
                            )
                        except Exception:
                            pass

                next_step = self.plan.get_next_step()
                if next_step:
                    yield make_event("plan", status=PlanStatus.UPDATING.value,
                                     plan=safe_plan_dict(self.plan))
                    plan_event = await self.update_plan_async(self.plan, step)
                    if plan_event:
                        yield plan_event

            for s in self.plan.steps:
                if s.status == ExecutionStatus.RUNNING:
                    s.status = ExecutionStatus.FAILED
                    s.success = False
                    if not s.result:
                        s.result = "Step did not complete"
                    yield make_event("step", status=StepStatus.FAILED.value, step=s.to_dict())

            self.plan.status = ExecutionStatus.COMPLETED
            yield make_event("plan", status=PlanStatus.COMPLETED.value,
                             plan=safe_plan_dict(self.plan))

            summary_chunks: List[str] = []

            async def _summarize_and_collect():
                async for event in self.summarize_async(self.plan, user_message):
                    if event.get("type") == "message_chunk":
                        summary_chunks.append(event.get("chunk", ""))
                    yield event

            async for event in _summarize_and_collect():
                yield event

            self.state = FlowState.COMPLETED

            summary_text = "".join(summary_chunks)
            if summary_text:
                self.chat_history.append({"role": "user", "content": user_message})
                self.chat_history.append({"role": "assistant", "content": summary_text})
                if self.session_id and svc:
                    try:
                        await svc.save_chat_history(self.session_id, self.chat_history[-40:])
                    except Exception:
                        pass

            if self.session_id and svc:
                await svc.complete_session(self.session_id, success=True)

            # Extract and save any learnable insights from this session (best-effort)
            if self.session_id and self.chat_history:
                try:
                    _uid = os.environ.get("DZECK_USER_ID", "") or "auto-user"
                    await _memory_service.extract_and_save_insights(
                        self.chat_history, self.session_id, user_id=_uid
                    )
                except Exception:
                    pass

            if self._created_files:
                # Emit both notify (for file cards in chat) and files (for legacy consumers)
                yield make_event(
                    "notify",
                    text="Berikut file yang dibuat oleh agent:",
                    attachments=self._created_files,
                )
                yield make_event("files", files=self._created_files)

            yield make_event("done", success=True, session_id=self.session_id)

        except Exception as e:
            self.state = FlowState.FAILED
            if self.session_id:
                try:
                    svc2 = await self._get_session_service()
                    if svc2:
                        await svc2.complete_session(self.session_id, success=False)
                except Exception:
                    pass
            yield make_event("error", error="Agent error: {}".format(e))
            traceback.print_exc(file=sys.stderr)
            if self._created_files:
                yield make_event(
                    "notify",
                    text="Berikut file yang dibuat sebelum terjadi kesalahan:",
                    attachments=self._created_files,
                )
                yield make_event("files", files=self._created_files)
            yield make_event("done", success=False, session_id=self.session_id)
