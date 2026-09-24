"""Tests for alfred_quality command."""

import os
import re
import tempfile
from pathlib import Path

import pytest

from alfred.commands import quality
from alfred.commands.quality import (
    _find_ts_commands,
    alfred_quality,
    parse_py_commands,
    parse_ts_define_commands,
)

REPO_ROOT = Path(__file__).parent.parent.parent


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


# ─── Parser coverage ─────────────────────────────────────────────────────────


def _pairs(commands):
    return [(c.name, c.description) for c in commands]


def test_ts_generic_define_command_calls():
    content = """
export const listTodos = defineCommand<typeof inputSchema, ListResult>({
    name: 'todo-list',
    description: 'List todos with optional filtering',
});
export const mapped = defineCommand<
    (input: Input) => Promise<Output>,
    { id: string; tags: Array<string> }
>({ name: 'todo-map', description: 'Map todos to summaries' });
"""
    assert _pairs(parse_ts_define_commands(content)) == [
        ("todo-list", "List todos with optional filtering"),
        ("todo-map", "Map todos to summaries"),
    ]


def test_ts_nested_objects_before_description():
    content = """
defineCommand({
    name: 'todo-create',
    expose: { mcp: true, cli: false },
    input: z.object({ description: z.string(), meta: z.object({ a: z.number() }) }),
    handler: async (input) => { return success({ description: 'inner' }); },
    description: 'Create a todo item',
});
"""
    assert _pairs(parse_ts_define_commands(content)) == [("todo-create", "Create a todo item")]


def test_ts_apostrophes_escapes_and_concatenation():
    content = r"""
defineCommand({ name: 'a-one', description: "Delete the user's todo permanently" });
defineCommand({ name: 'a-two', description: 'Don\'t keep completed todos' });
defineCommand({ name: 'a-three', description: `Get the owner's "active" todos` });
defineCommand({
    'name': "a-four",
    description: 'List todos ' +
        "that aren't done",
});
defineCommand({ name: 'a-five', description: `Get ${dynamic} todos` });
defineCommand({ name, description: 'Shorthand name is skipped' });
"""
    assert _pairs(parse_ts_define_commands(content)) == [
        ("a-one", "Delete the user's todo permanently"),
        ("a-two", "Don't keep completed todos"),
        ("a-three", 'Get the owner\'s "active" todos'),
        ("a-four", "List todos that aren't done"),
    ]


def test_ts_comments_imports_and_mentions_are_ignored():
    content = """
import { defineCommand } from '@lushly-dev/afd-server';
// defineCommand({ name: 'in-comment', description: 'Line comment example' })
/**
 * defineCommand({ name: 'in-docs', description: 'Doc comment example' })
 */
const text = 'call defineCommand({ ... }) to define';
type Factory = typeof defineCommand;
defineCommand({ name: 'real-one', description: 'Create the real command' }); // trailing
"""
    assert _pairs(parse_ts_define_commands(content)) == [
        ("real-one", "Create the real command")
    ]


def test_ts_line_numbers():
    content = "\n\nconst x = defineCommand({ name: 'x-y', description: 'Get the x value' });\n"
    [command] = parse_ts_define_commands(content, "file.ts")
    assert (command.file, command.line) == ("file.ts", 3)


def test_py_commands_with_apostrophes_and_positional_arguments():
    content = '''
"""Docs: @server.command(name="doc-example", description="Not a real command")."""

@server.command(name="note-create", description="Create a note that doesn't expire")
async def create(input):
    pass

@server.command("note-list", "List notes " "for the current user")
async def list_notes(input):
    pass

delete = define_command(
    name='note-delete',
    description='Delete a note',
    handler=handler,
)

@click.command(name="cli-only", help="Not an AFD command")
def cli():
    pass
'''
    commands = parse_py_commands(content)
    assert _pairs(commands) == [
        ("note-create", "Create a note that doesn't expire"),
        ("note-list", "List notes for the current user"),
        ("note-delete", "Delete a note"),
    ]
    assert [c.line for c in commands] == [4, 8, 12]


def test_py_unparsable_file_is_skipped():
    assert parse_py_commands("def broken(:\n") == []


@pytest.mark.asyncio
async def test_quality_prunes_ignored_directories(tmp_dir, monkeypatch):
    """node_modules and friends are neither scanned nor walked into."""
    good = "defineCommand({ name: 'todo-get', description: 'Get a todo by its ID' });\n"
    (tmp_dir / "src").mkdir()
    (tmp_dir / "src" / "commands.ts").write_text(good, encoding="utf-8")
    for ignored in ("node_modules/pkg/dist", ".venv/lib", "dist", "sub/node_modules/x"):
        directory = tmp_dir / ignored
        directory.mkdir(parents=True)
        (directory / "vendored.ts").write_text(
            "defineCommand({ name: 'vendor-cmd', description: 'Vendored' });\n",
            encoding="utf-8",
        )

    walked: list[str] = []
    real_walk = quality.os.walk

    def recording_walk(top, *args, **kwargs):
        for dirpath, dirnames, filenames in real_walk(top, *args, **kwargs):
            walked.append(dirpath)
            yield dirpath, dirnames, filenames

    monkeypatch.setattr(quality.os, "walk", recording_walk)
    result = await alfred_quality(str(tmp_dir))

    assert result.data["typescript_commands"] == 1
    assert not [d for d in walked if "node_modules" in d or ".venv" in d or "dist" in d]


@pytest.mark.asyncio
async def test_quality_scans_a_root_under_a_skipped_path(tmp_dir):
    """Skip patterns such as `.claude/` apply below the root, not to the root."""
    root = tmp_dir / ".claude" / "worktrees" / "checkout"
    root.mkdir(parents=True)
    (root / "cmd.ts").write_text(
        "defineCommand({ name: 'todo-get', description: 'Get a todo by its ID' });\n",
        encoding="utf-8",
    )
    (root / ".claude").mkdir()
    (root / ".claude" / "skill.ts").write_text(
        "defineCommand({ name: 'skill-cmd', description: 'Get a skill example' });\n",
        encoding="utf-8",
    )
    result = await alfred_quality(str(root))
    assert result.data["typescript_commands"] == 1


def _count_define_command_calls(root: Path) -> int:
    """Count `defineCommand(` / `defineCommand<` call sites outside comments."""
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {"node_modules", "dist", "build"}]
        for filename in filenames:
            if not filename.endswith((".ts", ".tsx", ".js", ".jsx")):
                continue
            text = (Path(dirpath) / filename).read_text(encoding="utf-8")
            text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
            text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
            total += len(re.findall(r"\bdefineCommand\s*[<(]", text))
    return total


@pytest.mark.asyncio
async def test_quality_scans_every_example_command():
    """Every defineCommand call in packages/examples is scanned (was 43 of 68)."""
    examples = REPO_ROOT / "packages" / "examples"
    if not examples.is_dir():
        pytest.skip("Not running from the AFD repo")

    commands = _find_ts_commands(examples)
    expected = _count_define_command_calls(examples)

    assert expected >= 68
    assert len(commands) == expected
    found = {(c.name, c.description) for c in commands}
    # A generic call, with `expose: { mcp: true }` after the description.
    assert ("todo-list", "List todos with optional filtering and pagination") in found
