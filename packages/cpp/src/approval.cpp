#include "afd/approval.hpp"

#include "afd/errors.hpp"
#include "afd/result.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <mutex>
#include <random>
#include <utility>

#include "detail/direct_approval.hpp"
#include "detail/hmac.hpp"
#include "detail/utf8.hpp"

namespace afd {

namespace {

constexpr std::string_view token_prefix = "afdap1";
constexpr std::size_t min_secret_bytes = 32;
constexpr std::int64_t max_ttl_ms = std::int64_t{24} * 60 * 60 * 1000;
/// Longer evidence is rejected unread, so a caller cannot make the server hash megabytes.
constexpr std::size_t max_token_length = 1024;
constexpr std::size_t max_canonical_depth = 256;
constexpr std::int64_t max_safe_integer = 9007199254740991; // 2^53 - 1

// --- canonical JSON ---------------------------------------------------------------------------

/// Whether `text` is valid UTF-8. `decode_utf8` reports an invalid byte as a one-byte U+FFFD.
bool is_valid_utf8(std::string_view text) {
    for (std::size_t i = 0; i < text.size();) {
        const detail::DecodedChar decoded = detail::decode_utf8(text, i);
        if (decoded.code_point == 0xFFFD && decoded.byte_length == 1) {
            return false;
        }
        i += decoded.byte_length;
    }
    return true;
}

/// `text` (valid UTF-8) as UTF-16 code units, for ordering keys as JavaScript's `sort` does.
std::u16string to_utf16(std::string_view text) {
    std::u16string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size();) {
        const detail::DecodedChar decoded = detail::decode_utf8(text, i);
        if (decoded.code_point >= 0x10000) {
            const char32_t offset = decoded.code_point - 0x10000;
            out.push_back(static_cast<char16_t>(0xD800 + (offset >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00 + (offset & 0x3FF)));
        } else {
            out.push_back(static_cast<char16_t>(decoded.code_point));
        }
        i += decoded.byte_length;
    }
    return out;
}

/// A JSON string as `JSON.stringify` writes it. `text` must be valid UTF-8.
void append_string(std::string& out, std::string_view text) {
    static constexpr char hex[] = "0123456789abcdef";
    out.push_back('"');
    for (const char c : text) {
        const auto byte = static_cast<unsigned char>(c);
        switch (c) {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\b':
            out += "\\b";
            break;
        case '\f':
            out += "\\f";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            if (byte < 0x20) {
                out += "\\u00";
                out.push_back(hex[byte >> 4]);
                out.push_back(hex[byte & 0xFU]);
            } else {
                out.push_back(c);
            }
        }
    }
    out.push_back('"');
}

/// A finite, non-integral (or beyond 2^53) double as JavaScript's `Number.prototype.toString`
/// writes it: the fewest significant digits that read back as the same double, the closest such
/// decimal, laid out by ECMA-262's Number::toString rules. At each precision the correctly
/// rounded `%.*e` is tried, then its neighbours one unit in the last digit away: at a power of
/// two the gap below is half the gap above, so a farther decimal can round-trip where the
/// nearest does not. Candidates are read back as `<integer>e<exponent>` and only digits are
/// taken from the formatted text, so the locale's decimal separator does not matter. `value`
/// must be finite and nonzero (zero is written as an integer before it gets here).
std::string format_double(double value) {
    std::string sign;
    if (value < 0) {
        sign = "-";
        value = -value;
    }
    std::uint64_t mantissa = 0;
    int scale = 0; // value = mantissa × 10^scale
    for (int precision = 1; precision <= 17; ++precision) {
        char buffer[64];
        std::snprintf(buffer, sizeof buffer, "%.*e", precision - 1, value);
        std::uint64_t nearest = 0;
        int exponent = 0;
        const char* c = buffer;
        for (; *c != '\0' && *c != 'e' && *c != 'E'; ++c) {
            if (*c >= '0' && *c <= '9') {
                nearest = nearest * 10 + static_cast<std::uint64_t>(*c - '0');
            }
        }
        if (*c != '\0') {
            ++c;
            const bool negative = *c == '-';
            if (*c == '-' || *c == '+') {
                ++c;
            }
            for (; *c >= '0' && *c <= '9'; ++c) {
                exponent = exponent * 10 + (*c - '0');
            }
            exponent = negative ? -exponent : exponent;
        }
        scale = exponent - (precision - 1);
        const auto round_trips = [&](std::uint64_t candidate) {
            if (candidate == 0) {
                return false;
            }
            const std::string text = std::to_string(candidate) + "e" + std::to_string(scale);
            return std::strtod(text.c_str(), nullptr) == value;
        };
        if (round_trips(nearest) || precision == 17) {
            mantissa = nearest;
            break;
        }
        if (round_trips(nearest - 1)) {
            mantissa = nearest - 1;
            break;
        }
        if (round_trips(nearest + 1)) {
            mantissa = nearest + 1;
            break;
        }
    }
    std::string digits = std::to_string(mantissa);
    // value = 0.<digits> × 10^n.
    const int n = static_cast<int>(digits.size()) + scale;
    digits.erase(digits.find_last_not_of('0') + 1);
    const int k = static_cast<int>(digits.size());

    std::string out = sign;
    if (k <= n && n <= 21) {
        out += digits;
        out.append(static_cast<std::size_t>(n - k), '0');
    } else if (0 < n && n <= 21) {
        out += digits.substr(0, static_cast<std::size_t>(n));
        out += '.';
        out += digits.substr(static_cast<std::size_t>(n));
    } else if (-6 < n && n <= 0) {
        out += "0.";
        out.append(static_cast<std::size_t>(-n), '0');
        out += digits;
    } else {
        out += digits.front();
        if (k > 1) {
            out += '.';
            out += digits.substr(1);
        }
        const int e = n - 1;
        out += e < 0 ? "e-" : "e+";
        out += std::to_string(e < 0 ? -e : e);
    }
    return out;
}

/// An integer written as `text`, whose nearest double is `nearest`. Beyond 2^53 − 1 JavaScript
/// holds only the double, which it writes with as few digits as identify it (2^60 is
/// `1152921504606847000`). An integer is accepted there only when `text` is that spelling, so
/// two distinct integers can never share one; anything else could not have come from
/// JavaScript, and is refused.
std::optional<std::string> encode_integer(const std::string& text, double nearest, bool safe,
                                          std::string& out) {
    if (!safe && format_double(nearest) != text) {
        return std::string("an integer beyond 2^53 - 1 that JavaScript would write differently");
    }
    out += text;
    return std::nullopt;
}

/// Appends the canonical JSON of `value` to `out`; returns why it cannot, if it cannot.
std::optional<std::string> encode(const Json& value, std::string& out, std::size_t depth) {
    if (depth > max_canonical_depth) {
        return std::string("the input is nested deeper than 256 levels");
    }
    switch (value.type()) {
    case Json::value_t::null:
        out += "null";
        return std::nullopt;
    case Json::value_t::boolean:
        out += value.get<bool>() ? "true" : "false";
        return std::nullopt;
    case Json::value_t::number_integer: {
        const auto number = value.get<std::int64_t>();
        return encode_integer(std::to_string(number), static_cast<double>(number),
                              number <= max_safe_integer && number >= -max_safe_integer, out);
    }
    case Json::value_t::number_unsigned: {
        const auto number = value.get<std::uint64_t>();
        return encode_integer(std::to_string(number), static_cast<double>(number),
                              number <= static_cast<std::uint64_t>(max_safe_integer), out);
    }
    case Json::value_t::number_float: {
        const auto number = value.get<double>();
        if (!std::isfinite(number)) {
            return std::string("a non-finite number has no JSON form");
        }
        if (std::trunc(number) == number &&
            std::fabs(number) <= static_cast<double>(max_safe_integer)) {
            out += std::to_string(static_cast<std::int64_t>(number)); // -0 is "0", as in JavaScript
        } else {
            out += format_double(number);
        }
        return std::nullopt;
    }
    case Json::value_t::string: {
        const auto& text = value.get_ref<const std::string&>();
        if (!is_valid_utf8(text)) {
            return std::string("a string is not valid UTF-8");
        }
        append_string(out, text);
        return std::nullopt;
    }
    case Json::value_t::array: {
        out.push_back('[');
        bool first = true;
        for (const auto& item : value) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            if (auto failed = encode(item, out, depth + 1)) {
                return failed;
            }
        }
        out.push_back(']');
        return std::nullopt;
    }
    case Json::value_t::object: {
        std::vector<std::pair<std::u16string, const std::string*>> keys;
        keys.reserve(value.size());
        for (auto it = value.begin(); it != value.end(); ++it) {
            if (!is_valid_utf8(it.key())) {
                return std::string("an object key is not valid UTF-8");
            }
            keys.emplace_back(to_utf16(it.key()), &it.key());
        }
        std::sort(keys.begin(), keys.end(),
                  [](const auto& a, const auto& b) { return a.first < b.first; });
        out.push_back('{');
        bool first = true;
        for (const auto& [ordering, key] : keys) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            append_string(out, *key);
            out.push_back(':');
            if (auto failed = encode(*value.find(*key), out, depth + 1)) {
                return failed;
            }
        }
        out.push_back('}');
        return std::nullopt;
    }
    case Json::value_t::binary:
        return std::string("binary values have no JSON form");
    case Json::value_t::discarded:
        break;
    }
    return std::string("a discarded value has no JSON form");
}

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

