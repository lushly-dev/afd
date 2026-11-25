#include "afd/approval.hpp"

#include "afd/errors.hpp"
#include "afd/result.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iterator>
#include <map>
#include <mutex>
#include <random>
#include <utility>

#include "detail/approval_admission.hpp"
#include "detail/approval_relay.hpp"
#include "detail/canonical_json.hpp"
#include "detail/direct_approval.hpp"
#include "detail/hmac.hpp"
#include "detail/json_io.hpp"

namespace afd {

namespace {

constexpr std::string_view token_prefix = "afdap1";
constexpr std::size_t min_secret_bytes = 32;
constexpr std::int64_t max_ttl_ms = std::int64_t{24} * 60 * 60 * 1000;
/// Longer evidence is rejected unread, so a caller cannot make the server hash megabytes.
constexpr std::size_t max_token_length = 1024;

// --- tokens -----------------------------------------------------------------------------------

struct Verdict {
    std::optional<ApprovalRejection> rejection;
    std::string nonce;
    std::int64_t expires_at_ms = 0;
};

Verdict reject(ApprovalRejection reason) {
    return {.rejection = reason, .nonce = {}, .expires_at_ms = 0};
}

std::string digest(std::string_view key, std::string_view purpose, std::string_view value) {
    // `purpose` keeps an input digest from ever matching an actor digest.
    std::string message(purpose);
    message.push_back('\0');
    message.append(value);
    return detail::base64url_encode(detail::hmac_sha256(key, message));
}

std::string mac(std::string_view key, std::string_view signing_input) {
    return detail::base64url_encode(detail::hmac_sha256(key, signing_input));
}

/// The actor fields a token is bound to. `label` is display text, so it is left out.
Expected<std::string> actor_binding(const std::optional<Actor>& actor) {
    if (!actor) {
        return std::string("null");
    }
    Json fields = Json::object();
    fields["kind"] = std::string(actor_kind_name(actor->kind));
    if (actor->id) {
        fields["id"] = *actor->id;
    }
    if (actor->on_behalf_of) {
        fields["onBehalfOf"] = *actor->on_behalf_of;
    }
    return canonical_json(fields);
}

class MemoryNonceStore {
public:
    bool consume(const std::string& nonce, std::int64_t expires_at_ms, std::int64_t now) {
        const std::lock_guard lock(mutex_);
        for (auto it = used_.begin(); it != used_.end();) {
            it = it->second <= now ? used_.erase(it) : std::next(it);
        }
        return used_.emplace(nonce, expires_at_ms).second;
    }

private:
    std::mutex mutex_;
    std::map<std::string, std::int64_t, std::less<>> used_;
};

void system_random_bytes(std::uint8_t* out, std::size_t size) {
    std::random_device device;
    for (std::size_t i = 0; i < size;) {
        auto word = device();
        for (std::size_t b = 0; b < sizeof word && i < size; ++b, ++i) {
            out[i] = static_cast<std::uint8_t>(word & 0xFFU);
            word >>= 8;
        }
    }
}

/// What decides a call of one command: its own policy and confirmation prompt (the command the
/// registry runs, or the server's definition of an up-front step), and the `commands` option's
/// entry for it. The call is held when either policy holds it.
struct Decider {
    const CommandDefinition* own = nullptr;
    const ApprovalCommand* listed = nullptr;
};

/// Whether `policy` holds a call. Fail closed: anything but an explicit `not_required` holds it.
bool policy_holds(const std::optional<ApprovalPolicy>& policy, const Json& input,
                  const CommandContext& context) {
    if (!policy) {
        return false;
    }
    const ApprovalPolicyFunction* decide = policy->function();
    if (!decide) {
        return policy->decision() != ApprovalDecision::not_required;
    }
    return !*decide || (*decide)(input, context) != ApprovalDecision::not_required;
}

struct ApprovalState {
    std::vector<std::string> keys;
    std::map<std::string, ApprovalCommand, std::less<>> commands;
    std::int64_t ttl_ms = 0;
    bool single_use = true;
    std::shared_ptr<ApprovalNonceStore> nonce_store;
    MemoryNonceStore memory_store;
    ApprovalMiddlewareOptions options;

    /// What decides a call of `name` whose own definition is `own` (none outside the registry).
    [[nodiscard]] Decider decider(std::string_view name, const CommandDefinition* own) const {
        const auto found = commands.find(name);
        return {.own = own, .listed = found == commands.end() ? nullptr : &found->second};
    }

    /// What decides this call of `name`: the command the registry runs for it.
    [[nodiscard]] Decider decider(std::string_view name, const CommandContext& context) const {
        const detail::ApprovalAdmission* record = context.approval_admission.get();
        const CommandDefinition* own = record && record->command && record->command->name == name
                                           ? record->command.get()
                                           : nullptr;
        return decider(name, own);
    }

    /// Whether the call needs approval: its own policy or its listed one holds it.
    static bool requires_approval(const Decider& decider, const Json& input,
                                  const CommandContext& context) {
        return (decider.own && policy_holds(decider.own->approval, input, context)) ||
               (decider.listed && policy_holds(decider.listed->approval, input, context));
    }

