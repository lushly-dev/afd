#include "afd/schema.hpp"

#include <fstream>
#include <iterator>
#include <string>

#include <doctest.h>

namespace {

afd::CompiledSchema compile(const afd::Json& schema) {
    auto compiled = afd::CompiledSchema::compile(schema);
    REQUIRE_MESSAGE(compiled.has_value(), compiled.error());
    return *compiled;
}

// The todo-create input schema from packages/examples/todo/spec/commands.schema.json.
const afd::Json todo_create = afd::Json::parse(R"({
    "type": "object",
    "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 200},
        "description": {"type": "string", "maxLength": 1000},
        "priority": {"$ref": "#/definitions/Priority", "default": "medium"}
    },
    "required": ["title"],
    "definitions": {"Priority": {"type": "string", "enum": ["low", "medium", "high"]}}
})");

} // namespace

TEST_CASE("compile rejects keywords outside the supported subset") {
    for (const char* keyword : {"pattern", "format", "const", "oneOf", "anyOf", "allOf", "not"}) {
        CAPTURE(keyword);
        const afd::Json schema = {{"type", "object"},
                                  {"properties", {{"name", {{"type", "string"}, {keyword, "x"}}}}}};
        const auto compiled = afd::CompiledSchema::compile(schema);
        REQUIRE_FALSE(compiled.has_value());
        CHECK(compiled.error() == "#/properties/name/" + std::string(keyword) +
                                      ": unsupported JSON Schema keyword '" + keyword +
                                      "' (afd-cpp enforces a subset; see afd/schema.hpp)");
    }
}

TEST_CASE("compile checks referenced definitions and ignores unreferenced ones") {
    const afd::Json unused = {
        {"type", "object"},
        {"definitions", {{"Output", {{"type", "string"}, {"format", "date-time"}}}}}};
    CHECK(afd::CompiledSchema::compile(unused).has_value());
    const afd::Json used = {
        {"$ref", "#/definitions/Output"},
        {"definitions", {{"Output", {{"type", "string"}, {"format", "date-time"}}}}}};
    const auto compiled = afd::CompiledSchema::compile(used);
    REQUIRE_FALSE(compiled.has_value());
    CHECK(compiled.error().find("#/definitions/Output/format: unsupported") == 0);
    // A recursive schema is checked once, not forever.
    const afd::Json tree = afd::Json::parse(R"({"$ref":"#/definitions/Node","definitions":{"Node":
        {"type":"object","properties":{"children":{"type":"array","items":{"$ref":"#/definitions/Node"}}}}}})");
    CHECK(afd::CompiledSchema::compile(tree).has_value());
}

TEST_CASE("compile rejects broken and remote references") {
    CHECK_FALSE(afd::CompiledSchema::compile({{"$ref", "#/definitions/Missing"}}).has_value());
    CHECK_FALSE(afd::CompiledSchema::compile({{"$ref", "https://example.com/schema"}}).has_value());
    const afd::Json cycle = {{"$ref", "#/definitions/A"},
                             {"definitions", {{"A", {{"$ref", "#/definitions/A"}}}}}};
    CHECK_FALSE(afd::CompiledSchema::compile(cycle).has_value());
}

