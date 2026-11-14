"""The repository adapter: AFD's block, and what the schema accepts and refuses."""

from __future__ import annotations

import pytest
from botcore.config import load_config
from conftest import REPO_ROOT
from pydantic import ValidationError

from botcore_factory import FactoryPlugin
from botcore_factory.adapter import FactoryConfig


def test_afd_s_botcore_toml_states_where_its_labels_live():
    config = load_config(workspace=REPO_ROOT, discovered_plugins={"factory": FactoryPlugin()})
    adapter = config.plugins["factory"]
    assert isinstance(adapter, FactoryConfig)
    assert adapter.labels == ".github/labels.json"
    assert (REPO_ROOT / adapter.labels).is_file()


def test_every_key_of_the_proposal_parses():
    config = FactoryConfig(
        labels=".github/labels.json",
        validate=["pnpm", "verify"],
        prequeue=[["pnpm", "lint"], ["node", "scripts/check-file-size.mjs"]],
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
    )
    assert config.validate_command == ["pnpm", "verify"]
    assert config.prequeue[1] == ["node", "scripts/check-file-size.mjs"]


@pytest.mark.parametrize(
    "settings,message",
    [
        ({"validate": "pnpm verify"}, "list"),
        ({"validate": []}, "argument list"),
        ({"prequeue": [["pnpm", ""]]}, "argument list"),
        ({"labels": "/etc/labels.json"}, "inside the repository"),
        ({"labels": "../labels.json"}, "inside the repository"),
        ({"labels": "C:/labels.json"}, "inside the repository"),
        ({"gate_paths": [" "]}, "non-empty"),
        ({"trend_issue": 0}, "greater than 0"),
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
