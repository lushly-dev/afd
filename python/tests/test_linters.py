"""Tests for AFDLinter — including per-rule calibration and suppression.

Covers the pre-existing rule behavior plus the configurable calibration surface:
story/test exclusion, per-rule path excludes, direct-fetch comment/data-URI
awareness, and the inline ``afd-lint-disable`` directive. Every suppression is
asserted against the transparent LintResult bookkeeping.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from afd.lushx_ext.ambient import cpp_ambient_calls, mask_c_like
from afd.lushx_ext.linters import (
    AFDLinter,
    Severity,
    _is_comment_line,
    _is_data_uri_fetch,
    _is_story_or_test_file,
    _mask_ts_source,
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


@pytest.mark.parametrize("overrides", [["afd-no-business-in-ui"], {"afd-no-business-in-ui": []}])
def test_severity_override_malformed_input_raises(overrides: object) -> None:
    with pytest.raises(ValueError):
        AFDLinter(rule_severity_overrides=overrides)  # type: ignore[arg-type]


def test_severity_override_default_none_is_backward_compatible(tmp_dir: Path) -> None:
    _write(tmp_dir, _GRID, _GRID_SRC)
    _write(tmp_dir, _FETCH, _FETCH_SRC)
    default = AFDLinter().lint(tmp_dir)
    explicit = AFDLinter(rule_severity_overrides=None).lint(tmp_dir)
    assert (default.error_count, default.warning_count) == (1, 1)
    assert (explicit.error_count, explicit.warning_count) == (1, 1)


# ─── Ambient time and randomness in command handlers ─────────────────────────

_CMD = "src/commands/todo.ts"
_AMBIENT_RULES = {"afd-no-ambient-time", "afd-no-ambient-random"}


def _ambient(result) -> list[tuple[int, str, str]]:
    return sorted(
        (i.line, i.rule, i.message) for i in result.issues if i.rule in _AMBIENT_RULES
    )


def test_ambient_calls_in_handler_flagged_as_warnings(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "export const create = defineCommand({\n"
        "  name: 'todo-create',\n"
        "  async handler(input, context) {\n"
        "    const at = Date.now();\n"
        "    const now = new Date();\n"
        "    const t0 = performance.now();\n"
        "    const roll = Math.random();\n"
        "    const id = crypto.randomUUID();\n"
        "    return success({ at, now, t0, roll, id });\n"
        "  },\n"
        "});\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert _ambient(result) == [
        (4, "afd-no-ambient-time", "Ambient Date.now() in command handler"),
        (5, "afd-no-ambient-time", "Ambient new Date() in command handler"),
        (6, "afd-no-ambient-time", "Ambient performance.now() in command handler"),
        (7, "afd-no-ambient-random", "Ambient Math.random() in command handler"),
        (8, "afd-no-ambient-random", "Ambient crypto.randomUUID() in command handler"),
    ]
    assert result.warning_count == 5
    assert result.error_count == 0
    time_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-time")
    random_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-random")
    assert "context.clock" in (time_issue.suggestion or "")
    assert "context.random" in (random_issue.suggestion or "")


@pytest.mark.parametrize(
    "handler",
    [
        "handler: async () => success({ at: Date.now() }),",
        "handler: async function (input) { return success({ at: Date.now() }); },",
        "handler<T>(input: T) { return success({ at: Date.now() }); },",
    ],
)
def test_ambient_flagged_in_every_handler_form(tmp_dir: Path, handler: str) -> None:
    _write(
        tmp_dir,
        _CMD,
        "export const c = defineCommand<In, Out>({\n"
        "  name: 'todo-get',\n"
        f"  {handler}\n"
        "  mutation: false,\n"
        "});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (3, "afd-no-ambient-time", "Ambient Date.now() in command handler"),
    ]


def test_ambient_outside_handlers_not_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "import { defineCommand } from '@lushly-dev/afd-server';\n"
        "const startedAt = Date.now();\n"
        "function makeId() { return crypto.randomUUID(); }\n"
        "export const c = defineCommand({\n"
        "  name: 'todo-create',\n"
        "  input: z.object({ due: z.string().default(() => new Date().toISOString()) }),\n"
        "  handler: runCreate,\n"
        "});\n"
        "function runCreate() { return success({ r: Math.random() }); }\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


def test_ambient_not_flagged_without_define_command(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/util/time.ts",
        "export const handler = { handler: () => Date.now() };\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


def test_ambient_deterministic_forms_not_flagged(tmp_dir: Path) -> None:
    """`new Date(x)` converts a value; strings and comments are not calls."""
    _write(
        tmp_dir,
        _CMD,
        "export const c = defineCommand({\n"
        "  name: 'todo-get',\n"
        "  async handler(input, context) {\n"
        "    // Date.now() would be ambient here\n"
        "    /* Math.random() too */\n"
        "    const due = new Date(input.due);\n"
        "    const at = new Date ( context.clock.now() );\n"
        "    const label = 'Date.now()' + \"Math.random()\";\n"
        "    const name = new DateFormatter();\n"
        "    const now = (context.clock ?? systemClock).now();\n"
        "    return success({ due, at, label, name, now });\n"
        "  },\n"
        "});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


def test_ambient_in_template_interpolation_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "export const c = defineCommand({\n"
        "  name: 'todo-get',\n"
        "  description: `Date.now() in prose ${'is fine'}`,\n"
        "  handler: async () => success({ id: `todo-${Math.random()}` }),\n"
        "});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (4, "afd-no-ambient-random", "Ambient Math.random() in command handler"),
    ]


def test_ambient_argumentless_new_date_without_parens_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "export const c = defineCommand({\n"
        "  name: 'todo-get',\n"
        "  handler: async () => success({ at: new Date }),\n"
        "});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (3, "afd-no-ambient-time", "Ambient new Date() in command handler"),
    ]


def test_ambient_only_in_handler_of_each_command(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "export const a = defineCommand({\n"
        "  name: 'todo-a',\n"
        "  handler: async () => success(Date.now()),\n"
        "});\n"
        "const between = Math.random();\n"
        "export const b = defineCommand({\n"
        "  name: 'todo-b',\n"
        "  handler: async () => success(Math.random()),\n"
        "});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (3, "afd-no-ambient-time", "Ambient Date.now() in command handler"),
        (8, "afd-no-ambient-random", "Ambient Math.random() in command handler"),
    ]


_AMBIENT_SRC = (
    "export const c = defineCommand({\n"
    "  name: 'todo-get',\n"
    "  async handler() {\n"
    "    // afd-lint-disable: timestamp is display-only\n"
    "    const shown = Date.now();\n"
    "    return success({ shown, at: Date.now(), r: Math.random() });\n"
    "  },\n"
    "});\n"
)


def test_ambient_directive_suppresses(tmp_dir: Path) -> None:
    _write(tmp_dir, _CMD, _AMBIENT_SRC)
    result = AFDLinter().lint(tmp_dir)
    assert [i.line for i in result.issues if i.rule == "afd-no-ambient-time"] == [6]
    assert result.suppressed_by_rule == {"afd-no-ambient-time": 1}
    assert result.suppressed_by_reason == {"inline-directive": 1}


def test_ambient_severity_overrides(tmp_dir: Path) -> None:
    _write(tmp_dir, _CMD, _AMBIENT_SRC)
    result = AFDLinter(
        rule_severity_overrides={"afd-no-ambient-time": "error", "afd-no-ambient-random": "off"}
    ).lint(tmp_dir)
    assert result.error_count == 1
    assert result.warning_count == 0
    assert result.passed is False
    assert result.suppressed_by_rule == {"afd-no-ambient-time": 1, "afd-no-ambient-random": 1}


def test_ambient_rule_path_exclude(tmp_dir: Path) -> None:
    _write(tmp_dir, _CMD, _AMBIENT_SRC)
    result = AFDLinter(rule_path_excludes={"afd-no-ambient-random": ["src/commands/"]}).lint(
        tmp_dir
    )
    assert {i.rule for i in result.issues} == {"afd-no-ambient-time"}
    assert result.suppressed_by_reason == {"inline-directive": 1, "rule-path-exclude": 1}


# ─── Ambient time and randomness: Python, Rust and C++ handlers ─────────────

_PY_CMD = "commands/todo.py"


def test_ambient_python_decorated_handler_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _PY_CMD,
        "import random\n"
        "import time\n"
        "import uuid\n"
        "from datetime import date, datetime\n"
        "\n"
        "@server.command(name='todo-create', description='Create a todo')\n"
        "async def create(input, context):\n"
        "    at = time.time()\n"
        "    now = datetime.now()\n"
        "    day = date.today()\n"
        "    roll = random.random()\n"
        "    todo_id = uuid.uuid4()\n"
        "    return success({'at': at})\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert _ambient(result) == [
        (8, "afd-no-ambient-time", "Ambient time.time() in command handler"),
        (9, "afd-no-ambient-time", "Ambient datetime.now() in command handler"),
        (10, "afd-no-ambient-time", "Ambient date.today() in command handler"),
        (11, "afd-no-ambient-random", "Ambient random.random() in command handler"),
        (12, "afd-no-ambient-random", "Ambient uuid.uuid4() in command handler"),
    ]
    assert result.warning_count == 5
    time_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-time")
    random_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-random")
    assert "context.clock.now()" in (time_issue.suggestion or "")
    assert "context.random.next()" in (random_issue.suggestion or "")


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        # define_command, aliased import
        (
            "import time as t\n@define_command(name='x-get', description='d')\n"
            "async def get(input):\n    return t.monotonic()\n",
            (4, "afd-no-ambient-time", "Ambient t.monotonic() in command handler"),
        ),
        # registry.command with positional name and description
        (
            "import time\n@registry.command('x-get', 'd')\n"
            "def get(input):\n    return time.perf_counter()\n",
            (4, "afd-no-ambient-time", "Ambient time.perf_counter() in command handler"),
        ),
        # CommandDefinition handler defined in the same file
        (
            "from time import time\ndef run(input, context):\n    return time()\n"
            "CMD = CommandDefinition(name='x-get', description='d', handler=run)\n",
            (3, "afd-no-ambient-time", "Ambient time() in command handler"),
        ),
        # CommandDefinition with a lambda handler
        (
            "import secrets\nCMD = CommandDefinition(name='x-get', description='d',\n"
            "    handler=lambda i, c: secrets.token_hex())\n",
            (3, "afd-no-ambient-random", "Ambient secrets.token_hex() in command handler"),
        ),
    ],
)
def test_ambient_python_handler_forms_flagged(
    tmp_dir: Path, source: str, expected: tuple[int, str, str]
) -> None:
    _write(tmp_dir, _PY_CMD, source)
    assert _ambient(AFDLinter().lint(tmp_dir)) == [expected]


def test_ambient_python_negatives_not_flagged(tmp_dir: Path) -> None:
    """Outside handlers, click commands, seeded generators and context sources."""
    _write(
        tmp_dir,
        _PY_CMD,
        "import random\n"
        "import time\n"
        "from datetime import datetime\n"
        "STARTED = time.time()\n"
        "\n"
        "def helper():\n"
        "    return random.random()\n"
        "\n"
        "@cli.command()\n"
        "def cli_main():\n"
        "    return time.time()\n"
        "\n"
        "@server.command(name='todo-get', description='Get', examples=[time.time()])\n"
        "async def get(input, context, random=None):\n"
        "    # time.time() in a comment\n"
        "    label = 'datetime.now()'\n"
        "    seeded = random.Random(42) if random else None\n"
        "    gen = __import__('random').Random(7)\n"
        "    at = datetime.fromtimestamp(input.ts)\n"
        "    now = context.clock.now()\n"
        "    roll = context.random.next()\n"
        "    return success({'now': now})\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


def test_ambient_python_review_cases(tmp_dir: Path) -> None:
    """Shadowing parameters, deterministic secrets, method and nested handlers."""
    _write(
        tmp_dir,
        _PY_CMD,
        "import secrets\n"
        "import time\n"
        "@registry.command('a-get', description='d')\n"
        "def shadowed(i, time):\n"
        "    return secrets.compare_digest(i.a, i.b) and time.time()\n"
        "@server.command(name='a-list', description='d')\n"
        "async def nested(i):\n"
        "    def stamp():\n"
        "        return time.time()\n"
        "    return stamp()\n"
        "class Commands:\n"
        "    def create(self, i, context):\n"
        "        return secrets.token_hex(8)\n"
        "    def defs(self):\n"
        "        return [CommandDefinition(name='a-create', description='d', handler=self.create)]\n"
        "class Unrelated:\n"
        "    def create(self):\n"
        "        return time.time()\n"
        "    def other(self, h):\n"
        "        return CommandDefinition(name='a-x', description='d', handler=h.create)\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (9, "afd-no-ambient-time", "Ambient time.time() in command handler"),
        (13, "afd-no-ambient-random", "Ambient secrets.token_hex() in command handler"),
    ]


def test_ambient_python_seeded_random_class_not_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _PY_CMD,
        "import random\n"
        "@server.command(name='todo-get', description='Get')\n"
        "async def get(input):\n"
        "    seeded = random.Random(input.seed)\n"
        "    unseeded = random.Random()\n"
        "    return success({})\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (5, "afd-no-ambient-random", "Ambient random.Random() in command handler"),
    ]


def test_ambient_python_syntax_error_is_skipped(tmp_dir: Path) -> None:
    _write(tmp_dir, _PY_CMD, "import time\n@server.command(name='x', description='d'\ndef broken(:\n")
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


_RS_CMD = "src/commands.rs"


def test_ambient_rust_handler_impl_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _RS_CMD,
        "use std::time::{Instant, SystemTime};\n"
        "struct Create;\n"
        "#[async_trait]\n"
        "impl CommandHandler for Create {\n"
        "    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {\n"
        "        let t = SystemTime::now();\n"
        "        let started = Instant::now();\n"
        "        let at = chrono::Utc::now();\n"
        "        let id = Uuid::new_v4();\n"
        "        let roll: f64 = rand::random();\n"
        "        let mut rng = rand::thread_rng();\n"
        "        success(json!({}))\n"
        "    }\n"
        "}\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert _ambient(result) == [
        (6, "afd-no-ambient-time", "Ambient SystemTime::now() in command handler"),
        (7, "afd-no-ambient-time", "Ambient Instant::now() in command handler"),
        (8, "afd-no-ambient-time", "Ambient Utc::now() in command handler"),
        (9, "afd-no-ambient-random", "Ambient Uuid::new_v4() in command handler"),
        (10, "afd-no-ambient-random", "Ambient rand::random() in command handler"),
        (11, "afd-no-ambient-random", "Ambient thread_rng() in command handler"),
    ]
    time_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-time")
    random_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-random")
    assert "context.clock().now()" in (time_issue.suggestion or "")
    assert "context.random().next()" in (random_issue.suggestion or "")


def test_ambient_rust_free_fn_and_closure_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _RS_CMD,
        "fn stamp<T: Into<String>>(name: T, context: &CommandContext) -> Result<u64, String> {\n"
        "    Ok(SystemTime::now().elapsed().unwrap().as_secs())\n"
        "}\n"
        "let handler = |input: Value, context: CommandContext| async move { Uuid::new_v4() };\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (2, "afd-no-ambient-time", "Ambient SystemTime::now() in command handler"),
        (4, "afd-no-ambient-random", "Ambient Uuid::new_v4() in command handler"),
    ]


def test_ambient_rust_negatives_not_flagged(tmp_dir: Path) -> None:
    """No context, other impls, middleware, declarations, strings and comments."""
    _write(
        tmp_dir,
        _RS_CMD,
        "fn helper() -> u64 { SystemTime::now(); 0 }\n"
        "impl CommandRegistry {\n"
        "    pub async fn execute_batch(&self, context: CommandContext) -> BatchResult {\n"
        "        let started = Instant::now();\n"
        "    }\n"
        "}\n"
        "trait Handler { fn execute(&self, c: CommandContext) -> CommandResult<Value>; }\n"
        "fn run(this: X) { let x = Instant::now(); }\n"
        "let mw = |n: String, ctx: CommandContext, next: MiddlewareNext| { Instant::now(); next() };\n"
        "impl CommandHandler for Get {\n"
        "    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {\n"
        "        let s = \"SystemTime::now()\"; // Instant::now()\n"
        "        let raw = r#\"Uuid::new_v4() \" still raw\"#;\n"
        "        /* outer /* nested */ rand::random() */\n"
        "        let c = '\"'; let l: &'static str = \"x\";\n"
        "        let now = context.clock().now();\n"
        "        let roll = context.random().next();\n"
        "        success(json!({ \"now\": now }))\n"
        "    }\n"
        "}\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


_CPP_CMD = "src/commands.cpp"


def test_ambient_cpp_handler_lambda_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CPP_CMD,
        "auto create = command(\"todo-create\", \"Create\", {\"todo\"}, true,\n"
        "    [store](const Json& input, CommandContext& context) -> afd::CommandResult {\n"
        "        auto now = std::chrono::system_clock::now();\n"
        "        auto t0 = std::chrono::steady_clock::now();\n"
        "        std::time_t at = std::time(nullptr);\n"
        "        int roll = std::rand();\n"
        "        std::random_device device;\n"
        "        return afd::success(input);\n"
        "    });\n",
    )
    result = AFDLinter().lint(tmp_dir)
    assert _ambient(result) == [
        (3, "afd-no-ambient-time", "Ambient system_clock::now() in command handler"),
        (4, "afd-no-ambient-time", "Ambient steady_clock::now() in command handler"),
        (5, "afd-no-ambient-time", "Ambient std::time() in command handler"),
        (6, "afd-no-ambient-random", "Ambient std::rand() in command handler"),
        (7, "afd-no-ambient-random", "Ambient std::random_device in command handler"),
    ]
    time_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-time")
    random_issue = next(i for i in result.issues if i.rule == "afd-no-ambient-random")
    assert "context.clock->wall_ms()" in (time_issue.suggestion or "")
    assert "context.random->next()" in (random_issue.suggestion or "")


def test_ambient_cpp_function_and_designated_initializer_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        "src/commands.hpp",
        "inline afd::CommandResult get(const afd::Json& input, afd::CommandContext&) noexcept {\n"
        "    return afd::success(time(nullptr));\n"
        "}\n"
        "afd::CommandDefinition def{.name = \"x-get\",\n"
        "    .handler = [](const afd::Json& input, afd::CommandContext&) {\n"
        "        return afd::success(rand());\n"
        "    }};\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (2, "afd-no-ambient-time", "Ambient std::time() in command handler"),
        (6, "afd-no-ambient-random", "Ambient std::rand() in command handler"),
    ]


def test_ambient_cpp_functor_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CPP_CMD,
        "struct Create {\n"
        "    afd::CommandResult operator()(const afd::Json& in, afd::CommandContext& ctx) const {\n"
        "        return afd::success(rand());\n"
        "    }\n"
        "};\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (3, "afd-no-ambient-random", "Ambient std::rand() in command handler"),
    ]


def test_ambient_cpp_many_context_mentions_stay_linear() -> None:
    import time as clock

    source = "void f(" + "CommandContext&, " * 20000 + "int x) { std::rand(); }\n"
    source += "int a = ((((((" + "CommandContext " * 20000 + ";\n"
    started = clock.perf_counter()
    assert cpp_ambient_calls(source) == [(1, "random", "std::rand()")]
    assert clock.perf_counter() - started < 5


def test_ambient_cpp_negatives_not_flagged(tmp_dir: Path) -> None:
    """Outside handlers, middleware, declarations, aliases, strings and comments."""
    _write(
        tmp_dir,
        _CPP_CMD,
        "auto t0 = std::chrono::steady_clock::now();\n"
        "using CommandHandler = std::function<CommandResult(const Json&, CommandContext&)>;\n"
        "CommandResult run(const Json&, CommandContext&);\n"
        "auto mw = [](std::string_view n, const Json& i, CommandContext& c, const Next& next) {\n"
        "    auto t = std::chrono::steady_clock::now(); return next();\n"
        "};\n"
        "void f() { if (run(CommandContext{})) { std::rand(); } }\n"
        "auto h = [](const Json& input, CommandContext& context) {\n"
        "    const char* s = \"std::rand()\"; // std::time(nullptr)\n"
        "    const char* raw = R\"x(std::random_device \" still raw)x\";\n"
        "    int big = 1'000'000; char q = '\"';\n"
        "    auto at = context.clock->wall_ms();\n"
        "    double roll = context.random->next();\n"
        "    return afd::success(store.rand());\n"
        "};\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


@pytest.mark.parametrize(
    ("rel", "source"),
    [
        (_PY_CMD, "import time\n@server.command(name='x', description='d')\nasync def h(i):\n"
         "    # afd-lint-disable: display-only timestamp\n    return time.time()\n"),
        (_RS_CMD, "fn h(c: CommandContext) {\n    // afd-lint-disable: display-only timestamp\n"
         "    SystemTime::now();\n}\n"),
        (_CPP_CMD, "auto h = [](const Json& i, CommandContext& c) {\n"
         "    // afd-lint-disable: display-only timestamp\n    std::time(nullptr);\n};\n"),
    ],
)
def test_ambient_other_languages_take_directives_and_overrides(
    tmp_dir: Path, rel: str, source: str
) -> None:
    _write(tmp_dir, rel, source)
    result = AFDLinter().lint(tmp_dir)
    assert result.issues == []
    assert result.suppressed_by_reason == {"inline-directive": 1}
    _write(tmp_dir, rel, source.replace("afd-lint-disable", "note"))
    gated = AFDLinter(rule_severity_overrides={"afd-no-ambient-time": "error"}).lint(tmp_dir)
    assert gated.error_count == 1 and gated.passed is False
    excluded = AFDLinter(rule_path_excludes={"afd-no-ambient-time": [rel]}).lint(tmp_dir)
    assert excluded.issues == []
    assert excluded.suppressed_by_reason == {"rule-path-exclude": 1}


def test_mask_c_like_keeps_offsets() -> None:
    src = 'a("x//y") // c\nr#"q"# /* b\n*/ \'x\' h'
    masked = mask_c_like(src, rust=True)
    assert len(masked) == len(src)
    assert [i for i, ch in enumerate(src) if ch == "\n"] == [
        i for i, ch in enumerate(masked) if ch == "\n"
    ]
    assert "x//y" not in masked and "// c" not in masked and "q" not in masked
    assert masked.endswith(" h") and masked.startswith("a(")


@pytest.mark.parametrize(
    "handler",
    [
        "async handler(i): Promise<Record<string, X>> {\n    return Date.now();\n  },",
        "handler: async (i): Promise<Result<A, B>> => {\n    return Date.now();\n  },",
        "handler: async <T, U>(i: T) => {\n    return Date.now();\n  },",
    ],
)
def test_ambient_flagged_past_commas_in_type_arguments(tmp_dir: Path, handler: str) -> None:
    _write(
        tmp_dir,
        _CMD,
        f"export const c = defineCommand({{\n  name: 'todo-get',\n  {handler}\n}});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (4, "afd-no-ambient-time", "Ambient Date.now() in command handler"),
    ]


def test_ambient_regex_literals_do_not_desync_scope(tmp_dir: Path) -> None:
    """Quotes, `//` and backticks inside regex literals are not strings or comments."""
    _write(
        tmp_dir,
        _CMD,
        "export const c = defineCommand({\n"
        "  handler: async (i) => {\n"
        "    const a = i.s.replace(/'/g, '').replace(/\"/g, '').replace(/`/g, '');\n"
        "    if (/^https?:\\/\\//.test(i.url)) { return Date.now(); }\n"
        "    return i.n / 2 / 3;\n"
        "  },\n"
        "  name: 'todo-get',\n"
        "});\n"
        "const startedAt = Date.now();\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (4, "afd-no-ambient-time", "Ambient Date.now() in command handler"),
    ]


def test_ambient_comparison_in_expression_body_keeps_sibling_scope(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "export const c = defineCommand({\n"
        "  handler: async (i) => i.n<3 && i.m>1,\n"
        "  input: z.object({ at: z.number().default(() => Date.now()) }),\n"
        "});\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


def test_mask_ts_source_keeps_offsets_and_template_code() -> None:
    src = "a('x//y') // c\n`t ${f(`u ${g()}`)} v` /* b\n*/ h"
    masked = _mask_ts_source(src)
    assert len(masked) == len(src)
    assert [i for i, ch in enumerate(src) if ch == "\n"] == [
        i for i, ch in enumerate(masked) if ch == "\n"
    ]
    assert "x//y" not in masked and "// c" not in masked and "/* b" not in masked
    assert "f(" in masked and "g()" in masked and masked.endswith(" h")
    assert "t " not in masked and " v" not in masked


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


def _crypto_cmd(imports: str, body: str) -> str:
    return (
        f"{imports}\n"
        "export const c = defineCommand({\n"
        "  name: 'todo-create',\n"
        "  async handler(input, context) {\n"
        f"    {body}\n"
        "    return success({});\n"
        "  },\n"
        "});\n"
    )


@pytest.mark.parametrize("module", ["node:crypto", "crypto"])
@pytest.mark.parametrize(
    ("imports", "body", "name"),
    [
        ("import { randomUUID } from '%s';", "const id = randomUUID();", "randomUUID()"),
        ("import { randomBytes } from '%s';", "const b = randomBytes(8);", "randomBytes()"),
        ("import { randomInt } from '%s';", "const n = randomInt(10);", "randomInt()"),
        ("import { randomUUID as uuid } from '%s';", "const id = uuid();", "randomUUID()"),
        (
            "import { createHash, type X, randomInt\n  as roll } from \"%s\";",
            "const n = roll(5);",
            "randomInt()",
        ),
        ("import * as c from '%s';", "const id = c.randomUUID();", "c.randomUUID()"),
        ("import nc from '%s';", "const b = nc . randomBytes(4);", "nc.randomBytes()"),
    ],
)
def test_ambient_random_from_crypto_import_flagged(
    tmp_dir: Path, module: str, imports: str, body: str, name: str
) -> None:
    _write(tmp_dir, _CMD, _crypto_cmd(imports % module, body))
    issues = _ambient(AFDLinter().lint(tmp_dir))
    assert [(rule, msg) for _, rule, msg in issues] == [
        ("afd-no-ambient-random", f"Ambient {name} in command handler")
    ]


def test_crypto_random_import_outside_handler_not_flagged(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        "import { randomUUID } from 'node:crypto';\n"
        "const boot = randomUUID();\n"
        "export const c = defineCommand({\n"
        "  name: 'todo-create',\n"
        "  handler: run,\n"
        "});\n"
        "function run() { return success({ id: randomUUID() }); }\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


@pytest.mark.parametrize(
    ("imports", "body"),
    [
        # Same name, but not imported from crypto.
        ("function randomUUID() { return 'x'; }", "const id = randomUUID();"),
        ("import { randomUUID } from './ids';", "const id = randomUUID();"),
        ("import { randomUUID } from 'uuid';", "const id = randomUUID();"),
        # Imported from crypto, but a different export or a member call.
        ("import { createHash } from 'node:crypto';", "const h = createHash('sha1');"),
        ("import { randomUUID } from 'node:crypto';", "const id = ids.randomUUID();"),
        ("import { randomUUID as uuid } from 'node:crypto';", "const id = randomUUID();"),
        ("import * as c from 'node:crypto';", "const h = c.createHash('sha1');"),
        ("import * as c from './ids';", "const id = c.randomUUID();"),
        # Commented-out or quoted import.
        ("// import { randomUUID } from 'node:crypto';", "const id = randomUUID();"),
        ("const s = \"import { randomUUID } from 'node:crypto'\";", "const id = randomUUID();"),
        # Type-only imports bring no runtime value.
        ("import type { randomUUID } from 'node:crypto';", "const id = randomUUID();"),
        ("import { type randomUUID } from 'node:crypto';", "const id = randomUUID();"),
    ],
)
def test_crypto_random_lookalikes_not_flagged(tmp_dir: Path, imports: str, body: str) -> None:
    _write(tmp_dir, _CMD, _crypto_cmd(imports, body))
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


def test_crypto_namespace_named_crypto_flagged_once(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        _crypto_cmd("import * as crypto from 'node:crypto';", "const id = crypto.randomUUID();"),
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == [
        (5, "afd-no-ambient-random", "Ambient crypto.randomUUID() in command handler"),
    ]


def test_crypto_name_imported_from_both_specifiers_reported_once(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        _crypto_cmd(
            "import { randomUUID } from 'crypto';\nimport { randomUUID } from 'node:crypto';",
            "const id = randomUUID();",
        ),
    )
    assert len(_ambient(AFDLinter().lint(tmp_dir))) == 1


def test_crypto_default_and_named_import_together(tmp_dir: Path) -> None:
    _write(
        tmp_dir,
        _CMD,
        _crypto_cmd("import nc, { randomInt } from 'node:crypto';", "const n = randomInt(3) + nc.randomInt(3);"),
    )
    assert [m for _, _, m in _ambient(AFDLinter().lint(tmp_dir))] == [
        "Ambient nc.randomInt() in command handler",
        "Ambient randomInt() in command handler",
    ]


def test_crypto_import_scan_is_linear_on_long_whitespace(tmp_dir: Path) -> None:
    import time

    _write(tmp_dir, _CMD, _crypto_cmd("import a" + " " * 20000 + "\n", "const x = 1;"))
    start = time.perf_counter()
    AFDLinter().lint(tmp_dir)
    assert time.perf_counter() - start < 2
