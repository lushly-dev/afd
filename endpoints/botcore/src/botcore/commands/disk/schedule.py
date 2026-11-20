"""Register the hourly disk job with each platform's own scheduler.

macOS: a LaunchAgent. Windows: a Task Scheduler task for the current user, without elevation,
allowed on battery, its console hidden through conhost's headless mode. Linux: a systemd user
timer, or a crontab line where systemd is not available. Each job runs `botcore disk-run`.
"""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

LABEL = "dev.lushly.botcore-disk"
WINDOWS_TASK = "botcore disk hygiene"
CRON_MARK = "# botcore-disk"


@dataclass
class ScheduleState:
    platform: str
    installed: bool
    where: str | None
    detail: str | None = None

    def as_dict(self) -> dict:
        return {"platform": self.platform, "installed": self.installed,
                "where": self.where, "detail": self.detail}


def _run(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=60,
                          check=False)


def job_command(exe: str) -> list[str]:
    return [exe, "disk-run"]


# ── macOS ───────────────────────────────────────────────────────────────────


def _plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def _macos_install(exe: str, logs: Path, path_env: str) -> ScheduleState:
    plist = _plist_path()
    plist.parent.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    body = {
        "Label": LABEL,
        "ProgramArguments": job_command(exe),
        "StartInterval": 3600,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "LowPriorityIO": True,
        "Nice": 10,
        "EnvironmentVariables": {"PATH": path_env},
        "StandardOutPath": str(logs / "job.log"),
        "StandardErrorPath": str(logs / "job.log"),
    }
    plist.write_bytes(plistlib.dumps(body))
    domain = f"gui/{os.getuid()}"
    _run(["launchctl", "bootout", domain, str(plist)])
    done = _run(["launchctl", "bootstrap", domain, str(plist)])
    for _attempt in range(10):  # bootout of a running job finishes asynchronously
        if done.returncode == 0:
            return ScheduleState("macos", True, str(plist))
        time.sleep(0.5)
        done = _run(["launchctl", "bootstrap", domain, str(plist)])
    return ScheduleState("macos", False, str(plist), done.stderr.strip()[:300])


def _macos_uninstall() -> ScheduleState:
    plist = _plist_path()
    _run(["launchctl", "bootout", f"gui/{os.getuid()}", str(plist)])
    plist.unlink(missing_ok=True)
    return ScheduleState("macos", False, str(plist))


def _macos_state() -> ScheduleState:
    plist = _plist_path()
    loaded = _run(["launchctl", "print", f"gui/{os.getuid()}/{LABEL}"]).returncode == 0
    return ScheduleState("macos", plist.exists() and loaded, str(plist),
                         None if loaded else "not loaded")


# ── Windows ─────────────────────────────────────────────────────────────────


def windows_task_xml(exe: str, user: str) -> str:
    """A task that runs hourly and at logon, as the user, hidden, also on battery."""
    conhost = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "conhost.exe"
    args = f'--headless "{exe}" disk-run'
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>botcore disk hygiene (botcore disk-run)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{escape(user)}</UserId><Delay>PT5M</Delay></LogonTrigger>
    <TimeTrigger>
      <Repetition><Interval>PT1H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{escape(user)}</UserId><LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>{escape(str(conhost))}</Command><Arguments>{escape(args)}</Arguments></Exec>
  </Actions>
