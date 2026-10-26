"""Actor, clock and random on CommandContext (#400; TypeScript #271, #274)."""

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pytest
from pydantic import BaseModel

from afd import (
    ACTOR_KINDS,
    Actor,
    ContextDefaults,
    fixed_clock,
    is_actor,
    is_actor_kind,
    seeded_random,
    success,
    system_clock,
    system_random,
    with_context_defaults,
)
from afd.core import CommandContext, CommandDefinition, ExposeOptions, create_command_registry
from afd.core.wire import to_wire
from afd.direct import (
    CommandContext as DirectContext,
    DirectCallContext,
    DirectClient,
    DirectClientOptions,
    SimpleRegistry,
)
from afd.server import create_server
from afd.server.middleware import create_telemetry_middleware, create_timing_middleware
from afd.testing.fixtures import command_context  # noqa: F401 (pytest fixture)
from afd.testing.helpers import create_test_context
from afd.testing.scenarios.executor import InProcessExecutor, InProcessExecutorConfig
from afd.testing.scenarios.types import Expectation, Scenario, Step


class Empty(BaseModel):
    pass


# Golden values from packages/core/src/clock.test.ts.
ABC_SEQUENCE = [0.5166419988963753, 0.6596221292857081, 0.0018796597141772509]
EMPTY_SEED_FIRST = 0.6112444521859288


class TestSeededRandom:
    def test_matches_the_typescript_sequence(self):
        random = seeded_random("abc")
        assert [random.next() for _ in range(3)] == ABC_SEQUENCE
        assert seeded_random("").next() == EMPTY_SEED_FIRST

    def test_same_seed_same_sequence_and_keeps_its_seed(self):
        a, b = seeded_random("replay-7"), seeded_random("replay-7")
        assert [a.next() for _ in range(100)] == [b.next() for _ in range(100)]
        assert a.seed == "replay-7"
        assert seeded_random("x").next() != seeded_random("y").next()

    def test_hashes_utf8_bytes(self):
        # Non-ASCII seeds hash their UTF-8 bytes, so every language agrees.
        values = [seeded_random("héllo ✓").next() for _ in range(2)]
        assert values[0] == values[1]
        assert 0 <= values[0] < 1

    def test_values_are_in_unit_interval(self):
        random = seeded_random("range")
        assert all(0 <= random.next() < 1 for _ in range(10_000))

    def test_rejects_non_string_seed(self):
        with pytest.raises(TypeError):
            seeded_random(42)  # type: ignore[arg-type]


class TestClocks:
    def test_system_sources(self):
        before = datetime.now(timezone.utc).timestamp() * 1000
        now = system_clock.now()
        after = datetime.now(timezone.utc).timestamp() * 1000
        assert before - 1 <= now <= after + 1
        assert 0 <= system_random.next() < 1
        assert system_random.seed is None

    def test_fixed_clock_accepts_ms_iso_and_datetime(self):
        assert fixed_clock().now() == 0
        assert fixed_clock(1234).now() == 1234
        assert fixed_clock("2026-01-01T00:00:00Z").now() == 1767225600000
        assert fixed_clock("2026-01-01T00:00:00.250+00:00").now() == 1767225600250
        assert fixed_clock(datetime(2026, 1, 1, tzinfo=timezone.utc)).now() == 1767225600000
        # A naive datetime is UTC.
        assert fixed_clock(datetime(2026, 1, 1)).now() == 1767225600000

    def test_fixed_clock_moves_only_when_told(self):
        clock = fixed_clock(1000)
        assert clock.now() == clock.now() == 1000
        clock.advance(500)
        assert clock.now() == 1500
        clock.advance(-1500)
        assert clock.now() == 0
        clock.set("1970-01-01T00:00:01Z")
        assert clock.now() == 1000

    @pytest.mark.parametrize("bad", ["not a date", float("nan"), float("inf"), True, None])
    def test_fixed_clock_rejects_invalid_instants(self, bad: Any):
        with pytest.raises(ValueError):
            fixed_clock(bad)

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), "1"])
    def test_advance_rejects_invalid_steps(self, bad: Any):
        with pytest.raises(ValueError):
            fixed_clock().advance(bad)


