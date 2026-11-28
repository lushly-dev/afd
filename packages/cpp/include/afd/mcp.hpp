// Commands as MCP tools (packages/core/src/commands.ts `commandToMcpTool`, and
// packages/core/src/command-metadata.ts; spec/command-metadata.md, "Reporting rules").
//
// These turn a `CommandDefinition` into what an MCP client reads: the tool's `name`, `title`,
// `description`, `inputSchema`, `annotations` and per-command `_meta`. They carry no transport;
// the opt-in `afd::mcp_stdio` target (afd/mcp_stdio.hpp) serves them over stdio.
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"

#include <optional>
#include <string_view>
#include <vector>

namespace afd {

/// Whether `command` is exposed to MCP (`expose.mcp`).
bool is_mcp_exposed(const CommandDefinition& command) noexcept;

/// The wire name of `time`: `instant`, `fast`, `slow` or `long-running`.
std::string_view execution_time_name(ExecutionTime time) noexcept;

/// The per-command `_meta` of a tool (spec/command-metadata.md, "Surfaces";
/// spec/output-budgets.md, B1; spec/mcp-resources.md, T1): extra `tool_meta` entries (validated
/// against T2 and omitted on meta-tools and `afd-context-*` tools), plus `category`, `requires`,
/// `mutation`, `idempotency`, `destructive`, `undoable`, `approval`, `examples`, `outputSchema`,
/// `contexts` and `dev.afd/outputBudget`, each only when the command sets it (meta-tools and
/// `afd-context-*` tools never emit `dev.afd/outputBudget`). C++ booleans have no unset state, so
/// `mutation`, `destructive` and `undoable` are reported when true. Never `confirmPrompt` or
/// `title`, which are display text. `std::nullopt` when nothing is set.
std::optional<Json> command_tool_meta(const CommandDefinition& command);

/// MCP tool annotations (spec/command-metadata.md, "Annotations"): a mutation reports
/// `readOnlyHint: false` and `destructiveHint`. C++ cannot tell an unset `mutation` from `false`,
/// so a command that is not a mutation claims no `readOnlyHint`. A command declaring
/// `IdempotencySupport::natural` adds `idempotentHint: true` (spec/idempotency.md, D2); nothing
/// else reports it. `std::nullopt` when there is none.
std::optional<Json> command_tool_annotations(const CommandDefinition& command);

/// The MCP tool for `command`: `name`, `title` (only when set), `description`, `inputSchema`
/// (`advertised_input_schema` when set, else `input_schema`), `annotations` and `_meta` (each
/// only when there is one).
Json command_to_mcp_tool(const CommandDefinition& command);

/// The top-level MCP `outputSchema` of a command tool (spec/command-metadata.md, "Structured
/// results"): the CommandResult envelope, with `data` typed by `data_schema`. `$schema` is
/// dropped. When `data` starts a schema resource (a string `$id` that is not a bare fragment, the
/// validators' test), its definitions stay inside it. Otherwise they move to the envelope, and a
/// `"$ref": "#"` that named `data` becomes `"#/properties/data"`.
Json command_result_output_schema(const Json& data_schema);

/// The MCP tools of the commands exposed to MCP, in the given order.
std::vector<Json> commands_to_mcp_tools(const std::vector<CommandDefinition>& commands);

/// `command` as afd-detail describes it (spec/command-metadata.md, "Surfaces";
/// spec/output-budgets.md, B1): `name`, `title`, `description`, `category`, `tags`, `mutation`
/// (always), `idempotency`, `executionTime`, `errors`, `inputSchema`, `outputSchema`,
/// `destructive`, `confirmPrompt`, `undoable`, `approval`, `handoff`, `handoffProtocol`, `version`,
/// `requires`, `contexts`, `examples` and `outputBudget` (omitted on meta-tools and `afd-context-*`
/// tools). Unset fields and empty arrays are omitted; `destructive`, `undoable` and `handoff` are
/// reported when true.
Json to_json(const CommandDefinition& command);

} // namespace afd
