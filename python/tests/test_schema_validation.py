"""Advertised schemas govern all command entry points before middleware."""

import re
from datetime import date, datetime
from uuid import UUID

import pytest
from pydantic import BaseModel, ConfigDict, Field

from afd import ExposeOptions, success
from afd.core.commands import CommandDefinition, create_command_registry
from afd.core.schema_validation import check_schema
from afd.server import create_server


@pytest.mark.parametrize(
    "schema,location",
    [
        (
            {"properties": {"tags": {"type": "array", "uniqueItems": True}}},
            "#/properties/tags/uniqueItems",
        ),
        ({"$defs": {"Nested": {"format": "made-up"}}}, "#/$defs/Nested/format"),
        ({"properties": {"n": {"exclusiveMinimum": True}}}, "#/properties/n/exclusiveMinimum"),
        ({"items": [{"type": "string"}]}, "#/items"),
        ({"type": "unknown"}, "#/type"),
    ],
)
def test_unsupported_schema_fails_at_registration(schema, location):
    registry = create_command_registry()
    with pytest.raises(ValueError, match=re.escape(location)):
        registry.register(
            CommandDefinition(
                name="schema-check",
                description="Check schema",
                input_schema=schema,
                handler=lambda *_: None,
            )
        )
    with pytest.raises(ValueError, match=re.escape(location)):
        create_server("schemas").command(
            name="schema-check", description="Check schema", input_schema=schema
        )(lambda *_: None)


async def test_raw_registry_definition_enforces_schema_without_decorator():
    server = create_server("schemas")
    received = []

    async def handler(value, context):
        received.append(value)
        return success(value)

    server.registry.register(
        CommandDefinition(
            name="raw-check",
            description="Check raw schema",
            input_schema={
                "type": "object",
                "properties": {"n": {"type": "integer", "default": 3}},
                "required": ["n"],
            },
            expose=ExposeOptions(mcp=True),
            handler=handler,
        )
    )
    assert (await server.call_tool("raw-check", {"n": "2"})).error.code == "VALIDATION_ERROR"
    assert received == []
    assert (await server.call_tool("raw-check", {"extra": 1})).data == {"n": 3}
    assert received == [{"n": 3}]


class NativeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    count: int
    done: bool
    identifier: UUID
    day: date
    at: datetime


async def test_pydantic_json_types_are_enforced_without_rejecting_json_native_forms():
    server = create_server("native")
    received = []

    @server.command(name="native-check", description="Check native input", input_schema=NativeInput)
    async def handler(value):
        received.append(value)
        return success(value.model_dump(mode="json"))

    payload = {
        "count": 1.0,
        "done": True,
        "identifier": "123e4567-e89b-12d3-a456-426614174000",
        "day": "2026-10-10",
        "at": "2026-10-10T12:34:00Z",
    }
    assert (await server.execute("native-check", payload)).success
    assert isinstance(received[0].identifier, UUID)
    assert isinstance(received[0].day, date)
    assert isinstance(received[0].at, datetime)
    for change in ({"count": "1"}, {"count": True}, {"done": "true"}, {"done": 1}):
        result = await server.execute("native-check", {**payload, **change})
        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details["errors"][0]["code"] == "invalid_type"
    assert len(received) == 1


async def test_native_array_reports_item_and_length_errors():
    class NativeArray(BaseModel):
        values: list[int] = Field(min_length=2)

    server = create_server("native")

    @server.command(name="array-check", description="Check array", input_schema=NativeArray)
    async def handler(value):
        return success(value)

    result = await server.execute("array-check", {"values": ["wrong"]})
    assert [(item["path"], item["code"]) for item in result.error.details["errors"]] == [
        ("values.0", "invalid_type"),
        ("values", "too_small"),
    ]


@pytest.mark.parametrize("pattern", [r"\p{L}", r"(?P<n>x)", r"(?<=x)y"])
def test_unsupported_regex_dialects_fail_explicitly(pattern):
    with pytest.raises(ValueError, match="Unsupported pattern"):
        check_schema({"type": "string", "pattern": pattern})


async def test_native_defaults_are_not_revalidated_as_present_input():
    class DefaultInput(BaseModel):
        threshold: int = Field(default=1, ge=5)

    server = create_server("native-default")

    @server.command(name="default-check", description="Check default", input_schema=DefaultInput)
    async def handler(value):
        return success(value.model_dump())

    assert (await server.execute("default-check", {})).data == {"threshold": 1}
    assert (
        await server.execute("default-check", {"threshold": 1})
    ).error.code == "VALIDATION_ERROR"


