"""Tests for the skill lint rules (SK001-SK019) and both entry points.

``skill_lint`` lints the workspace's skills directory; ``skill_lint_spec`` lints a path.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.skill._discovery import get_bundled_skills_dir
from botcore.commands.skill.frontmatter import split_frontmatter
from botcore.commands.skill.lint import listing_characters, skill_lint
from botcore.commands.skill_lint import skill_lint_spec

_FIND = "botcore.commands.skill.lint.find_workspace"


def _make_valid_skill(base: Path, name: str) -> Path:
    """Create a valid skill that passes all rules with no warnings."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: A {name} skill.\nmetadata:\n  version: 1.0.0\n"
        f"---\n\n# {name.title()}\n\nBody content.\n",
        encoding="utf-8",
    )
    return skill_dir


def _write_skill(base: Path, dir_name: str, frontmatter: str, body: str = "Body.\n") -> Path:
    skill_dir = base / dir_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(f"---\n{frontmatter}---\n\n{body}", encoding="utf-8")
    return skill_dir


def _setup_workspace(tmp_path: Path, skills_config: str = "") -> Path:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n"
        + (f"\n[tool.botcore.skills]\n{skills_config}\n" if skills_config else ""),
        encoding="utf-8",
    )
    return tmp_path


def _skills_dir(ws: Path) -> Path:
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    return skills_dir


async def _lint(ws: Path, **kwargs) -> dict:
    with patch(_FIND, return_value=ws):
        return assert_success(await skill_lint(**kwargs))


async def _rules(ws: Path, skill: str | None = None) -> list[tuple[str, str]]:
    """(rule, severity) pairs for one skill, or the only skill."""
    data = await _lint(ws)
    entry = next(s for s in data["skills"] if skill is None or s["skill"] == skill)
    return [(v["rule"], v["severity"]) for v in entry["violations"]]


# ── Entry point behaviour ─────────────────────────────────────────────


async def test_lint_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch(_FIND, return_value=None):
        result = await skill_lint()

    assert_error(result, "NO_WORKSPACE")


async def test_lint_no_skills_dir(tmp_path: Path) -> None:
    """Returns error when skills directory doesn't exist."""
    ws = _setup_workspace(tmp_path)

    with patch(_FIND, return_value=ws):
        result = await skill_lint()

    assert_error(result, "NO_SKILLS_DIR")


async def test_lint_valid_skill(tmp_path: Path) -> None:
    """A valid skill with no triggers and ownership under metadata passes cleanly."""
    ws = _setup_workspace(tmp_path)
    _make_valid_skill(_skills_dir(ws), "security")

    data = await _lint(ws)

    assert data["errors"] == 0
    assert data["warnings"] == 0
    assert data["passed"] == 1
    assert data["success"] is True
    assert data["listing"] == {"characters": len("A security skill."), "budget": 8000}


async def test_lint_retired_rules_do_not_fire(tmp_path: Path) -> None:
    """No triggers (old SK006) and no version (old SK013) are not reported."""
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), "bare", "name: bare\ndescription: A bare skill.\n")

    assert await _rules(ws) == []


async def test_lint_sk001_missing_file(tmp_path: Path) -> None:
    """A directory without SKILL.md is not a skill; a path to one reports SK001."""
    ws = _setup_workspace(tmp_path)
    skill_dir = _skills_dir(ws) / "bad-skill"
    skill_dir.mkdir()
    (skill_dir / "README.md").write_text("Not a skill file")

    with patch(_FIND, return_value=ws):
        assert_error(await skill_lint(), "NO_SKILLS")
        data = assert_success(await skill_lint(path="bad-skill"))

    assert [v["rule"] for v in data["skills"][0]["violations"]] == ["SK001"]


async def test_lint_sk001_no_frontmatter(tmp_path: Path) -> None:
    """SK001: SKILL.md without frontmatter triggers error."""
    ws = _setup_workspace(tmp_path)
    skill_dir = _skills_dir(ws) / "bad-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# No frontmatter\n\nJust markdown.")

    assert await _rules(ws) == [("SK001", "error")]


async def test_lint_sk002_missing_name(tmp_path: Path) -> None:
    """SK002: Missing name triggers error."""
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), "no-name", "description: Test.\n")

    assert await _rules(ws) == [("SK002", "error")]


async def test_lint_sk003_missing_description(tmp_path: Path) -> None:
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), "no-desc", "name: no-desc\n")

    assert await _rules(ws) == [("SK003", "error")]


