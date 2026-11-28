// The tool surface of afd::mcp_stdio (spec/tool-strategies.md): the meta-tools' definitions
// (spec/meta-tools.json), their argument checks, grouped tools, and afd-discover and afd-detail.
// TypeScript's tool-router.ts and lazy-tools.ts, and Rust's server/strategy.rs and
// server/meta_tools.rs, are the references. Private to the target.
#pragma once

#include "afd/command.hpp"
#include "afd/errors.hpp"
#include "afd/json.hpp"
#include "afd/mcp_stdio.hpp"
#include "afd/result.hpp"

#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd::mcp::surface {

/// The tool of the meta-tool `name` (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` or
/// `afd-detail`), field for field as `spec/meta-tools.json` defines it.
Json meta_tool(std::string_view name);

/// The arguments of `afd-call`, `afd-discover` or `afd-detail` checked against what the tool
/// advertises, with top-level `null`s dropped (agents send them for optional fields); or the
/// VALIDATION_ERROR "Invalid <tool> arguments", whose suggestion ends with `usage`.
Expected<Json, CommandError> parse_meta_args(std::string_view tool, const Json& arguments,
                                             std::string_view usage);

/// A command's discovery category and default group: its `category`, else the first kebab-case
/// segment of its name, else `general`.
std::string default_command_group(const CommandDefinition& command);

/// A command's grouped action: its name without the first segment (`todo-create-batch` becomes
/// `create-batch`), or the whole name when it has one segment.
std::string command_action(const CommandDefinition& command);

/// A command a strategy lists: its definition, its command tool, and whether that tool
/// advertises the `confirm` acknowledgement.
struct Listed {
    const CommandDefinition* command = nullptr;
    Json tool;
    bool accepts_confirm = false;
};

/// The grouped tool `group` of `members`: `{ action, params }`, `_meta.actions`, and the actions'
/// schemas as `params.anyOf` when they fit in 8,192 UTF-16 code units and hold no `$ref`.
Json grouped_tool(const std::string& group, const std::vector<const Listed*>& members);

/// afd-discover over `commands` (exposed and in the active context) with checked `args`.
CommandResult discover(const std::vector<const CommandDefinition*>& commands, const Json& args);

/// afd-detail over `commands` (exposed and in the active context, with their tools) with checked
/// `args`. `not_found` gives the suggestion for a name that is not among them.
CommandResult detail(const std::vector<const Listed*>& commands, const Json& args,
                     const std::function<std::string(std::string_view)>& not_found);

/// The first-class set checked against the strategy and the registry (spec/tool-strategies.md,
/// H1, H2 and H5). Every message names the offending entry or option.
std::optional<std::string> first_class_fault(const CommandRegistry& registry,
                                             const StdioServerOptions& options);

/// Moves a meta-tool's `meta` argument into `meta`, the request's `_meta`: `dev.afd/context`,
/// `dev.afd/outputBudget` and `dev.afd/idempotencyKey`, the keys `afd::mcp_stdio` reads from
/// `_meta` that a client may be unable to set (TypeScript's `liftMetaArgument`). Other keys are
/// dropped, as undeclared `_meta` keys are. A failure when `meta` is not an object, or disagrees
/// with `_meta`.
std::optional<CommandResult> lift_meta_argument(Json& params, Json& meta);

} // namespace afd::mcp::surface