@pytest.mark.parametrize("keyword", ["anyOf", "oneOf", "allOf"])
async def test_combiner_sibling_types_are_enforced(keyword):
    server = create_server("sibling-types")

    @server.command(
        name="sibling-check",
        description="Check sibling constraints",
        input_schema={
            "type": "object",
            "properties": {"value": {"type": "string", keyword: [{"minLength": 2}]}},
        },
    )
    async def handler(value):
        return success(value)

    assert (await server.execute("sibling-check", {"value": "ok"})).success
    assert (await server.execute("sibling-check", {"value": 5})).error.code == "VALIDATION_ERROR"


async def test_all_of_strips_unknown_keys_from_each_branch():
    server = create_server("intersection")

    @server.command(
        name="intersection-check",
        description="Check intersection",
        input_schema={
            "allOf": [
                {"type": "object", "properties": {"a": {"type": "integer"}}},
                {"type": "object", "properties": {"b": {"type": "string"}}},
            ]
        },
    )
    async def handler(value):
        return success(value)

    assert (await server.execute("intersection-check", {"a": 1, "b": "x", "extra": 2})).data == {
        "a": 1,
        "b": "x",
    }


@pytest.mark.parametrize(
    "pattern,value,valid",
    [
        ("^.$", "😀", False),
        ("^.$", "x", True),
        ("^x$", "x\n", False),
        ("^.$", "\r", False),
        (r"^\s$", "\u00a0", True),
        (r"^\S$", "\u00a0", False),
        (r"^[\s]+$", "\u00a0", True),
    ],
)
def test_pattern_uses_ecmascript_units_anchors_and_classes(pattern, value, valid):
    from afd.core.schema_registration import pattern_matches

    assert pattern_matches(pattern, value) is valid


@pytest.mark.parametrize("reference_keyword", ["$defs", "definitions"])
@pytest.mark.parametrize(
    "constraint,accepted,rejected,code",
    [
        ({"type": "number", "minimum": 5}, 5, 1, "too_small"),
        ({"type": "string", "minLength": 2}, "ab", "a", "too_small"),
        ({"type": "integer", "maximum": 5}, 5, 6, "too_big"),
        ({"type": "string", "pattern": "^a"}, "ab", "xb", "invalid_format"),
    ],
)
def test_reference_sibling_constraints_are_enforced(
    reference_keyword, constraint, accepted, rejected, code
):
    from afd.core.schema_validation import SchemaValidationError, validate_schema

    kind = constraint["type"]
    schema = {
        reference_keyword: {"value": {"type": kind}},
        "$ref": f"#/{reference_keyword}/value",
        **constraint,
    }
    check_schema(schema)
    assert validate_schema(schema, accepted) == accepted
    with pytest.raises(SchemaValidationError) as caught:
        validate_schema(schema, rejected)
    assert caught.value.issues[0]["code"] == code
    assert caught.value.issues[0]["path"] == "(root)"


@pytest.mark.parametrize(
    "schema",
    [
        {"type": "object", "required": ["x"]},
        {"type": "object", "properties": {}, "required": ["x"]},
        {"type": "object", "properties": {"x": {}}, "required": ["x"]},
        {
            "type": "object",
            "properties": {"x": {"description": "Any JSON value"}},
            "required": ["x"],
        },
    ],
)
def test_required_unconstrained_or_undeclared_property_must_exist(schema):
    from afd.core.schema_validation import SchemaValidationError, validate_schema

    check_schema(schema)
    with pytest.raises(SchemaValidationError) as caught:
        validate_schema(schema, {})
    assert caught.value.issues == [
        {
            "path": "x",
            "code": "invalid_type",
            "expected": "nonoptional",
            "message": "Invalid input: expected nonoptional, received undefined",
        }
    ]
    # Present null is allowed by an unconstrained schema and counts as present.
    validate_schema(schema, {"x": None})


def test_required_unconstrained_reference_and_nested_items_cannot_accept_missing():
    from afd.core.schema_validation import SchemaValidationError, validate_schema

    schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {"x": {"$ref": "#/$defs/any"}},
            "required": ["x"],
        },
        "$defs": {"any": {}},
    }
    check_schema(schema)
    with pytest.raises(SchemaValidationError) as caught:
        validate_schema(schema, [{}, {"x": None}])
    assert [item["path"] for item in caught.value.issues] == ["0.x"]


