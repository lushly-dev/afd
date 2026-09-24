"""Testing tools stay inside the project and evaluate the wire form.

scenario-create and scenario-evaluate take agent-controlled paths, so they
must not write or read outside the project root; the YAML header must not be
injectable; and scenarios are evaluated against the JSON a client receives.
"""

import os
import sys

import pytest
import yaml

from afd import success
from afd.testing.commands import coverage, evaluate, list as list_command, suggest
from afd.testing.commands._files import find_scenario_files
from afd.testing.commands.create import scenario_create
from afd.testing.commands.evaluate import scenario_evaluate
from afd.testing.mcp.server import create_mcp_testing_server
from afd.testing.scenarios.executor import InProcessExecutor, InProcessExecutorConfig
from afd.testing.scenarios.types import Expectation, Scenario, Step


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    monkeypatch.chdir(root)
    return root


def _outside_files(tmp_path, project):
    return sorted(
        str(path.relative_to(tmp_path))
        for path in tmp_path.rglob("*")
        if path.is_file() and project not in path.parents
    )


class TestScenarioCreateContainment:
    @pytest.mark.parametrize(
        "directory", ["../outside", "../../tmp-escape", "scenarios/../../outside"]
    )
    def test_directory_that_escapes_the_root_is_rejected(self, tmp_path, project, directory):
        result = scenario_create({"name": "escape", "job": "j", "directory": directory})

        assert result.success is False
        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details == {"field": "directory"}
        assert _outside_files(tmp_path, project) == []

    def test_absolute_directory_outside_the_root_is_rejected(self, tmp_path, project):
        elsewhere = tmp_path / "elsewhere"

        result = scenario_create({"name": "abs", "job": "j", "directory": str(elsewhere)})

        assert result.error.code == "VALIDATION_ERROR"
        assert not elsewhere.exists()

    def test_absolute_directory_inside_the_root_is_allowed(self, project):
        result = scenario_create({"name": "abs", "job": "j", "directory": str(project / "s")})

        assert result.success is True
        assert (project / "s" / "abs.scenario.yaml").exists()

    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
    def test_symlink_to_outside_is_rejected(self, tmp_path, project):
        outside = tmp_path / "outside"
        outside.mkdir()
        os.symlink(outside, project / "linked")

        result = scenario_create({"name": "link", "job": "j", "directory": "linked"})

        assert result.error.code == "VALIDATION_ERROR"
        assert list(outside.iterdir()) == []

    @pytest.mark.parametrize(
        ("name", "filename"),
        [
            ("../../etc/evil", "etc-evil.scenario.yaml"),
            ("My Test_Case", "my-test-case.scenario.yaml"),
            ("create.scenario.yaml", "create.scenario.yaml"),
            ("a/b\\c", "a-b-c.scenario.yaml"),
        ],
    )
    def test_name_cannot_add_path_segments(self, tmp_path, project, name, filename):
        result = scenario_create({"name": name, "job": "j"})

        assert result.success is True
        assert (project / "scenarios" / filename).exists()
        assert _outside_files(tmp_path, project) == []

    def test_name_without_letters_or_digits_is_rejected(self, project):
        result = scenario_create({"name": "../..", "job": "j"})

        assert result.error.code == "VALIDATION_ERROR"

    @pytest.mark.parametrize("breaker", ["\n", "\r", " ", "\x85"])
    def test_newlines_in_the_name_cannot_inject_yaml(self, project, breaker):
        name = f"innocent{breaker}evil: true"

        result = scenario_create({"name": name, "job": "j"})

        path = project / "scenarios" / "innocent-evil-true.scenario.yaml"
        text = path.read_text(encoding="utf-8")
        parsed = yaml.safe_load(text)
        assert "evil" not in parsed
        assert parsed["name"] == name
        assert text.splitlines()[0] == "# JTBD Scenario: innocent evil: true"
        assert result.success is True

    def test_overwritten_is_false_for_a_new_file(self, project):
        first = scenario_create({"name": "fresh", "job": "j", "overwrite": True})
        second = scenario_create({"name": "fresh", "job": "j", "overwrite": True})

        assert first.data["overwritten"] is False
        assert second.data["overwritten"] is True

    def test_mcp_testing_server_uses_its_cwd_as_the_root(self, tmp_path, project):
        root = tmp_path / "configured"
        root.mkdir()
        server = create_mcp_testing_server(cwd=str(root))

        import asyncio

        async def call(args):
            return await server.handle_request(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "scenario-create", "arguments": args},
                }
            )

        ok = asyncio.run(call({"name": "rooted", "job": "j", "directory": "scenarios"}))
        escape = asyncio.run(call({"name": "x", "job": "j", "directory": str(project)}))

        assert (root / "scenarios" / "rooted.scenario.yaml").exists()
        assert not (project / "scenarios").exists()
        assert "VALIDATION_ERROR" in str(escape)
        assert "error" not in ok


