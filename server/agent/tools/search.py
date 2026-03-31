"""
Web search and browsing tools for Dzeck AI Agent.
Upgraded to class-based architecture from Ai-DzeckV2 (Manus) pattern.
Provides: SearchTool class + backward-compatible functions.

Search provider priority:
  SEARCH_PROVIDER env var → bing API (if key) → tavily (if key) → bing_web scraper → duckduckgo
  Default: bing_web if no API key, or bing if BING_SEARCH_API_KEY is set.
"""
import re
import os
import json
import base64
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

_DATE_RANGE_MAP = {
    "past_hour": "h",
    "past_day": "d",
    "past_week": "w",
    "past_month": "m",
    "past_year": "y",
}

_TAVILY_DATE_RANGE_MAP = {
    "past_hour": "day",
    "past_day": "day",
    "past_week": "week",
    "past_month": "month",
    "past_year": "year",
}

# Bing API date range freshness mapping
_BING_FRESHNESS_MAP = {
    "past_hour": "Hour",
    "past_day": "Day",
    "past_week": "Week",
    "past_month": "Month",
    "past_year": "Year",
}

# Bing Web scraper freshness filters
_BING_WEB_FRESHNESS_MAP = {
    "past_hour": 'ex1:"ez1"',
    "past_day": 'ex1:"ez2"',
    "past_week": 'ex1:"ez3"',
    "past_month": 'ex1:"ez4"',
    "past_year": 'ex1:"ez5"',
}


# ─── Bing Web Search API ─────────────────────────────────────────────────────

def _bing_api_search(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
    api_key: str = "",
) -> Optional[List[Dict[str, Any]]]:
    """Search using Bing Web Search API (REST).
    Requires BING_SEARCH_API_KEY. Returns list of results or None on failure.
    """
    if not api_key:
        return None
    try:
        params: Dict[str, str] = {
            "q": query,
            "count": str(num_results),
            "mkt": "en-US",
            "safeSearch": "Moderate",
            "textDecorations": "false",
            "textFormat": "Raw",
        }
        if date_range and date_range != "all":
            freshness = _BING_FRESHNESS_MAP.get(date_range)
            if freshness:
                params["freshness"] = freshness

        url = "https://api.bing.microsoft.com/v7.0/search?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(
            url,
            headers={
                "Ocp-Apim-Subscription-Key": api_key,
                "User-Agent": _DEFAULT_UA,
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        web_pages = data.get("webPages", {}).get("value", [])
        results = []
        for item in web_pages[:num_results]:
            results.append({
                "title": item.get("name", ""),
                "url": item.get("url", ""),
                "snippet": item.get("snippet", ""),
            })
        return results if results else None
    except Exception:
        return None


# ─── Bing Web Scraper (no API key needed) ─────────────────────────────────────

def _decode_bing_redirect(url: str) -> str:
    """Extract real destination URL from a Bing /ck/a tracking redirect."""
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        u_values = parse_qs(parsed.query).get("u", [])
        if u_values and u_values[0].startswith("a1"):
            encoded = u_values[0][2:]
            padding = 4 - len(encoded) % 4
            if padding != 4:
                encoded += "=" * padding
            return base64.b64decode(encoded).decode("utf-8", errors="replace")
    except Exception:
        pass
    return url


def _bing_web_search(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
) -> Optional[List[Dict[str, Any]]]:
    """Search by scraping Bing HTML results directly (no API key needed).
    Uses browser impersonation via User-Agent headers.
    Returns list of results or None on failure.
    """
    try:
        params: Dict[str, str] = {
            "q": query,
            "count": "20",
        }
        if date_range and date_range != "all":
            freshness_filter = _BING_WEB_FRESHNESS_MAP.get(date_range)
            if freshness_filter:
                params["filters"] = freshness_filter

        url = "https://www.bing.com/search?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": _DEFAULT_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            },
        )
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=20) as resp:
            raw = resp.read()
            encoding = resp.headers.get_content_charset("utf-8")
            html = raw.decode(encoding, errors="replace")

        results: List[Dict[str, Any]] = []

        # Parse <li class="b_algo"> blocks
        algo_pattern = re.compile(
            r'<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>(.*?)</li>',
            re.DOTALL | re.IGNORECASE,
        )
        h2_link_pattern = re.compile(
            r'<h2[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
            re.DOTALL | re.IGNORECASE,
        )
        snippet_pattern = re.compile(
            r'<(?:p|div)[^>]*class="[^"]*(?:b_lineclamp|b_descript|b_caption|b_paractl)[^"]*"[^>]*>(.*?)</(?:p|div)>',
            re.DOTALL | re.IGNORECASE,
        )

        for block_match in algo_pattern.finditer(html):
            if len(results) >= num_results:
                break
            block = block_match.group(1)

            link_match = h2_link_pattern.search(block)
            if not link_match:
                continue

            link = link_match.group(1)
            title_raw = link_match.group(2)
            title = re.sub(r"<[^>]+>", "", title_raw).strip()

            if not title:
                continue

            # Decode Bing redirect URLs
            if "/ck/a?" in link:
                link = _decode_bing_redirect(link)

            snippet = ""
            snip_match = snippet_pattern.search(block)
            if snip_match:
                snippet = re.sub(r"<[^>]+>", "", snip_match.group(1)).strip()
            if not snippet:
                p_texts = re.findall(r"<p[^>]*>(.*?)</p>", block, re.DOTALL | re.IGNORECASE)
                for p in p_texts:
                    t = re.sub(r"<[^>]+>", "", p).strip()
                    if len(t) > 20:
                        snippet = t
                        break

            if title and link:
                results.append({
                    "title": title,
                    "url": link,
                    "snippet": snippet,
                })

        return results if results else None
    except Exception:
        return None


