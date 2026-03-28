"""
BaseTool class with @tool decorator for Dzeck AI Agent.
Based on Ai-DzeckV2 (Manus) architecture pattern.
"""
from typing import Dict, Any, List, Callable, Optional
import inspect
from server.agent.models.tool_result import ToolResult


def tool(
    name: str,
    description: str,
    parameters: Dict[str, Dict[str, Any]],
    required: List[str]
) -> Callable:
    """Tool registration decorator.

    Args:
        name: Tool function name (used for LLM function calling)
        description: Tool description shown to LLM
        parameters: OpenAI-style parameter definitions
        required: List of required parameter names

    Returns:
        Decorator function
    """
    def decorator(func: Callable) -> Callable:
        schema = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": parameters,
                    "required": required,
                },
            },
        }
        func._function_name = name
        func._tool_description = description
        func._tool_schema = schema
        return func

    return decorator


class BaseTool:
    """Base tool class. All tools inherit from this."""

    name: str = ""

    def __init__(self) -> None:
        self._tools_cache: Optional[List[Dict[str, Any]]] = None

    def get_tools(self) -> List[Dict[str, Any]]:
        """Return all registered tool schemas."""
        if self._tools_cache is not None:
            return self._tools_cache
        tools = []
        for _, method in inspect.getmembers(self, inspect.ismethod):
            if hasattr(method, "_tool_schema"):
                tools.append(method._tool_schema)
        self._tools_cache = tools
        return tools

    def has_function(self, function_name: str) -> bool:
        """Check if a function name is registered in this tool."""
        for _, method in inspect.getmembers(self, inspect.ismethod):
            if hasattr(method, "_function_name") and method._function_name == function_name:
                return True
        return False

    def _filter_parameters(self, method: Callable, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Filter kwargs to match the method's signature."""
        sig = inspect.signature(method)
        return {k: v for k, v in kwargs.items() if k in sig.parameters}

    async def invoke_function(self, function_name: str, **kwargs) -> ToolResult:
        """Invoke a registered tool function by name.

        Args:
            function_name: Name of the function to invoke
            **kwargs: Arguments to pass to the function

        Returns:
            ToolResult

        Raises:
            ValueError: If the function is not registered
        """
        for _, method in inspect.getmembers(self, inspect.ismethod):
            if hasattr(method, "_function_name") and method._function_name == function_name:
                filtered = self._filter_parameters(method, kwargs)
                result = method(**filtered)
                if inspect.iscoroutine(result):
                    return await result
                return result
        raise ValueError(f"Tool function '{function_name}' not found in {self.name}")
