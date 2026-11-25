"""Tests for ``instances: 'single' | 'multiple'`` and ``confirmation_key`` validation (#2242).

Mirrors ``packages/server/src/instance-state.test.ts``.
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest

from afd.core.commands import CommandContext, ExposeOptions
from afd.core.result import CommandResult, success
from afd.server import (
    MCPServer,
    ServerInstances,
    compose_middleware,
    create_approval_middleware,
    create_server,
)
from afd.server.config import ServerConfig
from afd.server.instance_state import _reset_instances_warning_for_tests

SECRET = "test-approval-secret-0123456789abcdef"
KEY = "test-confirmation-key-0123456789abcdef"


class _SharedNonceStore:
    def __init__(self) -> None:
        self._spent: set[str] = set()

    def consume(self, nonce: str, expires_at: float) -> bool:
        if nonce in self._spent:
            return False
        self._spent.add(nonce)
        return True


async def _pass_through(
    command_name: str, input: Any, context: CommandContext, next_fn: Any
) -> CommandResult[Any]:
    return await next_fn()


def _make_server(**kwargs: Any):
    server = create_server("todo", **kwargs)

    @server.command(
        name="todo-clear",
        description="Delete every todo",
        mutation=True,
        confirm_prompt="Delete every todo?",
        approval="not-required",
        expose=ExposeOptions(mcp=True),
    )
    async def todo_clear(input: Any) -> CommandResult[Any]:
        return success({"cleared": True})

    return server


@pytest.fixture(autouse=True)
def _reset_warning():
    _reset_instances_warning_for_tests()
    yield
    _reset_instances_warning_for_tests()


class TestConfirmationKeyValidation:
    def test_refuses_short_or_wrong_type_at_creation(self):
        with pytest.raises(ValueError, match="confirmation_key must be at least 32 bytes"):
            _make_server(confirmation_key="short")
        with pytest.raises(ValueError, match="confirmation_key must be at least 32 bytes"):
            _make_server(confirmation_key=b"x" * 31)
        with pytest.raises(ValueError, match="confirmation_key must be at least 32 bytes"):
            _make_server(confirmation_key=bytearray(31))
        # Multi-byte UTF-8: 15 two-byte chars = 30 bytes (< 32) refused; 16 = 32 bytes accepted.
        with pytest.raises(ValueError, match="confirmation_key must be at least 32 bytes"):
            _make_server(confirmation_key="\u00e9" * 15)
        _make_server(confirmation_key="\u00e9" * 16)
        with pytest.raises(TypeError, match="confirmation_key must be a str or bytes"):
            _make_server(confirmation_key=42)
        with pytest.raises(TypeError, match="confirmation_key must be a str or bytes"):
            _make_server(confirmation_key=True)

    def test_accepts_32_bytes_as_str_bytes_bytearray_or_memoryview(self):
        _make_server(confirmation_key=KEY)
        _make_server(confirmation_key=b"k" * 32)
        _make_server(confirmation_key=bytearray(b"k" * 32))
        _make_server(confirmation_key=memoryview(b"k" * 32))

    @pytest.mark.asyncio
    async def test_copies_caller_bytearray_and_shares_elicitation_state_across_two_instances(self):
        from mcp import Client, types

        async def _elicit(_ctx: Any, _params: Any) -> types.ElicitResult:
            return types.ElicitResult(action="accept", content={"confirm": True})

        buf = bytearray(KEY.encode("utf-8"))
        server_a = _make_server(
            tool_strategy="individual",
            instances="multiple",
            confirmations="require-human",
            confirmation_key=buf,
        )
        server_b = _make_server(
            tool_strategy="individual",
            instances="multiple",
            confirmations="require-human",
            confirmation_key=bytes(buf),
        )
        # Mutate the caller's buffer before either server seals or verifies requestState.
        buf[:] = b"\x00" * len(buf)

        async with Client(server_a._create_mcp_server(), elicitation_callback=_elicit) as client_a:
            asked = await client_a.session.call_tool("todo-clear", {}, allow_input_required=True)
        assert type(asked).__name__ == "InputRequiredResult"
        state = asked.request_state
        assert state is not None

        # Instance B accepts the requestState minted by Instance A using the copied key.
        async with Client(server_b._create_mcp_server(), elicitation_callback=_elicit) as client_b:
            res = await client_b.session.call_tool(
                "todo-clear",
                {},
                input_responses={
                    "confirm": types.ElicitResult(action="accept", content={"confirm": True})
                },
                request_state=state,
                allow_input_required=True,
            )
        assert type(res).__name__ == "CallToolResult"
        assert res.is_error is False
        assert res.structured_content is not None
        assert res.structured_content["data"] == {"cleared": True}

    def test_still_validates_key_under_instances_single(self):
        with pytest.raises(ValueError, match="confirmation_key must be at least 32 bytes"):
            _make_server(instances="single", confirmation_key="short")

    def test_mutating_config_confirmations_after_init_does_not_bypass_check(self):
        server = _make_server(instances="multiple", confirmations="off")
        server.config.confirmations = "enforce"
        tools = server.get_tool_definitions()
        clear_tool = next(t for t in tools if t["name"] == "todo")
        # Snapshotted mode stayed "off", so the grouped tool does not advertise confirm.
        assert "confirm" not in clear_tool.get("inputSchema", {}).get("properties", {})

    def test_server_config_positional_constructor_backwards_compatible(self):
        # Appending `instances` at the end preserves every earlier positional slot,
        # including `first_class_tools` at position 20.
        config = ServerConfig(
            "todo",
            "1.0.0",
            None,
            "fastmcp",
            [],
            "hybrid",
            [],
            None,
            False,
            30_000,
            500,
            16,
            100,
            None,
            None,
            None,
            None,
            None,
            None,
            "off",
            None,
            ["todo-clear"],
        )
        assert config.first_class_tools == ["todo-clear"]
        assert config.instances is None
        MCPServer(config)


class TestInstancesMultiple:
    def test_refuses_confirmations_without_confirmation_key(self):
        with pytest.raises(ValueError, match=r"instances='multiple' needs confirmation_key"):
            _make_server(instances="multiple", confirmations="enforce")
        with pytest.raises(ValueError, match=r"instances='multiple' needs confirmation_key"):
            _make_server(instances="multiple", confirmations="require-human")
        _make_server(instances="multiple", confirmations="enforce", confirmation_key=KEY)

    def test_refuses_single_use_approval_without_nonce_store(self):
        mw = [create_approval_middleware(secret=SECRET)]
        with pytest.raises(ValueError, match="nonce_store"):
            _make_server(instances="multiple", middleware=mw)
        _make_server(
            instances="multiple",
            middleware=[create_approval_middleware(secret=SECRET, nonce_store=_SharedNonceStore())],
        )
        # Tokens that may be reused within their TTL keep no nonces.
        _make_server(
            instances="multiple",
            middleware=[create_approval_middleware(secret=SECRET, replay="within-ttl")],
        )

    def test_refuses_approval_relay_without_confirmation_key(self):
        mw = [
            create_approval_middleware(
                secret=SECRET,
                nonce_store=_SharedNonceStore(),
                relay="mcp-elicitation",
            )
        ]
        with pytest.raises(ValueError, match="needs confirmation_key"):
            _make_server(instances="multiple", middleware=mw)
        _make_server(instances="multiple", middleware=mw, confirmation_key=KEY)

    def test_names_both_defaults_when_both_are_missing(self):
        with pytest.raises(
            ValueError,
            match=r"confirmation_key .* and the approval middleware's nonce_store .*Pass the same",
        ):
            _make_server(
                instances="multiple",
                confirmations="require-human",
                middleware=[create_approval_middleware(secret=SECRET)],
            )

    def test_sees_approval_middleware_across_module_reload(self):
        import afd.server.instance_state as instance_state_mod

        mw_before_reload = create_approval_middleware(secret=SECRET)
        relay_before_reload = create_approval_middleware(
            secret=SECRET,
            nonce_store=_SharedNonceStore(),
            relay="mcp-elicitation",
        )
        reloaded = importlib.reload(instance_state_mod)
        try:
            with pytest.raises(ValueError, match="nonce_store"):
                reloaded.check_instance_state(
                    name="todo",
                    instances="multiple",
                    confirmation_key=None,
                    confirmations="off",
                    middleware=[mw_before_reload],
                )
            with pytest.raises(ValueError, match="needs confirmation_key"):
                reloaded.check_instance_state(
                    name="todo",
                    instances="multiple",
                    confirmation_key=None,
                    confirmations="off",
                    middleware=[relay_before_reload],
                )
        finally:
            reloaded._reset_instances_warning_for_tests()

    def test_sees_approval_middleware_inside_compose_middleware(self):
        composed = compose_middleware(_pass_through, create_approval_middleware(secret=SECRET))
        with pytest.raises(ValueError, match="nonce_store"):
            _make_server(instances="multiple", middleware=[composed])

        nested = compose_middleware(
            compose_middleware(
                create_approval_middleware(
                    secret=SECRET,
                    nonce_store=_SharedNonceStore(),
                    relay="mcp-elicitation",
                )
            ),
            _pass_through,
        )
        with pytest.raises(ValueError, match="needs confirmation_key"):
            _make_server(instances="multiple", middleware=[nested])
        _make_server(instances="multiple", middleware=[nested], confirmation_key=KEY)
        _make_server(instances="multiple", middleware=[compose_middleware(_pass_through)])

    @pytest.mark.asyncio
    async def test_two_instances_sharing_nonce_store_spend_single_use_token_once(self):
        shared_store = _SharedNonceStore()

        def make_gated_server():
            server = create_server(
                "todo",
                instances="multiple",
                confirmation_key=KEY,
                middleware=[create_approval_middleware(secret=SECRET, nonce_store=shared_store)],
            )

            @server.command(
                name="todo-clear",
                description="Delete every todo",
                mutation=True,
                approval="required",
                expose=ExposeOptions(mcp=True),
            )
            async def todo_clear(input: Any) -> CommandResult[Any]:
                return success({"cleared": True})

            return server

        instance_a = make_gated_server()
        instance_b = make_gated_server()

        held = await instance_a.execute("todo-clear", {})
        assert held.success is False
        assert held.error is not None and held.error.details is not None
        token = held.error.details["approvalToken"]

        # First spend on instance B succeeds.
        approved = await instance_b.execute("todo-clear", {}, CommandContext(approval=token))
        assert approved.success is True

        # Replaying the same token on instance A is rejected as already-used.
        replay = await instance_a.execute("todo-clear", {}, CommandContext(approval=token))
        assert replay.success is False
        assert replay.error is not None
        assert replay.error.code == "APPROVAL_REQUIRED"
        assert replay.error.details is not None
        assert replay.error.details["reason"] == "already-used"

    def test_needs_nothing_when_no_per_process_default_is_in_use(self):
        mode: ServerInstances = "multiple"
        _make_server(instances=mode)

    def test_refuses_unknown_instances_value(self):
        with pytest.raises(ValueError, match="instances must be 'single' or 'multiple'"):
            _make_server(instances="many")


class TestHttpWarning:
    def test_warns_on_streamable_http_app_not_at_creation(self, capsys: pytest.CaptureFixture[str]):
        server = _make_server(
            confirmations="enforce",
            middleware=[create_approval_middleware(secret=SECRET)],
        )
        assert capsys.readouterr().err == ""

        server.streamable_http_app()
        err = capsys.readouterr().err
        lines = [line for line in err.splitlines() if "warning:" in line]
        assert len(lines) == 1
        assert "[todo] warning: one process must serve every request" in lines[0]
        assert "confirmation_key" in lines[0]
        assert "the approval middleware's nonce_store" in lines[0]

    def test_warns_on_sse_app(self, capsys: pytest.CaptureFixture[str]):
        server = _make_server(confirmations="enforce")
        server.sse_app()
        err = capsys.readouterr().err
        lines = [line for line in err.splitlines() if "warning:" in line]
        assert len(lines) == 1
        assert "no confirmation_key" in lines[0]

    @pytest.mark.asyncio
    async def test_warns_on_run_async_streamable_http_and_sse(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ):
        from mcp.server.mcpserver import MCPServer as SdkMCPServer

        async def _noop_run(self: Any, **_kwargs: Any) -> None:
            return None

        monkeypatch.setattr(SdkMCPServer, "run_streamable_http_async", _noop_run)
        monkeypatch.setattr(SdkMCPServer, "run_sse_async", _noop_run)

        await _make_server(confirmations="enforce").run_async("streamable-http")
        lines = [line for line in capsys.readouterr().err.splitlines() if "warning:" in line]
        assert len(lines) == 1
        assert "no confirmation_key" in lines[0]

        _reset_instances_warning_for_tests()
        await _make_server(confirmations="enforce").run_async("sse")
        lines = [line for line in capsys.readouterr().err.splitlines() if "warning:" in line]
        assert len(lines) == 1
        assert "no confirmation_key" in lines[0]

    def test_silenced_by_single_and_absent_when_shared(self, capsys: pytest.CaptureFixture[str]):
        _make_server(instances="single", confirmations="enforce").streamable_http_app()
        _make_server(confirmations="enforce", confirmation_key=KEY).streamable_http_app()
        _make_server(
            middleware=[create_approval_middleware(secret=SECRET, nonce_store=_SharedNonceStore())]
        ).streamable_http_app()
        _make_server().streamable_http_app()
        assert capsys.readouterr().err == ""

        # 'single' does not consume the process-wide warning flag.
        _make_server(confirmations="enforce").streamable_http_app()
        lines = [line for line in capsys.readouterr().err.splitlines() if "warning:" in line]
        assert len(lines) == 1

    def test_logs_at_most_once_per_process(self, capsys: pytest.CaptureFixture[str]):
        _make_server(confirmations="enforce").streamable_http_app()
        _make_server(middleware=[create_approval_middleware(secret=SECRET)]).streamable_http_app()
        _make_server(confirmations="enforce").sse_app()
        lines = [line for line in capsys.readouterr().err.splitlines() if "warning:" in line]
        assert len(lines) == 1

    @pytest.mark.asyncio
    async def test_logs_nothing_on_stdio_or_execute(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ):
        server = _make_server(
            confirmations="enforce",
            middleware=[create_approval_middleware(secret=SECRET)],
        )
        res = await server.execute("todo-clear", {})
        assert res.success is True
        assert capsys.readouterr().err == ""

        # Exercise run_async("stdio") without blocking on real stdin.
        mcp = server._create_mcp_server()
        called = False

        async def fake_run_stdio() -> None:
            nonlocal called
            called = True

        monkeypatch.setattr(mcp, "run_stdio_async", fake_run_stdio)
        monkeypatch.setattr(server, "_create_mcp_server", lambda: mcp)
        await server.run_async("stdio")
        assert called is True
        assert capsys.readouterr().err == ""
