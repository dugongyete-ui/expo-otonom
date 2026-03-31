"""
Browser tools for Dzeck AI Agent.
Uses E2B Desktop sandbox for visible browser automation on the VNC desktop.
All browser execution runs inside the unified E2B Desktop sandbox.

Architecture (Manus.im pattern):
  - Browser runs inside the SAME sandbox as shell/file tools
  - Browser is visible on VNC desktop (DISPLAY is always set in desktop sandbox)
  - Controls the Chrome/Chromium already on the XFCE desktop via xdotool/xdg-open
  - No separate browser server process needed — uses existing browser
  - screenshot via scrot
  - Page content extracted via curl + python beautifulsoup in sandbox

E2B-ONLY ENFORCEMENT:
  - Local Playwright fallback is intentionally NOT implemented (security boundary).
  - When E2B_API_KEY is not set, _make_session() returns _E2BRequiredBrowserStub
    which returns clear error messages for all browser methods.
  - There is NO code path that falls back to a local browser process.

Provides: BrowserTool class + backward-compatible functions.
"""
import re
import os
import json
import time
import threading
import logging
import urllib.request
import urllib.parse
import ssl
import textwrap
from typing import Optional, List, Any

from server.agent.models.tool_result import ToolResult

logger = logging.getLogger(__name__)

_E2B_API_KEY_AT_IMPORT = os.environ.get("E2B_API_KEY", "")


_browser_lock = threading.Lock()
_browser: Any = None


def _get_browser() -> Any:
    global _browser
    if _browser is not None:
        return _browser
    with _browser_lock:
        if _browser is None:
            _browser = _make_session()
    return _browser


def _reset_browser() -> None:
    global _browser
    with _browser_lock:
        _browser = _make_session()


def _disconnect_browser_on_exit() -> None:
    """On process exit, clean up browser state."""
    global _browser
    if _browser is not None and hasattr(_browser, 'close'):
        try:
            _browser.close()
        except Exception:
            pass
    _browser = None


import atexit
atexit.register(_disconnect_browser_on_exit)


# ---  Desktop Browser Control via xdotool / xdg-open ---
#
# E2B Desktop template has XFCE4 + Chrome/Chromium pre-installed.
# We control it via shell commands instead of spawning a new CDP server.
# This is more reliable (no 6-11 min install wait) and matches Manus.im approach.


_PAGE_EXTRACT_SCRIPT = r"""
import sys
import json
import urllib.request
import urllib.parse

url = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    from bs4 import BeautifulSoup
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "img"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title else ""
    text_blocks = []
    for el in soup.find_all(["p", "h1", "h2", "h3", "h4", "li", "td", "th", "div", "article"]):
        t = el.get_text(" ", strip=True)
        if len(t) > 30:
            text_blocks.append(t)
    content = "\n".join(dict.fromkeys(text_blocks))[:4000]

    # Interactive elements
    elements = []
    idx = 0
    for el in soup.find_all(["a", "button", "input", "select", "textarea"]):
        tag = el.name
        text = el.get_text(" ", strip=True) or el.get("placeholder", "") or el.get("value", "") or el.get("aria-label", "") or el.get("name", "")
        href = el.get("href", "")
        el_type = el.get("type", "")
        desc = "[{}] #{}: {}".format(tag, idx, text[:60])
        if href:
            desc += " -> " + href[:60]
        if el_type:
            desc += " (type={})".format(el_type)
        elements.append(desc)
        idx += 1
        if idx >= 50:
            break

    print(json.dumps({"success": True, "title": title, "url": url, "content": content, "interactive_elements": elements}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e), "url": url, "title": "", "content": "", "interactive_elements": []}))
"""


