"""Tests for the AFD agent hints module."""

import pytest
from afd.testing.hints import (
	AgentHints,
	AgentEnhancedResult,
	generate_agent_hints,
	generate_test_report_hints,
	generate_coverage_hints,
	enhance_with_agent_hints,
	_should_retry_command,
	_get_related_commands,
	_suggest_next_steps,
	_calculate_interpretation_confidence,
)


# ==============================================================================
# Test AgentHints dataclass
# ==============================================================================

class TestAgentHintsDataclass:
	"""Tests for the AgentHints dataclass."""

	def test_required_fields(self):
		"""Should create with required fields."""
		hints = AgentHints(
			should_retry=False,
			related_commands=["cmd-a"],
			next_steps=["do something"],
			interpretation_confidence=0.9,
		)
		assert hints.should_retry is False
		assert hints.related_commands == ["cmd-a"]
		assert hints.next_steps == ["do something"]
		assert hints.interpretation_confidence == 0.9

	def test_optional_fields_default_to_none(self):
		"""Optional fields should default to None."""
		hints = AgentHints(
			should_retry=False,
			related_commands=[],
			next_steps=[],
			interpretation_confidence=0.5,
		)
		assert hints.low_confidence_steps is None
		assert hints.untested_commands is None
		assert hints.error_codes is None

	def test_optional_fields_set_explicitly(self):
		"""Should accept optional fields when provided."""
		hints = AgentHints(
			should_retry=True,
			related_commands=[],
			next_steps=[],
			interpretation_confidence=0.7,
			low_confidence_steps=[0, 2],
			untested_commands=["cmd-x"],
			error_codes=["TIMEOUT"],
		)
		assert hints.low_confidence_steps == [0, 2]
		assert hints.untested_commands == ["cmd-x"]
		assert hints.error_codes == ["TIMEOUT"]


# ==============================================================================
# Test AgentEnhancedResult dataclass
# ==============================================================================

class TestAgentEnhancedResultDataclass:
	"""Tests for the AgentEnhancedResult dataclass."""

	def test_success_result(self):
		"""Should represent a successful result."""
		result = AgentEnhancedResult(success=True, data={"id": 1})
		assert result.success is True
		assert result.data == {"id": 1}
		assert result.error is None
		assert result._agent_hints is None

	def test_failure_result_with_hints(self):
		"""Should represent a failure result with hints attached."""
		hints = AgentHints(
			should_retry=True,
			related_commands=[],
			next_steps=["retry"],
			interpretation_confidence=0.8,
		)
		result = AgentEnhancedResult(
			success=False,
			error={"code": "TIMEOUT", "message": "Timed out"},
			_agent_hints=hints,
		)
		assert result.success is False
		assert result.error["code"] == "TIMEOUT"
		assert result._agent_hints.should_retry is True


# ==============================================================================
# Test generate_agent_hints
# ==============================================================================