@pytest.mark.parametrize(
    ("dir_name", "name", "count"),
    [
        ("BadName", "BadName", 1),  # not kebab-case
        ("wrong-dir", "correct-name", 1),  # directory mismatch (old SK012)
        ("x" * 65, "x" * 65, 1),  # too long
        ("other", "Bad_Name", 2),  # not kebab-case and mismatched
    ],
)
async def test_lint_sk004_name(tmp_path: Path, dir_name: str, name: str, count: int) -> None:
    """SK004: every name problem is an error."""
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), dir_name, f"name: {name}\ndescription: Test.\n")

    assert await _rules(ws) == [("SK004", "error")] * count


@pytest.mark.parametrize(
    ("length", "expected"),
    [
        (300, []),
        (301, [("SK016", "warning")]),
        (1024, [("SK016", "warning")]),
        (1025, [("SK005", "error")]),
    ],
)
async def test_lint_description_length(
    tmp_path: Path, length: int, expected: list[tuple[str, str]]
) -> None:
    """SK016 warns above 300 characters; SK005 is an error above 1,024."""
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), "desc", f"name: desc\ndescription: {'a' * length}\n")

    assert await _rules(ws) == expected


@pytest.mark.parametrize(
    "frontmatter",
    [
        "name: trig\ndescription: Does things.\ntriggers:\n  - things\n",
        "name: trig\ndescription: 'Does things. Triggers: a, b, c.'\n",
        "name: trig\ndescription: Does things.\nwhen_to_use: 'triggers: a, b'\n",
    ],
)
async def test_lint_sk017_triggers(tmp_path: Path, frontmatter: str) -> None:
    """SK017: a triggers field or a Triggers: list is a warning, not an SK018."""
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), "trig", frontmatter)

    assert await _rules(ws) == [("SK017", "warning")]


async def test_lint_sk018_unsupported_fields(tmp_path: Path) -> None:
    """SK018 accepts open-standard and Claude Code fields and flags the rest."""
    ws = _setup_workspace(tmp_path)
    _write_skill(
        _skills_dir(ws),
        "fields",
        "name: fields\ndescription: Test.\nlicense: MIT\ncompatibility: Python 3.11\n"
        "metadata:\n  source: botcore\nallowed-tools: Read\nwhen_to_use: Testing.\n"
        "argument-hint: '[path]'\ndisable-model-invocation: false\nuser-invocable: true\n"
        "model: sonnet\ncontext: fork\nagent: Explore\nhooks: {}\npaths: ['src/**']\n"
        "category: core\n",
    )

    data = await _lint(ws)

    [violation] = data["skills"][0]["violations"]
    assert violation["rule"] == "SK018"
    assert violation["severity"] == "warning"
    assert "'category'" in violation["message"]


async def test_lint_sk018_top_level_ownership_points_at_metadata(tmp_path: Path) -> None:
    """Top-level source/version/portable say to move them under metadata:, not delete them."""
    ws = _setup_workspace(tmp_path)
    _write_skill(
        _skills_dir(ws),
        "old",
        "name: old\nsource: botcore\ndescription: Test.\nversion: 1.0.0\nportable: true\n",
    )

    data = await _lint(ws)

    violations = data["skills"][0]["violations"]
    assert [v["rule"] for v in violations] == ["SK018"] * 3
    for field, v in zip(("source", "version", "portable"), violations, strict=True):
        assert f"metadata.{field}" in v["message"]
        assert "rather than deleting it" in v["message"]


@pytest.mark.parametrize(("lines", "warns"), [(500, False), (501, True)])
async def test_lint_sk009_body_lines(tmp_path: Path, lines: int, warns: bool) -> None:
    """SK009: a body over 500 lines is a warning."""
    ws = _setup_workspace(tmp_path)
    body = "".join(f"line {i}\n" for i in range(lines))
    _write_skill(_skills_dir(ws), "long", "name: long\ndescription: Test.\n", body)

    assert await _rules(ws) == ([("SK009", "warning")] if warns else [])


@pytest.mark.parametrize(
    ("body", "warns"),
    [
        ("# TODO implement this\n", True),
        ("Decide this later (TBD).\n", True),
        ("FIXME: broken.\n", True),
        ("lorem ipsum dolor sit amet.\n", True),
        ("Run `todo-create` to add a todo.\n", False),
        ("Replace the placeholder value with yours.\n", False),
    ],
)
async def test_lint_sk010_placeholder(tmp_path: Path, body: str, warns: bool) -> None:
    """SK010: upper-case markers and Lorem ipsum warn; ordinary words don't."""
    ws = _setup_workspace(tmp_path)
    _write_skill(_skills_dir(ws), "ph", "name: ph\ndescription: Test.\n", body)

    assert await _rules(ws) == ([("SK010", "warning")] if warns else [])