struct ApprovalState {
    std::vector<std::string> keys;
    std::map<std::string, ApprovalCommand, std::less<>> commands;
    std::int64_t ttl_ms = 0;
    bool single_use = true;
    std::shared_ptr<ApprovalNonceStore> nonce_store;
    MemoryNonceStore memory_store;
    ApprovalMiddlewareOptions options;

    bool requires_approval(const ApprovalCommand* command, const Json& input,
                           const CommandContext& context) const {
        if (!command || !command->approval) {
            return false;
        }
        const ApprovalPolicyFunction* decide = command->approval->function();
        if (!decide) {
            return command->approval->decision() != ApprovalDecision::not_required;
        }
        // Fail closed: anything but an explicit not_required holds the call.
        return !*decide || (*decide)(input, context) != ApprovalDecision::not_required;
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
        append_string(payload, command);
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

Expected<std::string> canonical_json(const Json& value) {
    std::string out;
    if (auto failed = encode(value, out, 1)) {
        return unexpected("Cannot bind an approval to this value: " + *failed);
    }
    return out;
}

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
                                     CommandContext& context, const Next& next) -> CommandResult {
        const auto found = state->commands.find(name);
        const ApprovalCommand* command = found == state->commands.end() ? nullptr : &found->second;
        if (!state->requires_approval(command, input, context)) {
            return next();
        }
        const ApprovalMiddlewareOptions& settings = state->options;

        const auto input_binding = canonical_json(input);
        if (!input_binding) {
            return unbindable(name, input_binding.error());
        }
        const auto actor = actor_binding(context.actor);
        if (!actor) {
            return unbindable(name, actor.error());
        }
        const std::int64_t now = settings.clock->wall_ms();
        // Expiry must fit an ISO 8601 date (years up to 9999), as `expiresAt` reports it.
        constexpr std::int64_t max_wall_ms = 253402300799999 - max_ttl_ms; // 9999-12-31, less a day
        if (now < 0 || now > max_wall_ms) {
            return failure(CommandError{
                .code = error_codes::COMMAND_EXECUTION_ERROR,
                .message = std::string(name) + " cannot be approved: the approval clock is out "
                                               "of range",
                .suggestion = "Give the approval middleware a clock that reads the current time.",
                .retryable = false,
                .details = std::nullopt,
                .cause = nullptr,
            });
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

        std::int64_t expires_at_ms = 0;
        std::string token = state->issue(name, *input_binding, *actor, now, expires_at_ms);
        const std::string expires_at = wire::iso8601_utc(expires_at_ms);
        std::string summary;
        if (settings.summarize) {
            summary = settings.summarize(name, input, context).value_or("");
        }
        if (summary.empty() && command->confirm_prompt) {
            summary = *command->confirm_prompt;
        }
        if (summary.empty()) {
            summary = "Run " + std::string(name);
        }

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
        const bool include_token = settings.include_token && !context.direct_approval;
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
                : "the application retries the same call once it has recorded the approval.";
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
            .details = std::move(details),
            .cause = nullptr,
        });
    });
}

} // namespace afd
