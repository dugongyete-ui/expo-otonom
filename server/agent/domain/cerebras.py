"""
Cerebras LLM API helpers for Dzeck AI Agent.

All network calls to api.cerebras.ai live here:
- _build_request_body / _make_cerebras_request
- call_cerebras_api / call_cerebras_streaming / call_cerebras_streaming_realtime
- call_text_with_retry / call_api_with_retry
- _extract_cerebras_response / _normalize_response_text
"""
import os
import sys
import json
import time
import asyncio
import urllib.request
import urllib.error
import concurrent.futures
from typing import Any, AsyncGenerator, Dict, List, Optional


CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions"

_NO_TOOL_CALL_MODELS = {"llama3.1-8b", "llama-3.1-8b-instruct"}


def _get_model_name() -> str:
    candidate = os.environ.get("CEREBRAS_AGENT_MODEL") or ""
    if candidate and "/" not in candidate:
        return candidate
    return "qwen-3-235b-a22b-instruct-2507"


_TOOLS_SUPPORTED: Optional[bool] = None


def _build_request_body(
    messages: list,
    stream: bool = True,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": _get_model_name(),
        "messages": messages,
        "stream": stream,
        "max_tokens": 8192,
        "temperature": 0.7,
        "top_p": 1,
    }
    if tools:
        converted = []
        for t in tools:
            if "type" in t:
                converted.append(t)
            else:
                converted.append({"type": "function", "function": t})
        body["tools"] = converted
    return body


def _make_cerebras_request(url: str, body: Dict[str, Any]) -> urllib.request.Request:
    api_key = os.environ.get("CEREBRAS_API_KEY", "")
    return urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer {}".format(api_key),
            "User-Agent": "DzeckAI/2.0",
        },
        method="POST",
    )


def _normalize_response_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def _extract_cerebras_response(api_result: Dict[str, Any]) -> tuple:
    text = ""
    tool_calls = None
    choices = api_result.get("choices", [])
    if choices:
        msg = choices[0].get("message", {})
        text = _normalize_response_text(msg.get("content", ""))
        oa_calls = msg.get("tool_calls")
        if oa_calls:
            tool_calls = []
            for tc in oa_calls:
                fn = tc.get("function", {})
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except Exception:
                    args = {}
                tool_calls.append({"name": fn.get("name", ""), "arguments": args})
    return text, tool_calls


