// parse_journal must reject or accept any bytes without crashing, and every journal it accepts
// must serialize and parse back to the same entries.
#include "afd/journal.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string_view>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    const afd::ParseLimits limits{.max_depth = 64, .max_bytes = 1 << 20};
    const auto entries = afd::parse_journal(text, limits);
    if (!entries) {
        return 0;
    }
    const auto again = afd::parse_journal(afd::serialize_journal(*entries), limits);
    if (!again || again->size() != entries->size()) {
        std::abort();
    }
    for (std::size_t i = 0; i < entries->size(); ++i) {
        if (afd::Json((*again)[i]) != afd::Json((*entries)[i])) {
            std::abort();
        }
    }
    return 0;
}