    /// Whether the call may need approval, without evaluating a policy function.
    static bool may_require_approval(const Decider& decider) {
        return (decider.own && detail::gates(decider.own->approval)) ||
               (decider.listed && detail::gates(decider.listed->approval));
    }

    Verdict verify_token(std::string_view evidence, std::string_view command,
                         std::string_view input, std::string_view actor, std::int64_t now) const {
        if (evidence.size() > max_token_length) {
            return reject(ApprovalRejection::malformed);
        }
        const auto first_dot = evidence.find('.');
        const auto second_dot = first_dot == std::string_view::npos
                                    ? std::string_view::npos
                                    : evidence.find('.', first_dot + 1);
        if (second_dot == std::string_view::npos ||
            evidence.find('.', second_dot + 1) != std::string_view::npos ||
            evidence.substr(0, first_dot) != token_prefix) {
            return reject(ApprovalRejection::malformed);
        }
        const std::string_view signing_input = evidence.substr(0, second_dot);
        const std::string_view encoded_payload =
            evidence.substr(first_dot + 1, second_dot - first_dot - 1);
        const std::string_view encoded_mac = evidence.substr(second_dot + 1);

        // Compare the encoded MACs, so that a token has exactly one valid spelling. The key that
        // signed the token also keyed its digests.
        const std::string* key = nullptr;
        for (const auto& candidate : keys) {
            if (detail::constant_time_equal(encoded_mac, mac(candidate, signing_input))) {
                key = &candidate;
                break;
            }
        }
        if (!key) {
            return reject(ApprovalRejection::invalid_signature);
        }

        const auto decoded = detail::base64url_decode(encoded_payload);
        if (!decoded) {
            return reject(ApprovalRejection::malformed);
        }
        const auto parsed =
            parse_bounded(*decoded, {.max_depth = 4, .max_bytes = max_token_length});
        if (!parsed || !parsed->is_object()) {
            return reject(ApprovalRejection::malformed);
        }
        const Json& payload = *parsed;
        for (const char* field : {"c", "i", "a", "n"}) {
            const auto it = payload.find(field);
            if (it == payload.end() || !it->is_string()) {
                return reject(ApprovalRejection::malformed);
            }
        }
        for (const char* field : {"iat", "exp"}) {
            const auto it = payload.find(field);
            if (it == payload.end() || !it->is_number() || !std::isfinite(it->get<double>())) {
                return reject(ApprovalRejection::malformed);
            }
        }
        const double expires = payload["exp"].get<double>();
        if (static_cast<double>(now) >= expires) {
            return reject(ApprovalRejection::expired);
        }
        if (!detail::constant_time_equal(payload["c"].get_ref<const std::string&>(), command)) {
            return reject(ApprovalRejection::command_mismatch);
        }
        if (!detail::constant_time_equal(payload["i"].get_ref<const std::string&>(),
                                         digest(*key, "input", input))) {
            return reject(ApprovalRejection::input_mismatch);
        }
        if (!detail::constant_time_equal(payload["a"].get_ref<const std::string&>(),
                                         digest(*key, "actor", actor))) {
            return reject(ApprovalRejection::actor_mismatch);
        }
        // `expires` is above `now` here; clamp a far-future expiry into range.
        const double capped = (std::min)(expires, 9.0e18);
        return {.rejection = std::nullopt,
                .nonce = payload["n"].get<std::string>(),
                .expires_at_ms = static_cast<std::int64_t>(std::ceil(capped))};
    }

    /// A signed token, laid out as TypeScript's `JSON.stringify(payload)` writes it.
    std::string issue(std::string_view command, std::string_view input, std::string_view actor,
                      std::int64_t now, std::int64_t& expires_at_ms) const {
        const std::string& key = keys.front();
        std::array<std::uint8_t, 16> nonce{};
        if (options.random_bytes) {
            options.random_bytes(nonce.data(), nonce.size());
        } else {
            system_random_bytes(nonce.data(), nonce.size());
        }
        expires_at_ms = now + ttl_ms;
        std::string payload = "{\"c\":";
        detail::append_json_string(payload, command);
        payload += ",\"i\":\"" + digest(key, "input", input) + "\"";
        payload += ",\"a\":\"" + digest(key, "actor", actor) + "\"";
        payload += ",\"iat\":" + std::to_string(now);
        payload += ",\"exp\":" + std::to_string(expires_at_ms);
        payload += ",\"n\":\"" +
                   detail::base64url_encode(std::string_view(
                       reinterpret_cast<const char*>(nonce.data()), nonce.size())) +
                   "\"}";
        std::string signing_input(token_prefix);
        signing_input += '.';
        signing_input += detail::base64url_encode(payload);
        return signing_input + "." + mac(key, signing_input);
    }

    /// The binding of a relayed approval, one per key: a keyed digest of the command, input and
    /// actor (TypeScript's `relayBindings`).
    std::vector<std::string> relay_bindings(std::string_view command, std::string_view input,
                                            std::string_view actor) const {
        Json triple = Json::array({std::string(command), std::string(input), std::string(actor)});
        const auto canonical = canonical_json(triple);
        std::string data = "relay";
        data.push_back('\0');
        data += canonical ? *canonical : std::string();
        std::vector<std::string> bindings;
        bindings.reserve(keys.size());
        for (const auto& key : keys) {
            bindings.push_back(mac(key, data));
        }
        return bindings;
    }

