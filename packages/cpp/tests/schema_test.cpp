#include "afd/afd.hpp"

#include <cmath>
#include <fstream>
#include <iterator>
#include <limits>
#include <string>
#include <utility>
#include <vector>

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

// The same `#/$defs/X` names one definition at the root and another inside a subschema with its
// own `$id`, which starts a schema resource (spec/validation.md, "Annotations"; #1700).
TEST_CASE("a $ref resolves against the nearest schema resource") {
    const afd::Json two = afd::Json::parse(R"({"type":"object","properties":{
        "outer":{"$ref":"#/$defs/X"},
        "inner":{"$id":"urn:afd:inner","type":"object","properties":{"x":{"$ref":"#/$defs/X"}},
                 "$defs":{"X":{"type":"string"}}}},
        "$defs":{"X":{"type":"number"}}})");
    const auto schema = afd::CompiledSchema::compile(two);
    REQUIRE(schema.has_value());
    const afd::Json valid = {{"outer", 1}, {"inner", {{"x", "a"}}}};
    const auto parsed = schema->validate(valid);
    REQUIRE(parsed.has_value());
    CHECK(*parsed == valid);
    const auto inner = schema->validate({{"outer", 1}, {"inner", {{"x", 1}}}});
    REQUIRE_FALSE(inner.has_value());
    REQUIRE(inner.error().errors.size() == 1);
    CHECK(inner.error().errors[0].path == "inner.x");
    const auto outer = schema->validate({{"outer", "a"}});
    REQUIRE_FALSE(outer.has_value());
    REQUIRE(outer.error().errors.size() == 1);
    CHECK(outer.error().errors[0].path == "outer");

    // Each resource's definition is checked, though both references have the same text: `inner`
    // is checked first (keys are sorted), so the root's definition is the one a check keyed by
    // the reference text would skip.
    afd::Json unsupported = two;
    unsupported["$defs"]["X"]["format"] = "date-time";
    CHECK_FALSE(afd::CompiledSchema::compile(unsupported).has_value());
    // A bare fragment `$id`, a draft-07 anchor, starts no resource.
    const auto fragment = afd::CompiledSchema::compile(afd::Json::parse(
        R"({"type":"object","properties":{"inner":{"$id":"#inner","$ref":"#/$defs/X"}},
            "$defs":{"X":{"type":"string"}}})"));
    REQUIRE(fragment.has_value());
    CHECK_FALSE(fragment->validate({{"inner", 1}}).has_value());
    // A reference inside a resource does not reach the root's definitions.
    CHECK_FALSE(
        afd::CompiledSchema::compile(
            afd::Json::parse(
                R"({"type":"object","properties":{"inner":{"$id":"urn:afd:inner","$ref":"#/$defs/X"}},
                        "$defs":{"X":{"type":"string"}}})"))
            .has_value());
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
    REQUIRE(commands.size() == 13);
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

    // Schema-valued additionalProperties validates each undeclared member and applies defaults.
    const auto typed_extra = compile(afd::Json::parse(
        R"({"type":"object","properties":{"a":{"type":"string"}},"additionalProperties":{"type":"object","properties":{"n":{"type":"number","default":1}}}})"));
    const auto extra_ok = typed_extra.validate({{"a", "x"}, {"extra", afd::Json::object()}});
    REQUIRE(extra_ok.has_value());
    CHECK(*extra_ok == afd::Json{{"a", "x"}, {"extra", {{"n", 1}}}});

    const auto extra_bad = typed_extra.validate({{"a", "x"}, {"extra", {{"n", "oops"}}}});
    REQUIRE_FALSE(extra_bad.has_value());
    REQUIRE(extra_bad.error().errors.size() == 1);
    CHECK(extra_bad.error().errors[0].path == "extra.n");
    CHECK(extra_bad.error().errors[0].code == "invalid_type");
}