class TestScenarioEvaluateContainment:
    async def _handler(self, command, input):
        return success({})

    @pytest.mark.asyncio
    async def test_directory_outside_the_root_is_rejected(self, tmp_path, project):
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "a.scenario.yaml").write_text("name: a\njob: a\nsteps: []\n")

        result = await scenario_evaluate({"handler": self._handler, "directory": str(outside)})

        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details == {"field": "directory"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["../outside/a.scenario.yaml", "/etc/passwd", "notes.txt"])
    async def test_scenario_files_outside_the_root_or_not_scenarios_are_rejected(
        self, tmp_path, project, path
    ):
        (project / "notes.txt").write_text("secret")

        result = await scenario_evaluate({"handler": self._handler, "scenarios": [path]})

        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details == {"field": "scenarios"}


class TestSharedScenarioDiscovery:
    def test_one_finder_for_every_command(self):
        assert (
            list_command.find_scenario_files
            is coverage.find_scenario_files
            is suggest.find_scenario_files
            is evaluate.find_scenario_files
            is find_scenario_files
        )
        for module in (list_command, coverage, suggest, evaluate):
            assert not hasattr(module, "_find_scenario_files")

    def test_finds_yaml_and_yml_and_skips_hidden_and_node_modules(self, tmp_path):
        for relative in [
            "a.scenario.yaml",
            "sub/b.scenario.yml",
            ".hidden/c.scenario.yaml",
            "node_modules/d.scenario.yaml",
            "e.yaml",
        ]:
            path = tmp_path / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("")

        found = [os.path.relpath(p, tmp_path) for p in find_scenario_files(str(tmp_path))]
        top = [os.path.relpath(p, tmp_path) for p in find_scenario_files(str(tmp_path), False)]

        assert found == ["a.scenario.yaml", os.path.join("sub", "b.scenario.yml")]
        assert top == ["a.scenario.yaml"]


class TestScenarioExecutorWireForm:
    @pytest.mark.asyncio
    async def test_results_are_evaluated_in_the_wire_form(self):
        async def handler(command, input):
            return success({"id": "todo-1", "done": None}, undo_command="todo-delete")

        executor = InProcessExecutor(InProcessExecutorConfig(handler=handler))
        result = await executor.execute(
            Scenario(
                name="wire",
                description="d",
                job="wire",
                steps=[
                    Step(command="todo-create", expect=Expectation(success=True, data={"id": "todo-1"})),
                    Step(
                        command="todo-get",
                        input={"undo": "${{ steps[0].undoCommand }}"},
                        expect=Expectation(success=True),
                    ),
                ],
            )
        )

        first = result.step_results[0].command_result
        assert first["undoCommand"] == "todo-delete"
        assert "undo_command" not in first
        assert "reasoning" not in first  # unset fields are omitted, never null
        assert first["data"] == {"id": "todo-1", "done": None}  # null inside data is data
        assert result.outcome == "pass"
