"""``follow`` on a refused step: the runner takes the step the refusal's ``error.recovery``
describes (``spec/recovery.md``) and fails the step unless that gets further.

Mirrors ``packages/testing/src/runner/follow.test.ts`` so a scenario behaves the same under the
TypeScript and Python runners.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from afd import CommandError, Recovery, failure
from afd.testing.scenarios import (
    Expectation,
    FollowExpectation,
    InProcessExecutor,
    InProcessExecutorConfig,
    ParseError,
    Scenario,
    Step,
    parse_scenario,
    validate_scenario,
)


def world(
    recovery: dict[str, Any] | None,
    *,
    paused: bool = False,
    busy: int = 0,
    cause: dict[str, Any] | None = None,
) -> tuple[Any, dict[str, Any]]:
    """A tiny world: ``claim`` refuses a held item with a given recovery; ``list`` lists free
    items; ``resume`` unpauses; ``claim`` of a free item while unpaused succeeds. With ``busy``,
    the first that many claims are refused as BUSY; with ``cause``, a refusal carries it."""
    state: dict[str, Any] = {"paused": paused, "held": {"a"}, "calls": [], "busy": busy}

    async def handler(command: str, input: dict[str, Any] | None) -> dict[str, Any]:
        state["calls"].append(command)
        item = str((input or {}).get("item") or "")
        if command == "list":
            return {"success": True, "data": {"free": ["b"]}}
        if command == "resume":
            state["paused"] = False
            return {"success": True, "data": {}}
        if command == "claim":
            if state["busy"] or state["paused"] or item in state["held"] or item == "":
                code = "BUSY" if state["busy"] else "PAUSED" if state["paused"] else "HELD"
                state["busy"] = max(0, state["busy"] - 1)
                refusal: dict[str, Any] = {
                    "code": code,
                    "message": "Refused",
                    "suggestion": "Follow the recovery",
                }
                if recovery is not None:
                    refusal["recovery"] = recovery
                if cause is not None:
                    refusal["cause"] = cause
                return {"success": False, "error": refusal}
            state["held"].add(item)
            return {"success": True, "data": {"item": item}}
        return {"success": False, "error": {"code": "COMMAND_NOT_FOUND", "message": command}}

    return handler, state


def refused(follow: FollowExpectation | None, item: str = "a") -> Scenario:
    return Scenario(
        name="Follow",
        description="Follow a refusal",
        job="follow",
        steps=[
            Step(
                command="claim",
                input={"item": item},
                expect=Expectation(success=False),
                follow=follow,
            )
        ],
    )


async def run(recovery: dict[str, Any] | None, scenario: Scenario, paused: bool = False):
    handler, state = world(recovery, paused=paused)
    result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(scenario)
    return result.step_results[0], state["calls"]


def commands(step) -> list[str] | None:
    return [s.command for s in step.follow] if step.follow is not None else None


class TestFollow:
    async def test_calls_the_recovery_command_and_passes_when_it_succeeds(self):
        step, calls = await run({"kind": "call", "command": "list"}, refused(FollowExpectation()))
        assert step.outcome == "pass"
        assert calls == ["claim", "list"]
        assert commands(step) == ["list"]
        assert step.follow[0].step_id == "step-1.follow.1"

    async def test_judges_the_recovery_call_by_follow_expect(self):
        passing, _ = await run(
            {"kind": "call", "command": "list"},
            refused(FollowExpectation(expect=Expectation(success=True, data={"free": ["b"]}))),
        )
        assert passing.outcome == "pass"
        failing, _ = await run(
            {"kind": "call", "command": "list"},
            refused(FollowExpectation(expect=Expectation(success=True, data={"free": ["c"]}))),
        )
        assert failing.outcome == "fail"
        assert failing.error is not None
        assert failing.error.message.startswith("follow: list")

    async def test_repeats_the_refused_call_after_then_retry_and_fails_if_it_refuses_again(self):
        resumes, calls = await run(
            {"kind": "call", "command": "resume", "thenRetry": True},
            refused(FollowExpectation(), "b"),
            paused=True,
        )
        assert resumes.outcome == "pass"
        assert calls == ["claim", "resume", "claim"]

        # A recovery that does not fix the refusal leads straight back to it.
        wrong, _ = await run(
            {"kind": "call", "command": "list", "thenRetry": True},
            refused(FollowExpectation(), "b"),
            paused=True,
        )
        assert wrong.outcome == "fail"
        assert wrong.error is not None
        assert wrong.error.message == "follow: claim came back with the same PAUSED refusal"
        assert commands(wrong) == ["list", "claim"]

    async def test_repeats_the_command_with_fixed_input_and_refuses_one_it_cannot_complete(self):
        fixed, _ = await run(
            {"kind": "fix-input", "input": {"item": "b"}}, refused(FollowExpectation())
        )
        assert fixed.outcome == "pass"
        chosen, _ = await run(
            {"kind": "fix-input", "needs": ["item"]},
            refused(FollowExpectation(input={"item": "b"})),
        )
        assert chosen.outcome == "pass"
        unchosen, calls = await run(
            {"kind": "fix-input", "needs": ["item"]}, refused(FollowExpectation())
        )
        assert unchosen.outcome == "fail"
        assert unchosen.error is not None
        assert unchosen.error.message == "follow: the recovery needs item; give it in follow.input"
        assert calls == ["claim"]

    async def test_fails_a_retry_that_comes_back_with_the_same_refusal(self):
        step, _ = await run({"kind": "retry"}, refused(FollowExpectation()))
        assert step.outcome == "fail"
        assert step.error is not None
        assert step.error.message == "follow: claim came back with the same HELD refusal"

    @pytest.mark.parametrize(
        ("recovery", "message"),
        [
            (None, "follow: the HELD refusal carries no recovery to follow"),
            ({"kind": "stop"}, re.compile("stop recovery has nothing a program can follow")),
            ({"kind": "external"}, re.compile("external recovery has nothing")),
            ({"kind": "teleport"}, "follow: the HELD refusal's recovery is unreadable"),
        ],
    )
    async def test_has_nothing_to_follow_without_a_recovery_or_with_external_or_stop(
        self, recovery, message
    ):
        step, calls = await run(recovery, refused(FollowExpectation()))
        assert step.outcome == "fail"
        assert step.error is not None
        if isinstance(message, str):
            assert step.error.message == message
        else:
            assert message.search(step.error.message)
        assert calls == ["claim"]

    async def test_does_not_follow_a_step_whose_own_expectation_failed(self):
        scenario = refused(FollowExpectation())
        scenario.steps[0].expect = Expectation(success=True)
        step, calls = await run({"kind": "call", "command": "list"}, scenario)
        assert step.outcome == "fail"
        assert step.follow is None
        assert calls == ["claim"]

    async def test_refuses_follow_retry_without_a_then_retry_call(self):
        step, calls = await run(
            {"kind": "call", "command": "list"},
            refused(FollowExpectation(retry=Expectation(success=True))),
        )
        assert step.outcome == "fail"
        assert step.error is not None
        assert step.error.message == "follow: 'follow.retry' needs a call recovery with thenRetry"
        assert calls == ["claim"]

    @pytest.mark.parametrize(
        "recovery",
        [
            {"kind": "fix-input", "input": {"confirm": True, "item": "b"}},
            {"kind": "fix-input"},
            {"kind": "fix-input", "input": "b"},
            {"kind": "fix-input", "needs": [1]},
            {"kind": "call", "command": ""},
            {"kind": "call", "command": "resume", "thenRetry": "yes"},
            {"kind": "call", "command": "resume", "then_retry": True},
            {"kind": "call", "command": "list", "input": None},
            {"kind": "stop", "reason": "x"},
        ],
    )
    async def test_reads_a_recovery_exactly_as_a_client_does(self, recovery):
        """Rule 7: a recovery that breaks ``$defs/recovery`` is none, to a follower too."""
        step, calls = await run(recovery, refused(FollowExpectation(input={"item": "b"})))
        assert step.error is not None
        assert step.error.message == "follow: the HELD refusal's recovery is unreadable"
        assert calls == ["claim"]

    async def test_refuses_a_recovery_that_both_sets_and_needs_a_field(self):
        step, calls = await run(
            {"kind": "fix-input", "input": {"item": "b"}, "needs": ["item"]},
            refused(FollowExpectation(input={"item": "b"})),
        )
        assert step.error is not None
        assert step.error.message == "follow: the recovery names item in both input and needs"
        assert calls == ["claim"]

    async def test_follow_input_gives_only_what_the_recovery_leaves_to_the_caller(self):
        # A wrong recovery stays wrong: the scenario cannot overwrite what it says.
        step, calls = await run(
            {"kind": "fix-input", "input": {"item": "a"}},
            refused(FollowExpectation(input={"item": "b"})),
        )
        assert step.error is not None
        assert step.error.message == (
            "follow: follow.input gives item, which the recovery does not leave to the caller"
        )
        assert calls == ["claim"]

    async def test_a_same_refusal_fails_even_when_follow_expect_expects_it(self):
        step, _ = await run(
            {"kind": "retry"},
            refused(FollowExpectation(expect=Expectation(success=False, error={"code": "HELD"}))),
        )
        assert step.outcome == "fail"
        assert step.error is not None
        assert step.error.message == "follow: claim came back with the same HELD refusal"

    async def test_a_retry_passes_when_the_repeated_call_gets_through(self):
        handler, state = world({"kind": "retry"}, busy=1)
        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            refused(FollowExpectation(), "b")
        )
        assert result.step_results[0].outcome == "pass"
        assert state["calls"] == ["claim", "claim"]

    async def test_reads_a_null_recovery_as_none(self):
        async def handler(command: str, input: dict[str, Any] | None) -> dict[str, Any]:
            return {
                "success": False,
                "error": {"code": "HELD", "message": "Refused", "recovery": None},
            }

        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            refused(FollowExpectation())
        )
        step = result.step_results[0]
        assert step.error is not None
        assert step.error.message == "follow: the HELD refusal carries no recovery to follow"

    async def test_never_follows_a_cause_s_recovery(self):
        """Rule 8: a cause's recovery describes the cause, and may come from another surface."""
        cause = {"code": "INNER", "message": "x", "recovery": {"kind": "call", "command": "list"}}
        handler, state = world(None, cause=cause)
        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            refused(FollowExpectation())
        )
        step = result.step_results[0]
        assert step.error is not None
        assert step.error.message == "follow: the HELD refusal carries no recovery to follow"
        assert state["calls"] == ["claim"]

    async def test_resolves_step_references_in_follow_input(self):
        handler, state = world({"kind": "fix-input", "needs": ["item"]})
        scenario = Scenario(
            name="Follow",
            description="Follow with a value from an earlier step",
            job="follow",
            steps=[
                Step(command="list", expect=Expectation(success=True)),
                Step(
                    command="claim",
                    input={"item": "a"},
                    expect=Expectation(success=False),
                    follow=FollowExpectation(input={"item": "${{ steps[0].data.free[0] }}"}),
                ),
            ],
        )
        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(scenario)
        assert result.step_results[1].outcome == "pass", result.step_results[1].error
        assert state["held"] == {"a", "b"}

    async def test_follows_a_recovery_from_a_typed_command_error(self):
        """A handler returning ``afd`` result models is read in its wire form (``thenRetry``)."""
        state = {"paused": True}

        async def handler(command: str, input: dict[str, Any] | None):
            if command == "resume":
                state["paused"] = False
                return {"success": True, "data": {}}
            if state["paused"]:
                return failure(
                    CommandError(
                        code="PAUSED",
                        message="Refused",
                        suggestion="Call resume, then claim again",
                        recovery=Recovery(kind="call", command="resume", then_retry=True),
                    )
                )
            return {"success": True, "data": {"item": "b"}}

        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            refused(FollowExpectation(), "b")
        )
        step = result.step_results[0]
        assert step.outcome == "pass", step.error
        assert commands(step) == ["resume", "claim"]


