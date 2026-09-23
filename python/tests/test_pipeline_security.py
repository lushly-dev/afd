"""Pipeline variable resolution must only follow data, never attributes.

A remote ``afd-pipe`` caller controls every ``$ref`` path. Resolving paths with
``getattr`` let ``$prev.__class__.__init__.__globals__...`` read server process
globals whenever a prior step returned a pydantic model.
"""

import dataclasses
import json
import sys
from typing import Any

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.pipeline import get_nested_value
from afd.direct import DirectClient, SimpleRegistry
from afd.server import create_server

SECRET = "pipeline-secret-7f3a"
GLOBALS_PATH = "__class__.__init__.__globals__.sys.modules.__main__.AFD_TEST_SECRET"


class Profile(BaseModel):
    name: str
    tags: list[str] = []


class EchoInput(BaseModel):
    text: Any = None


@pytest.fixture
def planted_secret(monkeypatch):
    """Plant a secret where the attribute-walking exploit used to find it."""
    monkeypatch.setattr(sys.modules["__main__"], "AFD_TEST_SECRET", SECRET, raising=False)
    return SECRET


def _make_server():
    server = create_server("pipeline-security", tool_strategy="lazy")

    @server.command(
        name="profile-get",
        description="Return a profile model",
        output_schema=Profile,
        expose=ExposeOptions(mcp=True),
    )
    async def profile_get(input):
        return success(Profile(name="Ada", tags=["admin", "ops"]))

    @server.command(
        name="text-echo",
        description="Echo the text input",
        input_schema=EchoInput,
        expose=ExposeOptions(mcp=True),
    )
    async def text_echo(input: EchoInput):
        return success({"text": input.text})

    return server


async def _pipe(server, steps):
    result = await server.call_tool("afd-pipe", {"steps": steps})
    return result, json.dumps(result.model_dump(mode="json"), default=str)


class TestAfdPipeVariableResolution:
    @pytest.mark.asyncio
    async def test_prev_dunder_path_does_not_reach_process_globals(self, planted_secret):
        server = _make_server()

        result, dumped = await _pipe(
            server,
            [
                {"command": "profile-get"},
                {"command": "text-echo", "input": {"text": f"$prev.{GLOBALS_PATH}"}},
            ],
        )

        assert result.steps[1].status == "success"
        assert result.data == {"text": None}
        assert planted_secret not in dumped

    @pytest.mark.asyncio
    async def test_steps_index_dunder_path_does_not_reach_process_globals(self, planted_secret):
        server = _make_server()

        result, dumped = await _pipe(
            server,
            [
                {"command": "profile-get"},
                {"command": "text-echo", "input": {"text": "done"}},
                {"command": "text-echo", "input": {"text": f"$steps[0].{GLOBALS_PATH}"}},
            ],
        )

        assert result.data == {"text": None}
        assert planted_secret not in dumped

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "path",
        [
            "$prev.__class__",
            "$prev.model_config",
            "$prev.model_dump",
            "$prev.__dict__",
            "$first.__class__.__name__",
            "$steps.profile.__class__",
        ],
    )
    async def test_attribute_paths_resolve_to_none(self, path):
        server = _make_server()

        result, _ = await _pipe(
            server,
            [
                {"command": "profile-get", "as": "profile"},
                {"command": "text-echo", "input": {"text": path}},
            ],
        )

        assert result.data == {"text": None}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "condition",
        [
            {"$exists": "$prev.__class__.__init__.__globals__"},
            {"$exists": f"$prev.{GLOBALS_PATH}"},
            {"$eq": ["$prev.__class__.__name__", "Profile"]},
        ],
    )
    async def test_when_condition_over_dunder_path_is_not_an_oracle(
        self, planted_secret, condition
    ):
        # With getattr resolution these conditions were true and the step ran,
        # leaking whether the path exists. They must behave like a missing value.
        server = _make_server()

        result, _ = await _pipe(
            server,
            [
                {"command": "profile-get"},
                {"command": "text-echo", "input": {"text": "ran"}, "when": condition},
            ],
        )

        assert result.steps[1].status == "skipped"

    @pytest.mark.asyncio
    async def test_prev_field_on_pydantic_result_still_resolves(self):
        server = _make_server()

        result, _ = await _pipe(
            server,
            [
                {"command": "profile-get"},
                {
                    "command": "text-echo",
                    "input": {"text": ["$prev.name", "$prev.tags[1]"]},
                },
            ],
        )

        assert result.data == {"text": ["Ada", "ops"]}

    @pytest.mark.asyncio
    async def test_when_condition_on_pydantic_field_still_works(self):
        server = _make_server()

        result, _ = await _pipe(
            server,
            [
                {"command": "profile-get"},
                {
                    "command": "text-echo",
                    "input": {"text": "$prev.name"},
                    "when": {"$eq": ["$prev.name", "Ada"]},
                },
            ],
        )

        assert result.data == {"text": "Ada"}

    @pytest.mark.asyncio
    async def test_step_data_is_stored_unchanged(self):
        server = _make_server()

        result, _ = await _pipe(server, [{"command": "profile-get"}])

        assert isinstance(result.steps[0].data, Profile)