TEST_CASE("format_validation_errors matches TypeScript") {
    CHECK(afd::format_validation_errors({}) == "No validation errors");
    CHECK(afd::format_validation_errors({{"(root)", "Bad", "custom", std::nullopt}}) == "Bad");
    CHECK(afd::format_validation_errors({{"a", "Bad", "custom", std::nullopt},
                                         {"(root)", "Worse", "custom", std::nullopt}}) ==
          "- a: Bad\n- Worse");
}

TEST_CASE("schema length and item bounds never narrow outside size_t") {
    const std::vector<afd::Json> bounds = {
        1e100, std::uint64_t{4294967296}, (std::numeric_limits<std::uint64_t>::max)(),
        std::ldexp(1.0, std::numeric_limits<std::size_t>::digits)};
    for (const auto& bound : bounds) {
        CAPTURE(bound.dump());
        const auto string_min = compile({{"type", "string"}, {"minLength", bound}});
        const auto array_min = compile({{"type", "array"}, {"minItems", bound}});
        const auto string_max = compile({{"type", "string"}, {"maxLength", bound}});
        const auto array_max = compile({{"type", "array"}, {"maxItems", bound}});
        const auto short_string = string_min.validate("x");
        const auto short_array = array_min.validate(afd::Json::array());
        REQUIRE_FALSE(short_string.has_value());
        REQUIRE_FALSE(short_array.has_value());
        CHECK(short_string.error().errors[0].code == "too_small");
        CHECK(short_array.error().errors[0].code == "too_small");
        CHECK(string_max.validate("x").has_value());
        CHECK(array_max.validate(afd::Json::array()).has_value());
    }
    for (const double bad : {(std::numeric_limits<double>::infinity)(),
                             (std::numeric_limits<double>::quiet_NaN)(), -1.0, 1.5}) {
        CHECK_FALSE(
            afd::CompiledSchema::compile({{"type", "string"}, {"minLength", bad}}).has_value());
    }
    const auto exact = compile({{"type", "string"}, {"minLength", 2.0}, {"maxLength", 2.0}});
    CHECK_FALSE(exact.validate("x").has_value());
    CHECK(exact.validate("xx").has_value());
    CHECK_FALSE(exact.validate("xxx").has_value());
}

TEST_CASE("validation caps issues at default limit and honors explicit max_issues") {
    const auto schema = compile({{"type", "array"}, {"items", {{"type", "string"}}}});
    afd::Json input = afd::Json::array();
    for (int index = 0; index < 120; ++index) {
        input.push_back(index);
    }
    const auto capped = schema.validate(input);
    REQUIRE_FALSE(capped.has_value());
    CHECK(capped.error().errors.size() == afd::default_max_validation_issues);
    CHECK(capped.error().truncated);
    CHECK(capped.error().limit == afd::default_max_validation_issues);
    CHECK(capped.error().total_errors == 120);

    const auto uncapped = schema.validate(input, 150);
    REQUIRE_FALSE(uncapped.has_value());
    CHECK(uncapped.error().errors.size() == 120);
    CHECK_FALSE(uncapped.error().truncated);
}

TEST_CASE("array item issues precede bounds and unknown object keys follow property issues") {
    const auto schema = compile(
        {{"type", "object"},
         {"properties",
          {{"items", {{"type", "array"}, {"minItems", 3}, {"items", {{"type", "string"}}}}}}},
         {"additionalProperties", false}});
    const auto result = schema.validate({{"items", {1, 2}}, {"extra", true}});
    REQUIRE_FALSE(result.has_value());
    const auto& errors = result.error().errors;
    REQUIRE(errors.size() == 4);
    CHECK(errors[0].path == "items.0");
    CHECK(errors[1].path == "items.1");
    CHECK(errors[2].path == "items");
    CHECK(errors[2].code == "too_small");
    CHECK(errors[3].path == "(root)");
    CHECK(errors[3].code == "unrecognized_keys");
}

