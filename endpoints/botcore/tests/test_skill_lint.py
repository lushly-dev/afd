"""Tests for botcore.commands.skill.lint — skill quality rules SK001-SK015."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.skill.lint import skill_lint


def _make_valid_skill(base: Path, name: str) -> Path:
    """Create a valid skill that passes all rules."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: A {name} skill.\nversion: '1.0.0'\n"
        f"triggers:\n  - {name}\n---\n\n# {name.title()}\n\nBody content.\n",
        encoding="utf-8",
    )
    return skill_dir


def _setup_workspace(tmp_path: Path) -> Path:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n",
        encoding="utf-8",
    )
    return tmp_path


async def test_lint_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.skill.lint.find_workspace", return_value=None):
        result = await skill_lint()

    assert_error(result, "NO_WORKSPACE")


async def test_lint_no_skills_dir(tmp_path: Path) -> None:
    """Returns error when skills directory doesn't exist."""
    ws = _setup_workspace(tmp_path)

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    assert_error(result, "NO_SKILLS_DIR")


async def test_lint_valid_skill(tmp_path: Path) -> None:
    """Valid skill passes all rules."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_valid_skill(skills_dir, "security")

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    assert data["errors"] == 0
    assert data["passed"] == 1


async def test_lint_sk001_missing_file(tmp_path: Path) -> None:
    """SK001: Missing SKILL.md triggers error."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "bad-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "README.md").write_text("Not a skill file")

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    # bad-skill is skipped by discover_local_skills since it has no SKILL.md
    assert_error(result, "NO_SKILLS")


async def test_lint_sk001_no_frontmatter(tmp_path: Path) -> None:
    """SK001: SKILL.md without frontmatter triggers error."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "bad-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("# No frontmatter\n\nJust markdown.")

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    assert any(v["rule"] == "SK001" for v in violations)


async def test_lint_sk002_missing_name(tmp_path: Path) -> None:
    """SK002: Missing name triggers error."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "no-name"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\ndescription: Test.\nversion: '1.0.0'\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    assert any(v["rule"] == "SK002" for v in violations)


async def test_lint_sk004_kebab_case(tmp_path: Path) -> None:
    """SK004: Non-kebab-case name triggers error."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "BadName"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: BadName\ndescription: Test.\nversion: '1.0.0'\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    assert any(v["rule"] == "SK004" for v in violations)


async def test_lint_sk006_no_triggers(tmp_path: Path) -> None:
    """SK006: Missing triggers is a warning."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "no-triggers"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: no-triggers\ndescription: Test.\nversion: '1.0.0'\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    trigger_v = next(v for v in violations if v["rule"] == "SK006")
    assert trigger_v["severity"] == "warning"


async def test_lint_sk010_placeholder(tmp_path: Path) -> None:
    """SK010: Placeholder text in body is a warning."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "placeholder"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: placeholder\ndescription: Test."
        "\nversion: '1.0.0'\ntriggers:\n  - test\n---\n\n# TODO implement this\n",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    assert any(v["rule"] == "SK010" for v in violations)


async def test_lint_sk012_dir_name_mismatch(tmp_path: Path) -> None:
    """SK012: Directory name doesn't match skill name."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "wrong-dir"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: correct-name\ndescription: Test."
        "\nversion: '1.0.0'\ntriggers:\n  - test\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    assert any(v["rule"] == "SK012" for v in violations)


async def test_lint_sk013_no_version(tmp_path: Path) -> None:
    """SK013: Default version (0.0.0) is a warning."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skill_dir = skills_dir / "no-version"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: no-version\ndescription: Test.\ntriggers:\n  - test\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    data = assert_success(result)
    violations = data["skills"][0]["violations"]
    assert any(v["rule"] == "SK013" for v in violations)


async def test_lint_single_skill_path(tmp_path: Path) -> None:
    """Lint a single skill by path."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_valid_skill(skills_dir, "good")
    _make_valid_skill(skills_dir, "other")

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint(path="good")

    data = assert_success(result)
    assert data["total"] == 1
    assert data["skills"][0]["skill"] == "good"


async def test_lint_absolute_path_outside_skills_dir(tmp_path: Path) -> None:
    """An absolute path lints only that skill and reports it as the linted path."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_valid_skill(skills_dir, "local-only")
    bundled = ws / "src" / "skills"
    target = _make_valid_skill(bundled, "bundled")

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint(path=str(target))

    data = assert_success(result)
    assert data["total"] == 1
    assert data["skills"][0]["skill"] == "bundled"
    assert data["path"] == str(target)


async def test_lint_missing_path_reports_resolved_target(tmp_path: Path) -> None:
    """A relative path resolves under the skills dir; the error names that directory."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint(path="src/skills/bundled")

    assert_error(result, "SKILL_NOT_FOUND")
    assert str(skills_dir / "src" / "skills" / "bundled") in result.error.message
    assert result.error.suggestion
