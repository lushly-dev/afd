"""Private in-process approval against the real signed-token middleware (#460)."""

import asyncio

import pytest

from afd import Actor, fixed_clock, success
from afd.core.commands import CommandDefinition
from afd.direct import DirectCallContext, DirectClient, DirectClientOptions
from afd.server import create_approval_middleware

SECRET = "test-private-approval-secret-0123456789abcdef"


class Registry:
    def __init__(self, **options):
        self.ran = 0
        self.observed = []
        self.requests = []
        self.clock = fixed_clock(1761480000000)
        command = CommandDefinition(name="item-delete", description="Delete item", handler=self.handler,
                                    approval="required")
        self.gate = create_approval_middleware(secret=SECRET, commands=[command], clock=self.clock,
            on_approval_required=self.requests.append, **options)

    async def handler(self, args, context):
        self.ran += 1
        return success(args)

    async def execute(self, name, args, context):
        result = await self.gate(name, args, context, lambda: self.handler(args, context))
        self.observed.append(result)
        return result

    def has_command(self, name):
        return name == "item-delete"

    def list_command_names(self):
        return ["item-delete"]


def held(result):
    assert not result.success and result.error.code == "APPROVAL_REQUIRED"
    assert "approvalToken" not in result.error.details


async def test_direct_hold_and_public_context_cannot_approve():
    registry = Registry()
    client = DirectClient(registry)
    held(await client.call("item-delete", {"id": 1}))
    token = registry.requests[-1].approval_token
    held(await client.call("item-delete", {"id": 1}, DirectCallContext(approval=token)))
    assert registry.ran == 0
    assert all("approvalToken" not in r.error.details for r in registry.observed)


@pytest.mark.parametrize("answer", [True, False, None, 1, "yes", "raise"])
async def test_hook_explicit_decision_and_token_free_metadata(answer):
    registry = Registry(include_token=True)
    seen = []

    async def decide(request):
        seen.append(request)
        assert not hasattr(request, "approval_token")
        request.input["id"] = 999  # A decision cannot mutate the retried input.
        if answer == "raise":
            raise RuntimeError("hook failed")
        return answer

    result = await DirectClient(registry, DirectClientOptions(on_approval_needed=decide)).call(
        "item-delete", {"id": 1})
    assert len(seen) == 1
    if answer is True:
        assert result.success and result.data == {"id": 1} and registry.ran == 1
    else:
        held(result)
        assert registry.ran == 0
    assert all(not r.error or "approvalToken" not in (r.error.details or {}) for r in registry.observed)


async def test_expiry_has_one_retry_and_does_not_reprompt():
    registry = Registry(ttl_ms=1)
    calls = []

    def decide(request):
        calls.append(request)
        registry.clock.advance(2)
        return True

    result = await DirectClient(registry, DirectClientOptions(on_approval_needed=decide)).call("item-delete", {})
    held(result)
    assert result.error.details["reason"] == "expired"
    assert len(calls) == 1 and len(registry.observed) == 2 and registry.ran == 0


async def test_deadline_covers_human_wait_and_late_answer_cannot_retry():
    registry = Registry()
    entered = asyncio.Event()
    released = asyncio.Event()

    async def decide(_request):
        entered.set()
        try:
            await released.wait()
        except asyncio.CancelledError:
            await released.wait()
        return True

    result = await DirectClient(registry, DirectClientOptions(on_approval_needed=decide)).call(
        "item-delete", {}, DirectCallContext(timeout=10))
    assert entered.is_set() and result.error.code == "TIMEOUT"
    released.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert registry.ran == 0
    assert all("approvalToken" not in r.error.details for r in registry.observed)


async def test_parallel_decisions_do_not_share_credentials():
    registry = Registry()

    async def decide(request):
        await asyncio.sleep(0)
        return request.input["id"] == 1

    client = DirectClient(registry, DirectClientOptions(on_approval_needed=decide))
    approved, denied = await asyncio.gather(client.call("item-delete", {"id": 1}),
                                          client.call("item-delete", {"id": 2}))
    assert approved.success
    held(denied)
    assert registry.ran == 1


async def test_validating_registry_raw_boundary_and_pipeline():
    from afd.direct import create_direct_registry
    from afd.server import define_command

    ran = []

    @define_command(name="item-delete", description="Delete", approval="required")
    async def command(input):
        ran.append(input)
        return success(input)

    requests = []
    gate = create_approval_middleware(secret=SECRET, commands=[command], on_approval_required=requests.append)
    registry = create_direct_registry([command], middleware=[gate])
    held(await registry.execute("item-delete", {"id": 1}))
    held(await registry.execute("item-delete", {"id": 1},
                               DirectCallContext(approval=requests[-1].approval_token)))
    client = DirectClient(registry, DirectClientOptions(on_approval_needed=lambda _: True))
    result = await client.pipe([{"command": "item-delete", "input": {"id": 1}}])
    assert result.success and ran == [{"id": 1}]
    # Public replay is still held after a successful approved call.
    held(await DirectClient(registry).call("item-delete", {"id": 1},
        DirectCallContext(approval=requests[-1].approval_token)))


