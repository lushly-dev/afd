"""Tests for the permission gate."""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar

import pytest
from copilot.generated.session_events import (
    PermissionRequestCustomTool,
    PermissionRequestMcp,
    PermissionRequestRead,
    PermissionRequestShell,
    PermissionRequestShellCommand,
    PermissionRequestShellCommandSegment,
    PermissionRequestUrl,
    PermissionRequestWrite,
)

import botcore_llm.permissions as permissions_mod
from botcore_llm.config import LlmPermissionsConfig
from botcore_llm.permissions import (
    _matches_shell_allowlist,
    _path_allowed,
    check_shell_command,
    create_permission_handler,
)


@dataclass
class _UnknownRequest:
    kind: ClassVar[str] = "something-new"


def _runtime_commands(command: str) -> list[PermissionRequestShellCommand]:
    """What the runtime reports for a simple command: one identifier, its program."""
    try:
        argv = shlex.split(command)
    except ValueError:
        return []
    return [PermissionRequestShellCommand(identifier=argv[0], read_only=False)] if argv else []


def _make_request(
    kind: str,
    *,
    command: str = "",
    path: str = "",
    server: str = "srv",
    commands: list | None = None,
    redirection: bool = False,
    segments: list | None = None,
) -> Any:
    """Build the SDK permission request dataclass for *kind*, parsed as the runtime would."""
    if kind == "shell":
        return PermissionRequestShell(
            can_offer_session_approval=False,
            commands=_runtime_commands(command) if commands is None else commands,
            full_command_text=command,
            has_write_file_redirection=redirection,
            intention="test",
            possible_paths=[],
            possible_urls=[],
            command_segments=segments,
        )
    if kind == "read":
        return PermissionRequestRead(intention="test", path=path)
    if kind == "write":
        return PermissionRequestWrite(
            can_offer_session_approval=False, diff="", file_name=path, intention="test"
        )
    if kind == "mcp":
        return PermissionRequestMcp(
            read_only=True, server_name=server, tool_name="t", tool_title="T"
        )
    if kind == "custom-tool":
        return PermissionRequestCustomTool(tool_description="d", tool_name="t")
    if kind == "url":
        return PermissionRequestUrl(intention="test", url="https://example.com")
    return _UnknownRequest()


INV_CTX = {"session_id": "s1"}


@pytest.fixture(autouse=True)
def _posix_shell(monkeypatch):
    """Judge commands as a POSIX runtime would, whatever platform runs the tests."""
    monkeypatch.setattr(permissions_mod, "_shell_kind", lambda: "posix", raising=False)


class TestPermissionDefaults:
    """Default config: shell=False, filesystem=False, mcp=True, custom_tools=True."""

    def setup_method(self):
        config = LlmPermissionsConfig()
        self.handler = create_permission_handler(config)

    def test_shell_denied(self):
        result = self.handler(_make_request("shell"), INV_CTX)
        assert result.kind == "reject"

    def test_write_denied(self):
        result = self.handler(_make_request("write"), INV_CTX)
        assert result.kind == "reject"

    def test_read_denied(self):
        result = self.handler(_make_request("read"), INV_CTX)
        assert result.kind == "reject"

    def test_mcp_refused_without_named_servers(self):
        result = self.handler(_make_request("mcp"), INV_CTX)
        assert result.kind == "reject"
        assert "mcp_servers" in result.feedback

    def test_custom_tool_allowed(self):
        result = self.handler(_make_request("custom-tool"), INV_CTX)
        assert result.kind == "approve-once"

    def test_url_denied(self):
        result = self.handler(_make_request("url"), INV_CTX)
        assert result.kind == "reject"

    def test_unknown_kind_denied(self):
        result = self.handler(_make_request("something-new"), INV_CTX)
        assert result.kind == "reject"


