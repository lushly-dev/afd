// The JSON value type used throughout afd-cpp (proposal D2), and wire-format helpers.
#pragma once

#include "afd/expected.hpp"

#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace afd {

/// JSON value. The sorted-key `nlohmann::json`, not `ordered_json`: `==` must ignore object key
/// order (pipeline `$eq`, wire-fixture comparison), and `ordered_json` compares in order. `==` is
/// structural and compares numbers across integer and floating-point types (`0 == 0.0`).
using Json = nlohmann::json;

/// Limits for `parse_bounded`.
struct ParseLimits {
    /// Maximum nesting depth. The outermost object or array is level 1. The default keeps any
    /// accepted document safely serializable: `dump()` recurses, and the Phase 0 spike measured
    /// it failing between 2,000 and 5,000 levels on WebAssembly's default 64 KB stack.
    std::size_t max_depth = 256;
    /// Maximum input size in bytes.
    std::size_t max_bytes = std::size_t{16} * 1024 * 1024;
};

/// Why `parse_bounded` rejected its input.
struct JsonParseError {
    enum class Kind { too_large, too_deep, malformed };
    Kind kind;
    std::string message;
};

/// Parses untrusted JSON text without exceptions, rejecting input over `limits`. Use this for
/// every document that crosses a trust boundary.
Expected<Json, JsonParseError> parse_bounded(std::string_view text, ParseLimits limits = {});

namespace wire {

/// A number as JavaScript's `JSON.stringify` writes it (proposal D9): an integral value within
/// ±(2^53 − 1), including −0, becomes a JSON integer (`0`, not `0.0`). NaN and infinities
/// become `null`, as in JavaScript.
Json number(double value);

/// `ms` (milliseconds since the Unix epoch) as JavaScript's `Date.prototype.toISOString` formats
/// it: `2026-01-01T00:00:00.000Z`. Supports years 0 through 9999.
std::string iso8601_utc(std::int64_t ms);

/// Compact JSON text. Invalid UTF-8 in strings is replaced with U+FFFD instead of aborting (a
/// plain `dump()` throws, which aborts in builds without exceptions). The value must have
/// bounded depth; see `ParseLimits::max_depth`.
std::string serialize(const Json& value);

} // namespace wire
} // namespace afd