async def test_lint_sk012_lowercase_filename(tmp_path: Path) -> None:
    """SK012: skill.md instead of SKILL.md is a warning."""
    ws = _setup_workspace(tmp_path)
    skill_dir = _skills_dir(ws) / "lower"
    skill_dir.mkdir()
    (skill_dir / "skill.md").write_text(
        "---\nname: lower\ndescription: Test.\n---\n\nBody.\n", encoding="utf-8"
    )

    assert await _rules(ws) == [("SK012", "warning")]


async def test_lint_sk014_and_sk008_references(tmp_path: Path) -> None:
    """SK014 flags an unlinked reference file; SK008 a linked one that is missing."""
    ws = _setup_workspace(tmp_path)
    skill_dir = _write_skill(
        _skills_dir(ws),
        "refs",
        "name: refs\ndescription: Test.\n",
        "See references/used.md and references/missing.md.\n",
    )
    (skill_dir / "references").mkdir()
    (skill_dir / "references" / "used.md").write_text("Used.")
    (skill_dir / "references" / "unused.md").write_text("Unused.")

    assert await _rules(ws) == [("SK008", "error"), ("SK014", "warning")]


async def test_lint_sk015_duplicate_names(tmp_path: Path) -> None:
    """SK015 is an error on every skill sharing the name (each also fails SK004)."""
    ws = _setup_workspace(tmp_path)
    skills_dir = _skills_dir(ws)
    for dir_name in ("skill-a", "skill-b"):
        _write_skill(skills_dir, dir_name, "name: same-name\ndescription: Test.\n")

    data = await _lint(ws)

    for entry in data["skills"]:
        rules = [v["rule"] for v in entry["violations"]]
        assert rules == ["SK004", "SK015"]
        assert "skill-a, skill-b" in entry["violations"][-1]["message"]


async def test_lint_strict_makes_every_warning_an_error(tmp_path: Path) -> None:
    ws = _setup_workspace(tmp_path)
    skills_dir = _skills_dir(ws)
    _write_skill(skills_dir, "warned", "name: warned\ndescription: Test.\ncategory: x\n")
    _make_valid_skill(skills_dir, "clean")

    lenient = await _lint(ws)
    strict = await _lint(ws, strict=True)

    assert (lenient["errors"], lenient["warnings"], lenient["success"]) == (0, 1, True)
    assert (strict["errors"], strict["warnings"], strict["success"]) == (1, 0, False)
    assert strict["passed"] == 1
    warned = next(s for s in strict["skills"] if s["skill"] == "warned")
    assert warned["violations"] == [{**lenient["skills"][1]["violations"][0], "severity": "error"}]


async def test_lint_single_skill_path(tmp_path: Path) -> None:
    """Lint a single skill by path."""
    ws = _setup_workspace(tmp_path)
    skills_dir = _skills_dir(ws)
    _make_valid_skill(skills_dir, "good")
    _make_valid_skill(skills_dir, "other")

    data = await _lint(ws, path="good")

    assert data["total"] == 1
    assert data["skills"][0]["skill"] == "good"


async def test_lint_absolute_path_outside_skills_dir(tmp_path: Path) -> None:
    """An absolute path lints only that skill and reports it as the linted path."""
    ws = _setup_workspace(tmp_path)
    _make_valid_skill(_skills_dir(ws), "local-only")
    target = _make_valid_skill(ws / "src" / "skills", "bundled")

    data = await _lint(ws, path=str(target))

    assert data["total"] == 1
    assert data["skills"][0]["skill"] == "bundled"
    assert data["path"] == str(target)


async def test_lint_missing_path_reports_resolved_target(tmp_path: Path) -> None:
    """A relative path resolves under the skills dir; the error names that directory."""
    ws = _setup_workspace(tmp_path)
    skills_dir = _skills_dir(ws)

    with patch(_FIND, return_value=ws):
        result = await skill_lint(path="src/skills/bundled")

    assert_error(result, "SKILL_NOT_FOUND")
    assert str(skills_dir / "src" / "skills" / "bundled") in result.error.message
    assert result.error.suggestion


# ── Both entry points ─────────────────────────────────────────────────


def _mixed_skills(skills_dir: Path) -> None:
    _make_valid_skill(skills_dir, "clean")
    _write_skill(skills_dir, "dup-a", "name: dup\ndescription: Test.\n")
    _write_skill(skills_dir, "dup-b", "name: dup\ndescription: Test.\n")
    _write_skill(
        skills_dir,
        "messy",
        f"name: messy\nsource: botcore\ndescription: '{'d' * 400} Triggers: x.'\n"
        "triggers:\n  - x\n",
        "TODO\nSee references/gone.md.\n",
    )
    _write_skill(skills_dir, "Wrong", "name: wrong\ndescription: Test.\n")