TEST_CASE("required boolean and untyped properties reject omission through schema and registry") {
    const std::vector<afd::Json> declarations = {true, afd::Json::object(),
                                                 afd::Json{{"description", "untyped"}},
                                                 afd::Json{{"$ref", "#/$defs/Anything"}}};
    for (const auto& declaration : declarations) {
        CAPTURE(declaration.dump());
        const afd::Json raw = {{"type", "object"},
                               {"properties", {{"x", declaration}}},
                               {"required", {"x"}},
                               {"$defs", {{"Anything", true}}}};
        const auto schema = compile(raw);
        const auto missing = schema.validate(afd::Json::object());
        if (missing.has_value()) {
            CHECK_FALSE(missing.has_value());
            continue;
        }
        REQUIRE(missing.error().errors.size() == 1);
        const auto& issue = missing.error().errors.front();
        CHECK(issue.path == "x");
        CHECK(issue.code == "invalid_type");
        CHECK(issue.expected == "nonoptional");
        CHECK(issue.message == "Invalid input: expected nonoptional, received undefined");
        CHECK(missing.error().missing_fields == std::vector<std::string>{"x"});
        CHECK(schema.validate({{"x", nullptr}}).has_value());
        CHECK(schema.validate({{"x", 1}}).has_value());
        bool called = false;
        afd::CommandRegistry registry;
        REQUIRE_FALSE(registry
                          .register_command({.name = "test-required",
                                             .description = "Missing required property",
                                             .input_schema = raw,
                                             .handler =
                                                 [&](const afd::Json& input, afd::CommandContext&) {
                                                     called = true;
                                                     return afd::success(input);
                                                 }})
                          .has_value());
        const auto result = registry.execute("test-required", afd::Json::object());
        REQUIRE_FALSE(result.success);
        REQUIRE(result.error.has_value());
        CHECK(result.error->code == "VALIDATION_ERROR");
        CHECK_FALSE(called);
        CHECK(registry.execute("test-required", {{"x", nullptr}}).success);
        CHECK(called);
    }
    // Names required without a declaration still enforce presence.
    const auto undeclared = compile({{"type", "object"}, {"required", {"x"}}});
    const auto missing = undeclared.validate(afd::Json::object());
    REQUIRE_FALSE(missing.has_value());
    CHECK(missing.error().errors.front().expected == "nonoptional");
    CHECK(undeclared.validate({{"x", nullptr}}).has_value());
    // A schema that permits no values remains rejected for both omitted and present values.
    const auto never =
        compile({{"type", "object"}, {"properties", {{"x", false}}}, {"required", {"x"}}});
    CHECK_FALSE(never.validate(afd::Json::object()).has_value());
    CHECK_FALSE(never.validate({{"x", nullptr}}).has_value());
    // Defaults still fulfill required presence before validation, even on untyped schemas.
    const auto defaulted = compile(
        {{"type", "object"}, {"properties", {{"x", {{"default", 7}}}}}, {"required", {"x"}}});
    const auto filled = defaulted.validate(afd::Json::object());
    REQUIRE(filled.has_value());
    CHECK(*filled == afd::Json{{"x", 7}});
}