class TestActor:
    def test_kinds(self):
        assert ACTOR_KINDS == ("human", "agent", "service", "script", "test")
        assert all(is_actor_kind(kind) for kind in ACTOR_KINDS)
        assert not is_actor_kind("robot")
        assert not is_actor_kind(None)

    def test_is_actor(self):
        assert is_actor(Actor(kind="agent", id="a1", label="Claude", on_behalf_of="u1"))
        assert not is_actor(Actor(kind="robot"))  # type: ignore[arg-type]
        assert not is_actor(Actor(kind="human", id=7))  # type: ignore[arg-type]
        assert not is_actor({"kind": "human"})

    def test_with_context_defaults_fills_only_what_is_missing(self):
        filled = with_context_defaults()
        assert isinstance(filled, CommandContext)
        assert filled.clock is system_clock and filled.random is system_random
        assert filled.actor is None

        clock, random = fixed_clock(5), seeded_random("s")
        own = CommandContext(trace_id="t", clock=clock, actor=Actor(kind="script"))
        result = with_context_defaults(
            own, ContextDefaults(clock=fixed_clock(9), random=random, actor=Actor(kind="agent"))
        )
        assert result is not own and own.random is None
        assert result.trace_id == "t"
        assert result.clock is clock
        assert result.random is random
        assert result.actor == Actor(kind="script")

    def test_with_context_defaults_copies_the_actor(self):
        default = Actor(kind="agent")
        first = with_context_defaults(None, ContextDefaults(actor=default))
        first.actor.id = "someone"
        second = with_context_defaults(None, ContextDefaults(actor=default))
        assert default.id is None and second.actor.id is None

    def test_with_context_defaults_works_on_the_direct_context(self):
        result = with_context_defaults(DirectContext(trace_id="t"))
        assert isinstance(result, DirectContext)
        assert result.clock is system_clock


class TestCoreRegistry:
    @pytest.mark.asyncio
    async def test_handlers_get_a_clock_and_random(self):
        seen: list[Any] = []

        async def handler(input, context):
            seen.append(context)
            return success({"at": context.clock.now(), "roll": context.random.next()})

        registry = create_command_registry()
        registry.register(CommandDefinition(name="dice-roll", description="d", handler=handler))

        await registry.execute("dice-roll", {})
        assert seen[0].clock is system_clock and seen[0].random is system_random

        result = await registry.execute(
            "dice-roll", {}, CommandContext(clock=fixed_clock(7), random=seeded_random("abc"))
        )
        assert result.data == {"at": 7, "roll": ABC_SEQUENCE[0]}


def _server_with_probe(**options: Any):
    server = create_server("context-app", **options)
    seen: list[CommandContext] = []

    @server.command(
        name="probe-run",
        description="Report the context",
        input_schema=Empty,
        expose=ExposeOptions(mcp=True),
    )
    async def probe(input: Empty, context: CommandContext):
        seen.append(context)
        if hasattr(context.clock, "advance"):
            context.clock.advance(25)
        return success({"roll": context.random.next()})

    return server, seen


class TestServer:
    @pytest.mark.asyncio
    async def test_mcp_calls_are_agents(self):
        server, seen = _server_with_probe()
        result = await server.route_tool_call("probe-run", {})
        assert seen[0].actor == Actor(kind="agent")
        assert result.metadata.actor_kind == "agent"
        assert to_wire(result)["metadata"]["actorKind"] == "agent"

        await server.route_tool_call("afd-call", {"command": "probe-run", "input": {}})
        assert seen[1].actor == Actor(kind="agent")
        assert seen[1].actor is not seen[0].actor

    @pytest.mark.asyncio
    async def test_actor_clock_and_random_options(self):
        clock = fixed_clock("2026-01-01T00:00:00Z")
        server, seen = _server_with_probe(
            clock=clock, random=seeded_random("abc"), actor=Actor(kind="service", id="svc")
        )
        result = await server.route_tool_call("probe-run", {})
        assert seen[0].clock is clock
        assert result.data == {"roll": ABC_SEQUENCE[0]}
        # executionTimeMs is read from the context clock, which the handler advanced.
        assert result.metadata.execution_time_ms == 25
        assert result.metadata.actor_kind == "service"
        # The id never crosses the wire.
        assert "svc" not in json.dumps(to_wire(result))

    @pytest.mark.asyncio
    async def test_local_execute_has_no_default_actor(self):
        server, seen = _server_with_probe()
        result = await server.execute("probe-run", {})
        assert seen[0].actor is None
        assert seen[0].clock is system_clock
        assert result.metadata.actor_kind is None
        assert "actorKind" not in to_wire(result)["metadata"]

        result = await server.execute("probe-run", {}, CommandContext(actor=Actor(kind="script")))
        assert result.metadata.actor_kind == "script"

    @pytest.mark.asyncio
    async def test_batch_items_keep_the_agent_actor(self):
        server, seen = _server_with_probe()
        result = await server.route_tool_call(
            "afd-batch", {"commands": [{"command": "probe-run", "input": {}}] * 2}
        )
        assert result.success
        assert [context.actor for context in seen] == [Actor(kind="agent")] * 2
        assert all(item.result.metadata.actor_kind == "agent" for item in result.results)

    @pytest.mark.asyncio
    async def test_middleware_refining_the_actor_is_reported(self):
        async def sign_in(name, input, context, next_fn):
            context.actor = Actor(kind="human", id="u1")
            return await next_fn()

        server, _ = _server_with_probe(middleware=[sign_in])
        result = await server.route_tool_call("probe-run", {})
        assert result.metadata.actor_kind == "human"

    @pytest.mark.asyncio
    async def test_telemetry_and_timing_read_the_context_clock(self):
        events: list[Any] = []
        slow: list[tuple[str, float]] = []

        class Sink:
            def record(self, event):
                events.append(event)

            def flush(self):
                pass

        server, _ = _server_with_probe(
            clock=fixed_clock("2026-01-01T00:00:00Z"),
            middleware=[
                create_telemetry_middleware(Sink()),
                create_timing_middleware(slow_threshold=10, on_slow=lambda n, ms: slow.append((n, ms))),
            ],
        )
        await server.route_tool_call("probe-run", {})

        (event,) = events
        assert event.actor_kind == "agent"
        assert event.duration_ms == 25
        assert event.started_at == "2026-01-01T00:00:00+00:00"
        assert event.completed_at == "2026-01-01T00:00:00.025000+00:00"
        assert slow == [("probe-run", 25)]


