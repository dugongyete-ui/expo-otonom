"""
Unit tests for server/agent/tools/e2b_sandbox.py.

All tests use mocks — no real E2B API key required.
"""
import os
import sys
import types
import importlib
from unittest.mock import MagicMock, patch, PropertyMock
import pytest


# ---------------------------------------------------------------------------
# Helpers to build a realistic CommandResult mock
# ---------------------------------------------------------------------------

def _make_result(stdout="", stderr="", exit_code=0):
    r = MagicMock()
    r.stdout = stdout
    r.stderr = stderr
    r.exit_code = exit_code
    return r


def _make_sandbox(sandbox_id="sbx-test-1234"):
    """Return a mock Sandbox instance with the e2b_desktop API surface."""
    sb = MagicMock()
    sb.sandbox_id = sandbox_id

    # commands.run returns a successful result by default
    sb.commands.run.return_value = _make_result(stdout="alive", exit_code=0)

    # stream
    sb.stream.start.return_value = None
    sb.stream.get_url.return_value = (
        f"https://6080-{sandbox_id}.e2b.app/vnc.html?autoconnect=true&resize=scale"
    )

    # files
    sb.files.write.return_value = None
    sb.files.read.return_value = "file content"

    return sb


# ---------------------------------------------------------------------------
# Fixture: reset module-level globals before each test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_globals():
    """Reload e2b_sandbox module globals before each test to avoid state leakage."""
    import importlib
    import server.agent.tools.e2b_sandbox as mod
    mod._sandbox = None
    mod._detected_home = None
    mod._vnc_stream_url = None
    mod._sandbox_create_attempts = 0
    mod._configs_pushed_sandboxes = set()
    mod._file_cache.clear()
    # Remove DZECK_E2B_SANDBOX_ID so tests don't accidentally pick it up
    os.environ.pop("DZECK_E2B_SANDBOX_ID", None)
    os.environ.pop("DZECK_VNC_STREAM_URL", None)
    yield
    # Cleanup after test
    mod._sandbox = None
    mod._detected_home = None
    mod._vnc_stream_url = None
    mod._file_cache.clear()
    os.environ.pop("DZECK_E2B_SANDBOX_ID", None)
    os.environ.pop("DZECK_VNC_STREAM_URL", None)


# ---------------------------------------------------------------------------
# 1. _is_sandbox_alive
# ---------------------------------------------------------------------------

