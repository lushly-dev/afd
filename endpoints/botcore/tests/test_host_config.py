"""A host reads only the plugin sections of the plugins it selects."""

from __future__ import annotations

import warnings
from pathlib import Path

import pytest

from botcore import ExecutionContext, build_host
from botcore.config import load_config

SECTION = '[plugins.elsewhere]\nsetting = "value"\n'


def test_a_host_does_not_warn_about_another_host_s_plugin_section(tmp_path: Path) -> None:
    (tmp_path / "botcore.toml").write_text(SECTION, encoding="utf-8")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        host = build_host("quiet", ExecutionContext(tmp_path))
    assert host.list_command_names()


def test_an_explicit_selection_leaves_other_sections_unvalidated(tmp_path: Path) -> None:
    (tmp_path / "botcore.toml").write_text(SECTION, encoding="utf-8")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        config = load_config(workspace=tmp_path, discovered_plugins={}, selection=True)
    assert config.plugins["elsewhere"] == {"setting": "value"}


def test_every_installed_plugin_still_reports_an_orphan_section(tmp_path: Path) -> None:
    (tmp_path / "botcore.toml").write_text(SECTION, encoding="utf-8")
    with pytest.warns(UserWarning, match="elsewhere.*no matching plugin installed"):
        load_config(workspace=tmp_path, discovered_plugins={})
