// Contexts: named scopes that narrow which commands a caller sees and runs
// (spec/tool-strategies.md, "Contexts"; Rust's `afd::contexts`, TypeScript's and Python's
// `contexts` server option).
//
// A command with `contexts` is available only while one of them is active; a command without
// them is available in every context, and every command is available when no context is active.
// `CommandRegistry::execute` enforces `CommandContext::active_context` with COMMAND_NOT_IN_CONTEXT.
//
// `register_context_commands` adds `afd-context-list`, `afd-context-enter` and `afd-context-exit`.
// What they act on is the call's `CommandContext::context_scope`, which only the MCP server sets
// (afd/mcp_stdio.hpp, `StdioServerOptions::contexts`):
//
// - a session's `ContextStack` (a 2025 stdio connection), which enter and exit change;
// - one request's context (MCP 2026-07-28 sends it in `_meta["dev.afd/context"]`), which the
//   tools validate but never change, answering `persisted: false`;
// - none (an in-process call): enter and exit answer SESSION_REQUIRED.
#pragma once

#include "afd/command.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

class CommandRegistry;

/// The `_meta` key that selects the active context of one MCP 2026-07-28 request.
inline constexpr std::string_view context_meta_key = "dev.afd/context";

/// The default maximum depth of a `ContextStack`, as in the other languages.
inline constexpr std::size_t default_context_max_depth = 16;

/// A context a server configures, as `afd-context-list` reports it.
struct ContextConfig {
    /// The context name, as commands list it in `contexts`.
    std::string name;
    /// What the context is for.
    std::optional<std::string> description;
    /// Phrases that suggest entering the context.
    std::vector<std::string> triggers;
    /// Listing order: higher first; equal priorities keep their configured order.
    std::optional<std::int64_t> priority;
};

/// One session's stack of entered contexts; the top is the active context. Thread-safe.
/// Re-entering the active context is a no-op, and entering fails once `max_depth` are stacked.
class ContextStack {
public:
    /// An empty stack of at most `max_depth` contexts (at least 1).
    explicit ContextStack(std::size_t max_depth = default_context_max_depth);

    [[nodiscard]] std::optional<std::string> active() const;
    /// The entered contexts, bottom first.
    [[nodiscard]] std::vector<std::string> entries() const;
    [[nodiscard]] std::size_t max_depth() const noexcept { return max_depth_; }

    /// Enters `name`; `false` when the stack already holds `max_depth` contexts.
    bool enter(std::string name);
    /// Leaves the active context and returns it.
    std::optional<std::string> exit();

private:
    mutable std::mutex mutex_;
    std::vector<std::string> entries_;
    std::size_t max_depth_;
};

/// What the context tools act on for one call: a session's stack, or one request's context.
struct ContextScope {
    /// A session's persistent stack; unset for a single request's context.
    std::shared_ptr<ContextStack> session;
    /// One request's active context, when `session` is unset.
    std::optional<std::string> request;

    /// The active context.
    [[nodiscard]] std::optional<std::string> active() const {
        return session ? session->active() : request;
    }
};

/// The `afd-context-list`, `afd-context-enter` and `afd-context-exit` commands for `contexts`:
/// category `bootstrap`, exposed to MCP.
[[nodiscard]] std::vector<CommandDefinition> context_commands(std::vector<ContextConfig> contexts);

/// Registers the context commands for `contexts` into `registry`. Returns why it registered
/// nothing: no contexts, a blank or repeated name, or a context command already registered.
[[nodiscard]] std::optional<std::string>
register_context_commands(CommandRegistry& registry, std::vector<ContextConfig> contexts);

} // namespace afd
