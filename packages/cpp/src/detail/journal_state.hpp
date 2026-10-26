// Private: what the journal middleware and replay keep on `CommandContext::journal`. The
// counterpart of TypeScript's module-private `JOURNAL_REPLAY` symbol: only journal code can make
// one. Not installed.
#pragma once

#include "afd/command.hpp"
#include "afd/runtime.hpp"

#include <functional>
#include <memory>
#include <optional>
#include <string_view>

namespace afd::detail {

struct JournalCallState {
    /// The clock under every recording wrapper, so a journal's own timing lands on no tape.
    std::shared_ptr<const Clock> untaped;
    /// The recording clock this state's journal put on the context. A middleware inside it that
    /// swapped in another clock gets no unwrapping.
    std::shared_ptr<const Clock> recording;
    /// Set by `replay_journal`: journal middleware records nothing.
    bool replaying = false;
    /// Restart the replay clock and random source; the first journal middleware calls it and
    /// clears it, so nested calls and inner journals do not rewind again.
    std::function<void()> rewind;
    /// The handler is done: later readings (by outer middleware) are not tape overruns.
    std::function<void()> end;
};

/// The wire name of `surface`, as TypeScript's `context.interface` holds it.
inline std::string_view surface_wire_name(Interface surface) noexcept {
    switch (surface) {
    case Interface::palette:
        return "palette";
    case Interface::mcp:
        return "mcp";
    case Interface::agent:
        return "agent";
    case Interface::cli:
        return "cli";
    }
    return "agent";
}

/// The surface named `name`, or `std::nullopt` if it names none.
inline std::optional<Interface> parse_surface(std::string_view name) noexcept {
    for (const Interface surface :
         {Interface::palette, Interface::mcp, Interface::agent, Interface::cli}) {
        if (surface_wire_name(surface) == name) {
            return surface;
        }
    }
    return std::nullopt;
}

} // namespace afd::detail
