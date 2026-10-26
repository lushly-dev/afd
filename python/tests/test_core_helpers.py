"""Core helpers and root exports reconciled from the Wave 1 parity work (#348)."""

import asyncio
import gc
import warnings
from typing import Any

import pytest

import afd
import afd.core
import afd.direct
import afd.server
import afd.server.middleware
from afd import (
    CommandMiddleware,
    ErrorCode,
    ErrorCodes,
    NextFn,
    TimeoutController,
    WarningSeverity,
    create_command_registry,
    create_progress_chunk_with_steps,
    create_timeout_controller,
    failure,
    success,
    to_wire,
)
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.errors import CommandError
from afd.server import compose_middleware, create_server, define_command


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance_ms(self, ms: float) -> None:
        self.now += ms / 1000


async def _ok(input: Any, context: Any = None):
    return success({"ok": True})


# =============================================================================
# Root exports
# =============================================================================


class TestRootExports:
    @pytest.mark.parametrize(
        "name",
        [
            "CommandHandler",
            "CommandRegistry",
            "create_command_registry",
            "CommandMiddleware",
            "NextFn",
            "WarningSeverity",
            "ErrorCode",
            "TimeoutController",
            "create_timeout_controller",
            "create_progress_chunk_with_steps",
        ],
    )
    def test_core_names_are_the_same_objects_at_the_root(self, name):
        assert name in afd.__all__
        assert name in afd.core.__all__
        assert getattr(afd, name) is getattr(afd.core, name)

    def test_colliding_root_names_stay_the_direct_types(self):
        # Changing these would break `from afd import CommandDefinition` users.
        for name in ("CommandDefinition", "CommandContext", "CommandParameter"):
            assert getattr(afd, name) is getattr(afd.direct, name)
            assert getattr(afd, name) is not getattr(afd.core, name)

    def test_root_all_has_no_duplicates_and_resolves(self):
        assert len(afd.__all__) == len(set(afd.__all__))
        for name in afd.__all__:
            if name not in ("McpClient", "McpClientConfig", "ClientStatus", "create_client"):
                assert hasattr(afd, name), name

    def test_warning_severity_is_the_metadata_enum(self):
        from afd.core.metadata import WarningSeverity as Owned

        assert WarningSeverity is Owned
        assert afd.create_warning("W", "msg", severity=WarningSeverity.CAUTION).severity == "caution"


# =============================================================================
# ErrorCode
# =============================================================================


class TestErrorCode:
    def test_is_an_open_string_alias(self):
        assert ErrorCode is str
        assert isinstance(ErrorCodes.NOT_FOUND, ErrorCode)

    def test_custom_codes_stay_supported(self):
        code: ErrorCode = "QUOTA_PLAN_LIMIT"
        result = failure(CommandError(code=code, message="Plan limit", suggestion="Upgrade"))
        assert result.error.code == "QUOTA_PLAN_LIMIT"
        assert to_wire(result)["error"]["code"] == "QUOTA_PLAN_LIMIT"


# =============================================================================
# Middleware types
# =============================================================================


class TestMiddlewareTypes:
    def test_one_protocol_shared_by_core_server_and_root(self):
        assert CommandMiddleware is afd.core.CommandMiddleware
        assert CommandMiddleware is afd.server.CommandMiddleware
        assert CommandMiddleware is afd.server.middleware.CommandMiddleware
        assert NextFn is afd.server.middleware.NextFn

    async def test_core_typed_middleware_composes_and_runs_on_the_server(self):
        calls: list[str] = []

        def tag(label: str) -> CommandMiddleware:
            async def middleware(
                command_name: str, input: Any, context: CommandContext, next_fn: NextFn
            ):
                calls.append(f"{label}:{command_name}")
                return await next_fn()

            return middleware

        server = create_server("mw-app", middleware=[compose_middleware(tag("a"), tag("b"))])

        @server.command(name="item-get", description="Get an item")
        async def item_get(input):
            return success({"id": 1})

        result = await server.execute("item-get", {})
        assert result.success
        assert calls == ["a:item-get", "b:item-get"]


# =============================================================================
# Command name rule
# =============================================================================


def _name_warnings(record) -> list[str]:
    return [str(w.message) for w in record if "[AFD] Command name" in str(w.message)]