async def test_legacy_registry_does_not_activate_hook():
    from afd import failure
    from afd.core.result import CommandError

    registry = Registry()

    async def execute(*_args):
        return failure(CommandError(code="APPROVAL_REQUIRED", message="held", suggestion="ask",
            details={"approvalToken": "legacy-token", "summary": "Do it", "expiresAt": "later"}))

    registry.execute = execute
    calls = []
    result = await DirectClient(registry, DirectClientOptions(on_approval_needed=calls.append)).call("item-delete", {})
    held(result)
    assert not calls


async def test_real_registry_observer_and_journal_are_token_free():
    from afd import MemoryJournalSink, serialize_journal_entry
    from afd.direct import create_direct_registry
    from afd.server import define_command, create_journal_middleware

    @define_command(name="item-delete", description="Delete", approval="required")
    async def command(input):
        return success(input)

    seen = []
    sink = MemoryJournalSink()

    async def observe(name, input, context, next_fn):
        result = await next_fn()
        seen.append(result)
        return result

    gate = create_approval_middleware(secret=SECRET, commands=[command], include_token=True)
    registry = create_direct_registry([command], middleware=[observe,
        create_journal_middleware(sink, record_failures=True), gate])
    held(await DirectClient(registry).call("item-delete", {}))
    [entry] = await sink.read()
    assert "approvalToken" not in serialize_journal_entry(entry)
    assert all("approvalToken" not in r.error.details for r in seen)


async def test_caller_cancellation_during_decision_never_retries():
    registry = Registry()
    entered = asyncio.Event()

    async def decide(_request):
        entered.set()
        await asyncio.Event().wait()
        return True

    task = asyncio.create_task(DirectClient(registry, DirectClientOptions(on_approval_needed=decide)).call("item-delete", {}))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert registry.ran == 0 and len(registry.observed) == 1


async def test_cancellation_resistant_hook_without_timeout_never_authorizes():
    registry = Registry()
    entered = asyncio.Event()
    finished = asyncio.Event()

    async def decide(_request):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return True
        finally:
            finished.set()

    task = asyncio.create_task(DirectClient(registry, DirectClientOptions(on_approval_needed=decide)).call("item-delete", {}))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await finished.wait()
    assert registry.ran == 0


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_blocking_hook_cannot_approve_after_deadline(asynchronous):
    import time

    registry = Registry()

    def blocking(_request):
        time.sleep(0.02)
        return True

    async def blocking_async(request):
        return blocking(request)

    hook = blocking_async if asynchronous else blocking
    result = await DirectClient(registry, DirectClientOptions(on_approval_needed=hook)).call(
        "item-delete", {}, DirectCallContext(timeout=1))
    assert result.error and result.error.code == "TIMEOUT"
    assert registry.ran == 0


@pytest.mark.parametrize("meta,input", [
    ("afd-call", {"command": "item-delete", "input": {}}),
    ("afd-batch", {"commands": [{"command": "item-delete", "input": {}}]}),
    ("afd-pipe", {"steps": [{"command": "item-delete", "input": {}}]}),
])
async def test_raw_registry_cannot_route_mcp_meta_tools(meta, input):
    from afd import ExposeOptions, MemoryJournalSink, serialize_journal_entry
    from afd.direct import create_direct_registry
    from afd.server import define_command, create_journal_middleware

    ran = []
    observed = []

    @define_command(name="item-delete", description="MCP only", approval="required",
                    expose=ExposeOptions(agent=False, mcp=True))
    async def command(input):
        ran.append(input)
        return success(input)

    sink = MemoryJournalSink()

    async def observe(name, input, context, next_fn):
        result = await next_fn()
        observed.append(result)
        return result

    registry = create_direct_registry([command], middleware=[observe,
        create_journal_middleware(sink, record_failures=True),
        create_approval_middleware(secret=SECRET, commands=[command], include_token=True)])
    result = await registry.execute(meta, input)
    assert result.error.code == "COMMAND_NOT_FOUND"
    assert not observed and not ran
    assert not await sink.read()
    hidden = await registry.execute("item-delete", {})
    assert hidden.error.code == "COMMAND_NOT_EXPOSED"
