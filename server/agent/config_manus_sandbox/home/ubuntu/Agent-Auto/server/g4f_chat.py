#!/usr/bin/env python3
"""
Cerebras AI Chat Handler for Dzeck AI.
Reads JSON from stdin, streams response as JSON lines to stdout.
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error


def _load_dotenv() -> None:
    """Load .env file into os.environ (for local/APK builds)."""
    env_path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


_load_dotenv()


CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions"
CEREBRAS_MODEL = os.environ.get("CEREBRAS_CHAT_MODEL", "qwen-3-235b-a22b-instruct-2507")
CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")


def call_api(messages: list) -> dict:
    """Call Cerebras AI and return full response dict."""
    url = CEREBRAS_API_URL
    body = json.dumps({
        "model": CEREBRAS_MODEL,
        "messages": messages,
        "max_tokens": 4096,
        "stream": False,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer {}".format(CEREBRAS_API_KEY),
            "User-Agent": "DzeckAI/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")

    return json.loads(raw)


def call_api_with_retry(messages: list, max_retries: int = 5) -> dict:
    """Call Cerebras AI with exponential backoff retry."""
    last_error = None
    for attempt in range(max_retries):
        try:
            return call_api(messages)
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429 or e.code >= 500:
                wait = 2 ** attempt
                sys.stderr.write("[chat] HTTP {} error, retrying in {}s ({}/{})\n".format(
                    e.code, wait, attempt + 1, max_retries))
                sys.stderr.flush()
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("API call failed after {} retries".format(max_retries))


def stream_response(messages: list) -> None:
    """Call Cerebras AI and stream response as JSON lines."""
    result = call_api_with_retry(messages)

    # Cerebras response: {"choices": [{"message": {"content": "..."}}]}
    # OR legacy: {"result": {"response": "..."}, "success": true}
    parsed = result.get("result", result)
    content = parsed.get("response", "")

    if not content:
        # Fallback: OpenAI-compatible format
        choices = result.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", "")

    if content:
        sys.stdout.write(json.dumps({"content": content}) + "\n")
        sys.stdout.flush()


def main():
    if not CEREBRAS_API_KEY:
        sys.stdout.write(json.dumps({"error": "CEREBRAS_API_KEY is not set"}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    try:
        raw_input = sys.stdin.read()
        input_data = json.loads(raw_input)
        messages = input_data.get("messages", [])

        stream_response(messages)

        sys.stdout.write(json.dumps({"done": True}) + "\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stdout.write(json.dumps({"error": str(e)}) + "\n")
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
