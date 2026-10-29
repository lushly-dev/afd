"""Tests for botcore.commands.spec — specification lifecycle."""

from __future__ import annotations

from afd.testing import assert_error, assert_success

from botcore.commands.spec import spec_create, spec_delete, spec_status, spec_validate


async def test_spec_create_proposal(tmp_path) -> None:
    """spec_create writes a proposal with frontmatter."""
    path = str(tmp_path / "my-feature.md")
    result = await spec_create(path, template="proposal")

    data = assert_success(result)
    assert data["template"] == "proposal"
    assert "My Feature" in data["title"]
    assert result.undo_command == "spec_delete"
    assert result.undo_args == {"path": path}

    content = (tmp_path / "my-feature.md").read_text()
    assert "status: Draft" in content
    assert "## Problem Statement" in content


async def test_spec_create_spec_template(tmp_path) -> None:
    """spec_create writes a spec with proposal reference."""
    path = str(tmp_path / "api-design.md")
    result = await spec_create(path, template="spec")

    assert_success(result)
    content = (tmp_path / "api-design.md").read_text()
    assert "## Implementation Plan" in content


async def test_spec_delete_removes_file_and_supports_undo(tmp_path) -> None:
    """spec_delete removes a file and returns recreate metadata."""
    spec = tmp_path / "feature.md"
    spec.write_text(
        "---\ntitle: Feature\nstatus: Draft\nproposal: proposal.md\n---\n# Feature\n",
        encoding="utf-8",
    )

    result = await spec_delete(str(spec))

    data = assert_success(result)
    assert data["deleted"] is True
    assert spec.exists() is False
    assert result.undo_command == "spec_create"
    assert result.undo_args == {"path": str(spec), "template": "spec"}


async def test_spec_delete_missing_file() -> None:
    """spec_delete errors for missing file."""
    result = await spec_delete("/nonexistent/path.md")
    assert_error(result, "FILE_NOT_FOUND")


async def test_spec_create_file_exists(tmp_path) -> None:
    """spec_create errors when file already exists."""
    existing = tmp_path / "existing.md"
    existing.write_text("already here")

    result = await spec_create(str(existing))
    assert_error(result, "FILE_EXISTS")


async def test_spec_create_invalid_template() -> None:
    """spec_create errors on unknown template."""
    result = await spec_create("test.md", template="unknown")
    assert_error(result, "INVALID_TEMPLATE")


async def test_spec_status(tmp_path) -> None:
    """spec_status reads status from frontmatter."""
    spec = tmp_path / "feature.md"
    spec.write_text("---\ntitle: Feature\nstatus: Approved\n---\n# Feature\n")

    result = await spec_status(str(spec))
    data = assert_success(result)
    assert data["status"] == "Approved"


async def test_spec_status_not_found() -> None:
    """spec_status errors for missing file."""
    result = await spec_status("/nonexistent/path.md")
    assert_error(result, "FILE_NOT_FOUND")


async def test_spec_validate_valid(tmp_path) -> None:
    """spec_validate passes for well-formed spec."""
    spec = tmp_path / "good.md"
    spec.write_text(
        "---\ntitle: Good Spec\nstatus: Draft\n---\n\n"
        "# Good Spec\n\n## Overview\n\nThis is a well-formed spec with enough content "
        "to pass the length check. " * 10
    )

    result = await spec_validate(str(spec))
    data = assert_success(result)
    assert data["valid"] is True


async def test_spec_validate_issues(tmp_path) -> None:
    """spec_validate catches structural issues."""
    spec = tmp_path / "bad.md"
    spec.write_text("Too short")

    result = await spec_validate(str(spec))
    data = assert_success(result)
    assert data["valid"] is False
    assert len(data["issues"]) > 0
