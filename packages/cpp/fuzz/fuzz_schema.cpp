// Any JSON as a schema must compile or be rejected; any JSON as input to a fixed schema, and to the
// fuzzed schema when it compiles, must validate without crashing.
#include "afd/schema.hpp"

#include <cstddef>
#include <cstdint>
#include <string_view>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    static const auto todo = afd::CompiledSchema::compile(afd::Json::parse(R"({
        "type": "object",
        "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "priority": {"$ref": "#/definitions/Priority", "default": "medium"},
            "ids": {"type": "array", "items": {"type": "integer", "minimum": 0}, "maxItems": 5}
        },
        "required": ["title"],
        "additionalProperties": false,
        "definitions": {"Priority": {"enum": ["low", "medium", "high"]}}
    })"));
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    const auto value = afd::parse_bounded(text, {.max_depth = 64, .max_bytes = 1 << 16});
    if (!value) {
        return 0;
    }
    if (const auto result = todo->validate(*value); !result) {
        (void)afd::validation_failure_error(result.error());
    }
    if (const auto schema = afd::CompiledSchema::compile(*value)) {
        (void)schema->validate(*value);
        (void)schema->validate(afd::Json::object());
    }
    return 0;
}
