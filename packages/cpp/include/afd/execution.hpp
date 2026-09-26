// What batch, pipeline and stream execution share (packages/core/src/command-execution.ts and
// pipeline-executor.ts): one executor callback that every entry point delegates to.
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"

#include <functional>
#include <memory>
#include <string_view>

namespace afd {

/// Executes one command. `CommandRegistry::execute` and `DirectClient::call` are the usual
/// executors; tests pass their own.
using CommandExecutor =
    std::function<CommandResult(std::string_view name, const Json& input, CommandContext& context)>;

struct ExecutorOptions {
    /// Include exception messages in COMMAND_EXECUTION_ERROR and STREAM_ERROR results.
    bool dev_mode = false;
    /// For deadlines, durations and timestamps. Defaults to `SystemClock`.
    std::shared_ptr<const Clock> clock;
    /// For generated pipeline IDs. Defaults to a randomly seeded `SeededRandom`.
    std::shared_ptr<RandomSource> random;
    /// Runs batch workers. Defaults to `InlineTaskRunner`.
    std::shared_ptr<TaskRunner> runner;
};

} // namespace afd
