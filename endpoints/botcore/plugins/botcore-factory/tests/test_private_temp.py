"""The Windows tmp_path fallback (``private_temp.py``) with a stand-in for the ACL check."""

from __future__ import annotations

from pathlib import Path

import pytest
from private_temp import PROBE, private_temp


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
