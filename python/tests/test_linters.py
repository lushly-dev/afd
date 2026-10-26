"""Tests for AFDLinter — including per-rule calibration and suppression.

Covers the pre-existing rule behavior plus the configurable calibration surface:
story/test exclusion, per-rule path excludes, direct-fetch comment/data-URI
awareness, and the inline ``afd-lint-disable`` directive. Every suppression is
asserted against the transparent LintResult bookkeeping.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from afd.lushx_ext.linters import (
    AFDLinter,
    Severity,
    _is_comment_line,
    _is_data_uri_fetch,
    _is_story_or_test_file,
)


@pytest.fixture
def tmp_dir(tmp_path: Path) -> Path:
    return tmp_path


def _write(root: Path, rel: str, text: str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ─── Baseline behavior (unchanged) ───────────────────────────────────────────


def test_empty_dir_passes(tmp_dir: Path) -> None:
    result = AFDLinter().lint(tmp_dir)
    assert result.passed is True
    assert result.files_checked == 0
    assert result.suppressed_total == 0


def test_missing_command_result_flagged(tmp_dir: Path) -> None:
    _write(tmp_dir, "bad.py", "async def handler(input) -> dict:\n    return {}\n")
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 1
    assert result.issues[0].rule == "afd-command-result"


def test_business_in_ui_flagged_in_product_component(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/rich-data-grid/grid.ts",
        "export function avg(sum: number) {\n  return Math.round(sum);\n}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.warning_count == 1
    assert result.issues[0].rule == "afd-no-business-in-ui"
    assert result.suppressed_total == 0


def test_direct_fetch_flagged_in_ui(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/api/client.ts",
        "export async function pull() {\n  return await fetch('https://example.com/data');\n}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 1
    assert result.issues[0].rule == "afd-no-direct-fetch"


# ─── Story / test file exclusion (default ON) ────────────────────────────────


def test_story_file_business_logic_suppressed_by_default(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/widget/widget.stories.ts",
        "export const Default = () => Math.round(1.5);\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.warning_count == 0
    assert result.suppressed_total == 1
    assert result.suppressed_by_reason == {"story-or-test-file": 1}
    assert result.suppressed_by_rule == {"afd-no-business-in-ui": 1}


def test_test_file_direct_fetch_suppressed_by_default(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/widget/widget.test.ts",
        "it('loads', async () => {\n  await fetch('https://example.com/x');\n});\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"story-or-test-file": 1}


def test_spec_file_suffix_excluded(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/widget/widget.spec.tsx",
        "export const s = () => new Date();\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.warning_count == 0
    assert result.suppressed_by_reason == {"story-or-test-file": 1}


def test_story_exclusion_can_be_disabled(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/widget/widget.stories.ts",
        "export const Default = () => Math.round(1.5);\n",
    )
    result = AFDLinter(exclude_story_test_files=False).lint(tmp_dir)
    assert result.warning_count == 1
    assert result.suppressed_total == 0


def test_story_exclusion_does_not_touch_non_ui_rules(tmp_dir: Path) -> None:
    """Correctness rules still fire on story/test files."""
    _write(
        tmp_dir,
        "src/components/widget/widget.test.ts",
        "defineCommand({ name: 'Bad-Name' });\n",
    )
    result = AFDLinter().lint(tmp_dir)
    rules = {i.rule for i in result.issues}
    assert "afd-kebab-naming" in rules
    assert result.suppressed_total == 0


# ─── Per-rule path excludes ──────────────────────────────────────────────────


def test_rule_path_exclude_suppresses_named_rule(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/shell/shell.ts",
        "export function total() {\n  return Math.round(1.5);\n}\n",
    )
    linter = AFDLinter(rule_path_excludes={"afd-no-business-in-ui": ["src/components/shell/"]})
    result = linter.lint(tmp_dir)
    assert result.warning_count == 0
    assert result.suppressed_by_reason == {"rule-path-exclude": 1}
    assert result.suppressed_by_rule == {"afd-no-business-in-ui": 1}


def test_rule_path_exclude_is_scoped_to_that_rule(tmp_dir: Path) -> None:
    """A path excluded for one rule still triggers a different rule."""
    _write(
        tmp_dir,
        "src/components/shell/shell.ts",
        "export async function total() {\n"
        "  const n = Math.round(1.5);\n"
        "  return await fetch('https://example.com/x');\n"
        "}\n",
    )
    linter = AFDLinter(rule_path_excludes={"afd-no-business-in-ui": ["src/components/shell/"]})
    result = linter.lint(tmp_dir)
    # business-in-ui suppressed, direct-fetch survives.
    assert result.error_count == 1
    assert result.issues[0].rule == "afd-no-direct-fetch"
    assert result.suppressed_by_rule == {"afd-no-business-in-ui": 1}


def test_rule_path_exclude_matches_backslash_paths(tmp_dir: Path) -> None:
    """Windows backslash file paths match forward-slash exclude patterns."""
    _write(
        tmp_dir,
        "src/components/shell/shell.ts",
        "export function total() {\n  return Math.round(1.5);\n}\n",
    )
    # Pattern supplied with backslashes must be normalized and still match.
    linter = AFDLinter(rule_path_excludes={"afd-no-business-in-ui": ["src\\components\\shell\\"]})
    result = linter.lint(tmp_dir)
    assert result.warning_count == 0
    assert result.suppressed_by_reason == {"rule-path-exclude": 1}


def test_rule_path_exclude_default_none_is_backward_compatible(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/shell/shell.ts",
        "export function total() {\n  return Math.round(1.5);\n}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.warning_count == 1
    assert result.suppressed_total == 0


# ─── afd-no-direct-fetch accuracy: comments ──────────────────────────────────


def test_comment_line_fetch_not_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/panel/panel.ts",
        "// skip the extra fetch(url) and its observer churn\nexport const x = 1;\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"comment-line": 1}


def test_block_comment_star_line_not_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/panel/panel.ts",
        "/**\n * Historically we would fetch(url) here.\n */\nexport const x = 1;\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"comment-line": 1}


def test_real_fetch_with_trailing_comment_still_flagged(tmp_dir: Path) -> None:
    """A real fetch on a code line is not excused by a trailing comment."""
    _write(
        tmp_dir,
        "src/components/panel/panel.ts",
        "export const p = fetch('https://x'); // real call\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 1


# ─── afd-no-direct-fetch accuracy: data: URIs ────────────────────────────────


def test_data_uri_string_literal_not_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/exporter/exporter.ts",
        "export async function decode() {\n  return await fetch('data:image/png;base64,AAAA');\n}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"data-uri-fetch": 1}


def test_bare_dataurl_identifier_is_still_flagged(tmp_dir: Path) -> None:
    """Only literal data: strings are excused; bare identifiers are not."""
    _write(
        tmp_dir,
        "src/components/exporter/exporter.ts",
        "export async function copy(dataUrl: string) {\n  return await fetch(dataUrl);\n}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 1
    assert result.suppressed_total == 0


# ─── Inline suppression directive ────────────────────────────────────────────


def test_directive_on_line_above_suppresses(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/loader/loader.ts",
        "export async function load(assetUrl: string) {\n"
        "  // afd-lint-disable: static content-addressed asset, no contract value\n"
        "  return await fetch(assetUrl);\n"
        "}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"inline-directive": 1}


def test_directive_on_flagged_line_suppresses(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/loader/loader.ts",
        "export async function load(assetUrl: string) {\n"
        "  return await fetch(assetUrl); // afd-lint-disable: reviewed asset load\n"
        "}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"inline-directive": 1}


def test_directive_without_reason_does_not_suppress(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/loader/loader.ts",
        "export async function reload(assetUrl: string) {\n"
        "  // afd-lint-disable:\n"
        "  return await fetch(assetUrl);\n"
        "}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 1
    assert result.suppressed_total == 0


def test_directive_applies_to_any_rule(tmp_dir: Path) -> None:
    """The directive is linter-wide, not direct-fetch-only."""
    _write(
        tmp_dir,
        "src/components/grid/grid.ts",
        "export function avg(sum: number) {\n"
        "  return Math.round(sum); // afd-lint-disable: intentional local rounding\n"
        "}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.warning_count == 0
    assert result.suppressed_by_reason == {"inline-directive": 1}
    assert result.suppressed_by_rule == {"afd-no-business-in-ui": 1}


def test_directive_on_first_line_suppresses(tmp_dir: Path) -> None:
    """A directive on line 1 works — the line-above lookup handles the boundary."""
    _write(
        tmp_dir,
        "src/components/loader/loader.ts",
        "export const p = fetch(u); // afd-lint-disable: reviewed first-line load\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"inline-directive": 1}


def test_line_one_issue_does_not_wrap_to_last_line_directive(tmp_dir: Path) -> None:
    """Line 1's 'line above' is nothing — it must not wrap around to lines[-1]."""
    _write(
        tmp_dir,
        "src/components/loader/loader.ts",
        "export const p = fetch(u);\n"
        "export const q = 1;\n"
        "// afd-lint-disable: this reason belongs to nothing below it\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 1
    assert result.suppressed_total == 0


def test_directive_suppresses_in_crlf_file(tmp_dir: Path) -> None:
    """CRLF line endings keep line numbering and directive matching aligned."""
    p = tmp_dir / "src" / "components" / "loader" / "loader.ts"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(
        b"export async function load(assetUrl: string) {\r\n"
        b"  // afd-lint-disable: reviewed asset load\r\n"
        b"  return await fetch(assetUrl);\r\n"
        b"}\r\n"
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"inline-directive": 1}


def test_unicode_line_separator_does_not_shift_line_lookup(tmp_dir: Path) -> None:
    """U+2028 inside a string must not desync issue.line from the lookup array.

    str.splitlines() breaks on U+2028/2029 (and \\f, \\v, U+0085) while the
    rules number lines by counting "\\n" -- the lookup uses split("\\n") so both
    stay aligned and the same-line directive still suppresses the finding. With
    splitlines(), the U+2028 on line 1 would shift the lookup array down one
    entry, the directive would be missed, and the fetch would stay flagged.
    """
    _write(
        tmp_dir,
        "src/components/loader/loader.ts",
        "const s = 'a\u2028b';\n"
        "export const p = fetch(u); // afd-lint-disable: reviewed asset load\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"inline-directive": 1}


# ─── Transparency summary ────────────────────────────────────────────────────


def test_suppressed_summary_aggregates_all_reasons(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/widget/widget.stories.ts",
        "export const Default = () => Math.round(1.5);\n",
    )
    _write(
        tmp_dir,
        "src/components/panel/panel.ts",
        "// fetch(url) will be wired later\nexport const x = 1;\n",
    )
    _write(
        tmp_dir,
        "src/components/exporter/exporter.ts",
        "export async function decode() {\n  return await fetch('data:text/plain,hi');\n}\n",
    )
    _write(
        tmp_dir,
        "src/components/grid/grid.ts",
        "export function avg(sum: number) {\n  return Math.round(sum);\n}\n",
    )
    result = AFDLinter().lint(tmp_dir)

    # The genuine data-grid business-logic warning survives.
    assert result.warning_count == 1
    assert result.error_count == 0

    summary = result.suppressed_summary()
    assert summary["total"] == 3
    assert summary["by_reason"] == {
        "story-or-test-file": 1,
        "comment-line": 1,
        "data-uri-fetch": 1,
    }
    assert summary["by_rule"] == {
        "afd-no-business-in-ui": 1,
        "afd-no-direct-fetch": 2,
    }


def test_lint_result_dict_fields_backward_compatible(tmp_dir: Path) -> None:
    """Default construction keeps the additive suppression fields empty/zero."""
    result = AFDLinter().lint(tmp_dir)
    assert result.suppressed_total == 0
    assert result.suppressed_by_rule == {}
    assert result.suppressed_by_reason == {}
    # LintIssue serialization shape is unchanged.
    _write(tmp_dir, "bad.py", "async def handler(x) -> dict:\n    return {}\n")
    issue = AFDLinter().lint(tmp_dir).issues[0]
    assert set(issue.to_dict()) == {
        "rule",
        "message",
        "file",
        "line",
        "severity",
        "suggestion",
    }


# ─── Per-rule severity overrides ─────────────────────────────────────────────

_GRID = "src/components/grid/grid.ts"
_GRID_SRC = "export function avg(sum: number) {\n  return Math.round(sum);\n}\n"
_FETCH = "src/components/api/client.ts"
_FETCH_SRC = "export async function pull() {\n  return await fetch('https://example.com/x');\n}\n"


def test_severity_override_promotes_warning_to_error(tmp_dir: Path) -> None:
    _write(tmp_dir, _GRID, _GRID_SRC)
    result = AFDLinter(rule_severity_overrides={"afd-no-business-in-ui": "error"}).lint(tmp_dir)
    assert result.error_count == 1
    assert result.warning_count == 0
    assert result.passed is False
    assert result.issues[0].severity is Severity.ERROR
    assert result.issues[0].to_dict()["severity"] == "error"


def test_severity_override_demotes_error_to_warning(tmp_dir: Path) -> None:
    _write(tmp_dir, _FETCH, _FETCH_SRC)
    result = AFDLinter(
        rule_severity_overrides={"afd-no-direct-fetch": Severity.WARNING}
    ).lint(tmp_dir)
    assert result.error_count == 0
    assert result.warning_count == 1
    assert result.passed is True


def test_severity_override_applies_to_rust_handlers(tmp_dir: Path) -> None:
    """Rules emitted from every language path go through the override."""
    _write(tmp_dir, "src/lib.rs", "pub fn handler(x: i32) -> i32 {\n    x\n}\n")
    result = AFDLinter(rule_severity_overrides={"afd-command-result": "warning"}).lint(tmp_dir)
    assert result.error_count == 0
    assert result.warning_count == 1


def test_severity_off_counts_as_suppressed(tmp_dir: Path) -> None:
    _write(tmp_dir, _GRID, _GRID_SRC)
    _write(tmp_dir, _FETCH, _FETCH_SRC)
    result = AFDLinter(rule_severity_overrides={"afd-no-business-in-ui": "off"}).lint(tmp_dir)
    assert result.warning_count == 0
    assert result.error_count == 1  # other rules are unaffected
    assert result.suppressed_summary() == {
        "total": 1,
        "by_rule": {"afd-no-business-in-ui": 1},
        "by_reason": {"severity-off": 1},
    }


def test_severity_off_wins_over_other_suppression_reasons(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/components/widget/widget.stories.ts",
        "export const Default = () => Math.round(1.5);\n",
    )
    result = AFDLinter(rule_severity_overrides={"afd-no-business-in-ui": "off"}).lint(tmp_dir)
    assert result.suppressed_by_reason == {"severity-off": 1}


def test_severity_override_keeps_calibration_suppression(tmp_dir: Path) -> None:
    """A promoted rule is still subject to story/test, path and directive suppression."""
    _write(
        tmp_dir,
        "src/components/widget/widget.stories.ts",
        "export const Default = () => Math.round(1.5);\n",
    )
    result = AFDLinter(rule_severity_overrides={"afd-no-business-in-ui": "error"}).lint(tmp_dir)
    assert result.error_count == 0
    assert result.suppressed_by_reason == {"story-or-test-file": 1}


def test_severity_override_unknown_rule_raises() -> None:
    with pytest.raises(ValueError, match="afd-no-busines-in-ui"):
        AFDLinter(rule_severity_overrides={"afd-no-busines-in-ui": "off"})


@pytest.mark.parametrize("value", ["info", "ERROR", "disabled", Severity.INFO])
def test_severity_override_unsupported_value_raises(value: object) -> None:
    with pytest.raises(ValueError, match="Unsupported severity"):
        AFDLinter(rule_severity_overrides={"afd-no-business-in-ui": value})  # type: ignore[dict-item]


def test_severity_override_default_none_is_backward_compatible(tmp_dir: Path) -> None:
    _write(tmp_dir, _GRID, _GRID_SRC)
    _write(tmp_dir, _FETCH, _FETCH_SRC)
    default = AFDLinter().lint(tmp_dir)
    explicit = AFDLinter(rule_severity_overrides=None).lint(tmp_dir)
    assert (default.error_count, default.warning_count) == (1, 1)
    assert (explicit.error_count, explicit.warning_count) == (1, 1)


# ─── Module-level helper units ───────────────────────────────────────────────


def test_is_story_or_test_file_normalizes_backslashes() -> None:
    assert _is_story_or_test_file("src\\components\\widget\\widget.stories.ts") is True
    assert _is_story_or_test_file("src\\components\\widget\\widget.test.tsx") is True
    assert _is_story_or_test_file("src\\components\\widget\\widget.spec.jsx") is True
    assert _is_story_or_test_file("src\\components\\widget\\widget.ts") is False


def test_is_comment_line_variants() -> None:
    assert _is_comment_line("  // a line comment") is True
    assert _is_comment_line("  * jsdoc continuation") is True
    assert _is_comment_line("/* block open") is True
    assert _is_comment_line("const x = fetch('/x')") is False


def test_is_data_uri_fetch_literal_only() -> None:
    assert _is_data_uri_fetch("await fetch('data:image/png;base64,AA')") is True
    assert _is_data_uri_fetch('await fetch("data:text/plain,hi")') is True
    assert _is_data_uri_fetch("await fetch(dataUrl)") is False
    assert _is_data_uri_fetch("await fetch('https://example.com')") is False


def test_severity_enum_values_stable() -> None:
    assert Severity.ERROR.value == "error"
    assert Severity.WARNING.value == "warning"
