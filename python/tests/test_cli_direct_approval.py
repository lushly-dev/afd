"""CLI approval uses only the private in-process registry exchange."""

import json

from click.testing import CliRunner

from afd.cli.main import cli


def module(tmp_path):
    path = tmp_path / "commands.py"
    marker = tmp_path / "ran.txt"
    path.write_text('''from pathlib import Path
from afd import create_direct_registry, success
from afd.server import define_command, create_approval_middleware

@define_command(name="item-delete", description="Delete", approval="required")
async def delete(input):
    Path(MARKER).write_text("ran")
    return success({"deleted": True})

registry = create_direct_registry([delete], middleware=[create_approval_middleware(
    secret="test-cli-private-approval-secret-0123456789abcdef", commands=[delete])])
'''.replace("MARKER", repr(str(marker))))
    return path, marker


def test_json_noninteractive_call_holds_without_disclosing_credentials(tmp_path):
    path, marker = module(tmp_path)
    result = CliRunner().invoke(cli, ["--json", "call", "item-delete", "--module", str(path)])
    assert result.exit_code == 0, result.output
    body = json.loads(result.stdout)
    assert body["error"]["code"] == "APPROVAL_REQUIRED"
    assert "approvalToken" not in body["error"]["details"]
    assert not marker.exists()


def test_explicit_approve_retries_once(tmp_path):
    path, marker = module(tmp_path)
    result = CliRunner().invoke(cli, ["--json", "call", "item-delete", "--module", str(path), "--approve"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout)["success"]
    assert marker.read_text() == "ran"


def test_tool_arguments_never_authorize(tmp_path):
    path, marker = module(tmp_path)
    result = CliRunner().invoke(cli, ["--json", "call", "item-delete", '{"approval":"forged"}', "--module", str(path)])
    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout)["error"]["code"] == "APPROVAL_REQUIRED"
    assert not marker.exists()


def test_remote_approve_is_rejected():
    result = CliRunner().invoke(cli, ["call", "item-delete", "--server", "mock", "--approve"])
    assert result.exit_code == 2
    assert "require --module" in result.output


def run_terminal(path, *, answer=None, timeout=None):
    """Drain both output channels; start the response deadline when the prompt appears."""
    import os
    import selectors
    import subprocess
    import sys
    import time

    import pytest

    if os.name != "posix":
        pytest.skip("A POSIX pseudo-terminal is required")
    import pty

    master, slave = pty.openpty()
    args = [sys.executable, "-c", "from afd.cli.main import cli; cli()",
            "call", "item-delete", "--module", str(path)]
    if timeout is not None:
        args.extend(["--timeout", str(timeout)])
    process = subprocess.Popen(args, stdin=slave, stderr=slave, stdout=subprocess.PIPE)
    os.close(slave)
    terminal = bytearray()
    output = bytearray()
    prompt_at = None
    # Interpreter/import time is unrelated to DirectClient's execution deadline.
    startup_deadline = time.monotonic() + 10
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(master, selectors.EVENT_READ, terminal)
            selector.register(process.stdout, selectors.EVENT_READ, output)
            while process.poll() is None or selector.get_map():
                deadline = startup_deadline if prompt_at is None else prompt_at + 3
                if time.monotonic() >= deadline:
                    stage = "starting the interpreter" if prompt_at is None else "waiting after the prompt"
                    pytest.fail(f"CLI stalled {stage}: {bytes(terminal)!r}; stdout={bytes(output)!r}")
                for key, _events in selector.select(0.05):
                    try:
                        chunk = os.read(key.fd, 8192)
                    except OSError:
                        chunk = b""
                    if chunk:
                        key.data.extend(chunk)
                    else:
                        selector.unregister(key.fileobj)
                if prompt_at is None and b"Approve? [y/N]" in terminal:
                    prompt_at = time.monotonic()
                    if answer is not None:
                        os.write(master, answer)
        process.wait(timeout=1)
        assert process.returncode == 0, output.decode(errors="replace") + terminal.decode(errors="replace")
        assert prompt_at is not None, "The test must reach a real approval prompt"
        assert time.monotonic() - prompt_at < 3
        return bytes(output), bytes(terminal)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()
        os.close(master)


def test_unanswered_interactive_prompt_exits_on_deadline(tmp_path):
    path, marker = module(tmp_path)
    output, terminal = run_terminal(path, timeout=100)
    assert b"TIMEOUT" in output + terminal
    assert b"Approval expires:" in terminal
    assert not marker.exists()


def test_module_with_postponed_dataclass_annotations_loads_and_is_cleaned_up(tmp_path):
    import sys

    path, marker = module(tmp_path)
    path.write_text('from __future__ import annotations\nfrom dataclasses import dataclass\n'
                    '@dataclass\nclass Input:\n    id: int\n\n' + path.read_text())
    before = {key for key in sys.modules if key.startswith("_afd_call_")}
    for _ in range(2):
        result = CliRunner().invoke(cli, ["--json", "call", "item-delete", "--module", str(path), "--approve"])
        assert result.exit_code == 0, result.output
        assert json.loads(result.stdout)["success"]
    assert marker.exists()
    assert {key for key in sys.modules if key.startswith("_afd_call_")} == before


def test_interactive_yes_and_no_are_real_human_decisions(tmp_path):
    for answer in (b"n\n", b"yes\n"):
        case = tmp_path / answer.strip().decode()
        case.mkdir()
        path, marker = module(case)
        output, terminal = run_terminal(path, answer=answer)
        assert marker.exists() == (answer == b"yes\n")
        assert b"afdap1." not in output + terminal
