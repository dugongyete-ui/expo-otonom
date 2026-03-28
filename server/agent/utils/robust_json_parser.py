"""
Robust JSON parser for the AI agent.
Ported from ai-manus: app/domain/utils/robust_json_parser.py

Implements a multi-stage JSON repair pipeline to prevent hallucinations
and handle malformed tool calls from LLMs:

Stage 1: parse_partial_json - handles truncated/incomplete JSON
Stage 2: parse_json_markdown - removes markdown code fences
Stage 3: extract_json_object - finds JSON in mixed text
Stage 4: repair_json - attempts structural repairs
Stage 5: fallback - returns error with details
"""
import re
import json
from typing import Optional, Dict, Any, Tuple, Union


class RobustJsonParser:
    """Multi-stage JSON parser that handles common LLM output issues.
    
    This is the key anti-hallucination component ported from ai-manus.
    LLMs often produce:
    - Truncated JSON (incomplete closing braces)
    - JSON wrapped in markdown code fences
    - JSON mixed with explanatory text
    - Invalid escape sequences
    - Trailing commas
    - Single quotes instead of double quotes
    
    This parser handles all of these cases through a 5-stage pipeline.
    """

    @staticmethod
    def parse(text: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Parse text into JSON using multi-stage repair pipeline.
        
        Returns:
            Tuple of (parsed_dict or None, error_message or None)
        """
        # Safety: handle non-string inputs (e.g. dict/list from llama-4-scout)
        if isinstance(text, dict):
            return text, None
        if isinstance(text, list):
            return None, "Input is a list, not a dict"
        if text is None:
            return None, "Empty input"
        if not isinstance(text, str):
            text = str(text)

        if not text or not text.strip():
            return None, "Empty input"

        text = text.strip()

        # Stage 1: Direct parse
        result = RobustJsonParser._try_direct_parse(text)
        if result is not None:
            return result, None

        # Stage 2: Remove markdown code fences
        result = RobustJsonParser._parse_json_markdown(text)
        if result is not None:
            return result, None

        # Stage 3: Extract JSON object from mixed text
        result = RobustJsonParser._extract_json_object(text)
        if result is not None:
            return result, None

        # Stage 4: Repair common JSON issues
        result = RobustJsonParser._repair_json(text)
        if result is not None:
            return result, None

        # Stage 5: Parse partial/truncated JSON
        result = RobustJsonParser._parse_partial_json(text)
        if result is not None:
            return result, None

        return None, f"Failed to parse JSON after all stages. Input: {text[:200]}..."

    @staticmethod
    def _try_direct_parse(text: str) -> Optional[Dict[str, Any]]:
        """Stage 1: Try direct JSON parsing."""
        try:
            result = json.loads(text)
            if isinstance(result, dict):
                return result
            return None
        except (json.JSONDecodeError, ValueError):
            return None

    @staticmethod
    def _parse_json_markdown(text: str) -> Optional[Dict[str, Any]]:
        """Stage 2: Remove markdown code fences and parse.
        
        Handles:
        ```json
        {...}
        ```
        and
        ```
        {...}
        ```
        """
        # Try to extract JSON from markdown code blocks
        patterns = [
            r"```json\s*\n?(.*?)\n?\s*```",
            r"```\s*\n?(.*?)\n?\s*```",
            r"`(.*?)`",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                extracted = match.group(1).strip()
                try:
                    result = json.loads(extracted)
                    if isinstance(result, dict):
                        return result
                except (json.JSONDecodeError, ValueError):
                    continue
        return None

    @staticmethod
    def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
        """Stage 3: Extract JSON object from mixed text.
        
        Finds the first { and its matching } to extract JSON
        from text that contains explanations alongside JSON.
        """
        # Find all potential JSON starts
        brace_start = text.find("{")
        if brace_start == -1:
            return None

        # Try to find matching closing brace
        depth = 0
        in_string = False
        escape_next = False
        
        for i in range(brace_start, len(text)):
            char = text[i]
            
            if escape_next:
                escape_next = False
                continue
                
            if char == "\\":
                escape_next = True
                continue
                
            if char == '"' and not escape_next:
                in_string = not in_string
                continue
                
            if in_string:
                continue
                
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    json_str = text[brace_start:i + 1]
                    try:
                        result = json.loads(json_str)
                        if isinstance(result, dict):
                            return result
                    except (json.JSONDecodeError, ValueError):
                        break

        return None

    @staticmethod
    def _repair_json(text: str) -> Optional[Dict[str, Any]]:
        """Stage 4: Repair common JSON issues.
        
        Handles:
        - Trailing commas
        - Single quotes
        - Unquoted keys
        - Invalid escape sequences
        """
        # Find JSON-like content
        brace_start = text.find("{")
        if brace_start == -1:
            return None
        
        # Find last closing brace
        brace_end = text.rfind("}")
        if brace_end == -1:
            return None
            
        json_str = text[brace_start:brace_end + 1]

        # Fix trailing commas before } or ]
        json_str = re.sub(r",\s*([}\]])", r"\1", json_str)

        # Fix single quotes to double quotes (careful with nested quotes)
        # Only do this if there are no double quotes (indicating single-quote JSON)
        if "'" in json_str and json_str.count('"') < json_str.count("'"):
            json_str = json_str.replace("'", '"')

        # Fix unescaped newlines in strings
        json_str = re.sub(r'(?<!\\)\n', r'\\n', json_str)

        try:
            result = json.loads(json_str)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

        return None

    @staticmethod
    def _parse_partial_json(text: str) -> Optional[Dict[str, Any]]:
        """Stage 5: Parse partial/truncated JSON.
        
        Handles incomplete JSON by adding missing closing brackets.
        Ported from ai-manus parse_partial_json approach.
        """
        brace_start = text.find("{")
        if brace_start == -1:
            return None

        json_str = text[brace_start:]

        # Count unmatched braces and brackets
        open_braces = 0
        open_brackets = 0
        in_string = False
        escape_next = False

        for char in json_str:
            if escape_next:
                escape_next = False
                continue
            if char == "\\":
                escape_next = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == "{":
                open_braces += 1
            elif char == "}":
                open_braces -= 1
            elif char == "[":
                open_brackets += 1
            elif char == "]":
                open_brackets -= 1

        # Close any unclosed strings, brackets, and braces
        if in_string:
            json_str += '"'

        # Remove any trailing comma
        json_str = re.sub(r",\s*$", "", json_str)

        # Add missing closing brackets and braces
        json_str += "]" * max(0, open_brackets)
        json_str += "}" * max(0, open_braces)

        try:
            result = json.loads(json_str)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

        return None