class TestIsSandboxAlive:
    def test_alive_sandbox(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.return_value = _make_result(stdout="alive", exit_code=0)
        assert mod._is_sandbox_alive(sb) is True

    def test_non_zero_exit_code(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.return_value = _make_result(stdout="", exit_code=1)
        assert mod._is_sandbox_alive(sb) is False

    def test_exception_not_found(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.side_effect = Exception("sandbox not found 404")
        assert mod._is_sandbox_alive(sb) is False

    def test_exception_expired(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.side_effect = Exception("sandbox expired")
        assert mod._is_sandbox_alive(sb) is False

    def test_exception_network_error(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.side_effect = Exception("connection refused")
        assert mod._is_sandbox_alive(sb) is False

    def test_stdout_missing_alive_keyword(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.return_value = _make_result(stdout="something else", exit_code=0)
        assert mod._is_sandbox_alive(sb) is False


# ---------------------------------------------------------------------------
# 2. _detect_sandbox_home
# ---------------------------------------------------------------------------

class TestDetectSandboxHome:
    def test_detects_home_from_cd_pwd(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()

        def side_effect(cmd, timeout=8):
            if "cd && pwd" in cmd:
                return _make_result(stdout="/home/user", exit_code=0)
            if "expanduser" in cmd:
                return _make_result(stdout="/home/user", exit_code=0)
            if "echo $HOME" in cmd:
                return _make_result(stdout="/home/user", exit_code=0)
            if ".dzeck_probe" in cmd:
                return _make_result(stdout="ok", exit_code=0)
            if ".bashrc" in cmd:
                return _make_result(stdout="", exit_code=0)
            return _make_result(stdout="", exit_code=0)

        sb.commands.run.side_effect = side_effect
        result = mod._detect_sandbox_home(sb)
        assert result == "/home/user"
        assert mod._detected_home == "/home/user"

    def test_fallback_to_workspace_dir(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        # All strategies fail, probe fails for all candidates
        sb.commands.run.side_effect = Exception("command failed")
        result = mod._detect_sandbox_home(sb)
        assert result == mod.WORKSPACE_DIR

    def test_returns_cached_home_immediately(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._detected_home = "/cached/home"
        sb = _make_sandbox()
        result = mod._detect_sandbox_home(sb)
        assert result == "/cached/home"
        # Should not call commands.run since we use the cached value
        sb.commands.run.assert_not_called()

    def test_skips_root_path(self):
        """/ is not a valid home — must be skipped."""
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()

        def side_effect(cmd, timeout=8):
            if "cd && pwd" in cmd:
                return _make_result(stdout="/", exit_code=0)
            if ".dzeck_probe" in cmd:
                return _make_result(stdout="ok", exit_code=0)
            if ".bashrc" in cmd:
                return _make_result(stdout="", exit_code=0)
            return _make_result(stdout="", exit_code=0)

        sb.commands.run.side_effect = side_effect
        result = mod._detect_sandbox_home(sb)
        # / should be rejected; should fall through to candidates
        assert result != "/"


# ---------------------------------------------------------------------------
# 3. run_command
# ---------------------------------------------------------------------------

class TestRunCommand:
    def test_success(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        # Mock: health check returns "alive", mkdir succeeds, command returns stdout="hello"
        def cmd_side_effect(cmd, **kwargs):
            if cmd == "echo alive":
                return _make_result(stdout="alive", exit_code=0)
            if cmd.startswith("mkdir"):
                return _make_result(stdout="", exit_code=0)
            if "echo hello" in cmd:
                return _make_result(stdout="hello", stderr="", exit_code=0)
            return _make_result(stdout="", exit_code=0)

        sb.commands.run.side_effect = cmd_side_effect
        mod._sandbox = sb
        mod._detected_home = "/home/user"

        result = mod.run_command("echo hello")
        assert result["success"] is True
        assert result["stdout"] == "hello"
        assert result["stderr"] == ""
        assert result["exit_code"] == 0

    def test_nonzero_exit_code(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()

        def cmd_side_effect(cmd, **kwargs):
            if cmd == "echo alive":
                return _make_result(stdout="alive", exit_code=0)
            if cmd.startswith("mkdir"):
                return _make_result(stdout="", exit_code=0)
            return _make_result(stdout="", stderr="err", exit_code=1)

        sb.commands.run.side_effect = cmd_side_effect
        mod._sandbox = sb
        mod._detected_home = "/home/user"

        result = mod.run_command("false", workdir="/home/user")
        assert result["success"] is False
        assert result["exit_code"] == 1

    def test_no_sandbox_no_api_key(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._sandbox = None
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("E2B_API_KEY", None)
            mod.E2B_API_KEY = ""
            result = mod.run_command("echo test")
        assert result["success"] is False
        assert result["exit_code"] == -1
        assert "E2B_API_KEY" in result["stderr"]

    def test_command_exception_returns_error(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()

        def cmd_side_effect(cmd, **kwargs):
            if cmd == "echo alive":
                return _make_result(stdout="alive", exit_code=0)
            if cmd.startswith("mkdir"):
                return _make_result(stdout="", exit_code=0)
            raise Exception("network timeout")

        sb.commands.run.side_effect = cmd_side_effect
        mod._sandbox = sb
        mod._detected_home = "/home/user"

        result = mod.run_command("sleep 999")
        assert result["success"] is False
        assert "network timeout" in result["stderr"] or result["exit_code"] == -1


# ---------------------------------------------------------------------------
# 4. write_file / read_file
# ---------------------------------------------------------------------------

class TestFileOperations:
    def test_write_file_success(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()

        def cmd_side_effect(cmd, **kwargs):
            if cmd == "echo alive":
                return _make_result(stdout="alive", exit_code=0)
            if cmd.startswith("mkdir"):
                return _make_result(stdout="", exit_code=0)
            if "test -f" in cmd:
                return _make_result(stdout="EXISTS", exit_code=0)
            return _make_result(stdout="", exit_code=0)

        sb.commands.run.side_effect = cmd_side_effect
        sb.files.write.return_value = None
        mod._sandbox = sb
        mod._detected_home = "/home/user"

        ok = mod.write_file("/home/user/test.txt", "hello world")
        assert ok is True
        sb.files.write.assert_called_once()

    def test_write_file_no_sandbox(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._sandbox = None
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("E2B_API_KEY", None)
            mod.E2B_API_KEY = ""
            ok = mod.write_file("/tmp/foo.txt", "bar")
        assert ok is False

    def test_read_file_success(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.files.read.return_value = "file content here"
        mod._sandbox = sb

        content = mod.read_file("/home/user/test.txt")
        assert content == "file content here"

    def test_read_file_no_sandbox(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._sandbox = None
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("E2B_API_KEY", None)
            mod.E2B_API_KEY = ""
            content = mod.read_file("/home/user/missing.txt")
        assert content is None

    def test_write_file_appends(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.files.read.return_value = "existing "

        def cmd_side_effect(cmd, **kwargs):
            if cmd == "echo alive":
                return _make_result(stdout="alive", exit_code=0)
            if cmd.startswith("mkdir"):
                return _make_result(stdout="", exit_code=0)
            if "test -f" in cmd:
                return _make_result(stdout="EXISTS", exit_code=0)
            return _make_result(stdout="", exit_code=0)

        sb.commands.run.side_effect = cmd_side_effect
        sb.files.write.return_value = None
        mod._sandbox = sb
        mod._detected_home = "/home/user"

        ok = mod.write_file("/home/user/test.txt", "appended", append=True)
        assert ok is True
        # Verify the written content combines both strings
        call_args = sb.files.write.call_args
        written_content = call_args[0][1]
        assert "existing " in written_content
        assert "appended" in written_content


# ---------------------------------------------------------------------------
# 5. get_vnc_stream_url
# ---------------------------------------------------------------------------

class TestGetVncStreamUrl:
    def test_returns_none_when_not_set(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._vnc_stream_url = None
        assert mod.get_vnc_stream_url() is None

    def test_returns_url_when_set(self):
        import server.agent.tools.e2b_sandbox as mod
        expected = "https://6080-sbx-test.e2b.app/vnc.html?autoconnect=true"
        mod._vnc_stream_url = expected
        assert mod.get_vnc_stream_url() == expected


# ---------------------------------------------------------------------------
# 6. get_sandbox — deduplication logic
# ---------------------------------------------------------------------------

class TestGetSandbox:
    def test_returns_existing_alive_sandbox(self):
        """If _sandbox is set and alive, return it without creating a new one."""
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox()
        sb.commands.run.return_value = _make_result(stdout="alive", exit_code=0)
        mod._sandbox = sb
        mod._detected_home = "/home/user"

        result = mod.get_sandbox()
        assert result is sb

    def test_uses_dzeck_sandbox_id_env_var(self):
        """If DZECK_E2B_SANDBOX_ID is set, should try to connect to that sandbox."""
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox("sbx-from-ts")
        sb.commands.run.return_value = _make_result(stdout="alive", exit_code=0)

        os.environ["DZECK_E2B_SANDBOX_ID"] = "sbx-from-ts"
        os.environ["E2B_API_KEY"] = "test-key-xyz"

        with patch("server.agent.tools.e2b_sandbox._connect_existing_sandbox", return_value=sb) as mock_connect:
            result = mod.get_sandbox()

        mock_connect.assert_called_once_with("sbx-from-ts")
        assert result is sb

    def test_recreates_dead_sandbox(self):
        """If existing sandbox fails health check, create a new one."""
        import server.agent.tools.e2b_sandbox as mod
        dead_sb = _make_sandbox("sbx-dead")
        dead_sb.commands.run.return_value = _make_result(stdout="", exit_code=1)

        new_sb = _make_sandbox("sbx-new")
        new_sb.commands.run.return_value = _make_result(stdout="alive", exit_code=0)

        mod._sandbox = dead_sb

        with patch("server.agent.tools.e2b_sandbox._create_sandbox", return_value=new_sb):
            result = mod.get_sandbox()

        assert result is new_sb


# ---------------------------------------------------------------------------
# 7. _create_sandbox — VNC stream setup
# ---------------------------------------------------------------------------

class TestCreateSandbox:
    def test_sandbox_create_sets_vnc_url(self):
        """_create_sandbox() should start VNC stream and set _vnc_stream_url."""
        import server.agent.tools.e2b_sandbox as mod

        sb = _make_sandbox("sbx-new-1")
        sb.stream.get_url.return_value = "https://6080-sbx-new-1.e2b.app/vnc.html"
        # Make all commands succeed
        sb.commands.run.return_value = _make_result(stdout="ok", exit_code=0)

        os.environ["E2B_API_KEY"] = "test-api-key"

        with patch("e2b_desktop.Sandbox.create", return_value=sb):
            with patch("threading.Thread"):
                with patch("time.sleep"):
                    with patch("server.agent.tools.e2b_sandbox._detect_sandbox_home",
                               return_value="/home/user"):
                        result = mod._create_sandbox()

        assert result is sb
        assert mod._vnc_stream_url is not None
        assert "sbx-new-1" in mod._vnc_stream_url or mod._vnc_stream_url.startswith("https://")

    def test_sandbox_create_returns_none_without_api_key(self):
        """Without E2B_API_KEY, _create_sandbox() must return None."""
        import server.agent.tools.e2b_sandbox as mod
        os.environ.pop("E2B_API_KEY", None)
        # Also clear the module-level cached key
        mod.E2B_API_KEY = ""

        result = mod._create_sandbox()
        assert result is None

    def test_sandbox_create_retries_on_failure(self):
        """_create_sandbox() should retry up to _MAX_CREATE_ATTEMPTS times."""
        import server.agent.tools.e2b_sandbox as mod
        os.environ["E2B_API_KEY"] = "test-api-key"

        with patch("e2b_desktop.Sandbox.create", side_effect=Exception("API error")) as mock_create:
            with patch("time.sleep"):
                result = mod._create_sandbox()

        assert result is None
        assert mock_create.call_count == mod._MAX_CREATE_ATTEMPTS


# ---------------------------------------------------------------------------
# 8. file cache operations
# ---------------------------------------------------------------------------

class TestFileCache:
    def test_cache_file_stores_content(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._cache_file("/tmp/myfile.txt", "hello")
        assert mod._file_cache.get("/tmp/myfile.txt") == "hello"

    def test_clear_file_cache(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._cache_file("/tmp/a.txt", "content_a")
        mod._cache_file("/tmp/b.txt", "content_b")
        assert len(mod._file_cache) == 2
        mod.clear_file_cache()
        assert len(mod._file_cache) == 0

    def test_replay_file_cache(self):
        """_replay_file_cache should write all cached files to the sandbox."""
        import server.agent.tools.e2b_sandbox as mod
        mod._cache_file("/home/user/cached.py", "print('hi')")

        sb = _make_sandbox()
        sb.commands.run.return_value = _make_result(stdout="", exit_code=0)
        sb.files.write.return_value = None

        mod._replay_file_cache(sb)
        sb.files.write.assert_called_once_with("/home/user/cached.py", "print('hi')")


# ---------------------------------------------------------------------------
# 9. VNC URL — stream.start / stream.get_url parameter names
# ---------------------------------------------------------------------------

class TestVncStreamParameters:
    """Verify that the correct snake_case parameter names are used for the Python SDK."""

    def test_stream_start_uses_require_auth(self):
        """stream.start() must be called with require_auth (not requireAuth)."""
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox("sbx-vnc-test")
        sb.commands.run.return_value = _make_result(stdout="ok", exit_code=0)
        os.environ["E2B_API_KEY"] = "test-key"

        with patch("e2b_desktop.Sandbox.create", return_value=sb):
            with patch("threading.Thread"):
                with patch("time.sleep"):
                    with patch("server.agent.tools.e2b_sandbox._detect_sandbox_home",
                               return_value="/home/user"):
                        mod._create_sandbox()

        sb.stream.start.assert_called_with(require_auth=False)

    def test_stream_get_url_uses_auto_connect(self):
        """stream.get_url() must be called with auto_connect/view_only/resize (snake_case)."""
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox("sbx-url-test")
        sb.commands.run.return_value = _make_result(stdout="ok", exit_code=0)
        os.environ["E2B_API_KEY"] = "test-key"

        with patch("e2b_desktop.Sandbox.create", return_value=sb):
            with patch("threading.Thread"):
                with patch("time.sleep"):
                    with patch("server.agent.tools.e2b_sandbox._detect_sandbox_home",
                               return_value="/home/user"):
                        mod._create_sandbox()

        sb.stream.get_url.assert_called_with(
            auto_connect=True,
            view_only=False,
            resize="scale",
        )


# ---------------------------------------------------------------------------
# 10. _connect_existing_sandbox
# ---------------------------------------------------------------------------

class TestConnectExistingSandbox:
    def test_returns_none_without_api_key(self):
        import server.agent.tools.e2b_sandbox as mod
        os.environ.pop("E2B_API_KEY", None)
        mod.E2B_API_KEY = ""
        result = mod._connect_existing_sandbox("sbx-xyz")
        assert result is None

    def test_successful_connect(self):
        import server.agent.tools.e2b_sandbox as mod
        sb = _make_sandbox("sbx-existing")
        sb.commands.run.return_value = _make_result(stdout="ok", exit_code=0)
        os.environ["E2B_API_KEY"] = "test-key"

        with patch("e2b_desktop.Sandbox.connect", return_value=sb):
            with patch("threading.Thread"):
                result = mod._connect_existing_sandbox("sbx-existing")

        assert result is sb

    def test_retries_on_failure_then_returns_none(self):
        import server.agent.tools.e2b_sandbox as mod
        os.environ["E2B_API_KEY"] = "test-key"

        with patch("e2b_desktop.Sandbox.connect", side_effect=Exception("connect failed")):
            with patch("time.sleep"):
                result = mod._connect_existing_sandbox("sbx-bad", max_retries=2)

        assert result is None


# ---------------------------------------------------------------------------
# 11. get_session_workspace
# ---------------------------------------------------------------------------

class TestGetSessionWorkspace:
    def test_returns_base_when_no_session_id(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._detected_home = "/home/user"
        os.environ.pop("DZECK_SESSION_ID", None)
        result = mod.get_session_workspace()
        assert result == "/home/user"

    def test_returns_sub_dir_with_session_id(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._detected_home = "/home/user"
        os.environ["DZECK_SESSION_ID"] = "abc123"
        result = mod.get_session_workspace()
        assert "abc123" in result
        assert result.startswith("/home/user")
        os.environ.pop("DZECK_SESSION_ID", None)

    def test_sanitizes_session_id(self):
        import server.agent.tools.e2b_sandbox as mod
        mod._detected_home = "/home/user"
        os.environ["DZECK_SESSION_ID"] = "../../../etc/passwd"
        result = mod.get_session_workspace()
        # Path traversal sequences (.., /) must be stripped
        assert ".." not in result
        # The result must stay under the home dir (no escape via ..)
        assert result.startswith("/home/user")
        os.environ.pop("DZECK_SESSION_ID", None)
