// Per-command output budgets (spec/output-budgets.md, B1 to B8).
#include "afd/output_budget.hpp"

#include "afd/errors.hpp"
#include "afd/metadata.hpp"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>

#include "detail/canonical_json.hpp"
#include "detail/output_budget.hpp"

namespace afd {
namespace {

std::optional<std::uint64_t> parse_ask(const Json& value) noexcept {
    if (!value.is_object() || value.size() != 1) {
        return std::nullopt;
    }
    const auto found = value.find("maxBytes");
    if (found == value.end()) {
        return std::nullopt;
    }
    return detail::parse_positive_safe_integer(*found);
}

CommandResult ask_failure() {
    return failure(
        create_error(error_codes::VALIDATION_ERROR, "The output budget ask is not valid",
                     {.suggestion = "Send _meta[\"" + std::string(output_budget_meta_key) +
                                    "\"] = { \"maxBytes\": <positive integer> }, or leave it out",
                      .retryable = false,
                      .details = Json{{"field", "outputBudget"},
                                      {"meta", std::string(output_budget_meta_key)}}}));
}

CommandError over_budget_error(std::uint64_t limit, std::uint64_t actual, std::uint64_t max_bytes) {
    std::string suggestion;
    if (limit < max_bytes) {
        suggestion = "Narrow the request (fewer results, a smaller window or a filter), or ask "
                     "for up to " +
                     std::to_string(max_bytes) + " bytes with _meta[\"" +
                     std::string(output_budget_meta_key) +
                     "\"] = { \"maxBytes\": " + std::to_string(max_bytes) + " }.";
    } else {
        suggestion = "Narrow the request (fewer results, a smaller window or a filter); " +
                     std::to_string(max_bytes) + " bytes is this command's largest output budget.";
    }
    return create_error(
        error_codes::OUTPUT_BUDGET_EXCEEDED,
        "The result is " + std::to_string(actual) + " bytes, over this call's output budget of " +
            std::to_string(limit) + " bytes",
        {.suggestion = std::move(suggestion),
         .retryable = false,
         .details = Json{{"limitBytes", limit}, {"actualBytes", actual}, {"maxBytes", max_bytes}}});
}

} // namespace

namespace detail {

std::optional<std::uint64_t> parse_positive_safe_integer(const Json& value) noexcept {
    if (value.is_number_unsigned()) {
        const auto bytes = value.get<std::uint64_t>();
        if (bytes >= 1 && bytes <= max_output_budget_bytes) {
            return bytes;
        }
        return std::nullopt;
    }
    if (value.is_number_integer()) {
        const auto bytes = value.get<std::int64_t>();
        if (bytes >= 1 && static_cast<std::uint64_t>(bytes) <= max_output_budget_bytes) {
            return static_cast<std::uint64_t>(bytes);
        }
        return std::nullopt;
    }
    if (value.is_number_float()) {
        const double number = value.get<double>();
        if (!std::isfinite(number) || std::trunc(number) != number || number < 1.0 ||
            number > static_cast<double>(max_output_budget_bytes)) {
            return std::nullopt;
        }
        return static_cast<std::uint64_t>(number);
    }
    return std::nullopt;
}

std::optional<CommandResult> apply_output_budget(const CommandDefinition& definition,
                                                 CommandContext& context) {
    std::optional<std::uint64_t> ask;
    // Trusted host code (`output_budget_ask`) always wins over `_meta` (`output_budget_meta_ask`).
    if (context.output_budget_ask.has_value()) {
        const std::uint64_t requested = *context.output_budget_ask;
        if (requested < 1 || requested > max_output_budget_bytes) {
            return ask_failure();
        }
        ask = requested;
    } else if (context.output_budget_meta_ask && !context.output_budget_meta_ask->value.is_null()) {
        const auto parsed = parse_ask(context.output_budget_meta_ask->value);
        if (!parsed) {
            return ask_failure();
        }
        ask = *parsed;
    }
    if (definition.output_budget) {
        context.output_budget = definition.output_budget->effective(ask);
    } else {
        context.output_budget.reset();
    }
    return std::nullopt;
}

std::uint64_t measured_result_bytes(const CommandResult& result) {
    Json value = result;
    if (value.is_object()) {
        value.erase("metadata");
    }
    return canonical_json_byte_length_as_read(value);
}

CommandResult enforce_output_budget(const CommandDefinition& definition, std::uint64_t limit,
                                    CommandResult result) {
    // A handler's own failure is never replaced, and an unbudgeted command passes unchanged.
    if (!definition.output_budget || !result.success) {
        return result;
    }
    const std::uint64_t used = measured_result_bytes(result);
    if (used > limit && !definition.mutation) {
        return failure(over_budget_error(limit, used, definition.output_budget->max_bytes));
    }
    if (used > limit) {
        Warning warning;
        warning.code = error_codes::OUTPUT_BUDGET_EXCEEDED;
        warning.message = "The result is " + std::to_string(used) +
                          " bytes, over this call's output budget of " + std::to_string(limit) +
                          " bytes; the change was made";
        warning.severity = WarningSeverity::caution;
        warning.details = Json{{"limitBytes", limit}, {"actualBytes", used}};
        if (!result.warnings) {
            result.warnings.emplace();
        }
        result.warnings->push_back(std::move(warning));
    }
    ResultMetadata metadata = result.metadata.value_or(ResultMetadata{});
    if (!metadata.extra.is_object()) {
        metadata.extra = Json::object();
    }
    metadata.extra[std::string(output_budget_meta_key)] =
        Json{{"limitBytes", limit}, {"usedBytes", used}};
    result.metadata = std::move(metadata);
    return result;
}

} // namespace detail

Expected<OutputBudget> OutputBudget::from_json(const Json& value) {
    if (!value.is_object()) {
        return unexpected(std::string("outputBudget must be an object { defaultBytes, maxBytes }"));
    }
    for (auto it = value.begin(); it != value.end(); ++it) {
        if (it.key() != "defaultBytes" && it.key() != "maxBytes") {
            return unexpected("outputBudget has an unknown member '" + it.key() +
                              "'; it takes only defaultBytes and maxBytes");
        }
    }
    const auto read_member = [&](const char* name) -> Expected<std::uint64_t> {
        const auto found = value.find(name);
        if (found == value.end()) {
            return unexpected("outputBudget." + std::string(name) +
                              " must be an integer from 1 to " +
                              std::to_string(max_output_budget_bytes));
        }
        const auto parsed = detail::parse_positive_safe_integer(*found);
        if (!parsed) {
            return unexpected("outputBudget." + std::string(name) +
                              " must be an integer from 1 to " +
                              std::to_string(max_output_budget_bytes));
        }
        return *parsed;
    };
    const auto default_bytes = read_member("defaultBytes");
    if (!default_bytes) {
        return unexpected(default_bytes.error());
    }
    const auto max_bytes = read_member("maxBytes");
    if (!max_bytes) {
        return unexpected(max_bytes.error());
    }
    const OutputBudget budget{.default_bytes = *default_bytes, .max_bytes = *max_bytes};
    if (auto problem = budget.validate()) {
        return unexpected(std::move(*problem));
    }
    return budget;
}

std::optional<std::string> OutputBudget::validate() const {
    if (default_bytes < 1 || default_bytes > max_output_budget_bytes) {
        return "outputBudget.defaultBytes must be an integer from 1 to " +
               std::to_string(max_output_budget_bytes) + ", not " + std::to_string(default_bytes);
    }
    if (max_bytes < 1 || max_bytes > max_output_budget_bytes) {
        return "outputBudget.maxBytes must be an integer from 1 to " +
               std::to_string(max_output_budget_bytes) + ", not " + std::to_string(max_bytes);
    }
    if (default_bytes > max_bytes) {
        return "outputBudget.defaultBytes (" + std::to_string(default_bytes) +
               ") must not be above outputBudget.maxBytes (" + std::to_string(max_bytes) + ")";
    }
    return std::nullopt;
}

std::uint64_t OutputBudget::effective(std::optional<std::uint64_t> ask) const noexcept {
    return ask ? (std::min)(*ask, max_bytes) : default_bytes;
}

void to_json(Json& out, const OutputBudget& budget) {
    out = Json{{"defaultBytes", budget.default_bytes}, {"maxBytes", budget.max_bytes}};
}

} // namespace afd