    /// The MAC of a relayed approval's nonce and expiry, so the elicitation state cannot set
    /// them (TypeScript's `holdMac`).
    static std::string hold_mac(std::string_view key, const std::string& binding,
                                const std::string& nonce, std::int64_t expires_at_ms) {
        Json fields = Json::array({binding, nonce, expires_at_ms});
        const auto canonical = canonical_json(fields);
        std::string data = "relay-hold";
        data.push_back('\0');
        data += canonical ? *canonical : std::string();
        return mac(key, data);
    }

    /// Whether an accepted relayed approval is genuine (one of `bindings`, with a MAC under that
    /// binding's key) and unexpired. Its nonce is not spent here.
    [[nodiscard]] bool genuine(const detail::RelayAnswer& answer,
                               const std::vector<std::string>& bindings, std::int64_t now) const {
        const auto found = std::find(bindings.begin(), bindings.end(), answer.binding);
        if (found == bindings.end()) {
            return false;
        }
        const std::string& key =
            keys[static_cast<std::size_t>(std::distance(bindings.begin(), found))];
        if (!detail::constant_time_equal(
                answer.mac, hold_mac(key, answer.binding, answer.nonce, answer.expires_at_ms))) {
            return false;
        }
        return now < answer.expires_at_ms && answer.expires_at_ms <= now + ttl_ms;
    }

    /// Whether an accepted relayed approval is genuine, unexpired and (single-use) unspent.
    bool relayed_approval_holds(const detail::RelayAnswer& answer,
                                const std::vector<std::string>& bindings, std::int64_t now) {
        return genuine(answer, bindings, now) && consume(answer.nonce, answer.expires_at_ms, now);
    }

    /// A question for the human, bound to `bindings` (the signing key's first).
    [[nodiscard]] detail::RelayHold question(std::vector<std::string> bindings,
                                             std::int64_t now) const {
        detail::RelayHold hold;
        hold.binding = bindings.front();
        hold.bindings = std::move(bindings);
        hold.nonce = random_nonce();
        hold.expires_at_ms = now + ttl_ms;
        hold.mac = hold_mac(keys.front(), hold.binding, hold.nonce, hold.expires_at_ms);
        return hold;
    }

    /// The summary of a held call: the host's, else the confirmation prompt, else "Run <name>".
    [[nodiscard]] std::string summary(std::string_view name, const Json& input,
                                      const CommandContext& context, const Decider& decider) const {
        std::string text;
        if (options.summarize) {
            text = options.summarize(name, input, context).value_or("");
        }
        if (text.empty() && decider.own && decider.own->confirm_prompt) {
            text = *decider.own->confirm_prompt;
        }
        if (text.empty() && decider.listed && decider.listed->confirm_prompt) {
            text = *decider.listed->confirm_prompt;
        }
        return text.empty() ? "Run " + std::string(name) : text;
    }

    /// The bindings of an up-front approval, one per key: a keyed digest of the call's tag under
    /// that key (itself a keyed digest of the whole request), the command, its canonical input
    /// and the actor, so an approval given for one request covers no other, nor a call to the
    /// command on its own (Rust's `up_front_bindings`).
    [[nodiscard]] std::vector<std::string> up_front_bindings(const detail::UpFrontApproval& up,
                                                             std::string_view name,
                                                             std::string_view input,
                                                             std::string_view actor) const {
        std::string call = "relay-call";
        call.push_back('\0');
        call += up.call();
        std::vector<std::string> bindings;
        bindings.reserve(keys.size());
        for (const auto& key : keys) {
            const auto fields = canonical_json(Json::array(
                {mac(key, call), std::string(name), std::string(input), std::string(actor)}));
            std::string data = "relay-step";
            data.push_back('\0');
            data += fields ? *fields : std::string();
            bindings.push_back(mac(key, data));
        }
        return bindings;
    }

    std::string random_nonce() const {
        std::array<std::uint8_t, 16> nonce{};
        if (options.random_bytes) {
            options.random_bytes(nonce.data(), nonce.size());
        } else {
            system_random_bytes(nonce.data(), nonce.size());
        }
        return detail::base64url_encode(
            std::string_view(reinterpret_cast<const char*>(nonce.data()), nonce.size()));
    }

