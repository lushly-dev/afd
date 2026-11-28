// Which calls an approval step admitted (packages/server/src/approval-admission.ts; internal).
//
// The registry gives every call a fresh record before any middleware runs: the command it runs.
// The approval middleware decides from that command's own policy and the one its `commands` list
// gives it and, on every path that lets a call one of those policies may gate through, records
// what it decided on: the command name and the canonical JSON of the input, and whether the
// listed policy gates it. The registry dispatches a command whose declared policy is neither
// unset nor `not_required`, or that an approval step marked as gated by its list, only when every
// admission names that command and the validated input it is about to run, and it takes them all
// as it dispatches, so one admission runs one handler.
//
// `CommandRegistry::execute` replaces whatever record the caller's context carries, so a batch
// item, a pipeline step or a command run from inside another command's handler has its own record
// and never inherits another call's admission. Not a boundary against code in the same process.
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"

#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd::detail {

/// What an approval step admitted: the command and input it decided on.
struct AdmittedCall {
    /// The approval step (one middleware instance) that admitted it, by identity.
    const void* step = nullptr;
    std::string name;
    /// The canonical JSON of the input; unset when it has none.
    std::optional<std::string> canonical;
    /// A copy of a gated command's input that has no canonical JSON, which only a policy that
    /// let the call through admits; compared by value at dispatch.
    std::optional<Json> input;
};

/// One call's admission record. Opaque outside the library. `admitted`, `taken` and
/// `listed_gate` are read and written under `mutex`, since middleware may call `next` from several
/// threads at once.
struct ApprovalAdmission {
    /// The command the call runs, as registered.
    std::shared_ptr<const CommandDefinition> command;
    /// Set by `CommandRegistry::execute` while the call runs and cleared when it returns, so a
    /// copy of the context kept after the call (whose record this still is) reads as no call:
    /// the journal reads `command->secret` only while it is set.
    std::atomic<bool> running{false};
    std::mutex mutex;
    /// The continuations `CommandRegistry` built for this call's middleware chain, by address:
    /// `[chain_begin, chain_end)` while the chain runs, and those `compose_middleware` built under
    /// one of them. Only a middleware the registry invoked is handed one, so the journal reads
    /// `secret` only for a recorder whose `next` is among them; a recorder a handler runs itself,
    /// on the same context and with a `next` of its own, reads unknown, whenever it runs.
    const Next* chain_begin = nullptr;
    const Next* chain_end = nullptr;
    std::vector<const Next*> inherited;
    /// What each approval step admitted since the last dispatch. Two approval middlewares on one
    /// registry each admit, and the dispatch must match them all, so a later one never replaces or
    /// weakens an earlier one's binding.
    std::vector<AdmittedCall> admitted;
    /// Every approval step that ever admitted this call, by identity. Never cleared: a dispatch
    /// needs a fresh admission from each, so a retry that reruns only the steps after one of them
    /// is refused.
    std::vector<const void*> steps;
    /// Set once a dispatch took an admission, so a second dispatch reads as a mismatch.
    bool taken = false;
    /// Set by an approval step whose `commands` list gives the command a gating policy, so the
    /// registry takes and checks the admission as it does for the command's own policy. Never
    /// cleared: a later dispatch on the same record is checked too.
    bool listed_gate = false;
    /// Why an approval step's `on_approval_accepted` hook refused the call on the last pass
    /// through that step: set by the refusal (which also throws, in builds with exceptions) and
    /// cleared each time the step runs again, so a retry the hook admits leaves none. The registry
    /// takes it after the chain and fails the call as for a thrown middleware error, whatever a
    /// link outside the step returned.
    std::optional<std::string> hook_refusal;
    /// Whether the call carries an idempotency key the retry middleware may count (R1). Set by
    /// `CommandRegistry::execute` before the chain runs, and never changed after.
    bool carries_key = false;
};

/// Records, for the call of `context`, that an approval hook refused it (`message`). A no-op for a
/// context the registry did not record.
void refuse_by_hook(CommandContext& context, std::string message);

/// Clears the refusal of an earlier pass, as the approval step starts another one. A no-op for a
/// context the registry did not record.
void clear_hook_refusal(CommandContext& context);

/// Takes the refusal `refuse_by_hook` recorded on `record`, if any.
std::optional<std::string> take_hook_refusal(ApprovalAdmission& record);

/// Whether `next` is a continuation the registry built for the call of `context`'s record (see
/// `ApprovalAdmission::chain_begin`). False for a context the registry did not record.
bool is_registry_next(const CommandContext& context, const Next& next);

/// What the retry middleware decides a repeat from (spec/idempotency.md, R1): the running
/// command's `mutation` and `idempotency`, and whether the call carries a key.
struct RepeatDeclaration {
    bool mutation = false;
    std::optional<IdempotencySupport> idempotency;
    bool carries_key = false;
};

/// The declaration of the command the registry runs for this call, for the retry middleware, read
/// as the journal reads `secret` (journal_replay.cpp, `live_secret`): unset outside the
/// registry's execution, for a record naming another command, and for a `next` the registry did
/// not build.
std::optional<RepeatDeclaration> live_repeat_declaration(const CommandContext& context,
                                                         std::string_view name, const Next& next);

/// Marks `inner` as the registry's for as long as it lives, when `outer` is: `compose_middleware`
/// builds continuations of its own for the parts it composes, and a part the registry reached
/// through it is still the registry's. Unmarks it on destruction.
class InheritRegistryNext {
public:
    InheritRegistryNext(CommandContext& context, const Next& outer, const Next& inner);
    InheritRegistryNext(const InheritRegistryNext&) = delete;
    InheritRegistryNext& operator=(const InheritRegistryNext&) = delete;
    ~InheritRegistryNext();

private:
    std::shared_ptr<ApprovalAdmission> record_;
    const Next* inner_;
};

/// Whether a declared policy needs an approval step: anything but unset or `not_required`. A
/// policy function counts, unevaluated.
bool gates(const std::optional<ApprovalPolicy>& policy) noexcept;

/// Records that the approval step `step` (one middleware instance, by identity) admitted the call
/// of `context` to run `name` on `input`; `listed_gate` when the policy its `commands` list gives
/// the command gates it. A no-op for a context the registry did not record. Called only for a call
/// one of the step's policies may gate.
void admit_approval(CommandContext& context, const void* step, std::string_view name,
                    const Json& input, bool listed_gate);

/// Records that the policy an approval step's `commands` list gives the command the call of
/// `context` runs gates it, whatever name the step was called with, so a call renamed on its way
/// to the step is still checked at dispatch. A no-op for a context the registry did not record.
void mark_listed_gate(CommandContext& context);

/// Whether the registry must take and check an admission before it dispatches the call of
/// `record`: its command's own policy gates it, or an approval step marked it as gated by its list.
bool needs_admission(ApprovalAdmission& record);

enum class AdmissionCheck { admitted, missing, mismatch };

/// Takes the admissions of `record`, the one the registry made for this dispatch: `admitted` when
/// `context` still carries that record, every approval step that ever admitted the call admitted
/// it again since the last dispatch, and every admission names `name` and the same canonical
/// `input` (the same by value, when it has no canonical form), `missing` when no approval step
/// admitted the call and none was taken, `mismatch` otherwise (another record, command or input,
/// a step with no fresh admission, or a second dispatch). Taken whatever the answer, in one step
/// under the record's mutex, and never restored, so a second or concurrent dispatch needs a second
/// admission.
AdmissionCheck take_admission(ApprovalAdmission& record, const CommandContext& context,
                              std::string_view name, const Json& input);

} // namespace afd::detail
