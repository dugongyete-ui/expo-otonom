"""
Web search and browsing tools for Dzeck AI Agent.
Upgraded to class-based architecture from Ai-DzeckV2 (Manus) pattern.
Provides: SearchTool class + backward-compatible functions.
Uses DuckDuckGo (free, no API key required) as primary search engine.
"""
import re
import json
import urllib.request
import urllib.parse
import urllib.error
import ssl
from typing import Optional, List, Dict, Any

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool


# ─── SSL context (reusable) ──────────────────────────────────────────────────
def _make_ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


_DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_DATE_RANGE_MAP = {
    "past_hour": "h",
    "past_day": "d",
    "past_week": "w",
    "past_month": "m",
    "past_year": "y",
}


# ─── Backward-compatible functions ───────────────────────────────────────────

def _parse_ddg_results(html: str, num_results: int = 8) -> List[Dict[str, Any]]:
    """Parse DuckDuckGo HTML search results."""
    results: List[Dict[str, Any]] = []

    # Try combined pattern (title + snippet)
    combined_pattern = re.compile(
        r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?'
        r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
        re.DOTALL,
    )
    for match in combined_pattern.finditer(html):
        if len(results) >= num_results:
            break
        link = match.group(1)
        if "uddg=" in link:
            m = re.search(r"uddg=([^&]+)", link)
            if m:
                link = urllib.parse.unquote(m.group(1))
        title = re.sub(r"<[^>]+>", "", match.group(2)).strip()
        snippet = re.sub(r"<[^>]+>", "", match.group(3)).strip()
        if title and link:
            results.append({"title": title, "url": link, "snippet": snippet})

    # Fallback: just titles + links
    if not results:
        link_pattern = re.compile(
            r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
            re.DOTALL,
        )
        for match in link_pattern.finditer(html):
            if len(results) >= num_results:
                break
            link = match.group(1)
            if "uddg=" in link:
                m = re.search(r"uddg=([^&]+)", link)
                if m:
                    link = urllib.parse.unquote(m.group(1))
            title = re.sub(r"<[^>]+>", "", match.group(2)).strip()
            if title and link:
                results.append({"title": title, "url": link, "snippet": ""})

    return results


def info_search_web(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
) -> ToolResult:
    """Search the web using DuckDuckGo HTML search (no API key needed)."""
    df_param = _DATE_RANGE_MAP.get(date_range or "", "") if date_range and date_range != "all" else ""

    try:
        encoded_query = urllib.parse.quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
        if df_param:
            url += f"&df={df_param}"

        req = urllib.request.Request(url, headers={"User-Agent": _DEFAULT_UA})
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=15) as response:
            html = response.read().decode("utf-8", errors="replace")

        results = _parse_ddg_results(html, num_results=num_results)

        if not results:
            # Fallback: try different DuckDuckGo URL format
            url2 = f"https://duckduckgo.com/html/?q={encoded_query}"
            req2 = urllib.request.Request(url2, headers={"User-Agent": _DEFAULT_UA})
            try:
                with urllib.request.urlopen(req2, context=_make_ssl_ctx(), timeout=15) as resp2:
                    html2 = resp2.read().decode("utf-8", errors="replace")
                results = _parse_ddg_results(html2, num_results=num_results)
            except Exception:
                pass

        formatted = "\n\n".join(
            f"{i+1}. [{r['title']}]({r['url']})\n   {r['snippet']}"
            for i, r in enumerate(results)
        ) if results else "No results found."

        return ToolResult(
            success=True,
            message=f"Search results for '{query}' ({len(results)} results):\n\n{formatted}",
            data={"results": results, "query": query, "count": len(results), "date_range": date_range},
        )

    except Exception as e:
        return ToolResult(
            success=False,
            message=f"Search failed: {str(e)}",
            data={"error": str(e), "query": query},
        )


def web_search(query: str, num_results: int = 8) -> ToolResult:
    """Alias for info_search_web."""
    return info_search_web(query=query, num_results=num_results)


def web_browse(url: str) -> ToolResult:
    """Browse a web page and extract its text content."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": _DEFAULT_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        )
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=20) as response:
            content_type = response.headers.get("Content-Type", "")
            if "text" not in content_type and "html" not in content_type:
                return ToolResult(
                    success=True,
                    message=f"[Binary content: {content_type}]",
                    data={"url": url, "content": f"[Binary content: {content_type}]", "title": ""},
                )
            html = response.read().decode("utf-8", errors="replace")

        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
        title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else ""

        html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
        html = re.sub(r"<(?:br|p|div|h[1-6]|li|tr)[^>]*>", "\n", html, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", "", html)
        text = (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                    .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))

        lines = [line.strip() for line in text.split("\n")]
        lines = [line for line in lines if line]
        text = "\n".join(lines)

        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[Content truncated...]"

        return ToolResult(
            success=True,
            message=f"Page: {title}\nURL: {url}\n\n{text}",
            data={"url": url, "title": title, "content": text, "length": len(text)},
        )
    except Exception as e:
        return ToolResult(
            success=False,
            message=f"Failed to browse {url}: {str(e)}",
            data={"error": str(e), "url": url},
        )


# ─── Class-based SearchTool (Ai-DzeckV2 / Manus pattern) ─────────────────────

class SearchTool(BaseTool):
    """Search tool class - provides web search and browsing capabilities."""

    name: str = "search"

    def __init__(self) -> None:
        super().__init__()

    @tool(
        name="info_search_web",
        description="Search web pages using search engine. Use for obtaining latest information, news, facts, or finding references. Returns titles, URLs, and snippets.",
        parameters={
            "query": {
                "type": "string",
                "description": "Search query in Google search style, using 3-5 relevant keywords.",
            },
            "date_range": {
                "type": "string",
                "enum": ["all", "past_hour", "past_day", "past_week", "past_month", "past_year"],
                "description": "(Optional) Time range filter for search results.",
            },
        },
        required=["query"],
    )
    def _info_search_web(self, query: str, date_range: Optional[str] = None) -> ToolResult:
        return info_search_web(query=query, date_range=date_range)
