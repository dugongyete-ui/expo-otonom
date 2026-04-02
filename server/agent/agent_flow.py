#!/usr/bin/env python3
"""
Dzeck AI Agent - Backward-compatible shim.

The implementation has been split into DDD subdirectories:
  server/agent/domain/cohere.py     — Cohere AI LLM helpers
  server/agent/domain/events.py     — SSE event builders + tool content formatters
  server/agent/flows/plan_act.py    — DzeckAgent (Plan-Act orchestrator)
  server/agent/runner/agent_runner.py — run_agent_async + subprocess main()

This file re-exports all public symbols so that existing imports continue to work:
  from server.agent.agent_flow import DzeckAgent, run_agent_async, main
"""

# Force unbuffered stdout for real-time streaming to Node.js subprocess
import sys
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

# ── Domain layer ──────────────────────────────────────────────────────────────
from server.agent.domain.cohere import (
    CEREBRAS_API_URL,
    _NO_TOOL_CALL_MODELS,
    _TOOLS_SUPPORTED,
    _get_model_name,
    _build_request_body,
    _make_cerebras_request,
    _normalize_response_text,
    _extract_cerebras_response,
    call_cerebras_api,
    call_cerebras_streaming,
    call_cerebras_streaming_realtime,
    call_cerebras_text,
    call_text_with_retry,
    call_api_with_retry,
)

from server.agent.domain.events import (
    _LANG_MAP,
    _infer_language,
    _make_e2b_proxy_url,
    make_event,
    build_tool_content,
)

# ── Flow layer ────────────────────────────────────────────────────────────────
from server.agent.flows.plan_act import (
    FlowState,
    DzeckAgent,
    _AGENT_CONTEXT_MAP,
    _AGENT_DISPLAY_NAMES,
    _get_agent_context,
    _filter_tool_schemas,
    _build_tool_schemas,
    _is_session_paused,
    _coerce_bool,
    _compact_exec_messages,
    safe_plan_dict,
)

# Also expose TOOL_SCHEMAS as a module-level constant (built lazily)
TOOL_SCHEMAS = _build_tool_schemas()

# ── Runner layer ──────────────────────────────────────────────────────────────
from server.agent.runner.agent_runner import (
    run_agent_async,
    main,
)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    main()
