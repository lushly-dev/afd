"""Tests for pipeline types and execution."""

import pytest

from afd import success, error
from afd.core.pipeline import (
    # Types
    PipelineRequest,
    PipelineStep,
    PipelineOptions,
    PipelineResult,
    PipelineMetadata,
    StepResult,
    StepStatus,
    PipelineContext,
    StepConfidence,
    StepReasoning,
    PipelineWarning,
    PipelineSource,
    # Type guards
    is_pipeline_request,
    is_pipeline_step,
    is_pipeline_result,
    is_pipeline_condition,
    # Helper functions
    create_pipeline,
    get_nested_value,
    resolve_variable,
    resolve_variables,
    evaluate_condition,
    aggregate_pipeline_confidence,
    aggregate_pipeline_reasoning,
    aggregate_pipeline_warnings,
    aggregate_pipeline_sources,
    build_confidence_breakdown,
    build_pipeline_metadata,
    execute_pipeline,
)
from afd.core.result import ResultMetadata
from afd.core.metadata import Warning, Source, WarningSeverity


# ═══════════════════════════════════════════════════════════════════════════════
# TYPE TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestPipelineStep:
    """Tests for PipelineStep type."""

    def test_basic_step(self):
        step = PipelineStep(command="user-get", input={"id": 123})
        assert step.command == "user-get"
        assert step.input == {"id": 123}
        assert step.as_ is None
        assert step.when is None

    def test_step_with_alias(self):
        step = PipelineStep(command="user-get", input={"id": 123}, as_="user")
        assert step.as_ == "user"

    def test_step_with_condition(self):
        step = PipelineStep(
            command="order-list",
            input={"userId": "$prev.id"},
            when={"$exists": "$prev.id"},
        )
        # When using a dict as condition, it's stored as-is
        assert step.when is not None


class TestPipelineRequest:
    """Tests for PipelineRequest type."""

    def test_basic_request(self):
        request = PipelineRequest(
            steps=[
                PipelineStep(command="user-get", input={"id": 123}),
                PipelineStep(command="order-list", input={"userId": "$prev.id"}),
            ]
        )
        assert len(request.steps) == 2
        assert request.options is None
        assert request.input is None

    def test_request_with_options(self):
        request = PipelineRequest(
            steps=[PipelineStep(command="test")],
            options=PipelineOptions(continue_on_failure=True, timeout_ms=5000),
        )
        assert request.options.continue_on_failure is True
        assert request.options.timeout_ms == 5000

    def test_request_with_input(self):
        request = PipelineRequest(
            steps=[PipelineStep(command="test", input={"param": "$input.userId"})],
            input={"userId": 456},
        )
        assert request.input == {"userId": 456}


# ═══════════════════════════════════════════════════════════════════════════════
# TYPE GUARD TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestTypeGuards:
    """Tests for type guard functions."""

    def test_is_pipeline_request_with_object(self):
        request = PipelineRequest(steps=[PipelineStep(command="test")])
        assert is_pipeline_request(request) is True

    def test_is_pipeline_request_with_dict(self):
        assert is_pipeline_request({"steps": [{"command": "test"}]}) is True
        assert is_pipeline_request({"data": "not a request"}) is False
        assert is_pipeline_request({"steps": "not a list"}) is False

    def test_is_pipeline_step_with_object(self):
        step = PipelineStep(command="test")
        assert is_pipeline_step(step) is True

    def test_is_pipeline_step_with_dict(self):
        assert is_pipeline_step({"command": "test"}) is True
        assert is_pipeline_step({"name": "not a step"}) is False

    def test_is_pipeline_result_with_object(self):
        result = PipelineResult(
            data={"test": True},
            metadata=PipelineMetadata(),
            steps=[],
        )
        assert is_pipeline_result(result) is True

    def test_is_pipeline_result_with_dict(self):
        assert is_pipeline_result({"data": {}, "metadata": {}, "steps": []}) is True
        assert is_pipeline_result({"only_data": {}}) is False

    def test_is_pipeline_condition(self):
        assert is_pipeline_condition({"$exists": "$prev.id"}) is True
        assert is_pipeline_condition({"$eq": ["$prev.type", "admin"]}) is True
        assert is_pipeline_condition({"$and": [{"$exists": "$prev.id"}]}) is True
        assert is_pipeline_condition({"random": "data"}) is False
        assert is_pipeline_condition({"$exists": "x", "$eq": ["y", 1]}) is False