class TestPermissionOverrides:
    def test_allow_shell(self):
        config = LlmPermissionsConfig(allow_shell=True)
        handler = create_permission_handler(config)
        result = handler(_make_request("shell"), INV_CTX)
        assert result.kind == "approve-once"

    def test_allow_filesystem(self):
        config = LlmPermissionsConfig(allow_filesystem=True)
        handler = create_permission_handler(config)

        assert handler(_make_request("read"), INV_CTX).kind == "approve-once"
        assert handler(_make_request("write"), INV_CTX).kind == "approve-once"

    def test_mcp_allowed_only_for_named_servers(self):
        config = LlmPermissionsConfig(mcp_servers=["github"])
        handler = create_permission_handler(config)
        assert handler(_make_request("mcp", server="github"), INV_CTX).kind == "approve-once"
        assert handler(_make_request("mcp", server="extra"), INV_CTX).kind == "reject"

    def test_named_servers_still_need_allow_mcp(self):
        config = LlmPermissionsConfig(allow_mcp=False, mcp_servers=["github"])
        handler = create_permission_handler(config)
        assert handler(_make_request("mcp", server="github"), INV_CTX).kind == "reject"

    def test_deny_mcp(self):
        config = LlmPermissionsConfig(allow_mcp=False)
        handler = create_permission_handler(config)
        result = handler(_make_request("mcp"), INV_CTX)
        assert result.kind == "reject"

    def test_deny_custom_tools(self):
        config = LlmPermissionsConfig(allow_custom_tools=False)
        handler = create_permission_handler(config)
        result = handler(_make_request("custom-tool"), INV_CTX)
        assert result.kind == "reject"


# ---------------------------------------------------------------------------
# AgentPermissionsConfig model tests
# ---------------------------------------------------------------------------


class TestAgentPermissionsConfig:
    """AgentPermissionsConfig inherits LlmPermissionsConfig and adds allowlists."""

    def test_inherits_llm_permissions(self):
        from botcore_agents.config import AgentPermissionsConfig

        assert issubclass(AgentPermissionsConfig, LlmPermissionsConfig)

    def test_defaults(self):
        from botcore_agents.config import AgentPermissionsConfig

        cfg = AgentPermissionsConfig()
        assert cfg.allow_shell is False
        assert cfg.allow_filesystem is False
        assert cfg.allow_mcp is True
        assert cfg.allow_custom_tools is True
        assert cfg.shell_allowlist is None
        assert cfg.filesystem_paths is None

    def test_custom_allowlists(self):
        from botcore_agents.config import AgentPermissionsConfig

        cfg = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["git *", "pytest *"],
            allow_filesystem=True,
            filesystem_paths=["./src"],
        )
        assert cfg.shell_allowlist == ["git *", "pytest *"]
        assert cfg.filesystem_paths == ["./src"]


# ---------------------------------------------------------------------------
# Shell allowlist tests
# ---------------------------------------------------------------------------


