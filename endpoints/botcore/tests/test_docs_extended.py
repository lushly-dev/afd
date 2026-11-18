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
                args=[],
                returncode=0,
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
                args=[],
                returncode=0,
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
                args=[],
                returncode=0,
                stdout="README.md\n",
                stderr="",
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


def _repo(root, agents: str, files: dict[str, str]) -> None:
    """A git repository at ``root`` with AGENTS.md and ``files`` committed."""
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "AGENTS.md").write_text(agents, encoding="utf-8")
    for name, content in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(content, encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base"],
        cwd=root,
        check=True,
    )


def _stage(root, files: dict[str, str | None]) -> None:
    """Write (or, for None, remove) ``files`` and stage everything."""
    for name, content in files.items():
        if content is None:
            (root / name).unlink()
            continue
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(content, encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)


async def _check_agents(root):
    with patch("botcore.commands.docs.find_workspace", return_value=root):
        return assert_success(await docs_check_agents())


async def test_docs_check_agents_new_command_is_advisory(tmp_path) -> None:
    """A router AGENTS.md need not list a new command, package, skill or workflow (#1128)."""
    _repo(
        tmp_path,
        "# Agents\n\n`src/` holds the code.\n",
        {
            "src/tool/__init__.py": "",
            "skills/other/SKILL.md": "# Other\n",
            ".github/workflows/ci.yml": "on: push\n",
        },
    )
    _stage(
        tmp_path,
        {
            "src/tool/commands/new_cmd.py": "x = 1\n",
            "skills/release/SKILL.md": "# Release\n",
            ".github/workflows/nightly.yml": "on: push\n",
        },
    )

    data = await _check_agents(tmp_path)

    assert data["needs_update"] is False
    assert data["owned_changes"] == []
    assert "New command: src/tool/commands/new_cmd.py" in data["structural_changes"]


async def test_docs_check_agents_new_top_level_directory(tmp_path) -> None:
    """A new top-level directory AGENTS.md does not name needs an entry."""
    _repo(tmp_path, "# Agents\n\n`src/` holds the code.\n", {"src/a.py": ""})
    _stage(tmp_path, {"tools/run.py": "x = 1\n"})

    data = await _check_agents(tmp_path)

    assert data["needs_update"] is True
    assert data["owned_changes"] == ["New top-level directory: tools/"]


async def test_docs_check_agents_new_top_level_directory_already_named(tmp_path) -> None:
    """A new directory AGENTS.md already names, or a new root file, needs nothing."""
    _repo(tmp_path, "# Agents\n\n`src/` and `tools/` hold the code.\n", {"src/a.py": ""})
    _stage(tmp_path, {"tools/run.py": "x = 1\n", "NOTES.md": "notes\n"})

    assert (await _check_agents(tmp_path))["needs_update"] is False


async def test_docs_check_agents_renamed_path_it_names(tmp_path) -> None:
    """AGENTS.md cites a script that the change renames."""
    agents = "# Agents\n\nRun `scripts/check-size.mjs` before pushing.\n"
    _repo(tmp_path, agents, {"scripts/check-size.mjs": "export {};\n"})
    subprocess.run(
        ["git", "mv", "scripts/check-size.mjs", "scripts/check-file-size.mjs"],
        cwd=tmp_path,
        check=True,
    )

    data = await _check_agents(tmp_path)

    assert data["needs_update"] is True
    assert data["owned_changes"] == [
        "AGENTS.md names scripts/check-size.mjs, which this change renamed to "
        "scripts/check-file-size.mjs"
    ]


async def test_docs_check_agents_removed_skill_it_names(tmp_path) -> None:
    """AGENTS.md cites a skill by name that the change removes."""
    _repo(
        tmp_path,
        "# Agents\n\nShip with `prepare-pr`.\n",
        {"skills/prepare-pr/SKILL.md": "# Prepare\n", "skills/other/SKILL.md": "# Other\n"},
    )
    _stage(tmp_path, {"skills/prepare-pr/SKILL.md": None})

    data = await _check_agents(tmp_path)

    assert data["needs_update"] is True
    assert data["owned_changes"] == ["AGENTS.md names `prepare-pr`, which this change removed"]


