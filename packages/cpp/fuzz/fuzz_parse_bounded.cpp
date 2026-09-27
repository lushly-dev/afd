// parse_bounded must reject or accept any bytes without crashing, and an accepted document must be
// serializable (its depth is bounded).
#include "afd/json.hpp"

#include <cstddef>
#include <cstdint>
#include <string_view>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    const auto parsed = afd::parse_bounded(text, {.max_depth = 64, .max_bytes = 1 << 20});
    if (parsed) {
        (void)afd::wire::serialize(*parsed);
    }
    return 0;
}