class TestShellAllowlist:
    def test_simple_match(self):
        assert _matches_shell_allowlist("git status", ["git *"])

    def test_simple_no_match(self):
        assert not _matches_shell_allowlist("rm -rf /", ["git *"])

    def test_multiple_patterns(self):
        allowlist = ["git *", "pytest *", "ruff *"]
        assert _matches_shell_allowlist("pytest tests/", allowlist)
        assert _matches_shell_allowlist("ruff check .", allowlist)
        assert not _matches_shell_allowlist("curl http://evil", allowlist)

    def test_command_lists_and_pipelines_refused_even_when_every_stage_matches(self):
        for cmd in [
            "git status && git diff",
            "git status || git diff",
            "git status; git diff",
            "git log | git show",
        ]:
            assert not _matches_shell_allowlist(cmd, ["git *"]), cmd

    def test_quoted_arguments_allowed(self):
        allowlist = ["git *"]
        for cmd in [
            'git commit -m "fix: parse a; b && c | d > e"',
            "git commit -m 'feat(scope): $(not run) `nor this`'",
            'git log --grep "a (b)" --format=%H',
            "git show HEAD~1",
        ]:
            assert _matches_shell_allowlist(cmd, allowlist), cmd

    def test_program_name_must_match_exactly(self):
        for cmd in ["/usr/bin/git status", "gitx status", "GIT_DIR=/x git status", "./git log"]:
            assert not _matches_shell_allowlist(cmd, ["git *"]), cmd

    def test_unquoted_expansions_refused(self):
        for cmd in [
            "git add *.py",
            "git log ~/x",
            "git log --output=~/x",
            "git status \\; whoami",
            "git status #comment",
            'git commit -m "$(whoami)"',
            'git commit -m "`whoami`"',
            'git commit -m "a\\"; whoami; \\""',
            "git commit -m ‘a’; whoami",
            "git commit -m 'unterminated",
        ]:
            assert not _matches_shell_allowlist(cmd, ["git *"]), cmd

    def test_operator_one_segment_fails(self):
        assert not _matches_shell_allowlist("git status && rm -rf /", ["git *"])

    def test_pipe_operator(self):
        assert not _matches_shell_allowlist("git log | grep secret", ["git *"])

    def test_semicolon_operator(self):
        assert not _matches_shell_allowlist("git status; rm -rf /", ["git *"])

    def test_or_operator(self):
        assert not _matches_shell_allowlist("git status || rm -rf /", ["git *"])

    def test_empty_command(self):
        assert not _matches_shell_allowlist("", ["git *"])

    def test_whitespace_only_command(self):
        assert not _matches_shell_allowlist("   ", ["git *"])

    def test_backtick_injection_denied(self):
        assert not _matches_shell_allowlist("git `rm -rf /`", ["git *"])

    def test_subshell_injection_denied(self):
        assert not _matches_shell_allowlist("git $(rm -rf /)", ["git *"])

    def test_exact_match_pattern(self):
        assert _matches_shell_allowlist("ls", ["ls"])
        assert not _matches_shell_allowlist("ls -la", ["ls"])

    def test_vacuous_and_empty_segments_denied(self):
        for cmd in [";", "&&", "||", "|", "| ; |", "git status;", "; git status", "git status && "]:
            assert not _matches_shell_allowlist(cmd, ["git *"]), cmd

    def test_shell_injection_metacharacters_denied(self):
        for cmd in [
            "git status\nrm -rf /",
            "git status\r\nwhoami",
            "git status & whoami",
            "git status &&& whoami",
            "git status >(evil)",
            "git status <(evil)",
            "git status > /tmp/pwn",
            "git status < /etc/passwd",
            "git status (whoami)",
            "{ git status; }",
            "git ${IFS}status",
            "git $IFS status",
            "git commit -m $SECRET",
            "git status\x00whoami",
        ]:
            assert not _matches_shell_allowlist(cmd, ["git *"]), cmd


class TestShellRefusalFeedback:
    """A refused shell request says what refused it and how to recover."""

    @staticmethod
    def _feedback(command: str) -> str:
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(allow_shell=True, shell_allowlist=["git *"])
        result = create_permission_handler(config)(_make_request("shell", command=command), INV_CTX)
        assert result.kind == "reject", command
        return result.feedback or ""

    def test_each_metacharacter_is_named(self):
        cases = {
            "git status\nrm -rf /": "line break",
            "git status; rm -rf /": "command separator (;)",
            "git status && git diff": "(&)",
            "git log | git show": "pipe",
            "git status > /tmp/out": "redirection (>)",
            "git log $(whoami)": "substitution ($)",
            "git log `whoami`": "command substitution (`)",
        }
        for command, reason in cases.items():
            feedback = self._feedback(command)
            assert reason in feedback, (command, feedback)
            assert "one allowlisted program" in feedback, feedback

    def test_unlisted_program_is_named(self):
        assert "'rm'" in self._feedback("rm -rf /")

    def test_allowed_command_with_quoted_arguments_is_approved(self):
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(allow_shell=True, shell_allowlist=["git *"])
        request = _make_request("shell", command='git commit -m "a; b | c"')
        assert create_permission_handler(config)(request, INV_CTX).kind == "approve-once"