# ─── Google Custom Search API ─────────────────────────────────────────────────

def _google_api_search(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
    api_key: str = "",
    engine_id: str = "",
) -> Optional[List[Dict[str, Any]]]:
    """Search using Google Custom Search JSON API.
    Requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.
    Returns list of results or None on failure.
    """
    if not api_key or not engine_id:
        return None
    try:
        params: Dict[str, str] = {
            "key": api_key,
            "cx": engine_id,
            "q": query,
            "num": str(min(num_results, 10)),
        }
        _google_date_map = {
            "past_hour": "d1",
            "past_day": "d1",
            "past_week": "w1",
            "past_month": "m1",
            "past_year": "y1",
        }
        if date_range and date_range != "all":
            dr = _google_date_map.get(date_range)
            if dr:
                params["dateRestrict"] = dr

        url = "https://www.googleapis.com/customsearch/v1?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(
            url,
            headers={"User-Agent": _DEFAULT_UA, "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        results = []
        for item in data.get("items", [])[:num_results]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            })
        return results if results else None
    except Exception:
        return None


# ─── Tavily search ────────────────────────────────────────────────────────────

def _tavily_search(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
    api_key: str = "",
) -> Optional[List[Dict[str, Any]]]:
    """Search using Tavily synchronous API client. Returns list of results or None on failure."""
    try:
        from tavily import TavilyClient

        client = TavilyClient(api_key=api_key)

        days = None
        if date_range and date_range != "all":
            tavily_range = _TAVILY_DATE_RANGE_MAP.get(date_range)
            if tavily_range == "day":
                days = 1
            elif tavily_range == "week":
                days = 7
            elif tavily_range == "month":
                days = 30
            elif tavily_range == "year":
                days = 365

        kwargs: Dict[str, Any] = {
            "query": query,
            "max_results": num_results,
            "search_depth": "basic",
            "include_answer": False,
        }
        if days is not None:
            kwargs["days"] = days

        response = client.search(**kwargs)

        results = []
        for r in response.get("results", []):
            results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", ""),
            })
        return results if results else None
    except Exception:
        return None


# ─── DuckDuckGo fallback ──────────────────────────────────────────────────────

def _parse_ddg_results(html: str, num_results: int = 8) -> List[Dict[str, Any]]:
    """Parse DuckDuckGo HTML search results."""
    results: List[Dict[str, Any]] = []

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


def _ddg_search(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
) -> List[Dict[str, Any]]:
    """Search using DuckDuckGo HTML scraper."""
    df_param = _DATE_RANGE_MAP.get(date_range or "", "") if date_range and date_range != "all" else ""
    encoded_query = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
    if df_param:
        url += f"&df={df_param}"

    req = urllib.request.Request(url, headers={"User-Agent": _DEFAULT_UA})
    with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=15) as response:
        html = response.read().decode("utf-8", errors="replace")

    results = _parse_ddg_results(html, num_results=num_results)

    if not results:
        url2 = f"https://duckduckgo.com/html/?q={encoded_query}"
        req2 = urllib.request.Request(url2, headers={"User-Agent": _DEFAULT_UA})
        try:
            with urllib.request.urlopen(req2, context=_make_ssl_ctx(), timeout=15) as resp2:
                html2 = resp2.read().decode("utf-8", errors="replace")
            results = _parse_ddg_results(html2, num_results=num_results)
        except Exception:
            pass

    return results


# ─── Provider selection logic ─────────────────────────────────────────────────

