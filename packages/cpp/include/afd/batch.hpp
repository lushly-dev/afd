// Batch requests, results and execution (packages/core/src/batch.ts and command-execution.ts).
#pragma once

#include "afd/errors.hpp"
#include "afd/execution.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace afd {

/// One command in a batch request.
struct BatchCommand {
    /// Correlates the result; defaults to `cmd-<index>`.
    std::optional<std::string> id;
    std::string command;
    /// The command's input. An absent input is passed as `null`, which fails an object schema,
    /// as TypeScript passes `undefined`.
    std::optional<Json> input;
};

struct BatchOptions {
    /// Stop scheduling after the first failure; commands already running finish.
    std::optional<bool> stop_on_error;
    /// One deadline for the whole batch, in milliseconds.
    std::optional<double> timeout;
    /// How many commands may run at once (a positive integer). The runner decides whether they
    /// actually overlap.
    std::optional<std::int64_t> parallelism;
};

struct BatchRequest {
    std::vector<BatchCommand> commands;
    std::optional<BatchOptions> options;
};

/// Checks a batch envelope the way TypeScript's `isBatchRequest` does, before anything runs: a
/// non-empty list of commands with non-blank names and string IDs, a boolean `stopOnError`, a
/// finite `timeout` >= 0 and an integer `parallelism` > 0. Rejects with INVALID_BATCH_REQUEST.
Expected<BatchRequest, CommandError> parse_batch_request(const Json& request);

/// Whether `request` passes `parse_batch_request`.
bool is_batch_request(const Json& request);

/// Whether `value` has the shape of a BatchResult: `success`, `summary`, `timing` and a `results`
/// array.
bool is_batch_result(const Json& value);

/// A request whose commands without an ID get `cmd-<index>`.
BatchRequest create_batch_request(std::vector<BatchCommand> commands,
                                  std::optional<BatchOptions> options = std::nullopt);

void to_json(Json& out, const BatchCommand& command);
void to_json(Json& out, const BatchOptions& options);
void to_json(Json& out, const BatchRequest& request);

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

/// `successRatio * 0.5 + average successful confidence (default 1) * 0.5`; 1 for no results.
double calculate_batch_confidence(const std::vector<BatchCommandResult>& results);

/// Aggregates results: summary counts (only COMMAND_SKIPPED counts as skipped), confidence,
/// reasoning ("Executed 3 commands: 1 succeeded, 1 failed, 1 skipped"), warnings. `success` is
/// always true.
BatchResult create_batch_result(std::vector<BatchCommandResult> results, BatchTiming timing,
                                std::optional<ResultMetadata> metadata = std::nullopt);

/// The result for a rejected batch: `success: false`, no results, and `error`.
BatchResult create_failed_batch_result(CommandError error, BatchTiming timing);

/// Executes a batch with TypeScript's semantics:
///
/// - `min(parallelism, n)` workers pull commands in order, run through `options.runner`.
/// - `stopOnError` stops scheduling after a failure; unstarted commands get COMMAND_SKIPPED.
/// - `timeout` is one deadline for the batch. A command not started by then, or finishing after
///   it, gets BATCH_TIMEOUT, and so do the unstarted ones. Running commands see the deadline on
///   `context.cancellation`; they are never interrupted, so the batch returns when they do.
/// - Each command gets the trace ID `<context.trace_id or batch-<ms>>-<index>`.
/// - Results keep request order and IDs.
BatchResult execute_batch(const BatchRequest& request, const CommandExecutor& execute,
                          const CommandContext& context = {}, const ExecutorOptions& options = {});

/// `execute_batch` on a raw JSON envelope, validated first with `parse_batch_request`.
BatchResult execute_batch(const Json& request, const CommandExecutor& execute,
                          const CommandContext& context = {}, const ExecutorOptions& options = {});

void to_json(Json& out, const BatchCommandResult& result);
void to_json(Json& out, const BatchSummary& summary);
void to_json(Json& out, const BatchTiming& timing);
void to_json(Json& out, const BatchWarning& warning);
void to_json(Json& out, const BatchResult& result);

} // namespace afd
