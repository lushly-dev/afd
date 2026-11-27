// Idempotency keys (spec/idempotency.md): what a command declares about repeats, the key a caller
// sends, its form (K2) and the keys a batch or pipeline derives from it (K4). These are the shared
// definitions; the C++ engine does not yet validate or deliver keys, and has no idempotency step
// (https://github.com/lushly-dev/afd/issues/2676).
#pragma once

#include "afd/errors.hpp"

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace afd {

/// The `_meta` key a caller sends an idempotency key in (K1).
inline constexpr std::string_view afd_idempotency_key_meta_key = "dev.afd/idempotencyKey";

/// What a command declares about repeating a call (D1 to D5).
enum class IdempotencySupport {
    /// `natural`: a repeat leaves the same state as one call (a set, a delete by id).
    natural,
    /// `keyed`: a repeat that carries the same key and input is safe.
    keyed,
};

/// The wire spelling: `natural` or `keyed`.
inline constexpr std::string_view idempotency_support_name(IdempotencySupport support) noexcept {
    return support == IdempotencySupport::natural ? "natural" : "keyed";
}

/// Whether `value` is one of the declared values, `natural` or `keyed`.
inline constexpr bool is_idempotency_support(std::string_view value) noexcept {
    return value == "natural" || value == "keyed";
}

/// Whether `value` is a key a caller may send (K2): 1 to 200 characters, each one of
/// `A-Z a-z 0-9 . _ ~ -`. A derived key, which holds `:`, is not.
inline constexpr bool is_idempotency_key(std::string_view value) noexcept {
    if (value.empty() || value.size() > 200)
        return false;
    for (const char c : value) {
        const bool allowed = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                             (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '~' || c == '-';
        if (!allowed)
            return false;
    }
    return true;
}

/// A request whose items or steps run under derived keys (K4).
enum class IdempotencyRequestKind {
    /// An `afd-batch`: item `i` runs under `<key>:<i>`.
    batch,
    /// An `afd-pipe`: step `i` runs under `<key>:step:<i>`.
    pipeline,
};

/// The key the item or step at 0-based `index` of a batch or pipeline runs under, when the request
/// carried `base` (K4).
inline std::string derive_idempotency_key(std::string_view base, IdempotencyRequestKind kind,
                                          std::size_t index) {
    std::string key(base);
    key += kind == IdempotencyRequestKind::batch ? ":" : ":step:";
    key += std::to_string(index);
    return key;
}

/// The `VALIDATION_ERROR` for a key that is not of K2's form.
inline CommandError invalid_idempotency_key_error() {
    return create_error(
        error_codes::VALIDATION_ERROR, "The idempotency key is not valid",
        ErrorOptions{
            .suggestion = std::string("Send _meta[\"") + std::string(afd_idempotency_key_meta_key) +
                          "\"] as a string of 1 to 200 characters, each one of A-Z a-z 0-9 . _ ~ "
                          "-, or leave it out",
            .retryable = false,
            .recovery = std::nullopt,
            .details = Json{{"field", "idempotencyKey"},
                            {"meta", std::string(afd_idempotency_key_meta_key)}},
        });
}

} // namespace afd
