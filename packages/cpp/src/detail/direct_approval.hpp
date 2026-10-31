#pragma once

#include "afd/command.hpp"

#include <mutex>
#include <optional>
#include <string>

namespace afd::detail {

struct DirectApprovalHold {
    std::string token;
    std::string summary;
    std::string expires_at;
    std::optional<std::string> reason;
};

// Opaque outside the library; never serialized, and never trusted from a public call context.
struct DirectApprovalState {
    std::mutex mutex;
    bool active = true;
    std::optional<DirectApprovalHold> hold;
    std::optional<std::string> evidence;

    std::optional<std::string> take() {
        std::lock_guard lock(mutex);
        auto token = active ? evidence : std::nullopt;
        evidence.reset();
        return token;
    }

    void deposit(DirectApprovalHold pending) {
        std::lock_guard lock(mutex);
        if (active)
            hold = std::move(pending);
    }

    void dispose() {
        std::lock_guard lock(mutex);
        active = false;
        hold.reset();
        evidence.reset();
    }
};

struct DisposeDirectApproval {
    std::shared_ptr<DirectApprovalState> state;
    ~DisposeDirectApproval() { state->dispose(); }
};

inline CommandResult public_approval_result(CommandResult result) {
    if (!result.success && result.error && result.error->code == "APPROVAL_REQUIRED" &&
        result.error->details && result.error->details->is_object()) {
        result.error->details->erase("approvalToken");
    }
    return result;
}

} // namespace afd::detail
