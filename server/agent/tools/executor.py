"""
Tool Calling Executor for Dzeck AI Agent.
Handles tool invocation, parsing, and execution with robust error handling.
Based on Dzeck system prompt tool calling specification.
"""
import json
import re
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

from server.agent.models.tool_result import ToolResult
from server.agent.tools.registry import (
    TOOLS,
    TOOL_ALIASES,
    resolve_tool_name,
    execute_tool,
    get_toolkit_name,
)


@dataclass
class ToolCall:
    """Represents a single tool call."""
    name: str
    parameters: Dict[str, Any]
    tool_call_id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "parameters": self.parameters,
            "tool_call_id": self.tool_call_id,
        }


class ToolCallParser:
    """Parse tool calls from LLM responses."""
    
    @staticmethod
    def extract_tool_calls(text: str) -> List[ToolCall]:
        """
        Extract tool calls from text.
        Supports multiple formats:
        1. JSON array: [{"name": "...", "parameters": {...}}]
        2. JSON object: {"name": "...", "parameters": {...}}
        3. Function call format: <invoke name="tool_name"><parameter name="key">value</parameter></invoke>
        """
        tool_calls = []
        
        # Try JSON array format
        try:
            data = json.loads(text)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "name" in item:
                        tool_calls.append(ToolCall(
                            name=item["name"],
                            parameters=item.get("parameters", {}),
                            tool_call_id=item.get("tool_call_id", ""),
                        ))
                if tool_calls:
                    return tool_calls
            elif isinstance(data, dict) and "name" in data:
                tool_calls.append(ToolCall(
                    name=data["name"],
                    parameters=data.get("parameters", {}),
                    tool_call_id=data.get("tool_call_id", ""),
                ))
                return tool_calls
        except json.JSONDecodeError:
            pass
        
        # Try function call format: <invoke name="tool"><parameter name="key">value</parameter></invoke>
        pattern = r'<invoke\s+name="([^"]+)">(.*?)</invoke>'
        matches = re.findall(pattern, text, re.DOTALL)
        
        for tool_name, content in matches:
            parameters = {}
            param_pattern = r'<parameter\s+name="([^"]+)">([^<]*)</parameter>'
            param_matches = re.findall(param_pattern, content)
            
            for param_name, param_value in param_matches:
                # Try to parse as JSON
                try:
                    parameters[param_name] = json.loads(param_value)
                except (json.JSONDecodeError, ValueError):
                    parameters[param_name] = param_value
            
            tool_calls.append(ToolCall(
                name=tool_name,
                parameters=parameters,
            ))
        
        return tool_calls
    
    @staticmethod
    def validate_tool_call(tool_call: ToolCall) -> Tuple[bool, Optional[str]]:
        """Validate a tool call."""
        # Check if tool exists
        resolved_name = resolve_tool_name(tool_call.name)
        if resolved_name is None:
            available = ", ".join(sorted(TOOLS.keys()))
            return False, f"Unknown tool '{tool_call.name}'. Available tools: {available}"
        
        # Check if parameters is a dict
        if not isinstance(tool_call.parameters, dict):
            return False, f"Tool parameters must be a dictionary, got {type(tool_call.parameters)}"
        
        return True, None


class ToolCallExecutor:
    """Execute tool calls with error handling."""
    
    def __init__(self):
        self.parser = ToolCallParser()
        self.execution_history: List[Dict[str, Any]] = []
    
    def execute_tool_call(self, tool_call: ToolCall) -> ToolResult:
        """Execute a single tool call."""
        # Validate
        is_valid, error_msg = self.parser.validate_tool_call(tool_call)
        if not is_valid:
            result = ToolResult(success=False, message=error_msg)
            self._record_execution(tool_call, result)
            return result
        
        # Resolve tool name
        resolved_name = resolve_tool_name(tool_call.name)
        
        # Execute
        try:
            result = execute_tool(resolved_name, tool_call.parameters)
            self._record_execution(tool_call, result)
            return result
        except Exception as e:
            result = ToolResult(
                success=False,
                message=f"Tool execution failed: {str(e)}"
            )
            self._record_execution(tool_call, result)
            return result
    
    def execute_tool_calls(self, tool_calls: List[ToolCall]) -> List[ToolResult]:
        """Execute multiple tool calls."""
        results = []
        for tool_call in tool_calls:
            result = self.execute_tool_call(tool_call)
            results.append(result)
        return results
    
    def execute_from_text(self, text: str) -> Tuple[List[ToolCall], List[ToolResult]]:
        """
        Parse and execute tool calls from text.
        Returns tuple of (tool_calls, results)
        """
        tool_calls = self.parser.extract_tool_calls(text)
        results = self.execute_tool_calls(tool_calls)
        return tool_calls, results
    
    def _record_execution(self, tool_call: ToolCall, result: ToolResult) -> None:
        """Record tool execution for history."""
        self.execution_history.append({
            "tool_name": tool_call.name,
            "parameters": tool_call.parameters,
            "result": {
                "success": result.success,
                "message": result.message,
                "data": result.data,
            }
        })
    
    def get_execution_history(self) -> List[Dict[str, Any]]:
        """Get execution history."""
        return self.execution_history
    
    def clear_history(self) -> None:
        """Clear execution history."""
        self.execution_history = []


class ToolCallFormatter:
    """Format tool calls for LLM responses."""
    
    @staticmethod
    def format_as_json(tool_calls: List[ToolCall]) -> str:
        """Format tool calls as JSON array."""
        data = [tc.to_dict() for tc in tool_calls]
        return json.dumps(data, indent=2)
    
    @staticmethod
    def format_as_function_calls(tool_calls: List[ToolCall]) -> str:
        """Format tool calls as function call XML."""
        result = "<function_calls>\n"
        for tc in tool_calls:
            result += f'<invoke name="{tc.name}">\n'
            for key, value in tc.parameters.items():
                if isinstance(value, str):
                    result += f'<parameter name="{key}">{value}</parameter>\n'
                else:
                    result += f'<parameter name="{key}">{json.dumps(value)}</parameter>\n'
            result += "</invoke>\n"
        result += "</function_calls>"
        return result
    
    @staticmethod
    def format_results(tool_calls: List[ToolCall], results: List[ToolResult]) -> str:
        """Format execution results."""
        output = []
        for tc, result in zip(tool_calls, results):
            output.append(f"Tool: {tc.name}")
            output.append(f"Status: {'✅ SUCCESS' if result.success else '❌ FAILED'}")
            output.append(f"Message: {result.message}")
            if result.data:
                output.append(f"Data: {json.dumps(result.data, indent=2)}")
            output.append("")
        return "\n".join(output)


# Singleton executor
_executor = ToolCallExecutor()


def get_executor() -> ToolCallExecutor:
    """Get the global tool call executor."""
    return _executor


def parse_tool_calls(text: str) -> List[ToolCall]:
    """Parse tool calls from text."""
    return ToolCallParser.extract_tool_calls(text)


def execute_tool_calls(tool_calls: List[ToolCall]) -> List[ToolResult]:
    """Execute tool calls."""
    return _executor.execute_tool_calls(tool_calls)


def execute_from_text(text: str) -> Tuple[List[ToolCall], List[ToolResult]]:
    """Parse and execute tool calls from text."""
    return _executor.execute_from_text(text)
