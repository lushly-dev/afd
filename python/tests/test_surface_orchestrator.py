"""Tests for the validate_command_surface orchestrator, suppressions, strict mode, and prerequisite rules."""

from afd.testing.surface.rules import (
	check_circular_prerequisites,
	check_unresolved_prerequisites,
)
from afd.testing.surface.types import (
	SurfaceCommand,
	SurfaceValidationOptions,
	SurfaceValidationResult,
)
from afd.testing.surface.validate import validate_command_surface


def _cmd(
	name: str,
	description: str = "Retrieves data from the system for this command",
	*,
	category: str | None = None,
	json_schema: dict | None = None,
	requires: list[str] | None = None,
) -> SurfaceCommand:
	"""Shorthand for creating a SurfaceCommand."""
	return SurfaceCommand(
		name=name,
		description=description,
		category=category,
		json_schema=json_schema,
		requires=requires,
	)


class TestCheckUnresolvedPrerequisites:
	"""Tests for check_unresolved_prerequisites rule."""

	def test_detects_missing_prerequisite(self):
		"""A requires entry pointing to a non-existent command should be flagged."""
		commands = [
			_cmd("step-two", requires=["step-one"]),
		]
		findings = check_unresolved_prerequisites(commands)
		assert len(findings) == 1
		assert findings[0].rule == "unresolved-prerequisite"
		assert findings[0].severity == "error"
		assert findings[0].evidence["missingCommand"] == "step-one"

	def test_no_finding_when_prerequisites_resolved(self):
		"""All requires entries pointing to registered commands should pass."""
		commands = [
			_cmd("step-one"),
			_cmd("step-two", requires=["step-one"]),
		]
		findings = check_unresolved_prerequisites(commands)
		assert len(findings) == 0

	def test_no_finding_when_no_requires(self):
		"""Commands without requires should not produce findings."""
		commands = [_cmd("standalone-cmd")]
		findings = check_unresolved_prerequisites(commands)
		assert len(findings) == 0

	def test_multiple_missing_prerequisites(self):
		"""Multiple missing prereqs should each produce a finding."""
		commands = [
			_cmd("step-three", requires=["step-one", "step-two"]),
		]
		findings = check_unresolved_prerequisites(commands)
		assert len(findings) == 2


class TestCheckCircularPrerequisites:
	"""Tests for check_circular_prerequisites rule."""

	def test_detects_simple_cycle(self):
		"""A -> B -> A should be detected."""
		commands = [
			_cmd("cmd-a", requires=["cmd-b"]),
			_cmd("cmd-b", requires=["cmd-a"]),
		]
		findings = check_circular_prerequisites(commands)
		assert len(findings) >= 1
		assert findings[0].rule == "circular-prerequisite"
		assert findings[0].severity == "error"

	def test_detects_longer_cycle(self):
		"""A -> B -> C -> A should be detected."""
		commands = [
			_cmd("cmd-a", requires=["cmd-b"]),
			_cmd("cmd-b", requires=["cmd-c"]),
			_cmd("cmd-c", requires=["cmd-a"]),
		]
		findings = check_circular_prerequisites(commands)
		assert len(findings) >= 1

	def test_no_finding_for_acyclic_graph(self):
		"""A linear dependency chain should not produce findings."""
		commands = [
			_cmd("cmd-a"),
			_cmd("cmd-b", requires=["cmd-a"]),
			_cmd("cmd-c", requires=["cmd-b"]),
		]
		findings = check_circular_prerequisites(commands)
		assert len(findings) == 0

	def test_no_finding_when_no_requires(self):
		"""Commands without requires should not produce findings."""
		commands = [_cmd("cmd-a"), _cmd("cmd-b")]
		findings = check_circular_prerequisites(commands)
		assert len(findings) == 0

	def test_self_cycle_detected(self):
		"""A command requiring itself should be detected as a cycle."""
		commands = [_cmd("cmd-a", requires=["cmd-a"])]
		findings = check_circular_prerequisites(commands)
		assert len(findings) >= 1


class TestValidateCommandSurface:
	"""Tests for the validate_command_surface orchestrator."""

	def test_returns_valid_for_clean_surface(self):
		"""A well-designed command surface should be valid."""
		commands = [
			_cmd("user-create", "Creates a new user account with the given data", category="users"),
			_cmd("user-delete", "Deletes an existing user account by identifier", category="users"),
			_cmd(
				"order-list",
				"Lists all orders for the current authenticated user",
				category="orders",
			),
			_cmd(
				"order-create",
				"Creates a new order with the specified items and quantities",
				category="orders",
			),
		]
		result = validate_command_surface(commands)
		assert isinstance(result, SurfaceValidationResult)
		assert result.valid is True
		assert result.summary.error_count == 0

	def test_returns_invalid_on_errors(self):
		"""A surface with naming convention errors should be invalid."""
		commands = [
			_cmd("badName", "Creates a new user in the system"),
		]
		result = validate_command_surface(commands)
		assert result.valid is False
		assert result.summary.error_count > 0

	def test_summary_counts(self):
		"""Summary should correctly count errors, warnings, and info."""
		commands = [
			_cmd("user-create", "Creates a new user account with the given data"),
			_cmd("user-add", "Creates a new user account in the application"),
		]
		result = validate_command_surface(commands)
		total = (
			result.summary.error_count
			+ result.summary.warning_count
			+ result.summary.info_count
			+ result.summary.suppressed_count
		)
		active_findings = [f for f in result.findings if not f.suppressed]
		assert total >= len(active_findings)

	def test_command_count_in_summary(self):
		"""Summary should reflect the number of commands validated."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system", category="users"),
			_cmd("user-delete", "Deletes a user account from the system", category="users"),
		]
		result = validate_command_surface(commands)
		assert result.summary.command_count == 2

	def test_rules_evaluated_populated(self):
		"""rules_evaluated should list all rules that ran."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system", category="users"),
		]
		result = validate_command_surface(commands)
		assert "similar-descriptions" in result.summary.rules_evaluated
		assert "naming-convention" in result.summary.rules_evaluated
		assert len(result.summary.rules_evaluated) == 11

	def test_duration_ms_set(self):
		"""duration_ms should be a non-negative number."""
		commands = [_cmd("user-create", "Creates a user account in the system")]
		result = validate_command_surface(commands)
		assert result.summary.duration_ms >= 0