class _Registry:
    def __init__(self) -> None:
        self.contexts: list[DirectContext] = []

    def has_command(self, name: str) -> bool:
        return True

    def list_command_names(self) -> list[str]:
        return ["probe-run"]

    def list_commands(self) -> list[Any]:
        return []

    async def execute(self, name, args, context):
        self.contexts.append(context)
        return success({})


class TestDirectClient:
    @pytest.mark.asyncio
    async def test_defaults_to_a_human_actor_and_leaves_clock_to_the_registry(self):
        registry = _Registry()
        client = DirectClient(registry)
        await client.call("probe-run", {})
        await client.call("probe-run", {})
        first, second = registry.contexts
        assert first.actor == Actor(kind="human")
        assert first.actor is not second.actor
        assert first.clock is None and first.random is None

    @pytest.mark.asyncio
    async def test_call_context_wins_over_client_options(self):
        registry = _Registry()
        client_clock, call_clock = fixed_clock(1), fixed_clock(2)
        random = seeded_random("abc")
        client = DirectClient(
            registry,
            DirectClientOptions(actor=Actor(kind="agent", label="assistant"), clock=client_clock, random=random),
        )
        await client.call("probe-run", {})
        await client.call(
            "probe-run", {}, DirectCallContext(actor=Actor(kind="script"), clock=call_clock)
        )
        first, second = registry.contexts
        assert first.actor == Actor(kind="agent", label="assistant")
        assert first.clock is client_clock and first.random is random
        assert second.actor == Actor(kind="script")
        assert second.clock is call_clock and second.random is random


class TestSimpleRegistry:
    """#431: SimpleRegistry passes a context to handlers that declare one."""

    @staticmethod
    def _registry(**options: Any) -> tuple[SimpleRegistry, list[Any]]:
        registry = SimpleRegistry(**options)
        seen: list[Any] = []

        @registry.command(name="dice-roll", description="Roll a die")
        async def roll(sides: int = 6, *, context):
            seen.append(context)
            return success({"roll": 1 + int(context.random.next() * sides), "at": context.clock.now()})

        @registry.command(name="greet", description="Input only, as before")
        async def greet(name: str = "World"):
            return success({"message": f"Hello, {name}!"})

        @registry.command(name="note-add", description="An argument named context")
        async def note(context: str = ""):
            return success({"context": context})

        return registry, seen

    @pytest.mark.asyncio
    async def test_direct_client_calls_get_a_human_actor_clock_and_random(self):
        registry, seen = self._registry(clock=fixed_clock(5), random=seeded_random("abc"))
        result = await DirectClient(registry).call("dice-roll", {"sides": 6})
        assert result.data == {"roll": 1 + int(ABC_SEQUENCE[0] * 6), "at": 5}
        [context] = seen
        assert context.actor == Actor(kind="human")
        assert context.trace_id

    @pytest.mark.asyncio
    async def test_call_context_wins_and_bare_calls_get_real_sources(self):
        registry, seen = self._registry(clock=fixed_clock(5))
        call_clock = fixed_clock(9)
        await DirectClient(registry).call(
            "dice-roll", {}, DirectCallContext(actor=Actor(kind="agent"), clock=call_clock)
        )
        bare = SimpleRegistry()
        bare.register("dice-roll", registry._commands["dice-roll"].handler)
        await bare.execute("dice-roll", {})
        first, second = seen
        assert first.actor == Actor(kind="agent") and first.clock is call_clock
        assert second.clock is system_clock and second.random is system_random
        assert second.actor is None

    @pytest.mark.asyncio
    async def test_handlers_without_a_context_parameter_are_unchanged(self):
        registry, _ = self._registry()
        client = DirectClient(registry)
        assert (await client.call("greet", {"name": "Ada"})).data == {"message": "Hello, Ada!"}
        # A positional parameter named context is still an ordinary argument.
        assert (await client.call("note-add", {"context": "x"})).data == {"context": "x"}

    @pytest.mark.asyncio
    async def test_context_is_not_an_argument_name_for_handlers_that_take_it(self):
        registry, seen = self._registry()
        result = await registry.execute("dice-roll", {"context": "spoof"})
        assert not result.success
        assert result.error.code == "VALIDATION_ERROR"
        assert seen == []


