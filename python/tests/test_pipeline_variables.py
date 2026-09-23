"""Conformance tests for spec/pipeline-variables.md.

Each rule of the spec has a test here, for the core resolver
(``afd.core.pipeline``), the ``afd-pipe`` server tool and ``DirectClient.pipe``.
"""

from typing import Any, Dict, List

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.errors import CommandError
from afd.core.pipeline import (
    PipelineContext,
    PipelineRequest,
    PipelineStep,
    StepResult,
    StepStatus,
    evaluate_condition,
    execute_pipeline,
    resolve_variable,
    resolve_variables,
)
from afd.core.pipeline_variables import MAX_INPUT_DEPTH, MAX_REFERENCE_LENGTH, parse_reference
from afd.core.result import CommandResult, failure
from afd.direct import DirectClient, SimpleRegistry
from afd.server import create_server


def _step(index: int, data: Any, *, alias: str = None, status: StepStatus = StepStatus.SUCCESS):
    return StepResult(index=index, alias=alias, command=f"cmd-{index}", status=status, data=data)


def _context(*steps: StepResult, pipeline_input: Dict[str, Any] = None) -> PipelineContext:
    context = PipelineContext(pipeline_input=pipeline_input, steps=list(steps))
    successful = [step for step in steps if step.status == StepStatus.SUCCESS]
    context.previous_result = successful[-1] if successful else None
    return context


def _nested(levels: int) -> Dict[str, Any]:
    """An object whose containers nest ``levels`` deep (the object itself is level 1)."""
    value: Dict[str, Any] = {}
    for _ in range(levels - 1):
        value = {"a": value}
    return value


CONTEXT = _context(
    _step(0, {"user": {"id": 7, "tags": ["a", "b"], "_id": "u7"}, "items": [10, 20, 30]}, alias="first"),
    _step(1, {"id": "todo-1", "title": "Buy milk", "count": 3, "done": False, "note": None}, alias="todo"),
    pipeline_input={"userId": 42, "filters": {"status": "open"}},
)


# ═══════════════════════════════════════════════════════════════════════════════
# REFERENCE FORMS
# ═══════════════════════════════════════════════════════════════════════════════


class TestReferenceForms:
    @pytest.mark.parametrize(
        ("reference", "expected"),
        [
            ("$prev", {"id": "todo-1", "title": "Buy milk", "count": 3, "done": False, "note": None}),
            ("$prev.title", "Buy milk"),
            ("$prev.note", None),
            ("$first.user.id", 7),
            ("$first.user.tags[1]", "b"),
            ("$first.items.2", 30),
            ("$steps[0].user.tags.0", "a"),
            ("$steps[1]", {"id": "todo-1", "title": "Buy milk", "count": 3, "done": False, "note": None}),
            ("$steps.todo.id", "todo-1"),
            ("$steps.first.items[0]", 10),
            ("$input", {"userId": 42, "filters": {"status": "open"}}),
            ("$input.filters.status", "open"),
        ],
    )
    def test_forms_resolve(self, reference, expected):
        assert resolve_variable(reference, CONTEXT) == expected

    def test_single_underscore_keys_resolve(self):
        assert resolve_variable("$first.user._id", CONTEXT) == "u7"

    def test_numeric_segment_is_a_key_on_objects(self):
        context = _context(_step(0, {"2": "two", "list": ["x", "y", "z"]}))
        assert resolve_variable("$prev.2", context) == "two"
        assert resolve_variable("$prev.list.2", context) == "z"

    def test_prev_is_the_most_recent_successful_step(self):
        context = PipelineContext(steps=[_step(0, {"v": "ok"})])
        context.previous_result = context.steps[0]
        failed = _step(1, None, status=StepStatus.FAILURE)
        context.steps.append(failed)
        assert resolve_variable("$prev.v", context) == "ok"


# ═══════════════════════════════════════════════════════════════════════════════
# LITERALS AND ESCAPING
# ═══════════════════════════════════════════════════════════════════════════════


