"""Tests for botcore.commands.docs — frontmatter, anchors, agents, changelog."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.docs import (
    _extract_frontmatter,
    _has_frontmatter,
    _split_anchor,
    docs_check_agents,
    docs_check_changelog,
    docs_lint,
)

# ── _has_frontmatter ─────────────────────────────────────────────────────


def test_has_frontmatter_valid() -> None:
    """Detects valid frontmatter block."""
    assert _has_frontmatter("---\ntitle: Test\n---\nBody") is True


def test_has_frontmatter_missing() -> None:
    """Returns False for content without frontmatter."""
    assert _has_frontmatter("# Just a heading\n\nContent") is False


def test_has_frontmatter_incomplete() -> None:
    """Returns False when closing --- is missing."""
    assert _has_frontmatter("---\ntitle: Test\nNo closing") is False


# ── _extract_frontmatter ────────────────────────────────────────────────


def test_extract_frontmatter_basic() -> None:
    """Extracts key-value pairs from frontmatter."""
    content = "---\nstatus: draft\nauthor: Alice\ncreated: 2025-01-01\n---\nBody"
    fm = _extract_frontmatter(content)
    assert fm["status"] == "draft"
    assert fm["author"] == "Alice"
    assert fm["created"] == "2025-01-01"


def test_extract_frontmatter_empty() -> None:
    """Returns empty dict for content without frontmatter."""
    assert _extract_frontmatter("No frontmatter here") == {}


def test_extract_frontmatter_empty_block() -> None:
    """Returns empty dict for empty frontmatter block."""
    fm = _extract_frontmatter("---\n---\nBody")
    assert fm == {}


# ── _split_anchor ────────────────────────────────────────────────────────


def test_split_anchor_with_hash() -> None:
    """Splits URL into path and anchor."""
    path, anchor = _split_anchor("page.md#section")
    assert path == "page.md"
    assert anchor == "section"


def test_split_anchor_without_hash() -> None:
    """Returns full URL as path with empty anchor."""
    path, anchor = _split_anchor("page.md")
    assert path == "page.md"
    assert anchor == ""


def test_split_anchor_only_hash() -> None:
    """Handles anchor-only links."""
    path, anchor = _split_anchor("#section")
    assert path == ""
    assert anchor == "section"


# ── docs_lint — anchor and frontmatter checks ───────────────────────────


async def test_docs_lint_broken_anchor(tmp_path) -> None:
    """docs_lint catches broken anchor links within a file."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "page.md").write_text("# Real Heading\n\nSee [link](#nonexistent-heading).\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    assert_error(result, "BROKEN_LINKS")


async def test_docs_lint_valid_anchor(tmp_path) -> None:
    """docs_lint accepts valid same-file anchor links."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "page.md").write_text("# Introduction\n\nSee [intro](#introduction).\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    assert_success(result)


async def test_docs_lint_cross_file_anchor(tmp_path) -> None:
    """docs_lint validates anchors across files."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "api.md").write_text("# API Reference\n\n## Authentication\n\nContent here.\n")
    (docs / "guide.md").write_text("# Guide\n\nSee [auth](api.md#authentication).\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    assert_success(result)


async def test_docs_lint_spec_missing_frontmatter(tmp_path) -> None:
    """docs_lint warns about specs without frontmatter."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "feature.spec.md").write_text("# Feature Spec\n\nDescription.\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    data = assert_success(result)  # warnings don't fail
    assert len(data["issues"]) >= 1
    assert any(i["rule"] == "missing-frontmatter" for i in data["issues"])


async def test_docs_lint_spec_incomplete_frontmatter(tmp_path) -> None:
    """docs_lint warns about specs with incomplete frontmatter."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "feature.spec.md").write_text(
        "---\nstatus: draft\n---\n# Feature Spec\n\nDescription.\n"
    )

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    data = assert_success(result)
    assert any(i["rule"] == "missing-frontmatter-fields" for i in data["issues"])