async def test_entry_points_report_the_same_violations(tmp_path: Path) -> None:
    """skill_lint and skill_lint_spec run one rule set over the same skills."""
    ws = _setup_workspace(tmp_path, "listing_budget = 300")
    skills_dir = _skills_dir(ws)
    _mixed_skills(skills_dir)

    workspace = await _lint(ws)
    spec = assert_success(await skill_lint_spec(path=str(skills_dir)))

    assert [s["skill"] for s in spec["skills"]] == [s["skill"] for s in workspace["skills"]]
    for by_path, by_workspace in zip(spec["skills"], workspace["skills"], strict=True):
        assert by_path["issues"] == by_workspace["violations"]
    for key in ("total", "passed", "errors", "warnings", "listing", "success"):
        assert spec[key] == workspace[key]
    rules = {v["rule"] for s in workspace["skills"] for v in s["violations"]}
    assert rules == {"SK004", "SK008", "SK010", "SK015", "SK016", "SK017", "SK018", "SK019"}

    # A single skill directory gets the same rules (its own listing is over 300 too)
    single = assert_success(await skill_lint_spec(path=str(skills_dir / "messy")))
    messy = next(s for s in workspace["skills"] if s["skill"] == "messy")
    assert [i["rule"] for i in single["skills"][0]["issues"]] == [
        v["rule"] for v in messy["violations"]
    ]


async def test_spec_lint_uses_default_budget_outside_a_workspace(tmp_path: Path) -> None:
    _make_valid_skill(tmp_path, "solo")

    with patch("botcore.commands.skill_lint.find_workspace", return_value=None):
        data = assert_success(await skill_lint_spec(path=str(tmp_path)))

    assert data["listing"] == {"characters": len("A solo skill."), "budget": 8000}


async def test_spec_lint_reads_the_containing_workspace_budget(tmp_path: Path) -> None:
    ws = _setup_workspace(tmp_path, "listing_budget = 1234")
    target = _make_valid_skill(ws / "nested" / "skills", "deep")

    data = assert_success(await skill_lint_spec(path=str(target)))

    assert data["listing"]["budget"] == 1234


# ── SK019 listing budget ──────────────────────────────────────────────


def _listing(text: str) -> int:
    fm, _ = split_frontmatter(text)
    return listing_characters(text, fm)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("---\nname: x\ndescription: Does a thing.\n---\n\nBody.\n", 13),
        # when_to_use is listed with the description
        (
            "---\nname: x\ndescription: Does a thing.\n"
            "when_to_use: When the user asks for the thing.\n---\n\nBody.\n",
            13 + 33,
        ),
        # user-only skills are not listed; only an unquoted YAML 1.2 true counts
        ("---\nname: x\ndescription: Hidden.\ndisable-model-invocation: true\n---\n", 0),
        ("---\nname: x\ndescription: Hidden.\ndisable-model-invocation: TRUE # c\n---\n", 0),
        ("---\nname: x\ndescription: Listed.\ndisable-model-invocation: yes\n---\n", 7),
        ('---\nname: x\ndescription: Listed.\ndisable-model-invocation: "true"\n---\n', 7),
        ("---\nname: x\ndescription: Listed.\ndisable-model-invocation: false\n---\n", 7),
        # a missing or empty description is listed by the first body paragraph
        (
            "---\nname: x\ndescription:\n---\n\n# Heading\n<!-- generated -->\n\n"
            "First paragraph line one\n  continues here.\n\nSecond paragraph.\n",
            len("First paragraph line one continues here."),
        ),
        ("---\nname: x\ndescription: ''\n---\n\nFallback paragraph.\n", 19),
        ("---\nname: x\n---\n# Title\n\n## Sub\nOnly paragraph.\n", 15),
        ("# Title\n\nPlain paragraph without frontmatter.\n", 36),
        # folded scalars keep YAML's clipped final newline unless they end the block
        ("---\nname: x\ndescription: >\n  Folded text\n  ends here.\n---\n", 22),
        ("---\nname: x\ndescription: >\n  Folded text\n  continues.\nlicense: MIT\n---\n", 23),
        # metadata is not listed
        ("---\nname: x\ndescription: Owned.\nmetadata:\n  source: botcore\n---\n", 6),
    ],
)
def test_listing_characters_match_skill_profiles(text: str, expected: int) -> None:
    """Mirrors listingCharacters in AFD's scripts/skill-profiles.mjs."""
    assert _listing(text) == expected