class TestLiterals:
    @pytest.mark.parametrize(
        "literal",
        [
            "$9.99",
            "$HOME",
            "$prevx",
            "$firsts",
            "$steps",
            "$steps[x]",
            "$steps[0][1]",
            "$steps.user[0]",
            "$prev.",
            "$prev..title",
            "$prev.a b",
            "$prev.items[1][2]",
            "$prev.items[-1]",
            "$",
            "plain text",
            "",
        ],
    )
    def test_non_references_pass_through_unchanged(self, literal):
        assert parse_reference(literal) is None
        assert resolve_variable(literal, CONTEXT) == literal
        assert resolve_variables({"value": literal}, CONTEXT) == {"value": literal}

    @pytest.mark.parametrize(
        ("escaped", "literal"),
        [("$$prev", "$prev"), ("$$9.99", "$9.99"), ("$$$x", "$$x"), ("$$", "$")],
    )
    def test_double_dollar_escapes(self, escaped, literal):
        assert resolve_variable(escaped, CONTEXT) == literal
        assert resolve_variables({"value": [escaped]}, CONTEXT) == {"value": [literal]}

    def test_escape_applies_at_any_length(self):
        long_escape = "$$" + "x" * (MAX_REFERENCE_LENGTH + 10)
        assert resolve_variable(long_escape, CONTEXT) == long_escape[1:]

    def test_overlong_reference_is_a_literal(self):
        overlong = "$prev." + "a" * MAX_REFERENCE_LENGTH
        assert len(overlong) > MAX_REFERENCE_LENGTH
        assert resolve_variable(overlong, CONTEXT) == overlong

    def test_reference_at_the_length_limit_resolves(self):
        key = "k" * (MAX_REFERENCE_LENGTH - len("$prev."))
        context = _context(_step(0, {key: "v"}))
        assert resolve_variable(f"$prev.{key}", context) == "v"

    def test_references_are_not_interpolated(self):
        assert resolve_variable("id=$prev.id", CONTEXT) == "id=$prev.id"


# ═══════════════════════════════════════════════════════════════════════════════
# WHAT A PATH MAY REACH
# ═══════════════════════════════════════════════════════════════════════════════


class Profile(BaseModel):
    name: str
    secret_note: str = "hidden"


class TestReach:
    @pytest.mark.parametrize(
        "reference",
        [
            "$prev.__proto__",
            "$prev.__class__",
            "$prev.__class__.__init__.__globals__",
            "$prev.constructor",
            "$prev.constructor.constructor",
            "$prev.model_dump",
            "$prev.model_config",
            "$steps.__proto__",
            "$steps.__class__.name",
        ],
    )
    def test_dangerous_paths_are_unresolved(self, reference):
        context = _context(_step(0, Profile(name="Ada"), alias="__class__"))
        assert resolve_variable(reference, context) is None
        assert resolve_variables({"value": reference}, context) == {}

    def test_dunder_keys_in_json_never_resolve(self):
        context = _context(_step(0, {"__proto__": {"polluted": True}, "__x": 1}))
        assert resolve_variable("$prev.__proto__.polluted", context) is None
        assert resolve_variable("$prev.__x", context) is None

    def test_models_are_read_as_json(self):
        context = _context(_step(0, Profile(name="Ada")))
        assert resolve_variable("$prev.name", context) == "Ada"
        assert resolve_variable("$prev", context) == {"name": "Ada", "secret_note": "hidden"}

    def test_out_of_bounds_index_is_unresolved(self):
        assert resolve_variable("$first.items[3]", CONTEXT) is None
        assert resolve_variable("$first.items.99", CONTEXT) is None
        assert resolve_variable("$steps[5]", CONTEXT) is None
        assert resolve_variables({"a": "$first.items[3]", "b": 1}, CONTEXT) == {"b": 1}

    def test_index_on_non_array_is_unresolved(self):
        assert resolve_variable("$prev.title[0]", CONTEXT) is None
        assert resolve_variable("$prev.title.0", CONTEXT) is None


# ═══════════════════════════════════════════════════════════════════════════════
# $input
# ═══════════════════════════════════════════════════════════════════════════════


class TestInput:
    def test_input_with_request_input(self):
        assert resolve_variable("$input.userId", CONTEXT) == 42

    def test_input_without_request_input_is_unresolved(self):
        context = _context(_step(0, {"id": 1}))
        assert resolve_variable("$input", context) is None
        assert resolve_variables({"user": "$input.userId", "keep": 1}, context) == {"keep": 1}


# ═══════════════════════════════════════════════════════════════════════════════
# UNRESOLVED REFERENCES
# ═══════════════════════════════════════════════════════════════════════════════