class E2BDesktopBrowserSession:
    """Browser session that controls the Chrome/Chromium already running on the E2B Desktop VNC.

    Uses xdg-open/xdotool to navigate the existing browser (visible on VNC) instead of
    spawning a new Chromium CDP server. Page content is fetched via curl+BeautifulSoup.
    Screenshots taken with scrot. This is the Manus.im approach.
    """

    def __init__(self) -> None:
        self.current_url: Optional[str] = None
        self.console_logs: List[str] = []
        self._script_installed: bool = False
        # Separate dependency state flags to avoid cross-contamination
        self._gui_deps_ok: bool = False   # xdotool, wmctrl, scrot (GUI automation)
        self._page_deps_ok: bool = False  # bs4, lxml (page content parsing)

    def _preflight_deps(self) -> Optional[str]:
        """Check that xdotool, wmctrl, and scrot are available in the sandbox.
        Returns an error message if a required tool is missing, None if all OK.
        Installs missing tools automatically (best-effort). Caches result in _gui_deps_ok."""
        if self._gui_deps_ok:
            return None
        # First ensure sandbox is available
        from server.agent.tools.e2b_sandbox import get_sandbox
        if get_sandbox() is None:
            return "E2B sandbox is not available. Browser operations require E2B sandbox."
        check = self._run(
            "which xdotool >/dev/null 2>&1 && "
            "which scrot >/dev/null 2>&1 && "
            "echo 'deps_ok'",
            timeout=10
        )
        if "deps_ok" in check["stdout"]:
            self._gui_deps_ok = True
            return None
        # Attempt auto-install (best-effort)
        logger.info("[Browser] xdotool/scrot not found — attempting apt-get install.")
        self._run(
            "DEBIAN_FRONTEND=noninteractive apt-get install -y -q xdotool wmctrl scrot 2>/dev/null",
            timeout=60
        )
        recheck = self._run(
            "which xdotool >/dev/null 2>&1 && which scrot >/dev/null 2>&1 && echo 'deps_ok'",
            timeout=10
        )
        if "deps_ok" in recheck["stdout"]:
            self._gui_deps_ok = True
            return None
        return (
            "Browser dependencies (xdotool, scrot) are not available in the E2B sandbox. "
            "Install them with: apt-get install -y xdotool wmctrl scrot"
        )

    def _run(self, command: str, timeout: int = 30) -> dict:
        """Run a shell command in the sandbox."""
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is None:
            return {"exit_code": -1, "stdout": "", "stderr": "Sandbox not available"}
        try:
            result = sb.commands.run(command, timeout=timeout)
            return {
                "exit_code": result.exit_code if hasattr(result, 'exit_code') else 0,
                "stdout": result.stdout or "",
                "stderr": result.stderr or "",
            }
        except Exception as e:
            return {"exit_code": -1, "stdout": "", "stderr": str(e)}

    def _get_scripts_dir(self) -> str:
        """Return the .dzeck_scripts directory inside the detected sandbox home."""
        from server.agent.tools.e2b_sandbox import _detected_home, WORKSPACE_DIR
        base = _detected_home or WORKSPACE_DIR
        return f"{base}/.dzeck_scripts"

    def _ensure_extract_script(self) -> bool:
        """Write the page extraction script to sandbox if not already done."""
        if self._script_installed:
            return True
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is None:
            return False
        try:
            scripts_dir = self._get_scripts_dir()
            sb.commands.run(f"mkdir -p {scripts_dir} 2>/dev/null || true", timeout=10)
            sb.files.write(f"{scripts_dir}/page_extract.py", _PAGE_EXTRACT_SCRIPT)
            self._script_installed = True
            return True
        except Exception as e:
            logger.warning("[Browser] Failed to write page extract script: %s", e)
            return False

    # CDP remote debugging port used by Chrome in sandbox
    _CDP_PORT = 9222

    def _wait_for_cdp_ready(self, max_retries: int = 10, interval: int = 3) -> bool:
        """Wait for Chrome CDP port to be ready after launch.
        
        Polls /json endpoint on localhost:CDP_PORT up to max_retries times
        with interval seconds between attempts (total max ~30s).
        Returns True if CDP responded, False if all retries failed.
        """
        for attempt in range(1, max_retries + 1):
            result = self._run(
                "curl -s --max-time 2 http://localhost:{}/json 2>/dev/null | head -c 100".format(self._CDP_PORT),
                timeout=5,
            )
            if result["exit_code"] == 0 and result["stdout"].strip().startswith("["):
                logger.info("[Browser] CDP port %d ready after %d attempt(s)", self._CDP_PORT, attempt)
                return True
            if attempt < max_retries:
                logger.debug("[Browser] CDP not ready (attempt %d/%d), waiting %ds...", attempt, max_retries, interval)
                time.sleep(interval)
        logger.error("[Browser] CDP port %d not ready after %d attempts (%ds timeout)", self._CDP_PORT, max_retries, max_retries * interval)
        return False

    def _detect_display(self) -> str:
        """Detect the active X display inside the E2B Desktop sandbox.
        E2B Desktop uses XFCE4 which typically runs on :0. Verifies via xdpyinfo.
        Returns the DISPLAY value (e.g. ':0') to use for all GUI commands."""
        # Try DISPLAY=:0 first (E2B Desktop XFCE4 standard)
        for display in [":0", ":1", ":99"]:
            check = self._run(
                "DISPLAY={d} xdpyinfo 2>/dev/null | head -1 || "
                "DISPLAY={d} xdotool getdisplaygeometry 2>/dev/null".format(d=display),
                timeout=5
            )
            if check["stdout"].strip():
                logger.info("[Browser] Active display detected: %s", display)
                return display
        # Fallback: read DISPLAY env var from sandbox
        env_check = self._run("echo $DISPLAY", timeout=3)
        env_display = env_check.get("stdout", "").strip()
        if env_display:
            logger.info("[Browser] Using DISPLAY from sandbox env: %s", env_display)
            return env_display
        logger.warning("[Browser] Could not detect display, defaulting to :0")
        return ":0"

    def _ensure_chrome_open(self) -> bool:
        """Ensure Chrome/Chromium is running in the E2B Desktop sandbox with remote debugging,
        visible on the VNC desktop. Detects active DISPLAY, then launches browser on it."""
        # Detect the correct DISPLAY for the VNC desktop (E2B Desktop XFCE4 uses :0)
        display = self._detect_display()

        # Use pgrep for reliable Chrome detection (avoids xdotool classname regex issues)
        check = self._run(
            "pgrep -x -E 'chrome|chromium|chromium-browser|google-chrome' 2>/dev/null || "
            "DISPLAY={d} xdotool search --classname 'google-chrome' 2>/dev/null | head -1 || "
            "DISPLAY={d} xdotool search --classname 'chromium' 2>/dev/null | head -1".format(d=display),
            timeout=5
        )
        if check["stdout"].strip():
            logger.info("[Browser] Chrome already running on display %s", display)
            return True

        # Try using E2B Desktop SDK launch() method directly (most reliable)
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        cdp_flag = "--remote-debugging-port={}".format(self._CDP_PORT)
        if sb is not None:
            for browser_app in ["google-chrome", "chromium", "chromium-browser"]:
                try:
                    sb.launch(browser_app, "about:blank")
                    time.sleep(2)
                    # Restart with CDP flag + explicit DISPLAY so browser is visible on VNC desktop
                    self._run(
                        "pkill -f 'remote-debugging-port' 2>/dev/null; sleep 0.5; "
                        "DISPLAY={d} nohup {b} --no-sandbox --disable-dev-shm-usage "
                        "{f} about:blank >/dev/null 2>&1 &".format(d=display, b=browser_app, f=cdp_flag),
                        timeout=10
                    )
                    logger.info("[Browser] Launched %s on display %s via SDK, waiting for CDP", browser_app, display)
                    # Wait for CDP port — same guard applied to shell fallback path
                    if self._wait_for_cdp_ready(max_retries=10, interval=3):
                        return True
                    logger.warning("[Browser] SDK-launched %s: CDP port not ready", browser_app)
                except Exception:
                    continue

        # Shell fallback — explicitly set DISPLAY so browser is visible on VNC desktop (not headless)
        cdp_flag = "--remote-debugging-port={}".format(self._CDP_PORT)
        for browser in ["google-chrome", "chromium", "chromium-browser"]:
            res = self._run(
                "DISPLAY={d} nohup {b} --no-sandbox --disable-dev-shm-usage "
                "{f} about:blank >/dev/null 2>&1 &".format(d=display, b=browser, f=cdp_flag),
                timeout=5
            )
            if res["exit_code"] == 0:
                logger.info("[Browser] Launched %s on display %s via shell", browser, display)
                # Wait for CDP port to become ready (retry loop)
                if self._wait_for_cdp_ready(max_retries=10, interval=3):
                    return True
                logger.warning("[Browser] %s launched but CDP port not ready", browser)
                continue
        logger.error("[Browser] All Chrome launch attempts failed for display %s", display)
        return False

    def _cdp_get_element_rect(self, index: int) -> Optional[dict]:
        """Use CDP to get bounding rect of the Nth interactive element (0-indexed).

        Selector matches the same elements as _PAGE_EXTRACT_SCRIPT:
        a, button, input, select, textarea — in DOM order.
        Returns {"x": float, "y": float, "width": float, "height": float} or None.
        """
        js = (
            "(function() {"
            "  var els = document.querySelectorAll('a,button,input,select,textarea');"
            "  if ({idx} >= els.length) return null;"
            "  var r = els[{idx}].getBoundingClientRect();"
            "  return {{x: r.left + r.width/2, y: r.top + r.height/2, "
            "           width: r.width, height: r.height}};"
            "})()"
        ).format(idx=int(index))
        result = self._cdp_evaluate(js)
        if result is None:
            return None
        if isinstance(result, dict) and "x" in result:
            return result
        return None

    def _cdp_evaluate(self, expression: str) -> Any:
        """Evaluate JavaScript in the active Chrome tab via CDP WebSocket.

        Strategy:
        1. Discover active tab via CDP HTTP REST GET /json (no WS needed for discovery).
        2. Connect to the tab's webSocketDebuggerUrl using a minimal RFC-6455 WS client
           embedded in a sandbox Python script (avoids shell quoting issues).
        3. Send Runtime.evaluate and parse the JSON response.

        Returns the evaluated result value (Python object) or None on failure.
        """
        # Step 1: Get list of tabs from CDP /json endpoint (HTTP REST, no WS)
        list_result = self._run(
            "curl -s --max-time 3 http://localhost:{}/json 2>/dev/null".format(self._CDP_PORT),
            timeout=8
        )
        if list_result["exit_code"] != 0 or not list_result["stdout"].strip():
            return None
        try:
            tabs = json.loads(list_result["stdout"])
        except Exception:
            return None
        page_tab = None
        for tab in tabs:
            if isinstance(tab, dict) and tab.get("type") == "page":
                page_tab = tab
                break
        if page_tab is None:
            return None
        ws_url = page_tab.get("webSocketDebuggerUrl", "")
        if not ws_url:
            return None

        # Step 2: Write expression to a sandbox file to avoid all shell quoting issues.
        # Step 3: Run a self-contained Python WS client in the sandbox that reads the
        # expression from the file and evaluates it via Runtime.evaluate over CDP WS.
        eval_script = textwrap.dedent(r"""
import sys, json, socket, base64, struct, urllib.parse as up

ws_url = sys.argv[1]
expression = open('/tmp/_dzeck_cdp_expr.js').read()

def ws_connect(url):
    parsed = up.urlparse(url)
    host = parsed.hostname or 'localhost'
    port = parsed.port or 9222
    path = parsed.path or '/'
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(8)
    s.connect((host, port))
    key = base64.b64encode(b'dzeckbrowser0001').decode()
    req = (
        'GET {} HTTP/1.1\r\n'
        'Host: {}:{}\r\n'
        'Upgrade: websocket\r\n'
        'Connection: Upgrade\r\n'
        'Sec-WebSocket-Key: {}\r\n'
        'Sec-WebSocket-Version: 13\r\n\r\n'
    ).format(path, host, port, key)
    s.sendall(req.encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
        chunk = s.recv(1024)
        if not chunk:
            break
        resp += chunk
    if b'101' not in resp:
        raise RuntimeError('WS upgrade failed: ' + resp[:200].decode('utf-8', errors='replace'))
    return s

def ws_send(s, msg):
    data = msg.encode('utf-8')
    n = len(data)
    hdr = bytearray([0x81, 0x80 | (n if n < 126 else 126)])
    if n >= 126:
        hdr += struct.pack('!H', n)
    hdr += b'\x00\x00\x00\x00'
    s.sendall(bytes(hdr) + data)

def ws_recv(s):
    raw = b''
    s.settimeout(8)
    while True:
        chunk = s.recv(8192)
        if not chunk:
            break
        raw += chunk
        if len(raw) < 2:
            continue
        fin_op = raw[0]
        payload_len = raw[1] & 0x7F
        hdr_len = 2
        if payload_len == 126:
            if len(raw) < 4:
                continue
            payload_len = struct.unpack('!H', raw[2:4])[0]
            hdr_len = 4
        elif payload_len == 127:
            if len(raw) < 10:
                continue
            payload_len = struct.unpack('!Q', raw[2:10])[0]
            hdr_len = 10
        if len(raw) >= hdr_len + payload_len:
            return raw[hdr_len:hdr_len + payload_len].decode('utf-8', errors='replace')

REQ_ID = 42

try:
    s = ws_connect(ws_url)
    payload = json.dumps({'id': REQ_ID, 'method': 'Runtime.evaluate',
                          'params': {'expression': expression, 'returnByValue': True}})
    ws_send(s, payload)
    # Read frames until we find the response matching our request id.
    # This skips unsolicited CDP event frames (e.g. Page.loadEventFired) that Chrome
    # may push before our Runtime.evaluate response arrives.
    for _ in range(20):
        resp_text = ws_recv(s)
        if resp_text is None:
            break
        try:
            msg = json.loads(resp_text)
        except Exception:
            continue
        if msg.get('id') == REQ_ID:
            s.close()
            result = msg.get('result', {}).get('result', {})
            val = result.get('value')
            print(json.dumps({'ok': True, 'value': val}))
            import sys; sys.exit(0)
    s.close()
    print(json.dumps({'ok': False, 'error': 'response id not matched after 20 frames'}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
""")
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is None:
            return None
        try:
            sb.files.write("/tmp/_dzeck_cdp_eval.py", eval_script)
            sb.files.write("/tmp/_dzeck_cdp_expr.js", expression)
            res = self._run(
                "python3 /tmp/_dzeck_cdp_eval.py '{}'".format(ws_url),
                timeout=14,
            )
            if res["exit_code"] != 0 or not res["stdout"].strip():
                return None
            out = json.loads(res["stdout"].strip())
            if out.get("ok"):
                return out.get("value")
        except Exception:
            pass
        return None

    def _navigate_via_xdotool(self, url: str) -> bool:
        """Navigate Chrome to URL. Tries E2B SDK open(), then xdotool address bar, then xdg-open."""
        safe_url = url.replace("'", "")

        # Strategy 1: Use E2B SDK's open() method (most direct — navigates existing browser)
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is not None:
            try:
                sb.open(safe_url)
                time.sleep(1)
                return True
            except Exception as sdk_err:
                logger.debug("[Browser] SDK open() failed: %s, falling back to xdotool", sdk_err)

        # Strategy 2: xdotool address bar (Ctrl+L + type URL)
        # Detect the active display first for reliable VNC desktop interaction
        display = self._detect_display()
        # Focus Chrome window first
        chrome_focus_cmd = (
            "DISPLAY={d} wmctrl -a 'Google Chrome' 2>/dev/null || "
            "DISPLAY={d} wmctrl -a 'Chromium' 2>/dev/null || true".format(d=display)
        )
        self._run(chrome_focus_cmd, timeout=5)
        time.sleep(0.3)

        xdo_cmd = (
            "DISPLAY={d} xdotool key --clearmodifiers ctrl+l && "
            "sleep 0.3 && "
            "DISPLAY={d} xdotool type --clearmodifiers '{u}' && "
            "sleep 0.1 && "
            "DISPLAY={d} xdotool key Return".format(d=display, u=safe_url)
        )
        res2 = self._run(xdo_cmd, timeout=10)
        if res2["exit_code"] == 0:
            return True

        # Strategy 3: xdg-open as last resort
        res3 = self._run("DISPLAY={d} xdg-open '{u}' 2>/dev/null &".format(d=display, u=safe_url), timeout=5)
        return True  # xdg-open always returns 0 even when successful

    def _ensure_page_deps(self) -> None:
        """Preflight: ensure lxml and beautifulsoup4 are installed in sandbox (idempotent).
        Uses _page_deps_ok flag (separate from _gui_deps_ok for GUI automation tools).
        Only marks deps as installed after confirming a successful import check.
        """
        if self._page_deps_ok:
            return
        # First check: already importable?
        check = self._run("python3 -c 'import bs4, lxml' 2>/dev/null && echo OK", timeout=10)
        if "OK" in check.get("stdout", ""):
            self._page_deps_ok = True
            logger.info("[Browser] Page deps already available")
            return
        # Install with multiple fallback methods
        self._run(
            "pip install --quiet --break-system-packages lxml beautifulsoup4 2>/dev/null || "
            "pip3 install --quiet lxml beautifulsoup4 2>/dev/null || "
            "python3 -m pip install --quiet lxml beautifulsoup4 2>/dev/null || true",
            timeout=90
        )
        verify = self._run("python3 -c 'import bs4, lxml' 2>/dev/null && echo OK", timeout=10)
        if "OK" in verify.get("stdout", ""):
            self._page_deps_ok = True
            logger.info("[Browser] Page deps installed successfully")
        else:
            logger.warning("[Browser] Page deps install failed; will use curl fallback for content")

    def _fetch_page_content(self, url: str) -> dict:
        """Fetch and parse page content via BeautifulSoup in sandbox. Falls back to curl."""
        self._ensure_page_deps()
        safe_url = url.replace("'", "%27")

        if self._page_deps_ok and self._ensure_extract_script():
            scripts_dir = self._get_scripts_dir()
            result = self._run(
                "python3 {}/page_extract.py '{}'".format(scripts_dir, safe_url),
                timeout=25
            )
            stdout = result["stdout"].strip()
            if stdout:
                try:
                    return json.loads(stdout)
                except Exception:
                    return {"success": True, "title": "", "url": url, "content": stdout[:2000], "interactive_elements": []}

        # Fallback: curl-based content extraction (no bs4 required)
        curl_result = self._run(
            "curl -s -L --max-time 15 -A 'Mozilla/5.0' '{}' 2>/dev/null | "
            "python3 -c \""
            "import sys, re; "
            "html = sys.stdin.read(); "
            "text = re.sub(r'<[^>]+>', ' ', html); "
            "text = re.sub(r'[ \\t]+', ' ', text); "
            "text = '\\n'.join(l.strip() for l in text.splitlines() if len(l.strip()) > 20); "
            "print(text[:3000])"
            "\" 2>/dev/null".format(safe_url),
            timeout=20
        )
        content = curl_result.get("stdout", "").strip()
        return {
            "success": bool(content),
            "title": "",
            "url": url,
            "content": content[:2000] if content else "Could not fetch page content.",
            "interactive_elements": [],
        }

    def _wait_for_page_ready(self, max_wait: int = 10) -> bool:
        """Poll CDP for document.readyState === 'complete', with sleep fallback.

        Uses Chrome DevTools Protocol /json endpoint to check if Chrome is up,
        then evaluates document.readyState via a pure-socket WebSocket client
        (no external websocket-client library dependency).
        Falls back to a fixed 3-second sleep when CDP is not reachable.
        Returns True if page became ready, False if timed out.
        """
        poll_script = textwrap.dedent(f"""
import urllib.request, json, time, sys, socket, base64, struct

port = {self._CDP_PORT}
deadline = time.time() + {max_wait}

def _get_tab():
    try:
        r = urllib.request.urlopen(f'http://localhost:{{port}}/json', timeout=2)
        tabs = json.loads(r.read())
        for t in tabs:
            if isinstance(t, dict) and t.get("type") == "page":
                return t
        return tabs[0] if tabs else None
    except Exception:
        return None

def _ws_send(s, msg):
    data = msg.encode()
    length = len(data)
    header = bytearray([0x81])
    if length < 126:
        header.append(0x80 | length)
    else:
        header.append(0x80 | 126)
        header += struct.pack("!H", length)
    header += b"\\x00\\x00\\x00\\x00"
    s.sendall(bytes(header) + data)

def _ws_recv(s):
    raw = b""
    s.settimeout(4)
    try:
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            raw += chunk
            if len(raw) > 2:
                payload_len = raw[1] & 0x7F
                header_len = 2
                if payload_len == 126:
                    header_len = 4
                    payload_len = struct.unpack("!H", raw[2:4])[0]
                elif payload_len == 127:
                    header_len = 10
                    payload_len = struct.unpack("!Q", raw[2:10])[0]
                if len(raw) >= header_len + payload_len:
                    return raw[header_len:header_len + payload_len].decode("utf-8", errors="replace")
    except socket.timeout:
        pass
    return raw.decode("utf-8", errors="replace") if raw else ""

def _cdp_eval(ws_url, expr):
    try:
        import urllib.parse as up
        parsed = up.urlparse(ws_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or {self._CDP_PORT}
        path = parsed.path
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(4)
        s.connect((host, int(port)))
        key = base64.b64encode(b"dzeckbrowserkey1").decode()
        req = (
            "GET {{}} HTTP/1.1\\r\\n"
            "Host: {{}}:{{}}\\r\\n"
            "Upgrade: websocket\\r\\n"
            "Connection: Upgrade\\r\\n"
            "Sec-WebSocket-Key: {{}}\\r\\n"
            "Sec-WebSocket-Version: 13\\r\\n\\r\\n"
        ).format(path, host, port, key)
        s.sendall(req.encode())
        resp = b""
        while b"\\r\\n\\r\\n" not in resp:
            resp += s.recv(1024)
        payload = json.dumps({{"id": 1, "method": "Runtime.evaluate",
                               "params": {{"expression": expr, "returnByValue": True}}}})
        _ws_send(s, payload)
        resp_text = _ws_recv(s)
        s.close()
        resp_json = json.loads(resp_text)
        return resp_json.get("result", {{}}).get("result", {{}}).get("value")
    except Exception:
        return None

while time.time() < deadline:
    tab = _get_tab()
    if tab:
        ws_url = tab.get("webSocketDebuggerUrl", "")
        if ws_url:
            state = _cdp_eval(ws_url, "document.readyState")
            if state == "complete":
                sys.exit(0)
        elif tab.get("title", "") not in ("", "about:blank", "New Tab"):
            sys.exit(0)
    time.sleep(0.5)

sys.exit(1)
""").strip()
        try:
            res = self._run(f"python3 -c {repr(poll_script)}", timeout=max_wait + 5)
            if res.get("exit_code") == 0:
                return True
        except Exception:
            pass
        time.sleep(3)
        return False

    def _take_screenshot(self, path: str = "/tmp/dzeck_screenshot.png") -> Optional[str]:
        """Take a screenshot of the desktop, compress to JPEG for small payload, return base64."""
        display = self._detect_display()
        self._run(
            "DISPLAY={d} scrot -z '{p}' 2>/dev/null || "
            "DISPLAY={d} import -window root '{p}' 2>/dev/null || true".format(d=display, p=path),
            timeout=15
        )
        jpeg_path = path.replace(".png", "_thumb.jpg")
        # Compress: resize to 800px wide max, JPEG quality 65 — reduces ~1.5MB PNG → ~50KB JPEG
        self._run(
            "python3 -c \""
            "import sys; "
            "try:"
            "  from PIL import Image, ImageOps; import io; "
            "  img = Image.open('{0}').convert('RGB'); "
            "  w,h = img.size; "
            "  nw = min(w, 800); nh = int(h * nw / w); "
            "  img = img.resize((nw, nh), Image.LANCZOS); "
            "  img.save('{1}', 'JPEG', quality=65, optimize=True); "
            "  sys.exit(0)"
            "except Exception as e:"
            "  sys.stderr.write(str(e)); sys.exit(1)"
            "\" 2>/dev/null || "
            "convert '{0}' -resize '800x>' -quality 65 '{1}' 2>/dev/null || "
            "cp '{0}' '{1}' 2>/dev/null || true".format(path, jpeg_path),
            timeout=15
        )
        from server.agent.tools.e2b_sandbox import read_file_bytes
        import base64 as _b64
        # Try compressed JPEG first
        data = read_file_bytes(jpeg_path)
        if data and len(data) > 100:
            return "data:image/jpeg;base64," + _b64.b64encode(data).decode()
        # Fallback: raw PNG (cap at 200KB raw to avoid huge SSE lines)
        data = read_file_bytes(path)
        if data:
            if len(data) > 204800:
                # Too large — return compressed in-memory via PIL if available
                try:
                    from PIL import Image
                    import io
                    img = Image.open(io.BytesIO(data)).convert("RGB")
                    w, h = img.size
                    nw = min(w, 800); nh = int(h * nw / w)
                    img = img.resize((nw, nh), Image.LANCZOS)
                    buf = io.BytesIO()
                    img.save(buf, "JPEG", quality=65, optimize=True)
                    return "data:image/jpeg;base64," + _b64.b64encode(buf.getvalue()).decode()
                except Exception:
                    pass
                # Last resort: return first 200KB base64
                data = data[:204800]
            return "data:image/png;base64," + _b64.b64encode(data).decode()
        return None

    def navigate(self, url: str) -> ToolResult:
        """Navigate browser to URL. Opens in visible Chrome on VNC desktop."""
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)

        if not url.startswith(("http://", "https://", "ftp://")):
            url = "https://" + url

        self._ensure_extract_script()

        # Ensure Chrome is open; fail clearly if we can't open it
        chrome_ready = self._ensure_chrome_open()
        if not chrome_ready:
            return ToolResult(success=False, message="Could not open Chrome/Chromium in sandbox desktop.")

        # Navigate via xdotool/xdg-open
        nav_ok = self._navigate_via_xdotool(url)
        if not nav_ok:
            return ToolResult(success=False, message="Navigation command failed for URL: {}".format(url))

        self.current_url = url

        # Wait for page to reach document.readyState=complete via CDP (with fallback)
        self._wait_for_page_ready(max_wait=10)

        # Fetch page content via HTTP (parallel to what's shown on screen)
        page = self._fetch_page_content(url)
        if not page.get("success") and not page.get("content"):
            # Page content fetch failed but navigation may have still worked.
            # Still take a screenshot so agent always gets visual feedback.
            logger.warning("[Browser] Page content fetch failed for %s: %s", url, page.get("error", ""))
            screenshot_data = self._take_screenshot()
            fallback_data: dict = {"url": url, "title": "", "content": "", "interactive_elements": []}
            if screenshot_data:
                fallback_data["screenshot_b64"] = screenshot_data
            return ToolResult(
                success=True,
                message="Navigated to: {} (page content not available: {})".format(
                    url, page.get("error", "fetch failed")
                ),
                data=fallback_data,
            )

        elements = page.get("interactive_elements", [])
        elements_text = "\n".join(elements[:50]) if elements else ""
        title = page.get("title", "")
        content = page.get("content", "")

        # Take screenshot for visual feedback (Manus.im pattern)
        screenshot_data = self._take_screenshot()

        result_data: dict = {
            "url": url,
            "title": title,
            "content": content,
            "interactive_elements": elements,
        }
        if screenshot_data:
            result_data["screenshot_b64"] = screenshot_data

        return ToolResult(
            success=True,
            message="Navigated to: {}\nPage: {}\n\nInteractive elements:\n{}\n\n{}".format(
                url, title, elements_text, content
            ),
            data=result_data,
        )

    def view(self) -> ToolResult:
        """View current page content."""
        url = self.current_url or "about:blank"
        if url == "about:blank":
            return ToolResult(success=True, message="No page loaded yet. Use browser_navigate to go to a URL.", data={"url": url})

        page = self._fetch_page_content(url)
        elements = page.get("interactive_elements", [])
        elements_text = "\n".join(elements[:50]) if elements else ""
        self.current_url = page.get("url", url)

        return ToolResult(
            success=True,
            message="Page: {}\nURL: {}\n\nInteractive elements:\n{}\n\n{}".format(
                page.get("title", ""), self.current_url, elements_text, page.get("content", "")
            ),
            data={
                "url": self.current_url,
                "title": page.get("title", ""),
                "content": page.get("content", ""),
                "interactive_elements": elements,
            },
        )

    def _sdk_click(self, x: int, y: int) -> bool:
        """Click using E2B SDK's left_click method (preferred over xdotool)."""
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is not None:
            try:
                sb.left_click(x, y)
                return True
            except Exception as e:
                logger.debug("[Browser] SDK left_click failed at (%d,%d): %s", x, y, e)
        # Fallback to xdotool with dynamic display detection
        display = self._detect_display()
        res = self._run("DISPLAY={} xdotool mousemove {} {} click 1".format(display, x, y), timeout=10)
        return res["exit_code"] == 0

    def _cdp_js_click(self, index: int) -> bool:
        """Click element at index via CDP Runtime.evaluate JS injection.
        Uses _cdp_evaluate() — tab list is fetched via HTTP REST /json endpoint,
        then the JS expression is written to a sandbox file to avoid shell quoting
        and executed via a lightweight WS client Python script already in _cdp_evaluate.
        Returns True on success, False on failure."""
        js = (
            "(function(){{"
            "  var els = document.querySelectorAll('a,button,input,select,textarea');"
            "  if ({idx} >= els.length) return false;"
            "  els[{idx}].focus();"
            "  els[{idx}].click();"
            "  return true;"
            "}})()".format(idx=int(index))
        )
        result = self._cdp_evaluate(js)
        return result is True or result == "true" or result is True

    def _cdp_js_input(self, index: int, text: str) -> bool:
        """Set text on element at index via CDP Runtime.evaluate JS injection.
        Focuses element, sets value, dispatches input+change events.
        Text is embedded as a JSON string literal (Python json.dumps) which
        handles all escaping — no shell quoting issues.
        Returns True on success, False on failure."""
        # Embed text as a safe JSON string literal (handles \\, ", backtick, $, etc.)
        text_json = json.dumps(text)  # produces a safely quoted JS string literal
        js = (
            "(function(){{"
            "  var els = document.querySelectorAll('a,button,input,select,textarea');"
            "  if ({idx} >= els.length) return false;"
            "  var el = els[{idx}];"
            "  var txt = {txt};"
            "  el.focus();"
            "  var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')"
            "           || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value');"
            "  if (desc && desc.set) {{ desc.set.call(el, txt); }}"
            "  else {{ el.value = txt; }}"
            "  el.dispatchEvent(new Event('input', {{bubbles:true}}));"
            "  el.dispatchEvent(new Event('change', {{bubbles:true}}));"
            "  return true;"
            "}})()".format(idx=int(index), txt=text_json)
        )
        result = self._cdp_evaluate(js)
        return result is True or result == "true"

    def click(self, index: Optional[int] = None,
              coordinate_x: Optional[float] = None,
              coordinate_y: Optional[float] = None) -> ToolResult:
        """Click at coordinates or navigate to a link element by index.

        Coordinate-based clicking uses E2B SDK left_click (most reliable) with xdotool fallback.
        Index-based clicking: if the element is a link (<a href=...>), navigates to
        the href directly. For non-link elements, coordinates are required.
        """
        if coordinate_x is not None and coordinate_y is not None:
            ok = self._sdk_click(int(coordinate_x), int(coordinate_y))
            if not ok:
                return ToolResult(
                    success=False,
                    message="Click at ({}, {}) failed via SDK and xdotool.".format(coordinate_x, coordinate_y),
                )
            time.sleep(0.5)
            screenshot_data = self._take_screenshot()
            result_data: dict = {"coordinate_x": coordinate_x, "coordinate_y": coordinate_y}
            if screenshot_data:
                result_data["screenshot_b64"] = screenshot_data
            return ToolResult(
                success=True,
                message="Clicked at ({}, {}).".format(coordinate_x, coordinate_y),
                data=result_data,
            )
        elif index is not None:
            # Try CDP first: get element bounding rect via JS, then SDK click
            rect = self._cdp_get_element_rect(index)
            if rect is not None:
                cx, cy = int(rect["x"]), int(rect["y"])
                ok = self._sdk_click(cx, cy)
                if not ok:
                    return ToolResult(
                        success=False,
                        message="CDP click at ({}, {}) for element #{} failed.".format(cx, cy, index),
                    )
                time.sleep(0.5)
                screenshot_data = self._take_screenshot()
                result_data2: dict = {"index": index, "coordinate_x": cx, "coordinate_y": cy}
                if screenshot_data:
                    result_data2["screenshot_b64"] = screenshot_data
                return ToolResult(
                    success=True,
                    message="Clicked element #{} at ({}, {}).".format(index, cx, cy),
                    data=result_data2,
                )

            # CDP rect not available — try JS injection click via CDP Runtime.evaluate
            js_click_ok = self._cdp_js_click(index)
            if js_click_ok:
                time.sleep(0.5)
                screenshot_data3 = self._take_screenshot()
                result_data3: dict = {"index": index, "method": "cdp_js_click"}
                if screenshot_data3:
                    result_data3["screenshot_b64"] = screenshot_data3
                return ToolResult(
                    success=True,
                    message="Clicked element #{} via JS injection.".format(index),
                    data=result_data3,
                )

            # JS injection also failed — fall back to href navigation for links,
            # then xdotool Tab-navigation for non-link elements.
            url = self.current_url or ""
            if url and url != "about:blank":
                page = self._fetch_page_content(url)
                elements = page.get("interactive_elements", [])
                if 0 <= index < len(elements):
                    el_desc = elements[index]
                    href_match = re.search(r"-> (https?://\S+|/\S*|\.+/\S*)", el_desc)
                    if href_match:
                        href = href_match.group(1)
                        if not href.startswith("http"):
                            from urllib.parse import urljoin as _urljoin
                            href = _urljoin(url, href)
                        return self.navigate(href)
                    # Non-link element — use xdotool Tab-navigation to focus then Enter/click
                    display = self._detect_display()
                    self._run(
                        "DISPLAY={} xdotool search --onlyvisible --class Chromium windowfocus || "
                        "DISPLAY={} xdotool search --onlyvisible --class Google-chrome windowfocus || true".format(
                            display, display),
                        timeout=5,
                    )
                    for _ in range(index + 1):
                        self._run("DISPLAY={} xdotool key Tab".format(display), timeout=3)
                    # Press Enter/Space to activate the focused element
                    self._run("DISPLAY={} xdotool key Return".format(display), timeout=3)
                    time.sleep(0.5)
                    screenshot_tab = self._take_screenshot()
                    result_tab: dict = {"index": index, "method": "xdotool_tab_click"}
                    if screenshot_tab:
                        result_tab["screenshot_b64"] = screenshot_tab
                    return ToolResult(
                        success=True,
                        message="Clicked element #{} via xdotool Tab-navigation (CDP unavailable).".format(index),
                        data=result_tab,
                    )
                return ToolResult(
                    success=False,
                    message="Element index {} out of range (page has {} elements).".format(index, len(elements)),
                )
            return ToolResult(
                success=False,
                message="No page loaded. Use browser_navigate first.",
            )
        else:
            return ToolResult(success=False, message="Provide coordinate_x/coordinate_y or index to click.")

    def input_text(self, text: str, press_enter: bool = False,
                   index: Optional[int] = None,
                   coordinate_x: Optional[float] = None,
                   coordinate_y: Optional[float] = None) -> ToolResult:
        """Type text. Click element first if coordinates provided.

        Coordinate-based focusing is reliable. Index-based focusing is not supported
        (indices come from BeautifulSoup, not screen focus order); use coordinates instead.
        """
        if coordinate_x is not None and coordinate_y is not None:
            ok = self._sdk_click(int(coordinate_x), int(coordinate_y))
            if not ok:
                return ToolResult(
                    success=False,
                    message="Failed to focus element at ({}, {}).".format(coordinate_x, coordinate_y),
                )
            time.sleep(0.3)
        elif index is not None:
            # Try CDP JS injection first (most reliable — no coordinate needed)
            js_input_ok = self._cdp_js_input(index, text)
            if js_input_ok:
                if press_enter:
                    time.sleep(0.1)
                    from server.agent.tools.e2b_sandbox import get_sandbox as _gs
                    _sb2 = _gs()
                    if _sb2 is not None:
                        try:
                            _sb2.press("Return")
                        except Exception:
                            display = self._detect_display()
                            self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
                    else:
                        display = self._detect_display()
                        self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
                    time.sleep(1)
                screenshot_data_js = self._take_screenshot()
                result_js: dict = {"text": text, "url": self.current_url, "method": "cdp_js_input"}
                if screenshot_data_js:
                    result_js["screenshot_b64"] = screenshot_data_js
                return ToolResult(
                    success=True,
                    message="Typed via JS injection: {}{}".format(repr(text), " (Enter pressed)" if press_enter else ""),
                    data=result_js,
                )
            # JS injection failed — try CDP rect + SDK click to focus, then xdotool type
            rect = self._cdp_get_element_rect(index)
            if rect is not None:
                cx, cy = int(rect["x"]), int(rect["y"])
                ok = self._sdk_click(cx, cy)
                if not ok:
                    return ToolResult(
                        success=False,
                        message="Failed to focus element #{} via CDP at ({}, {}).".format(index, cx, cy),
                    )
                time.sleep(0.3)
            else:
                # Both JS injection and CDP rect failed.
                # Final fallback: use xdotool Tab-navigation to reach the Nth focusable element,
                # then type with xdotool. This is display-based and does not require CDP/WS.
                display = self._detect_display()
                # Focus the browser window first
                self._run(
                    "DISPLAY={} xdotool search --onlyvisible --class Chromium windowfocus || "
                    "DISPLAY={} xdotool search --onlyvisible --class Google-chrome windowfocus || true".format(display, display),
                    timeout=5,
                )
                # Tab forward to approximate the element position (1-indexed)
                for _ in range(index + 1):
                    self._run("DISPLAY={} xdotool key Tab".format(display), timeout=3)
                # Attempt to type; if focus landed wrong, the agent will see it in the screenshot
                safe_text = text.replace("'", "'\\''")
                type_res = self._run(
                    "DISPLAY={} xdotool type --clearmodifiers --delay 20 '{}'".format(display, safe_text),
                    timeout=15,
                )
                if type_res["exit_code"] != 0:
                    return ToolResult(
                        success=False,
                        message=(
                            "Cannot input to element #{}: JS injection and CDP unavailable; "
                            "xdotool Tab-navigation fallback also failed. "
                            "Use coordinate_x/coordinate_y to focus and type.".format(index)
                        ),
                    )
                # xdotool Tab fallback succeeded — take screenshot for visual confirmation
                time.sleep(0.3)
                screenshot_tab = self._take_screenshot()
                result_tab: dict = {"text": text, "url": self.current_url, "method": "xdotool_tab_fallback", "index": index}
                if screenshot_tab:
                    result_tab["screenshot_b64"] = screenshot_tab
                if press_enter:
                    self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
                    time.sleep(1)
                return ToolResult(
                    success=True,
                    message="Typed via xdotool Tab-navigation fallback for element #{}.".format(index),
                    data=result_tab,
                )

        # Type text using E2B SDK (most reliable) with xdotool fallback
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        typed_ok = False
        display = self._detect_display()
        if sb is not None:
            try:
                safe_text = text.replace("'", "'\\''")
                res = self._run("DISPLAY={} xdotool type --clearmodifiers --delay 20 '{}'".format(display, safe_text), timeout=15)
                typed_ok = res["exit_code"] == 0
            except Exception:
                pass
        if not typed_ok:
            safe_text = text.replace("'", "'\\''")
            res = self._run("DISPLAY={} xdotool type --clearmodifiers '{}'".format(display, safe_text), timeout=15)
            if res["exit_code"] != 0:
                return ToolResult(
                    success=False,
                    message="Typing failed: {}".format(res["stderr"]),
                )
        if press_enter:
            time.sleep(0.1)
            # Try SDK press first, then xdotool
            if sb is not None:
                try:
                    sb.press("Return")
                except Exception:
                    self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
            else:
                self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
            time.sleep(1)

        # Take screenshot for visual feedback after input (Manus.im pattern)
        screenshot_data = self._take_screenshot()
        result_data: dict = {"text": text, "url": self.current_url}
        if screenshot_data:
            result_data["screenshot_b64"] = screenshot_data

        return ToolResult(
            success=True,
            message="Typed: {}{}".format(repr(text), " (Enter pressed)" if press_enter else ""),
            data=result_data,
        )

    def move_mouse(self, coordinate_x: float, coordinate_y: float) -> ToolResult:
        """Move mouse using E2B SDK move_mouse (preferred) with xdotool fallback."""
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is not None:
            try:
                sb.move_mouse(int(coordinate_x), int(coordinate_y))
                return ToolResult(
                    success=True,
                    message="Mouse moved to ({}, {}).".format(coordinate_x, coordinate_y),
                )
            except Exception:
                pass
        display = self._detect_display()
        res = self._run("DISPLAY={} xdotool mousemove {} {}".format(display, int(coordinate_x), int(coordinate_y)), timeout=5)
        if res["exit_code"] != 0:
            return ToolResult(
                success=False,
                message="Mouse move failed: {}".format(res["stderr"]),
            )
        return ToolResult(
            success=True,
            message="Mouse moved to ({}, {}).".format(coordinate_x, coordinate_y),
        )

    def press_key(self, key: str) -> ToolResult:
        """Press keyboard key using E2B SDK press() (preferred) with xdotool fallback."""
        # Map common key names to xdotool format
        key_map = {
            "Enter": "Return", "Escape": "Escape", "Tab": "Tab",
            "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
            "Backspace": "BackSpace", "Delete": "Delete", "Home": "Home", "End": "End",
            "PageUp": "Prior", "PageDown": "Next",
        }

        # Try E2B SDK press() first (uses XDG key names compatible with the SDK)
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is not None:
            try:
                # SDK press() accepts key names like "Return", "Escape", "ctrl+l" etc.
                sdk_key = key_map.get(key, key)
                sdk_key = sdk_key.replace("Control+", "ctrl+").replace("Shift+", "shift+").replace("Alt+", "alt+")
                sb.press(sdk_key)
                return ToolResult(success=True, message="Pressed key: {}".format(key))
            except Exception:
                pass

        # Fallback to xdotool
        xdo_key = key_map.get(key, key)
        xdo_key = xdo_key.replace("Control+", "ctrl+").replace("Shift+", "shift+").replace("Alt+", "alt+")
        display = self._detect_display()
        res = self._run("DISPLAY={} xdotool key --clearmodifiers '{}'".format(display, xdo_key), timeout=5)
        if res["exit_code"] != 0:
            return ToolResult(
                success=False,
                message="Key press '{}' failed: {}".format(key, res["stderr"]),
            )
        return ToolResult(
            success=True,
            message="Pressed key: {}".format(key),
        )

    def select_option(self, index: int, option: int) -> ToolResult:
        # Select option requires the dropdown to already be in focus.
        # Since element index does not map to GUI focus order, this is coordinate-dependent.
        # We open dropdown with Alt+Down (works if correct element has focus) and arrow to option.
        display = self._detect_display()
        self._run("DISPLAY={} xdotool key alt+Down".format(display), timeout=5)
        time.sleep(0.2)
        for _ in range(int(option)):
            res = self._run("DISPLAY={} xdotool key Down".format(display), timeout=3)
            if res["exit_code"] != 0:
                break
            time.sleep(0.1)
        enter_res = self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
        return ToolResult(
            success=enter_res["exit_code"] == 0,
            message="Option {} selected from dropdown {}.".format(option, index) if enter_res["exit_code"] == 0
                    else "Select option failed: {} (ensure dropdown element is focused first)".format(enter_res["stderr"]),
            data={"dropdown_index": index, "option_index": option},
        )

    def scroll_up(self, to_top: bool = False) -> ToolResult:
        """Scroll up. Uses E2B SDK scroll() when available, xdotool fallback."""
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        display = self._detect_display()
        if to_top:
            # Jump to top via Ctrl+Home (xdotool/SDK press)
            if sb is not None:
                try:
                    sb.press("ctrl+Home")
                except Exception:
                    self._run("DISPLAY={} xdotool key ctrl+Home".format(display), timeout=5)
            else:
                self._run("DISPLAY={} xdotool key ctrl+Home".format(display), timeout=5)
        else:
            if sb is not None:
                try:
                    sb.scroll("up", 5)
                except Exception:
                    self._run("DISPLAY={} xdotool key Prior".format(display), timeout=5)
            else:
                self._run("DISPLAY={} xdotool key Prior".format(display), timeout=5)
        time.sleep(0.3)
        screenshot_data = self._take_screenshot()
        result_data: dict = {"direction": "up", "to_top": to_top, "url": self.current_url}
        if screenshot_data:
            result_data["screenshot_b64"] = screenshot_data
        return ToolResult(
            success=True,
            message="Scrolled up{}.".format(" to top" if to_top else ""),
            data=result_data,
        )

    def scroll_down(self, to_bottom: bool = False) -> ToolResult:
        """Scroll down. Uses E2B SDK scroll() when available, xdotool fallback."""
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        display = self._detect_display()
        if to_bottom:
            if sb is not None:
                try:
                    sb.press("ctrl+End")
                except Exception:
                    self._run("DISPLAY={} xdotool key ctrl+End".format(display), timeout=5)
            else:
                self._run("DISPLAY={} xdotool key ctrl+End".format(display), timeout=5)
        else:
            if sb is not None:
                try:
                    sb.scroll("down", 5)
                except Exception:
                    self._run("DISPLAY={} xdotool key Next".format(display), timeout=5)
            else:
                self._run("DISPLAY={} xdotool key Next".format(display), timeout=5)
        time.sleep(0.3)
        screenshot_data = self._take_screenshot()
        result_data2: dict = {"direction": "down", "to_bottom": to_bottom, "url": self.current_url}
        if screenshot_data:
            result_data2["screenshot_b64"] = screenshot_data
        return ToolResult(
            success=True,
            message="Scrolled down{}.".format(" to bottom" if to_bottom else ""),
            data=result_data2,
        )

    def console_exec(self, javascript: str) -> ToolResult:
        # Open Chrome DevTools console and execute JS via Ctrl+Shift+J
        display = self._detect_display()
        open_res = self._run("DISPLAY={} xdotool key ctrl+shift+j".format(display), timeout=5)
        if open_res["exit_code"] != 0:
            return ToolResult(
                success=False,
                message="Failed to open DevTools console: {}".format(open_res["stderr"]),
            )
        time.sleep(0.5)
        safe_js = javascript.replace("'", "'\\''")
        type_res = self._run("DISPLAY={} xdotool type --clearmodifiers '{}'".format(display, safe_js), timeout=10)
        if type_res["exit_code"] != 0:
            return ToolResult(
                success=False,
                message="Failed to type JavaScript: {}".format(type_res["stderr"]),
            )
        self._run("DISPLAY={} xdotool key Return".format(display), timeout=5)
        time.sleep(0.5)
        return ToolResult(
            success=True,
            message="JavaScript executed in browser console.",
            data={"javascript": javascript},
        )

    def console_view(self, max_lines: int = 100) -> ToolResult:
        logs = self.console_logs[-max_lines:] if self.console_logs else []
        text = "\n".join(logs) if logs else "(No console logs captured)"
        return ToolResult(success=True, message="Console logs:\n\n{}".format(text), data={"logs": logs})

    def save_screenshot(self, path: str) -> ToolResult:
        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is None:
            return ToolResult(success=False, message="Sandbox not available for screenshot.")

        # Take screenshot inside sandbox
        display = self._detect_display()
        res = self._run(
            "DISPLAY={d} scrot -z '{p}' 2>/dev/null || "
            "DISPLAY={d} import -window root '{p}' 2>/dev/null".format(d=display, p=path),
            timeout=15
        )
        if res["exit_code"] == 0:
            return ToolResult(
                success=True,
                message="Screenshot saved to: {}".format(path),
                data={"save_path": path, "url": self.current_url},
            )
        return ToolResult(success=False, message="Screenshot failed: {}".format(res["stderr"]))

    def restart(self, url: str = "") -> ToolResult:
        """Close and reopen Chrome at given URL."""
        display = self._detect_display()
        self._run(
            "DISPLAY={} pkill -f 'google-chrome\\|chromium' 2>/dev/null || true".format(display),
            timeout=5
        )
        time.sleep(1)
        self._script_installed = False
        if url:
            return self.navigate(url)
        return ToolResult(success=True, message="Browser restarted.", data={"url": self.current_url})

    def close(self) -> None:
        self.current_url = None

    # ── Multi-tab management ────────────────────────────────────────────────

    def _cdp_list_tabs(self) -> List[dict]:
        """Return list of CDP page tabs from Chrome remote debugging endpoint."""
        result = self._run(
            "curl -s --max-time 4 http://localhost:{}/json 2>/dev/null".format(self._CDP_PORT),
            timeout=8,
        )
        if not result["stdout"].strip():
            return []
        try:
            tabs = json.loads(result["stdout"])
            return [t for t in tabs if isinstance(t, dict) and t.get("type") == "page"]
        except Exception:
            return []

    def tab_list(self) -> ToolResult:
        """List all open browser tabs via CDP."""
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)
        tabs = self._cdp_list_tabs()
        if not tabs:
            # Fallback: report the current URL as single tab
            return ToolResult(
                success=True,
                message="CDP not available; current tab: {}".format(self.current_url or "about:blank"),
                data={"tabs": [{"index": 0, "url": self.current_url or "about:blank", "title": ""}], "count": 1},
            )
        tab_info = []
        for i, t in enumerate(tabs):
            tab_info.append({"index": i, "id": t.get("id", ""), "url": t.get("url", ""), "title": t.get("title", "")})
        summary = "\n".join("[{}] {} — {}".format(ti["index"], ti["title"], ti["url"]) for ti in tab_info)
        return ToolResult(
            success=True,
            message="Open tabs ({}):\n{}".format(len(tab_info), summary),
            data={"tabs": tab_info, "count": len(tab_info)},
        )

    def tab_new(self, url: str = "") -> ToolResult:
        """Open a new browser tab. Uses Ctrl+T, then navigates to url if given."""
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)
        display = self._detect_display()
        # Focus Chrome first
        self._run(
            "DISPLAY={d} wmctrl -a 'Google Chrome' 2>/dev/null || "
            "DISPLAY={d} wmctrl -a 'Chromium' 2>/dev/null || true".format(d=display),
            timeout=5,
        )
        time.sleep(0.2)
        res = self._run("DISPLAY={d} xdotool key --clearmodifiers ctrl+t".format(d=display), timeout=5)
        time.sleep(0.8)
        if url:
            safe_url = url.replace("'", "")
            self._run(
                "DISPLAY={d} xdotool type --clearmodifiers '{u}' && sleep 0.1 && "
                "DISPLAY={d} xdotool key Return".format(d=display, u=safe_url),
                timeout=10,
            )
            self.current_url = url
            time.sleep(1)
        screenshot_data = self._take_screenshot()
        result_data: dict = {"url": url or "about:blank"}
        if screenshot_data:
            result_data["screenshot_b64"] = screenshot_data
        return ToolResult(
            success=res["exit_code"] == 0,
            message="New tab opened{}.".format(" and navigated to: {}".format(url) if url else ""),
            data=result_data,
        )

    def tab_close(self) -> ToolResult:
        """Close the current browser tab using Ctrl+W."""
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)
        display = self._detect_display()
        self._run(
            "DISPLAY={d} wmctrl -a 'Google Chrome' 2>/dev/null || "
            "DISPLAY={d} wmctrl -a 'Chromium' 2>/dev/null || true".format(d=display),
            timeout=5,
        )
        time.sleep(0.2)
        res = self._run("DISPLAY={d} xdotool key --clearmodifiers ctrl+w".format(d=display), timeout=5)
        time.sleep(0.8)
        # Update current_url from the now-active tab (CDP reflects the tab Chrome activated after close)
        remaining = self._cdp_list_tabs()
        if remaining:
            # Chrome activates the adjacent tab automatically; read it via CDP activate endpoint
            # to find which tab is now in the foreground.  We use the first page tab as a safe proxy.
            self.current_url = remaining[0].get("url", "")
        screenshot_data = self._take_screenshot()
        result_data2: dict = {"url": self.current_url}
        if screenshot_data:
            result_data2["screenshot_b64"] = screenshot_data
        return ToolResult(
            success=res["exit_code"] == 0,
            message="Current tab closed.",
            data=result_data2,
        )

    def tab_switch(self, index: int) -> ToolResult:
        """Switch to a tab by its index. Uses CDP Target.activateTarget when possible,
        falls back to Ctrl+Tab cycling."""
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)
        tabs = self._cdp_list_tabs()
        display = self._detect_display()
        if tabs and 0 <= index < len(tabs):
            tab_id = tabs[index].get("id", "")
            if tab_id:
                # Activate via CDP REST endpoint
                activate_res = self._run(
                    "curl -s --max-time 4 -X POST "
                    "http://localhost:{port}/json/activate/{tid} 2>/dev/null".format(
                        port=self._CDP_PORT, tid=tab_id
                    ),
                    timeout=8,
                )
                if activate_res["exit_code"] == 0:
                    time.sleep(0.5)
                    self.current_url = tabs[index].get("url", self.current_url or "")
                    screenshot_data = self._take_screenshot()
                    result_data: dict = {
                        "index": index,
                        "url": self.current_url,
                        "title": tabs[index].get("title", ""),
                    }
                    if screenshot_data:
                        result_data["screenshot_b64"] = screenshot_data
                    return ToolResult(
                        success=True,
                        message="Switched to tab {} — {}".format(index, self.current_url),
                        data=result_data,
                    )
        # Fallback: Ctrl+Tab cycling from tab 0
        if index < 0:
            return ToolResult(
                success=False,
                message="Tab index must be >= 0, got {}.".format(index),
            )
        self._run(
            "DISPLAY={d} wmctrl -a 'Google Chrome' 2>/dev/null || "
            "DISPLAY={d} wmctrl -a 'Chromium' 2>/dev/null || true".format(d=display),
            timeout=5,
        )
        time.sleep(0.2)
        # Go to first tab with Ctrl+1, then Ctrl+Tab to reach index
        self._run("DISPLAY={d} xdotool key --clearmodifiers ctrl+1".format(d=display), timeout=5)
        time.sleep(0.2)
        for _ in range(max(0, index)):
            self._run("DISPLAY={d} xdotool key --clearmodifiers ctrl+Tab".format(d=display), timeout=5)
            time.sleep(0.2)
        # Update current_url from CDP after keyboard navigation
        new_tabs = self._cdp_list_tabs()
        if new_tabs:
            self.current_url = new_tabs[0].get("url", self.current_url or "")
        screenshot_data2 = self._take_screenshot()
        result_data2: dict = {"index": index, "url": self.current_url}
        if screenshot_data2:
            result_data2["screenshot_b64"] = screenshot_data2
        return ToolResult(
            success=True,
            message="Switched to tab {} via keyboard{}.".format(
                index, " — {}".format(self.current_url) if self.current_url else ""
            ),
            data=result_data2,
        )

    # ── Drag and drop ───────────────────────────────────────────────────────

    def drag(
        self,
        source_x: float,
        source_y: float,
        target_x: float,
        target_y: float,
        source_index: Optional[int] = None,
        target_index: Optional[int] = None,
    ) -> ToolResult:
        """Drag from (source_x, source_y) to (target_x, target_y).
        Uses E2B SDK drag_and_drop when available; falls back to xdotool mousedown/mousemove/mouseup.
        If source_index/target_index provided, uses CDP bounding box to resolve coordinates.
        """
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)

        sx, sy = float(source_x), float(source_y)
        tx, ty = float(target_x), float(target_y)

        if source_index is not None:
            rect = self._cdp_get_element_rect(source_index)
            if rect:
                sx, sy = rect["x"], rect["y"]
        if target_index is not None:
            rect2 = self._cdp_get_element_rect(target_index)
            if rect2:
                tx, ty = rect2["x"], rect2["y"]

        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is not None:
            try:
                sb.drag_and_drop(int(sx), int(sy), int(tx), int(ty))
                time.sleep(0.5)
                screenshot_data = self._take_screenshot()
                result_data: dict = {"source_x": sx, "source_y": sy, "target_x": tx, "target_y": ty}
                if screenshot_data:
                    result_data["screenshot_b64"] = screenshot_data
                return ToolResult(
                    success=True,
                    message="Dragged from ({}, {}) to ({}, {}).".format(int(sx), int(sy), int(tx), int(ty)),
                    data=result_data,
                )
            except Exception as e:
                logger.debug("[Browser] SDK drag_and_drop failed: %s — falling back to xdotool", e)

        # xdotool fallback
        display = self._detect_display()
        drag_cmd = (
            "DISPLAY={d} xdotool mousemove {sx} {sy} && "
            "DISPLAY={d} xdotool mousedown 1 && "
            "sleep 0.1 && "
            "DISPLAY={d} xdotool mousemove --step=10 {tx} {ty} && "
            "sleep 0.1 && "
            "DISPLAY={d} xdotool mouseup 1"
        ).format(d=display, sx=int(sx), sy=int(sy), tx=int(tx), ty=int(ty))
        res = self._run(drag_cmd, timeout=15)
        time.sleep(0.3)
        screenshot_data2 = self._take_screenshot()
        result_data2: dict = {"source_x": sx, "source_y": sy, "target_x": tx, "target_y": ty}
        if screenshot_data2:
            result_data2["screenshot_b64"] = screenshot_data2
        return ToolResult(
            success=res["exit_code"] == 0,
            message="Dragged from ({}, {}) to ({}, {}) via xdotool.".format(int(sx), int(sy), int(tx), int(ty))
            if res["exit_code"] == 0
            else "Drag failed: {}".format(res["stderr"]),
            data=result_data2,
        )

    # ── File upload ─────────────────────────────────────────────────────────

    def file_upload(self, file_path: str, index: Optional[int] = None,
                    coordinate_x: Optional[float] = None,
                    coordinate_y: Optional[float] = None) -> ToolResult:
        """Upload a file from the sandbox filesystem to a browser <input type="file"> element.
        Uses CDP DOM.setFileInputFiles via a WebSocket script run inside the sandbox.
        file_path must be an absolute path that already exists inside the E2B sandbox.
        Falls back to clicking the element at the given coordinates if CDP fails.
        """
        dep_err = self._preflight_deps()
        if dep_err:
            return ToolResult(success=False, message=dep_err)

        # Verify file exists in sandbox
        check = self._run("test -f '{}' && echo exists".format(file_path.replace("'", "")), timeout=5)
        if "exists" not in check.get("stdout", ""):
            return ToolResult(
                success=False,
                message="File not found in sandbox: {}".format(file_path),
            )

        # el_index: 0-based index among all <input type="file"> elements on the page.
        # If caller passes an interactive-element index, it is used as the file-input index.
        el_index = int(index) if index is not None else 0

        cdp_upload_script = r"""
import sys, json, socket, base64, struct, urllib.request

port = {port}
file_path = {file_path_repr}
el_index = {el_index}

def _get_tabs():
    try:
        r = urllib.request.urlopen(f'http://localhost:{{port}}/json', timeout=3)
        tabs = json.loads(r.read())
        return [t for t in tabs if isinstance(t, dict) and t.get('type') == 'page']
    except Exception:
        return []

def ws_handshake(host, port, path):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(8)
    s.connect((host, port))
    key = base64.b64encode(b"dzeckuploadkey1x").decode()
    req = (
        "GET {{}} HTTP/1.1\r\nHost: {{}}:{{}}\r\nUpgrade: websocket\r\n"
        "Connection: Upgrade\r\nSec-WebSocket-Key: {{}}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).format(path, host, port, key)
    s.sendall(req.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += s.recv(1024)
    return s

def ws_send(s, msg):
    data = msg.encode()
    ln = len(data)
    h = bytearray([0x81])
    if ln < 126:
        h.append(0x80 | ln)
    else:
        h.append(0x80 | 126)
        h += struct.pack("!H", ln)
    h += b"\x00\x00\x00\x00"
    s.sendall(bytes(h) + data)

def ws_recv(s, timeout=6):
    raw = b""
    s.settimeout(timeout)
    try:
        while True:
            chunk = s.recv(4096)
            if not chunk: break
            raw += chunk
            if len(raw) > 2:
                pl = raw[1] & 0x7F
                hl = 2
                if pl == 126:
                    hl = 4; pl = struct.unpack("!H", raw[2:4])[0]
                elif pl == 127:
                    hl = 10; pl = struct.unpack("!Q", raw[2:10])[0]
                if len(raw) >= hl + pl:
                    return raw[hl:hl+pl].decode("utf-8", errors="replace")
    except socket.timeout:
        pass
    return raw.decode("utf-8", errors="replace") if raw else ""

tabs = _get_tabs()
if not tabs:
    print(json.dumps({{"ok": False, "error": "No Chrome tabs found"}}))
    sys.exit(0)

ws_url = tabs[0].get("webSocketDebuggerUrl", "")
if not ws_url:
    print(json.dumps({{"ok": False, "error": "No WebSocket URL"}}))
    sys.exit(0)

import urllib.parse as up
parsed = up.urlparse(ws_url)
host = parsed.hostname or "localhost"
p = parsed.port or port
path = parsed.path

try:
    s = ws_handshake(host, p, path)
    # Get document node
    ws_send(s, json.dumps({{"id":1,"method":"DOM.getDocument","params":{{"depth":0}}}}))
    r = ws_recv(s)
    doc = json.loads(r)
    root_id = doc.get("result",{{}}).get("root",{{}}).get("nodeId", 0)

    # Query all file inputs
    ws_send(s, json.dumps({{"id":2,"method":"DOM.querySelectorAll",
                             "params":{{"nodeId":root_id,"selector":"input[type='file']"}}}}))
    r2 = ws_recv(s)
    qr = json.loads(r2)
    node_ids = qr.get("result",{{}}).get("nodeIds",[])
    if not node_ids:
        print(json.dumps({{"ok": False, "error": "No file input elements found on page"}}))
        s.close()
        sys.exit(0)
    target_node = node_ids[min(el_index, len(node_ids)-1)]

    # Set files on the input
    ws_send(s, json.dumps({{"id":3,"method":"DOM.setFileInputFiles",
                             "params":{{"nodeId":target_node,"files":[file_path]}}}}))
    r3 = ws_recv(s)
    res3 = json.loads(r3)
    if "error" in res3:
        print(json.dumps({{"ok": False, "error": str(res3["error"])}}))
    else:
        print(json.dumps({{"ok": True, "node_id": target_node, "file": file_path}}))
    s.close()
except Exception as e:
    print(json.dumps({{"ok": False, "error": str(e)}}))
""".format(
            port=self._CDP_PORT,
            file_path_repr=repr(file_path),
            el_index=el_index,
        )

        from server.agent.tools.e2b_sandbox import get_sandbox
        sb = get_sandbox()
        if sb is None:
            return ToolResult(success=False, message="Sandbox not available.")
        try:
            sb.files.write("/tmp/_dzeck_cdp_upload.py", cdp_upload_script)
            res = self._run("python3 /tmp/_dzeck_cdp_upload.py", timeout=20)
            if res["exit_code"] == 0 and res["stdout"].strip():
                out = json.loads(res["stdout"].strip())
                if out.get("ok"):
                    screenshot_data = self._take_screenshot()
                    result_data: dict = {"file_path": file_path, "node_id": out.get("node_id")}
                    if screenshot_data:
                        result_data["screenshot_b64"] = screenshot_data
                    return ToolResult(
                        success=True,
                        message="File uploaded: {}".format(file_path),
                        data=result_data,
                    )
                return ToolResult(success=False, message="CDP file upload failed: {}".format(out.get("error", "unknown")))
        except Exception as e:
            logger.warning("[Browser] CDP file upload failed: %s", e)

        # Fallback: click the file input element (opens system file dialog — limited in sandbox)
        if coordinate_x is not None and coordinate_y is not None:
            self._sdk_click(int(coordinate_x), int(coordinate_y))
            time.sleep(0.5)
        return ToolResult(
            success=False,
            message=(
                "CDP file upload failed. Ensure Chrome remote debugging is running on port {}. "
                "File path: {}".format(self._CDP_PORT, file_path)
            ),
        )


