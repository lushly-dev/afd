// The MCP approval relay (spec/command-metadata.md, "Asking the human over MCP";
// packages/server/src/approval-relay.ts): how the approval middleware asks the human behind an
// MCP client through a form elicitation, instead of returning a token to the agent.
//
// The MCP server (afd::mcp_stdio) puts one relay on the context of each `tools/call` whose request
// can carry a form elicitation, naming the command the call routes to. Only that command, and only
// once, can claim it, so a command run by another command's handler cannot turn the tool call into
// an elicitation. Opaque outside the library: never serialized, never read from tool arguments.
#pragma once

#include "afd/command.hpp"
#include "afd/errors.hpp"
#include "afd/json.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
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

/// One step of an `afd-batch` or `afd-pipe`, as its up-front approval sees it.
struct UpFrontStep {
    /// The step's position in the request, 0-based as in its results.
    std::size_t index = 0;
    std::string command;
    /// Whether its input reads an earlier step's data, so it is known only when the pipeline runs.
    bool dynamic = false;
    /// The validated input of a step that is not dynamic; unset when it names no command the
    /// caller can run or does not validate (it then fails when it runs).
    std::optional<Json> input;
    /// The server's definition of the command, whose approval policy and confirmation prompt
    /// decide the step; unset when it names no command the caller can run.
    std::shared_ptr<const CommandDefinition> definition;
};

/// The human's answers an up-front call carries: every accepted question, and the bindings of
/// the declined ones.
struct UpFrontAnswers {
    std::vector<RelayAnswer> accepted;
    std::vector<std::string> declined;
};

/// What the approval middleware held an up-front call for: one question per gated step, asked
/// with one form.
struct UpFrontHold {
    std::vector<RelayHold> questions;
    std::string message;
};

/// The up-front approval of one `afd-batch` or `afd-pipe` that can carry a form elicitation
/// (spec/command-metadata.md, "One approval up front for `afd-batch` and `afd-pipe`", #459):
/// every step runs, each gated one on its own single-use approval, or none does. The approval
/// middleware decides the plan once, when the first step reaches it, and removes this from each
/// step's context before the step runs. Only the MCP server creates it.
class UpFrontApproval {
public:
    /// One accepted answer a gated step runs on.
    struct Approved {
        std::string binding;
        /// The hold's nonce, already spent, and its expiry: the step's approval summary.
        std::string nonce;
        std::int64_t expires_at_ms = 0;
        bool used = false;
    };

    /// What the middleware decided.
    struct Plan {
        /// Why nothing runs; unset when every step runs.
        std::optional<CommandError> refusal;
        /// The approvals the gated steps run on, each taken once.
        std::vector<Approved> approved;
    };

    UpFrontApproval(std::string tool, std::string call, bool conditional,
                    std::vector<UpFrontStep> steps, UpFrontAnswers answers)
        : tool_(std::move(tool)), call_(std::move(call)), conditional_(conditional),
          steps_(std::move(steps)), answers_(std::move(answers)) {}

    /// `afd-batch` or `afd-pipe`.
    [[nodiscard]] const std::string& tool() const noexcept { return tool_; }
    /// The whole request as sent, as canonical JSON: every approval is bound to it.
    [[nodiscard]] const std::string& call() const noexcept { return call_; }
    /// Whether a step runs only under a `when` condition.
    [[nodiscard]] bool conditional() const noexcept { return conditional_; }
    [[nodiscard]] const std::vector<UpFrontStep>& steps() const noexcept { return steps_; }
    [[nodiscard]] const UpFrontAnswers& answers() const noexcept { return answers_; }

    /// The plan, decided by `decide` the first time; later steps wait for it and get the same.
    template <class Decide>
    std::shared_ptr<Plan> plan(Decide&& decide) {
        const std::lock_guard lock(plan_mutex_);
        if (!plan_) {
            auto decided = std::make_shared<Plan>(decide());
            const std::lock_guard state(mutex_);
            if (decided->refusal && !refusal_) {
                refusal_ = decided->refusal;
            }
            plan_ = std::move(decided);
        }
        return plan_;
    }

    /// Takes one unused approval whose binding is among `bindings`, if there is one.
    std::optional<Approved> take(const std::vector<std::string>& bindings) {
        const std::lock_guard lock(mutex_);
        if (!plan_) {
            return std::nullopt;
        }
        for (auto& approved : plan_->approved) {
            if (!approved.used &&
                std::find(bindings.begin(), bindings.end(), approved.binding) != bindings.end()) {
                approved.used = true;
                return approved;
            }
        }
        return std::nullopt;
    }

    void hold(UpFrontHold hold) {
        const std::lock_guard lock(mutex_);
        hold_ = std::move(hold);
    }

    /// The questions to ask, when the plan was to ask.
    [[nodiscard]] std::optional<UpFrontHold> held() const {
        const std::lock_guard lock(mutex_);
        return hold_;
    }

    /// Why nothing ran, when the plan refused the call; the server answers with it.
    [[nodiscard]] std::optional<CommandError> refusal() const {
        const std::lock_guard lock(mutex_);
        return refusal_;
    }

private:
    std::string tool_;
    std::string call_;
    bool conditional_ = false;
    std::vector<UpFrontStep> steps_;
    UpFrontAnswers answers_;
    std::mutex plan_mutex_;
    mutable std::mutex mutex_;
    std::shared_ptr<Plan> plan_;
    std::optional<UpFrontHold> hold_;
    std::optional<CommandError> refusal_;
};

} // namespace afd::detail