class TestGenerateAgentHints:
	"""Tests for generate_agent_hints function."""

	def test_successful_result(self):
		"""Should generate hints for a successful result."""
		result = {"success": True, "data": {"id": 1}}
		hints = generate_agent_hints("scenario-list", result)
		assert isinstance(hints, AgentHints)
		assert hints.should_retry is False
		assert hints.error_codes is None

	def test_successful_result_has_next_steps(self):
		"""Should include next steps for a successful scenario-list."""
		result = {"success": True, "data": []}
		hints = generate_agent_hints("scenario-list", result)
		assert any("scenario-evaluate" in step for step in hints.next_steps)

	def test_successful_scenario_create(self):
		"""Should suggest editing and evaluating after scenario-create."""
		result = {"success": True, "data": {"path": "/scenarios/new.yaml"}}
		hints = generate_agent_hints("scenario-create", result)
		assert any("Edit" in step or "edit" in step.lower() for step in hints.next_steps)
		assert any("scenario-evaluate" in step for step in hints.next_steps)

	def test_successful_scenario_evaluate(self):
		"""Should suggest coverage check after scenario-evaluate."""
		result = {"success": True, "data": {"passed": 5}}
		hints = generate_agent_hints("scenario-evaluate", result)
		assert any("coverage" in step.lower() for step in hints.next_steps)

	def test_successful_scenario_coverage(self):
		"""Should suggest gap analysis after scenario-coverage."""
		result = {"success": True, "data": {"coverage": 80}}
		hints = generate_agent_hints("scenario-coverage", result)
		assert any("scenario-suggest" in step for step in hints.next_steps)

	def test_failed_result_with_error_code(self):
		"""Should extract error codes from a failed result."""
		result = {
			"success": False,
			"error": {"code": "PARSE_ERROR", "message": "Invalid YAML"},
		}
		hints = generate_agent_hints("scenario-evaluate", result)
		assert hints.error_codes == ["PARSE_ERROR"]

	def test_failed_result_without_error_code(self):
		"""Should not set error_codes when code is missing."""
		result = {
			"success": False,
			"error": {"message": "Something went wrong"},
		}
		hints = generate_agent_hints("scenario-evaluate", result)
		assert hints.error_codes is None

	def test_failed_result_no_error_key(self):
		"""Should handle failed result with no error key."""
		result = {"success": False}
		hints = generate_agent_hints("scenario-evaluate", result)
		assert hints.error_codes is None
		assert hints.should_retry is False

	def test_failed_result_includes_related_commands(self):
		"""Should include failure-related commands for failed results."""
		result = {
			"success": False,
			"error": {"code": "NOT_FOUND", "message": "Missing file"},
		}
		hints = generate_agent_hints("scenario-evaluate", result)
		assert "scenario-suggest --context failed" in hints.related_commands

	def test_confidence_with_reasoning(self):
		"""Should boost confidence when reasoning is present."""
		result = {"success": True, "data": {}, "reasoning": "Analyzed inputs"}
		hints = generate_agent_hints("scenario-list", result)
		assert hints.interpretation_confidence > 0.9

	def test_confidence_with_sources(self):
		"""Should boost confidence when sources are present."""
		result = {"success": True, "data": {}, "sources": [{"url": "http://example.com"}]}
		hints = generate_agent_hints("scenario-list", result)
		assert hints.interpretation_confidence > 0.9


# ==============================================================================
# Test _should_retry_command
# ==============================================================================

class TestShouldRetryCommand:
	"""Tests for _should_retry_command helper."""

	def test_success_never_retries(self):
		"""Successful results should never be retried."""
		result = {"success": True, "data": "ok"}
		assert _should_retry_command(result) is False

	def test_no_error_never_retries(self):
		"""Failed results without error should not retry."""
		result = {"success": False}
		assert _should_retry_command(result) is False

	def test_explicit_retryable_true(self):
		"""Should retry when error explicitly says retryable=True."""
		result = {
			"success": False,
			"error": {"code": "SOME_ERROR", "message": "Fail", "retryable": True},
		}
		assert _should_retry_command(result) is True

	def test_explicit_retryable_false(self):
		"""Should not retry when error explicitly says retryable=False."""
		result = {
			"success": False,
			"error": {"code": "TIMEOUT", "message": "Timed out", "retryable": False},
		}
		assert _should_retry_command(result) is False

	def test_timeout_code_retries(self):
		"""TIMEOUT error code should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "TIMEOUT", "message": "Timed out"},
		}
		assert _should_retry_command(result) is True

	def test_connection_error_retries(self):
		"""CONNECTION_ERROR code should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "CONNECTION_ERROR", "message": "Connection lost"},
		}
		assert _should_retry_command(result) is True

	def test_rate_limited_retries(self):
		"""RATE_LIMITED code should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "RATE_LIMITED", "message": "Too many requests"},
		}
		assert _should_retry_command(result) is True

	def test_service_unavailable_retries(self):
		"""SERVICE_UNAVAILABLE code should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "SERVICE_UNAVAILABLE", "message": "Service down"},
		}
		assert _should_retry_command(result) is True

	def test_non_transient_code_no_retry(self):
		"""Non-transient error codes should not trigger retry."""
		result = {
			"success": False,
			"error": {"code": "VALIDATION_ERROR", "message": "Invalid input"},
		}
		assert _should_retry_command(result) is False

	def test_parse_error_no_retry(self):
		"""PARSE_ERROR should not trigger retry."""
		result = {
			"success": False,
			"error": {"code": "PARSE_ERROR", "message": "Bad syntax"},
		}
		assert _should_retry_command(result) is False

	def test_suggestion_with_try_again_retries(self):
		"""Suggestion containing 'try again' should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "GENERIC", "message": "Fail", "suggestion": "Please try again later"},
		}
		assert _should_retry_command(result) is True

	def test_suggestion_with_retry_retries(self):
		"""Suggestion containing 'retry' should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "GENERIC", "message": "Fail", "suggestion": "Retry the request"},
		}
		assert _should_retry_command(result) is True

	def test_suggestion_with_temporary_retries(self):
		"""Suggestion containing 'temporary' should trigger retry."""
		result = {
			"success": False,
			"error": {"code": "GENERIC", "message": "Fail", "suggestion": "This is a temporary issue"},
		}
		assert _should_retry_command(result) is True

	def test_suggestion_without_retry_keywords(self):
		"""Suggestion without retry keywords should not trigger retry."""
		result = {
			"success": False,
			"error": {"code": "GENERIC", "message": "Fail", "suggestion": "Check your input"},
		}
		assert _should_retry_command(result) is False

	def test_suggestion_none_no_retry(self):
		"""None suggestion should not cause errors."""
		result = {
			"success": False,
			"error": {"code": "GENERIC", "message": "Fail", "suggestion": None},
		}
		assert _should_retry_command(result) is False


