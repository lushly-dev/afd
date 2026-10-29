"""Tests for changeset commands."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.changeset import (
    changeset_consume,
    changeset_create,
    changeset_delete,
    changeset_status,
)


@pytest.fixture()
def workspace(tmp_path):
    """Create a workspace with .git marker and CHANGELOG.md."""
    (tmp_path / ".git").mkdir()
    changelog = tmp_path / "CHANGELOG.md"
    changelog.write_text(
        "# Changelog\n\n"
        "## [Unreleased]\n\n"
        "## [0.1.0] - 2026-01-01\n\n"
        "### Added\n\n"
        "- Initial release\n",
        encoding="utf-8",
    )
    return tmp_path


def _patch_ws(ws):
    return patch("botcore.commands.changeset.find_workspace", return_value=ws)


# ── changeset_create ─────────────────────────────────────────────────────────


async def test_create_success(workspace):
    with _patch_ws(workspace):
        result = await changeset_create("added", "**cli** -- new init command")

    data = assert_success(result)
    assert data["type"] == "added"
    assert ".changeset/" in data["path"]
    assert result.undo_command == "changeset_delete"
    assert result.undo_args == {"path": data["path"]}

    # Verify file exists and has correct content
    cs_dir = workspace / ".changeset"
    files = [f for f in cs_dir.glob("*.md") if f.name.lower() != "readme.md"]
    assert len(files) == 1
    content = files[0].read_text()
    assert "type: added" in content
    assert "**cli** -- new init command" in content


async def test_returned_paths_are_posix_on_every_platform(workspace):
    """Paths in command results must not vary by platform.

    Regression: these were `str(Path.relative_to(...))`, which emits
    `.changeset\\x.md` on Windows and `.changeset/x.md` on POSIX. The value is
    both handed to agents and fed straight back into `changeset_delete` as
    `undo_args`, so a backslash form makes results platform-dependent.
    """
    with _patch_ws(workspace):
        created = assert_success(await changeset_create("added", "**cli** -- thing"))
        assert "\\" not in created["path"]
        assert created["path"].startswith(".changeset/")

        listed = assert_success(await changeset_status())
        assert all("\\" not in entry["file"] for entry in listed["entries"])

        deleted = assert_success(await changeset_delete(created["path"]))
        assert "\\" not in deleted["path"]


async def test_create_invalid_type(workspace):
    with _patch_ws(workspace):
        result = await changeset_create("feature", "some desc")

    assert_error(result, "INVALID_TYPE")


async def test_create_empty_description(workspace):
    with _patch_ws(workspace):
        result = await changeset_create("fixed", "  ")

    assert_error(result, "EMPTY_DESCRIPTION")


async def test_create_no_workspace():
    with patch("botcore.commands.changeset.find_workspace", return_value=None):
        result = await changeset_create("added", "desc")

    assert_error(result, "NO_WORKSPACE")


async def test_create_creates_directory(workspace):
    """Should create .changeset/ if it doesn't exist."""
    cs_dir = workspace / ".changeset"
    assert not cs_dir.exists()

    with _patch_ws(workspace):
        result = await changeset_create("fixed", "**bug** -- fix crash")

    assert_success(result)
    assert cs_dir.exists()


async def test_delete_success(workspace):
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    changeset = cs_dir / "a.md"
    changeset.write_text("---\ntype: fixed\n---\n\n**bug** -- fix crash\n", encoding="utf-8")

    with _patch_ws(workspace):
        result = await changeset_delete(".changeset/a.md")

    data = assert_success(result)
    assert data["deleted"] is True
    assert changeset.exists() is False
    assert result.undo_command == "changeset_create"
    assert result.undo_args == {
        "change_type": "fixed",
        "description": "**bug** -- fix crash",
    }


async def test_delete_missing_file(workspace):
    with _patch_ws(workspace):
        result = await changeset_delete(".changeset/missing.md")

    assert_error(result, "FILE_NOT_FOUND")