TEST_CASE("every todo input schema compiles with its shared definitions") {
    std::ifstream in(AFD_TODO_SPEC_DIR "/commands.schema.json", std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    const auto spec = afd::parse_bounded(text);
    REQUIRE(spec.has_value());
    const auto& commands = spec->at("commands");
    REQUIRE(commands.size() == 11);
    for (auto it = commands.begin(); it != commands.end(); ++it) {
        CAPTURE(it.key());
        afd::Json schema = it.value().at("input");
        schema["definitions"] = spec->at("definitions");
        const auto compiled = afd::CompiledSchema::compile(schema);
        CHECK_MESSAGE(compiled.has_value(), (compiled.has_value() ? "" : compiled.error()));
    }
}

TEST_CASE("validate applies defaults and strips undeclared members, as Zod does") {
    const auto schema = compile(todo_create);
    const auto parsed = schema.validate({{"title", "Buy milk"}, {"extra", 1}});
    REQUIRE(parsed.has_value());
    CHECK(*parsed == afd::Json{{"title", "Buy milk"}, {"priority", "medium"}});
}

TEST_CASE("a missing required field reports the TypeScript shape the conformance suite checks") {
    const auto schema = compile(todo_create);
    const auto result = schema.validate({{"priority", "high"}});
    REQUIRE_FALSE(result.has_value());
    const afd::CommandError error = afd::validation_failure_error(result.error());
    CHECK(error.code == "VALIDATION_ERROR");
    CHECK(error.message == "Input validation failed");
    CHECK_FALSE(error.retryable.has_value());
    REQUIRE(error.details.has_value());
    const auto& details = *error.details;
    CHECK(details["missingFields"][0] == "title");
    CHECK(details["errors"][0]["path"] == "title");
    CHECK(details["errors"][0]["code"] == "invalid_type");
    CHECK(details["errors"][0]["expected"] == "string");
    CHECK(details["expectedFields"] == afd::Json{"description", "priority", "title"});
    CHECK_FALSE(details.contains("unexpectedFields"));
    CHECK(error.suggestion ==
          "title: Invalid input: expected string, received undefined. Missing required field(s): "
          "title. Expected fields: description, priority, title");
}

TEST_CASE("wrong types, bounds and enums produce Zod-style issues") {
    const auto schema = compile(todo_create);

    const auto wrong_type = schema.validate({{"title", 123}});
    REQUIRE_FALSE(wrong_type.has_value());
    REQUIRE(wrong_type.error().errors.size() == 1);
    CHECK(wrong_type.error().errors[0].path == "title");
    CHECK(wrong_type.error().errors[0].message ==
          "Invalid input: expected string, received number");

    const auto too_long = schema.validate({{"title", std::string(201, 'x')}});
    REQUIRE_FALSE(too_long.has_value());
    CHECK(too_long.error().errors[0].code == "too_big");
    CHECK(too_long.error().errors[0].message ==
          "Too big: expected string to have <=200 characters");

    // 200 characters is the limit; multi-byte characters count once each.
    std::string accented;
    for (int i = 0; i < 200; ++i) {
        accented += "\xC3\xA9";
    }
    CHECK(schema.validate({{"title", accented}}).has_value());

    const auto empty = schema.validate({{"title", ""}});
    REQUIRE_FALSE(empty.has_value());
    CHECK(empty.error().errors[0].message == "Too small: expected string to have >=1 characters");

    const auto bad_priority = schema.validate({{"title", "x"}, {"priority", "urgent"}});
    REQUIRE_FALSE(bad_priority.has_value());
    CHECK(bad_priority.error().errors[0].path == "priority");
    CHECK(bad_priority.error().errors[0].code == "invalid_value");
    CHECK(bad_priority.error().errors[0].message ==
          "Invalid option: expected one of \"low\"|\"medium\"|\"high\"");
}

TEST_CASE("numbers, integers and arrays") {
    const auto schema = compile(afd::Json::parse(R"({
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            "ratio": {"type": "number", "exclusiveMinimum": 0},
            "ids": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1, "maxItems": 2}
        }
    })"));
    CHECK(schema.validate(afd::Json::object())->at("limit") == 20);
    CHECK(schema.validate({{"limit", 5.0}}).has_value()); // integral float is an integer

    const auto fraction = schema.validate({{"limit", 1.5}});
    REQUIRE_FALSE(fraction.has_value());
    CHECK(fraction.error().errors[0].message == "Invalid input: expected int, received number");

    const auto big = schema.validate({{"limit", 101}});
    REQUIRE_FALSE(big.has_value());
    CHECK(big.error().errors[0].message == "Too big: expected number to be <=100");

    const auto zero = schema.validate({{"ratio", 0}});
    REQUIRE_FALSE(zero.has_value());
    CHECK(zero.error().errors[0].message == "Too small: expected number to be >0");

    const auto items = schema.validate({{"ids", {"a", ""}}});
    REQUIRE_FALSE(items.has_value());
    CHECK(items.error().errors[0].path == "ids.1");

    const auto many = schema.validate({{"ids", {"a", "b", "c"}}});
    REQUIRE_FALSE(many.has_value());
    CHECK(many.error().errors[0].message == "Too big: expected array to have <=2 items");
}

TEST_CASE("additionalProperties controls undeclared members") {
    const auto strict = compile(afd::Json::parse(
        R"({"type":"object","properties":{"a":{"type":"string"}},"additionalProperties":false})"));
    const auto rejected = strict.validate({{"a", "x"}, {"b", 1}, {"c", 2}});
    REQUIRE_FALSE(rejected.has_value());
    CHECK(rejected.error().errors[0].code == "unrecognized_keys");
    CHECK(rejected.error().errors[0].path == "(root)");
    CHECK(rejected.error().errors[0].message == "Unrecognized keys: \"b\", \"c\"");
    CHECK(rejected.error().unexpected_fields == std::vector<std::string>{"b", "c"});

    const auto open = compile(afd::Json::parse(
        R"({"type":"object","properties":{"a":{"type":"string"}},"additionalProperties":true})"));
    CHECK(*open.validate({{"a", "x"}, {"b", 1}}) == afd::Json{{"a", "x"}, {"b", 1}});

    // No declared shape: an object passes through unchanged.
    const auto any = compile({{"type", "object"}});
    CHECK(*any.validate({{"b", 1}}) == afd::Json{{"b", 1}});
}

TEST_CASE("format_validation_errors matches TypeScript") {
    CHECK(afd::format_validation_errors({}) == "No validation errors");
    CHECK(afd::format_validation_errors({{"(root)", "Bad", "custom", std::nullopt}}) == "Bad");
    CHECK(afd::format_validation_errors({{"a", "Bad", "custom", std::nullopt},
                                         {"(root)", "Worse", "custom", std::nullopt}}) ==
          "- a: Bad\n- Worse");
}
