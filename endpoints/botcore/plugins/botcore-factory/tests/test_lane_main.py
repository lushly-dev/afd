"""The lane process's own setup: its log and, on Windows, console Ctrl+C (lushly-dev/afd#2836).

These run real child interpreters: what they check is what the operating system does with a
process's output and its console's control events.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from botcore_factory.lane_main import LANE_LOG_ENV

WRITES = """
import os, subprocess, sys
from pathlib import Path
from botcore_factory.lane_main import LANE_LOG_ENV, log_to
log_to(Path(sys.argv[1]))
print("lane out")
print("lane err", file=sys.stderr)
subprocess.run([sys.executable, "-c", "print('step out')"], check=True)
print(os.environ[LANE_LOG_ENV])
"""


CLOSED = """
import os, sys
from pathlib import Path
from botcore_factory.lane_main import log_to
os.close(1)
sys.stdout = None
log_to(Path(sys.argv[1]))
print("still writes")
"""


def test_the_log_is_taken_when_the_launcher_left_stdout_closed(tmp_path: Path) -> None:
    log = tmp_path / "lane.log"
    subprocess.run([sys.executable, "-c", CLOSED, str(log)], check=True,
                   stdin=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
    assert "still writes" in log.read_text(encoding="utf-8")


def test_the_lane_appends_its_own_and_its_steps_output_to_its_log(tmp_path: Path) -> None:
    log = tmp_path / "state" / "lane.log"
    log.parent.mkdir()
    log.write_text("an earlier run\n", encoding="utf-8")
    subprocess.run(
        [sys.executable, "-c", WRITES, str(log)],
        check=True,
        stdout=subprocess.DEVNULL,  # What a scheduled task or a detached start leaves it.
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    lines = log.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "an earlier run"
    assert {"lane out", "lane err", "step out", str(log)} <= set(lines[1:])
    assert LANE_LOG_ENV == "BOTCORE_FACTORY_LANE_LOG"


# A process on its own console sends Ctrl+C or Ctrl+Break to every process on it (group 0), as a
# step the lane runs may: it survives only when it handles console control events. Run-7 of
# #2836 ignored Ctrl+C alone and died of one.
INTERRUPTED = """
import ctypes, sys, time
from botcore_factory.lane_main import ignore_console_interrupt
if sys.argv[1] == "ignore":
    assert ignore_console_interrupt()
else:
    ctypes.windll.kernel32.SetConsoleCtrlHandler(None, False)
ctypes.windll.kernel32.GenerateConsoleCtrlEvent(int(sys.argv[2]), 0)
time.sleep(2)
print("survived")
"""


@pytest.mark.skipif(sys.platform != "win32", reason="console control events are Windows-only")
@pytest.mark.parametrize("event", [0, 1], ids=["ctrl-c", "ctrl-break"])
@pytest.mark.parametrize(("mode", "survives"), [("ignore", True), ("default", False)])
def test_a_console_control_event_does_not_stop_the_windows_lane(
    mode: str, survives: bool, event: int
) -> None:
    hidden = subprocess.STARTUPINFO()
    hidden.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    hidden.wShowWindow = 0  # SW_HIDE
    done = subprocess.run(
        [sys.executable, "-c", INTERRUPTED, mode, str(event)],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=60,
        # Its own console, so the event reaches nothing of this test run.
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        startupinfo=hidden,
    )
    assert ("survived" in done.stdout) is survives, done.stderr
    assert (done.returncode == 0) is survives
    if survives and event == 1:  # Ctrl+C is ignored before any handler sees it.
        assert "ignored console control event 1 (Ctrl+Break)" in done.stderr


# A step the lane starts as run_process does (no process group of its own), in the lane's
# console when a Ctrl+C reaches it: it inherits the lane's ignoring of Ctrl+C and finishes.
STEP_UNDER_LANE = """
import ctypes, subprocess, sys
from botcore_factory.lane_main import ignore_console_interrupt
assert ignore_console_interrupt()
step = subprocess.Popen([sys.executable, "-c",
                         "import time; time.sleep(3); print('step finished')"])
import time; time.sleep(1)
ctypes.windll.kernel32.GenerateConsoleCtrlEvent(0, 0)
sys.exit(step.wait())
"""


@pytest.mark.skipif(sys.platform != "win32", reason="console control events are Windows-only")
def test_a_step_the_lane_runs_outlives_a_console_ctrl_c() -> None:
    hidden = subprocess.STARTUPINFO()
    hidden.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    hidden.wShowWindow = 0  # SW_HIDE
    done = subprocess.run(
        [sys.executable, "-c", STEP_UNDER_LANE],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=60,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        startupinfo=hidden,
    )
    assert done.returncode == 0 and "step finished" in done.stdout, done.stderr