class TestTestingHelpers:
    def test_create_test_context(self):
        context = create_test_context()
        assert context.actor == Actor(kind="test")
        assert context.clock is system_clock and context.random is system_random

        context = create_test_context({"now": "2026-01-01T00:00:00Z", "random": seeded_random("abc")})
        assert context.clock.now() == 1767225600000
        assert context.random.next() == ABC_SEQUENCE[0]

        clock = fixed_clock(3)
        context = create_test_context({"now": 99, "clock": clock, "actor": Actor(kind="agent")})
        assert context.clock is clock and context.actor == Actor(kind="agent")

    def test_command_context_fixture(self, command_context):
        assert command_context.actor == Actor(kind="test")
        assert command_context.clock is system_clock

    @staticmethod
    def _scenario() -> Scenario:
        return Scenario(
            name="ctx",
            description="d",
            job="ctx",
            steps=[Step(command="probe-run", expect=Expectation(success=True))] * 2,
        )

    @pytest.mark.asyncio
    async def test_scenario_steps_run_as_tests(self):
        seen: list[CommandContext] = []

        async def handler(command, input, context=None):
            seen.append(context)
            return success({"roll": context.random.next()})

        random = seeded_random("abc")
        executor = InProcessExecutor(
            InProcessExecutorConfig(handler=handler, context=CommandContext(random=random))
        )
        result = await executor.execute(self._scenario())
        assert result.outcome == "pass"
        assert [context.actor for context in seen] == [Actor(kind="test")] * 2
        assert seen[0].actor is not seen[1].actor
        assert [r.command_result["data"]["roll"] for r in result.step_results] == ABC_SEQUENCE[:2]

    @pytest.mark.asyncio
    async def test_two_argument_scenario_handlers_still_work(self):
        async def handler(command, input):
            return success({})

        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            self._scenario()
        )
        assert result.outcome == "pass"


class TestCallerContextTypes:
    """Contexts that are not the stock dataclass keep working (review of #400)."""

    @pytest.mark.asyncio
    async def test_core_registry_accepts_other_context_objects(self):
        from types import SimpleNamespace

        seen: list[Any] = []

        async def handler(input, context):
            seen.append(context)
            return success({})

        registry = create_command_registry()
        registry.register(CommandDefinition(name="probe-run", description="d", handler=handler))
        original = SimpleNamespace(trace_id="t", extra={})
        result = await registry.execute("probe-run", {}, original)
        assert result.success
        assert seen[0] is not original and seen[0].clock is system_clock
        assert not hasattr(original, "clock")

        @dataclass
        class Minimal:
            trace_id: str = "t"
            extra: dict = None  # type: ignore[assignment]

        result = await registry.execute("probe-run", {}, Minimal(extra={}))
        assert result.success

    @pytest.mark.asyncio
    async def test_server_execute_accepts_other_context_objects(self):
        from types import SimpleNamespace

        server, seen = _server_with_probe()
        result = await server.execute("probe-run", {}, SimpleNamespace(trace_id="t", extra={}))
        assert result.success and seen[0].clock is system_clock

    def test_executor_config_keeps_its_positional_order(self):
        async def handler(command, input):
            return success({})

        def on_step(step, result):
            pass

        config = InProcessExecutorConfig(handler, True, False, on_step)
        assert config.on_step_complete is on_step and config.context is None

    @pytest.mark.asyncio
    async def test_kwargs_scenario_handlers_keep_two_arguments(self):
        calls: list[tuple] = []

        async def handler(*args, **kwargs):
            calls.append((args, kwargs))
            return success({})

        await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            TestTestingHelpers._scenario()
        )
        assert all(kwargs == {} for _, kwargs in calls)
