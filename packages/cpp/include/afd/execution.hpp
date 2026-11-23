// What batch, pipeline and stream execution share (packages/core/src/command-execution.ts and
// pipeline-executor.ts): one executor callback that every entry point delegates to.
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"

#include <cstddef>
#include <functional>
#include <memory>
#include <string_view>

namespace afd {

/// Normative default maximum number of commands in a single batch (spec/execution-controls.md).
inline constexpr std::size_t default_max_batch_size = 500;

/// Normative default maximum concurrent commands in a single batch (spec/execution-controls.md).
inline constexpr std::size_t default_max_batch_parallelism = 16;

/// Executes one command. `CommandRegistry::execute` and `DirectClient::call` are the usual
/// executors; tests pass their own.
using CommandExecutor =
    std::function<CommandResult(std::string_view name, const Json& input, CommandContext& context)>;

struct ExecutorOptions {
    /// Include exception messages in COMMAND_EXECUTION_ERROR and STREAM_ERROR results.
    bool dev_mode = false;
    /// For deadlines, durations and timestamps. Defaults to `SystemClock`.
    std::shared_ptr<const Clock> clock;
    /// For generated pipeline IDs. Defaults to a `SystemRandom`.
    std::shared_ptr<RandomSource> random;
    /// Runs batch workers. Defaults to `InlineTaskRunner`.
    std::shared_ptr<TaskRunner> runner;
    /// Maximum number of commands accepted in a single batch (default: 500).
    std::size_t max_batch_size = default_max_batch_size;
    /// Maximum `options.parallelism` accepted in a single batch (default: 16).
    std::size_t max_batch_parallelism = default_max_batch_parallelism;
};

} // namespace afd
