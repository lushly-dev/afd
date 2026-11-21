// Which calls an approval step admitted (packages/server/src/approval-admission.ts; internal).
//
// The registry gives every call a fresh record before any middleware runs: the command it runs.
// The approval middleware decides from that command's own policy and, on every path that lets the
// call through, records what it decided on: the command name and the canonical JSON of the input.
// The registry dispatches a command whose declared policy is neither unset nor `not_required` only
// when such an admission names that command and the validated input it is about to run, and it
// takes the admission as it dispatches, so one admission runs one handler.
//
// `CommandRegistry::execute` replaces whatever record the caller's context carries, so a batch
// item, a pipeline step or a command run from inside another command's handler has its own record
// and never inherits another call's admission. Not a boundary against code in the same process.
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"

#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace afd::detail {

/// What an approval step admitted: the command and input it decided on.
struct AdmittedCall {
    std::string name;
    /// The canonical JSON of the input; unset when the command declares no gating policy or the
    /// input has none (it is then compared by identity).
    std::optional<std::string> canonical;
    const Json* input = nullptr;
};

/// One call's admission record. Opaque outside the library.
struct ApprovalAdmission {
    /// The command the call runs, as registered.
    std::shared_ptr<const CommandDefinition> command;
    std::optional<AdmittedCall> admitted;
    /// Set once a dispatch took an admission, so a second dispatch reads as a mismatch.
    bool taken = false;
};

/// Whether a declared policy needs an approval step: anything but unset or `not_required`. A
/// policy function counts, unevaluated.
bool gates(const std::optional<ApprovalPolicy>& policy) noexcept;

/// Records that an approval step admitted the call of `context` to run `name` on `input`. A no-op
/// for a context the registry did not record.
void admit_approval(CommandContext& context, std::string_view name, const Json& input);

enum class AdmissionCheck { admitted, missing, mismatch };

/// Takes the admission of the call of `context`: `admitted` when it names `name` and the same
/// canonical `input` (the same object, when the input has no canonical form), `missing` when no
/// approval step admitted the call, `mismatch` otherwise. Taken whatever the answer, so a second
/// dispatch needs a second admission.
AdmissionCheck take_admission(CommandContext& context, std::string_view name, const Json& input);

} // namespace afd::detail
