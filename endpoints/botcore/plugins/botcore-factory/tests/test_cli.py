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


def test_a_relative_worktree_is_made_absolute(tmp_path):
    out = cli.prepare(["call", "lane-enqueue", '{"worktree": ".", "title": "t"}'], cwd=tmp_path)
    assert out[:2] == ["call", "lane-enqueue"]
    assert json.loads(out[2]) == {"worktree": str(tmp_path.resolve()), "title": "t"}


def test_arguments_can_come_from_a_file(tmp_path):
    args = tmp_path / "enqueue.json"
    args.write_text('﻿{"worktree": "wt"}', encoding="utf-8")  # PowerShell writes a BOM.
    out = cli.prepare(["call", "lane-enqueue", "--args-file", str(args)], cwd=tmp_path)
    assert json.loads(out[2]) == {"worktree": str((tmp_path / "wt").resolve())}


def test_what_it_cannot_read_reaches_the_host_cli_unchanged(tmp_path):
    assert cli.prepare(["catalog"]) == ["catalog"]
    assert cli.prepare(["call", "lane-status"]) == ["call", "lane-status", "{}"]
    assert cli.prepare(["call", "x", "{bad"]) == ["call", "x", "{bad"]
    absolute = json.dumps({"worktree": str(tmp_path)})
    assert cli.prepare(["call", "x", absolute]) == ["call", "x", absolute]


def test_the_checkout_of_a_linked_worktree_is_that_worktree(tmp_path, monkeypatch):
    _clean_git_env(monkeypatch)
    monkeypatch.delenv(cli.TARGET_ENV, raising=False)
    main, linked = tmp_path / "main", tmp_path / "linked"
    git = ["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid"]
    subprocess.run(["git", "init", "-q", str(main)], check=True)  # noqa: S607
    subprocess.run([*git, "-C", str(main), "commit", "-q", "--allow-empty", "-m", "a"], check=True)
    subprocess.run([*git, "-C", str(main), "worktree", "add", "-q", str(linked)], check=True)
    assert cli.checkout(linked) == linked.resolve()


def test_a_utf16_args_file_is_refused_with_how_to_write_it(tmp_path):
    import pytest

    args = tmp_path / "enqueue.json"
    args.write_text('{"worktree": "wt"}', encoding="utf-16")  # PowerShell 5.1's Out-File.
    with pytest.raises(SystemExit, match="Set-Content -Encoding utf8"):
        cli.prepare(["call", "lane-enqueue", "--args-file", str(args)], cwd=tmp_path)