# --- Stub for when E2B is not available ---

class _E2BRequiredBrowserStub:
    """Stub that returns clear errors when no browser backend is available."""
    _E2B_ERR = "[Browser] E2B sandbox is not available (E2B_API_KEY not set). Browser operations require E2B sandbox."

    def navigate(self, url: str) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def view(self) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def click(self, index=None, coordinate_x=None, coordinate_y=None) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def input_text(self, text="", press_enter=False, index=None, coordinate_x=None, coordinate_y=None) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def move_mouse(self, coordinate_x=0, coordinate_y=0) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def press_key(self, key="") -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def select_option(self, index=0, option=0) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def scroll_up(self, to_top=False) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def scroll_down(self, to_bottom=False) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def console_exec(self, javascript="") -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def console_view(self, max_lines=100) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def save_screenshot(self, path="") -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def restart(self, url="") -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def tab_list(self) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def tab_new(self, url="") -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def tab_close(self) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def tab_switch(self, index=0) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def drag(self, source_x=0, source_y=0, target_x=0, target_y=0,
             source_index=None, target_index=None) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def file_upload(self, file_path="", index=None,
                    coordinate_x=None, coordinate_y=None) -> ToolResult:
        return ToolResult(success=False, message=self._E2B_ERR)

    def _take_screenshot(self) -> Optional[str]:
        return None

    def close(self) -> None:
        pass