class TestCommandNameRule:
    @pytest.mark.parametrize("name", ["create", "todoCreate", "TODO-CREATE", "todo_create", ""])
    def test_define_command_warns_and_still_defines(self, name):
        with pytest.warns(UserWarning, match=r"\[AFD\] Command name"):

            @define_command(name=name, description="Bad name")
            async def handler(input):
                return success(None)

        assert handler.__afd_command__.name == name

    def test_warning_points_at_the_caller(self):
        with pytest.warns(UserWarning) as record:
            define_command(name="bad", description="Bad name")
        assert record[0].filename == __file__

    def test_valid_names_do_not_warn(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            define_command(name="todo-create-batch", description="Fine")
            registry = create_command_registry()
            registry.register(CommandDefinition(name="todo-get", description="Fine", handler=_ok))

    async def test_server_registration_warns_once_and_registers(self):
        server = create_server("names-app")
        with warnings.catch_warnings(record=True) as record:
            warnings.simplefilter("always")

            @server.command(name="greet", description="Greet")
            async def greet(input):
                return success("hi")

        assert len(_name_warnings(record)) == 1
        assert record[0].filename == __file__
        assert (await server.execute("greet", {})).success

    async def test_core_registry_warns_for_raw_definitions_and_registers(self):
        registry = create_command_registry()
        with pytest.warns(UserWarning, match="'ping'"):
            registry.register(CommandDefinition(name="ping", description="Ping", handler=_ok))
        assert registry.has("ping")
        assert (await registry.execute("ping", {})).success

    def test_core_registry_checks_a_name_that_differs_from_the_decorated_one(self):
        decorated = define_command(name="todo-get", description="Fine")(_ok)
        registry = create_command_registry()
        with pytest.warns(UserWarning, match="'bad'"):
            registry.register(CommandDefinition(name="bad", description="Bad", handler=decorated))


# =============================================================================
# Progress with steps
# =============================================================================


class TestProgressChunkWithSteps:
    def test_matches_create_progress_chunk(self):
        chunk = create_progress_chunk_with_steps(0.5, 2, 4, message="Step 2 of 4", phase="load")
        assert chunk == afd.create_progress_chunk(
            0.5, message="Step 2 of 4", phase="load", current_step=2, total_steps=4
        )

    def test_clamps_and_serializes_camel_case(self):
        chunk = create_progress_chunk_with_steps(1.5, 3, 3, items_processed=9, items_total=9)
        assert to_wire(chunk) == {
            "type": "progress",
            "progress": 1.0,
            "currentStep": 3,
            "totalSteps": 3,
            "itemsProcessed": 9,
            "itemsTotal": 9,
        }


# =============================================================================
# Timeout controller
# =============================================================================


class TestTimeoutController:
    def test_deadline_counts_down_on_the_clock(self):
        clock = FakeClock()
        controller = create_timeout_controller(1000, clock=clock)
        assert isinstance(controller, TimeoutController)
        assert controller.timeout_ms == 1000
        assert controller.remaining_ms == 1000
        assert not controller.is_expired

        clock.advance_ms(400)
        assert controller.remaining_ms == pytest.approx(600)

        clock.advance_ms(600)
        assert controller.remaining_ms == 0
        assert controller.is_expired

        clock.advance_ms(5000)
        assert controller.remaining_ms == 0

    def test_zero_timeout_is_expired_at_once(self):
        assert create_timeout_controller(0, clock=FakeClock()).is_expired

    def test_no_timeout_never_expires(self):
        clock = FakeClock()
        controller = create_timeout_controller(clock=clock)
        clock.advance_ms(10**9)
        assert controller.timeout_ms is None
        assert controller.remaining_ms is None
        assert not controller.is_expired

    @pytest.mark.parametrize("value", [-1, float("inf"), float("nan"), True, "100"])
    def test_rejects_invalid_timeouts(self, value):
        with pytest.raises(ValueError, match="timeout_ms"):
            create_timeout_controller(value)

    async def test_run_returns_the_result_in_time(self):
        controller = create_timeout_controller(5000)

        async def work():
            await asyncio.sleep(0)
            return 42

        assert await controller.run(work()) == 42

    async def test_run_without_timeout_awaits_to_completion(self):
        async def work():
            await asyncio.sleep(0.01)
            return "done"

        assert await create_timeout_controller().run(work()) == "done"

    async def test_run_is_bounded_by_the_remaining_time_not_the_full_budget(self):
        clock = FakeClock()
        controller = create_timeout_controller(60_000, clock=clock)
        clock.advance_ms(59_980)  # 20 ms left of a minute
        cancelled = asyncio.Event()

        async def slow():
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        with pytest.raises(TimeoutError, match="60000ms"):
            await asyncio.wait_for(controller.run(slow()), 5)
        assert cancelled.is_set()

    async def test_run_after_expiry_raises_without_leaking_the_coroutine(self):
        clock = FakeClock()
        controller = create_timeout_controller(10, clock=clock)
        clock.advance_ms(10)

        async def never():
            await asyncio.sleep(30)

        with warnings.catch_warnings():
            warnings.simplefilter("error", RuntimeWarning)
            with pytest.raises(TimeoutError):
                await controller.run(never())
            gc.collect()

    async def test_caller_cancellation_is_not_a_timeout(self):
        controller = create_timeout_controller(60_000)
        started = asyncio.Event()

        async def slow():
            started.set()
            await asyncio.sleep(30)

        task = asyncio.ensure_future(controller.run(slow()))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not controller.is_expired

    async def test_the_awaitables_own_timeout_error_passes_through_unchanged(self):
        async def read():
            raise TimeoutError("socket read timed out")

        with pytest.raises(TimeoutError, match="socket read timed out"):
            await create_timeout_controller(60_000).run(read())

    async def test_errors_from_the_awaitable_pass_through(self):
        async def boom():
            raise KeyError("x")

        with pytest.raises(KeyError):
            await create_timeout_controller(5000).run(boom())
