"""Tests for Alfred's Health 1.0 trend measures producer and CLI integration."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from afd import success
from click.testing import CliRunner

from alfred.cli import main
from alfred.measures import (
    MEASURES_SCHEMA_VERSION,
    build_measures_document,
    measures_from_lint,
    measures_from_parity,
    measures_from_quality,
    write_measures_file,
)


def test_measures_extractors_and_document_contract(tmp_path):
    lint_data = {
        "passed": True,
        "files_checked": 42,
        "error_count": 0,
        "warning_count": 3,
        "suppressed": {"total": 5, "by_rule": {}, "by_reason": {}},
    }
    parity_data = {
        "name_gaps": 11,
        "wire_fixtures": {"gaps": 0},
        "vectors": {"gaps": 2},
        "contract_version": {"gaps": 0},
        "total_gaps": 13,
    }
    quality_data = {
        "commands_scanned": 28,
        "issue_count": 1,
        "warning_count": 4,
    }
    doc = build_measures_document(
        lint=lint_data,
        parity=parity_data,
        quality=quality_data,
        target="afd",
    )
    assert doc["schema_version"] == MEASURES_SCHEMA_VERSION
    assert doc["source"] == "alfred"
    assert doc["target"] == "afd"
    by_key = {row["key"]: row for row in doc["measures"]}
    assert by_key["alfred_lint_files_checked"]["value"] == 42
    assert by_key["alfred_lint_errors"]["value"] == 0
    assert by_key["alfred_lint_warnings"]["value"] == 3
    assert by_key["alfred_lint_suppressed"]["value"] == 5
    assert by_key["alfred_parity_gaps"]["value"] == 13
    assert by_key["alfred_parity_name_gaps"]["value"] == 11
    assert by_key["alfred_parity_wire_gaps"]["value"] == 0
    assert by_key["alfred_parity_vector_gaps"]["value"] == 2
    assert by_key["alfred_parity_contract_gaps"]["value"] == 0
    assert by_key["alfred_commands_scanned"]["value"] == 28
    assert by_key["alfred_quality_issues"]["value"] == 1
    assert by_key["alfred_quality_warnings"]["value"] == 4
    assert len(by_key) == len(doc["measures"])

    out = write_measures_file(tmp_path / "nested/alfred.measures.json", doc)
    assert json.loads(out.read_text(encoding="utf-8")) == doc


def test_measures_rejects_invalid_identifiers_and_values():
    with pytest.raises(ValueError, match="identifier"):
        build_measures_document(lint={}, target="bad target!")
    with pytest.raises(ValueError, match="identifier"):
        build_measures_document(lint={}, source="bad/source")
    with pytest.raises(ValueError, match="finite number"):
        measures_from_lint({"error_count": True})
    with pytest.raises(ValueError, match="finite number"):
        measures_from_parity({"total_gaps": float("nan")})
    with pytest.raises(ValueError, match="safe IEEE-754"):
        measures_from_quality({"issue_count": 1 << 54})


def _make_native_workspace(tmp_path: Path) -> Path:
    workspace = tmp_path / "repo"
    (workspace / "packages/core/src").mkdir(parents=True)
    (workspace / "packages/core/src/index.ts").write_text("export const x = 1;\n", encoding="utf-8")
    (workspace / "spec").mkdir()
    (workspace / "spec/VERSION").write_text("1.0.0\n", encoding="utf-8")
    return workspace


def test_cli_measures_external_output_and_workspace_write_guard(tmp_path):
    workspace = _make_native_workspace(tmp_path)
    external_dir = tmp_path / "external-out"
    out_all = external_dir / "alfred.json"
    out_parity = external_dir / "parity.json"
    inside_workspace = workspace / "packages/core/src/index.ts"

    async def fake_parity(_path=None):
        return success(
            data={
                "name_gaps": 4,
                "wire_fixtures": {"gaps": 0},
                "vectors": {"gaps": 0},
                "contract_version": {"gaps": 0},
                "total_gaps": 4,
            }
        )

    runner = CliRunner()
    with patch("alfred.host.alfred_parity", side_effect=fake_parity):
        # Under default inspection profile, writing outside workspace succeeds and exits 0.
        res = runner.invoke(
            main,
            [
                "--workspace",
                str(workspace),
                "measures",
                "--measures-out",
                str(out_all),
                "--measures-target",
                "afd-root",
            ],
        )
        assert res.exit_code == 0, res.output
        doc = json.loads(out_all.read_text(encoding="utf-8"))
        assert doc["schema_version"] == "1.0"
        assert doc["target"] == "afd-root"
        keys = {row["key"]: row["value"] for row in doc["measures"]}
        assert keys["alfred_parity_gaps"] == 4
        assert "alfred_lint_errors" in keys
        assert "alfred_quality_issues" in keys

        # `--only` limits emitted measures to the selected checks.
        res_only = runner.invoke(
            main,
            ["--workspace", str(workspace), "measures", "--only", "parity"],
        )
        assert res_only.exit_code == 0, res_only.output
        only_keys = {row["key"] for row in json.loads(res_only.output)["measures"]}
        assert "alfred_parity_gaps" in only_keys
        assert "alfred_lint_errors" not in only_keys

        # Invalid `--measures-target` fails cleanly.
        res_bad_target = runner.invoke(
            main,
            ["--workspace", str(workspace), "measures", "--measures-target", "bad target!"],
        )
        assert res_bad_target.exit_code != 0
        assert "identifier" in res_bad_target.output

        # Default inspection profile MUST refuse writing inside the inspected workspace.
        res_refused_measures = runner.invoke(
            main,
            ["--workspace", str(workspace), "measures", "--out", str(inside_workspace)],
        )
        assert res_refused_measures.exit_code != 0
        assert "trusted-local" in res_refused_measures.output
        assert inside_workspace.read_text(encoding="utf-8") == "export const x = 1;\n"

        res_refused_alias = runner.invoke(
            main,
            ["--workspace", str(workspace), "parity", "--measures-out", str(inside_workspace)],
        )
        assert res_refused_alias.exit_code != 0
        assert "trusted-local" in res_refused_alias.output
        assert inside_workspace.read_text(encoding="utf-8") == "export const x = 1;\n"

        # With `--profile trusted-local`, writing inside the workspace is permitted.
        in_ws_out = workspace / "reports/alfred.json"
        res_trusted = runner.invoke(
            main,
            [
                "--workspace",
                str(workspace),
                "--profile",
                "trusted-local",
                "measures",
                "--out",
                str(in_ws_out),
            ],
        )
        assert res_trusted.exit_code == 0, res_trusted.output
        assert json.loads(in_ws_out.read_text(encoding="utf-8"))["schema_version"] == "1.0"

        # `alfred parity --measures-out` writes external file even when exiting 1 on gaps.
        res_parity = runner.invoke(
            main,
            ["--workspace", str(workspace), "parity", "--measures-out", str(out_parity)],
        )
        assert res_parity.exit_code == 1
        parity_doc = json.loads(out_parity.read_text(encoding="utf-8"))
        assert parity_doc["schema_version"] == "1.0"
        assert {row["key"]: row["value"] for row in parity_doc["measures"]}[
            "alfred_parity_gaps"
        ] == 4
