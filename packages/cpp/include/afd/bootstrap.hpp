// The bootstrap commands (spec/tool-strategies.md, "Terms"): `afd-help`, `afd-docs` and
// `afd-schema`, which describe a registry's commands to an agent. TypeScript's
// `getBootstrapCommands` (packages/server/src/bootstrap) is the reference; Rust's
// `register_bootstrap_commands` is the same API.
//
// They describe what a remote agent can see and call: the commands exposed to MCP (themselves
// among them, and the context commands when registered) that are available in the call's active
// context. They are category `bootstrap`, tagged `bootstrap`, `read` and `safe`, and exposed to
// MCP.
//
// Differences from TypeScript:
//
// - C++ booleans have no unset state, so `destructive` and `undoable` are reported when true.
// - `afd::Json` keeps object keys sorted, so an input schema's properties are listed in key
//   order, not declaration order.
// - `afd-help` groups `groupedByCategory` by each command's category in both formats, as Python
//   and Rust do; TypeScript's brief format puts every command under `uncategorized`.
// - `afd-help` lists the declared context fields whenever the registry has some; TypeScript's
//   does when a server built it.
// - `afd-docs` orders categories and names by byte, as Rust does, not with `localeCompare`.
// - The TypeScript generator collapses ASCII whitespace around line breaks in a description;
//   JavaScript's `\s` also matches Unicode spaces.
//
// `afd-help` does not report `toolStrategy` yet: `afd::mcp_stdio` lists one tool per command
// (#1451).
#pragma once

#include "afd/command.hpp"

#include <optional>
#include <string>
#include <vector>

namespace afd {

class CommandRegistry;

/// The category of the bootstrap and context commands.
inline constexpr char bootstrap_category[] = "bootstrap";

/// `afd-help`, `afd-docs` and `afd-schema`, describing `registry`. They keep a pointer to it, so
/// `registry` must outlive them; registering them into `registry` itself (as
/// `register_bootstrap_commands` does) satisfies that.
[[nodiscard]] std::vector<CommandDefinition> bootstrap_commands(const CommandRegistry& registry);

/// Registers the bootstrap commands into `registry`, so they describe it and list themselves
/// alongside its commands, including ones registered later. Returns why it registered nothing: a
/// command with a bootstrap name is already registered.
[[nodiscard]] std::optional<std::string> register_bootstrap_commands(CommandRegistry& registry);

/// A TypeScript module declaring one input type per command (`todo-create` becomes
/// `export type TodoCreateInput = ...`), as `afd-schema` with `format: "typescript"` returns it.
/// Each entry of `schemas` has `name`, `description` and `inputSchema`. TypeScript's
/// `generateInputTypes`.
[[nodiscard]] std::string generate_input_types(const Json& schemas);

} // namespace afd
