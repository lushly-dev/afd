// Stream chunks and stream execution (packages/core/src/streaming.ts and command-execution.ts).
#pragma once

#include "afd/errors.hpp"
#include "afd/execution.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"

#include <concepts>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <variant>
#include <vector>

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

/// A progress chunk, with `progress` clamped to 0..1.
ProgressChunk create_progress_chunk(double progress, ProgressChunk options = {});

DataChunk create_data_chunk(Json data, std::int64_t index, bool is_last,
                            std::optional<std::string> chunk_id = std::nullopt);

CompleteChunk create_complete_chunk(std::int64_t total_chunks, double total_duration_ms,
                                    CompleteChunk options = {});

ErrorChunk create_error_chunk(CommandError error, std::int64_t chunks_before_error,
                              bool recoverable = false,
                              std::optional<std::int64_t> resume_from = std::nullopt);

struct StreamOptions : ExecutorOptions {
    /// A deadline for the stream, in milliseconds (finite and >= 0).
    std::optional<double> timeout;
};

/// Runs a command and returns its result as stream chunks, as TypeScript's `executeStream`
/// yields them. The command runs to completion first. An array result then becomes one data
/// chunk per item, and any other result a single data chunk, followed by `complete`.
///
/// - An invalid `timeout` gives a VALIDATION_ERROR chunk.
/// - A token already cancelled gives STREAM_ABORTED.
/// - An exception gives STREAM_ERROR.
/// - A failure result gives an error chunk with its error, or COMMAND_FAILED.
/// - Cancellation, or passing the deadline, during or after execution gives STREAM_ABORTED or
///   STREAM_TIMEOUT, with `resumeFrom` once data chunks were emitted.
std::vector<StreamChunk> execute_stream(std::string_view name, const Json& input,
                                        const CommandExecutor& execute,
                                        const CommandContext& context = {},
                                        const StreamOptions& options = {});

struct StreamCallbacks {
    std::function<void(const ProgressChunk&)> on_progress;
    std::function<void(const DataChunk&)> on_data;
    std::function<void(const CompleteChunk&)> on_complete;
    std::function<void(const ErrorChunk&)> on_error;
};

/// Dispatches every chunk to its callback and returns the final complete or error chunk. A stream
/// without one ends in a synthetic STREAM_ENDED_UNEXPECTEDLY error chunk.
std::variant<CompleteChunk, ErrorChunk> consume_stream(const std::vector<StreamChunk>& chunks,
                                                       const StreamCallbacks& callbacks = {});

/// The data of every data chunk, or the first error chunk's error.
Expected<std::vector<Json>, CommandError>
collect_stream_data(const std::vector<StreamChunk>& chunks);

/// Reads a chunk of any type from JSON without throwing.
Expected<StreamChunk> stream_chunk_from_json(const Json& value);

void to_json(Json& out, const ProgressChunk& chunk);
void to_json(Json& out, const DataChunk& chunk);
void to_json(Json& out, const CompleteChunk& chunk);
void to_json(Json& out, const ErrorChunk& chunk);

/// Serializes whichever chunk `chunk` holds. A constrained template rather than a plain
/// `to_json(Json&, const StreamChunk&)` overload: a non-template overload taking the variant makes
/// every `Json j = value` consider converting `value` to a StreamChunk, which recursively asks
/// whether Json is constructible from `value` and breaks libstdc++ ("depends on itself").
template <class Chunk>
    requires std::same_as<Chunk, StreamChunk>
void to_json(Json& out, const Chunk& chunk) {
    std::visit([&out](const auto& alternative) { to_json(out, alternative); }, chunk);
}

} // namespace afd
