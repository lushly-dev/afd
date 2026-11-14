"""The plugin and its two hosts: admission, policies, catalog, docs and isolation."""

from __future__ import annotations

import pytest
from botcore.context import ExecutionContext
from botcore.host import build_host
from botcore.plugin import BotCorePlugin, PluginRegistry, discover_plugins
from conftest import REPO_ROOT

from botcore_factory import CELL_COMMANDS, FactoryPlugin
from botcore_factory.commands import POLICIES
from botcore_factory.lane_commands import LANE_POLICIES

EVERY = sorted(
    [
        "cell_attach",
        "cell_register",
        "dial_get",
        "dial_set",
        "event_resolve",
        "gate_allow",
        "issue_check",
        "lane_drop",
        "lane_enqueue",
        "lane_host_list",
        "lane_host_probe",
        "lane_host_set",
        "lane_pause",
        "lane_report",
        "lane_resume",
        "lane_run",
        "lane_start",
        "lane_status",
        "lane_stop",
        "lane_wait",
        "plan_list",
    ]
)


def test_the_plugin_is_installed_under_factory_and_admitted_to_hosts():
    plugin = discover_plugins(("factory",))["factory"]
    assert isinstance(plugin, FactoryPlugin) and isinstance(plugin, BotCorePlugin)
    assert plugin.host_context_safe is True


def test_the_plugin_registers_commands_policies_and_a_docs_topic():
    registry = PluginRegistry()
    FactoryPlugin().register(registry)
    assert sorted(command.__name__ for command in registry.commands) == EVERY
    assert registry.policies == {**POLICIES, **LANE_POLICIES}
    assert "issue_check(numbers?, limit?, cursor?)" in registry.docs["factory"]


def test_the_factory_host_serves_every_command_and_the_cell_host_a_cell_s(make_run):
    run = make_run()
    assert run.host("factory").list_command_names() == EVERY
    cell = run.host("factory-cell")
    assert cell.list_command_names() == sorted(CELL_COMMANDS)
    assert "factory" in cell.docs


async def test_the_cell_host_refuses_what_cells_may_not_call(make_run):
    run = make_run()
    result = await run.call(
        "cell_register", run.host("factory-cell"), branch="b", issues=[101], route="r"
    )
    assert result.error.code == "COMMAND_NOT_FOUND"
    assert (await run.call("lane_status", run.host("factory-cell"))).success


def test_an_unknown_host_name_is_refused(make_run):
    with pytest.raises(ValueError, match="factory-cell"):
        make_run().host("factory-admin")


def test_the_catalog_carries_effects_input_schemas_and_descriptions(make_run):
    rows = {row["name"]: row for row in make_run().host().catalog()}
    assert rows["issue_check"]["effects"] == ["subprocess"]
    assert rows["dial_get"]["effects"] == ["inspect"]
    assert set(rows["cell_register"]["effects"]) == {"subprocess", "service", "history-write"}
    assert rows["dial_set"]["effects_depend_on_arguments"] is True
    schema = rows["cell_register"]["input_schema"]
    assert schema["required"] == ["issues", "branch", "route"]
    assert schema["properties"]["issues"]["type"] == "array"
    assert "cells.issuesMax" in schema["properties"]["issues"]["description"]
    assert rows["issue_check"]["description"].startswith("List untriaged issues")


async def test_an_inspection_host_denies_writes_and_subprocesses_before_they_run(make_run):
    run = make_run()
    host = run.host(profile="inspection")
    before = run.snapshot()
    denied = await run.call("cell_register", host, branch="b", issues=[101], route="r")
    assert denied.error.code == "EFFECT_DENIED"
    assert (await run.call("issue_check", host)).error.code == "EFFECT_DENIED"
    assert (await run.call("dial_get", host, key="cells.max")).success
    assert run.snapshot() == before


async def test_each_host_keeps_its_own_world(make_run):
    first, second = make_run("backlog"), make_run()
    one, two = first.host(), second.host()
    assert (await one.execute("issue_check", {})).data["dispatchable"] == [206, 201]
    assert (await two.execute("issue_check", {})).data["dispatchable"] == [101, 102, 103]


def test_a_plain_build_host_admits_the_plugin_with_its_own_policies():
    host = build_host(
        "factory",
        ExecutionContext(REPO_ROOT, profile="trusted-local"),
        plugins=("factory",),
        core_commands=(),
    )
    assert host.list_command_names() == EVERY
