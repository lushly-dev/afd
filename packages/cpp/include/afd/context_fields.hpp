// Declared context fields (spec/context-fields.md; packages/server/src/context-fields.ts): named,
// schema-validated request values a host declares in `CommandRegistryOptions::context_fields`.
// A call carries each value in `CommandContext::extra[name]` (a JSON `null` counts as no value);
// the registry validates it before middleware and the handler run, and the journal keeps the ones
// declared `journal` (spec/journal.md, "Declared context fields"). C++ has no MCP server: a host's
// transport reads
// `_meta[meta]` and sets `extra[name]`.
#pragma once

#include "afd/json.hpp"

#include <string>

namespace afd {

/// A request value a host declares: where it lands in the context, the `_meta` key a caller sends
/// it in, how it is validated, and whether the journal keeps it. Checked when the registry is
/// created (`CommandRegistry::create`):
///
///     afd::ContextField{.name = "scope",
///                       .meta = "dev.example/scope",
///                       .schema = {{"type", "object"},
///                                  {"properties", {{"project", {{"type", "string"}}}}},
///                                  {"required", {"project"}}},
///                       .journal = true};
struct ContextField {
    /// The `CommandContext::extra` key the value lands under. Not empty, and not a key AFD uses
    /// itself: TypeScript's reserved names (`actor`, `approval`, `auth`, `clock`, `credentials`,
    /// `interface`, `random`, `session`, `signal`, `timeout`, `traceId`), `CommandContext`'s own
    /// members (`trace_id`, `active_context`, ...), and `source` (`DirectClient` sets it).
    std::string name;
    /// The MCP `_meta` key a caller sends the value in. It needs a reverse-DNS prefix of two or
    /// more labels, such as `dev.example/scope`. The `dev.afd/` prefix and any `mcp` or
    /// `modelcontextprotocol` label are refused (case-insensitively).
    std::string meta;
    /// JSON Schema for the value, in the subset `CompiledSchema` supports (schema.hpp). The handler
    /// sees the validated value: defaults applied, undeclared members removed.
    Json schema;
    /// Record the value in the journal. Only for a field that never holds a secret.
    bool journal = false;
    /// Fail a call that has no value for this field (an absent key or a JSON `null`). Not enforced
    /// for AFD's own commands, whose names start with `afd-`, so a client can discover the fields
    /// first; a value they do get is still validated.
    bool required = false;
};

} // namespace afd
