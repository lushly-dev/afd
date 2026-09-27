#include "afd/batch.hpp"

#include "detail/json_io.hpp"

namespace afd {
namespace detail {

bool read_value(const Json& value, const std::string& path, BatchCommandResult& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("id", out.id);
    reader.required("index", out.index);
    reader.required("command", out.command);
    reader.required("result", out.result);
    reader.required("durationMs", out.duration_ms);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, BatchSummary& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("total", out.total);
    reader.required("successCount", out.success_count);
    reader.required("failureCount", out.failure_count);
    reader.required("skippedCount", out.skipped_count);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, BatchTiming& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("totalMs", out.total_ms);
    reader.required("averageMs", out.average_ms);
    reader.required("startedAt", out.started_at);
    reader.required("completedAt", out.completed_at);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, BatchWarning& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("commandId", out.command_id);
    reader.required("code", out.code);
    reader.required("message", out.message);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, BatchResult& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("success", out.success);
    reader.required("results", out.results);
    reader.required("summary", out.summary);
    reader.required("timing", out.timing);
    reader.required("confidence", out.confidence);
    reader.required("reasoning", out.reasoning);
    reader.optional("warnings", out.warnings);
    reader.optional("error", out.error);
    reader.optional("metadata", out.metadata);
    return reader.ok();
}

} // namespace detail

Expected<BatchResult> BatchResult::from_json(const Json& value) {
    return detail::parse_document<BatchResult>(value);
}

void to_json(Json& out, const BatchCommandResult& result) {
    out = Json::object();
    out["id"] = result.id;
    out["index"] = result.index;
    out["command"] = result.command;
    out["result"] = result.result;
    out["durationMs"] = wire::number(result.duration_ms);
}

void to_json(Json& out, const BatchSummary& summary) {
    out = Json{{"total", summary.total},
               {"successCount", summary.success_count},
               {"failureCount", summary.failure_count},
               {"skippedCount", summary.skipped_count}};
}

void to_json(Json& out, const BatchTiming& timing) {
    out = Json{{"totalMs", wire::number(timing.total_ms)},
               {"averageMs", wire::number(timing.average_ms)},
               {"startedAt", timing.started_at},
               {"completedAt", timing.completed_at}};
}

void to_json(Json& out, const BatchWarning& warning) {
    out = Json{
        {"commandId", warning.command_id}, {"code", warning.code}, {"message", warning.message}};
}

void to_json(Json& out, const BatchResult& result) {
    out = Json::object();
    out["success"] = result.success;
    out["results"] = result.results;
    out["summary"] = result.summary;
    out["timing"] = result.timing;
    out["confidence"] = wire::number(result.confidence);
    out["reasoning"] = result.reasoning;
    detail::put(out, "warnings", result.warnings);
    detail::put(out, "error", result.error);
    detail::put(out, "metadata", result.metadata);
}

} // namespace afd