def call_cerebras_api(
    messages: list,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    body = _build_request_body(messages, stream=False, tools=tools)
    req = _make_cerebras_request(CEREBRAS_API_URL, body)
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def call_cerebras_streaming(messages: list) -> str:
    last_error: Optional[Exception] = None
    full_text = ""
    for attempt in range(4):
        body = _build_request_body(messages, stream=True)
        req = _make_cerebras_request(CEREBRAS_API_URL, body)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                buf = ""
                for raw_line in resp:
                    buf += raw_line.decode("utf-8", errors="replace")
                    while "\n" in buf:
                        chunk_line, buf = buf.split("\n", 1)
                        chunk_line = chunk_line.strip()
                        if not chunk_line or not chunk_line.startswith("data: "):
                            continue
                        payload = chunk_line[6:]
                        if payload == "[DONE]":
                            break
                        try:
                            parsed = json.loads(payload)
                            content = parsed.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                            if isinstance(content, str):
                                full_text += content
                        except (json.JSONDecodeError, IndexError, KeyError):
                            pass
            return full_text
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429 or e.code >= 500:
                wait = 2 ** attempt
                sys.stderr.write(
                    "[agent] Cerebras streaming error (attempt {}): {} — retrying in {}s\n".format(attempt + 1, e, wait)
                )
                sys.stderr.flush()
                time.sleep(wait)
            else:
                sys.stderr.write("[agent] Cerebras streaming error: {}\n".format(e))
                sys.stderr.flush()
                break
        except Exception as e:
            last_error = e
            sys.stderr.write("[agent] Cerebras streaming error: {}\n".format(e))
            sys.stderr.flush()
            break
    return full_text


async def call_cerebras_streaming_realtime(
    messages: list,
) -> AsyncGenerator[str, None]:
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def _stream_worker() -> None:
        for attempt in range(4):
            body = _build_request_body(messages, stream=True)
            req = _make_cerebras_request(CEREBRAS_API_URL, body)
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    buf = ""
                    for raw_line in resp:
                        buf += raw_line.decode("utf-8", errors="replace")
                        while "\n" in buf:
                            chunk_line, buf = buf.split("\n", 1)
                            chunk_line = chunk_line.strip()
                            if not chunk_line or not chunk_line.startswith("data: "):
                                continue
                            payload = chunk_line[6:]
                            if payload == "[DONE]":
                                loop.call_soon_threadsafe(queue.put_nowait, None)
                                return
                            try:
                                parsed = json.loads(payload)
                                content = parsed.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                                if content and isinstance(content, str):
                                    loop.call_soon_threadsafe(queue.put_nowait, content)
                            except (json.JSONDecodeError, IndexError, KeyError):
                                pass
                return
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    wait = 2 ** attempt
                    sys.stderr.write(
                        "[agent] Cerebras realtime streaming error (attempt {}): {} — retrying in {}s\n".format(
                            attempt + 1, e, wait
                        )
                    )
                    sys.stderr.flush()
                    time.sleep(wait)
                else:
                    sys.stderr.write("[agent] Cerebras realtime streaming error: {}\n".format(e))
                    sys.stderr.flush()
                    break
            except Exception as e:
                sys.stderr.write("[agent] Cerebras realtime streaming error: {}\n".format(e))
                sys.stderr.flush()
                break
        loop.call_soon_threadsafe(queue.put_nowait, None)

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = loop.run_in_executor(executor, _stream_worker)
    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk
    finally:
        try:
            await future
        except Exception:
            pass
        executor.shutdown(wait=False)


def call_cerebras_text(messages: list) -> str:
    result = call_cerebras_api(messages)
    choices = result.get("choices", [])
    if choices:
        content = choices[0].get("message", {}).get("content", "")
        return _normalize_response_text(content)
    return ""


def call_text_with_retry(messages: list, max_retries: int = 7) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            return call_cerebras_text(messages)
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429:
                wait_time = min(5 * (2 ** attempt), 60)
                sys.stderr.write(
                    f"[agent] Rate limited (429), retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})\n"
                )
                sys.stderr.flush()
                time.sleep(wait_time)
            elif e.code >= 500:
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("LLM call failed after {} retries".format(max_retries))


def call_api_with_retry(
    messages: list,
    tools: Optional[List[Dict[str, Any]]] = None,
    max_retries: int = 7,
) -> Dict[str, Any]:
    last_error: Optional[Exception] = None

    # Determine per-request whether the current model supports tools.
    # We check at call time (not module load time) so that model changes
    # between requests are respected, and a 400 from one model does not
    # permanently disable tools for all subsequent requests.
    current_model = _get_model_name()
    model_supports_tools = current_model not in _NO_TOOL_CALL_MODELS
    effective_tools = tools if (model_supports_tools and tools) else None

    for attempt in range(max_retries):
        try:
            result = call_cerebras_api(messages, tools=effective_tools)
            return result
        except urllib.error.HTTPError as e:
            if e.code == 400 and effective_tools is not None:
                sys.stderr.write(
                    "[agent] Model doesn't support native tool schemas (400). Falling back to text-based tool calling.\n"
                )
                sys.stderr.flush()
                effective_tools = None
                try:
                    return call_cerebras_api(messages, tools=None)
                except Exception as e2:
                    last_error = e2
                    continue
            last_error = e
            if e.code == 429:
                wait_time = min(5 * (2 ** attempt), 60)
                sys.stderr.write(
                    f"[agent] Rate limited (429), retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})\n"
                )
                sys.stderr.flush()
                time.sleep(wait_time)
            elif e.code >= 500:
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("LLM call failed")