YAML = """
name: Follow
description: Follow a refusal
job: follow
steps:
  - command: claim
    input: {{ item: a }}
    expect:
      success: false
      error:
        code: HELD
        recovery: {recovery}
    follow:{follow}
"""


def yaml(follow: str, recovery: str = "{ kind: call, command: list }") -> str:
    return YAML.format(follow=follow, recovery=recovery)


class TestFollowYaml:
    async def test_parses_follow_and_checks_error_recovery_like_data(self):
        parsed = parse_scenario(yaml(" { expect: { success: true, data: { free: [b] } } }"))
        assert parsed.success, parsed
        scenario = parsed.scenario
        assert scenario.steps[0].follow == FollowExpectation(
            expect=Expectation(success=True, data={"free": ["b"]})
        )

        handler, _ = world({"kind": "call", "command": "list"})
        ok = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(scenario)
        assert ok.outcome == "pass"

        handler, _ = world({"kind": "call", "command": "resume"})
        wrong = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(scenario)
        assert wrong.step_results[0].outcome == "fail"
        failed = next(a for a in wrong.step_results[0].assertions if not a.passed)
        assert failed.path == "error.recovery.command"

    async def test_an_absent_recovery_fails_error_recovery(self):
        parsed = parse_scenario(yaml(" true"))
        assert parsed.success, parsed
        handler, _ = world(None)
        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            parsed.scenario
        )
        step = result.step_results[0]
        assert step.outcome == "fail"
        failed = [a for a in step.assertions if not a.passed]
        assert [a.path for a in failed] == ["error.recovery"]
        # Not followed: the step's own expectation failed.
        assert step.follow is None

    def test_accepts_follow_true_and_refuses_follow_on_success_or_with_unknown_keys(self):
        accepted = parse_scenario(yaml(" true"))
        assert accepted.success
        assert accepted.scenario.steps[0].follow == FollowExpectation()

        on_success = parse_scenario(
            re.sub(
                r" {6}error:[\s\S]*?\n {4}follow",
                "    follow",
                yaml(" true").replace("success: false", "success: true"),
            )
        )
        assert isinstance(on_success, ParseError)
        assert on_success.error == (
            "Step 1 'follow' needs a refusal to follow: set 'expect.success' to false"
        )

        unknown = parse_scenario(yaml(" { expct: { success: true } }"))
        assert isinstance(unknown, ParseError)
        assert unknown.error == (
            "Unknown field 'expct' in step 1 'follow' (allowed: input, expect, retry)"
        )

        not_an_object = parse_scenario(yaml(" true", "[call]"))
        assert isinstance(not_an_object, ParseError)
        assert "'error.recovery' must be an object" in not_an_object.error

    def test_parses_follow_input_and_retry_and_refuses_malformed_ones(self):
        parsed = parse_scenario(
            yaml(" { input: { item: b }, retry: { success: false, error: { code: HELD } } }")
        )
        assert parsed.success, parsed
        follow = parsed.scenario.steps[0].follow
        assert follow is not None
        assert follow.input == {"item": "b"}
        assert follow.expect is None
        assert follow.retry == Expectation(success=False, error={"code": "HELD", "message": None})

        assert isinstance(parse_scenario(yaml(" 3")), ParseError)
        assert isinstance(parse_scenario(yaml(" { input: [b] }")), ParseError)
        assert isinstance(parse_scenario(yaml(" { expect: { data: {} } }")), ParseError)

    async def test_error_recovery_fails_on_a_recovery_no_reader_keeps(self):
        parsed = parse_scenario(yaml(" true"))
        assert parsed.success, parsed
        handler, _ = world({"kind": "call", "command": "list", "bogus": 1})
        result = await InProcessExecutor(InProcessExecutorConfig(handler=handler)).execute(
            parsed.scenario
        )
        failed = [a for a in result.step_results[0].assertions if not a.passed]
        assert [(a.path, a.matcher) for a in failed] == [("error.recovery", "readable")]
        # The message says why, not just "expected X, got Y" for values that look alike.
        assert result.step_results[0].error.message.startswith(
            "error.recovery is unreadable: it breaks $defs/recovery"
        )
        # The value prints as the TypeScript runner prints it: JSON without spaces.
        assert result.step_results[0].error.message.endswith(
            '; got {"kind":"call","command":"list","bogus":1}'
        )

    def test_reports_every_expectation_problem_recovery_first_as_typescript_does(self):
        scenario = """
name: t
description: t
job: t
steps:
  - command: add
    expect:
      success: false
      error:
        suggestion: { contains: 3 }
        recovery: RECOVERY
"""
        both = parse_scenario(scenario.replace("RECOVERY", "5"))
        assert isinstance(both, ParseError)
        assert both.error.startswith(
            "Step 1: 'error.recovery' must be an object of the recovery fields to check; "
        )
        assert "error.suggestion" in both.error
        nested = parse_scenario(
            scenario.replace("RECOVERY", "{ command: { contains: 5 } }").replace(
                "suggestion: { contains: 3 }", "suggestion: list"
            )
        )
        assert isinstance(nested, ParseError)
        assert nested.error == (
            "Step 1: Invalid assertion at error.recovery.command: 'contains' expects a string"
        )
        mixed = parse_scenario(
            scenario.replace("RECOVERY", "{ command: { contains: list, matchs: x } }").replace(
                "suggestion: { contains: 3 }", "suggestion: list"
            )
        )
        assert isinstance(mixed, ParseError)
        # Word for word what the TypeScript runner says, its matcher keys in its order.
        assert mixed.error == (
            "Step 1: Invalid assertion at error.recovery.command: 'contains' is a matcher key but "
            "'matchs' is not. Use only matcher keys (equals, contains, matches, exists, notExists, "
            "length, includes, gte, lte, between), or nest field assertions in their own object. "
            "To compare against a literal object, use { equals: ... }."
        )
        # As in TypeScript, the top of the recovery holds fields, never a matcher.
        for fields in ("{ exists: yes }", "{ kind: call, equals: 1 }"):
            parsed = parse_scenario(
                scenario.replace("RECOVERY", fields).replace(
                    "suggestion: { contains: 3 }", "suggestion: list"
                )
            )
            assert parsed.success, (fields, parsed)
        # Mixed keys are reported as mixed, whatever else the object holds.
        mixed_alias = parse_scenario(
            scenario.replace("RECOVERY", "{ command: { not_exists: true, equals: 1 } }").replace(
                "suggestion: { contains: 3 }", "suggestion: list"
            )
        )
        assert isinstance(mixed_alias, ParseError)
        assert "'equals' is a matcher key but 'not_exists' is not." in mixed_alias.error
        # Python's not_exists alias is a field name to the TypeScript runner, so it is refused.
        alias = parse_scenario(
            scenario.replace("RECOVERY", "{ command: { not_exists: true } }").replace(
                "suggestion: { contains: 3 }", "suggestion: list"
            )
        )
        assert isinstance(alias, ParseError)
        assert alias.error == (
            "Step 1: Invalid assertion at error.recovery.command: 'not_exists' is a field name to "
            "the TypeScript runner; use 'notExists'"
        )
        # Matcher values are judged as the TypeScript runner judges them.
        for good in ("{ length: 2.0 }", "{ gte: 1 }"):
            parsed = parse_scenario(
                scenario.replace("RECOVERY", f"{{ command: {good} }}").replace(
                    "suggestion: { contains: 3 }", "suggestion: list"
                )
            )
            assert parsed.success, (good, parsed)
        for bad in (
            "{ gte: .inf }",
            "{ between: [0, .inf] }",
            "{ length: 2.5 }",
            "{ length: 1" + "0" * 400 + " }",
        ):
            parsed = parse_scenario(
                scenario.replace("RECOVERY", f"{{ command: {bad} }}").replace(
                    "suggestion: { contains: 3 }", "suggestion: list"
                )
            )
            assert isinstance(parsed, ParseError), bad

    def test_names_follow_expect_and_retry_in_their_parse_errors(self):
        no_success = parse_scenario(yaml(" { expect: { data: {} } }"))
        assert isinstance(no_success, ParseError)
        assert no_success.error == "Step 1 'follow.expect' must have a boolean 'success' field"
        retry = parse_scenario(yaml(" { retry: 3 }"))
        assert isinstance(retry, ParseError)
        assert retry.error == "Step 1 'follow.retry' must be an object"

    def test_validate_scenario_checks_follow(self):
        scenario = Scenario(
            name="Follow",
            description="Follow checks",
            job="follow",
            steps=[
                Step(
                    command="claim",
                    expect=Expectation(success=True),
                    follow=FollowExpectation(input={"item": "${{ steps[0].data.x }}"}),
                )
            ],
        )
        errors = validate_scenario(scenario).errors
        assert "Step 1 'follow' needs a refusal to follow: set 'expect.success' to false" in errors
        assert "Step 1: Invalid reference to step 0 (can only reference earlier steps)" in errors

    def test_a_step_without_follow_has_none(self):
        parsed = parse_scenario(yaml(" false"))
        assert parsed.success
        assert parsed.scenario.steps[0].follow is None