async def test_lint_sk019_listing_over_budget(tmp_path: Path) -> None:
    """SK019 sums the listing, warns once on the largest skill and names the top three."""
    ws = _setup_workspace(tmp_path, "listing_budget = 100")
    skills_dir = _skills_dir(ws)
    for name, size in (("alpha", 40), ("beta", 30), ("gamma", 20), ("delta", 15)):
        _write_skill(skills_dir, name, f"name: {name}\ndescription: {'x' * size}\n")
    _write_skill(
        skills_dir,
        "hidden",
        f"name: hidden\ndescription: {'y' * 200}\ndisable-model-invocation: true\n",
    )

    data = await _lint(ws)

    assert data["listing"] == {"characters": 105, "budget": 100}
    sk019 = [(s["skill"], v) for s in data["skills"] for v in s["violations"]]
    assert len(sk019) == 1
    skill, violation = sk019[0]
    assert skill == "alpha"
    assert (violation["rule"], violation["severity"]) == ("SK019", "warning")
    assert "105 characters, over the budget of 100" in violation["message"]
    assert "alpha (40), beta (30), gamma (20)" in violation["message"]
    assert "delta" not in violation["message"]
    assert data["warnings"] == 1


async def test_lint_sk019_at_budget_is_silent(tmp_path: Path) -> None:
    ws = _setup_workspace(tmp_path, "listing_budget = 40")
    _write_skill(_skills_dir(ws), "alpha", f"name: alpha\ndescription: {'x' * 40}\n")

    data = await _lint(ws)

    assert data["listing"] == {"characters": 40, "budget": 40}
    assert data["warnings"] == 0


# ── Bundled skills ────────────────────────────────────────────────────


async def test_bundled_skills_lint_without_errors() -> None:
    """Botcore's canonical skills pass every error rule and keep ownership in metadata."""
    data = assert_success(await skill_lint_spec(path=str(get_bundled_skills_dir())))

    assert data["total"] >= 9
    assert data["errors"] == 0, data["skills"]
    issues = [i for s in data["skills"] for i in s["issues"]]
    assert not [i for i in issues if i["rule"] in ("SK017", "SK018")]


# ── Ownership values and robustness ─────────────────────────────────────────


@pytest.mark.parametrize(
    "ownership",
    ["metadata:\n  source: botcore\n  version: 1.0\n", "source: botcore\nversion: 1.0\n"],
)
async def test_numeric_version_keeps_the_owner_and_warns(tmp_path: Path, ownership: str) -> None:
    """An unquoted version is a YAML number: the owner stays readable and lint asks to quote."""
    from botcore.commands.skill.frontmatter import read_skill_manifest

    ws = _setup_workspace(tmp_path)
    skill = _write_skill(_skills_dir(ws), "numeric", f"name: numeric\ndescription: X.\n{ownership}")

    manifest = read_skill_manifest(skill)
    assert (manifest.source, manifest.version) == ("botcore", "1.0")
    data = await _lint(ws)
    messages = [v["message"] for v in data["skills"][0]["violations"] if v["rule"] == "SK018"]
    assert any("YAML number" in m for m in messages)
    assert data["errors"] == 0


async def test_metadata_that_is_not_a_mapping_is_an_error(tmp_path: Path) -> None:
    ws = _setup_workspace(tmp_path)
    _write_skill(
        _skills_dir(ws), "bad-meta", "name: bad-meta\ndescription: X.\nmetadata: botcore\n"
    )

    assert ("SK001", "error") in await _rules(ws)


async def test_path_lint_survives_an_invalid_workspace_config(tmp_path: Path) -> None:
    """A broken [tool.botcore] keeps the default budget and is reported, not raised."""
    ws = _setup_workspace(tmp_path, "listing_budget = -1")
    _make_valid_skill(_skills_dir(ws), "ok")

    data = assert_success(await skill_lint_spec(str(_skills_dir(ws))))

    assert data["listing"]["budget"] == 8000
    assert "ValidationError" in data["listing"]["config_error"]
    assert data["errors"] == 0


async def test_mirrored_copy_is_listed_once(tmp_path: Path) -> None:
    """Two directories holding the same skill name add its listing once."""
    root = tmp_path / "tree"
    for base in ("a", "b"):
        _write_skill(root / base, "same", "name: same\ndescription: Twelve chars\n")

    data = assert_success(await skill_lint_spec(str(root)))

    assert data["listing"]["characters"] == len("Twelve chars")