class TestUnresolved:
    def test_unresolved_alias(self):
        assert resolve_variable("$steps.missing", CONTEXT) is None
        assert resolve_variable("$steps.missing.id", CONTEXT) is None

    def test_omitted_from_objects_and_null_in_lists(self):
        resolved = resolve_variables(
            {
                "id": "$prev.id",
                "gone": "$prev.nope",
                "nested": {"alias": "$steps.missing", "kept": "$first.user.id"},
                "list": ["$prev.id", "$steps.missing", "$prev.note"],
            },
            CONTEXT,
        )
        assert resolved == {
            "id": "todo-1",
            "nested": {"kept": 7},
            "list": ["todo-1", None, None],
        }

    def test_present_null_is_kept_in_objects(self):
        assert resolve_variables({"note": "$prev.note"}, CONTEXT) == {"note": None}

    @pytest.mark.parametrize("status", [StepStatus.FAILURE, StepStatus.SKIPPED])
    def test_failed_and_skipped_steps_are_unresolved(self, status):
        context = _context(_step(0, {"id": 1}, alias="x", status=status))
        assert resolve_variable("$first", context) is None
        assert resolve_variable("$steps[0].id", context) is None
        assert resolve_variable("$steps.x", context) is None
        assert resolve_variable("$prev", context) is None


# ═══════════════════════════════════════════════════════════════════════════════
# WHEN CONDITIONS
# ═══════════════════════════════════════════════════════════════════════════════


class TestConditions:
    @pytest.mark.parametrize(
        "condition",
        [
            {"$exists": "$prev.nope"},
            {"$exists": "$steps.missing"},
            {"$eq": ["$prev.nope", None]},
            {"$ne": ["$prev.nope", 1]},
            {"$gt": ["$prev.nope", 0]},
            {"$gte": ["$prev.nope", 0]},
            {"$lt": ["$prev.nope", 0]},
            {"$lte": ["$prev.nope", 0]},
        ],
    )
    def test_unresolved_operands_are_false(self, condition):
        assert evaluate_condition(condition, CONTEXT) is False

    def test_not_of_unresolved_exists_is_true(self):
        assert evaluate_condition({"$not": {"$exists": "$prev.nope"}}, CONTEXT) is True

    def test_exists_is_false_for_null(self):
        assert evaluate_condition({"$exists": "$prev.note"}, CONTEXT) is False
        assert evaluate_condition({"$exists": "$prev.title"}, CONTEXT) is True

    def test_eq_compares_json_values_structurally(self):
        assert evaluate_condition({"$eq": ["$first.user.tags", ["a", "b"]]}, CONTEXT) is True
        assert evaluate_condition({"$eq": ["$input.filters", {"status": "open"}]}, CONTEXT) is True
        assert evaluate_condition({"$ne": ["$first.user.tags", ["a", "b"]]}, CONTEXT) is False
        assert evaluate_condition({"$eq": ["$prev.note", None]}, CONTEXT) is True

    def test_booleans_are_not_numbers(self):
        context = _context(_step(0, {"flag": True, "one": 1}))
        assert evaluate_condition({"$eq": ["$prev.flag", 1]}, context) is False
        assert evaluate_condition({"$eq": ["$prev.one", True]}, context) is False
        assert evaluate_condition({"$gt": ["$prev.flag", 0]}, context) is False
        assert evaluate_condition({"$gt": ["$prev.one", 0]}, context) is True

    def test_comparisons(self):
        assert evaluate_condition({"$gte": ["$prev.count", 3]}, CONTEXT) is True
        assert evaluate_condition({"$lt": ["$prev.count", 3]}, CONTEXT) is False
        assert evaluate_condition(
            {"$and": [{"$exists": "$prev.id"}, {"$or": [{"$eq": ["$prev.done", True]}, {"$lte": ["$prev.count", 5]}]}]},
            CONTEXT,
        ) is True

    def test_dunder_condition_is_not_an_oracle(self):
        context = _context(_step(0, Profile(name="Ada")))
        assert evaluate_condition({"$exists": "$prev.__class__"}, context) is False
        assert evaluate_condition({"$eq": ["$prev.__class__.__name__", "Profile"]}, context) is False


# ═══════════════════════════════════════════════════════════════════════════════
# LIMITS AND EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════


class _Recorder:
    def __init__(self, data: Any = None):
        self.calls: List[tuple] = []
        self.data = data

    async def __call__(self, command: str, payload: Dict[str, Any]) -> CommandResult:
        self.calls.append((command, payload))
        return success(self.data if self.data is not None else payload)


