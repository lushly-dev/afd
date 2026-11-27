// Private: the dispatch id (spec/dispatch.md, "The dispatch id") and the secure random bytes it
// and approval nonces are drawn from. Not installed.
#pragma once

#include "afd/command.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>

namespace afd::detail {

/// Fills `size` bytes at `out` with cryptographically secure random bytes; false when it could
/// not (`CommandRegistryOptions::random_bytes`).
using SecureRandomBytes = std::function<bool(std::uint8_t* out, std::size_t size)>;

/// The one way to set a `DispatchId`: `CommandRegistry::execute`, before any check.
struct DispatchIdAccess {
    static void set(DispatchId& id, std::string value) { id.value_ = std::move(value); }
};

/// `size` bytes from `std::random_device`, the platform's entropy source on glibc, libc++, MSVC
/// and Emscripten.
void system_random_bytes(std::uint8_t* out, std::size_t size);

/// A fresh dispatch id: 128 bits from `random_bytes` (`system_random_bytes` when empty), never a
/// context's `random`, as 22 characters of unpadded base64url. `std::nullopt` when the source
/// returned false or, in builds with exceptions, threw.
std::optional<std::string> new_dispatch_id(const SecureRandomBytes& random_bytes);

} // namespace afd::detail
