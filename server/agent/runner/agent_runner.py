"""
Agent Runner for Dzeck AI Agent.

Public async entry point (`run_agent_async`) and the synchronous
subprocess stdio bridge (`main`) that the Node.js backend calls.
"""
import os
import sys
import json
import signal
import asyncio
from typing import Any, AsyncGenerator, Dict, List, Optional

from server.agent.models.plan import Plan
from server.agent.flows.plan_act import DzeckAgent
from server.agent.domain.events import make_event


async def run_agent_async(
    user_message: str,
    attachments: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    user_id: str = "auto-user",
    resume_from_session: Optional[str] = None,
    resume_data: Optional[Dict[str, Any]] = None,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    is_continuation: bool = False,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Public entry point for running the agent as an async generator.
    Used by both the CLI main() and the Node.js subprocess bridge.
    """
    agent = DzeckAgent(session_id=session_id)
    if resume_data:
        if resume_data.get("chat_history") and not chat_history:
            chat_history = resume_data["chat_history"]
        if resume_data.get("plan") and resume_from_session:
            try:
                agent.plan = Plan.from_dict(resume_data["plan"])
            except Exception:
                pass
        # Preload waiting_state from resume_data so plan_act can use it
        # directly without an extra DB round-trip (DB remains as fallback).
        if resume_data.get("waiting_state"):
            agent._preloaded_waiting_state = resume_data["waiting_state"]

    _memory_context = ""
    try:
        from server.agent.services.memory_service import (
            load_memories as _load_mem,
            format_memories_for_prompt as _fmt_mem,
        )
        _memories = await _load_mem(user_id=user_id, limit=10)
        if _memories:
            _memory_context = _fmt_mem(_memories)
    except Exception as _load_mem_err:
        import logging as _lmlog
        _lmlog.getLogger(__name__).warning("[memory] Failed to load memories: %s", _load_mem_err)

    if _memory_context:
        _mem_msg = {"role": "system", "content": f"[Memory context from previous sessions]\n{_memory_context}"}
        if chat_history:
            chat_history = [_mem_msg] + list(chat_history)
        else:
            chat_history = [_mem_msg]

    all_events: list = []
    async for event in agent.run_async(
        user_message,
        attachments=attachments,
        resume_from_session=resume_from_session,
        chat_history=chat_history,
        is_continuation=is_continuation,
    ):
        all_events.append(event)
        yield event

    if session_id:
        try:
            from server.agent.services.memory_service import extract_and_save_insights as _save_mem
            _assistant_msgs: list = []
            _chunk_buf: list = []
            for ev in all_events:
                etype = ev.get("type", "")
                if etype == "message_start":
                    _chunk_buf = []
                elif etype == "message_chunk":
                    chunk = ev.get("chunk", "")
                    if chunk:
                        _chunk_buf.append(chunk)
                elif etype in ("message_end", "message_correct"):
                    if etype == "message_correct" and ev.get("text"):
                        _assistant_msgs.append({"role": "assistant", "content": ev["text"]})
                    elif _chunk_buf:
                        _assistant_msgs.append({"role": "assistant", "content": "".join(_chunk_buf)})
                    _chunk_buf = []
            if not _assistant_msgs and hasattr(agent, "chat_history"):
                for msg in agent.chat_history:
                    if msg.get("role") == "assistant" and msg.get("content"):
                        _assistant_msgs.append({"role": "assistant", "content": msg["content"]})

            _messages = [{"role": "user", "content": user_message}] + _assistant_msgs
            if len(_messages) > 1:
                await _save_mem(session_id=session_id, messages=_messages, user_id=user_id)
        except Exception as _mem_err:
            import logging as _mlog
            _mlog.getLogger(__name__).warning("[memory] Failed to save cross-session memory: %s", _mem_err)


def _emit(event: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, default=str) + "\n")
    sys.stdout.flush()


async def _update_session_status(session_id: str, status: str, error: Optional[str] = None) -> None:
    """Update session status in MongoDB (best-effort — never raises)."""
    if not session_id:
        return
    try:
        from server.agent.db.session_store import get_session_store
        store = await get_session_store()
        updates: Dict[str, Any] = {"status": status}
        if error:
            updates["error"] = error
        await store.update_session(session_id, updates)
    except Exception as _sse:
        sys.stderr.write("[agent_runner] session status update failed: {}\n".format(_sse))
        sys.stderr.flush()


async def _cleanup_e2b_sandbox() -> None:
    """Kill E2B sandbox when agent exits — only if this process created it.

    Only runs when DZECK_AGENT_OWNS_SANDBOX=1 is set in the environment.
    This prevents killing sandboxes that belong to active takeover sessions or
    were created externally.
    """
    if os.environ.get("DZECK_AGENT_OWNS_SANDBOX", "") != "1":
        return
    sandbox_id = os.environ.get("DZECK_E2B_SANDBOX_ID", "")
    if not sandbox_id:
        return
    try:
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is not None:
            try:
                await asyncio.get_running_loop().run_in_executor(None, sb.kill)
                sys.stderr.write("[agent_runner] E2B sandbox killed: {}\n".format(sandbox_id))
            except Exception as _ke:
                sys.stderr.write("[agent_runner] E2B sandbox kill warning: {}\n".format(_ke))
    except Exception as _ce:
        sys.stderr.write("[agent_runner] E2B cleanup error: {}\n".format(_ce))
    sys.stderr.flush()


def main() -> None:
    """
    Synchronous entry point for Node.js subprocess bridge.
    Reads JSON from stdin, runs async agent, writes events to stdout.
    """
    # ── SIGTERM handler: emit done event and exit cleanly ─────────────────────
    _sigterm_received = [False]

    def _handle_sigterm(signum: int, frame: Any) -> None:
        if _sigterm_received[0]:
            return
        _sigterm_received[0] = True
        try:
            sys.stderr.write("[agent_runner] SIGTERM received — emitting done and exiting.\n")
            sys.stderr.flush()
            _emit({"type": "error", "error": "Agent process terminated by signal."})
            _emit({"type": "done", "success": False})
            sys.stdout.flush()
        except Exception:
            pass
        finally:
            # Run E2B cleanup synchronously in a new event loop if possible
            try:
                loop = asyncio.new_event_loop()
                loop.run_until_complete(_cleanup_e2b_sandbox())
                loop.close()
            except Exception:
                pass
            sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)

    # ── Preflight: validate required environment variables ────────────────────
    # Only G4F_API_KEY is strictly required for basic chat/agent function.
    # E2B_API_KEY and MONGODB_URI are optional (agent will run without them,
    # but sandbox tools and session persistence will be unavailable).
    _missing = []
    if not os.environ.get("G4F_API_KEY", ""):
        _missing.append("G4F_API_KEY")
    if _missing:
        _emit({
            "type": "error",
            "error": "Required environment variables are not set: {}. Configure them and restart the server.".format(", ".join(_missing)),
        })
        _emit({"type": "done", "success": False})
        return

    # Warn about optional but recommended env vars (non-fatal)
    _optional_missing = []
    if not os.environ.get("E2B_API_KEY", ""):
        _optional_missing.append("E2B_API_KEY")
    if not os.environ.get("MONGODB_URI", ""):
        _optional_missing.append("MONGODB_URI")
    if _optional_missing:
        sys.stderr.write("[agent_runner] Optional env vars not set (some features disabled): {}\n".format(", ".join(_optional_missing)))
        sys.stderr.flush()

    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)

        user_message = input_data.get("message", "")
        messages = input_data.get("messages", [])
        attachments = input_data.get("attachments", [])
        session_id = input_data.get("session_id")
        user_id = input_data.get("user_id", "auto-user")
        resume_from_session = input_data.get("resume_from_session")
        resume_data = input_data.get("resume_data")
        is_continuation = bool(input_data.get("is_continuation", False))

        if messages and not user_message:
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    user_message = msg.get("content", "")
                    break

        if not user_message:
            _emit({"type": "error", "error": "No user message provided"})
            _emit({"type": "done", "success": False})
            return

        chat_history: List[Dict[str, Any]] = []
        if messages:
            for m in messages:
                role = m.get("role", "")
                content = m.get("content", "")
                if role in ("user", "assistant") and content:
                    chat_history.append({"role": role, "content": content})
            if chat_history and chat_history[-1].get("role") == "user":
                last_content = chat_history[-1].get("content", "")
                if last_content.strip() == user_message.strip():
                    chat_history = chat_history[:-1]

        async def _run():
            # Initialize MongoDB schema indexes (best-effort, non-blocking)
            if session_id:
                try:
                    from server.agent.db.schema import initialize_schema
                    await initialize_schema()
                except Exception as _schema_err:
                    sys.stderr.write("[agent_runner] Schema init warning: {}\n".format(_schema_err))
                    sys.stderr.flush()

            # E2B sandbox keepalive: extend sandbox timeout every 30 minutes so
            # long-running tasks don't lose their sandbox mid-execution.
            _keepalive_task: Optional[asyncio.Task] = None
            if os.environ.get("E2B_API_KEY", ""):
                _keepalive_interval = int(os.environ.get("E2B_KEEPALIVE_SECONDS", str(30 * 60)))
                async def _e2b_keepalive_loop() -> None:
                    try:
                        while True:
                            await asyncio.sleep(_keepalive_interval)
                            try:
                                from server.agent.tools.e2b_sandbox import keepalive as _ka
                                _loop = asyncio.get_running_loop()
                                # Run the blocking SDK call in a thread to avoid stalling the event loop
                                result = await _loop.run_in_executor(None, _ka)
                                sys.stderr.write("[agent_runner] E2B keepalive sent, alive={}\n".format(result))
                                sys.stderr.flush()
                            except Exception as _kae:
                                sys.stderr.write("[agent_runner] E2B keepalive error: {}\n".format(_kae))
                                sys.stderr.flush()
                    except asyncio.CancelledError:
                        pass
                _keepalive_task = asyncio.create_task(_e2b_keepalive_loop())

            _stream_q = None
            if session_id:
                try:
                    from server.agent.db.redis_stream_queue import get_stream_queue as _get_sq
                    _stream_q = await _get_sq(session_id)
                except Exception as _sq_err:
                    import logging as _sqlog
                    _sqlog.getLogger(__name__).warning(
                        "[agent_runner] Redis stream queue unavailable (replay disabled): %s", _sq_err
                    )

            # Mark session as running
            if session_id:
                await _update_session_status(session_id, "running")

            _success = False
            _done_seen = False
            _error_msg: Optional[str] = None

            async def _log_phase_event(event: Dict[str, Any]) -> None:
                """Write phase-level events to session_events for observability."""
                if not session_id:
                    return
                ev_type = event.get("type", "")
                plan_status = event.get("status", "")
                # Log plan phase transitions
                if ev_type == "plan" and plan_status:
                    try:
                        from server.agent.db.session_store import get_session_store
                        store = await get_session_store()
                        await store.save_event(session_id, "phase_plan_{}".format(plan_status), {
                            "plan_status": plan_status,
                            "step_count": len(event.get("plan", {}).get("steps", [])) if event.get("plan") else 0,
                        })
                    except Exception:
                        pass
                # Log step start/end
                elif ev_type == "step":
                    step_status = event.get("step_status", "")
                    if step_status in ("running", "done", "failed"):
                        try:
                            from server.agent.db.session_store import get_session_store
                            store = await get_session_store()
                            await store.save_event(session_id, "phase_step_{}".format(step_status), {
                                "step_id": event.get("step_id"),
                                "step_title": event.get("step", {}).get("title") if event.get("step") else None,
                            })
                        except Exception:
                            pass

            try:
                async for event in run_agent_async(
                    user_message,
                    attachments=attachments or [],
                    session_id=session_id,
                    user_id=user_id,
                    resume_from_session=resume_from_session,
                    resume_data=resume_data,
                    chat_history=chat_history or None,
                    is_continuation=is_continuation,
                ):
                    line = json.dumps(event, default=str)
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()

                    if _stream_q is not None and _stream_q.is_connected:
                        try:
                            await _stream_q.xadd(event)
                        except Exception as _xadd_err:
                            import logging as _xlog
                            _xlog.getLogger(__name__).warning(
                                "[agent_runner] Redis XADD failed (event not durable): %s", _xadd_err
                            )

                    # Log phase events to MongoDB (best-effort, non-blocking)
                    await _log_phase_event(event)

                    if event.get("type") == "done":
                        _done_seen = True
                        _success = bool(event.get("success", True))
                # If the generator finished without emitting a "done" event, treat as success
                if not _done_seen:
                    _success = True
            except Exception as _run_err:
                import traceback
                _error_msg = "Agent error: {}".format(_run_err)
                sys.stderr.write("[agent_runner] Unhandled agent exception:\n")
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()
                _emit({"type": "error", "error": _error_msg})
                _success = False
            finally:
                # Cancel E2B keepalive task
                if _keepalive_task is not None and not _keepalive_task.done():
                    _keepalive_task.cancel()
                    try:
                        await _keepalive_task
                    except asyncio.CancelledError:
                        pass
                # Update session status in MongoDB
                if session_id:
                    if _success:
                        await _update_session_status(session_id, "completed")
                    else:
                        await _update_session_status(session_id, "failed", error=_error_msg)
                # Log phase completion event
                if session_id:
                    try:
                        from server.agent.db.session_store import get_session_store
                        store = await get_session_store()
                        await store.save_event(session_id, "agent_run_complete", {
                            "success": _success,
                            "error": _error_msg,
                        })
                    except Exception:
                        pass
                # Cleanup E2B sandbox if it was created by this agent run
                await _cleanup_e2b_sandbox()

        asyncio.run(_run())

    except json.JSONDecodeError as e:
        _emit({"type": "error", "error": "Invalid JSON input: {}".format(e)})
        _emit({"type": "done", "success": False})
    except Exception as e:
        import traceback
        _emit({"type": "error", "error": "Unexpected error: {}".format(e)})
        _emit({"type": "done", "success": False})
        traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