class TestExecutePipelineLimits:
    @pytest.mark.asyncio
    async def test_65_level_step_input_is_rejected_before_any_step_runs(self):
        executor = _Recorder()
        request = PipelineRequest(
            steps=[
                PipelineStep(command="first", input={"ok": True}),
                PipelineStep(command="deep", input=_nested(MAX_INPUT_DEPTH + 1)),
            ]
        )

        result = await execute_pipeline(request, executor)

        assert executor.calls == []
        assert len(result.steps) == 1
        assert result.steps[0].status == StepStatus.FAILURE
        assert result.steps[0].error.code == "VALIDATION_ERROR"
        assert result.steps[0].error.suggestion
        assert result.steps[0].error.details == {"stepIndex": 1, "maxDepth": MAX_INPUT_DEPTH}

    @pytest.mark.asyncio
    async def test_64_level_step_input_is_accepted(self):
        executor = _Recorder()
        request = PipelineRequest(steps=[PipelineStep(command="deep", input=_nested(MAX_INPUT_DEPTH))])

        result = await execute_pipeline(request, executor)

        assert len(executor.calls) == 1
        assert result.steps[0].status == StepStatus.SUCCESS

    @pytest.mark.asyncio
    async def test_65_level_request_input_is_rejected(self):
        executor = _Recorder()
        request = PipelineRequest(
            steps=[PipelineStep(command="one", input={"v": "$input"})],
            input=_nested(MAX_INPUT_DEPTH + 1),
        )

        result = await execute_pipeline(request, executor)

        assert executor.calls == []
        assert result.steps[0].error.code == "VALIDATION_ERROR"

    @pytest.mark.asyncio
    async def test_deep_list_nesting_counts_too(self):
        deep: Any = []
        for _ in range(MAX_INPUT_DEPTH):
            deep = [deep]
        executor = _Recorder()

        result = await execute_pipeline(
            PipelineRequest(steps=[PipelineStep(command="x", input={"v": deep})]), executor
        )

        assert executor.calls == []
        assert result.steps[0].error.code == "VALIDATION_ERROR"

    @pytest.mark.asyncio
    async def test_malformed_when_is_rejected_before_any_step_runs(self):
        executor = _Recorder()
        request = PipelineRequest(
            steps=[
                PipelineStep(command="one"),
                PipelineStep(command="two", when={"$gt": ["$prev.count", "many"]}),
            ]
        )

        result = await execute_pipeline(request, executor)

        assert executor.calls == []
        assert result.steps[0].error.code == "VALIDATION_ERROR"
        assert "$gt" in result.steps[0].error.message

    @pytest.mark.asyncio
    async def test_input_reference_uses_request_input(self):
        executor = _Recorder()
        request = PipelineRequest(
            steps=[PipelineStep(command="one", input={"user": "$input.userId", "none": "$input.missing"})],
            input={"userId": 5},
        )

        await execute_pipeline(request, executor)

        assert executor.calls == [("one", {"user": 5})]

    @pytest.mark.asyncio
    async def test_when_over_unresolved_path_skips_the_step(self):
        executor = _Recorder(data={"id": 1})
        request = PipelineRequest(
            steps=[
                PipelineStep(command="one"),
                PipelineStep(command="two", when={"$exists": "$prev.missing"}),
            ]
        )

        result = await execute_pipeline(request, executor)

        assert [step.status for step in result.steps] == [StepStatus.SUCCESS, StepStatus.SKIPPED]

    @pytest.mark.asyncio
    async def test_prev_skips_failed_steps(self):
        calls: List[tuple] = []

        async def executor(command: str, payload: Dict[str, Any]) -> CommandResult:
            calls.append((command, payload))
            if command == "fails":
                return failure(CommandError(code="BOOM", message="failed"))
            return success({"from": command})

        request = PipelineRequest(
            steps=[
                PipelineStep(command="ok"),
                PipelineStep(command="fails"),
                PipelineStep(command="after", input={"prev": "$prev.from", "failed": "$steps[1]"}),
            ],
            options={"continueOnFailure": True},
        )

        await execute_pipeline(request, executor)

        assert calls[-1] == ("after", {"prev": "ok"})


# ═══════════════════════════════════════════════════════════════════════════════
# SERVER (afd-pipe) AND DIRECTCLIENT
# ═══════════════════════════════════════════════════════════════════════════════