# ==============================================================================
# Test _get_related_commands
# ==============================================================================

class TestGetRelatedCommands:
	"""Tests for _get_related_commands helper."""

	def test_scenario_list_success(self):
		"""scenario-list should suggest evaluate and coverage."""
		result = {"success": True, "data": []}
		related = _get_related_commands("scenario-list", result)
		assert "scenario-evaluate" in related
		assert "scenario-coverage" in related

	def test_scenario_evaluate_success(self):
		"""scenario-evaluate should suggest coverage and suggest."""
		result = {"success": True, "data": {}}
		related = _get_related_commands("scenario-evaluate", result)
		assert "scenario-coverage" in related
		assert "scenario-suggest" in related

	def test_scenario_coverage_success(self):
		"""scenario-coverage should suggest suggest and create."""
		result = {"success": True, "data": {}}
		related = _get_related_commands("scenario-coverage", result)
		assert "scenario-suggest" in related
		assert "scenario-create" in related

	def test_scenario_create_success(self):
		"""scenario-create should suggest evaluate."""
		result = {"success": True, "data": {}}
		related = _get_related_commands("scenario-create", result)
		assert "scenario-evaluate" in related

	def test_failed_result_includes_suggest_failed(self):
		"""Failed results should include scenario-suggest --context failed."""
		result = {
			"success": False,
			"error": {"code": "ERROR", "message": "Failed"},
		}
		related = _get_related_commands("scenario-evaluate", result)
		assert "scenario-suggest --context failed" in related

	def test_failed_scenario_list_has_both(self):
		"""Failed scenario-list should have standard related plus failed suggest."""
		result = {
			"success": False,
			"error": {"code": "ERROR", "message": "Failed"},
		}
		related = _get_related_commands("scenario-list", result)
		assert "scenario-evaluate" in related
		assert "scenario-coverage" in related
		assert "scenario-suggest --context failed" in related

	def test_non_scenario_command_success(self):
		"""Non-scenario commands should return empty related on success."""
		result = {"success": True, "data": {}}
		related = _get_related_commands("todo-create", result)
		assert related == []

	def test_non_scenario_command_failure(self):
		"""Non-scenario commands should return failed suggest on failure."""
		result = {
			"success": False,
			"error": {"code": "ERROR", "message": "Oops"},
		}
		related = _get_related_commands("todo-create", result)
		assert related == ["scenario-suggest --context failed"]

	def test_unknown_scenario_subcommand_success(self):
		"""Unknown scenario subcommand should return empty on success."""
		result = {"success": True, "data": {}}
		related = _get_related_commands("scenario-unknown", result)
		assert related == []

	def test_unknown_scenario_subcommand_failure(self):
		"""Unknown scenario subcommand should return failed suggest on failure."""
		result = {
			"success": False,
			"error": {"code": "ERROR", "message": "Failed"},
		}
		related = _get_related_commands("scenario-unknown", result)
		assert related == ["scenario-suggest --context failed"]


# ==============================================================================
# Test _suggest_next_steps
# ==============================================================================

