// Private: checking context field declarations, validating a call's values, and what the journal
// keeps of them (spec/context-fields.md, spec/journal.md "Declared context fields";
// packages/server/src/context-fields.ts and journal.ts). Not installed.
#pragma once

#include "afd/command.hpp"
#include "afd/context_fields.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"
#include "afd/schema.hpp"

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd::detail {

/// What `CommandContext::journaled_fields` points to: the names of the declared fields marked
/// `journal`, sorted. TypeScript's `JOURNALED_CONTEXT_FIELDS` symbol on the context.
struct JournaledContextFields {
    std::vector<std::string> names;
};

/// Most bytes of UTF-8 canonical JSON a journaled value may take. TypeScript's
/// `MAX_JOURNAL_CONTEXT_BYTES`.
inline constexpr std::size_t max_journal_context_bytes = 4096;

/// Checked declarations, ready for every call.
struct CompiledContextFields {
    /// One per declaration, in order.
    std::vector<CompiledSchema> schemas;
    /// The names of the fields marked `journal`; null when there are none.
    std::shared_ptr<const JournaledContextFields> journaled;
};

/// Checks `fields` when a registry is created. The error names the field. TypeScript's
/// `checkContextFields`.
Expected<CompiledContextFields> compile_context_fields(const std::vector<ContextField>& fields);

/// Validates the call's declared values in `context.extra`, in place: each is replaced by its
/// schema's output. A JSON `null` counts as no value, like an absent key. Returns
/// VALIDATION_ERROR for an invalid value or a missing required one; `required` is not enforced
/// for AFD's own commands (`command` starting with `afd-`), so a client can discover the fields
/// first. TypeScript's `applyContextFields`.
std::optional<CommandResult> apply_context_fields(const std::vector<ContextField>& fields,
                                                  const std::vector<CompiledSchema>& schemas,
                                                  std::string_view command,
                                                  CommandContext& context);

/// An entry's `context` and `context_omitted`.
struct JournaledContextValues {
    std::optional<Json> context;
    std::optional<std::vector<std::string>> omitted;
};

/// The values of the journaled fields `context` has (a JSON `null` is no value), as an entry
/// keeps them: a value over
/// `max_journal_context_bytes` of canonical JSON is left out and its name listed in `omitted`.
/// Both are unset when empty. TypeScript's `journalContextFields`.
JournaledContextValues journaled_context_values(const CommandContext& context);

} // namespace afd::detail
