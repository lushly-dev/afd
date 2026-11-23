// Per-command output budgets (spec/output-budgets.md, B1 to B8): a command declares a budget,
// a caller asks for a smaller or larger one per call, the handler fits its result to the effective
// budget, and `CommandRegistry::execute` checks the result afterwards. An over-budget read becomes
// an `OUTPUT_BUDGET_EXCEEDED` failure; an over-budget mutation keeps its result with a caution
// warning. Nothing truncates structured output.
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace afd {

/// The `_meta` key of an output budget. It carries three shapes in three places: the declaration
/// on a tool's `_meta` (`{ defaultBytes, maxBytes }`), the ask on a call's `_meta`
/// (`{ maxBytes }`), and the report in a result's `metadata` (`{ limitBytes, usedBytes }`).
inline constexpr std::string_view output_budget_meta_key = "dev.afd/outputBudget";

/// The largest integer a JavaScript number holds exactly (2^53 - 1): the largest budget.
inline constexpr std::uint64_t max_output_budget_bytes = 9007199254740991ULL;

/// A command's declared output budget (spec/output-budgets.md, B1): the bytes a result may use by
/// default and at most. Both must be integers from 1 to `max_output_budget_bytes` with
/// `default_bytes <= max_bytes`; `CommandRegistry::register_command` refuses any other.
struct OutputBudget {
    /// The effective budget of a call that asks for none.
    std::uint64_t default_bytes = 0;
    /// The most a call may ask for; a larger ask is clamped to it.
    std::uint64_t max_bytes = 0;

    bool operator==(const OutputBudget&) const = default;

    /// Parses and validates `{ "defaultBytes": d, "maxBytes": m }` from JSON.
    /// Returns an error naming the field for anything else.
    [[nodiscard]] static Expected<OutputBudget> from_json(const Json& value);

    /// Validates the bounds (`1 <= default_bytes <= max_bytes <= max_output_budget_bytes`).
    /// Returns an error message naming the field, or `std::nullopt` when valid.
    [[nodiscard]] std::optional<std::string> validate() const;

    /// The effective budget of a call with `ask` (B3): `min(ask, max_bytes)`, or `default_bytes`
    /// without one.
    [[nodiscard]] std::uint64_t effective(std::optional<std::uint64_t> ask) const noexcept;
};

void to_json(Json& out, const OutputBudget& budget);

} // namespace afd
