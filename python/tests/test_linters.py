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


def test_ambient_not_flagged_in_python_files(tmp_dir: Path) -> None:
    """TypeScript only for now; other languages follow once they have context fields."""
    _write(
        tmp_dir,
        "commands/todo.py",
        "import time\n"
        "# defineCommand\n"
        "async def handler(input) -> CommandResult[dict]:\n"
        "    return success({'at': time.time()})\n",
    )
    assert _ambient(AFDLinter().lint(tmp_dir)) == []


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
