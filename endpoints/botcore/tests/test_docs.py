"""Tests for botcore.commands.docs — documentation commands."""

from __future__ import annotations

from pathlib import Path
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


async def test_docs_lint_never_reads_a_link_target_outside_the_workspace(tmp_path) -> None:
    """A link out of the workspace is reported, not read or tested for existence."""
    ws = tmp_path / "ws"
    docs = ws / "docs"
    docs.mkdir(parents=True)
    (tmp_path / "secret.md").write_text("# Hidden\n")
    (docs / "page.md").write_text(
        "# Page\n\n[a](../../secret.md#hidden) [b](../../missing.md) [c](/../secret.md)\n"
    )
    read = Path.read_text

    def guarded(self, *args, **kwargs):
        assert self.name != "secret.md", "read a file outside the workspace"
        return read(self, *args, **kwargs)

    with (
        patch("botcore.commands.docs.find_workspace", return_value=ws),
        patch.object(Path, "read_text", guarded),
    ):
        result = await docs_lint()

    data = assert_success(result)
    rules = [issue["rule"] for issue in data["issues"]]
    assert rules == ["link-outside-workspace"] * 3


async def test_docs_lint_skips_a_markdown_symlink_out_of_the_workspace(tmp_path) -> None:
    """A Markdown file reached through a symlink out of the workspace is not read."""
    ws = tmp_path / "ws"
    docs = ws / "docs"
    docs.mkdir(parents=True)
    (tmp_path / "outside.md").write_text("[x](./nowhere.md)\n")
    (docs / "page.md").write_text("# Page\n")
    (docs / "linked.md").symlink_to(tmp_path / "outside.md")

    with patch("botcore.commands.docs.find_workspace", return_value=ws):
        result = await docs_lint()

    data = assert_success(result)
    assert data["files_checked"] == 1
    assert data["issues"] == []


async def test_docs_lint_checks_links_between_units_of_a_worktree(tmp_path) -> None:
    """A unit's link into another unit of the same worktree is still checked."""
    (tmp_path / ".git").mkdir()
    unit = tmp_path / "unit"
    (unit / "docs").mkdir(parents=True)
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "page.md").write_text("# Other\n")
    (unit / "docs" / "page.md").write_text(
        "# Page\n\n[ok](../../other/page.md#other) [gone](../../other/missing.md)\n"
    )

    with patch("botcore.commands.docs.find_workspace", return_value=unit):
        result = await docs_lint()

    assert_error(result, "BROKEN_LINKS")
    issues = result.error.details["issues"]
    assert [issue["rule"] for issue in issues] == ["broken-link"]


async def test_docs_lint_survives_a_symlink_loop(tmp_path) -> None:
    """A link through a symlink loop is reported, not raised."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "loop").symlink_to(docs / "loop")
    (docs / "page.md").write_text("# Page\n\n[x](loop/x.md)\n")

    with patch("botcore.commands.docs.find_workspace", return_value=tmp_path):
        result = await docs_lint()

    # Python 3.11 and 3.12 cannot resolve the loop (an outside warning); later versions
    # resolve it inside the workspace, where the target does not exist (a broken link).
    issues = result.data["issues"] if result.success else result.error.details["issues"]
    assert [issue["rule"] for issue in issues] in (["link-outside-workspace"], ["broken-link"])


async def test_docs_lint_refuses_a_docs_directory_that_links_out(tmp_path) -> None:
    """A starting directory outside the workspace is refused before it is listed."""
    ws = tmp_path / "ws"
    ws.mkdir()
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "page.md").write_text("# Page\n")
    (ws / "docs").symlink_to(tmp_path / "elsewhere")

    with patch("botcore.commands.docs.find_workspace", return_value=ws):
        result = await docs_lint()

    assert_error(result, "PATH_OUTSIDE_WORKSPACE")


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

    with (
        patch("botcore.commands.docs.get_client", return_value=client),
        patch("botcore.commands.docs.find_workspace", return_value=None),
    ):
        result = await docs_preflight()

    data = assert_success(result)
    assert data["needs_update"] is True
    assert data["checks"]["changelog"]["needs_update"] is True
    assert data["checks"]["agents"]["needs_update"] is False
    assert data["step_count"] == 2
    assert result.suggestions == [
        "Run changeset_create to record this change, or update the CHANGELOG.md named: CHANGELOG.md"
    ]


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