def _is_e2b_enabled() -> bool:
    """Dynamic E2B check — always re-reads env so late-set secrets are picked up."""
    return bool(os.environ.get("E2B_API_KEY", ""))


def _make_session() -> Any:
    """Create browser session inside the unified E2B Desktop sandbox.
    The browser runs VISIBLY on the desktop - users can see it on VNC.
    All browser automation runs in the same sandbox as shell/file tools.
    """
    if _is_e2b_enabled():
        logger.info("[Browser] E2B Desktop mode -- xdotool/xdg-open will control visible Chrome.")
        return E2BDesktopBrowserSession()

    logger.error("[Browser] E2B sandbox not available (E2B_API_KEY not set). "
                 "Browser operations require E2B sandbox for security.")
    return _E2BRequiredBrowserStub()


# --- Public Tool Functions ---

def browser_navigate(url: str, **kwargs) -> ToolResult:
    """Navigate browser to specified URL."""
    return _get_browser().navigate(url)


def browser_view() -> ToolResult:
    """View content of the current browser page with interactive elements."""
    return _get_browser().view()


def browser_click(
    coordinate_x: Optional[float] = None,
    coordinate_y: Optional[float] = None,
    index: Optional[int] = None,
    button: str = "left",
) -> ToolResult:
    """Click on element in the current browser page (by index or coordinates)."""
    return _get_browser().click(
        index=int(index) if index is not None else None,
        coordinate_x=float(coordinate_x) if coordinate_x is not None else None,
        coordinate_y=float(coordinate_y) if coordinate_y is not None else None,
    )


