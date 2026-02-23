"""Tests for JTBD scenario testing system."""

from __future__ import annotations

import json
import os
import tempfile
from io import StringIO
from datetime import datetime, timezone

import pytest

from afd.testing.scenarios import (
    # Types
    Scenario,
    Step,
    Expectation,
    AssertionMatcher,
    FixtureConfig,
    Verification,
    StepResult,
    ScenarioResult,
    TestSummary,
    TestReport,
    StepError,
    AssertionResult,
    # Type guards
    is_assertion_matcher,
    is_scenario,
    # Factory functions
    create_empty_summary,
    calculate_summary,
    create_step_error,
    # Parser
    parse_scenario,
    parse_scenario_file,
    parse_scenario_dir,
    # Evaluator
    evaluate_result,
    get_value_at_path,
    EvaluationResult,
    # Executor
    InProcessExecutor,
    InProcessExecutorConfig,
    validate_scenario,
    resolve_step_references,
    # Coverage
    scenario_coverage,
    CommandCoverage,
    CoverageReport,
    # Reporter
    TerminalReporter,
    create_reporter,
    create_json_reporter,
    create_verbose_reporter,
)


# ============================================================================
# Parser Tests
# ============================================================================


class TestParser:
    def test_parse_valid_scenario(self):
        yaml_str = """
name: Create Todo
description: As a user, I create a todo
job: basic-workflow
tags: [smoke, p0]
steps:
  - command: todo-create
    input:
      title: Buy groceries
    expect:
      success: true
      data:
        title: Buy groceries
"""
        result = parse_scenario(yaml_str)
        assert result.success is True
        assert result.scenario.name == 'Create Todo'
        assert result.scenario.description == 'As a user, I create a todo'
        assert result.scenario.job == 'basic-workflow'
        assert result.scenario.tags == ['smoke', 'p0']
        assert len(result.scenario.steps) == 1
        assert result.scenario.steps[0].command == 'todo-create'
        assert result.scenario.steps[0].input == {'title': 'Buy groceries'}
        assert result.scenario.steps[0].expect.success is True

    def test_parse_missing_name(self):
        yaml_str = """
description: Missing name
job: test
steps:
  - command: foo
    expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'name' in result.error

    def test_parse_missing_description(self):
        yaml_str = """
name: Test
job: test
steps:
  - command: foo
    expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'description' in result.error

    def test_parse_missing_job(self):
        yaml_str = """
name: Test
description: Desc
steps:
  - command: foo
    expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'job' in result.error

    def test_parse_missing_steps(self):
        yaml_str = """
