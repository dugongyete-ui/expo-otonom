"""
Base agent class matching ai-manus BaseAgent architecture.
Uses existing Cohere/Cerebras API infrastructure instead of LangChain.
"""
import asyncio
import logging
import os
import json
import uuid
from abc import ABC
from typing import List, Dict, Any, Optional, AsyncGenerator

from server.agent.models.event import (
    BaseEvent,
    ToolEvent,
    ToolStatus,
    ErrorEvent,
    MessageEvent,
)
from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool
from server.agent.utils.robust_json_parser import RobustJsonParser

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """
    Base agent class matching ai-manus pattern.
    Wraps Cohere/Cerebras API for LLM invocations.
    """

    name: str = ""
    system_prompt: str = ""
    max_iterations: int = 50
    max_retries: int = 3
    retry_interval: float = 1.0
    tool_choice: Optional[str] = None

    def __init__(
        self,
        agent_id: str,
        tools: List[BaseTool] = None,
    ):
        self._agent_id = agent_id
        self.toolkits: List[BaseTool] = tools or []
        self._parser = RobustJsonParser()

    def get_all_tool_schemas(self) -> List[Dict[str, Any]]:
        """Get all tool schemas from all toolkits."""
        schemas = []
        for toolkit in self.toolkits:
            schemas.extend(toolkit.get_tools())
        return schemas

    def has_function(self, function_name: str) -> bool:
        """Check if any toolkit has this function."""
        for toolkit in self.toolkits:
            if toolkit.has_function(function_name):
                return True
        return False

    def get_toolkit_name(self, function_name: str) -> str:
        """Get the toolkit name for a given function."""
        for toolkit in self.toolkits:
            if toolkit.has_function(function_name):
                return toolkit.name
        return "unknown"

    async def invoke_function(self, function_name: str, **kwargs) -> ToolResult:
        """Invoke a function from the appropriate toolkit."""
        for toolkit in self.toolkits:
            if toolkit.has_function(function_name):
                return await toolkit.invoke_function(function_name, **kwargs)
        raise ValueError(f"Unknown function: {function_name}")

    async def _parse_json(self, text: str) -> dict:
        """Parse JSON from LLM output."""
        result, _ = self._parser.parse(text)
        if result is not None:
            return result
        try:
            return json.loads(text)
        except Exception:
            return {}

    def _call_llm(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Synchronous LLM call using existing Cohere infrastructure."""
        import urllib.request
        from server.agent.domain.cohere import (
            CEREBRAS_API_URL,
            _build_request_body,
            _make_cerebras_request,
            _extract_cerebras_response,
        )

        body = _build_request_body(messages, stream=False, tools=tools)
        req = _make_cerebras_request(CEREBRAS_API_URL, body)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            return data
        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            raise

    async def ask(self, request: str) -> Dict[str, Any]:
        """Make an LLM call with the given request string."""
        messages = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.append({"role": "user", "content": request})

        tools = self.get_all_tool_schemas() if self.tool_choice != "none" else None
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: self._call_llm(messages, tools))

    async def execute(self, request: str) -> AsyncGenerator[BaseEvent, None]:
        """
        Execute a request through the agent with tool calling support.
        Yields BaseEvent objects matching ai-manus pattern.
        """
        from server.agent.domain.cohere import _extract_cerebras_response

        messages = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.append({"role": "user", "content": request})

        tools = self.get_all_tool_schemas() if self.tool_choice != "none" else None
        loop = asyncio.get_running_loop()

        for iteration in range(self.max_iterations):
            try:
                result = await loop.run_in_executor(
                    None,
                    lambda msgs=messages, t=tools: self._call_llm(msgs, t),
                )
            except Exception as e:
                yield ErrorEvent(error=f"LLM call failed: {e}")
                return

            text, tool_calls = _extract_cerebras_response(result)

            if not tool_calls:
                yield MessageEvent(message=text or "")
                return

            messages.append({"role": "assistant", "content": text or "", "tool_calls": [
                {
                    "id": str(uuid.uuid4())[:8],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])},
                }
                for tc in tool_calls
            ]})

            tool_responses = []
            for tc in tool_calls:
                function_name = tc["name"]
                function_args = tc["arguments"] if isinstance(tc["arguments"], dict) else {}
                tool_call_id = str(uuid.uuid4())[:8]
                toolkit_name = self.get_toolkit_name(function_name)

                yield ToolEvent(
                    status=ToolStatus.CALLING,
                    tool_call_id=tool_call_id,
                    tool_name=toolkit_name,
                    function_name=function_name,
                    function_args=function_args,
                )

                try:
                    tool_result = await self.invoke_function(function_name, **function_args)
                    result_content = tool_result.message or (json.dumps(tool_result.data) if tool_result.data else "")
                    yield ToolEvent(
                        status=ToolStatus.CALLED,
                        tool_call_id=tool_call_id,
                        tool_name=toolkit_name,
                        function_name=function_name,
                        function_args=function_args,
                        function_result=tool_result,
                    )
                except Exception as e:
                    result_content = f"Tool error: {e}"
                    yield ToolEvent(
                        status=ToolStatus.ERROR,
                        tool_call_id=tool_call_id,
                        tool_name=toolkit_name,
                        function_name=function_name,
                        function_args=function_args,
                    )

                tool_responses.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": result_content,
                })

            messages.extend(tool_responses)

        yield ErrorEvent(error="Maximum iteration count reached, failed to complete the task")

    async def roll_back(self, message: Any = None) -> None:
        """Roll back any in-progress state (no-op in this implementation)."""
        pass

    async def compact_memory(self) -> None:
        """Compact memory (no-op in this implementation)."""
        pass