def browser_input(
    text: str,
    press_enter: bool = False,
    coordinate_x: Optional[float] = None,
    coordinate_y: Optional[float] = None,
    index: Optional[int] = None,
) -> ToolResult:
    """Overwrite text in editable elements on the current browser page."""
    return _get_browser().input_text(
        text=text,
        press_enter=press_enter,
        index=int(index) if index is not None else None,
        coordinate_x=float(coordinate_x) if coordinate_x is not None else None,
        coordinate_y=float(coordinate_y) if coordinate_y is not None else None,
    )


def browser_move_mouse(coordinate_x: float, coordinate_y: float) -> ToolResult:
    """Move cursor to specified position on the current browser page."""
    return _get_browser().move_mouse(float(coordinate_x), float(coordinate_y))


def browser_press_key(key: str) -> ToolResult:
    """Simulate key press in the current browser page."""
    return _get_browser().press_key(key)


def browser_select_option(index: int, option: int) -> ToolResult:
    """Select specified option from dropdown list element."""
    return _get_browser().select_option(int(index), int(option))


def browser_scroll_up(to_top: Optional[bool] = None, amount: int = 3) -> ToolResult:
    """Scroll up on the current browser page."""
    return _get_browser().scroll_up(to_top=bool(to_top) if to_top is not None else False)