async def test_docs_lint_proposal_with_full_frontmatter(tmp_path) -> None:
    """docs_lint passes proposals with complete frontmatter."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "idea.proposal.md").write_text(
        "---\nstatus: proposed\nauthor: Bob\ncreated: 2025-06-01\n---\n# Idea\n\nContent.\n"
    )

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    data = assert_success(result)
    assert data["issues"] == []


async def test_docs_lint_custom_path(tmp_path) -> None:
    """docs_lint can check a custom path."""
    custom = tmp_path / "notes"
    custom.mkdir()
    (custom / "readme.md").write_text("# Notes\n\nClean content.\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint(path=str(custom))

    data = assert_success(result)
    assert data["files_checked"] == 1


async def test_docs_lint_external_links_ignored(tmp_path) -> None:
    """docs_lint ignores external HTTP links."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "page.md").write_text("# Page\n\n[Google](https://google.com)\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    assert_success(result)


# ── docs_check_changelog ────────────────────────────────────────────────


async def test_docs_check_changelog_needs_update(tmp_path) -> None:
    """Detects when src changes are staged but changelog is not."""
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        with patch("botcore.commands.docs.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout="src/botcore/server.py\nsrc/botcore/config.py\n",
                stderr="",
            )
            result = await docs_check_changelog()

    data = assert_success(result)
    assert data["needs_update"] is True
    assert len(data["staged_src_files"]) == 2


async def test_docs_check_changelog_already_updated(tmp_path) -> None:
    """No update needed when changelog is also staged."""
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        with patch("botcore.commands.docs.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout="src/botcore/server.py\nCHANGELOG.md\n",
                stderr="",
            )
            result = await docs_check_changelog()

    data = assert_success(result)
    assert data["needs_update"] is False


async def test_docs_check_changelog_no_src_changes(tmp_path) -> None:
    """No update needed when no source files staged."""
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        with patch("botcore.commands.docs.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="README.md\n", stderr="",
            )
            result = await docs_check_changelog()

    data = assert_success(result)
    assert data["needs_update"] is False


# ── docs_check_agents ────────────────────────────────────────────────────


async def test_docs_check_agents_no_workspace() -> None:
    """Returns error without workspace."""
    with patch("botcore.commands.docs.find_workspace", return_value=None):
        result = await docs_check_agents()

    assert_error(result, "NO_WORKSPACE")


async def test_docs_check_agents_no_file(tmp_path) -> None:
    """Succeeds when no AGENTS.md exists."""
    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_check_agents()

    data = assert_success(result)
    assert data["has_agents_md"] is False


async def test_docs_check_agents_needs_update(tmp_path) -> None:
    """Detects when structural changes are staged but AGENTS.md is not."""
    (tmp_path / "AGENTS.md").write_text("# Agents\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        with patch("botcore.commands.docs.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout="src/botcore/commands/new_cmd.py\nsrc/botcore/__init__.py\n",
                stderr="",
            )
            result = await docs_check_agents()

    data = assert_success(result)
    assert data["needs_update"] is True
    assert len(data["structural_changes"]) >= 1


async def test_docs_check_agents_up_to_date(tmp_path) -> None:
    """No update needed when AGENTS.md is also staged."""
    (tmp_path / "AGENTS.md").write_text("# Agents\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        with patch("botcore.commands.docs.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout="src/botcore/commands/new.py\nAGENTS.md\n",
                stderr="",
            )
            result = await docs_check_agents()

    data = assert_success(result)
    assert data["needs_update"] is False


async def test_docs_check_agents_no_structural_changes(tmp_path) -> None:
    """No update needed when changes aren't structural."""
    (tmp_path / "AGENTS.md").write_text("# Agents\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        with patch("botcore.commands.docs.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="src/botcore/config.py\n", stderr="",
            )
            result = await docs_check_agents()

    data = assert_success(result)
    assert data["needs_update"] is False


# ── #779: whole-repository coverage ──────────────────────────────────────


def _staged(stdout: str):
    """A ``subprocess.run`` stand-in answering every ``git diff --cached`` with ``stdout``."""
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")