class EchoInput(BaseModel):
    value: Any = None


def _echo_server():
    server = create_server("pipeline-variables")

    @server.command(name="echo", description="Echo input", expose=ExposeOptions(mcp=True))
    async def echo(input):
        return success(input)

    return server


class TestAfdPipe:
    @pytest.mark.asyncio
    async def test_literals_escapes_and_input(self):
        server = _echo_server()

        result = await server.call_tool(
            "afd-pipe",
            {
                "steps": [
                    {
                        "command": "echo",
                        "input": {
                            "price": "$9.99",
                            "escaped": "$$prev",
                            "user": "$input.user",
                            "missing": "$input.nope",
                        },
                    }
                ],
                "input": {"user": "ada"},
            },
        )

        assert result.data == {"price": "$9.99", "escaped": "$prev", "user": "ada"}

    @pytest.mark.asyncio
    async def test_input_is_not_the_execution_context(self):
        server = _echo_server()

        result = await server.call_tool(
            "afd-pipe", {"steps": [{"command": "echo", "input": {"ctx": "$input", "trace": "$input.trace_id"}}]}
        )

        assert result.data == {}

    @pytest.mark.asyncio
    async def test_deep_input_returns_validation_error(self):
        server = _echo_server()

        result = await server.call_tool(
            "afd-pipe", {"steps": [{"command": "echo", "input": _nested(MAX_INPUT_DEPTH + 1)}]}
        )

        assert result.steps[0].error.code == "VALIDATION_ERROR"
        assert result.metadata.completed_steps == 0

    @pytest.mark.asyncio
    async def test_invalid_options_return_structured_envelope_error(self):
        server = _echo_server()

        result = await server.call_tool(
            "afd-pipe", {"steps": [{"command": "echo"}], "options": {"bogus": True}}
        )

        assert result.steps[0].index == -1
        assert result.steps[0].error.code == "INVALID_PIPELINE_REQUEST"
        assert result.steps[0].error.suggestion


class TestDirectClientPipe:
    def _client(self) -> DirectClient:
        registry = SimpleRegistry()

        @registry.command(name="echo")
        async def echo(**kwargs):
            return success(kwargs)

        @registry.command(name="user-get")
        async def user_get():
            return success({"id": 7, "name": "Ada", "active": True})

        return DirectClient(registry)

    @pytest.mark.asyncio
    async def test_spec_references(self):
        result = await self._client().pipe(
            [
                {"command": "user-get", "as": "user"},
                {
                    "command": "echo",
                    "input": {
                        "id": "$steps.user.id",
                        "prev": "$prev.name",
                        "first": "$first.id",
                        "index": "$steps[0].name",
                        "input": "$input.tenant",
                        "legacy_alias": "$user.id",
                        "price": "$9.99",
                        "escaped": "$$prev",
                        "missing": "$steps.nope",
                    },
                },
            ],
            input={"tenant": "acme"},
        )

        assert result.success is True
        assert result.final.data == {
            "id": 7,
            "prev": "Ada",
            "first": 7,
            "index": "Ada",
            "input": "acme",
            "legacy_alias": "$user.id",
            "price": "$9.99",
            "escaped": "$prev",
        }

    @pytest.mark.asyncio
    async def test_dict_and_string_when_conditions(self):
        result = await self._client().pipe(
            [
                {"command": "user-get", "as": "user"},
                {"command": "echo", "input": {"n": 1}, "when": {"$eq": ["$steps.user.name", "Ada"]}},
                {"command": "echo", "input": {"n": 2}, "when": {"$exists": "$steps.user.nope"}},
                {"command": "echo", "input": {"n": 3}, "when": "$steps.user.active"},
            ]
        )

        assert [step.skipped for step in result.steps] == [False, False, True, False]

    @pytest.mark.asyncio
    async def test_deep_input_rejected_before_any_step_runs(self):
        calls = []
        registry = SimpleRegistry()

        @registry.command(name="echo")
        async def echo(**kwargs):
            calls.append(kwargs)
            return success(kwargs)

        result = await DirectClient(registry).pipe(
            [{"command": "echo", "input": {"ok": 1}}, {"command": "echo", "input": _nested(65)}]
        )

        assert calls == []
        assert result.success is False
        assert result.final.error.code == "VALIDATION_ERROR"
