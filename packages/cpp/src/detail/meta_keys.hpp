// Private: MCP `_meta` key rule (spec/mcp-resources.md, T2) and advertised input schema validation
// (V2). Shared by `afd::afd` and `afd::mcp_stdio`. Not installed.
#pragma once

#include "afd/json.hpp"

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace afd::detail {

/// Whether every number inside `value` is finite, no node is a non-JSON binary subtype, every
/// string and object key is valid UTF-8, and (when `max_depth` is set) nesting does not exceed
/// `*max_depth`.
[[nodiscard]] bool is_valid_json_value(const Json& value,
                                       std::optional<std::size_t> max_depth = std::nullopt);

/// Validates one `_meta` entry `(key, value)` against `spec/mcp-resources.md` T2.
/// Returns `std::nullopt` when allowed, or a reason naming `key` when refused.
[[nodiscard]] std::optional<std::string>
validate_meta_entry(std::string_view key, const Json& value, bool allow_ui = true);

/// Validates an entire `_meta` object (`tool_meta`, resource `_meta`, or read content `_meta`).
/// Returns `std::nullopt` when valid, or an error message naming `owner` and the offending key.
[[nodiscard]] std::optional<std::string>
validate_meta_object(std::string_view owner, const Json& meta, bool allow_ui = true);

/// Validates `CommandDefinition::advertised_input_schema` (spec/mcp-resources.md, V2): must be a
/// JSON object whose `"type"` is `"object"` holding wire-representable JSON values.
[[nodiscard]] std::optional<std::string>
validate_advertised_input_schema(std::string_view command_name, const Json& schema);

} // namespace afd::detail