# ═══════════════════════════════════════════════════════════════════════════════
# VARIABLE RESOLUTION TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestGetNestedValue:
    """Tests for get_nested_value function."""

    def test_simple_path(self):
        obj = {"user": {"name": "Alice"}}
        assert get_nested_value(obj, "user.name") == "Alice"

    def test_array_index(self):
        obj = {"items": [1, 2, 3]}
        assert get_nested_value(obj, "items[1]") == 2

    def test_missing_path(self):
        obj = {"user": {"name": "Alice"}}
        assert get_nested_value(obj, "user.email") is None
        assert get_nested_value(obj, "missing.path") is None

    def test_none_object(self):
        assert get_nested_value(None, "any.path") is None

    def test_nested_array_access(self):
        obj = {"data": {"items": [{"id": 1}, {"id": 2}]}}
        assert get_nested_value(obj, "data.items[0].id") == 1


class TestResolveVariable:
    """Tests for resolve_variable function."""

    def test_non_variable_returns_as_is(self):
        context = PipelineContext()
        assert resolve_variable("plain string", context) == "plain string"

    def test_prev_variable(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"id": 123, "name": "Test"},
            )
        )
        assert resolve_variable("$prev", context) == {"id": 123, "name": "Test"}
        assert resolve_variable("$prev.id", context) == 123
        assert resolve_variable("$prev.name", context) == "Test"

    def test_first_variable(self):
        context = PipelineContext(
            steps=[
                StepResult(
                    index=0,
                    command="first",
                    status=StepStatus.SUCCESS,
                    data={"value": "first-value"},
                ),
                StepResult(
                    index=1,
                    command="second",
                    status=StepStatus.SUCCESS,
                    data={"value": "second-value"},
                ),
            ]
        )
        assert resolve_variable("$first", context) == {"value": "first-value"}
        assert resolve_variable("$first.value", context) == "first-value"

    def test_input_variable(self):
        context = PipelineContext(pipeline_input={"userId": 456, "action": "create"})
        assert resolve_variable("$input", context) == {"userId": 456, "action": "create"}
        assert resolve_variable("$input.userId", context) == 456

    def test_steps_index_variable(self):
        context = PipelineContext(
            steps=[
                StepResult(
                    index=0,
                    command="step0",
                    status=StepStatus.SUCCESS,
                    data={"x": 10},
                ),
                StepResult(
                    index=1,
                    command="step1",
                    status=StepStatus.SUCCESS,
                    data={"y": 20},
                ),
            ]
        )
        assert resolve_variable("$steps[0]", context) == {"x": 10}
        assert resolve_variable("$steps[1].y", context) == 20

    def test_steps_alias_variable(self):
        context = PipelineContext(
            steps=[
                StepResult(
                    index=0,
                    alias="user",
                    command="user-get",
                    status=StepStatus.SUCCESS,
                    data={"id": 1, "name": "Alice"},
                ),
            ]
        )
        assert resolve_variable("$steps.user", context) == {"id": 1, "name": "Alice"}
        assert resolve_variable("$steps.user.name", context) == "Alice"


class TestResolveVariables:
    """Tests for resolve_variables function."""

    def test_resolve_in_dict(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"id": 123},
            )
        )
        result = resolve_variables(
            {"userId": "$prev.id", "active": True},
            context,
        )
        assert result == {"userId": 123, "active": True}

    def test_resolve_in_list(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"ids": [1, 2, 3]},
            )
        )
        result = resolve_variables(["$prev.ids", "static"], context)
        assert result == [[1, 2, 3], "static"]

    def test_nested_resolution(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"user": {"id": 1}},
            )
        )
        result = resolve_variables(
            {"data": {"userId": "$prev.user.id"}},
            context,
        )
        assert result == {"data": {"userId": 1}}


