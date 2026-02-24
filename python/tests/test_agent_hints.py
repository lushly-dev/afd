"""Tests for the agent hints module."""

import pytest

from afd.testing.mcp.hints import (
    AgentEnhancedResult,
    AgentHints,
    enhance_with_agent_hints,
    generate_agent_hints,
    generate_coverage_hints,
    generate_test_report_hints,
)


class TestGenerateAgentHints:
    def test_success_result(self):
        result = {'success': True, 'data': {'count': 5}}
        hints = generate_agent_hints('scenario-list', result)
        assert hints.should_retry is False
        assert hints.interpretation_confidence > 0

    def test_failure_result_with_retry(self):
        result = {
            'success': False,
            'error': {'code': 'TIMEOUT', 'message': 'timed out'},
        }
        hints = generate_agent_hints('test-cmd', result)
        assert hints.should_retry is True
        assert hints.error_codes == ['TIMEOUT']

    def test_failure_result_no_retry(self):
        result = {
            'success': False,
            'error': {'code': 'NOT_FOUND', 'message': 'not found', 'retryable': False},
        }
        hints = generate_agent_hints('test-cmd', result)
        assert hints.should_retry is False
        assert hints.error_codes == ['NOT_FOUND']

    def test_retry_from_suggestion(self):
        result = {
            'success': False,
            'error': {'code': 'ERR', 'message': 'err', 'suggestion': 'Please try again'},
        }
        hints = generate_agent_hints('test-cmd', result)
        assert hints.should_retry is True

    def test_transient_codes(self):
        for code in ('TIMEOUT', 'CONNECTION_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'):
            result = {'success': False, 'error': {'code': code, 'message': 'err'}}
            hints = generate_agent_hints('test', result)
            assert hints.should_retry is True, f'{code} should be retryable'

    def test_related_commands_scenario_list(self):
        result = {'success': True, 'data': []}
        hints = generate_agent_hints('scenario-list', result)
        assert 'scenario-evaluate' in hints.related_commands
        assert 'scenario-coverage' in hints.related_commands

    def test_related_commands_scenario_evaluate(self):
        result = {'success': True, 'data': {}}
        hints = generate_agent_hints('scenario-evaluate', result)
        assert 'scenario-coverage' in hints.related_commands

    def test_next_steps_scenario_list_success(self):
        result = {'success': True, 'data': []}
        hints = generate_agent_hints('scenario-list', result)
        assert any('scenario-evaluate' in s for s in hints.next_steps)

    def test_next_steps_failure_with_suggestion(self):
        result = {
            'success': False,
            'error': {'code': 'PARSE_ERROR', 'message': 'bad yaml', 'suggestion': 'Check syntax'},
        }
        hints = generate_agent_hints('scenario-evaluate', result)
        assert 'Check syntax' in hints.next_steps
        assert any('YAML' in s for s in hints.next_steps)

    def test_confidence_base(self):
        result = {'success': True, 'data': {}}
        hints = generate_agent_hints('test', result)
        assert hints.interpretation_confidence == pytest.approx(0.9)

    def test_confidence_with_reasoning(self):
        result = {'success': True, 'data': {}, 'reasoning': 'because...'}
        hints = generate_agent_hints('test', result)
        assert hints.interpretation_confidence == pytest.approx(0.95)

    def test_confidence_with_sources(self):
        result = {'success': True, 'data': {}, 'sources': ['a', 'b']}
        hints = generate_agent_hints('test', result)
        assert hints.interpretation_confidence == pytest.approx(0.95)

    def test_confidence_error_no_code(self):
        result = {'success': False, 'error': {'message': 'unknown'}}
        hints = generate_agent_hints('test', result)
        assert hints.interpretation_confidence == pytest.approx(0.7)


class TestGenerateTestReportHints:
    def test_all_passing(self):
        report = {
            'summary': {'pass_rate': 1.0},
            'scenarios': [{'outcome': 'pass', 'step_results': []}],
        }
        hints = generate_test_report_hints(report)
        assert hints.should_retry is False
        assert any('safe to proceed' in s for s in hints.next_steps)

    def test_with_failures(self):
        report = {
            'summary': {'pass_rate': 0.5},
            'scenarios': [
                {'outcome': 'fail', 'step_results': [{'error': {'type': 'assertion'}}]},
                {'outcome': 'pass', 'step_results': []},
            ],
        }
        hints = generate_test_report_hints(report)
        assert hints.should_retry is True
        assert any('failed' in s.lower() for s in hints.next_steps)
        assert 'assertion' in (hints.error_codes or [])

    def test_expectation_mismatches(self):
        report = {
            'summary': {'pass_rate': 0.9},
            'scenarios': [
                {
                    'outcome': 'fail',
                    'step_results': [
                        {'error': {'type': 'expectation_mismatch'}},
                    ],
                },
            ],
        }
        hints = generate_test_report_hints(report)
        assert hints.low_confidence_steps is not None
        assert len(hints.low_confidence_steps) == 1

    def test_mostly_passing(self):
        report = {
            'summary': {'pass_rate': 0.85},
            'scenarios': [
                {'outcome': 'pass', 'step_results': []},
                {'outcome': 'fail', 'step_results': []},
            ],
        }
        hints = generate_test_report_hints(report)
        assert any('review failures' in s.lower() for s in hints.next_steps)


class TestGenerateCoverageHints:
    def test_full_coverage(self):
        hints = generate_coverage_hints(
            ['cmd-a', 'cmd-b'], [], 100.0
        )
        assert hints.untested_commands is None
        assert any('edge cases' in s for s in hints.next_steps)

    def test_partial_coverage(self):
        hints = generate_coverage_hints(
            ['cmd-a'], ['cmd-b', 'cmd-c'], 33.3
        )
        assert hints.untested_commands == ['cmd-b', 'cmd-c']
        assert any('no test coverage' in s for s in hints.next_steps)

    def test_priority_mutation_commands(self):
        hints = generate_coverage_hints(
            [], ['todo-create', 'todo-delete', 'todo-list'], 0.0
        )
        assert any('Priority' in s for s in hints.next_steps)
        assert any('todo-create' in s for s in hints.next_steps)


class TestEnhanceWithAgentHints:
    def test_wraps_result(self):
        result = {'success': True, 'data': 'hello'}
        enhanced = enhance_with_agent_hints('test-cmd', result)
        assert isinstance(enhanced, AgentEnhancedResult)
        assert enhanced.result is result
        assert isinstance(enhanced.agent_hints, AgentHints)
