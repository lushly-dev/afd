#include "detail/dispatch_id.hpp"

#include <array>
#include <random>
#include <string_view>

#include "detail/exceptions.hpp"
#include "detail/hmac.hpp"

namespace afd::detail {

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

std::optional<std::string> new_dispatch_id(const SecureRandomBytes& random_bytes) {
    std::array<std::uint8_t, 16> bytes{};
#if AFD_HAS_EXCEPTIONS
    try {
#endif
        if (random_bytes) {
            if (!random_bytes(bytes.data(), bytes.size())) {
                return std::nullopt;
            }
        } else {
            system_random_bytes(bytes.data(), bytes.size());
        }
#if AFD_HAS_EXCEPTIONS
    } catch (...) {
        return std::nullopt;
    }
#endif
    return base64url_encode(
        std::string_view(reinterpret_cast<const char*>(bytes.data()), bytes.size()));
}

} // namespace afd::detail