# ═══════════════════════════════════════════════════════════════════════════════
# CONDITION EVALUATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestEvaluateCondition:
    """Tests for evaluate_condition function."""

    def test_exists_condition_true(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"id": 123},
            )
        )
        assert evaluate_condition({"$exists": "$prev.id"}, context) is True

    def test_exists_condition_false(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"name": "test"},
            )
        )
        assert evaluate_condition({"$exists": "$prev.id"}, context) is False

    def test_eq_condition(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"type": "admin"},
            )
        )
        assert evaluate_condition({"$eq": ["$prev.type", "admin"]}, context) is True
        assert evaluate_condition({"$eq": ["$prev.type", "user"]}, context) is False

    def test_ne_condition(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"status": "active"},
            )
        )
        assert evaluate_condition({"$ne": ["$prev.status", "deleted"]}, context) is True
        assert evaluate_condition({"$ne": ["$prev.status", "active"]}, context) is False

    def test_numeric_conditions(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"count": 5},
            )
        )
        assert evaluate_condition({"$gt": ["$prev.count", 3]}, context) is True
        assert evaluate_condition({"$gt": ["$prev.count", 5]}, context) is False
        assert evaluate_condition({"$gte": ["$prev.count", 5]}, context) is True
        assert evaluate_condition({"$lt": ["$prev.count", 10]}, context) is True
        assert evaluate_condition({"$lte": ["$prev.count", 5]}, context) is True

    def test_and_condition(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"active": True, "count": 5},
            )
        )
        condition = {
            "$and": [
                {"$eq": ["$prev.active", True]},
                {"$gt": ["$prev.count", 0]},
            ]
        }
        assert evaluate_condition(condition, context) is True

    def test_or_condition(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"type": "guest"},
            )
        )
        condition = {
            "$or": [
                {"$eq": ["$prev.type", "admin"]},
                {"$eq": ["$prev.type", "guest"]},
            ]
        }
        assert evaluate_condition(condition, context) is True

    def test_not_condition(self):
        context = PipelineContext(
            previous_result=StepResult(
                index=0,
                command="test",
                status=StepStatus.SUCCESS,
                data={"deleted": False},
            )
        )
        condition = {"$not": {"$eq": ["$prev.deleted", True]}}
        assert evaluate_condition(condition, context) is True