</Task>
"""


def _windows_user() -> str:
    domain = os.environ.get("USERDOMAIN")
    user = os.environ.get("USERNAME", "")
    return f"{domain}\\{user}" if domain else user


def _windows_install(exe: str, state: Path) -> ScheduleState:
    state.mkdir(parents=True, exist_ok=True)
    xml = state / "task.xml"
    xml.write_text(windows_task_xml(exe, _windows_user()), encoding="utf-16")
    done = _run(["schtasks", "/Create", "/TN", WINDOWS_TASK, "/XML", str(xml), "/F"])
    if done.returncode != 0:
        return ScheduleState("windows", False, WINDOWS_TASK, (done.stderr or done.stdout)[:300])
    return ScheduleState("windows", True, WINDOWS_TASK)


def _windows_uninstall() -> ScheduleState:
    _run(["schtasks", "/Delete", "/TN", WINDOWS_TASK, "/F"])
    return ScheduleState("windows", False, WINDOWS_TASK)


def _windows_state() -> ScheduleState:
    done = _run(["schtasks", "/Query", "/TN", WINDOWS_TASK])
    return ScheduleState("windows", done.returncode == 0, WINDOWS_TASK)


# ── Linux ───────────────────────────────────────────────────────────────────


def _units() -> tuple[Path, Path]:
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "systemd" / "user"
    return base / "botcore-disk.service", base / "botcore-disk.timer"


def _quote(arg: str) -> str:
    return '"' + arg.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _linux_install(exe: str, path_env: str) -> ScheduleState:
    systemd = shutil.which("systemctl") is not None
    if systemd and _run(["systemctl", "--user", "show-environment"]).returncode == 0:
        service, timer = _units()
        service.parent.mkdir(parents=True, exist_ok=True)
        command = " ".join(_quote(a) for a in job_command(exe))
        service.write_text(
            "[Unit]\nDescription=botcore disk hygiene\n\n[Service]\nType=oneshot\n"
            f"Environment={_quote('PATH=' + path_env)}\nExecStart={command}\nNice=10\n"
            "IOSchedulingClass=idle\n", encoding="utf-8",
        )
        timer.write_text(
            "[Unit]\nDescription=botcore disk hygiene, hourly\n\n[Timer]\nOnBootSec=5min\n"
            "OnUnitActiveSec=1h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n",
            encoding="utf-8",
        )
        _run(["systemctl", "--user", "daemon-reload"])
        done = _run(["systemctl", "--user", "enable", "--now", "botcore-disk.timer"])
        if done.returncode == 0:
            return ScheduleState("linux", True, str(timer))
        timer.unlink(missing_ok=True)  # fall back to cron without leaving half a unit behind
        service.unlink(missing_ok=True)
        _run(["systemctl", "--user", "daemon-reload"])
    command = " ".join(_quote(a) for a in job_command(exe))
    line = f"17 * * * * PATH={_quote(path_env)} {command} {CRON_MARK}"
    current = read_crontab()
    if current is None:
        return ScheduleState("linux", False, None,
                             "no systemd --user, and the crontab could not be read")
    lines = [ln for ln in current.splitlines() if not ln.endswith(CRON_MARK)] + [line]
    done = _run(["crontab", "-"], stdin="\n".join(lines) + "\n")
    detail = done.stderr.strip()[:300] or None
    return ScheduleState("linux", done.returncode == 0, "crontab", detail)


def read_crontab() -> str | None:
    """The user's crontab: "" when they have none, None when it could not be read.

    A failed read must never be taken as an empty table: writing back would erase every job.
    """
    if not shutil.which("crontab"):
        return None
    done = _run(["crontab", "-l"])
    if done.returncode == 0:
        return done.stdout
    if "no crontab" in (done.stderr or "").lower():
        return ""
    return None


def _linux_uninstall() -> ScheduleState:
    service, timer = _units()
    if timer.exists():
        _run(["systemctl", "--user", "disable", "--now", "botcore-disk.timer"])
        timer.unlink(missing_ok=True)
        service.unlink(missing_ok=True)
        _run(["systemctl", "--user", "daemon-reload"])
    current = read_crontab()
    if current and CRON_MARK in current:
        lines = [ln for ln in current.splitlines() if not ln.endswith(CRON_MARK)]
        _run(["crontab", "-"], stdin="\n".join(lines) + ("\n" if lines else ""))
    return ScheduleState("linux", False, None)


def _linux_state() -> ScheduleState:
    _service, timer = _units()
    if timer.exists():
        enabled = _run(["systemctl", "--user", "is-enabled", "botcore-disk.timer"]).returncode == 0
        return ScheduleState("linux", enabled, str(timer))
    if CRON_MARK in (read_crontab() or ""):
        return ScheduleState("linux", True, "crontab")
    return ScheduleState("linux", False, None)


# ── Dispatch ────────────────────────────────────────────────────────────────


def install(exe: str, state: Path, path_env: str) -> ScheduleState:
    if sys.platform == "darwin":
        return _macos_install(exe, state / "logs", path_env)
    if sys.platform == "win32":
        return _windows_install(exe, state)
    return _linux_install(exe, path_env)


def uninstall() -> ScheduleState:
    if sys.platform == "darwin":
        return _macos_uninstall()
    if sys.platform == "win32":
        return _windows_uninstall()
    return _linux_uninstall()


def current() -> ScheduleState:
    if sys.platform == "darwin":
        return _macos_state()
    if sys.platform == "win32":
        return _windows_state()
    return _linux_state()


def run_now() -> None:
    """Start the job once, so a permission prompt appears while the owner is at the machine."""
    if sys.platform == "darwin":
        _run(["launchctl", "kickstart", f"gui/{os.getuid()}/{LABEL}"])
    elif sys.platform == "win32":
        _run(["schtasks", "/Run", "/TN", WINDOWS_TASK])