# ── changeset_status ─────────────────────────────────────────────────────────


async def test_status_empty(workspace):
    with _patch_ws(workspace):
        result = await changeset_status()

    data = assert_success(result)
    assert data["count"] == 0


async def test_status_with_files(workspace):
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "abc.md").write_text("---\ntype: added\n---\n\nNew feature\n")
    (cs_dir / "def.md").write_text("---\ntype: fixed\n---\n\nBug fix\n")
    (cs_dir / "README.md").write_text("# Changesets\n")

    with _patch_ws(workspace):
        result = await changeset_status()

    data = assert_success(result)
    assert data["count"] == 2
    assert data["by_type"] == {"added": 1, "fixed": 1}


# ── changeset_consume ────────────────────────────────────────────────────────


async def test_consume_generates_section(workspace):
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "a.md").write_text("---\ntype: added\n---\n\n- **cli** -- init command\n")
    (cs_dir / "b.md").write_text("---\ntype: fixed\n---\n\n- **config** -- fix crash\n")

    with _patch_ws(workspace):
        result = await changeset_consume(version="1.0.0")

    data = assert_success(result)
    assert data["consumed"] == 2
    assert "Added" in data["categories"]
    assert "Fixed" in data["categories"]

    changelog = (workspace / "CHANGELOG.md").read_text()
    assert "## [1.0.0]" in changelog
    assert "**cli** -- init command" in changelog
    assert "**config** -- fix crash" in changelog
    # Should still have [Unreleased]
    assert "## [Unreleased]" in changelog


async def test_consume_deletes_files(workspace):
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "a.md").write_text("---\ntype: added\n---\n\nNew thing\n")

    with _patch_ws(workspace):
        await changeset_consume()

    remaining = [f for f in cs_dir.glob("*.md") if f.name.lower() != "readme.md"]
    assert len(remaining) == 0


async def test_consume_preserves_readme(workspace):
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "README.md").write_text("# Changesets\n")
    (cs_dir / "a.md").write_text("---\ntype: added\n---\n\nNew thing\n")

    with _patch_ws(workspace):
        await changeset_consume()

    assert (cs_dir / "README.md").exists()


async def test_consume_no_changesets(workspace):
    with _patch_ws(workspace):
        result = await changeset_consume()

    assert_error(result, "NO_CHANGESETS")


async def test_consume_unreleased(workspace):
    """Consuming without a version replaces the [Unreleased] section."""
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "a.md").write_text("---\ntype: added\n---\n\n- **feat** -- new\n")

    with _patch_ws(workspace):
        result = await changeset_consume()

    data = assert_success(result)
    assert data["version"] is None

    changelog = (workspace / "CHANGELOG.md").read_text()
    assert "## [Unreleased]" in changelog
    assert "**feat** -- new" in changelog


async def test_consume_inserts_before_existing_versions(workspace):
    """New section should appear between [Unreleased] and first versioned section."""
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "a.md").write_text("---\ntype: added\n---\n\n- **new** -- feature\n")

    with _patch_ws(workspace):
        await changeset_consume(version="0.2.0")

    changelog = (workspace / "CHANGELOG.md").read_text()
    unreleased_pos = changelog.index("## [Unreleased]")
    new_version_pos = changelog.index("## [0.2.0]")
    old_version_pos = changelog.index("## [0.1.0]")
    assert unreleased_pos < new_version_pos < old_version_pos


async def test_consume_entry_without_list_prefix(workspace):
    """Entries without '- ' prefix should get it added."""
    cs_dir = workspace / ".changeset"
    cs_dir.mkdir()
    (cs_dir / "a.md").write_text("---\ntype: added\n---\n\n**cli** -- no dash prefix\n")

    with _patch_ws(workspace):
        await changeset_consume()

    changelog = (workspace / "CHANGELOG.md").read_text()
    assert "- **cli** -- no dash prefix" in changelog