def test_reference_sibling_object_properties_are_validated_and_stripped():
    from afd.core.schema_validation import SchemaValidationError, validate_schema

    schema = {
        "$defs": {"object": {"type": "object", "properties": {"a": {"type": "integer"}}}},
        "$ref": "#/$defs/object",
        "properties": {"b": {"type": "string"}},
        "required": ["b"],
    }
    assert validate_schema(schema, {"a": 1, "b": "x", "extra": True}) == {"a": 1, "b": "x"}
    with pytest.raises(SchemaValidationError) as caught:
        validate_schema(schema, {"a": 1})
    assert caught.value.issues[0]["path"] == "b"


def test_independent_reference_siblings_do_not_share_cycle_markers():
    from afd.core.schema_validation import validate_schema

    schema = {
        "$defs": {"n": {"type": "number"}},
        "$ref": "#/$defs/n",
        "allOf": [{"$ref": "#/$defs/n"}],
    }
    check_schema(schema)
    assert validate_schema(schema, 5) == 5


async def test_independent_reference_siblings_pass_mcp_boundary():
    server = create_server("reference-siblings")

    @server.command(
        name="reference-check",
        description="Repeated independent references",
        input_schema={
            "$defs": {"n": {"type": "number"}},
            "$ref": "#/$defs/n",
            "allOf": [{"$ref": "#/$defs/n"}],
        },
        expose=ExposeOptions(mcp=True),
    )
    async def handler(value):
        return success(value)

    assert (await server.call_tool("reference-check", 5)).data == 5


@pytest.mark.parametrize("declared", [False, True])
async def test_missing_fields_include_required_names_without_property_schema(declared):
    server = create_server("missing-fields")
    properties = {"defaulted": {"type": "integer", "default": 3}}
    if declared:
        properties["x"] = {}

    @server.command(
        name="required-check",
        description="Require arbitrary JSON value",
        input_schema={"type": "object", "properties": properties, "required": ["x", "defaulted"]},
        expose=ExposeOptions(mcp=True),
    )
    async def handler(value):
        return success(value)

    result = await server.call_tool("required-check", {})
    assert result.error.details["missingFields"] == ["x"]
    assert "Missing required field(s): x" in result.error.suggestion


async def test_core_registry_validates_raw_schema_before_recording_handler():
    registry = create_command_registry()
    calls = []

    async def handler(value, context):
        calls.append(value)
        return success(value)

    registry.register(
        CommandDefinition(
            name="core-check",
            description="Validate raw core call",
            input_schema={
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "defaulted": {"type": "integer", "minimum": 5, "default": 1},
                },
                "required": ["n", "defaulted"],
            },
            handler=handler,
        )
    )
    invalid = await registry.execute("core-check", {"n": "bad", "extra": True})
    assert invalid.error.code == "VALIDATION_ERROR"
    assert invalid.error.details["errors"][0]["expected"] == "number"
    assert invalid.error.details["unexpectedFields"] == ["extra"]
    assert "missingFields" not in invalid.error.details
    assert calls == []
    result = await registry.execute("core-check", {"n": 5, "extra": True})
    assert result.data == {"n": 5, "defaulted": 1}
    assert calls == [{"n": 5, "defaulted": 1}]


async def test_core_registry_keeps_decorated_native_default_conversion():
    from afd.server.decorators import command_to_definition, define_command

    class Input(BaseModel):
        value: int = Field(default=1, ge=5)

    @define_command(
        name="native-default", description="Use native default once", input_schema=Input
    )
    async def handler(value):
        return success(value.model_dump())

    registry = create_command_registry()
    registry.register(command_to_definition(handler))
    assert (await registry.execute("native-default", {})).data == {"value": 1}
    assert (
        await registry.execute("native-default", {"value": "bad"})
    ).error.code == "VALIDATION_ERROR"


async def test_core_registry_validator_exception_cannot_invoke_handler():
    calls = []
    registry = create_command_registry()

    async def handler(value, context):
        calls.append(value)
        return success(value)

    registry.register(
        CommandDefinition(
            name="recursive-check",
            description="Non-progressing recursive schema",
            input_schema={"$ref": "#"},
            handler=handler,
        )
    )
    result = await registry.execute("recursive-check", {})
    assert result.error.code == "VALIDATION_ERROR"
    assert calls == []