async def test_docs_lint_checks_a_single_file(tmp_path) -> None:
    """A file path is linted, not passed with nothing checked."""
    page = tmp_path / "README.md"
    page.write_text("[gone](missing.md)\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint(path=str(page))

    error = assert_error(result, "BROKEN_LINKS")
    assert error.details["issues"]


async def test_docs_lint_skips_installed_and_generated_directories(tmp_path) -> None:
    """node_modules, .venv and build output are not the repository's docs."""
    for skipped in ("node_modules/pkg", ".venv/lib", "dist"):
        (tmp_path / skipped).mkdir(parents=True)
        (tmp_path / skipped / "README.md").write_text("[gone](missing.md)\n")
    (tmp_path / "guide.md").write_text("# Guide\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint(path=str(tmp_path))

    data = assert_success(result)
    assert data["files_checked"] == 1


async def test_docs_check_changelog_reads_each_packages_own_changelog(tmp_path) -> None:
    """In a monorepo, a package's source answers to the CHANGELOG.md nearest it."""
    (tmp_path / "CHANGELOG.md").write_text("# Index\n")
    (tmp_path / "packages/core").mkdir(parents=True)
    (tmp_path / "packages/core/CHANGELOG.md").write_text("# Core\n")

    with (
        patch("botcore.commands.docs.find_workspace", return_value=tmp_path),
        patch(
            "botcore.commands.docs.subprocess.run",
            return_value=_staged("packages/core/src/index.ts\npython/src/afd/core.py\n"),
        ),
    ):
        result = await docs_check_changelog()

    data = assert_success(result)
    assert data["needs_update"] is True
    assert data["staged_src_files"] == ["packages/core/src/index.ts", "python/src/afd/core.py"]
    assert data["changelogs"] == ["CHANGELOG.md", "packages/core/CHANGELOG.md"]

    with (
        patch("botcore.commands.docs.find_workspace", return_value=tmp_path),
        patch(
            "botcore.commands.docs.subprocess.run",
            return_value=_staged("packages/core/src/index.ts\npackages/core/CHANGELOG.md\n"),
        ),
    ):
        result = await docs_check_changelog()

    assert assert_success(result)["needs_update"] is False


async def test_docs_check_changelog_suggests_changesets_in_an_npm_repository(tmp_path) -> None:
    """changeset_create refuses an npm project, so it is not what the check suggests there."""
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n")
    (tmp_path / "package.json").write_text("{}\n")

    with (
        patch("botcore.commands.docs.find_workspace", return_value=tmp_path),
        patch("botcore.commands.docs.subprocess.run", return_value=_staged("src/index.ts\n")),
    ):
        result = await docs_check_changelog()

    assert assert_success(result)["needs_update"] is True
    assert result.suggestions is not None
    assert "pnpm changeset" in result.suggestions[0]
    assert "changeset_create" not in result.suggestions[0]


async def test_docs_check_agents_sees_new_packages_skills_workflows_and_commands(tmp_path) -> None:
    """Structure in any language counts, and editing a package's manifest does not."""
    (tmp_path / "AGENTS.md").write_text("# Agents\n")
    staged = (
        "packages/new/package.json\n"
        "crates/tool/Cargo.toml\n"
        "skills/release/SKILL.md\n"
        ".github/workflows/nightly.yml\n"
        "packages/server/src/commands/list.ts\n"
        "packages/server/src/commands/list.test.ts\n"
        "src/tool/commands/test_latest.py\n"
        "src/tool/commands/__init__.py\n"
        "src/tool/commands/latest.py\n"
        "packages/core/package.json\n"
    )
    added = (
        staged.replace("packages/server/src/commands/list.ts\n", "")
        .replace("src/tool/commands/__init__.py\n", "")
        .replace("packages/core/package.json\n", "")
    )

    def run(args, **_kwargs):
        return _staged(added if "--diff-filter=AR" in args else staged)

    with (
        patch("botcore.commands.docs.find_workspace", return_value=tmp_path),
        patch("botcore.commands.docs.subprocess.run", side_effect=run),
    ):
        result = await docs_check_agents()

    data = assert_success(result)
    assert data["needs_update"] is True
    assert data["structural_changes"] == [
        "New package: packages/new/package.json",
        "New package: crates/tool/Cargo.toml",
        "New skill: skills/release/SKILL.md",
        "New workflow: .github/workflows/nightly.yml",
        "Changed command: packages/server/src/commands/list.ts",
        # A test is not a command, though a command may have "test" in its name.
        "New command: src/tool/commands/latest.py",
    ]

