// Batch result types (packages/core/src/batch.ts). Request types and execution come in Phase 3.
#pragma once

#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace afd {

/// One command's outcome within a batch.
struct BatchCommandResult {
    /// The request's `id`, or `cmd-<index>`.
    std::string id;
    std::int64_t index = 0;
    std::string command;
    CommandResult result;
    double duration_ms = 0;
};

/// Counts over a batch. Only COMMAND_SKIPPED results count as skipped.
struct BatchSummary {
    std::int64_t total = 0;
    std::int64_t success_count = 0;
    std::int64_t failure_count = 0;
    std::int64_t skipped_count = 0;
};

/// Batch timing; timestamps are ISO 8601 (`wire::iso8601_utc`).
struct BatchTiming {
    double total_ms = 0;
    double average_ms = 0;
    std::string started_at;
    std::string completed_at;
};

/// A warning raised by one command in a batch.
struct BatchWarning {
    std::string command_id;
    std::string code;
    std::string message;
};

/// The result of a batch. `success` is false only when the request itself was rejected.
struct BatchResult {
    bool success = false;
    std::vector<BatchCommandResult> results;
    BatchSummary summary;
    BatchTiming timing;
    double confidence = 0;
    std::string reasoning;
    std::optional<std::vector<BatchWarning>> warnings;
    std::optional<CommandError> error;
    std::optional<ResultMetadata> metadata;

    static Expected<BatchResult> from_json(const Json& value);
};

void to_json(Json& out, const BatchCommandResult& result);
void to_json(Json& out, const BatchSummary& summary);
void to_json(Json& out, const BatchTiming& timing);
void to_json(Json& out, const BatchWarning& warning);
void to_json(Json& out, const BatchResult& result);

} // namespace afd
