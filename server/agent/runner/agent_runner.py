"""
Agent Runner for Dzeck AI Agent.

Public async entry point (`run_agent_async`) and the synchronous
subprocess stdio bridge (`main`) that the Node.js backend calls.
"""
import sys
import json
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
        _mem_msg = {"role": "assistant", "content": f"[Memory context from previous sessions]\n{_memory_context}"}
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


def main() -> None:
    """
    Synchronous entry point for Node.js subprocess bridge.
    Reads JSON from stdin, runs async agent, writes events to stdout.
    """
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
            event = json.dumps({"type": "error", "error": "No user message provided"})
            sys.stdout.write(event + "\n")
            sys.stdout.flush()
            event = json.dumps({"type": "done", "success": False})
            sys.stdout.write(event + "\n")
            sys.stdout.flush()
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

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures as _cf
                with _cf.ThreadPoolExecutor() as pool:
                    future = pool.submit(asyncio.run, _run())
                    future.result()
            else:
                loop.run_until_complete(_run())
        except RuntimeError:
            asyncio.run(_run())

    except json.JSONDecodeError as e:
        error_event = json.dumps({"type": "error", "error": "Invalid JSON input: {}".format(e)})
        sys.stdout.write(error_event + "\n")
        sys.stdout.flush()
        done_event = json.dumps({"type": "done", "success": False})
        sys.stdout.write(done_event + "\n")
        sys.stdout.flush()
    except Exception as e:
        import traceback
        error_event = json.dumps({"type": "error", "error": "Unexpected error: {}".format(e)})
        sys.stdout.write(error_event + "\n")
        sys.stdout.flush()
        done_event = json.dumps({"type": "done", "success": False})
        sys.stdout.write(done_event + "\n")
        sys.stdout.flush()
        traceback.print_exc(file=sys.stderr)
