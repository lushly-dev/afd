// Stream execution and helpers (packages/core/src/command-execution.ts `executeStream`,
// streaming.ts).
#include "afd/streaming.hpp"

#include <algorithm>
#include <cmath>

#include "detail/exceptions.hpp"
#include "detail/json_io.hpp"

namespace afd {
namespace {

enum class StreamPhase { starting, execution, data };

ErrorChunk aborted_chunk(StreamPhase phase, std::int64_t chunks_emitted) {
    const char* message = phase == StreamPhase::starting    ? "Stream was aborted before starting"
                          : phase == StreamPhase::execution ? "Stream was aborted during execution"
                                                            : "Stream was aborted";
    return create_error_chunk(
        create_error(error_codes::STREAM_ABORTED, message,
                     {.suggestion = "Start the stream again if the result is still needed",
                      .retryable = true}),
        chunks_emitted, true,
        phase == StreamPhase::data ? std::optional<std::int64_t>(chunks_emitted) : std::nullopt);
}

ErrorChunk timeout_chunk(double timeout_ms, std::int64_t chunks_emitted,
                         std::optional<std::int64_t> resume_from) {
    return create_error_chunk(
        create_error(error_codes::STREAM_TIMEOUT,
                     "Stream timed out after " + detail::format_number(timeout_ms) + "ms",
                     {.suggestion = "Increase the stream timeout, or request less data, and retry",
                      .retryable = true}),
        chunks_emitted, true, resume_from);
}

} // namespace

bool is_progress_chunk(const StreamChunk& chunk) noexcept {
    return std::holds_alternative<ProgressChunk>(chunk);
}

bool is_data_chunk(const StreamChunk& chunk) noexcept {
    return std::holds_alternative<DataChunk>(chunk);
}

bool is_complete_chunk(const StreamChunk& chunk) noexcept {
    return std::holds_alternative<CompleteChunk>(chunk);
}

bool is_error_chunk(const StreamChunk& chunk) noexcept {
    return std::holds_alternative<ErrorChunk>(chunk);
}

bool is_stream_chunk(const Json& value) {
    if (!value.is_object()) {
        return false;
    }
    const auto type = value.find("type");
    return type != value.end() &&
           (*type == "progress" || *type == "data" || *type == "complete" || *type == "error");
}

ProgressChunk create_progress_chunk(double progress, ProgressChunk options) {
    options.progress = (std::max)(0.0, (std::min)(1.0, progress));
    return options;
}

DataChunk create_data_chunk(Json data, std::int64_t index, bool is_last,
                            std::optional<std::string> chunk_id) {
    DataChunk chunk;
    chunk.data = std::move(data);
    chunk.index = index;
    chunk.is_last = is_last;
    // TypeScript spreads `chunkId && { chunkId }`, so an empty ID is dropped.
    if (chunk_id && !chunk_id->empty()) {
        chunk.chunk_id = std::move(chunk_id);
    }
    return chunk;
}

CompleteChunk create_complete_chunk(std::int64_t total_chunks, double total_duration_ms,
                                    CompleteChunk options) {
    options.total_chunks = total_chunks;
    options.total_duration_ms = total_duration_ms;
    return options;
}

ErrorChunk create_error_chunk(CommandError error, std::int64_t chunks_before_error,
                              bool recoverable, std::optional<std::int64_t> resume_from) {
    ErrorChunk chunk;
    chunk.error = std::move(error);
    chunk.chunks_before_error = chunks_before_error;
    chunk.recoverable = recoverable;
    chunk.resume_from = resume_from;
    return chunk;
}

std::vector<StreamChunk> execute_stream(std::string_view name, const Json& input,
                                        const CommandExecutor& execute,
                                        const CommandContext& context,
                                        const StreamOptions& options) {
    const std::optional<double> timeout = options.timeout;
    if (timeout && !(std::isfinite(*timeout) && *timeout >= 0)) {
        return {create_error_chunk(
            create_error(error_codes::VALIDATION_ERROR,
                         "Stream timeout must be a nonnegative finite number of milliseconds",
                         {.suggestion = "Pass a timeout such as 30000, or omit it for no deadline",
                          .retryable = false}),
            0, false)};
    }
    if (context.cancellation.is_cancelled()) {
        return {aborted_chunk(StreamPhase::starting, 0)};
    }

    const auto clock = options.clock ? options.clock : std::make_shared<SystemClock>();
    const double start = clock->steady_ms();
    CancellationSource cancellation(
        context.cancellation, timeout ? std::optional<double>(start + *timeout) : std::nullopt,
        clock);
    const CancellationToken token = cancellation.token();
    // Why the stream stopped: the deadline when it passed, otherwise the caller's cancellation.
    const auto stopped = [&](StreamPhase phase, std::int64_t emitted) -> StreamChunk {
        if (timeout && token.deadline_passed()) {
            return timeout_chunk(*timeout, emitted,
                                 phase == StreamPhase::data ? std::optional<std::int64_t>(emitted)
                                                            : std::nullopt);
        }
        return aborted_chunk(phase, emitted);
    };

    CommandContext stream_context = context;
    stream_context.cancellation = token;
    CommandResult result;
#if AFD_HAS_EXCEPTIONS
    try {
        result = execute(name, input, stream_context);
    } catch (const std::exception& error) {
        return {create_error_chunk(
            create_error(error_codes::STREAM_ERROR,
                         options.dev_mode ? error.what() : "Stream execution failed",
                         {.suggestion = "Retry the stream; contact support if this persists",
                          .retryable = true}),
            0, true)};
    } catch (...) {
        return {create_error_chunk(
            create_error(error_codes::STREAM_ERROR, "Stream execution failed",
                         {.suggestion = "Retry the stream; contact support if this persists",
                          .retryable = true}),
            0, true)};
    }
#else
    result = execute(name, input, stream_context);
#endif

    if (token.is_cancelled()) {
        return {stopped(StreamPhase::execution, 0)};
    }
    if (!result.success) {
        CommandError error = result.error.value_or(
            create_error(error_codes::COMMAND_FAILED, "Command execution failed",
                         {.suggestion = "Check the command input and try again"}));
        const bool recoverable = error.retryable.value_or(false);
        return {create_error_chunk(std::move(error), 0, recoverable)};
    }

    std::vector<Json> items;
    if (result.data && result.data->is_array()) {
        items.assign(result.data->begin(), result.data->end());
    } else {
        // A success without data streams one data chunk; `data` is null on the wire.
        items.push_back(result.data.value_or(Json()));
    }
    std::vector<StreamChunk> chunks;
    std::int64_t emitted = 0;
    for (std::size_t index = 0; index < items.size(); ++index) {
        if (token.is_cancelled()) {
            chunks.push_back(stopped(StreamPhase::data, emitted));
            return chunks;
        }
        chunks.push_back(create_data_chunk(
            std::move(items[index]), static_cast<std::int64_t>(index), index + 1 == items.size()));
        ++emitted;
    }
    CompleteChunk complete;
    complete.confidence = result.confidence;
    complete.reasoning = result.reasoning;
    complete.metadata = result.metadata;
    chunks.push_back(
        create_complete_chunk(emitted, clock->steady_ms() - start, std::move(complete)));
    return chunks;
}

std::variant<CompleteChunk, ErrorChunk> consume_stream(const std::vector<StreamChunk>& chunks,
                                                       const StreamCallbacks& callbacks) {
    std::optional<std::variant<CompleteChunk, ErrorChunk>> last;
    for (const auto& chunk : chunks) {
        if (const auto* progress = std::get_if<ProgressChunk>(&chunk)) {
            if (callbacks.on_progress) {
                callbacks.on_progress(*progress);
            }
        } else if (const auto* data = std::get_if<DataChunk>(&chunk)) {
            if (callbacks.on_data) {
                callbacks.on_data(*data);
            }
        } else if (const auto* complete = std::get_if<CompleteChunk>(&chunk)) {
            if (callbacks.on_complete) {
                callbacks.on_complete(*complete);
            }
            last = *complete;
        } else if (const auto* error = std::get_if<ErrorChunk>(&chunk)) {
            if (callbacks.on_error) {
                callbacks.on_error(*error);
            }
            last = *error;
        }
    }
    if (last) {
        return *last;
    }
    return create_error_chunk(
        create_error(
            error_codes::STREAM_ENDED_UNEXPECTEDLY,
            "Stream ended without completion or error signal",
            {.suggestion = "This may indicate a connection issue. Try again.", .retryable = true}),
        0, true);
}

Expected<std::vector<Json>, CommandError>
collect_stream_data(const std::vector<StreamChunk>& chunks) {
    std::vector<Json> items;
    for (const auto& chunk : chunks) {
        if (const auto* data = std::get_if<DataChunk>(&chunk)) {
            items.push_back(data->data);
        } else if (const auto* error = std::get_if<ErrorChunk>(&chunk)) {
            return unexpected(error->error);
        }
    }
    return items;
}

} // namespace afd