class TestGetNestedValueRules:
    def test_double_underscore_segments_resolve_to_none_even_for_dict_keys(self):
        data = {"__private": 1, "public": {"__x": 2, "__proto__": 3}}
        assert get_nested_value(data, "__private") is None
        assert get_nested_value(data, "public.__x") is None
        assert get_nested_value(data, "public.__proto__") is None

    def test_single_underscore_keys_are_ordinary_json_keys(self):
        # The spec only blocks segments that start with "__".
        data = {"_id": "a1", "public": {"_x": 2}}
        assert get_nested_value(data, "_id") == "a1"
        assert get_nested_value(data, "public._x") == 2

    def test_dataclass_is_read_as_data(self):
        @dataclasses.dataclass
        class Point:
            x: int
            y: int

        assert get_nested_value({"p": Point(1, 2)}, "p.y") == 2
        assert get_nested_value(Point(1, 2), "__class__") is None

    def test_other_objects_resolve_to_none(self):
        class Plain:
            name = "attr"

        assert get_nested_value(Plain(), "name") is None
        assert get_nested_value({"obj": Plain()}, "obj.name") is None

    def test_tuple_and_list_indices(self):
        assert get_nested_value({"t": ("a", "b")}, "t.1") == "b"
        assert get_nested_value({"t": ("a", "b")}, "t[0]") == "a"
        assert get_nested_value({"t": ["a"]}, "t.5") is None


class TestDirectClientPipeResolution:
    @pytest.mark.asyncio
    async def test_direct_pipe_uses_data_only_resolution(self, planted_secret):
        registry = SimpleRegistry()

        @registry.command(name="profile-get")
        async def profile_get():
            return success(Profile(name="Ada"))

        @registry.command(name="text-echo")
        async def text_echo(text: Any = None):
            return success({"text": text})

        client = DirectClient(registry)
        result = await client.pipe(
            [
                {"command": "profile-get", "as": "profile"},
                {"command": "text-echo", "input": {"text": f"$prev.{GLOBALS_PATH}"}},
                {"command": "text-echo", "input": {"text": f"$steps.profile.{GLOBALS_PATH}"}},
                {"command": "text-echo", "input": {"text": "$steps.profile.name"}},
            ]
        )

        assert [step.result.data for step in result.steps[1:]] == [
            {"text": None},
            {"text": None},
            {"text": "Ada"},
        ]

    @pytest.mark.asyncio
    async def test_direct_when_condition_over_dunder_path_is_false(self):
        registry = SimpleRegistry()

        @registry.command(name="profile-get")
        async def profile_get():
            return success(Profile(name="Ada"))

        @registry.command(name="text-echo")
        async def text_echo(text: Any = None):
            return success({"text": text})

        client = DirectClient(registry)
        result = await client.pipe(
            [
                {"command": "profile-get"},
                {"command": "text-echo", "input": {"text": "ran"}, "when": "$prev.__class__"},
            ]
        )

        assert result.steps[1].skipped is True
