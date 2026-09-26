// Stream chunk types (packages/core/src/streaming.ts). Stream execution comes in Phase 3.
#pragma once

#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <variant>

namespace afd {

/// Progress of a long-running command. Wire `type`: "progress".
struct ProgressChunk {
    /// 0 to 1.
    double progress = 0;
    std::optional<std::string> message;
    std::optional<std::int64_t> current_step;
    std::optional<std::int64_t> total_steps;
    std::optional<std::int64_t> items_processed;
    std::optional<std::int64_t> items_total;
    std::optional<double> estimated_time_remaining_ms;
    std::optional<std::string> phase;
};

/// One piece of streamed data. Wire `type`: "data".
struct DataChunk {
    Json data;
    std::int64_t index = 0;
    bool is_last = false;
    std::optional<std::string> chunk_id;
};

/// The end of a successful stream. Wire `type`: "complete".
struct CompleteChunk {
    /// `null` is a value; absence is `std::nullopt`.
    std::optional<Json> data;
    std::int64_t total_chunks = 0;
    double total_duration_ms = 0;
    std::optional<double> confidence;
    std::optional<std::string> reasoning;
    std::optional<ResultMetadata> metadata;
};

/// The end of a failed stream. Wire `type`: "error".
struct ErrorChunk {
    CommandError error;
    std::int64_t chunks_before_error = 0;
    bool recoverable = false;
    std::optional<std::int64_t> resume_from;
};

/// Any stream chunk, discriminated on the wire by `type`.
using StreamChunk = std::variant<ProgressChunk, DataChunk, CompleteChunk, ErrorChunk>;

/// Reads a chunk of any type from JSON without throwing.
Expected<StreamChunk> stream_chunk_from_json(const Json& value);

void to_json(Json& out, const ProgressChunk& chunk);
void to_json(Json& out, const DataChunk& chunk);
void to_json(Json& out, const CompleteChunk& chunk);
void to_json(Json& out, const ErrorChunk& chunk);
void to_json(Json& out, const StreamChunk& chunk);

} // namespace afd
