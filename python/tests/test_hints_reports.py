"""Tests for the AFD agent hints module — confidence calculation, report hints, coverage hints, and enhancement function."""

import pytest
from afd.testing.hints import (
	AgentHints,
	generate_test_report_hints,
	generate_coverage_hints,
	enhance_with_agent_hints,
	_calculate_interpretation_confidence,
)


class TestCalculateInterpretationConfidence:
	"""Tests for _calculate_interpretation_confidence helper."""

	def test_base_confidence_on_success(self):
		"""Successful result should start at 0.9 confidence."""
		result = {"success": True, "data": {}}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.9)

	def test_reduced_confidence_on_failure_without_code(self):
		"""Failed result without error code should reduce confidence."""
		result = {"success": False, "error": {"message": "Something failed"}}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.7)

	def test_normal_confidence_on_failure_with_code(self):
		"""Failed result with error code should keep base confidence."""
		result = {
			"success": False,
			"error": {"code": "PARSE_ERROR", "message": "Bad syntax"},
		}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.9)

	def test_reasoning_boosts_confidence(self):
		"""Presence of reasoning should boost confidence by 0.05."""
		result = {"success": True, "data": {}, "reasoning": "Analyzed carefully"}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.95)

	def test_sources_boost_confidence(self):
		"""Presence of sources should boost confidence by 0.05."""
		result = {
			"success": True,
			"data": {},
			"sources": [{"url": "http://example.com"}],
		}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.95)

	def test_reasoning_and_sources_boost(self):
		"""Both reasoning and sources should boost confidence by 0.10."""
		result = {
			"success": True,
			"data": {},
			"reasoning": "Analyzed carefully",
			"sources": [{"url": "http://example.com"}],
		}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(1.0)

	def test_confidence_capped_at_1(self):
		"""Confidence should not exceed 1.0."""
		result = {
			"success": True,
			"data": {},
			"reasoning": "Reason",
			"sources": [{"a": 1}, {"b": 2}],
		}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence <= 1.0

	def test_confidence_minimum_zero(self):
		"""Confidence should not go below 0.0."""
		# Failure without code reduces by 0.2 from 0.9 -> 0.7, still above 0
		result = {"success": False, "error": {"message": "Fail"}}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence >= 0.0

	def test_failure_no_error_key(self):
		"""Failure without any error key should reduce confidence."""
		result = {"success": False}
		confidence = _calculate_interpretation_confidence(result)
		# error is None, no code -> confidence reduced
		assert confidence == pytest.approx(0.7)

	def test_empty_sources_no_boost(self):
		"""Empty sources list should not boost confidence."""
		result = {"success": True, "data": {}, "sources": []}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.9)

	def test_failure_with_code_and_reasoning(self):
		"""Failure with code and reasoning should be 0.95."""
		result = {
			"success": False,
			"error": {"code": "TIMEOUT", "message": "Timed out"},
			"reasoning": "Network issue detected",
		}
		confidence = _calculate_interpretation_confidence(result)
		assert confidence == pytest.approx(0.95)


