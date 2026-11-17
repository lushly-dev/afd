// The MCP approval relay (spec/command-metadata.md, "Asking the human over MCP";
// packages/server/src/approval-relay.ts): how the approval middleware asks the human behind an
// MCP client through a form elicitation, instead of returning a token to the agent.
//
// The MCP server (afd::mcp_stdio) puts one relay on the context of each `tools/call` whose request
// can carry a form elicitation, naming the command the call routes to. Only that command, and only
// once, can claim it, so a command run by another command's handler cannot turn the tool call into
// an elicitation. Opaque outside the library: never serialized, never read from tool arguments.
#pragma once

#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace afd::detail {

/// A call held for the human's approval, as the middleware records it.
struct RelayHold {
    /// Keyed digest of the command, its validated input and the actor, under the signing key.
    std::string binding;
    /// The same digest under every verification key.
    std::vector<std::string> bindings;
    /// Random nonce, spent when the approved call runs.
    std::string nonce;
    /// Expiry of the approval, epoch milliseconds on the middleware's clock.
    std::int64_t expires_at_ms = 0;
    /// MAC of the binding, nonce and expiry under the approval secret.
    std::string mac;
    /// The question shown to the human.
    std::string message;
};

/// The human's answer to an earlier approval elicitation.
struct RelayAnswer {
    enum class Kind { missing, accept, decline };
    Kind kind = Kind::missing;
    std::string binding;
    std::string nonce;
    std::int64_t expires_at_ms = 0;
    std::string mac;
};

class McpApprovalRelay {
public:
    using Answerer = std::function<RelayAnswer(const std::vector<std::string>& bindings)>;

    McpApprovalRelay(std::string routed, Answerer answer)
        : routed_(std::move(routed)), answer_(std::move(answer)) {}

    /// Takes the relay for `command`: only the routed command, and only once.
    bool claim(std::string_view command) {
        const std::lock_guard lock(mutex_);
        if (claimed_ || command != routed_) {
            return false;
        }
        claimed_ = true;
        return true;
    }

    /// The answer this request carries for any of `bindings`, or `missing`.
    RelayAnswer answer(const std::vector<std::string>& bindings) const {
        return answer_ ? answer_(bindings) : RelayAnswer{};
    }

    /// Records that the call needs the human's approval; the server asks once the call returns.
    void hold(RelayHold hold) {
        const std::lock_guard lock(mutex_);
        hold_ = std::move(hold);
    }

    std::optional<RelayHold> take_hold() {
        const std::lock_guard lock(mutex_);
        auto hold = std::move(hold_);
        hold_.reset();
        return hold;
    }

private:
    std::mutex mutex_;
    std::string routed_;
    Answerer answer_;
    bool claimed_ = false;
    std::optional<RelayHold> hold_;
};

} // namespace afd::detail
