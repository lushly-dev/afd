// Private: output budget ask validation, effective budget computation, and post-handler check
// (spec/output-budgets.md, B2 to B6). Not installed.
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"
#include "afd/output_budget.hpp"
#include "afd/result.hpp"

#include <cstdint>
#include <optional>
#include <string_view>

namespace afd::detail {

/// Whether a tool name must never surface an output-budget declaration (spec/output-budgets.md,
/// B1: meta-tools and `afd-context-*` context tools).
[[nodiscard]] inline bool omits_output_budget_surface(std::string_view name) noexcept {
    if (name == "afd-call" || name == "afd-batch" || name == "afd-pipe" || name == "afd-discover" ||
        name == "afd-detail") {
        return true;
    }
    constexpr std::string_view context_prefix = "afd-context-";
    return name.size() >= context_prefix.size() &&
           name.substr(0, context_prefix.size()) == context_prefix;
}

/// Raw `_meta["dev.afd/outputBudget"]` value attached by `afd::mcp_stdio` when trusted host code
/// did not set `CommandContext::output_budget_ask`. Validated in `CommandRegistry::execute`.
struct RawOutputBudgetAsk {
    Json value;
};

/// Parses a JSON value as an integer from 1 to `max_output_budget_bytes` (accepting integral
/// floating-point numbers as JavaScript numbers do). Returns `std::nullopt` for anything else.
[[nodiscard]] std::optional<std::uint64_t> parse_positive_safe_integer(const Json& value) noexcept;

/// Validates the call's output budget ask (`context.output_budget_ask` first, else
/// `context.output_budget_meta_ask`) and sets `context.output_budget` from `definition` (B2-B4).
/// An ask on a command without a declaration is validated and then ignored.
/// Returns a `VALIDATION_ERROR` result if the ask is invalid, or `std::nullopt` on success.
[[nodiscard]] std::optional<CommandResult> apply_output_budget(const CommandDefinition& definition,
                                                               CommandContext& context);

/// Measures the UTF-8 byte length of the canonical JSON of `result` with `metadata` removed
/// (B5 step 2).
[[nodiscard]] std::uint64_t measured_result_bytes(const CommandResult& result);

/// Applies the post-handler output budget check and report (B5, B6) for `definition` with
/// effective budget `limit`. Failures and commands without a declaration pass unchanged.
[[nodiscard]] CommandResult enforce_output_budget(const CommandDefinition& definition,
                                                  std::uint64_t limit, CommandResult result);

} // namespace afd::detail
