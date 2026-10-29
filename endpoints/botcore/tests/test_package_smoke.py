"""Distribution fixture isolation protects a caller's shared Git checkout."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path


def test_fixture_children_ignore_hook_git_routing(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / "scripts" / "package_smoke.py"
    monkeypatch.syspath_prepend(str(script.parent))
    spec = importlib.util.spec_from_file_location("botcore_package_smoke", script)
    smoke = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke)
    parent = tmp_path / "parent"
    child = tmp_path / "child"
    smoke.run(["git", "init", str(parent)], tmp_path)
    smoke.run(["git", "init", str(child)], tmp_path)
    routing = {
        "GIT_DIR": str(parent / ".git"),
        "GIT_WORK_TREE": str(parent),
        "GIT_INDEX_FILE": str(parent / ".git" / "index"),
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "user.name",
        "GIT_CONFIG_VALUE_0": "Injected hook identity",
    }
    for key, value in routing.items():
        monkeypatch.setenv(key, value)
    (child / "owned.txt").write_text("fixture only\n")
    smoke.run(["git", "add", "owned.txt"], child)
    assert (child / ".git" / "index").exists()
    assert not (parent / ".git" / "index").exists()
    assert smoke.run(["git", "rev-parse", "--show-toplevel"], child).strip() == str(child)
    assert all(os.environ[key] == value for key, value in routing.items())
