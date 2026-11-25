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

/// The tape a recording clock or random source writes to, which a call that must stay off it
/// marks truncated (spec/journal.md).
class TapeMark {
public:
    virtual ~TapeMark() = default;
    virtual void truncate() = 0;
};

/// What a journal's recording clock wraps, and its tape: `Clock::journal_tape`. The counterpart
/// of TypeScript's `UNTAPED` and `TAPE` symbols on its recording clock.
struct TapedClock {
    std::shared_ptr<const Clock> inner;
    std::shared_ptr<TapeMark> tape;
};

/// What a journal's recording random source wraps, and its tape: `RandomSource::journal_tape`.
struct TapedRandom {
    std::shared_ptr<RandomSource> inner;
    std::shared_ptr<TapeMark> tape;
};

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
    /// Set by `replay_entry` when the recorded call had an effective output budget and succeeded
    /// without a B6 report (buffered `execute_stream`, B7), so registry replay preserves that mode.
    bool skip_output_budget_check = false;
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
    case Interface::apps:
        return "apps";
    }
    return "agent";
}

/// The surface named `name`, or `std::nullopt` if it names none.
inline std::optional<Interface> parse_surface(std::string_view name) noexcept {
    for (const Interface surface :
         {Interface::palette, Interface::mcp, Interface::agent, Interface::cli, Interface::apps}) {
        if (surface_wire_name(surface) == name) {
            return surface;
        }
    }
    return std::nullopt;
}

} // namespace afd::detail
