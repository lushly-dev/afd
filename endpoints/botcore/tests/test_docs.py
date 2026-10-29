"""Tests for botcore.commands.docs — documentation commands."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from afd import error, success
from afd.testing import assert_error, assert_success

from botcore.commands.docs import (
    _extract_headings,
    _slugify_heading,
    docs_check_changelog,
    docs_lint,
    docs_preflight,
)


def test_slugify_heading() -> None:
    """Heading slugification works correctly."""
    assert _slugify_heading("Hello World") == "hello-world"
    assert _slugify_heading("API Changes (v2)") == "api-changes-v2"
    assert _slugify_heading("## Nested!") == "nested"


def test_extract_headings() -> None:
    """Heading extraction finds all levels."""
    content = "# Title\n\nSome text.\n\n## Section One\n\n### Sub Section\n"
    headings = _extract_headings(content)
    assert "title" in headings
    assert "section-one" in headings
    assert "sub-section" in headings


async def test_docs_lint_no_docs_dir(tmp_path) -> None:
    """docs_lint errors when docs directory doesn't exist."""
    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    assert_error(result, "PATH_NOT_FOUND")


async def test_docs_lint_no_issues(tmp_path) -> None:
    """docs_lint passes with valid markdown."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "readme.md").write_text("# Hello\n\nSome content.\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    data = assert_success(result)
    assert data["files_checked"] == 1
    assert data["passed"] is True


async def test_docs_lint_broken_link(tmp_path) -> None:
    """docs_lint catches broken internal links."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "page.md").write_text("# Page\n\nSee [other](./nonexistent.md).\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    assert_error(result, "BROKEN_LINKS")


async def test_docs_check_changelog_no_workspace() -> None:
    """docs_check_changelog errors without workspace."""
    with patch("botcore.commands.docs.find_workspace", return_value=None):
        result = await docs_check_changelog()

    assert_error(result, "NO_WORKSPACE")


async def test_docs_check_changelog_no_file(tmp_path) -> None:
    """docs_check_changelog succeeds when no CHANGELOG.md exists."""
    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_check_changelog()

    data = assert_success(result)
    assert data["has_changelog"] is False


async def test_docs_preflight_combines_pipeline_results() -> None:
    """docs_preflight returns combined readiness data from the pipeline."""
    pipeline_result = SimpleNamespace(
        success=True,
        steps=[object(), object()],
        outputs={
            "changelog": {"needs_update": True, "has_changelog": True},
            "agents": {"needs_update": False, "has_agents_md": True},
        },
        final=success(data={"has_agents_md": True, "needs_update": False}),
    )

    client = SimpleNamespace(pipe=None)

    async def _pipe(steps):
        return pipeline_result

    client.pipe = _pipe

    with patch("botcore.commands.docs.get_client", return_value=client):
        result = await docs_preflight()

    data = assert_success(result)
    assert data["needs_update"] is True
    assert data["checks"]["changelog"]["needs_update"] is True
    assert data["checks"]["agents"]["needs_update"] is False
    assert data["step_count"] == 2
    assert result.suggestions == ["Run changeset_create to record the staged source changes"]


async def test_docs_preflight_propagates_pipeline_error() -> None:
    """docs_preflight returns the underlying command error on pipeline failure."""
    pipeline_result = SimpleNamespace(
        success=False,
        steps=[object()],
        outputs={},
        final=error("NO_WORKSPACE", "Could not find workspace root"),
    )

    client = SimpleNamespace(pipe=None)

    async def _pipe(steps):
        return pipeline_result

    client.pipe = _pipe

    with patch("botcore.commands.docs.get_client", return_value=client):
        result = await docs_preflight()

    assert_error(result, "NO_WORKSPACE")