class TestProgramNameIsLiteral:
    """The program is compared literally; a glob there is refused when config loads."""

    def test_glob_program_patterns_match_nothing(self):
        assert not _matches_shell_allowlist("FOO=x git status", ["* status"])
        assert not _matches_shell_allowlist("rm -rf /", ["*"])
        assert not _matches_shell_allowlist("git status", ["g?t status"])

    def test_glob_program_patterns_are_refused_at_config_load(self):
        from botcore_agents.config import AgentPermissionsConfig

        for pattern in ["* status", "*", "g?t *", "[gr]m *"]:
            with pytest.raises(ValueError, match="names its program with a glob") as caught:
                AgentPermissionsConfig(allow_shell=True, shell_allowlist=[pattern])
            assert repr(pattern) in str(caught.value)

    def test_empty_pattern_is_refused_at_config_load(self):
        from botcore_agents.config import AgentPermissionsConfig

        with pytest.raises(ValueError, match="must name a program"):
            AgentPermissionsConfig(allow_shell=True, shell_allowlist=["  "])

    def test_literal_program_with_argument_globs_still_loads(self):
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(allow_shell=True, shell_allowlist=["git status *"])
        assert config.shell_allowlist == ["git status *"]


class TestRuntimeParseAgreement:
    """The runtime's own parse must agree: one command, same program and argv, no redirect."""

    @staticmethod
    def _decide(request) -> Any:
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(allow_shell=True, shell_allowlist=["git *"])
        return create_permission_handler(config)(request, INV_CTX)

    @staticmethod
    def _command(identifier: str) -> PermissionRequestShellCommand:
        return PermissionRequestShellCommand(identifier=identifier, read_only=True)

    def test_agreeing_parse_is_approved(self):
        segment = PermissionRequestShellCommandSegment(
            full_command_text="git log --oneline", identifier="git log"
        )
        request = _make_request(
            "shell",
            command="git log --oneline",
            commands=[self._command("git log")],
            segments=[segment],
        )
        assert self._decide(request).kind == "approve-once"

    def test_runtime_parsing_two_commands_is_refused(self):
        request = _make_request(
            "shell", command="git status", commands=[self._command("git"), self._command("rm")]
        )
        result = self._decide(request)
        assert result.kind == "reject"
        assert "parsed 2 commands" in result.feedback

    def test_missing_runtime_parse_is_refused(self):
        request = _make_request("shell", command="git status", commands=[])
        assert self._decide(request).kind == "reject"
        request.commands = None
        assert "no parsed command list" in self._decide(request).feedback

    def test_runtime_reported_redirection_is_refused(self):
        request = _make_request("shell", command="git status", redirection=True)
        assert "redirection" in self._decide(request).feedback

    def test_different_program_is_refused(self):
        request = _make_request("shell", command="git status", commands=[self._command("rm")])
        assert "different program" in self._decide(request).feedback

    def test_different_segment_argv_is_refused(self):
        segment = PermissionRequestShellCommandSegment(
            full_command_text="git status --porcelain", identifier="git"
        )
        request = _make_request("shell", command="git status", segments=[segment])
        assert "different arguments" in self._decide(request).feedback

    def test_unknown_shell_is_refused(self, monkeypatch):
        monkeypatch.setattr(permissions_mod, "_shell_kind", lambda: None)
        request = _make_request("shell", command="git status")
        assert "not one botcore can check" in self._decide(request).feedback