class TestGenerateTestReportHints:
	"""Tests for generate_test_report_hints function."""

	def test_all_passing(self):
		"""Should indicate safe to proceed when pass rate >= 0.95."""
		report = {
			"summary": {"pass_rate": 1.0},
			"scenarios": [
				{"outcome": "pass", "step_results": []},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is False
		assert any("safe to proceed" in step.lower() for step in hints.next_steps)
		assert hints.interpretation_confidence == pytest.approx(1.0)

	def test_high_pass_rate(self):
		"""Should suggest review when pass rate is 0.8-0.95."""
		report = {
			"summary": {"pass_rate": 0.85},
			"scenarios": [
				{"outcome": "pass", "step_results": []},
				{"outcome": "fail", "step_results": []},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is False
		assert any("review failures" in step.lower() for step in hints.next_steps)

	def test_low_pass_rate_triggers_retry(self):
		"""Should set should_retry when pass rate < 0.8."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{"outcome": "pass", "step_results": []},
				{"outcome": "fail", "step_results": []},
				{"outcome": "fail", "step_results": []},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is True
		assert any("fix issues" in step.lower() for step in hints.next_steps)

	def test_failed_scenarios_count(self):
		"""Should report count of failed scenarios."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{"outcome": "pass", "step_results": []},
				{"outcome": "fail", "step_results": []},
				{"outcome": "error", "step_results": []},
			],
		}
		hints = generate_test_report_hints(report)
		assert any("2 failed scenario" in step for step in hints.next_steps)

	def test_verbose_suggestion_on_failure(self):
		"""Should suggest verbose mode when failures exist."""
		report = {"summary": {"pass_rate": 0.5}, "scenarios": [{"outcome": "fail", "step_results": []}]}
		hints = generate_test_report_hints(report)
		assert any("--verbose" in step for step in hints.next_steps)

	def test_related_commands_on_failure(self):
		"""Should suggest scenario-suggest --context failed on failures."""
		report = {"summary": {"pass_rate": 0.5}, "scenarios": [{"outcome": "fail", "step_results": []}]}
		hints = generate_test_report_hints(report)
		assert "scenario-suggest --context failed" in hints.related_commands

	def test_error_types_extracted(self):
		"""Should extract error types from failed scenario steps."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{
					"outcome": "fail",
					"step_results": [
						{"error": {"type": "timeout_error"}},
						{"error": {"type": "assertion_error"}},
					],
				},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.error_codes is not None
		assert "timeout_error" in hints.error_codes
		assert "assertion_error" in hints.error_codes

	def test_duplicate_error_types_deduplicated(self):
		"""Should deduplicate error types."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{
					"outcome": "fail",
					"step_results": [
						{"error": {"type": "timeout_error"}},
						{"error": {"type": "timeout_error"}},
					],
				},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.error_codes is not None
		assert len(hints.error_codes) == 1

	def test_no_error_types_when_missing(self):
		"""Should not set error_codes when step errors have no type."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{
					"outcome": "fail",
					"step_results": [
						{"error": {"message": "failed"}},
					],
				},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.error_codes is None

	def test_expectation_mismatch_steps(self):
		"""Should track steps with expectation mismatches."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{
					"outcome": "fail",
					"step_results": [
						{"error": {"type": "expectation_mismatch"}},
						{},
						{"error": {"type": "expectation_mismatch"}},
					],
				},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.low_confidence_steps is not None
		assert 0 in hints.low_confidence_steps
		assert 2 in hints.low_confidence_steps
		assert any("expectation mismatches" in step for step in hints.next_steps)

	def test_mismatch_across_scenarios(self):
		"""Should track mismatch step indices across multiple scenarios."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{
					"outcome": "fail",
					"step_results": [
						{"error": {"type": "expectation_mismatch"}},
					],
				},
				{
					"outcome": "fail",
					"step_results": [
						{},
						{"error": {"type": "expectation_mismatch"}},
					],
				},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.low_confidence_steps is not None
		# First scenario step 0 -> index 0, second scenario steps are indices 1 and 2
		assert 0 in hints.low_confidence_steps
		assert 2 in hints.low_confidence_steps

	def test_no_mismatch_steps(self):
		"""Should not set low_confidence_steps when no mismatches."""
		report = {
			"summary": {"pass_rate": 1.0},
			"scenarios": [
				{
					"outcome": "pass",
					"step_results": [{}],
				},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.low_confidence_steps is None

	def test_empty_report(self):
		"""Should handle empty report gracefully."""
		report = {"summary": {}, "scenarios": []}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is True  # pass_rate defaults to 0.0 which is < 0.8
		assert hints.interpretation_confidence == pytest.approx(0.0)

	def test_exactly_95_percent_pass_rate(self):
		"""Should treat 0.95 pass rate as safe to proceed."""
		report = {"summary": {"pass_rate": 0.95}, "scenarios": [{"outcome": "pass", "step_results": []}]}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is False
		assert any("safe to proceed" in step.lower() for step in hints.next_steps)

	def test_exactly_80_percent_pass_rate(self):
		"""Should treat 0.80 pass rate as 'most passing'."""
		report = {"summary": {"pass_rate": 0.80}, "scenarios": []}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is False
		assert any("review failures" in step.lower() for step in hints.next_steps)


class TestGenerateCoverageHints:
	"""Tests for generate_coverage_hints function."""

	def test_excellent_coverage(self):
		"""Should suggest focus on edge cases for >= 90% coverage."""
		hints = generate_coverage_hints(
			tested=["cmd-a", "cmd-b", "cmd-c"],
			untested=[],
			coverage_percent=95.0,
		)
		assert hints.should_retry is False
		assert hints.interpretation_confidence == pytest.approx(0.95)
		assert any("edge cases" in step.lower() for step in hints.next_steps)
		assert hints.untested_commands is None

	def test_good_coverage(self):
		"""Should suggest adding tests for 70-90% coverage."""
		hints = generate_coverage_hints(
			tested=["cmd-a", "cmd-b"],
			untested=["cmd-c"],
			coverage_percent=75.0,
		)
		assert any("remaining commands" in step.lower() for step in hints.next_steps)

	def test_low_coverage(self):
		"""Should prioritize adding tests for < 70% coverage."""
		hints = generate_coverage_hints(
			tested=["cmd-a"],
			untested=["cmd-b", "cmd-c", "cmd-d"],
			coverage_percent=30.0,
		)
		assert any("low coverage" in step.lower() for step in hints.next_steps)

	def test_untested_commands_set(self):
		"""Should set untested_commands when there are untested commands."""
		hints = generate_coverage_hints(
			tested=["cmd-a"],
			untested=["cmd-b", "cmd-c"],
			coverage_percent=50.0,
		)
		assert hints.untested_commands == ["cmd-b", "cmd-c"]

	def test_untested_count_message(self):
		"""Should report number of untested commands."""
		hints = generate_coverage_hints(
			tested=["cmd-a"],
			untested=["cmd-b", "cmd-c"],
			coverage_percent=50.0,
		)
		assert any("2 command(s)" in step for step in hints.next_steps)

	def test_related_commands_on_untested(self):
		"""Should suggest scenario-create when commands are untested."""
		hints = generate_coverage_hints(
			tested=[],
			untested=["cmd-a"],
			coverage_percent=0.0,
		)
		assert "scenario-create --template crud" in hints.related_commands

	def test_scenario_create_suggestion(self):
		"""Should suggest using scenario-create for templates."""
		hints = generate_coverage_hints(
			tested=[],
			untested=["cmd-a"],
			coverage_percent=0.0,
		)
		assert any("scenario-create" in step for step in hints.next_steps)

	def test_priority_mutation_commands(self):
		"""Should flag create/delete commands as priority."""
		hints = generate_coverage_hints(
			tested=[],
			untested=["todo.create", "todo.list", "todo.delete"],
			coverage_percent=0.0,
		)
		assert any("Priority" in step and "todo.create" in step for step in hints.next_steps)
		assert any("Priority" in step and "todo.delete" in step for step in hints.next_steps)

	def test_no_priority_without_mutation_commands(self):
		"""Should not add priority message when no create/delete commands."""
		hints = generate_coverage_hints(
			tested=[],
			untested=["todo.list", "todo.get"],
			coverage_percent=0.0,
		)
		assert not any("Priority" in step for step in hints.next_steps)

	def test_no_untested_commands(self):
		"""Should not set untested_commands when all commands are tested."""
		hints = generate_coverage_hints(
			tested=["cmd-a", "cmd-b"],
			untested=[],
			coverage_percent=100.0,
		)
		assert hints.untested_commands is None
		assert hints.related_commands == []

	def test_exactly_90_percent(self):
		"""Should treat 90% as excellent coverage."""
		hints = generate_coverage_hints(
			tested=["a", "b", "c"],
			untested=[],
			coverage_percent=90.0,
		)
		assert any("edge cases" in step.lower() for step in hints.next_steps)

	def test_exactly_70_percent(self):
		"""Should treat 70% as good coverage."""
		hints = generate_coverage_hints(
			tested=["a", "b"],
			untested=["c"],
			coverage_percent=70.0,
		)
		assert any("remaining commands" in step.lower() for step in hints.next_steps)


class TestEnhanceWithAgentHints:
	"""Tests for enhance_with_agent_hints function."""

	def test_wraps_successful_result(self):
		"""Should add _agent_hints to a successful result dict."""
		result = {"success": True, "data": {"id": 1}}
		enhanced = enhance_with_agent_hints("scenario-list", result)
		assert "_agent_hints" in enhanced
		assert isinstance(enhanced["_agent_hints"], AgentHints)
		assert enhanced["success"] is True
		assert enhanced["data"] == {"id": 1}

	def test_wraps_failed_result(self):
		"""Should add _agent_hints to a failed result dict."""
		result = {
			"success": False,
			"error": {"code": "TIMEOUT", "message": "Timed out"},
		}
		enhanced = enhance_with_agent_hints("scenario-evaluate", result)
		assert "_agent_hints" in enhanced
		hints = enhanced["_agent_hints"]
		assert hints.should_retry is True
		assert hints.error_codes == ["TIMEOUT"]

	def test_preserves_original_keys(self):
		"""Should preserve all original keys from the result."""
		result = {
			"success": True,
			"data": {"value": 42},
			"reasoning": "Computed",
			"custom_key": "custom_value",
		}
		enhanced = enhance_with_agent_hints("scenario-list", result)
		assert enhanced["reasoning"] == "Computed"
		assert enhanced["custom_key"] == "custom_value"

	def test_does_not_mutate_original(self):
		"""Should not mutate the original result dict."""
		result = {"success": True, "data": {}}
		enhanced = enhance_with_agent_hints("scenario-list", result)
		assert "_agent_hints" not in result
		assert "_agent_hints" in enhanced

	def test_hints_have_correct_type(self):
		"""The _agent_hints value should be an AgentHints instance."""
		result = {"success": True, "data": {}}
		enhanced = enhance_with_agent_hints("scenario-list", result)
		hints = enhanced["_agent_hints"]
		assert isinstance(hints, AgentHints)
		assert isinstance(hints.should_retry, bool)
		assert isinstance(hints.related_commands, list)
		assert isinstance(hints.next_steps, list)
		assert isinstance(hints.interpretation_confidence, float)

	def test_integration_failure_with_suggestion(self):
		"""Integration test: failed result with suggestion flows through."""
		result = {
			"success": False,
			"error": {
				"code": "PARSE_ERROR",
				"message": "Bad YAML",
				"suggestion": "Fix the syntax",
			},
		}
		enhanced = enhance_with_agent_hints("scenario-evaluate", result)
		hints = enhanced["_agent_hints"]
		assert hints.should_retry is False
		assert hints.error_codes == ["PARSE_ERROR"]
		assert "Fix the syntax" in hints.next_steps
		assert any("YAML" in step or "syntax" in step.lower() for step in hints.next_steps)