def _get_search_provider() -> str:
    """Determine search provider from SEARCH_PROVIDER env var.
    Falls back to bing if BING_SEARCH_API_KEY set, otherwise bing_web.
    """
    explicit = os.environ.get("SEARCH_PROVIDER", "").strip().lower()
    if explicit in ("bing_web", "bing", "google", "tavily", "duckduckgo"):
        return explicit
    # Auto-detect based on available keys
    if os.environ.get("BING_SEARCH_API_KEY", ""):
        return "bing"
    return "bing_web"


# ─── Backward-compatible functions ───────────────────────────────────────────

def info_search_web(
    query: str,
    date_range: Optional[str] = None,
    num_results: int = 8,
) -> ToolResult:
    """Search the web.

    Provider selection order (configurable via SEARCH_PROVIDER env var):
    1. google  — requires GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID
    2. bing    — requires BING_SEARCH_API_KEY
    3. tavily  — requires TAVILY_API_KEY
    4. bing_web — no key required (scraper)
    5. duckduckgo — no key required (fallback)

    Set SEARCH_PROVIDER=google to use Google Custom Search API.
    """
    bing_key = os.environ.get("BING_SEARCH_API_KEY", "")
    tavily_key = os.environ.get("TAVILY_API_KEY", "")
    google_key = os.environ.get("GOOGLE_SEARCH_API_KEY", "")
    google_engine_id = os.environ.get("GOOGLE_SEARCH_ENGINE_ID", "") or os.environ.get("GOOGLE_CSE_ID", "")

    provider = _get_search_provider()

    try:
        results: List[Dict[str, Any]] = []
        engine = "duckduckgo"

        def _try_provider(p: str) -> bool:
            nonlocal results, engine
            if p == "bing" and bing_key:
                r = _bing_api_search(query=query, date_range=date_range, num_results=num_results, api_key=bing_key)
                if r:
                    results = r
                    engine = "bing"
                    return True
            elif p == "google" and google_key and google_engine_id:
                r = _google_api_search(query=query, date_range=date_range, num_results=num_results, api_key=google_key, engine_id=google_engine_id)
                if r:
                    results = r
                    engine = "google"
                    return True
            elif p == "tavily" and tavily_key:
                r = _tavily_search(query=query, date_range=date_range, num_results=num_results, api_key=tavily_key)
                if r:
                    results = r
                    engine = "tavily"
                    return True
            elif p == "bing_web":
                r = _bing_web_search(query=query, date_range=date_range, num_results=num_results)
                if r:
                    results = r
                    engine = "bing_web"
                    return True
            elif p == "duckduckgo":
                r = _ddg_search(query=query, date_range=date_range, num_results=num_results)
                if r:
                    results = r
                    engine = "duckduckgo"
                    return True
            return False

        # Try the configured provider first
        providers_tried: List[str] = [provider]
        if not _try_provider(provider):
            # Fallback chain (spec): bing API → tavily → bing_web scraper → duckduckgo
            # google is intentionally excluded from fallback — only used if SEARCH_PROVIDER=google
            for fallback in ["bing", "tavily", "bing_web", "duckduckgo"]:
                if fallback != provider:
                    providers_tried.append(fallback)
                    if _try_provider(fallback):
                        break

        if not results:
            tried_str = ", ".join(providers_tried)
            return ToolResult(
                success=False,
                message=(
                    f"Search failed for '{query}': all providers returned no results "
                    f"(tried: {tried_str}). "
                    "Check that at least one search provider is reachable (bing_web scraper requires "
                    "internet access; for API-based providers set BING_SEARCH_API_KEY, TAVILY_API_KEY, "
                    "or GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID)."
                ),
                data={"results": [], "query": query, "count": 0, "date_range": date_range, "engine": None, "providers_tried": providers_tried},
            )

        formatted = "\n\n".join(
            f"{i+1}. [{r['title']}]({r['url']})\n   {r['snippet']}"
            for i, r in enumerate(results)
        )

        return ToolResult(
            success=True,
            message=f"Search results for '{query}' ({len(results)} results, via {engine}):\n\n{formatted}",
            data={"results": results, "query": query, "count": len(results), "date_range": date_range, "engine": engine},
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

    @tool(
        name="web_search",
        description="Alias for info_search_web. Search the web using keyword queries.",
        parameters={
            "query": {
                "type": "string",
                "description": "Search query keywords.",
            },
        },
        required=["query"],
    )
    def _web_search(self, query: str) -> ToolResult:
        return web_search(query=query)

    @tool(
        name="web_browse",
        description="Browse a web page and extract its text content. Use to read full page content from a URL.",
        parameters={
            "url": {
                "type": "string",
                "description": "Full URL of the web page to browse (e.g. https://example.com).",
            },
        },
        required=["url"],
    )
    def _web_browse(self, url: str) -> ToolResult:
        return web_browse(url=url)
