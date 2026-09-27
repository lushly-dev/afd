// Any JSON as a pipeline request: envelope checks, references, conditions and execution must never
// crash, and every step must run through the executor with object input.
#include "afd/afd.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    const auto request = afd::parse_bounded(text, {.max_depth = 128, .max_bytes = 1 << 16});
    if (!request) {
        return 0;
    }
    const afd::CommandExecutor echo = [](std::string_view name, const afd::Json& input,
                                         afd::CommandContext&) {
        if (!input.is_object()) {
            __builtin_trap();
        }
        return name.size() % 2 == 0 ? afd::success(input)
                                    : afd::failure(afd::create_error("E", "odd"));
    };
    auto clock = std::make_shared<afd::ManualClock>();
    const auto result = afd::execute_pipeline(*request, echo, {}, {.clock = clock});
    (void)afd::wire::serialize(afd::Json(result));
    return 0;
}
