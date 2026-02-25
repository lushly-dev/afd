"""Tests for the AFD agent hints module — core hint types, generation, retry, related commands, and next steps."""

import pytest
from afd.testing.hints import (
	AgentHints,
	AgentEnhancedResult,
	generate_agent_hints,
	_should_retry_command,
	_get_related_commands,
	_suggest_next_steps,
)


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
