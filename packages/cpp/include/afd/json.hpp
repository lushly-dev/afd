// The JSON value type used throughout afd-cpp (proposal D2).
#pragma once

#include <nlohmann/json.hpp>

namespace afd {

/// JSON value. The sorted-key `nlohmann::json`, not `ordered_json`: object equality must ignore
/// key order (pipeline `$eq`, wire-fixture comparison), and `ordered_json` compares in order.
using Json = nlohmann::json;

} // namespace afd