def browser_scroll_down(to_bottom: Optional[bool] = None, amount: int = 3) -> ToolResult:
    """Scroll down on the current browser page."""
    return _get_browser().scroll_down(to_bottom=bool(to_bottom) if to_bottom is not None else False)


def browser_console_exec(javascript: str) -> ToolResult:
    """Execute JavaScript in the browser page."""
    return _get_browser().console_exec(javascript)


def browser_console_view(max_lines: int = 100) -> ToolResult:
    """View browser console logs."""
    return _get_browser().console_view(max_lines)


def browser_save_image(path: str) -> ToolResult:
    """Save a screenshot of the current page."""
    return _get_browser().save_screenshot(path)


def browser_restart(url: str = "") -> ToolResult:
    """Restart browser and navigate to specified URL."""
    return _get_browser().restart(url)


def browser_screenshot() -> ToolResult:
    """Take a screenshot of the current browser desktop and return base64 image data.
    Use this to visually verify what is currently visible on the screen after any action."""
    session = _get_browser()
    if not hasattr(session, '_take_screenshot'):
        return ToolResult(success=False, message="Screenshot not available in this browser mode.")
    screenshot_data = session._take_screenshot()
    if screenshot_data:
        return ToolResult(
            success=True,
            message="Screenshot captured successfully.",
            data={"screenshot_b64": screenshot_data, "url": getattr(session, 'current_url', None)},
        )
    return ToolResult(success=False, message="Screenshot failed or sandbox not available.")


