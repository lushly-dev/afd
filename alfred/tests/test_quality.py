"""Tests for alfred_quality command."""

import tempfile
from pathlib import Path

import pytest

from alfred.commands.quality import alfred_quality


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


@pytest.mark.asyncio
async def test_quality_empty_dir(tmp_dir):
    """Quality check on an empty directory should report zero commands."""
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    assert result.data["commands_scanned"] == 0
    assert result.data["issue_count"] == 0


@pytest.mark.asyncio
async def test_quality_good_ts_command(tmp_dir):
    """A well-described TypeScript command should pass all checks."""
    ts_file = tmp_dir / "commands.ts"
    ts_file.write_text(
        "const cmd = defineCommand({\n"
        "  name: 'todo-create',\n"
        "  description: 'Create a new todo item with title and optional priority',\n"
        "  input: z.object({ title: z.string() }),\n"
        "  handler: async (input) => success({}),\n"
        "});\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    assert result.data["typescript_commands"] == 1
    assert result.data["issue_count"] == 0


@pytest.mark.asyncio
async def test_quality_short_description(tmp_dir):
    """A too-short description should be flagged."""
    ts_file = tmp_dir / "commands.ts"
    ts_file.write_text(
        "const cmd = defineCommand({\n"
        "  name: 'todo-get',\n"
        "  description: 'Get todo',\n"
        "});\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    issues = result.data["issues"]
    checks = [i["check"] for i in issues]
    assert "description-too-short" in checks


@pytest.mark.asyncio
async def test_quality_non_imperative(tmp_dir):
    """A description not starting with a verb should be flagged."""
    ts_file = tmp_dir / "commands.ts"
    ts_file.write_text(
        "const cmd = defineCommand({\n"
        "  name: 'user-profile',\n"
        "  description: 'The user profile management endpoint for admins',\n"
        "});\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    issues = result.data["issues"]
    checks = [i["check"] for i in issues]
    assert "not-imperative" in checks


@pytest.mark.asyncio
async def test_quality_near_duplicate(tmp_dir):
    """Nearly identical descriptions should be flagged."""
    ts_file = tmp_dir / "commands.ts"
    ts_file.write_text(
        "const cmd1 = defineCommand({\n"
        "  name: 'item-create',\n"
        "  description: 'Create a new item in the database with validation',\n"
        "});\n"
        "const cmd2 = defineCommand({\n"
        "  name: 'item-add',\n"
        "  description: 'Create a new item in the database with checks',\n"
        "});\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    issues = result.data["issues"]
    checks = [i["check"] for i in issues]
    assert "near-duplicate" in checks


@pytest.mark.asyncio
async def test_quality_python_commands(tmp_dir):
    """Python command definitions should be detected and validated."""
    py_file = tmp_dir / "server.py"
    py_file.write_text(
        '@server.command(name="note-create", description="Create a new note with title and body")\n'
        "async def create_note(input):\n"
        "    pass\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    assert result.data["python_commands"] == 1
    assert result.data["issue_count"] == 0


@pytest.mark.asyncio
async def test_quality_long_description(tmp_dir):
    """A too-long description should be flagged."""
    long_desc = "Get " + "a very detailed and comprehensive " * 5 + "result from the server"
    ts_file = tmp_dir / "commands.ts"
    ts_file.write_text(
        "const cmd = defineCommand({\n"
        f"  name: 'data-fetch',\n"
        f"  description: '{long_desc}',\n"
        "});\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(tmp_dir))
    assert result.success is True
    issues = result.data["issues"]
    checks = [i["check"] for i in issues]
    assert "description-too-long" in checks
