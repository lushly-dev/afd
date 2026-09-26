// Batch execution (packages/core/src/command-execution.ts `executeBatch`, batch.ts aggregation).
#include "afd/batch.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <mutex>

#include "detail/exceptions.hpp"
#include "detail/json_io.hpp"
#include "detail/utf8.hpp"

namespace afd {
namespace {

constexpr char invalid_batch_suggestion[] =
    "Provide at least one command with a nonempty command name and optional string ID, and valid "
    "boolean stopOnError, nonnegative timeout, and positive integer parallelism options";

double round2(double ms) {
    return std::round(ms * 100) / 100;
}

std::shared_ptr<const Clock> clock_of(const ExecutorOptions& options) {
    return options.clock ? options.clock : std::make_shared<SystemClock>();
}

CommandError invalid_batch_error() {
    return create_error(error_codes::INVALID_BATCH_REQUEST, "Invalid batch request envelope",
                        {.suggestion = invalid_batch_suggestion});
}

BatchResult rejected(const Clock& clock) {
    const std::string now = wire::iso8601_utc(clock.wall_ms());
    return create_failed_batch_result(
        invalid_batch_error(),
        {.total_ms = 0, .average_ms = 0, .started_at = now, .completed_at = now});
}

bool valid_options(const BatchOptions& options) {
    if (options.timeout && !(std::isfinite(*options.timeout) && *options.timeout >= 0)) {
        return false;
    }
    return !options.parallelism || *options.parallelism > 0;
}

bool valid_request(const BatchRequest& request) {
    if (request.commands.empty()) {
        return false;
    }
    for (const auto& command : request.commands) {
        if (detail::is_blank(command.command)) {
            return false;
        }
    }
    return !request.options || valid_options(*request.options);
}

// Runs one command and turns an escaping exception into a result (TypeScript's `settle`).
CommandResult settle(const CommandExecutor& execute, std::string_view name, const Json& input,
                     CommandContext& context, bool dev_mode) {
#if AFD_HAS_EXCEPTIONS
    try {
        return execute(name, input, context);
    } catch (const std::exception& error) {
        return execution_failure(error.what(), dev_mode);
    } catch (...) {
        return execution_failure("unknown exception", dev_mode);
    }
#else
    (void)dev_mode;
    return execute(name, input, context);
#endif
}

std::string reasoning_for(const BatchSummary& summary) {
    std::string out =
        "Executed " + std::to_string(summary.total) + " command" + (summary.total == 1 ? "" : "s");
    if (summary.success_count == summary.total) {
        return out + ": all succeeded";
    }
    std::string details;
    const auto add = [&](std::int64_t count, const char* word) {
        if (count > 0) {
            details += (details.empty() ? "" : ", ") + std::to_string(count) + " " + word;
        }
    };
    add(summary.success_count, "succeeded");
    add(summary.failure_count, "failed");
    add(summary.skipped_count, "skipped");
    return out + ": " + details;
}

} // namespace

Expected<BatchRequest, CommandError> parse_batch_request(const Json& request) {
    // Every member is optional-but-typed, so null counts as a wrong type, as in TypeScript.
    if (!request.is_object()) {
        return unexpected(invalid_batch_error());
    }
    const auto commands = request.find("commands");
    if (commands == request.end() || !commands->is_array() || commands->empty()) {
        return unexpected(invalid_batch_error());
    }
    BatchRequest parsed;
    for (const Json& entry : *commands) {
        if (!entry.is_object()) {
            return unexpected(invalid_batch_error());
        }
        const auto name = entry.find("command");
        if (name == entry.end() || !name->is_string()) {
            return unexpected(invalid_batch_error());
        }
        BatchCommand command;
        command.command = name->get<std::string>();
        if (const auto id = entry.find("id"); id != entry.end()) {
            if (!id->is_string()) {
                return unexpected(invalid_batch_error());
            }
            command.id = id->get<std::string>();
        }
        if (const auto input = entry.find("input"); input != entry.end()) {
            command.input = *input;
        }
        parsed.commands.push_back(std::move(command));
    }
    if (const auto options = request.find("options"); options != request.end()) {
        if (!options->is_object()) {
            return unexpected(invalid_batch_error());
        }
        BatchOptions batch_options;
        if (const auto stop = options->find("stopOnError"); stop != options->end()) {
            if (!stop->is_boolean()) {
                return unexpected(invalid_batch_error());
            }
            batch_options.stop_on_error = stop->get<bool>();
        }
        if (const auto timeout = options->find("timeout"); timeout != options->end()) {
            if (!timeout->is_number()) {
                return unexpected(invalid_batch_error());
            }
            batch_options.timeout = timeout->get<double>();
        }
        if (const auto parallelism = options->find("parallelism"); parallelism != options->end()) {
            const bool integral =
                parallelism->is_number_integer() ||
                (parallelism->is_number_float() &&
                 std::trunc(parallelism->get<double>()) == parallelism->get<double>() &&
                 std::fabs(parallelism->get<double>()) < 9007199254740992.0);
            if (!integral) {
                return unexpected(invalid_batch_error());
            }
            batch_options.parallelism = parallelism->is_number_float()
                                            ? static_cast<std::int64_t>(parallelism->get<double>())
                                            : parallelism->get<std::int64_t>();
        }
        parsed.options = batch_options;
    }
    if (!valid_request(parsed)) {
        return unexpected(invalid_batch_error());
    }
    return parsed;
}

void to_json(Json& out, const BatchCommand& command) {
    out = Json::object();
    detail::put(out, "id", command.id);
    out["command"] = command.command;
    detail::put(out, "input", command.input);
}

void to_json(Json& out, const BatchOptions& options) {
    out = Json::object();
    detail::put(out, "stopOnError", options.stop_on_error);
    detail::put(out, "timeout", options.timeout);
    detail::put(out, "parallelism", options.parallelism);
}

void to_json(Json& out, const BatchRequest& request) {
    out = Json::object();
    out["commands"] = request.commands;
    detail::put(out, "options", request.options);
}

double calculate_batch_confidence(const std::vector<BatchCommandResult>& results) {
    if (results.empty()) {
        return 1;
    }
    std::size_t successes = 0;
    double confidence_sum = 0;
    for (const auto& entry : results) {
        if (entry.result.success) {
            ++successes;
            confidence_sum += entry.result.confidence.value_or(1.0);
        }
    }
    const double success_ratio =
        static_cast<double>(successes) / static_cast<double>(results.size());
    const double average = successes > 0 ? confidence_sum / static_cast<double>(successes) : 0;
    return success_ratio * 0.5 + average * 0.5;
}

BatchResult create_batch_result(std::vector<BatchCommandResult> results, BatchTiming timing,
                                std::optional<ResultMetadata> metadata) {
    BatchSummary summary;
    summary.total = static_cast<std::int64_t>(results.size());
    std::vector<BatchWarning> warnings;
    for (const auto& entry : results) {
        if (entry.result.success) {
            ++summary.success_count;
        } else if (entry.result.error && entry.result.error->code == error_codes::COMMAND_SKIPPED) {
            ++summary.skipped_count;
        }
        if (entry.result.warnings) {
            for (const auto& warning : *entry.result.warnings) {
                warnings.push_back({entry.id, warning.code, warning.message});
            }
        }
    }
    summary.failure_count = summary.total - summary.success_count - summary.skipped_count;

    BatchResult batch;
    batch.success = true;
    batch.confidence = calculate_batch_confidence(results);
    batch.reasoning = reasoning_for(summary);
    batch.results = std::move(results);
    batch.summary = summary;
    batch.timing = std::move(timing);
    if (!warnings.empty()) {
        batch.warnings = std::move(warnings);
    }
    batch.metadata = std::move(metadata);
    return batch;
}

BatchResult create_failed_batch_result(CommandError error, BatchTiming timing) {
    BatchResult batch;
    batch.success = false;
    batch.timing = std::move(timing);
    batch.timing.average_ms = 0;
    batch.confidence = 0;
    batch.reasoning = "Batch execution failed: " + error.message;
    batch.error = std::move(error);
    return batch;
}

BatchResult execute_batch(const Json& request, const CommandExecutor& execute,
                          const CommandContext& context, const ExecutorOptions& options) {
    auto parsed = parse_batch_request(request);
    if (!parsed) {
        return rejected(*clock_of(options));
    }
    return execute_batch(*parsed, execute, context, options);
}

BatchResult execute_batch(const BatchRequest& request, const CommandExecutor& execute,
                          const CommandContext& context, const ExecutorOptions& options) {
    const auto clock = clock_of(options);
    if (!valid_request(request)) {
        return rejected(*clock);
    }
    const std::string started_at = wire::iso8601_utc(clock->wall_ms());
    const double start = clock->steady_ms();

    const BatchOptions batch_options = request.options.value_or(BatchOptions{});
    const std::optional<double> deadline =
        batch_options.timeout ? std::optional<double>(start + *batch_options.timeout)
                              : std::nullopt;
    const std::string batch_trace = context.trace_id && !context.trace_id->empty()
                                        ? *context.trace_id
                                        : "batch-" + std::to_string(clock->wall_ms());
    const CommandError timeout_error = create_error(
        error_codes::BATCH_TIMEOUT,
        "Batch timeout exceeded (" +
            (batch_options.timeout ? detail::format_number(*batch_options.timeout) : "undefined") +
            "ms)",
        {.suggestion = "Increase timeout or reduce the number of batch commands",
         .retryable = true});
    const CommandError skipped_error =
        create_error(error_codes::COMMAND_SKIPPED,
                     "Command skipped because batch execution stopped after a failure",
                     {.suggestion = "Disable stopOnError to execute every command"});

    const auto& commands = request.commands;
    std::vector<std::optional<BatchCommandResult>> results(commands.size());
    std::atomic<bool> stopped{false};
    std::atomic<bool> timed_out{false};
    std::atomic<std::size_t> next_index{0};
    std::mutex results_mutex;

    const auto run_command = [&](const BatchCommand& command, std::size_t index) -> CommandResult {
        if (deadline && clock->steady_ms() >= *deadline) {
            timed_out = true;
            return failure(timeout_error);
        }
        CancellationSource cancellation(context.cancellation, deadline, clock);
        CommandContext command_context = context;
        command_context.cancellation = cancellation.token();
        command_context.trace_id = batch_trace + "-" + std::to_string(index);
        const Json input = command.input.value_or(Json());
        CommandResult result =
            settle(execute, command.command, input, command_context, options.dev_mode);
        // A command still running at the deadline times out, as if TypeScript's race had fired.
        if (deadline && clock->steady_ms() >= *deadline) {
            timed_out = true;
            cancellation.cancel();
            return failure(timeout_error);
        }
        return result;
    };

    const auto worker = [&](std::size_t) {
        while (!stopped && !timed_out) {
            const std::size_t index = next_index++;
            if (index >= commands.size()) {
                return;
            }
            const auto& command = commands[index];
            const double command_start = clock->steady_ms();
            CommandResult result = run_command(command, index);
            const bool failed = !result.success;
            BatchCommandResult entry{command.id.value_or("cmd-" + std::to_string(index)),
                                     static_cast<std::int64_t>(index), command.command,
                                     std::move(result), round2(clock->steady_ms() - command_start)};
            {
                const std::lock_guard lock(results_mutex);
                results[index] = std::move(entry);
            }
            if (failed && batch_options.stop_on_error.value_or(false)) {
                stopped = true;
            }
        }
    };

    const auto workers =
        static_cast<std::size_t>((std::min)(batch_options.parallelism.value_or(1),
                                            static_cast<std::int64_t>(commands.size())));
    std::shared_ptr<TaskRunner> runner =
        options.runner ? options.runner : std::make_shared<InlineTaskRunner>();
    runner->run_all(workers, worker);

    std::vector<BatchCommandResult> completed;
    completed.reserve(commands.size());
    for (std::size_t index = 0; index < commands.size(); ++index) {
        if (results[index]) {
            completed.push_back(std::move(*results[index]));
            continue;
        }
        completed.push_back({commands[index].id.value_or("cmd-" + std::to_string(index)),
                             static_cast<std::int64_t>(index), commands[index].command,
                             failure(timed_out ? timeout_error : skipped_error), 0});
    }

    const double total_ms = clock->steady_ms() - start;
    ResultMetadata metadata;
    metadata.trace_id = batch_trace;
    const auto count = static_cast<double>(completed.size());
    return create_batch_result(std::move(completed),
                               {.total_ms = round2(total_ms),
                                .average_ms = round2(total_ms / count),
                                .started_at = started_at,
                                .completed_at = wire::iso8601_utc(clock->wall_ms())},
                               std::move(metadata));
}

} // namespace afd