def browser_tab_list() -> ToolResult:
    """List all open browser tabs."""
    return _get_browser().tab_list()


def browser_tab_new(url: str = "") -> ToolResult:
    """Open a new browser tab, optionally navigating to a URL."""
    return _get_browser().tab_new(url=url)


def browser_tab_close() -> ToolResult:
    """Close the current browser tab."""
    return _get_browser().tab_close()


def browser_tab_switch(index: int) -> ToolResult:
    """Switch to a browser tab by its index (0-based)."""
    return _get_browser().tab_switch(int(index))


def browser_drag(
    source_x: float,
    source_y: float,
    target_x: float,
    target_y: float,
    source_index: Optional[int] = None,
    target_index: Optional[int] = None,
) -> ToolResult:
    """Drag from one coordinate/element to another on the current browser page."""
    return _get_browser().drag(
        source_x=float(source_x),
        source_y=float(source_y),
        target_x=float(target_x),
        target_y=float(target_y),
        source_index=int(source_index) if source_index is not None else None,
        target_index=int(target_index) if target_index is not None else None,
    )


def browser_file_upload(
    file_path: str,
    index: Optional[int] = None,
    coordinate_x: Optional[float] = None,
    coordinate_y: Optional[float] = None,
) -> ToolResult:
    """Upload a file from the sandbox filesystem to a browser file input element."""
    return _get_browser().file_upload(
        file_path=file_path,
        index=int(index) if index is not None else None,
        coordinate_x=float(coordinate_x) if coordinate_x is not None else None,
        coordinate_y=float(coordinate_y) if coordinate_y is not None else None,
    )