class TestWindowsCmdShims:
    """On Windows, cmd.exe metacharacters are refused anywhere, quoted or not."""

    @pytest.mark.parametrize(
        "command",
        [
            "pnpm test '&calc'",
            'pnpm test "a&calc"',
            "pnpm test 'a|b'",
            "pnpm test 'a>b'",
            "pnpm test 'a<b'",
            "pnpm test 'a^b'",
            "pnpm test '%PATH%'",
            "pnpm test 'a!b'",
        ],
    )
    def test_refused_on_windows(self, command, monkeypatch):
        assert check_shell_command(command, ["pnpm *"], shell="posix") is None
        reason = check_shell_command(command, ["pnpm *"], shell="windows")
        assert reason is not None and "cmd.exe" in reason

        from botcore_agents.config import AgentPermissionsConfig

        monkeypatch.setattr(permissions_mod, "_shell_kind", lambda: "windows")
        config = AgentPermissionsConfig(allow_shell=True, shell_allowlist=["pnpm *"])
        result = create_permission_handler(config)(_make_request("shell", command=command), INV_CTX)
        assert result.kind == "reject"
        assert ".cmd shims" in result.feedback

    def test_plain_command_still_approved_on_windows(self):
        assert check_shell_command("pnpm test 'unit'", ["pnpm *"], shell="windows") is None


class TestLineBreakRefusals:
    @pytest.mark.parametrize("separator", [" ", " ", "\x85", "\r", "\x0b", "\x0c"])
    def test_unicode_and_lone_line_breaks_refused(self, separator):
        command = f"git status{separator}rm -rf /"
        reason = check_shell_command(command, ["git *"], shell="posix")
        assert reason is not None and "line break" in reason


# ---------------------------------------------------------------------------
# Filesystem path tests
# ---------------------------------------------------------------------------


class TestFilesystemPaths:
    def test_allowed_path(self, tmp_path: Path):
        allowed = [str(tmp_path / "src")]
        (tmp_path / "src").mkdir()
        assert _path_allowed(str(tmp_path / "src" / "main.py"), allowed)

    def test_denied_path(self, tmp_path: Path):
        allowed = [str(tmp_path / "src")]
        (tmp_path / "src").mkdir()
        assert not _path_allowed(str(tmp_path / "secrets" / "key.pem"), allowed)

    def test_relative_path_resolved(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        (tmp_path / "src").mkdir()
        allowed = ["./src"]
        assert _path_allowed(str(tmp_path / "src" / "file.py"), allowed)

    def test_multiple_allowed_paths(self, tmp_path: Path):
        (tmp_path / "src").mkdir()
        (tmp_path / "tests").mkdir()
        allowed = [str(tmp_path / "src"), str(tmp_path / "tests")]
        assert _path_allowed(str(tmp_path / "tests" / "test_main.py"), allowed)
        assert not _path_allowed(str(tmp_path / "secrets" / "key.pem"), allowed)

    def test_prefix_collision_rejected(self, tmp_path: Path):
        """Allowed path /src must NOT match /src-secret (prefix collision)."""
        (tmp_path / "src").mkdir()
        (tmp_path / "src-secret").mkdir()
        allowed = [str(tmp_path / "src")]
        assert not _path_allowed(str(tmp_path / "src-secret" / "creds.json"), allowed)


# ---------------------------------------------------------------------------
# Agent name logging (functional)
# ---------------------------------------------------------------------------


class TestAgentNameLogging:
    """Handler with agent_name works correctly (functional, not log-capture)."""

    def test_handler_with_agent_name_denies(self):
        config = LlmPermissionsConfig()
        handler = create_permission_handler(config, agent_name="researcher")
        result = handler(_make_request("shell"), INV_CTX)
        assert result.kind == "reject"

    def test_handler_with_agent_name_approves(self):
        config = LlmPermissionsConfig(allow_shell=True)
        handler = create_permission_handler(config, agent_name="coder")
        result = handler(_make_request("shell"), INV_CTX)
        assert result.kind == "approve-once"


# ---------------------------------------------------------------------------
# Two-agent profile isolation
# ---------------------------------------------------------------------------


class TestTwoAgentProfiles:
    """Two handlers with different configs enforce independently."""

    def test_independent_enforcement(self):
        from botcore_agents.config import AgentPermissionsConfig

        coder_config = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["git *", "pytest *"],
        )
        researcher_config = AgentPermissionsConfig(allow_shell=False)

        coder_handler = create_permission_handler(coder_config, agent_name="coder")
        researcher_handler = create_permission_handler(researcher_config, agent_name="researcher")

        shell_req = _make_request("shell", command="git status")

        assert coder_handler(shell_req, INV_CTX).kind == "approve-once"
        assert researcher_handler(shell_req, INV_CTX).kind == "reject"

    def test_allowlist_isolation(self):
        from botcore_agents.config import AgentPermissionsConfig

        coder_config = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["git *"],
        )
        ops_config = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["docker *"],
        )

        coder = create_permission_handler(coder_config, agent_name="coder")
        ops = create_permission_handler(ops_config, agent_name="ops")

        git_req = _make_request("shell", command="git status")
        docker_req = _make_request("shell", command="docker ps")

        assert coder(git_req, INV_CTX).kind == "approve-once"
        assert coder(docker_req, INV_CTX).kind == "reject"
        assert ops(git_req, INV_CTX).kind == "reject"
        assert ops(docker_req, INV_CTX).kind == "approve-once"


