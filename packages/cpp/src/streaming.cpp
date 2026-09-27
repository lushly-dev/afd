#include "afd/streaming.hpp"

#include "detail/json_io.hpp"

namespace afd {
namespace {

bool read_chunk(const Json& value, const std::string& path, ProgressChunk& out,
                std::string& error) {
    detail::ObjectReader reader(value, path, error);
    reader.required("progress", out.progress);
    reader.optional("message", out.message);
    reader.optional("currentStep", out.current_step);
    reader.optional("totalSteps", out.total_steps);
    reader.optional("itemsProcessed", out.items_processed);
    reader.optional("itemsTotal", out.items_total);
    reader.optional("estimatedTimeRemainingMs", out.estimated_time_remaining_ms);
    reader.optional("phase", out.phase);
    return reader.ok();
}

bool read_chunk(const Json& value, const std::string& path, DataChunk& out, std::string& error) {
    detail::ObjectReader reader(value, path, error);
    std::optional<Json> data;
    reader.read_present("data", data);
    if (reader.ok() && !data) {
        detail::record(error, detail::child_path(path, "data"), "is required");
    }
    out.data = data.value_or(Json());
    reader.required("index", out.index);
    reader.required("isLast", out.is_last);
    reader.optional("chunkId", out.chunk_id);
    return reader.ok();
}

bool read_chunk(const Json& value, const std::string& path, CompleteChunk& out,
                std::string& error) {
    detail::ObjectReader reader(value, path, error);
    reader.read_present("data", out.data);
    reader.required("totalChunks", out.total_chunks);
    reader.required("totalDurationMs", out.total_duration_ms);
    reader.optional("confidence", out.confidence);
    reader.optional("reasoning", out.reasoning);
    reader.optional("metadata", out.metadata);
    return reader.ok();
}

bool read_chunk(const Json& value, const std::string& path, ErrorChunk& out, std::string& error) {
    detail::ObjectReader reader(value, path, error);
    reader.required("error", out.error);
    reader.required("chunksBeforeError", out.chunks_before_error);
    reader.required("recoverable", out.recoverable);
    reader.optional("resumeFrom", out.resume_from);
    return reader.ok();
}

template <class Chunk>
bool read_into(const Json& value, const std::string& path, StreamChunk& out, std::string& error) {
    Chunk chunk{};
    if (!read_chunk(value, path, chunk, error)) {
        return false;
    }
    out = std::move(chunk);
    return true;
}

} // namespace

namespace detail {

bool read_value(const Json& value, const std::string& path, StreamChunk& out, std::string& error) {
    ObjectReader reader(value, path, error);
    std::string type;
    reader.required("type", type);
    if (!reader.ok()) {
        return false;
    }
    if (type == "progress") {
        return read_into<ProgressChunk>(value, path, out, error);
    }
    if (type == "data") {
        return read_into<DataChunk>(value, path, out, error);
    }
    if (type == "complete") {
        return read_into<CompleteChunk>(value, path, out, error);
    }
    if (type == "error") {
        return read_into<ErrorChunk>(value, path, out, error);
    }
    record(error, child_path(path, "type"), "unknown chunk type '" + type + "'");
    return false;
}

} // namespace detail

Expected<StreamChunk> stream_chunk_from_json(const Json& value) {
    return detail::parse_document<StreamChunk>(value);
}

void to_json(Json& out, const ProgressChunk& chunk) {
    out = Json::object();
    out["type"] = "progress";
    out["progress"] = wire::number(chunk.progress);
    detail::put(out, "message", chunk.message);
    detail::put(out, "currentStep", chunk.current_step);
    detail::put(out, "totalSteps", chunk.total_steps);
    detail::put(out, "itemsProcessed", chunk.items_processed);
    detail::put(out, "itemsTotal", chunk.items_total);
    detail::put(out, "estimatedTimeRemainingMs", chunk.estimated_time_remaining_ms);
    detail::put(out, "phase", chunk.phase);
}

void to_json(Json& out, const DataChunk& chunk) {
    out = Json::object();
    out["type"] = "data";
    out["data"] = chunk.data;
    out["index"] = chunk.index;
    out["isLast"] = chunk.is_last;
    detail::put(out, "chunkId", chunk.chunk_id);
}

void to_json(Json& out, const CompleteChunk& chunk) {
    out = Json::object();
    out["type"] = "complete";
    detail::put(out, "data", chunk.data);
    out["totalChunks"] = chunk.total_chunks;
    out["totalDurationMs"] = wire::number(chunk.total_duration_ms);
    detail::put(out, "confidence", chunk.confidence);
    detail::put(out, "reasoning", chunk.reasoning);
    detail::put(out, "metadata", chunk.metadata);
}

void to_json(Json& out, const ErrorChunk& chunk) {
    out = Json::object();
    out["type"] = "error";
    out["error"] = chunk.error;
    out["chunksBeforeError"] = chunk.chunks_before_error;
    out["recoverable"] = chunk.recoverable;
    detail::put(out, "resumeFrom", chunk.resume_from);
}

} // namespace afd
