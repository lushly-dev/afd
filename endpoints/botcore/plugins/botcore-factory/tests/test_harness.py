"""The scenario harness's CLI contract, in process."""

from __future__ import annotations

import json

import pytest
from conftest import REPO_ROOT, fixture

from botcore_factory import harness


@pytest.fixture
def cli(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv(harness.RUN_DIR_ENV, str(tmp_path / "run"))
    monkeypatch.setenv(harness.TARGET_ENV, str(REPO_ROOT))

    def call(command: str, arguments=None) -> tuple[int, dict]:
        argv = ["call", command]
        if arguments is not None:
            argv.append(arguments if isinstance(arguments, str) else json.dumps(arguments))
        code = harness.main([*argv, "--format", "json"])
        return code, json.loads(capsys.readouterr().out)

    return call


def test_a_run_applies_its_fixture_then_calls_kebab_case_commands(cli):
    code, applied = cli("fixture-apply", {"fixture": fixture("backlog")})
    assert (
        code == 0 and "issues" in applied["data"]["world"] and "cells" in applied["data"]["state"]
    )
    code, checked = cli("issue-check")
    assert code == 0 and checked["data"]["dispatchable"] == [206, 201]
    code, registered = cli("cell-register", {"branch": "fix/a", "issues": [206], "route": "r"})
    assert code == 0 and registered["data"]["cell"]["plan"] == "plan-a"
    code, again = cli("issue_check")  # The Python name works too; the write persisted.
    assert again["data"]["dispatchable"] == [201]
    code, refused = cli("cell-register", {"branch": "fix/b", "issues": [205], "route": "r"})
    assert code == 1 and refused["error"]["code"] == "ALREADY_CLAIMED"


def test_a_command_before_the_fixture_is_refused(cli):
    code, result = cli("issue-check")
    assert code == 1 and result["error"]["code"] == "NOT_FOUND"
    assert "fixture-apply" in result["error"]["suggestion"]


@pytest.mark.parametrize(
    "command,arguments,code_name",
    [
        ("fixture-apply", {}, "VALIDATION_ERROR"),
        ("fixture-apply", {"fixture": {"mystery": 1}}, "VALIDATION_ERROR"),
        ("issue-check", "[1]", "VALIDATION_ERROR"),
        ("issue-check", "{not json", "VALIDATION_ERROR"),
    ],
)
def test_bad_input_is_a_command_result(cli, command, arguments, code_name):
    code, result = cli(command, arguments)
    assert code == 1 and result["error"]["code"] == code_name


def test_a_run_directory_is_required(monkeypatch, capsys):
    monkeypatch.delenv(harness.RUN_DIR_ENV, raising=False)
    assert harness.main(["call", "issue-check"]) == 1
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "NOT_CONFIGURED"
