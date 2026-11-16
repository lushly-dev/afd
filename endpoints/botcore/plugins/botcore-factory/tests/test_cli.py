"""The factory's command lines: which checkout they serve and what each host exposes."""

from __future__ import annotations

import json
import os
import subprocess

from botcore.host_surfaces import create_host_cli
from click.testing import CliRunner

from botcore_factory import cli


def _clean_git_env(monkeypatch):
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)


def test_the_checkout_is_the_named_target_first(tmp_path, monkeypatch):
    monkeypatch.setenv(cli.TARGET_ENV, str(tmp_path))
    assert cli.checkout(tmp_path / "elsewhere") == tmp_path.resolve()


def test_the_checkout_is_the_enclosing_worktree(tmp_path, monkeypatch):
    _clean_git_env(monkeypatch)
    monkeypatch.delenv(cli.TARGET_ENV, raising=False)
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)  # noqa: S607
    inner = tmp_path / "a" / "b"
    inner.mkdir(parents=True)
    assert cli.checkout(inner) == tmp_path.resolve()


def test_outside_a_checkout_it_serves_the_working_directory(tmp_path, monkeypatch):
    _clean_git_env(monkeypatch)
    monkeypatch.delenv(cli.TARGET_ENV, raising=False)
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path.parent))
    assert cli.checkout(tmp_path) == tmp_path.resolve()


def test_the_cell_line_offers_only_the_cell_commands(make_run):
    host = make_run("running").host(name="factory-cell")
    result = CliRunner().invoke(create_host_cli(host), ["catalog"])
    assert result.exit_code == 0, result.output
    names = {entry["name"] for entry in json.loads(result.output)}
    assert names == {"issue_check", "lane_enqueue", "lane_status"}


def test_a_refused_call_exits_1_with_the_result(make_run):
    host = make_run("running").host()
    result = CliRunner().invoke(create_host_cli(host), ["call", "dial-get", '{"key": "no.such"}'])
    assert result.exit_code == 1
    assert json.loads(result.output)["error"]["code"] == "NOT_FOUND"