# ---------------------------------------------------------------------------
# Shell allowlist integration in handler
# ---------------------------------------------------------------------------


class TestShellAllowlistInHandler:
    """End-to-end: handler with allow_shell + shell_allowlist."""

    def test_allowed_command_passes(self):
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["git *", "pytest *"],
        )
        handler = create_permission_handler(config)
        result = handler(_make_request("shell", command="git status"), INV_CTX)
        assert result.kind == "approve-once"

    def test_disallowed_command_denied(self):
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["git *"],
        )
        handler = create_permission_handler(config)
        result = handler(_make_request("shell", command="rm -rf /"), INV_CTX)
        assert result.kind == "reject"

    def test_no_allowlist_allows_all(self):
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(allow_shell=True, shell_allowlist=None)
        handler = create_permission_handler(config)
        result = handler(_make_request("shell", command="anything"), INV_CTX)
        assert result.kind == "approve-once"


# ---------------------------------------------------------------------------
# Filesystem paths integration in handler
# ---------------------------------------------------------------------------


class TestFilesystemPathsInHandler:
    """End-to-end: handler with allow_filesystem + filesystem_paths."""

    def test_allowed_path_passes(self, tmp_path: Path):
        from botcore_agents.config import AgentPermissionsConfig

        (tmp_path / "src").mkdir()
        config = AgentPermissionsConfig(
            allow_filesystem=True,
            filesystem_paths=[str(tmp_path / "src")],
        )
        handler = create_permission_handler(config)
        result = handler(
            _make_request("read", path=str(tmp_path / "src" / "file.py")),
            INV_CTX,
        )
        assert result.kind == "approve-once"

    def test_disallowed_path_denied(self, tmp_path: Path):
        from botcore_agents.config import AgentPermissionsConfig

        (tmp_path / "src").mkdir()
        config = AgentPermissionsConfig(
            allow_filesystem=True,
            filesystem_paths=[str(tmp_path / "src")],
        )
        handler = create_permission_handler(config)
        result = handler(
            _make_request("write", path=str(tmp_path / "secrets" / "key.pem")),
            INV_CTX,
        )
        assert result.kind == "reject"

    def test_no_paths_allows_all(self):
        from botcore_agents.config import AgentPermissionsConfig

        config = AgentPermissionsConfig(allow_filesystem=True, filesystem_paths=None)
        handler = create_permission_handler(config)
        result = handler(_make_request("write", path="/any/path"), INV_CTX)
        assert result.kind == "approve-once"


class TestFailClosed:
    def test_managed_approval_required_denied(self):
        handler = create_permission_handler(LlmPermissionsConfig())
        request = _make_request("custom-tool")
        request.managed_approval_required = True
        assert handler(request, INV_CTX).kind == "reject"

    def test_empty_path_denied(self, tmp_path: Path, monkeypatch):
        from botcore_agents.config import AgentPermissionsConfig

        monkeypatch.chdir(tmp_path)
        config = AgentPermissionsConfig(allow_filesystem=True, filesystem_paths=[str(tmp_path)])
        handler = create_permission_handler(config)
        assert handler(_make_request("read", path=""), INV_CTX).kind == "reject"