TEST_CASE(
    "self-recursive $ref schemas enforce max validation depth without stack overflow (#1719)") {
    const auto wrap_object = [](afd::Json inner) {
        afd::Json wrapper = afd::Json::object();
        wrapper["next"] = std::move(inner);
        return wrapper;
    };
    const auto wrap_array = [](afd::Json inner) {
        afd::Json wrapper = afd::Json::array();
        wrapper.push_back(std::move(inner));
        return wrapper;
    };

    const auto obj_schema =
        compile({{"type", "object"}, {"properties", {{"next", {{"$ref", "#"}}}}}});
    afd::Json shallow_obj = afd::Json::object();
    for (int i = 0; i < 10; ++i) {
        shallow_obj = wrap_object(std::move(shallow_obj));
    }
    CHECK(obj_schema.validate(shallow_obj).has_value());

    // Exact boundary: depth 128 succeeds and preserves the full tree; depth 129 fails too_deep.
    afd::Json boundary_obj = afd::Json::object();
    for (int i = 0; i < 128; ++i) {
        boundary_obj = wrap_object(std::move(boundary_obj));
    }
    const auto boundary_ok = obj_schema.validate(boundary_obj);
    REQUIRE(boundary_ok.has_value());
    const afd::Json* cursor = &*boundary_ok;
    for (int i = 0; i < 128; ++i) {
        REQUIRE(cursor->is_object());
        REQUIRE(cursor->contains("next"));
        cursor = &(*cursor)["next"];
    }
    CHECK(cursor->is_object());
    CHECK(cursor->empty());

    const afd::Json over_boundary_obj = wrap_object(std::move(boundary_obj));
    const auto boundary_err = obj_schema.validate(over_boundary_obj);
    REQUIRE_FALSE(boundary_err.has_value());
    REQUIRE_FALSE(boundary_err.error().errors.empty());
    CHECK(boundary_err.error().errors.front().code == "too_deep");

    afd::Json deep_obj = afd::Json::object();
    for (int i = 0; i < 160; ++i) {
        deep_obj = wrap_object(std::move(deep_obj));
    }
    const auto obj_result = obj_schema.validate(deep_obj);
    REQUIRE_FALSE(obj_result.has_value());
    REQUIRE_FALSE(obj_result.error().errors.empty());
    CHECK(obj_result.error().errors.front().code == "too_deep");

    const auto arr_schema = compile({{"type", "array"}, {"items", {{"$ref", "#"}}}});
    afd::Json boundary_arr = afd::Json::array();
    for (int i = 0; i < 128; ++i) {
        boundary_arr = wrap_array(std::move(boundary_arr));
    }
    const auto arr_boundary_ok = arr_schema.validate(boundary_arr);
    REQUIRE(arr_boundary_ok.has_value());
    const afd::Json* arr_cursor = &*arr_boundary_ok;
    for (int i = 0; i < 128; ++i) {
        REQUIRE(arr_cursor->is_array());
        REQUIRE(arr_cursor->size() == 1);
        arr_cursor = &(*arr_cursor)[0];
    }
    CHECK(arr_cursor->is_array());
    CHECK(arr_cursor->empty());

    const afd::Json over_boundary_arr = wrap_array(std::move(boundary_arr));
    const auto arr_boundary_err = arr_schema.validate(over_boundary_arr);
    REQUIRE_FALSE(arr_boundary_err.has_value());
    REQUIRE_FALSE(arr_boundary_err.error().errors.empty());
    CHECK(arr_boundary_err.error().errors.front().code == "too_deep");

    afd::Json deep_arr = afd::Json::array();
    for (int i = 0; i < 160; ++i) {
        deep_arr = wrap_array(std::move(deep_arr));
    }
    const auto arr_result = arr_schema.validate(deep_arr);
    REQUIRE_FALSE(arr_result.has_value());
    REQUIRE_FALSE(arr_result.error().errors.empty());
    CHECK(arr_result.error().errors.front().code == "too_deep");
}

