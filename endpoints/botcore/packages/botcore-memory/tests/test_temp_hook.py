"""Regression for botcore-memory's pytest_configure Windows temp fallback hook (#2713)."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

from botcore import _test_temp
from botcore._test_temp import PROBE


def test_memory_conftest_wires_pytest_configure_for_refused_windows_temp(
    request, monkeypatch, tmp_path
):
    conftest_path = (Path(__file__).parent / "conftest.py").resolve()
    conftest = request.config.pluginmanager.get_plugin(str(conftest_path))
    assert conftest is not None and hasattr(conftest, "pytest_configure")

    temp = tmp_path / "Temp"
    temp.mkdir()
    refused = temp.resolve()
    home = tmp_path / "home"

    def ensure(path: Path) -> None:
        if refused in (path, *path.parents):
            raise PermissionError(f"{refused}: Windows token store grants another principal access")

    monkeypatch.setattr(_test_temp, "os", SimpleNamespace(name="nt", environ={}))
    monkeypatch.setattr(tempfile, "tempdir", str(temp))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setitem(
        sys.modules, "botcore._windows_security", SimpleNamespace(ensure_directory=ensure)
    )

    conftest.pytest_configure(SimpleNamespace(option=SimpleNamespace(basetemp=None)))
    assert tempfile.tempdir == str(home.resolve() / ".cache" / PROBE)
