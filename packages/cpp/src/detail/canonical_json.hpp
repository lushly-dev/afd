// Private: canonical JSON for the journal's cap on a context field's value (spec/journal.md,
// "Declared context fields"). Implemented in approval.cpp beside `afd::canonical_json`. Not
// installed.
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <string>

namespace afd::detail {

/// `afd::canonical_json`, except that an integer beyond ±(2^53 − 1) is written as the double
/// JavaScript reads it as (`99999999999999999` is `100000000000000000`) instead of being refused,
/// so the text is what JavaScript writes after reading `value`. Still fails on a non-finite
/// number, a string that is not valid UTF-8, binary or discarded values, and nesting deeper than
/// 256 levels.
Expected<std::string> canonical_json_as_read(const Json& value);

} // namespace afd::detail