# ═══════════════════════════════════════════════════════════════════════════════
# AGGREGATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestAggregation:
    """Tests for aggregation helper functions."""

    def test_aggregate_confidence_weakest_link(self):
        steps = [
            StepResult(
                index=0,
                command="a",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(confidence=0.95),
            ),
            StepResult(
                index=1,
                command="b",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(confidence=0.87),
            ),
            StepResult(
                index=2,
                command="c",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(confidence=0.99),
            ),
        ]
        assert aggregate_pipeline_confidence(steps) == 0.87

    def test_aggregate_confidence_skips_failures(self):
        steps = [
            StepResult(
                index=0,
                command="a",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(confidence=0.9),
            ),
            StepResult(
                index=1,
                command="b",
                status=StepStatus.FAILURE,
                metadata=ResultMetadata(confidence=0.5),
            ),
        ]
        assert aggregate_pipeline_confidence(steps) == 0.9

    def test_aggregate_confidence_empty(self):
        assert aggregate_pipeline_confidence([]) == 0.0

    def test_aggregate_reasoning(self):
        steps = [
            StepResult(
                index=0,
                command="fetch",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(reasoning="Used cache"),
            ),
            StepResult(
                index=1,
                command="transform",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(reasoning="Applied normalization"),
            ),
        ]
        reasoning = aggregate_pipeline_reasoning(steps)
        assert len(reasoning) == 2
        assert reasoning[0].command == "fetch"
        assert reasoning[0].reasoning == "Used cache"

    def test_aggregate_warnings(self):
        steps = [
            StepResult(
                index=0,
                alias="step1",
                command="test",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(
                    warnings=[
                        Warning(code="DEPRECATED", message="API deprecated"),
                    ]
                ),
            ),
        ]
        warnings = aggregate_pipeline_warnings(steps)
        assert len(warnings) == 1
        assert warnings[0].code == "DEPRECATED"
        assert warnings[0].step_index == 0
        assert warnings[0].step_alias == "step1"

    def test_aggregate_sources(self):
        steps = [
            StepResult(
                index=0,
                command="fetch",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(
                    sources=[
                        Source(type="api", id="api-1", title="User API"),
                    ]
                ),
            ),
        ]
        sources = aggregate_pipeline_sources(steps)
        assert len(sources) == 1
        assert sources[0].type == "api"
        assert sources[0].step_index == 0

    def test_build_confidence_breakdown(self):
        step_defs = [
            PipelineStep(command="a", **{"as": "step_a"}),
            PipelineStep(command="b"),
        ]
        steps = [
            StepResult(
                index=0,
                command="a",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(confidence=0.95, reasoning="High confidence"),
            ),
            StepResult(
                index=1,
                command="b",
                status=StepStatus.SUCCESS,
                metadata=ResultMetadata(confidence=0.8),
            ),
        ]
        breakdown = build_confidence_breakdown(steps, step_defs)
        assert len(breakdown) == 2
        assert breakdown[0].alias == "step_a"
        assert breakdown[0].confidence == 0.95
        assert breakdown[0].reasoning == "High confidence"


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE EXECUTION TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestExecutePipeline:
    """Tests for execute_pipeline function."""

    @pytest.mark.asyncio
    async def test_simple_pipeline(self):
        """Test a basic two-step pipeline."""
        call_log = []

        async def mock_executor(command: str, input: dict):
            call_log.append((command, input))
            if command == "user-get":
                return success({"id": 123, "name": "Alice"})
            if command == "order-list":
                return success([{"orderId": 1}, {"orderId": 2}])
            return error("UNKNOWN", f"Unknown command: {command}")

        request = PipelineRequest(
            steps=[
                PipelineStep(command="user-get", input={"id": 123}, as_="user"),
                PipelineStep(command="order-list", input={"userId": "$prev.id"}),
            ]
        )

        result = await execute_pipeline(request, mock_executor)

        assert len(call_log) == 2
        assert call_log[0] == ("user-get", {"id": 123})
        assert call_log[1] == ("order-list", {"userId": 123})
        assert result.data == [{"orderId": 1}, {"orderId": 2}]
        assert result.metadata.completed_steps == 2
        assert result.metadata.total_steps == 2

    @pytest.mark.asyncio
    async def test_pipeline_with_failure(self):
        """Test pipeline stops on failure by default."""
        call_log = []

        async def mock_executor(command: str, input: dict):
            call_log.append(command)
            if command == "step1":
                return success({"value": 1})
            if command == "step2":
                return error("FAILED", "Step 2 failed")
            if command == "step3":
                return success({"value": 3})
            return error("UNKNOWN", "Unknown command")

        request = PipelineRequest(
            steps=[
                PipelineStep(command="step1"),
                PipelineStep(command="step2"),
                PipelineStep(command="step3"),
            ]
        )

        result = await execute_pipeline(request, mock_executor)

        assert call_log == ["step1", "step2"]  # step3 was not called
        assert result.steps[0].status == StepStatus.SUCCESS
        assert result.steps[1].status == StepStatus.FAILURE
        assert result.steps[2].status == StepStatus.SKIPPED
        assert result.metadata.completed_steps == 1

    @pytest.mark.asyncio
    async def test_pipeline_continue_on_failure(self):
        """Test pipeline continues when continue_on_failure is set."""
        call_log = []

        async def mock_executor(command: str, input: dict):
            call_log.append(command)
            if command == "step1":
                return success({"value": 1})
            if command == "step2":
                return error("FAILED", "Step 2 failed")
            if command == "step3":
                return success({"value": 3})
            return error("UNKNOWN", "Unknown command")

        request = PipelineRequest(
            steps=[
                PipelineStep(command="step1"),
                PipelineStep(command="step2"),
                PipelineStep(command="step3"),
            ],
            options=PipelineOptions(continue_on_failure=True),
        )

        result = await execute_pipeline(request, mock_executor)

        assert call_log == ["step1", "step2", "step3"]  # all steps called
        assert result.data == {"value": 3}  # last successful step's data
        assert result.metadata.completed_steps == 2  # step1 and step3 succeeded

    @pytest.mark.asyncio
    async def test_pipeline_with_conditional_step(self):
        """Test conditional step execution."""
        call_log = []

        async def mock_executor(command: str, input: dict):
            call_log.append(command)
            if command == "check-premium":
                return success({"isPremium": False})
            if command == "apply-discount":
                return success({"discount": 0.1})
            if command == "calculate-total":
                return success({"total": 100})
            return error("UNKNOWN", "Unknown command")

        request = PipelineRequest(
            steps=[
                PipelineStep(command="check-premium", as_="premium"),
                PipelineStep(
                    command="apply-discount",
                    when={"$eq": ["$prev.isPremium", True]},
                ),
                PipelineStep(command="calculate-total"),
            ]
        )

        result = await execute_pipeline(request, mock_executor)

        # apply-discount should be skipped because isPremium is False
        assert call_log == ["check-premium", "calculate-total"]
        assert result.steps[1].status == StepStatus.SKIPPED
        assert result.data == {"total": 100}

    @pytest.mark.asyncio
    async def test_pipeline_with_alias_reference(self):
        """Test referencing previous steps by alias."""
        call_log = []

        async def mock_executor(command: str, input: dict):
            call_log.append((command, input))
            if command == "get-user":
                return success({"id": 1, "name": "Alice"})
            if command == "get-preferences":
                return success({"theme": "dark"})
            if command == "combine":
                return success(input)
            return error("UNKNOWN", "Unknown command")

        request = PipelineRequest(
            steps=[
                PipelineStep(command="get-user", as_="user"),
                PipelineStep(command="get-preferences", as_="prefs"),
                PipelineStep(
                    command="combine",
                    input={
                        "userName": "$steps.user.name",
                        "theme": "$steps.prefs.theme",
                    },
                ),
            ]
        )

        result = await execute_pipeline(request, mock_executor)

        assert result.data == {"userName": "Alice", "theme": "dark"}

    @pytest.mark.asyncio
    async def test_pipeline_with_input(self):
        """Test using pipeline input in steps."""
        call_log = []

        async def mock_executor(command: str, input: dict):
            call_log.append((command, input))
            return success(input)

        request = PipelineRequest(
            steps=[
                PipelineStep(
                    command="process",
                    input={"userId": "$input.userId", "action": "$input.action"},
                ),
            ],
            input={"userId": 999, "action": "create"},
        )

        result = await execute_pipeline(request, mock_executor)

        assert call_log[0] == ("process", {"userId": 999, "action": "create"})

    @pytest.mark.asyncio
    async def test_pipeline_metadata_aggregation(self):
        """Test that metadata is properly aggregated."""

        async def mock_executor(command: str, input: dict):
            if command == "step1":
                return success(
                    {"value": 1},
                    confidence=0.95,
                    reasoning="Step 1 reasoning",
                )
            if command == "step2":
                return success(
                    {"value": 2},
                    confidence=0.87,
                    reasoning="Step 2 reasoning",
                )
            return error("UNKNOWN", "Unknown command")

        request = PipelineRequest(
            steps=[
                PipelineStep(command="step1"),
                PipelineStep(command="step2"),
            ]
        )

        result = await execute_pipeline(request, mock_executor)

        # Confidence should be minimum (weakest link)
        assert result.metadata.confidence == 0.87
        assert len(result.metadata.confidence_breakdown) == 2
        assert len(result.metadata.reasoning_steps) == 2


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTION TESTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestCreatePipeline:
    """Tests for create_pipeline helper function."""

    def test_create_simple_pipeline(self):
        pipeline = create_pipeline(
            steps=[
                PipelineStep(command="a"),
                PipelineStep(command="b"),
            ]
        )
        assert len(pipeline.steps) == 2
        assert pipeline.options is None

    def test_create_pipeline_with_options(self):
        pipeline = create_pipeline(
            steps=[PipelineStep(command="test")],
            options=PipelineOptions(timeout_ms=10000),
        )
        assert pipeline.options.timeout_ms == 10000

    def test_create_pipeline_with_input(self):
        pipeline = create_pipeline(
            steps=[PipelineStep(command="test")],
            input={"key": "value"},
        )
        assert pipeline.input == {"key": "value"}
