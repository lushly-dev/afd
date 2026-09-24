"""Child processes never outlive the call that started them.

A batch deadline cancels its commands; a command running a subprocess (via
``exec_command`` or the testing ``CliWrapper``) must kill and reap the child.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

import afd.platform as platform_module
from afd.platform import ExecErrorCode, ExecOptions, exec_command
from afd.testing.cli_wrapper import CliWrapper

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX process checks")

SLEEPER = "import os, sys, time; open(sys.argv[1], 'w').write(str(os.getpid())); time.sleep(30)"


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def _pid_from(path: Path) -> int:
    for _ in range(500):
        if path.exists() and path.read_text():
            return int(path.read_text())
        await asyncio.sleep(0.01)
    raise AssertionError("child did not start")


async def _cancel_and_check(start, tmp_path: Path) -> None:
    pid_file = tmp_path / "pid"
    task = asyncio.ensure_future(start(str(pid_file)))
    pid = await _pid_from(pid_file)
    try:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not _alive(pid), "the child process was orphaned"
    finally:
        if _alive(pid):
            os.kill(pid, 9)


class TestExecCommand:
    @pytest.mark.asyncio
    async def test_cancelling_the_caller_kills_the_child(self, tmp_path):
        await _cancel_and_check(
            lambda pid_file: exec_command([sys.executable, "-c", SLEEPER, pid_file]),
            tmp_path,
        )

    @pytest.mark.asyncio
    async def test_a_default_timeout_applies(self, tmp_path, monkeypatch):
        monkeypatch.setattr(platform_module, "DEFAULT_EXEC_TIMEOUT_MS", 200)
        pid_file = tmp_path / "pid"

        result = await asyncio.wait_for(
            exec_command([sys.executable, "-c", SLEEPER, str(pid_file)]), timeout=10
        )

        assert result.error_code == ExecErrorCode.TIMEOUT
        assert not _alive(int(pid_file.read_text()))

    def test_default_timeout_is_five_minutes(self):
        assert platform_module.DEFAULT_EXEC_TIMEOUT_MS == 300_000
        assert ExecOptions().timeout is None

    @pytest.mark.asyncio
    async def test_explicit_timeout_kills_the_child(self, tmp_path):
        pid_file = tmp_path / "pid"

        result = await exec_command(
            [sys.executable, "-c", SLEEPER, str(pid_file)], ExecOptions(timeout=300)
        )

        assert result.error_code == ExecErrorCode.TIMEOUT
        assert not _alive(int(pid_file.read_text()))


class TestCliWrapper:
    @pytest.mark.asyncio
    async def test_cancelling_the_caller_kills_the_child(self, tmp_path):
        wrapper = CliWrapper()
        wrapper.configure(cli_path=sys.executable)

        await _cancel_and_check(
            lambda pid_file: wrapper._spawn(["-c", SLEEPER, pid_file], 30_000),
            tmp_path,
        )

    @pytest.mark.asyncio
    async def test_timeout_kills_the_child(self, tmp_path):
        wrapper = CliWrapper()
        wrapper.configure(cli_path=sys.executable)
        pid_file = tmp_path / "pid"

        with pytest.raises(TimeoutError):
            await wrapper._spawn(["-c", SLEEPER, str(pid_file)], 300)

        assert not _alive(int(pid_file.read_text()))


class TestBatchDeadline:
    @pytest.mark.asyncio
    async def test_batch_deadline_kills_a_command_subprocess(self, tmp_path):
        from afd import ExposeOptions, success
        from afd.server import create_server

        pid_file = tmp_path / "pid"
        server = create_server("subprocess")

        @server.command(name="job-run", description="Run a job", expose=ExposeOptions(mcp=True))
        async def job_run(input):
            result = await exec_command([sys.executable, "-c", SLEEPER, str(pid_file)])
            return success({"exit": result.exit_code})

        batch = await server.call_tool(
            "afd-batch", {"commands": [{"command": "job-run"}], "options": {"timeout": 500}}
        )

        pid = int(pid_file.read_text())
        try:
            assert batch.results[0].result.error.code == "BATCH_TIMEOUT"
            assert not _alive(pid)
        finally:
            if _alive(pid):
                os.kill(pid, 9)