TEST_CASE("a $ref outside the subset fails at compile (#1910)") {
    // spec/validation.md: only "#", "#/$defs/<name>" and "#/definitions/<name>".
    const auto with_ref = [](const std::string& ref) {
        return afd::Json{
            {"type", "object"},
            {"properties", {{"p", {{"$ref", ref}}}}},
            {"$defs",
             {{"A",
               {{"type", "object"},
                {"$defs", {{"B", {{"type", "string"}}}}},
                {"properties", {{"x", afd::Json::object()}}}}}}},
            {"definitions", {{"A", {{"type", "array"}, {"items", afd::Json::object()}}}}}};
    };
    for (const char* ref : {"#/$defs/A/$defs/B", "#/$defs/A/properties/x", "#/definitions/A/items",
                            "#/properties/p", "#/$defs/", "#/$defs", "#foo"}) {
        CAPTURE(ref);
        const auto compiled = afd::CompiledSchema::compile(with_ref(ref));
        REQUIRE_FALSE(compiled.has_value());
        CHECK(compiled.error().find("is not '#'") != std::string::npos);
    }
    CHECK(afd::CompiledSchema::compile(with_ref("#/$defs/A")).has_value());
    CHECK(afd::CompiledSchema::compile(with_ref("#/definitions/A")).has_value());
    CHECK(afd::CompiledSchema::compile(with_ref("#")).has_value());

    // An escaped name is one name, each escape decoded once.
    for (const auto& [ref, name] : std::vector<std::pair<std::string, std::string>>{
             {"#/$defs/a~1b", "a/b"}, {"#/$defs/a~00", "a~0"}, {"#/$defs/a~01", "a~1"}}) {
        CAPTURE(ref);
        afd::Json defs = {{"a~", {{"type", "number"}}},
                          {"a/", {{"type", "number"}}},
                          {"a~/", {{"type", "number"}}}};
        defs[name] = {{"type", "string"}};
        const auto escaped = afd::CompiledSchema::compile(
            afd::Json{{"properties", {{"p", {{"$ref", ref}}}}}, {"$defs", defs}});
        REQUIRE(escaped.has_value());
        CHECK(escaped->validate({{"p", "s"}}).has_value());
        CHECK_FALSE(escaped->validate({{"p", 1}}).has_value());
    }

    // A bad reference in a definition nothing uses fails, as in Python and Rust.
    for (const char* unused : {R"({"$defs":{"U":{"$ref":"#/properties/p"}}})",
                               R"({"$defs":{"U":{"items":{"$ref":"#/$defs/Missing"}}}})",
                               R"({"definitions":{"U":{"anyOf":[{"$ref":"#/$defs/U/x"}]}}})"}) {
        CAPTURE(unused);
        CHECK_FALSE(afd::CompiledSchema::compile(afd::Json::parse(unused)).has_value());
    }
    CHECK(afd::CompiledSchema::compile(
              afd::Json::parse(R"({"$defs":{"U":{"items":{"$ref":"#/$defs/U"}}}})"))
              .has_value());
}

TEST_CASE("a boolean schema: true is {} and false is not: {} (#2047)") {
    const auto schema = compile(afd::Json::parse(R"({"type":"object",
        "properties":{"t":true,"f":false,"r":{"$ref":"#/$defs/A"},"a":{"type":"array","items":false}},
        "required":["t"],"$defs":{"A":true}})"));
    CHECK(schema.validate({{"t", 1}, {"r", {{"x", 1}}}, {"a", afd::Json::array()}}).has_value());
    const auto missing = schema.validate(afd::Json::object());
    REQUIRE_FALSE(missing.has_value());
    CHECK(missing.error().errors[0].expected == "nonoptional");
    const auto never = schema.validate({{"t", 1}, {"f", 1}, {"a", {2}}});
    REQUIRE_FALSE(never.has_value());
    REQUIRE(never.error().errors.size() == 2);
    for (const auto& issue : never.error().errors) {
        CAPTURE(issue.path);
        CHECK(issue.code == "invalid_type");
        CHECK(issue.expected == "never");
        CHECK(issue.message == "Invalid input: expected never, received number");
    }
}

TEST_CASE("a command's input schema must be an object, though booleans may sit below it") {
    afd::CommandRegistry registry;
    for (const afd::Json& root : {afd::Json(true), afd::Json(false)}) {
        const auto refused =
            registry.register_command({.name = "thing-root",
                                       .description = "Root",
                                       .input_schema = root,
                                       .handler = [](const afd::Json&, afd::CommandContext&) {
                                           return afd::success(afd::Json());
                                       }});
        REQUIRE(refused.has_value());
        CHECK(refused->find("must be a JSON Schema object") != std::string::npos);
    }
}

TEST_CASE("pass-through schema branches copy deep subtrees iteratively without stack overflow "
          "(#2404)") {
    // Build a 256-level nested JSON tree (the parse_bounded default depth limit), mixing objects,
    // arrays, scalars and empty containers so every branch of iterative copying is exercised.
    // Built fresh via move for each sub-case so the test itself never invokes nlohmann::json's
    // recursive copy constructor under Emscripten's 64 KiB Wasm stack.
    const auto make_deep = []() {
        afd::Json value = afd::Json{{"leaf", 42},
                                    {"empty_arr", afd::Json::array()},
                                    {"empty_obj", afd::Json::object()},
                                    {"flag", true}};
        for (int i = 0; i < 256; ++i) {
            if (i % 2 == 0) {
                afd::Json obj = afd::Json::object();
                obj["child"] = std::move(value);
                value = std::move(obj);
            } else {
                afd::Json arr = afd::Json::array();
                arr.push_back(std::move(value));
                value = std::move(arr);
            }
        }
        return value;
    };

    const auto verify_deep = [](const afd::Json& value) {
        const afd::Json* cursor = &value;
        for (int i = 255; i >= 0; --i) {
            if (i % 2 == 0) {
                REQUIRE(cursor->is_object());
                REQUIRE(cursor->contains("child"));
                cursor = &(*cursor)["child"];
            } else {
                REQUIRE(cursor->is_array());
                REQUIRE(cursor->size() == 1);
                cursor = &(*cursor)[0];
            }
        }
        REQUIRE(cursor->is_object());
        CHECK((*cursor)["leaf"] == 42);
        CHECK((*cursor)["empty_arr"].is_array());
        CHECK((*cursor)["empty_arr"].empty());
        CHECK((*cursor)["empty_obj"].is_object());
        CHECK((*cursor)["empty_obj"].empty());
        CHECK((*cursor)["flag"] == true);
    };

    // 1. Boolean `true` schema.
    const afd::Json deep = make_deep();
    const auto bool_true = compile(afd::Json(true));
    const auto bool_res = bool_true.validate(deep);
    REQUIRE(bool_res.has_value());
    verify_deep(*bool_res);

    // 2. Untyped `{}` schema.
    const auto untyped = compile(afd::Json::object());
    const auto untyped_res = untyped.validate(deep);
    REQUIRE(untyped_res.has_value());
    verify_deep(*untyped_res);

    // 3. Array without `items`.
    const auto open_array = compile({{"type", "array"}});
    const auto arr_res = open_array.validate(deep);
    REQUIRE(arr_res.has_value());
    verify_deep(*arr_res);

    // 4. Object with no declared `properties` and no `additionalProperties`.
    const auto open_object = compile({{"type", "object"}});
    afd::Json wrapped_open = afd::Json::object();
    wrapped_open["payload"] = make_deep();
    const auto obj_res = open_object.validate(wrapped_open);
    REQUIRE(obj_res.has_value());
    REQUIRE(obj_res->contains("payload"));
    verify_deep((*obj_res)["payload"]);

    // 5. Object with `additionalProperties: true`.
    const auto add_true = compile({{"type", "object"},
                                   {"properties", {{"known", {{"type", "string"}}}}},
                                   {"additionalProperties", true}});
    afd::Json wrapped_add = afd::Json::object();
    wrapped_add["known"] = "ok";
    wrapped_add["extra"] = make_deep();
    const auto add_res = add_true.validate(wrapped_add);
    REQUIRE(add_res.has_value());
    CHECK((*add_res)["known"] == "ok");
    REQUIRE(add_res->contains("extra"));
    verify_deep((*add_res)["extra"]);

    // 6. Deeply nested `default` value copied both at `CompiledSchema::compile` and at validation.
    afd::Json default_schema = {{"type", "object"},
                                {"properties", {{"fallback", {{"default", make_deep()}}}}}};
    const auto with_default = compile(default_schema);
    const auto def_res = with_default.validate(afd::Json::object());
    REQUIRE(def_res.has_value());
    REQUIRE(def_res->contains("fallback"));
    verify_deep((*def_res)["fallback"]);
}