name: Test
description: Desc
job: test
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'step' in result.error.lower()

    def test_parse_empty_steps(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps: []
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'step' in result.error.lower()

    def test_parse_step_missing_command(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps:
  - expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'command' in result.error.lower()

    def test_parse_step_missing_expect(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps:
  - command: foo
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'expect' in result.error.lower()

    def test_parse_expect_missing_success(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps:
  - command: foo
    expect:
      data:
        id: 1
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'success' in result.error.lower()

    def test_parse_fixture(self):
        yaml_str = """
name: Test
description: Desc
job: test
fixture:
  file: data.json
  base: base.json
  overrides:
    key: value
steps:
  - command: foo
    expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is True
        assert result.scenario.fixture is not None
        assert result.scenario.fixture.file == 'data.json'
        assert result.scenario.fixture.base == 'base.json'
        assert result.scenario.fixture.overrides == {'key': 'value'}

    def test_parse_fixture_missing_file(self):
        yaml_str = """
name: Test
description: Desc
job: test
fixture:
  base: base.json
steps:
  - command: foo
    expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is False
        assert 'file' in result.error.lower()

    def test_parse_verification(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps:
  - command: foo
    expect:
      success: true
verify:
  snapshot: expected.json
  assertions:
    - All todos are completed
  custom: verify.py
"""
        result = parse_scenario(yaml_str)
        assert result.success is True
        assert result.scenario.verify is not None
        assert result.scenario.verify.snapshot == 'expected.json'
        assert result.scenario.verify.assertions == ['All todos are completed']
        assert result.scenario.verify.custom == 'verify.py'

    def test_parse_continue_on_failure(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps:
  - command: foo
    continueOnFailure: true
    expect:
      success: true
"""
        result = parse_scenario(yaml_str)
        assert result.success is True
        assert result.scenario.steps[0].continue_on_failure is True

    def test_parse_error_expectations(self):
        yaml_str = """
name: Test
description: Desc
job: test
steps:
  - command: foo
    expect:
      success: false
      error:
        code: NOT_FOUND
        message: Item not found
"""
        result = parse_scenario(yaml_str)
        assert result.success is True
        step = result.scenario.steps[0]
        assert step.expect.success is False
        assert step.expect.error == {'code': 'NOT_FOUND', 'message': 'Item not found'}

    def test_parse_invalid_yaml(self):
        result = parse_scenario('{{invalid: yaml: [')
        assert result.success is False
        assert 'YAML' in result.error or 'parse' in result.error.lower()

    def test_parse_scenario_file_not_found(self):
        result = parse_scenario_file('/nonexistent/path.yaml')
        assert result.success is False
        assert 'read' in result.error.lower() or 'file' in result.error.lower()

    def test_parse_scenario_file_valid(self):
        yaml_content = """
name: File Test
description: Test from file
job: file-test
steps:
  - command: test-cmd
    expect:
      success: true
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            filepath = os.path.join(tmpdir, 'test.yaml')
            with open(filepath, 'w') as f:
                f.write(yaml_content)
            result = parse_scenario_file(filepath)
            assert result.success is True
            assert result.scenario.name == 'File Test'

    def test_parse_scenario_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            for i in range(2):
                with open(os.path.join(tmpdir, f'test{i}.yaml'), 'w') as f:
                    f.write(f"""
name: Test {i}
description: Desc {i}
job: test-job
steps:
  - command: cmd-{i}
    expect:
      success: true
""")

            results = parse_scenario_dir(tmpdir)
            assert len(results) == 2
            assert all(r.success for r in results)

    def test_parse_optional_fields(self):
        yaml_str = """
name: Full Test
description: All fields
job: full-test
version: "1.0"
isolation: chained
dependsOn: [setup-scenario]
timeout: 5000
tags: [integration]
steps:
  - command: test
    description: A test step
    expect:
      success: true
      reasoning: some reason
      confidence: 0.9
"""
        result = parse_scenario(yaml_str)
        assert result.success is True
        s = result.scenario
        assert s.version == '1.0'
        assert s.isolation == 'chained'
        assert s.depends_on == ['setup-scenario']
        assert s.timeout == 5000
        assert s.steps[0].description == 'A test step'
        assert s.steps[0].expect.reasoning == 'some reason'
        assert s.steps[0].expect.confidence == 0.9


# ============================================================================
# Evaluator Tests
# ============================================================================


class TestEvaluator:
    def test_success_match(self):
        actual = {'success': True, 'data': {'id': 1}}
        expected = Expectation(success=True)
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_success_mismatch(self):
        actual = {'success': False, 'error': {'code': 'ERR'}}
        expected = Expectation(success=True)
        result = evaluate_result(actual, expected)
        assert result.passed is False

    def test_data_equals(self):
        actual = {'success': True, 'data': {'title': 'Buy groceries', 'count': 5}}
        expected = Expectation(success=True, data={'title': 'Buy groceries', 'count': 5})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_data_equals_mismatch(self):
        actual = {'success': True, 'data': {'title': 'Wrong'}}
        expected = Expectation(success=True, data={'title': 'Right'})
        result = evaluate_result(actual, expected)
        assert result.passed is False

    def test_contains_matcher(self):
        actual = {'success': True, 'data': {'name': 'Hello World'}}
        expected = Expectation(success=True, data={'name': {'contains': 'World'}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_contains_matcher_fail(self):
        actual = {'success': True, 'data': {'name': 'Hello'}}
        expected = Expectation(success=True, data={'name': {'contains': 'World'}})
        result = evaluate_result(actual, expected)
        assert result.passed is False

    def test_matches_matcher(self):
        actual = {'success': True, 'data': {'email': 'test@example.com'}}
        expected = Expectation(success=True, data={'email': {'matches': r'.+@.+\..+'}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_exists_matcher(self):
        actual = {'success': True, 'data': {'id': 123, 'name': None}}
        expected = Expectation(success=True, data={
            'id': {'exists': True},
            'name': {'exists': False},
        })
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_not_exists_matcher(self):
        actual = {'success': True, 'data': {'deleted': None}}
        expected = Expectation(success=True, data={'deleted': {'notExists': True}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_length_matcher(self):
        actual = {'success': True, 'data': {'items': [1, 2, 3]}}
        expected = Expectation(success=True, data={'items': {'length': 3}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_length_matcher_string(self):
        actual = {'success': True, 'data': {'code': 'ABC'}}
        expected = Expectation(success=True, data={'code': {'length': 3}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_includes_matcher(self):
        actual = {'success': True, 'data': {'tags': ['a', 'b', 'c']}}
        expected = Expectation(success=True, data={'tags': {'includes': 'b'}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_includes_matcher_fail(self):
        actual = {'success': True, 'data': {'tags': ['a', 'b']}}
        expected = Expectation(success=True, data={'tags': {'includes': 'z'}})
        result = evaluate_result(actual, expected)
        assert result.passed is False

    def test_gte_matcher(self):
        actual = {'success': True, 'data': {'count': 10}}
        expected = Expectation(success=True, data={'count': {'gte': 5}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_gte_matcher_equal(self):
        actual = {'success': True, 'data': {'count': 5}}
        expected = Expectation(success=True, data={'count': {'gte': 5}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_lte_matcher(self):
        actual = {'success': True, 'data': {'count': 3}}
        expected = Expectation(success=True, data={'count': {'lte': 5}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_between_matcher(self):
        actual = {'success': True, 'data': {'score': 75}}
        expected = Expectation(success=True, data={'score': {'between': [50, 100]}})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_between_matcher_fail(self):
        actual = {'success': True, 'data': {'score': 150}}
        expected = Expectation(success=True, data={'score': {'between': [50, 100]}})
        result = evaluate_result(actual, expected)
        assert result.passed is False

    def test_error_code_assertion(self):
        actual = {'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Not found'}}
        expected = Expectation(success=False, error={'code': 'NOT_FOUND', 'message': None})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_error_message_contains(self):
        actual = {'success': False, 'error': {'code': 'ERR', 'message': 'Item not found in db'}}
        expected = Expectation(success=False, error={'code': None, 'message': 'not found'})
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_reasoning_assertion(self):
        actual = {'success': True, 'data': {}, 'reasoning': 'Cache hit for user 123'}
        expected = Expectation(success=True, reasoning='Cache hit')
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_confidence_assertion(self):
        actual = {'success': True, 'data': {}, 'confidence': 0.95}
        expected = Expectation(success=True, confidence=0.9)
        result = evaluate_result(actual, expected)
        assert result.passed is True

    def test_confidence_assertion_fail(self):
        actual = {'success': True, 'data': {}, 'confidence': 0.5}
        expected = Expectation(success=True, confidence=0.9)
        result = evaluate_result(actual, expected)
        assert result.passed is False

    def test_nested_data_path(self):
        actual = {'success': True, 'data': {'user': {'name': 'Alice', 'age': 30}}}
        expected = Expectation(success=True, data={'user': {'name': 'Alice'}})
        result = evaluate_result(actual, expected)
        assert result.passed is True


class TestGetValueAtPath:
    def test_simple_path(self):
        assert get_value_at_path({'a': 1}, 'a') == 1

    def test_nested_path(self):
        assert get_value_at_path({'a': {'b': {'c': 3}}}, 'a.b.c') == 3

    def test_array_index(self):
        assert get_value_at_path({'items': [10, 20, 30]}, 'items[1]') == 20

    def test_missing_path(self):
        assert get_value_at_path({'a': 1}, 'b') is None

    def test_none_object(self):
        assert get_value_at_path(None, 'a') is None

    def test_nested_array_access(self):
        obj = {'data': {'items': [{'name': 'first'}, {'name': 'second'}]}}
        assert get_value_at_path(obj, 'data.items[0].name') == 'first'


# ============================================================================
# Executor Tests
# ============================================================================


class TestInProcessExecutor:
    @staticmethod
    def _make_scenario(**kwargs):
        defaults = {
            'name': 'Test',
            'description': 'Test scenario',
            'job': 'test-job',
            'steps': [
                Step(
                    command='test-cmd',
                    expect=Expectation(success=True),
                )
            ],
        }
        defaults.update(kwargs)
        return Scenario(**defaults)

    async def test_passing_scenario(self):
        async def handler(cmd, inp):
            return {'success': True, 'data': {'id': 1}}

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        scenario = self._make_scenario()
        result = await executor.execute(scenario)

        assert result.outcome == 'pass'
        assert result.passed_steps == 1
        assert result.failed_steps == 0

    async def test_failing_scenario(self):
        async def handler(cmd, inp):
            return {'success': False, 'error': {'code': 'ERR'}}

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        scenario = self._make_scenario()
        result = await executor.execute(scenario)

        assert result.outcome == 'fail'
        assert result.failed_steps == 1

    async def test_stop_on_failure(self):
        call_count = 0

        async def handler(cmd, inp):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {'success': False, 'error': {'code': 'ERR'}}
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(
            InProcessExecutorConfig(handler=handler, stop_on_failure=True)
        )
        scenario = self._make_scenario(steps=[
            Step(command='step1', expect=Expectation(success=True)),
            Step(command='step2', expect=Expectation(success=True)),
        ])
        result = await executor.execute(scenario)

        assert result.outcome == 'fail'
        assert result.failed_steps == 1
        assert result.skipped_steps == 1
        assert call_count == 1

    async def test_continue_on_failure(self):
        call_count = 0

        async def handler(cmd, inp):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {'success': False, 'error': {'code': 'ERR'}}
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(
            InProcessExecutorConfig(handler=handler, stop_on_failure=True)
        )
        scenario = self._make_scenario(steps=[
            Step(
                command='step1',
                expect=Expectation(success=True),
                continue_on_failure=True,
            ),
            Step(command='step2', expect=Expectation(success=True)),
        ])
        result = await executor.execute(scenario)

        assert result.outcome == 'partial'
        assert result.failed_steps == 1
        assert result.passed_steps == 1
        assert call_count == 2

    async def test_stop_on_failure_disabled(self):
        call_count = 0

        async def handler(cmd, inp):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {'success': False, 'error': {'code': 'ERR'}}
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(
            InProcessExecutorConfig(handler=handler, stop_on_failure=False)
        )
        scenario = self._make_scenario(steps=[
            Step(command='step1', expect=Expectation(success=True)),
            Step(command='step2', expect=Expectation(success=True)),
        ])
        result = await executor.execute(scenario)

        assert result.outcome == 'partial'
        assert call_count == 2

    async def test_step_references_exact(self):
        """Exact reference preserves type (e.g., int stays int)."""
        async def handler(cmd, inp):
            if cmd == 'create':
                return {'success': True, 'data': {'id': 42}}
            if cmd == 'get':
                return {'success': True, 'data': {'id': inp['id']}}
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        scenario = self._make_scenario(steps=[
            Step(command='create', expect=Expectation(success=True)),
            Step(
                command='get',
                input={'id': '${{ steps[0].data.id }}'},
                expect=Expectation(success=True, data={'id': 42}),
            ),
        ])
        result = await executor.execute(scenario)
        assert result.outcome == 'pass'

    async def test_step_references_embedded(self):
        """Embedded references are interpolated into strings."""
        async def handler(cmd, inp):
            if cmd == 'create':
                return {'success': True, 'data': {'id': 42}}
            if cmd == 'log':
                return {'success': True, 'data': {'msg': inp['message']}}
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        scenario = self._make_scenario(steps=[
            Step(command='create', expect=Expectation(success=True)),
            Step(
                command='log',
                input={'message': 'Created item ${{ steps[0].data.id }}'},
                expect=Expectation(success=True, data={'msg': 'Created item 42'}),
            ),
        ])
        result = await executor.execute(scenario)
        assert result.outcome == 'pass'

    async def test_step_references_array_index(self):
        """Reference with array index access."""
        async def handler(cmd, inp):
            if cmd == 'list':
                return {'success': True, 'data': {'items': [{'name': 'first'}, {'name': 'second'}]}}
            if cmd == 'get':
                return {'success': True, 'data': {'name': inp['name']}}
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        scenario = self._make_scenario(steps=[
            Step(command='list', expect=Expectation(success=True)),
            Step(
                command='get',
                input={'name': '${{ steps[0].data.items[0].name }}'},
                expect=Expectation(success=True, data={'name': 'first'}),
            ),
        ])
        result = await executor.execute(scenario)
        assert result.outcome == 'pass'

    async def test_dry_run(self):
        call_count = 0

        async def handler(cmd, inp):
            nonlocal call_count
            call_count += 1
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(
            InProcessExecutorConfig(handler=handler, dry_run=True)
        )
        scenario = self._make_scenario()
        result = await executor.execute(scenario)

        assert result.outcome == 'pass'
        assert call_count == 0  # Handler should not be called

    async def test_callbacks(self):
        events: list[str] = []

        async def handler(cmd, inp):
            return {'success': True, 'data': {}}

        executor = InProcessExecutor(InProcessExecutorConfig(
            handler=handler,
            on_scenario_start=lambda s: events.append('start'),
            on_step_complete=lambda s, r: events.append(f'step:{r.outcome}'),
            on_scenario_complete=lambda r: events.append(f'done:{r.outcome}'),
        ))
        scenario = self._make_scenario()
        await executor.execute(scenario)

        assert events == ['start', 'step:pass', 'done:pass']

    async def test_handler_exception(self):
        async def handler(cmd, inp):
            raise RuntimeError('Something went wrong')

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        scenario = self._make_scenario()
        result = await executor.execute(scenario)

        assert result.outcome == 'fail'
        assert result.step_results[0].outcome == 'error'
        assert 'Something went wrong' in result.step_results[0].error.message


# ============================================================================
# Step Reference Resolution Tests
# ============================================================================


class TestStepReferences:
    def test_resolve_none_input(self):
        assert resolve_step_references(None, []) is None

    def test_resolve_no_refs(self):
        result = resolve_step_references({'key': 'value'}, [])
        assert result == {'key': 'value'}

    def test_resolve_exact_ref(self):
        outputs = [{'success': True, 'data': {'id': 42}}]
        result = resolve_step_references(
            {'id': '${{ steps[0].data.id }}'}, outputs
        )
        assert result['id'] == 42

    def test_resolve_embedded_ref(self):
        outputs = [{'success': True, 'data': {'id': 42}}]
        result = resolve_step_references(
            {'msg': 'Item ${{ steps[0].data.id }} created'}, outputs
        )
        assert result['msg'] == 'Item 42 created'

    def test_resolve_nested_dict(self):
        outputs = [{'success': True, 'data': {'id': 1}}]
        result = resolve_step_references(
            {'nested': {'ref': '${{ steps[0].data.id }}'}}, outputs
        )
        assert result['nested']['ref'] == 1

    def test_resolve_list_values(self):
        outputs = [{'success': True, 'data': {'id': 1}}]
        result = resolve_step_references(
            {'ids': ['${{ steps[0].data.id }}']}, outputs
        )
        assert result['ids'] == [1]


# ============================================================================
# Validation Tests
# ============================================================================


class TestValidation:
    def test_valid_scenario(self):
        scenario = Scenario(
            name='Test', description='Desc', job='test',
            steps=[Step(command='cmd', expect=Expectation(success=True))],
        )
        result = validate_scenario(scenario)
        assert result.valid is True
        assert result.errors == []

    def test_missing_name(self):
        scenario = Scenario(
            name='', description='Desc', job='test',
            steps=[Step(command='cmd', expect=Expectation(success=True))],
        )
        result = validate_scenario(scenario)
        assert result.valid is False
        assert any('name' in e.lower() for e in result.errors)

    def test_no_steps(self):
        scenario = Scenario(
            name='Test', description='Desc', job='test', steps=[],
        )
        result = validate_scenario(scenario)
        assert result.valid is False
        assert any('step' in e.lower() for e in result.errors)

    def test_forward_reference_error(self):
        scenario = Scenario(
            name='Test', description='Desc', job='test',
            steps=[
                Step(
                    command='cmd',
                    input={'ref': '${{ steps[1].data.id }}'},
                    expect=Expectation(success=True),
                ),
                Step(command='cmd2', expect=Expectation(success=True)),
            ],
        )
        result = validate_scenario(scenario)
        assert result.valid is False
        assert any('reference' in e.lower() for e in result.errors)

    def test_unknown_command_warning(self):
        scenario = Scenario(
            name='Test', description='Desc', job='test',
            steps=[Step(command='unknown-cmd', expect=Expectation(success=True))],
        )
        result = validate_scenario(scenario, known_commands=['known-cmd'])
        assert result.valid is True
        assert any('unknown' in w.lower() for w in result.warnings)

    def test_metadata(self):
        scenario = Scenario(
            name='Test', description='Desc', job='test',
            tags=['smoke'],
            fixture=FixtureConfig(file='data.json'),
            steps=[Step(command='cmd', expect=Expectation(success=True))],
        )
        result = validate_scenario(scenario)
        assert result.metadata['name'] == 'Test'
        assert result.metadata['job'] == 'test'
        assert result.metadata['step_count'] == 1
        assert result.metadata['has_fixture'] is True
        assert result.metadata['tags'] == ['smoke']


# ============================================================================
# Coverage Tests
# ============================================================================


class TestCoverage:
    def _make_scenarios(self):
        s1 = Scenario(
            name='Create Todo',
            description='Create',
            job='crud',
            tags=['smoke'],
            steps=[
                Step(command='todo-create', expect=Expectation(success=True)),
                Step(command='todo-list', expect=Expectation(success=True)),
            ],
        )
        s2 = Scenario(
            name='Delete Todo',
            description='Delete',
            job='crud',
            tags=['smoke'],
            steps=[
                Step(command='todo-create', expect=Expectation(success=True)),
                Step(
                    command='todo-delete',
                    expect=Expectation(
                        success=False,
                        error={'code': 'NOT_FOUND', 'message': None},
                    ),
                ),
            ],
        )
        return [(s1, 'create.yaml'), (s2, 'delete.yaml')]

    def test_command_coverage(self):
        report = scenario_coverage(self._make_scenarios())
        assert report.summary.commands_tested == 3
        cmds = {c.command for c in report.command_coverage}
        assert cmds == {'todo-create', 'todo-list', 'todo-delete'}

    def test_command_step_count(self):
        report = scenario_coverage(self._make_scenarios())
        create_cov = next(c for c in report.command_coverage if c.command == 'todo-create')
        assert create_cov.step_count == 2
        assert create_cov.scenario_count == 2

    def test_error_coverage(self):
        report = scenario_coverage(self._make_scenarios())
        assert report.summary.errors_tested == 1
        assert report.error_coverage[0].error_code == 'NOT_FOUND'

    def test_job_coverage(self):
        report = scenario_coverage(self._make_scenarios())
        assert report.summary.jobs_count == 1
        assert report.job_coverage[0].job == 'crud'
        assert report.job_coverage[0].scenario_count == 2

    def test_untested_commands(self):
        known = ['todo-create', 'todo-list', 'todo-delete', 'todo-update']
        report = scenario_coverage(self._make_scenarios(), known_commands=known)
        assert report.summary.commands_untested == ['todo-update']
        assert report.summary.commands_coverage == 75.0

    def test_untested_errors(self):
        known_errors = ['NOT_FOUND', 'VALIDATION_ERROR']
        report = scenario_coverage(self._make_scenarios(), known_errors=known_errors)
        assert report.summary.errors_untested == ['VALIDATION_ERROR']
        assert report.summary.errors_coverage == 50.0

    def test_has_error_tests(self):
        report = scenario_coverage(self._make_scenarios())
        delete_cov = next(c for c in report.command_coverage if c.command == 'todo-delete')
        assert delete_cov.has_error_tests is True
        list_cov = next(c for c in report.command_coverage if c.command == 'todo-list')
        assert list_cov.has_error_tests is False


# ============================================================================
# Reporter Tests
# ============================================================================


class TestReporter:
    @staticmethod
    def _make_result(outcome='pass', **kwargs):
        now = datetime.now(timezone.utc)
        defaults = {
            'scenario_path': 'test.yaml',
            'job_name': 'test-job',
            'outcome': outcome,
            'duration_ms': 100.0,
            'step_results': [
                StepResult(
                    step_id='step-1',
                    command='test-cmd',
                    outcome='pass',
                    duration_ms=50.0,
                    assertions=[
                        AssertionResult(
                            path='success',
                            matcher='equals',
                            passed=True,
                            expected=True,
                            actual=True,
                            description='\u2713 success equals True',
                        )
                    ],
                )
            ],
            'passed_steps': 1,
            'failed_steps': 0,
            'skipped_steps': 0,
            'started_at': now,
            'completed_at': now,
        }
        defaults.update(kwargs)
        return ScenarioResult(**defaults)

    def test_human_format(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        reporter.report_scenario(self._make_result())
        text = output.getvalue()
        assert 'test-job' in text
        assert '1 passed' in text

    def test_json_format(self):
        output = StringIO()
        reporter = TerminalReporter(format='json', colors=False, output=output)
        reporter.report_scenario(self._make_result())
        data = json.loads(output.getvalue())
        assert data['job_name'] == 'test-job'
        assert data['outcome'] == 'pass'

    def test_verbose_shows_assertions(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', verbose=True, colors=False, output=output)
        reporter.report_scenario(self._make_result())
        text = output.getvalue()
        assert 'test-cmd' in text

    def test_report_all_with_summary(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        reporter.report_all([self._make_result(), self._make_result()])
        text = output.getvalue()
        assert 'Summary' in text
        assert '2 passed' in text

    def test_report_all_json(self):
        output = StringIO()
        reporter = TerminalReporter(format='json', colors=False, output=output)
        reporter.report_all([self._make_result()])
        data = json.loads(output.getvalue())
        assert isinstance(data, list)
        assert len(data) == 1

    def test_failed_scenario_shows_errors(self):
        now = datetime.now(timezone.utc)
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        result = self._make_result(
            outcome='fail',
            failed_steps=1,
            passed_steps=0,
            step_results=[
                StepResult(
                    step_id='step-1',
                    command='failing-cmd',
                    outcome='fail',
                    duration_ms=10.0,
                    assertions=[
                        AssertionResult(
                            path='success',
                            matcher='equals',
                            passed=False,
                            expected=True,
                            actual=False,
                            description='\u2717 success equals True (got False)',
                        )
                    ],
                    error=StepError(
                        type='expectation_mismatch',
                        message='success mismatch',
                    ),
                )
            ],
        )
        reporter.report_scenario(result)
        text = output.getvalue()
        assert 'Failed steps' in text
        assert 'failing-cmd' in text

    def test_step_progress(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        step = Step(command='test-cmd', expect=Expectation(success=True))
        step_result = StepResult(
            step_id='step-1', command='test-cmd', outcome='pass',
            duration_ms=25.0, assertions=[],
        )
        reporter.report_step_progress(step, step_result, 0, 3)
        text = output.getvalue()
        assert '[1/3]' in text
        assert 'test-cmd' in text

    def test_scenario_start(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        reporter.report_scenario_start('my-job', 'A description')
        text = output.getvalue()
        assert 'my-job' in text
        assert 'A description' in text

    def test_factory_functions(self):
        r1 = create_reporter()
        assert isinstance(r1, TerminalReporter)

        r2 = create_json_reporter()
        assert isinstance(r2, TerminalReporter)

        r3 = create_verbose_reporter()
        assert isinstance(r3, TerminalReporter)

    def test_duration_formatting(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        result = self._make_result(duration_ms=500)
        reporter.report_scenario(result)
        assert '500ms' in output.getvalue()

    def test_duration_seconds(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        result = self._make_result(duration_ms=2500)
        reporter.report_scenario(result)
        assert '2.5s' in output.getvalue()

    def test_test_report(self):
        output = StringIO()
        reporter = TerminalReporter(format='human', colors=False, output=output)
        now = datetime.now(timezone.utc)
        report = TestReport(
            title='My Test Report',
            duration_ms=200.0,
            scenarios=[self._make_result()],
            summary=TestSummary(
                total_scenarios=1,
                passed_scenarios=1,
                total_steps=1,
                passed_steps=1,
                pass_rate=1.0,
            ),
            generated_at=now,
        )
        reporter.report_test_report(report)
        text = output.getvalue()
        assert 'My Test Report' in text
        assert 'Summary' in text
        assert '100.0%' in text


# ============================================================================
# Type Guard Tests
# ============================================================================


class TestTypeGuards:
    def test_is_assertion_matcher_true(self):
        assert is_assertion_matcher({'contains': 'foo'}) is True
        assert is_assertion_matcher({'gte': 5, 'lte': 10}) is True
        assert is_assertion_matcher({'exists': True}) is True
        assert is_assertion_matcher({'notExists': True}) is True

    def test_is_assertion_matcher_false(self):
        assert is_assertion_matcher({'title': 'foo'}) is False
        assert is_assertion_matcher('string') is False
        assert is_assertion_matcher(42) is False
        assert is_assertion_matcher(None) is False

    def test_is_scenario_true(self):
        assert is_scenario({
            'name': 'Test',
            'description': 'Desc',
            'job': 'test',
            'steps': [],
        }) is True

    def test_is_scenario_false(self):
        assert is_scenario({'name': 'Test'}) is False
        assert is_scenario('string') is False
        assert is_scenario(None) is False


# ============================================================================
# Summary Factory Tests
# ============================================================================


class TestSummaryFactory:
    def test_create_empty_summary(self):
        s = create_empty_summary()
        assert s.total_scenarios == 0
        assert s.pass_rate == 0.0

    def test_calculate_summary(self):
        now = datetime.now(timezone.utc)
        results = [
            ScenarioResult(
                scenario_path='a.yaml', job_name='j1', outcome='pass',
                duration_ms=100, step_results=[
                    StepResult(step_id='s1', command='c', outcome='pass', duration_ms=50),
                ],
                passed_steps=1, failed_steps=0, skipped_steps=0,
                started_at=now, completed_at=now,
            ),
            ScenarioResult(
                scenario_path='b.yaml', job_name='j2', outcome='fail',
                duration_ms=200, step_results=[
                    StepResult(step_id='s1', command='c', outcome='fail', duration_ms=100),
                ],
                passed_steps=0, failed_steps=1, skipped_steps=0,
                started_at=now, completed_at=now,
            ),
        ]
        summary = calculate_summary(results)
        assert summary.total_scenarios == 2
        assert summary.passed_scenarios == 1
        assert summary.failed_scenarios == 1
        assert summary.pass_rate == 0.5

    def test_create_step_error(self):
        err = create_step_error('command_failed', 'Oops')
        assert err.type == 'command_failed'
        assert err.message == 'Oops'