async def test_docs_check_agents_removed_manifest_is_not_a_citation(tmp_path) -> None:
    """A generic file name AGENTS.md happens to mention is not a citation of every such file."""
    _repo(
        tmp_path,
        "# Agents\n\nDependencies live in `package.json`.\n",
        {"package.json": "{}\n", "packages/old/package.json": "{}\n"},
    )
    _stage(tmp_path, {"packages/old/package.json": None})

    assert (await _check_agents(tmp_path))["needs_update"] is False


async def test_docs_check_agents_in_a_nested_workspace(tmp_path) -> None:
    """A workspace below the git root reads its own paths and its own AGENTS.md."""
    ws = tmp_path / "sub"
    ws.mkdir()
    _repo(tmp_path, "# Root\n", {"sub/AGENTS.md": "# Sub\n", "sub/src/a.py": ""})
    _stage(tmp_path, {"sub/scripts/x.py": "x = 1\n"})

    data = await _check_agents(ws)
    assert data["owned_changes"] == ["New top-level directory: scripts/"]

    _stage(tmp_path, {"sub/AGENTS.md": "# Sub\n\n`scripts/`\n"})
    assert (await _check_agents(ws))["needs_update"] is False


async def test_docs_check_agents_moved_directory_it_names(tmp_path) -> None:
    """AGENTS.md names a directory the change moves away; one file leaving it is not that."""
    _repo(
        tmp_path,
        "# Agents\n\n`alfred/` is the quality bot.\n",
        {"alfred/a.py": "", "alfred/b.py": "", "src/c.py": ""},
    )
    subprocess.run(["git", "mv", "alfred/a.py", "src/a.py"], cwd=tmp_path, check=True)
    assert (await _check_agents(tmp_path))["needs_update"] is False

    subprocess.run(["git", "mv", "alfred/b.py", "src/b.py"], cwd=tmp_path, check=True)
    data = await _check_agents(tmp_path)
    assert data["owned_changes"] == ["AGENTS.md names alfred/, which this change removes or moves"]


async def test_docs_check_agents_cites_whole_names_only(tmp_path) -> None:
    """A removed command module is not cited by a longer name that contains it."""
    _repo(
        tmp_path,
        "# Agents\n\nSee `src/tool/commands/blacklist.py`.\n",
        {"src/tool/commands/list.py": "", "src/tool/commands/blacklist.py": ""},
    )
    _stage(tmp_path, {"src/tool/commands/list.py": None})

    assert (await _check_agents(tmp_path))["needs_update"] is False


async def test_docs_check_agents_up_to_date(tmp_path) -> None:
    """No update needed when AGENTS.md is also staged."""
    _repo(tmp_path, "# Agents\n", {"src/a.py": ""})
    _stage(tmp_path, {"tools/run.py": "x = 1\n", "AGENTS.md": "# Agents\n\n`tools/`\n"})

    assert (await _check_agents(tmp_path))["needs_update"] is False


async def test_docs_check_agents_no_structural_changes(tmp_path) -> None:
    """No update needed when changes aren't structural."""
    _repo(tmp_path, "# Agents\n", {"src/config.py": "x = 1\n"})
    _stage(tmp_path, {"src/config.py": "x = 2\n"})

    data = await _check_agents(tmp_path)

    assert data["needs_update"] is False
    assert data["structural_changes"] == []


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
    modified = {
        "packages/server/src/commands/list.ts",
        "src/tool/commands/__init__.py",
        "packages/core/package.json",
    }
    status = "".join(
        f"{'M' if path in modified else 'A'}\t{path}\n" for path in staged.splitlines()
    )

    def run(args, **_kwargs):
        if "ls-tree" in args:  # Every top-level directory is already tracked.
            return _staged("packages\ncrates\nskills\n.github\nsrc\n")
        return _staged(status)

    with (
        patch("botcore.commands.docs.find_workspace", return_value=tmp_path),
        patch("botcore.commands.docs.subprocess.run", side_effect=run),
    ):
        result = await docs_check_agents()

    data = assert_success(result)
    assert data["needs_update"] is False  # AGENTS.md routes; these are reported (#1128).
    assert data["structural_changes"] == [
        "New package: packages/new/package.json",
        "New package: crates/tool/Cargo.toml",
        "New skill: skills/release/SKILL.md",
        "New workflow: .github/workflows/nightly.yml",
        "Changed command: packages/server/src/commands/list.ts",
        # A test is not a command, though a command may have "test" in its name.
        "New command: src/tool/commands/latest.py",
    ]
