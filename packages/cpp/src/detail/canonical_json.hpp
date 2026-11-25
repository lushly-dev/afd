// Private: canonical JSON for the journal's cap on a context field's value (spec/journal.md,
// "Declared context fields"), the output budget's measure, and the JSON string writer approval
// tokens share. Implemented in canonical_json.cpp beside `afd::canonical_json`. Not installed.
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <cstdint>
#include <string>
#include <string_view>

namespace afd::detail {

/// Appends `text` as a JSON string as `JSON.stringify` writes it. `text` must be valid UTF-8.
void append_json_string(std::string& out, std::string_view text);

/// `afd::canonical_json`, except that an integer beyond ±(2^53 − 1) is written as the double
/// JavaScript reads it as (`99999999999999999` is `100000000000000000`) instead of being refused,
/// so the text is what JavaScript writes after reading `value`. Still fails on a non-finite
/// number, a string that is not valid UTF-8, binary or discarded values, and nesting deeper than
/// 256 levels.
Expected<std::string> canonical_json_as_read(const Json& value);

/// The UTF-8 byte length of `value`'s canonical JSON as JavaScript writes it, computed iteratively
/// with no nesting-depth cap (spec/output-budgets.md, B5). Non-finite floats measure as `null`,
/// and invalid UTF-8 strings fall back to `wire::serialize` replacement spelling.
std::uint64_t canonical_json_byte_length_as_read(const Json& value);

} // namespace afd::detail
