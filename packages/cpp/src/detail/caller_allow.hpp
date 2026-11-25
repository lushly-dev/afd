// The allow list of the client a call came through, carried on the context so the engine names
// only commands that list admits (spec/recovery.md, rule 2).
#pragma once

#include "afd/command.hpp"

#include <functional>
#include <string_view>

namespace afd::detail {

// Opaque outside the library: only `DirectClient` sets it, from `DirectClientOptions::allow`.
struct CallerAllow {
    std::function<bool(std::string_view)> allows;
};

// Whether the client's allow list (if any) admits `name`.
inline bool caller_allows(const CommandContext& context, std::string_view name) {
    return !context.caller_allow || !context.caller_allow->allows ||
           context.caller_allow->allows(name);
}

} // namespace afd::detail
