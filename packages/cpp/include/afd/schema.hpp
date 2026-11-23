// Input validation against a JSON Schema subset (proposal D6), reporting failures in the
// TypeScript engine's VALIDATION_ERROR shape (packages/server/src/validation.ts).
//
// Supported: type (including "integer", or an array of types), properties, required, default,
// enum, items, minItems, maxItems, minLength, maxLength (in Unicode code points), minimum,
// maximum, exclusiveMinimum, exclusiveMaximum, additionalProperties (boolean or schema), and local
// $ref into definitions/$defs. Annotations (title, description, examples, $schema, $id,
// $comment, deprecated, readOnly, writeOnly) are allowed and ignored, except that a string $id
// starts a schema resource: a local $ref inside that subschema resolves against it.
//
// Any other keyword (pattern, format, const, oneOf, anyOf, allOf, not, remote $ref, …) is rejected
// by `CompiledSchema::compile`, so a schema is never silently under-enforced.
#pragma once

#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// Normative default cap on reported issues per `VALIDATION_ERROR` (spec/execution-controls.md).
inline constexpr std::size_t default_max_validation_issues = 100;

/// One validation problem. `path` joins keys and array indices with dots ("todos.1.title");
/// "(root)" is the input itself. `code` uses Zod 4's issue codes: invalid_type, too_small,
/// too_big, invalid_value, invalid_union, unrecognized_keys.
struct ValidationIssue {
    std::string path;
    std::string message;
    std::string code;
    /// The expected type, for invalid_type only.
    std::optional<std::string> expected;
};

/// Why an input was rejected. The field lists describe the top-level object schema, if any, and
/// are sorted alphabetically.
struct ValidationFailure {
    std::vector<ValidationIssue> errors;
    std::vector<std::string> expected_fields;
    std::vector<std::string> unexpected_fields;
    std::vector<std::string> missing_fields;
    bool truncated = false;
    std::optional<std::size_t> limit;
    std::optional<std::size_t> total_errors;
};

/// A schema checked once at registration and reused for every call.
class CompiledSchema {
public:
    /// Checks that `schema` uses only supported keywords and that every $ref resolves.
    static Expected<CompiledSchema> compile(const Json& schema);

    /// Returns the parsed input: defaults applied, and undeclared object members removed unless
    /// `additionalProperties` allows them. Caps reported issues at `max_issues`. Never throws.
    [[nodiscard]] Expected<Json, ValidationFailure>
    validate(const Json& input, std::size_t max_issues = default_max_validation_issues) const;

    [[nodiscard]] const Json& schema() const noexcept { return *schema_; }

private:
    explicit CompiledSchema(std::shared_ptr<const Json> schema) : schema_(std::move(schema)) {}
    std::shared_ptr<const Json> schema_;
};

/// TypeScript's `formatValidationErrors`: one error as "path: message" (or just the message at the
/// root), several as "- path: message" lines.
std::string format_validation_errors(const std::vector<ValidationIssue>& errors);

/// The VALIDATION_ERROR a command returns for `failure`: message "Input validation failed", the
/// formatted issues and field lists as the suggestion, and `details` with errors,
/// expectedFields, unexpectedFields and missingFields (empty lists omitted).
CommandError validation_failure_error(const ValidationFailure& failure);

} // namespace afd