class TestSuggestNextSteps:
	"""Tests for _suggest_next_steps helper."""

	def test_scenario_list_success(self):
		"""Should suggest running evaluate after listing."""
		result = {"success": True, "data": []}
		steps = _suggest_next_steps("scenario-list", result)
		assert any("scenario-evaluate" in step for step in steps)

	def test_scenario_create_success(self):
		"""Should suggest editing and evaluating after create."""
		result = {"success": True, "data": {}}
		steps = _suggest_next_steps("scenario-create", result)
		assert len(steps) == 2
		assert any("Edit" in step or "edit" in step.lower() for step in steps)
		assert any("scenario-evaluate" in step for step in steps)

	def test_scenario_evaluate_success(self):
		"""Should suggest coverage check after evaluate."""
		result = {"success": True, "data": {}}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert any("coverage" in step.lower() for step in steps)

	def test_scenario_coverage_success(self):
		"""Should suggest finding gaps and creating scenarios."""
		result = {"success": True, "data": {}}
		steps = _suggest_next_steps("scenario-coverage", result)
		assert any("scenario-suggest" in step for step in steps)
		assert any("untested" in step.lower() or "scenario" in step.lower() for step in steps)

	def test_failure_with_suggestion(self):
		"""Should include the error suggestion in next steps."""
		result = {
			"success": False,
			"error": {"code": "ERROR", "message": "Failed", "suggestion": "Check the config"},
		}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert "Check the config" in steps

	def test_failure_parse_error(self):
		"""Should suggest checking YAML syntax for PARSE_ERROR."""
		result = {
			"success": False,
			"error": {"code": "PARSE_ERROR", "message": "Bad syntax"},
		}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert any("YAML" in step or "syntax" in step.lower() for step in steps)

	def test_failure_file_not_found(self):
		"""Should suggest verifying path for FILE_NOT_FOUND."""
		result = {
			"success": False,
			"error": {"code": "FILE_NOT_FOUND", "message": "No such file"},
		}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert any("path" in step.lower() for step in steps)

	def test_failure_validation_error(self):
		"""Should suggest reviewing schema for VALIDATION_ERROR."""
		result = {
			"success": False,
			"error": {"code": "VALIDATION_ERROR", "message": "Invalid schema"},
		}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert any("schema" in step.lower() for step in steps)

	def test_failure_with_suggestion_and_specific_code(self):
		"""Should include both suggestion and code-specific step."""
		result = {
			"success": False,
			"error": {
				"code": "PARSE_ERROR",
				"message": "Bad",
				"suggestion": "Fix formatting",
			},
		}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert "Fix formatting" in steps
		assert any("YAML" in step or "syntax" in step.lower() for step in steps)

	def test_failure_no_error(self):
		"""Should return empty steps for failure without error."""
		result = {"success": False}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert steps == []

	def test_success_unknown_command(self):
		"""Should return empty steps for unknown successful commands."""
		result = {"success": True, "data": {}}
		steps = _suggest_next_steps("todo-create", result)
		assert steps == []

	def test_failure_unknown_code(self):
		"""Should include suggestion but no code-specific step for unknown codes."""
		result = {
			"success": False,
			"error": {"code": "CUSTOM_CODE", "message": "Custom fail", "suggestion": "Do X"},
		}
		steps = _suggest_next_steps("scenario-evaluate", result)
		assert "Do X" in steps
		# Should not contain code-specific steps for unknown codes
		assert not any("YAML" in step for step in steps)
		assert not any("path" in step.lower() and "exists" in step.lower() for step in steps)


# ==============================================================================
# Test _calculate_interpretation_confidence
# ==============================================================================

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


# ==============================================================================
# Test generate_test_report_hints
# ==============================================================================

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
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{"outcome": "fail", "step_results": []},
			],
		}
		hints = generate_test_report_hints(report)
		assert any("--verbose" in step for step in hints.next_steps)

	def test_related_commands_on_failure(self):
		"""Should suggest scenario-suggest --context failed on failures."""
		report = {
			"summary": {"pass_rate": 0.5},
			"scenarios": [
				{"outcome": "fail", "step_results": []},
			],
		}
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
		report = {
			"summary": {"pass_rate": 0.95},
			"scenarios": [
				{"outcome": "pass", "step_results": []},
			],
		}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is False
		assert any("safe to proceed" in step.lower() for step in hints.next_steps)

	def test_exactly_80_percent_pass_rate(self):
		"""Should treat 0.80 pass rate as 'most passing'."""
		report = {
			"summary": {"pass_rate": 0.80},
			"scenarios": [],
		}
		hints = generate_test_report_hints(report)
		assert hints.should_retry is False
		assert any("review failures" in step.lower() for step in hints.next_steps)


# ==============================================================================
# Test generate_coverage_hints
# ==============================================================================

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


# ==============================================================================
# Test enhance_with_agent_hints
# ==============================================================================

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