    bool consume(const std::string& nonce, std::int64_t expires_at_ms, std::int64_t now) {
        if (!single_use) {
            return true;
        }
        if (nonce_store) {
            return nonce_store->consume(nonce, expires_at_ms);
        }
        return memory_store.consume(nonce, expires_at_ms, now);
    }
};

CommandResult unbindable(std::string_view command, const std::string& reason) {
    return failure(CommandError{
        .code = error_codes::COMMAND_EXECUTION_ERROR,
        .message = std::string(command) + " cannot be approved: " + reason,
        .suggestion = "Pass plain JSON input that JavaScript can represent exactly; an approval "
                      "cannot be bound to this input.",
        .retryable = false,
        .details = std::nullopt,
        .cause = nullptr,
    });
}

/// A call that needs approval whose input has no canonical JSON, so no approval can be bound to
/// it (spec/command-metadata.md, "Approvals"). Nobody is asked.
CommandError input_not_canonical(std::string_view command) {
    return CommandError{
        .code = error_codes::APPROVAL_UNAVAILABLE,
        .message = std::string(command) +
                   " needs a person's approval, and this input cannot be bound to one",
        .suggestion = "Do not retry with this input: it has no exact canonical form, so an "
                      "approval cannot be bound to it. Send the input in a form canonical JSON "
                      "accepts (for example, an integer a JavaScript number cannot hold exactly, "
                      "such as 2^53 + 1, as a string).",
        .retryable = false,
        .details = Json{{"reason", "input-not-canonical"}},
        .cause = nullptr,
    };
}

/// Longest input shown in a relayed approval's question, in UTF-16 code units as TypeScript
/// counts them; C++ cuts at a code point boundary at or below that many bytes.
constexpr std::size_t max_shown_input = 1000;

/// A canonical input as a question shows it, cut to `max_shown_input`.
std::string shown_input(std::string_view input) {
    std::string shown(input);
    if (shown.size() > max_shown_input) {
        std::size_t cut = max_shown_input;
        while (cut > 0 && (static_cast<unsigned char>(shown[cut]) & 0xC0U) == 0x80U) {
            --cut;
        }
        shown.resize(cut);
        shown += "\xE2\x80\xA6"; // U+2026, as TypeScript appends
    }
    return shown;
}

/// The question of a relayed approval: the summary, then what exactly would run.
std::string relay_message(std::string_view summary, std::string_view command,
                          std::string_view input, std::string_view note) {
    std::string message;
    if (!note.empty()) {
        message.append(note).append("\n");
    }
    message.append(summary).append("\n\nCommand: ").append(command).append("\nInput: ");
    message += shown_input(input);
    return message;
}

CommandResult relay_declined(std::string_view command, const std::string& summary) {
    return failure(CommandError{
        .code = error_codes::APPROVAL_REQUIRED,
        .message = "The user did not approve " + std::string(command),
        .suggestion = "Do not run this again without asking the user first; the user chose not "
                      "to approve it.",
        .retryable = false,
        .recovery = Recovery{.kind = RecoveryKind::stop},
        .details = Json{{"summary", summary}, {"reason", "declined"}},
        .cause = nullptr,
    });
}

// --- One approval up front for afd-batch and afd-pipe (#459) --------------------------------

/// The latest approval clock reading whose expiry still fits an ISO 8601 date (years up to
/// 9999), as `expiresAt` reports it: 9999-12-31, less a day.
constexpr std::int64_t max_wall_ms = 253402300799999 - max_ttl_ms;

CommandError clock_out_of_range(std::string_view name) {
    return CommandError{
        .code = error_codes::COMMAND_EXECUTION_ERROR,
        .message = std::string(name) + " cannot be approved: the approval clock is out of range",
        .suggestion = "Give the approval middleware a clock that reads the current time.",
        .retryable = false,
        .details = std::nullopt,
        .cause = nullptr,
    };
}

/// The most gated steps one question lists; a person cannot weigh more at once.
constexpr std::size_t max_up_front_approvals = 20;

std::string_view noun(std::string_view tool) {
    return tool == "afd-batch" ? "batch" : "pipeline";
}

/// APPROVAL_REQUIRED for an afd-batch or afd-pipe, or one of its steps. `recovery` follows
/// spec/recovery.md's "Engine errors": `stop` when the user declined, none when the caller
/// reshapes the call, and `external` while a person must approve.
CommandError up_front_error(std::string message, std::string suggestion, Json details,
                            std::optional<Recovery> recovery) {
    return CommandError{.code = error_codes::APPROVAL_REQUIRED,
                        .message = std::move(message),
                        .suggestion = std::move(suggestion),
                        .retryable = false,
                        .recovery = std::move(recovery),
                        .details = std::move(details),
                        .cause = nullptr};
}

/// One gated step as the plan sees it.
struct GatedStep {
    std::size_t index = 0;
    std::string command;
    /// The canonical JSON of its validated input.
    std::string input;
    std::string summary;
    std::vector<std::string> bindings;
};

std::string summaries(const std::vector<GatedStep>& gated) {
    std::string out;
    for (const auto& step : gated) {
        out += (out.empty() ? "" : "; ") + step.summary;
    }
    return out;
}

/// The question of an up-front approval: what the call is, then each gated step's summary,
/// command and canonical input, so the human sees exactly what would run.
std::string steps_message(const detail::UpFrontApproval& up, const std::vector<GatedStep>& gated,
                          std::string_view note) {
    const std::string what(noun(up.tool()));
    std::string message;
    if (!note.empty()) {
        message.append(note).append("\n");
    }
    message += "This " + what + " includes " +
               (gated.size() == 1 ? std::string("a step that needs")
                                  : std::to_string(gated.size()) + " steps that need") +
               " your approval. Approving lets each run once, exactly as shown; if you do not "
               "approve, nothing in the " +
               what + " runs.";
    if (up.conditional()) {
        message += "\nSome steps run only when their conditions hold, so one step may run while "
                   "another is skipped.";
    }
    for (const auto& step : gated) {
        message += "\n\nStep " + std::to_string(step.index + 1) + ": " + step.summary +
                   "\nCommand: " + step.command + "\nInput: " + shown_input(step.input);
    }
    return message;
}

/// What the approval middleware decides for an up-front call, before any step runs. Every step's
/// policy (and `summarize`) is evaluated with the context of the step that reached the middleware
/// first, as in Rust; a policy that decides otherwise for a later step's own context fails that
/// step with APPROVAL_REQUIRED (spec rule 4), though earlier steps may have run.
detail::UpFrontApproval::Plan decide(ApprovalState& state, detail::UpFrontApproval& up,
                                     const CommandContext& context) {
    using Plan = detail::UpFrontApproval::Plan;
    const std::string what(noun(up.tool()));
    // The server plans every batch and pipeline up front, since it cannot see the `commands`
    // list: one with no step any policy here may gate runs as it would on its own.
    if (std::none_of(up.steps().begin(), up.steps().end(), [&](const detail::UpFrontStep& step) {
            return ApprovalState::may_require_approval(
                state.decider(step.command, step.definition.get()));
        })) {
        return Plan{};
    }
    // A gated pipeline step whose input comes from an earlier step cannot be shown up front.
    for (const auto& step : up.steps()) {
        if (!step.dynamic || !ApprovalState::may_require_approval(
                                 state.decider(step.command, step.definition.get()))) {
            continue;
        }
        const std::string at = std::to_string(step.index);
        return Plan{
            .refusal = up_front_error(
                step.command + " (the step at index " + at +
                    ") needs approval, and its input comes from an earlier step, so the user "
                    "cannot approve it before the " +
                    what + " runs. Nothing ran.",
                "Split the " + what + " before the step at index " + at +
                    ": run the steps before it with " + up.tool() + ", then call " + step.command +
                    " on its own with the input they returned, so the client can ask the user.",
                Json{
                    {"reason", "input-not-known"}, {"step", step.index}, {"command", step.command}},
                std::nullopt),
            .approved = {}};
    }

    const std::int64_t now = state.options.clock->wall_ms();
    // Expiry must fit an ISO 8601 date, as on the single-command path.
    if (now < 0 || now > max_wall_ms) {
        return Plan{.refusal = clock_out_of_range(up.tool()), .approved = {}};
    }
    const auto actor = actor_binding(context.actor);
    if (!actor) {
        return Plan{.refusal = *unbindable(up.tool(), actor.error()).error, .approved = {}};
    }
    std::vector<GatedStep> gated;
    for (const auto& step : up.steps()) {
        if (step.dynamic || !step.input) {
            continue;
        }
        const Decider decider = state.decider(step.command, step.definition.get());
        if (!ApprovalState::requires_approval(decider, *step.input, context)) {
            continue;
        }
        const auto canonical = canonical_json(*step.input);
        if (!canonical) {
            return Plan{.refusal = input_not_canonical(step.command), .approved = {}};
        }
        gated.push_back(
            GatedStep{.index = step.index,
                      .command = step.command,
                      .input = *canonical,
                      .summary = state.summary(step.command, *step.input, context, decider),
                      .bindings = state.up_front_bindings(up, step.command, *canonical, *actor)});
        if (gated.size() > max_up_front_approvals) {
            const std::string limit = std::to_string(max_up_front_approvals);
            return Plan{
                .refusal = up_front_error(
                    "The " + what + " has more than " + limit +
                        " steps that need approval, more than the user can be asked "
                        "about at once. Nothing ran.",
                    "Split it into calls of " + up.tool() + " with at most " + limit +
                        " steps that need approval each.",
                    Json{{"reason", "too-many-approvals"}, {"limit", max_up_front_approvals}},
                    std::nullopt),
                .approved = {}};
        }
    }
    if (gated.empty()) {
        return Plan{};
    }

    const auto& answers = up.answers();
    const auto declined = std::any_of(gated.begin(), gated.end(), [&](const GatedStep& step) {
        return std::any_of(step.bindings.begin(), step.bindings.end(),
                           [&](const std::string& binding) {
                               return std::find(answers.declined.begin(), answers.declined.end(),
                                                binding) != answers.declined.end();
                           });
    });
    if (declined) {
        std::vector<std::string> names;
        std::string listed;
        for (const auto& step : gated) {
            if (std::find(names.begin(), names.end(), step.command) == names.end()) {
                names.push_back(step.command);
                listed += (listed.empty() ? "" : ", ") + step.command;
            }
        }
        return Plan{.refusal = up_front_error(
                        "The user did not approve " + listed + "; nothing in the " + what + " ran",
                        "Do not run this again without asking the user first; the user chose "
                        "not to approve it.",
                        Json{{"reason", "declined"}, {"summary", summaries(gated)}},
                        Recovery{.kind = RecoveryKind::stop}),
                    .approved = {}};
    }

    // Each gated step takes a distinct genuine acceptance of its own binding, so two identical
    // steps need two. The latest answer wins: later answers are read last.
    std::vector<detail::RelayAnswer> pool = answers.accepted;
    std::vector<detail::RelayAnswer> matched;
    for (const auto& step : gated) {
        auto found = pool.end();
        for (auto it = pool.begin(); it != pool.end(); ++it) {
            if (state.genuine(*it, step.bindings, now)) {
                found = it;
            }
        }
        if (found == pool.end()) {
            break;
        }
        matched.push_back(*found);
        pool.erase(found);
    }
    if (matched.size() == gated.size()) {
        // Spend every nonce before anything runs: a replay of this request runs nothing.
        bool fresh = true;
        for (const auto& answer : matched) {
            fresh = state.consume(answer.nonce, answer.expires_at_ms, now) && fresh;
        }
        if (fresh) {
            Plan plan;
            for (const auto& answer : matched) {
                plan.approved.emplace_back(answer.binding, false);
            }
            return plan;
        }
    }

    // Ask once for every gated step, saying why when earlier approvals did not hold.
    detail::UpFrontHold hold;
    for (const auto& step : gated) {
        hold.questions.push_back(state.question(step.bindings, now));
    }
    hold.message = steps_message(
        up, gated,
        answers.accepted.empty()
            ? std::string_view()
            : std::string_view("The earlier approval expired, was already used or no longer "
                               "matches; approve again to run it."));
    up.hold(std::move(hold));
    const std::string summary = summaries(gated);
    return Plan{.refusal = up_front_error(
                    "The " + what + " needs approval before it runs",
                    "Wait for the user to approve \"" + summary + "\" in the client.",
                    Json{{"summary", summary}}, Recovery{.kind = RecoveryKind::external}),
                .approved = {}};
}

/// One step of an up-front call: nothing runs until the plan is to run, and then a gated step
/// runs only on an unused approval of its own binding.
CommandResult run_up_front(ApprovalState& state, detail::UpFrontApproval& up, std::string_view name,
                           const Json& input, CommandContext& context, const Next& next) {
    const auto plan = up.plan([&] { return decide(state, up, context); });
    if (plan->refusal) {
        return failure(*plan->refusal);
    }
    if (!ApprovalState::requires_approval(state.decider(name, context), input, context)) {
        return next();
    }
    const auto canonical = canonical_json(input);
    if (!canonical) {
        return failure(input_not_canonical(name));
    }
    const auto actor = actor_binding(context.actor);
    if (actor && up.take(state.up_front_bindings(up, name, *canonical, *actor))) {
        return next();
    }
    // A gated step the human was not asked about up front (its policy changed its mind).
    return failure(up_front_error(
        std::string(name) + " needs approval before it runs",
        "Ask the user to approve it; the client could not be asked for this step of the " +
            std::string(noun(up.tool())) + ". Call " + std::string(name) +
            " on its own so the client can ask the user.",
        Json{{"summary", "Run " + std::string(name)}}, std::nullopt));
}

} // namespace

std::string_view approval_rejection_name(ApprovalRejection rejection) noexcept {
    switch (rejection) {
    case ApprovalRejection::malformed:
        return "malformed";
    case ApprovalRejection::invalid_signature:
        return "invalid-signature";
    case ApprovalRejection::expired:
        return "expired";
    case ApprovalRejection::command_mismatch:
        return "command-mismatch";
    case ApprovalRejection::input_mismatch:
        return "input-mismatch";
    case ApprovalRejection::actor_mismatch:
        return "actor-mismatch";
    case ApprovalRejection::already_used:
        return "already-used";
    }
    return "malformed";
}

namespace detail {

bool gates(const std::optional<ApprovalPolicy>& policy) noexcept {
    return policy && (policy->function() || policy->decision() != ApprovalDecision::not_required);
}

void admit_approval(CommandContext& context, const void* step, std::string_view name,
                    const Json& input, bool listed_gate) {
    ApprovalAdmission* record = context.approval_admission.get();
    if (!record) {
        return;
    }
    AdmittedCall admitted{
        .step = step, .name = std::string(name), .canonical = std::nullopt, .input = std::nullopt};
    if (auto encoded = canonical_json(input)) {
        admitted.canonical = std::move(*encoded);
    } else {
        // Only a policy that let the call through admits such an input: kept by value.
        admitted.input = input;
    }
    const std::lock_guard lock(record->mutex);
    if (listed_gate) {
        record->listed_gate = true;
    }
    if (std::find(record->steps.begin(), record->steps.end(), step) == record->steps.end()) {
        record->steps.push_back(step);
    }
    record->admitted.push_back(std::move(admitted));
}

void mark_listed_gate(CommandContext& context) {
    ApprovalAdmission* record = context.approval_admission.get();
    if (!record) {
        return;
    }
    const std::lock_guard lock(record->mutex);
    record->listed_gate = true;
}

bool needs_admission(ApprovalAdmission& record) {
    if (record.command && gates(record.command->approval)) {
        return true;
    }
    const std::lock_guard lock(record.mutex);
    return record.listed_gate;
}

AdmissionCheck take_admission(ApprovalAdmission& record, const CommandContext& context,
                              std::string_view name, const Json& input) {
    std::vector<AdmittedCall> admitted;
    {
        const std::lock_guard lock(record.mutex);
        if (record.admitted.empty()) {
            return record.taken ? AdmissionCheck::mismatch : AdmissionCheck::missing;
        }
        admitted.swap(record.admitted);
        record.taken = true;
        // Every step that ever admitted the call must have admitted it again for this dispatch.
        for (const void* step : record.steps) {
            if (std::none_of(admitted.begin(), admitted.end(),
                             [step](const AdmittedCall& call) { return call.step == step; })) {
                return AdmissionCheck::mismatch;
            }
        }
    }
    // A middleware may have put another call's record on the context: the admission must be on
    // the record the registry made for this dispatch, and that record must still be the call's.
    if (context.approval_admission.get() != &record) {
        return AdmissionCheck::mismatch;
    }
    std::optional<Expected<std::string>> canonical;
    for (const auto& step : admitted) {
        if (step.name != name) {
            return AdmissionCheck::mismatch;
        }
        bool same = false;
        if (step.canonical) {
            if (!canonical) {
                canonical = canonical_json(input);
            }
            same = *canonical && **canonical == *step.canonical;
        } else if (step.input) {
            same = *step.input == input;
        }
        if (!same) {
            return AdmissionCheck::mismatch;
        }
    }
    return AdmissionCheck::admitted;
}

} // namespace detail

Expected<CommandMiddleware> create_approval_middleware(ApprovalMiddlewareOptions options) {
    if (options.secrets.empty()) {
        return unexpected(std::string("Approval secret is required"));
    }
    for (const auto& secret : options.secrets) {
        if (secret.size() < min_secret_bytes) {
            return unexpected("Approval secret must be at least " +
                              std::to_string(min_secret_bytes) + " bytes");
        }
    }
    if (options.ttl_ms <= 0 || options.ttl_ms > max_ttl_ms) {
        return unexpected(std::string(
            "Approval ttl_ms must be a positive number of milliseconds, at most 24 hours"));
    }

    auto state = std::make_shared<ApprovalState>();
    for (auto& command : options.commands) {
        if (command.approval) {
            const ApprovalPolicyFunction* decide = command.approval->function();
            if (decide && !*decide) {
                return unexpected("Command '" + command.name +
                                  "' has an invalid approval policy: the function is empty");
            }
        }
        state->commands.insert_or_assign(command.name, command);
    }
    state->keys = options.secrets;
    state->ttl_ms = options.ttl_ms;
    state->single_use = options.replay == ApprovalReplay::single_use;
    state->nonce_store = options.nonce_store;
    if (!options.clock) {
        options.clock = std::make_shared<SystemClock>();
    }
    options.commands.clear();
    options.secrets.clear();
    state->options = std::move(options);

    return CommandMiddleware([state](std::string_view name, const Json& input,
                                     CommandContext& context,
                                     const Next& outer_next) -> CommandResult {
        // The policy of the command this call runs, and the one the `commands` option lists.
        const Decider decider = state->decider(name, context);
        // Every way this middleware lets a call it may gate through admits this command on this
        // input, which the registry checks, and takes, before it dispatches a command that its own
        // or its listed policy gates. A call no policy here gates is not admitted: an admission
        // from another approval step stands alone, and a retry placed after that step is still
        // refused.
        const bool may_gate = ApprovalState::may_require_approval(decider);
        const bool listed_gate = decider.listed && detail::gates(decider.listed->approval);
        // The command the registry runs, which a middleware before this one may have called it
        // under another name: its listed gate holds at dispatch either way, and a renamed call is
        // refused.
        if (const detail::ApprovalAdmission* record = context.approval_admission.get();
            record && record->command) {
            const auto live = state->commands.find(record->command->name);
            if (live != state->commands.end() && detail::gates(live->second.approval)) {
                detail::mark_listed_gate(context);
            }
        }
        const Next next = [&]() {
            if (may_gate) {
                detail::admit_approval(context, state.get(), name, input, listed_gate);
            }
            return outer_next();
        };
        // A step of an afd-batch or afd-pipe approved up front. The step never sees the up-front
        // approval, so a command it runs falls back as a nested command does.
        if (context.up_front_approval) {
            const auto up_front = std::move(context.up_front_approval);
            context.up_front_approval.reset();
            if (state->options.relay == ApprovalRelay::mcp_elicitation) {
                return run_up_front(*state, *up_front, name, input, context, next);
            }
        }
        // Claimed only by the command the tool call routes to, once, gated or not, so a command
        // that runs inside another (or after it) cannot turn the tool call into an elicitation.
        detail::McpApprovalRelay* relay = nullptr;
        if (state->options.relay == ApprovalRelay::mcp_elicitation && context.mcp_approval_relay &&
            context.mcp_approval_relay->claim(name)) {
            relay = context.mcp_approval_relay.get();
        }
        if (!ApprovalState::requires_approval(decider, input, context)) {
            return next();
        }
        const ApprovalMiddlewareOptions& settings = state->options;

        const auto input_binding = canonical_json(input);
        if (!input_binding) {
            return failure(input_not_canonical(name));
        }
        const auto actor = actor_binding(context.actor);
        if (!actor) {
            return unbindable(name, actor.error());
        }
        const std::int64_t now = settings.clock->wall_ms();
        // Expiry must fit an ISO 8601 date (years up to 9999), as `expiresAt` reports it.
        if (now < 0 || now > max_wall_ms) {
            return failure(clock_out_of_range(name));
        }

        std::optional<ApprovalRejection> rejected;
        const auto evidence =
            context.direct_approval ? context.direct_approval->take() : context.approval;
        if (evidence) {
            const Verdict verdict =
                state->verify_token(*evidence, name, *input_binding, *actor, now);
            if (!verdict.rejection) {
                if (state->consume(verdict.nonce, verdict.expires_at_ms, now)) {
                    return next();
                }
                rejected = ApprovalRejection::already_used;
            } else {
                rejected = verdict.rejection;
            }
        }

        const std::string summary = state->summary(name, input, context, decider);

        if (relay) {
            const auto bindings = state->relay_bindings(name, *input_binding, *actor);
            const detail::RelayAnswer answer = relay->answer(bindings);
            if (answer.kind == detail::RelayAnswer::Kind::decline) {
                return relay_declined(name, summary);
            }
            if (answer.kind == detail::RelayAnswer::Kind::accept &&
                state->relayed_approval_holds(answer, bindings, now)) {
                return next();
            }
            // An expired, spent or invalid approval is asked again, saying why.
            detail::RelayHold hold = state->question(bindings, now);
            hold.message = relay_message(
                summary, name, *input_binding,
                answer.kind == detail::RelayAnswer::Kind::accept
                    ? "The earlier approval expired or was already used; approve again to run it."
                    : "");
            const std::string expires_at = wire::iso8601_utc(hold.expires_at_ms);
            relay->hold(std::move(hold));
            // The server answers with the elicitation instead; this result is never sent.
            return failure(CommandError{
                .code = error_codes::APPROVAL_REQUIRED,
                .message = std::string(name) + " needs approval before it runs",
                .suggestion = "Wait for the user to approve \"" + summary + "\" in the client.",
                .retryable = false,
                .recovery = Recovery{.kind = RecoveryKind::external},
                .details = Json{{"expiresAt", expires_at}, {"summary", summary}},
                .cause = nullptr,
            });
        }

        std::int64_t expires_at_ms = 0;
        std::string token = state->issue(name, *input_binding, *actor, now, expires_at_ms);
        const std::string expires_at = wire::iso8601_utc(expires_at_ms);

        if (settings.on_approval_required) {
            settings.on_approval_required(ApprovalRequest{
                .command = std::string(name),
                .input = input,
                .actor = context.actor,
                .approval_token = token,
                .expires_at = expires_at,
                .summary = summary,
                .rejected = rejected,
            });
        }

        if (context.direct_approval) {
            context.direct_approval->deposit(
                {token, summary, expires_at,
                 rejected ? std::optional<std::string>(approval_rejection_name(*rejected))
                          : std::nullopt});
        }
        const bool on_mcp = context.surface == Interface::mcp;
        const bool include_token =
            settings.include_token.value_or(!on_mcp) && !context.direct_approval;
        // A relay was offered for this tool call but another command claimed it (or this one
        // runs inside another), so the client could not be asked for this command.
        const bool relay_elsewhere = settings.relay == ApprovalRelay::mcp_elicitation &&
                                     context.mcp_approval_relay != nullptr;
        const std::string why = rejected
                                    ? "The approval token was not accepted (" +
                                          std::string(approval_rejection_name(*rejected)) + "). "
                                    : "";
        // Addressed to whoever relays the decision: the token is the approval, so the gated
        // caller must not resubmit it on its own, and tool arguments cannot carry it.
        const std::string retry =
            include_token
                ? "once they approve, the application retries the same call with the same input "
                  "and details.approvalToken as its approval evidence (tool arguments cannot "
                  "carry it). The token expires at " +
                      expires_at + (state->single_use ? " and works once." : ".")
            : relay_elsewhere
                ? "the client could not be asked from inside afd-batch, afd-pipe or another "
                  "command. Call " +
                      std::string(name) + " on its own so the client can ask the user."
            : settings.relay == ApprovalRelay::mcp_elicitation && on_mcp
                ? "the client could not be asked here. Call " + std::string(name) +
                      " from an MCP client that supports form elicitation, or the application "
                      "records the approval and retries."
                : std::string(
                      "the application retries the same call once it has recorded the approval.");
        Json details = Json::object();
        if (include_token) {
            details["approvalToken"] = token;
        }
        details["expiresAt"] = expires_at;
        details["summary"] = summary;
        if (rejected) {
            details["reason"] = std::string(approval_rejection_name(*rejected));
        }
        return failure(CommandError{
            .code = error_codes::APPROVAL_REQUIRED,
            .message = std::string(name) + " needs approval before it runs",
            .suggestion = why + "Ask the user to approve \"" + summary + "\"; " + retry,
            .retryable = false,
            // A person approves, unless the suggestion has the caller call the command on its
            // own, outside the batch, pipeline or command that held it.
            .recovery = include_token || !relay_elsewhere
                            ? std::optional<Recovery>(Recovery{.kind = RecoveryKind::external})
                            : std::nullopt,
            .details = std::move(details),
            .cause = nullptr,
        });
    });
}

} // namespace afd
