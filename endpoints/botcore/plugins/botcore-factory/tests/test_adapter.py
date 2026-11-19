"""The repository adapter: AFD's block, and what the schema accepts and refuses."""

from __future__ import annotations

import pytest
from botcore.config import load_config
from conftest import REPO_ROOT
from pydantic import ValidationError

from botcore_factory import FactoryPlugin
from botcore_factory.adapter import FactoryConfig, matches


def test_afd_s_botcore_toml_states_its_labels_cheap_checks_and_gates():
    config = load_config(workspace=REPO_ROOT, discovered_plugins={"factory": FactoryPlugin()})
    adapter = config.plugins["factory"]
    assert isinstance(adapter, FactoryConfig)
    assert adapter.labels == ".github/labels.json"
    assert (REPO_ROOT / adapter.labels).is_file()
    assert [stage.name for stage in adapter.prequeue] == [
        "lint",
        "typecheck",
        "portability",
        "file-size",
    ]
    for stage in adapter.prequeue:
        script = next((part for part in stage.run if part.startswith("scripts/")), None)
        assert script is None or (REPO_ROOT / script).is_file(), script
    assert matches("scripts/check-file-size.mjs", adapter.gate_paths)
    assert matches(".github/workflows/ci.yml", adapter.gate_paths)
    assert not matches("packages/core/src/index.ts", adapter.gate_paths)
    assert adapter.validate_command == ["pnpm", "verify", "--keep-going"]
    assert (adapter.required_check, adapter.coverage) == ("ci-ok", ["pnpm", "check:all"])
    assert (REPO_ROOT / "scripts/verify-record.mjs").is_file()  # What pre-push accepts.
    assert adapter.review_evidence == [
        "node",
        "scripts/review-record.mjs",
        "verify",
        "--head",
        "{head}",
        "--worktree",
        "{worktree}",
    ]
    assert (REPO_ROOT / "scripts/review-record.mjs").is_file()  # prepare-pr lane mode writes it.
    # Every imported unit's records, and nothing else, are merged rather than ejected (#1410).
    [records] = adapter.regenerate
    assert records.run == ["node", "scripts/provenance-merge.mjs"]
    assert (REPO_ROOT / "scripts/provenance-merge.mjs").is_file()
    for unit in REPO_ROOT.glob("*/*/provenance/adaptations.json"):  # Health has none.
        assert matches(unit.relative_to(REPO_ROOT).as_posix(), records.paths), unit
    assert not matches("endpoints/health/provenance/provenance.json", records.paths)
    assert matches("endpoints/botcore/src/botcore/provenance/adaptations.json", records.paths)
    assert not matches("endpoints/botcore/src/botcore/server.py", records.paths)
    assert matches("scripts/provenance-merge.mjs", adapter.gate_paths)


@pytest.mark.parametrize(
    "path,expected",
    [
        ("scripts/check-file-size.mjs", True),
        ("scripts/affected.mjs", True),
        ("scripts/affected/suites.mjs", True),  # A matched directory covers its files.
        (".github/workflows/a/b.yml", True),
        ("package.json", True),
        ("packages/core/package.json", False),
        ("scripts/checker.mjs", False),
    ],
)
def test_gate_globs(path, expected):
    globs = ["scripts/check-*.mjs", "scripts/affected*", ".github/workflows/**", "package.json"]
    assert matches(path, globs) is expected


def test_every_key_of_the_proposal_parses():
    config = FactoryConfig(
        labels=".github/labels.json",
        validate=["pnpm", "verify"],
        prequeue=[
            {"name": "lint", "run": ["pnpm", "lint"]},
            {"name": "file-size", "run": ["node", "scripts/check-file-size.mjs"]},
        ],
        coverage=["pnpm", "check:all"],
        install=["pnpm", "install", "--frozen-lockfile"],
        required_check="ci-ok",
        gate_paths=["lefthook.yml", ".github/workflows/**"],
        review_evidence=["node", "scripts/verify-record.mjs"],
        receipt=["pnpm", "verify", "--verify"],
        ui_paths=["site/**"],
        screens=["node", "capture.mjs"],
        preview=["node", "preview.mjs"],
        ignore_branches=["changeset-release/*"],
        measure_paths=["endpoints/botcore/plugins/botcore-factory/**"],
        trend_issue=1098,
        base_branch="develop",
    )
    assert config.validate_command == ["pnpm", "verify"]
    assert config.prequeue[1].name == "file-size"
    assert config.base_branch == "develop" and FactoryConfig().base_branch == "main"
    assert config.prequeue[1].run == ["node", "scripts/check-file-size.mjs"]


@pytest.mark.parametrize(
    "settings,message",
    [
        ({"validate": "pnpm verify"}, "list"),
        ({"validate": []}, "argument list"),
        ({"prequeue": [{"name": "lint", "run": ["pnpm", ""]}]}, "argument list"),
        ({"prequeue": [["pnpm", "lint"]]}, "Stage"),
        ({"prequeue": [{"name": "Lint!", "run": ["x"]}]}, "pattern"),
        ({"prequeue": [{"name": "a", "run": ["x"]}, {"name": "a", "run": ["y"]}]}, "unique"),
        ({"labels": "/etc/labels.json"}, "inside the repository"),
        ({"labels": "../labels.json"}, "inside the repository"),
        ({"labels": "C:/labels.json"}, "inside the repository"),
        ({"gate_paths": [" "]}, "non-empty"),
        ({"trend_issue": 0}, "greater than 0"),
        ({"base_branch": "main; rm -rf"}, "pattern"),
        ({"unknown": True}, "Extra inputs"),
    ],
)
def test_the_schema_refuses_shell_strings_escapes_and_unknown_keys(settings, message):
    with pytest.raises(ValidationError, match=message):
        FactoryConfig(**settings)


def test_the_plugin_takes_its_validated_config():
    plugin = FactoryPlugin()
    assert plugin.config_schema() is FactoryConfig
    plugin.configure({"labels": "labels.json"})
    assert plugin._config.labels == "labels.json"
