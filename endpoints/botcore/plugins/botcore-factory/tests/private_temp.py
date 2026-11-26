"""A temporary directory the Windows token store accepts, for tests that build one.

``botcore._windows_security`` refuses a token store under any ancestor a principal other than
SYSTEM, Administrators or the owner can modify, and refuses any grant to another principal on the
store's own folder. Some hosts' ``%TEMP%`` carries such grants (on one lane host, inheritable
Modify for a sandbox group and other accounts; #2696), so every test whose ``tmp_path`` holds a
token store fails there through no fault of the code. When the system temporary directory is
refused, the tests run under a private directory in the user's profile instead, created with the
store's own private ACL.
"""

from __future__ import annotations

import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

PROBE = "botcore-factory-pytest"


def private_temp(system_temp: Path, home: Path, ensure: Callable[[Path], None]) -> Path | None:
    """The directory to use instead of ``system_temp``, or ``None`` when it is accepted.

    ``ensure`` is ``botcore._windows_security.ensure_directory``: it creates missing components
    with a private ACL and raises ``PermissionError`` when an existing one is unsafe. The probe is
    made as pytest makes a ``tmp_path`` (private to the user) with a plain child inside, as the
    gateway makes its data folder, so the check sees what a test's store inherits.
    """
    probe: Path | None = None
    try:
        probe = Path(tempfile.mkdtemp(prefix=f"{PROBE}-", dir=system_temp))  # 0o700, as pytest
        (probe / "data").mkdir()
        ensure(probe / "data")
        return None
    except PermissionError:
        private = home / ".cache" / PROBE
        ensure(private)  # A refusal here is the host's to fix: let it fail the run.
        return private
    finally:
        if probe is not None:
            shutil.rmtree(probe, ignore_errors=True)
