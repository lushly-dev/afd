// Fuzzy matching and truncation take untrusted names of any length and bytes.
#include "afd/similarity.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    static const std::vector<std::string> names{
        "todo-create", "todo-list", "todo-get", "user-get", "\xF0\x9F\x98\x80-emoji", ""};
    const std::string_view name(reinterpret_cast<const char*>(data), size);
    const auto matches = afd::find_similar_tools(name, names);
    if (matches.size() > 3) {
        __builtin_trap();
    }
    (void)afd::truncate_name(name);
    (void)afd::calculate_similarity(name, "todo-create");
    return 0;
}