class TestSuppressions:
	"""Tests for suppression matching in validate_command_surface."""

	def test_rule_level_suppression(self):
		"""Suppressing a rule by name should mark all findings of that rule."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system"),
			_cmd("user-add", "Creates a new user account in the application"),
		]
		opts = SurfaceValidationOptions(
			suppressions=["similar-descriptions"],
		)
		result = validate_command_surface(commands, opts)
		similar = [f for f in result.findings if f.rule == "similar-descriptions"]
		for finding in similar:
			assert finding.suppressed is True

	def test_command_level_suppression(self):
		"""Suppressing rule:command should only suppress that command's finding."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system"),
			_cmd("order-list"),  # missing category -> info finding
		]
		opts = SurfaceValidationOptions(
			suppressions=["missing-category:order-list"],
		)
		result = validate_command_surface(commands, opts)
		missing_cat = [f for f in result.findings if f.rule == "missing-category"]
		for finding in missing_cat:
			if "order-list" in finding.commands and len(finding.commands) == 1:
				assert finding.suppressed is True

	def test_pair_level_suppression(self):
		"""Suppressing rule:cmdA:cmdB should only suppress that pair's finding."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system"),
			_cmd("user-add", "Creates a new user account in the application"),
			_cmd("user-update", "Creates a new user account in the platform"),
		]
		opts = SurfaceValidationOptions(
			similarity_threshold=0.3,
			suppressions=["similar-descriptions:user-create:user-add"],
		)
		result = validate_command_surface(commands, opts)
		for finding in result.findings:
			if finding.rule == "similar-descriptions":
				cmds_sorted = sorted(finding.commands)
				if cmds_sorted == ["user-add", "user-create"]:
					assert finding.suppressed is True

	def test_suppressed_count_in_summary(self):
		"""Suppressed findings should be counted in suppressed_count."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system"),
		]
		opts = SurfaceValidationOptions(
			suppressions=["missing-category"],
		)
		result = validate_command_surface(commands, opts)
		assert result.summary.suppressed_count >= 1

	def test_suppressed_findings_not_counted_as_errors(self):
		"""Suppressed errors should not affect validity."""
		commands = [
			_cmd("badName", "Creates a new user in the system with proper handling"),
		]
		# Without suppression: naming-convention error makes it invalid
		result_unsuppressed = validate_command_surface(commands)
		assert result_unsuppressed.valid is False

		# With suppression: error is suppressed, should be valid
		opts = SurfaceValidationOptions(
			suppressions=["naming-convention"],
		)
		result_suppressed = validate_command_surface(commands, opts)
		assert result_suppressed.valid is True


class TestStrictMode:
	"""Tests for strict mode in validate_command_surface."""

	def test_strict_mode_fails_on_warnings(self):
		"""In strict mode, warnings should also make the result invalid."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system"),
			_cmd("user-add", "Creates a new user account in the application"),
		]
		opts = SurfaceValidationOptions(strict=True, similarity_threshold=0.3)
		result = validate_command_surface(commands, opts)
		if result.summary.warning_count > 0:
			assert result.valid is False

	def test_non_strict_mode_allows_warnings(self):
		"""In non-strict mode, warnings should not affect validity."""
		commands = [
			_cmd("user-create", "Creates a new user account in the system"),
			_cmd("user-add", "Creates a new user account in the application"),
		]
		opts = SurfaceValidationOptions(strict=False, similarity_threshold=0.3)
		result = validate_command_surface(commands, opts)
		# Should be valid as long as there are no errors
		if result.summary.error_count == 0:
			assert result.valid is True


class TestSkipCategories:
	"""Tests for skip_categories in validate_command_surface."""

	def test_commands_in_skipped_category_excluded(self):
		"""Commands in skipped categories should be excluded from validation."""
		commands = [
			_cmd("internal-debug", "Dumps internal debug state for operators", category="internal"),
			_cmd("user-create", "Creates a new user account in the system", category="users"),
		]
		opts = SurfaceValidationOptions(skip_categories=["internal"])
		result = validate_command_surface(commands, opts)
		assert result.summary.command_count == 1

	def test_skip_categories_empty_includes_all(self):
		"""Empty skip_categories should include all commands."""
		commands = [
			_cmd("user-create", "Creates user", category="users"),
			_cmd("order-list", "Lists orders", category="orders"),
		]
		opts = SurfaceValidationOptions(skip_categories=[])
		result = validate_command_surface(commands, opts)
		assert result.summary.command_count == 2