def image_view(path: str) -> ToolResult:
    """View an image file from the E2B sandbox filesystem."""
    try:
        import base64 as _b64
        from server.agent.tools.e2b_sandbox import read_file_bytes, _resolve_sandbox_path
        # Resolve path relative to sandbox home (handles ~/ and relative paths)
        abs_path = _resolve_sandbox_path(path)
        data = read_file_bytes(abs_path)
        if data is None or len(data) == 0:
            # Also try the original path as given (may already be absolute)
            if abs_path != path:
                data = read_file_bytes(path)
        if data is None or len(data) == 0:
            return ToolResult(success=False, message="Image not found in sandbox: {}".format(path))
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/png")
        b64 = _b64.b64encode(data).decode()
        return ToolResult(
            success=True,
            message="Image loaded from sandbox: {} ({} bytes)".format(path, len(data)),
            data={"path": path, "size": len(data), "mime": mime,
                  "image_b64": "data:{};base64,{}".format(mime, b64)},
        )
    except Exception as e:
        return ToolResult(success=False, message="Failed to view image: {}".format(e))


# --- BrowserTool class (Manus pattern) ---

class BrowserTool:
    """Browser tool class wrapping all browser functions."""

    name: str = "browser"

    def get_tools(self) -> list:
        return [
            {"type": "function", "function": {
                "name": "browser_navigate",
                "description": "Navigate browser to specified URL. Use when accessing new pages is needed.",
                "parameters": {"type": "object", "properties": {
                    "url": {"type": "string", "description": "Complete URL to visit. Must include protocol prefix."}
                }, "required": ["url"]},
            }},
            {"type": "function", "function": {
                "name": "browser_view",
                "description": "View content of the current browser page. Returns page content and interactive elements list with index numbers. Use for checking the latest state of previously opened pages.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_click",
                "description": "Click on elements in the current browser page. Use index from browser_view interactive elements list, or coordinates.",
                "parameters": {"type": "object", "properties": {
                    "index": {"type": "integer", "description": "(Optional) Index number of the element to click (from browser_view interactive elements)"},
                    "coordinate_x": {"type": "number", "description": "(Optional) X coordinate of click position"},
                    "coordinate_y": {"type": "number", "description": "(Optional) Y coordinate of click position"},
                }, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_input",
                "description": "Overwrite text in editable elements on the current browser page. Use index from browser_view or coordinates.",
                "parameters": {"type": "object", "properties": {
                    "text": {"type": "string", "description": "Complete text content to overwrite"},
                    "press_enter": {"type": "boolean", "description": "Whether to press Enter key after input"},
                    "index": {"type": "integer", "description": "(Optional) Index number of the input element"},
                    "coordinate_x": {"type": "number", "description": "(Optional) X coordinate of the element"},
                    "coordinate_y": {"type": "number", "description": "(Optional) Y coordinate of the element"},
                }, "required": ["text"]},
            }},
            {"type": "function", "function": {
                "name": "browser_move_mouse",
                "description": "Move cursor to specified position on the current browser page.",
                "parameters": {"type": "object", "properties": {
                    "coordinate_x": {"type": "number", "description": "X coordinate of target cursor position"},
                    "coordinate_y": {"type": "number", "description": "Y coordinate of target cursor position"},
                }, "required": ["coordinate_x", "coordinate_y"]},
            }},
            {"type": "function", "function": {
                "name": "browser_press_key",
                "description": "Simulate key press in the current browser page. Supports key combinations.",
                "parameters": {"type": "object", "properties": {
                    "key": {"type": "string", "description": "Key name (e.g., Enter, Tab, ArrowUp) or combination (e.g., Control+Enter)."},
                }, "required": ["key"]},
            }},
            {"type": "function", "function": {
                "name": "browser_scroll_down",
                "description": "Scroll down the current browser page by one viewport height, or to the bottom.",
                "parameters": {"type": "object", "properties": {
                    "to_bottom": {"type": "boolean", "description": "(Optional) Scroll directly to page bottom instead of one viewport."},
                }, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_scroll_up",
                "description": "Scroll up the current browser page by one viewport height, or to the top.",
                "parameters": {"type": "object", "properties": {
                    "to_top": {"type": "boolean", "description": "(Optional) Scroll directly to page top instead of one viewport."},
                }, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_select_option",
                "description": "Select specified option from dropdown list element by index.",
                "parameters": {"type": "object", "properties": {
                    "index": {"type": "integer", "description": "Index number of the dropdown element (from browser_view)"},
                    "option": {"type": "integer", "description": "Option number to select, starting from 0."},
                }, "required": ["index", "option"]},
            }},
            {"type": "function", "function": {
                "name": "browser_console_exec",
                "description": "Execute JavaScript code in browser console.",
                "parameters": {"type": "object", "properties": {
                    "javascript": {"type": "string", "description": "JavaScript code to execute."},
                }, "required": ["javascript"]},
            }},
            {"type": "function", "function": {
                "name": "browser_console_view",
                "description": "View browser console output (logs, warnings, errors).",
                "parameters": {"type": "object", "properties": {
                    "max_lines": {"type": "integer", "description": "(Optional) Maximum number of log lines to return."},
                }, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_save_image",
                "description": "Save a screenshot of the current browser page to a file.",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string", "description": "Path to save the screenshot file"},
                }, "required": ["path"]},
            }},
            {"type": "function", "function": {
                "name": "browser_restart",
                "description": "Restart browser and navigate to specified URL. Use when browser state needs to be fully reset.",
                "parameters": {"type": "object", "properties": {
                    "url": {"type": "string", "description": "Complete URL to visit after restart. Must include protocol prefix."},
                }, "required": ["url"]},
            }},
            {"type": "function", "function": {
                "name": "browser_screenshot",
                "description": "Take a screenshot of the current browser desktop and return the image. Use this to visually verify what is on screen after actions like navigate, click, scroll, or input.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_tab_list",
                "description": "List all open browser tabs with their index, title, and URL. Use before switching tabs to know the correct index.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_tab_new",
                "description": "Open a new browser tab. Optionally navigate to a URL in the new tab.",
                "parameters": {"type": "object", "properties": {
                    "url": {"type": "string", "description": "(Optional) URL to open in the new tab. Omit to open a blank tab."},
                }, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_tab_close",
                "description": "Close the currently active browser tab.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            }},
            {"type": "function", "function": {
                "name": "browser_tab_switch",
                "description": "Switch to a browser tab by its index (0-based). Use browser_tab_list first to get the correct index.",
                "parameters": {"type": "object", "properties": {
                    "index": {"type": "integer", "description": "Zero-based index of the tab to switch to (from browser_tab_list)."},
                }, "required": ["index"]},
            }},
            {"type": "function", "function": {
                "name": "browser_drag",
                "description": "Drag an element or coordinate to another position on the page. Useful for drag-and-drop interactions, sorting lists, moving sliders, etc.",
                "parameters": {"type": "object", "properties": {
                    "source_x": {"type": "number", "description": "X coordinate of the drag start position."},
                    "source_y": {"type": "number", "description": "Y coordinate of the drag start position."},
                    "target_x": {"type": "number", "description": "X coordinate of the drag end (drop) position."},
                    "target_y": {"type": "number", "description": "Y coordinate of the drag end (drop) position."},
                    "source_index": {"type": "integer", "description": "(Optional) Interactive element index to use as drag source (overrides source_x/y)."},
                    "target_index": {"type": "integer", "description": "(Optional) Interactive element index to use as drop target (overrides target_x/y)."},
                }, "required": ["source_x", "source_y", "target_x", "target_y"]},
            }},
            {"type": "function", "function": {
                "name": "browser_file_upload",
                "description": "Upload a file from the sandbox filesystem to a browser <input type='file'> element. The file must already exist inside the E2B sandbox.",
                "parameters": {"type": "object", "properties": {
                    "file_path": {"type": "string", "description": "Absolute path to the file inside the sandbox (e.g. /home/user/document.pdf)."},
                    "index": {"type": "integer", "description": "(Optional) Index of the file input element (from browser_view interactive elements)."},
                    "coordinate_x": {"type": "number", "description": "(Optional) X coordinate of the file input element."},
                    "coordinate_y": {"type": "number", "description": "(Optional) Y coordinate of the file input element."},
                }, "required": ["file_path"]},
            }},
        ]
