// Any JSON read as each wire type must parse or be rejected, and a parsed value must re-serialize.
#include "afd/afd.hpp"

#include <cstddef>
#include <cstdint>
#include <string_view>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    const auto value = afd::parse_bounded(text, {.max_depth = 64, .max_bytes = 1 << 16});
    if (!value) {
        return 0;
    }
    if (const auto result = afd::CommandResult::from_json(*value)) {
        (void)afd::wire::serialize(afd::Json(*result));
    }
    if (const auto batch = afd::BatchResult::from_json(*value)) {
        (void)afd::wire::serialize(afd::Json(*batch));
    }
    if (const auto pipeline = afd::PipelineResult::from_json(*value)) {
        (void)afd::wire::serialize(afd::Json(*pipeline));
    }
    if (const auto chunk = afd::stream_chunk_from_json(*value)) {
        (void)afd::wire::serialize(afd::Json(*chunk));
    }
    if (const auto request = afd::parse_batch_request(*value)) {
        (void)afd::wire::serialize(afd::Json(*request));
    }
    return 0;
}
