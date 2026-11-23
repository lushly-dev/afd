// parse_skill_frontmatter must reject or accept any untrusted byte stream without crashing,
// and an accepted frontmatter mapping must serialize cleanly with bounded depth.
#include "afd/json.hpp"

#include <cstddef>
#include <cstdint>
#include <string_view>

#include "mcp_stdio/frontmatter.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    const auto parsed = afd::mcp::surface::parse_skill_frontmatter(text);
    if (parsed) {
        (void)afd::wire::serialize(*parsed);
    }
    return 0;
}
