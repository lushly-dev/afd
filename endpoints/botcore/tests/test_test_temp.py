"""The Windows tmp_path fallback (``botcore._test_temp``) with a stand-in for the ACL check."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore import _test_temp
from botcore._test_temp import PROBE, configure_pytest_temp, private_temp


def checker(refused: Path | None):
    made: list[Path] = []

    def ensure(path: Path) -> None:
        if refused is not None and refused in (path, *path.parents):
            raise PermissionError(f"{refused}: Windows token store grants another principal access")
        made.append(path)

    return ensure, made


@pytest.fixture
def temp(tmp_path) -> Path:
    (tmp_path / "Temp").mkdir()
    return tmp_path / "Temp"


def _fake_config(basetemp: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(option=SimpleNamespace(basetemp=basetemp))


def _stub_windows_env(
    monkeypatch: pytest.MonkeyPatch,
    temp: Path,
    home: Path,
    refused: Path | None,
    *,
    os_name: str = "nt",
    env: dict[str, str] | None = None,
):
    ensure, made = checker(refused.resolve() if refused is not None else None)
    monkeypatch.setattr(_test_temp, "os", SimpleNamespace(name=os_name, environ=env or {}))
    monkeypatch.setattr(tempfile, "tempdir", str(temp))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setitem(
        sys.modules, "botcore._windows_security", SimpleNamespace(ensure_directory=ensure)
    )
    return made


def test_an_accepted_system_temp_is_kept_and_the_probe_removed(tmp_path, temp):
    ensure, made = checker(None)
    assert private_temp(temp, tmp_path / "home", ensure) is None
    [checked] = made
    assert checked.parent.parent == temp and checked.parent.name.startswith(PROBE)
    assert list(temp.iterdir()) == []


def test_a_refused_system_temp_moves_to_a_private_folder_in_the_profile(tmp_path, temp):
    ensure, made = checker(temp)
    private = private_temp(temp, tmp_path / "home", ensure)
    assert private == tmp_path / "home" / ".cache" / PROBE
    assert made == [private]
    assert list(temp.iterdir()) == []


def test_a_refused_profile_fails_the_run_rather_than_hiding_it(tmp_path, temp):
    ensure, _ = checker(tmp_path)
    with pytest.raises(PermissionError):
        private_temp(temp, tmp_path / "home", ensure)
    assert list(temp.iterdir()) == []


@pytest.mark.parametrize(
    ("os_name", "basetemp", "env"),
    [
        ("posix", None, {}),
        ("nt", "/explicit/basetemp", {}),
        ("nt", None, {"PYTEST_DEBUG_TEMPROOT": "1"}),
    ],
)
def test_configure_pytest_temp_respects_platform_and_explicit_overrides(
    monkeypatch, tmp_path, temp, os_name, basetemp, env
):
    made = _stub_windows_env(
        monkeypatch, temp, tmp_path / "home", refused=temp, os_name=os_name, env=env
    )
    configure_pytest_temp(_fake_config(basetemp))
    assert tempfile.tempdir == str(temp)
    assert made == []


def test_configure_pytest_temp_keeps_accepted_windows_temp(monkeypatch, tmp_path, temp):
    made = _stub_windows_env(monkeypatch, temp, tmp_path / "home", refused=None)
    configure_pytest_temp(_fake_config())
    assert tempfile.tempdir == str(temp)
    assert len(made) == 1
    assert list(temp.iterdir()) == []


def test_configure_pytest_temp_moves_refused_windows_temp_into_profile(monkeypatch, tmp_path, temp):
    home = tmp_path / "home"
    made = _stub_windows_env(monkeypatch, temp, home, refused=temp)
    configure_pytest_temp(_fake_config())
    expected = home.resolve() / ".cache" / PROBE
    assert tempfile.tempdir == str(expected)
    assert made == [expected]
    assert list(temp.iterdir()) == []


def test_core_conftest_wires_pytest_configure_for_refused_windows_temp(
    request, monkeypatch, tmp_path, temp
):
    conftest_path = (Path(__file__).parent / "conftest.py").resolve()
    conftest = request.config.pluginmanager.get_plugin(str(conftest_path))
    assert conftest is not None and hasattr(conftest, "pytest_configure")

    home = tmp_path / "home"
    _stub_windows_env(monkeypatch, temp, home, refused=temp)
    conftest.pytest_configure(_fake_config())
    assert tempfile.tempdir == str(home.resolve() / ".cache" / PROBE)
