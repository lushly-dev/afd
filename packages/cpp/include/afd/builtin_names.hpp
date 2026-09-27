// Names of the tools an AFD MCP server provides itself. They are not the application's commands:
// servers reserve them, and tooling that inspects a remote server (such as `afd validate
// --surface`) skips them. The TypeScript (@lushly-dev/afd-core), Python and Rust packages export
// the same names.
#pragma once

#include <algorithm>
#include <iterator>
#include <string_view>

namespace afd {

/// Tools the server's tool router handles itself.
inline constexpr std::string_view afd_meta_tool_names[] = {"afd-call", "afd-batch", "afd-pipe",
                                                           "afd-discover", "afd-detail"};

/// Discovery commands registered by the bootstrap option.
inline constexpr std::string_view afd_bootstrap_command_names[] = {"afd-help", "afd-docs",
                                                                   "afd-schema"};

/// Context commands registered when a server configures contexts.
inline constexpr std::string_view afd_context_command_names[] = {
    "afd-context-list", "afd-context-enter", "afd-context-exit"};

/// Every tool or command name an AFD server provides itself: the meta-tools, then the bootstrap
/// commands, then the context commands.
inline constexpr std::string_view afd_builtin_tool_names[] = {
    "afd-call",         "afd-batch",         "afd-pipe",        "afd-discover",
    "afd-detail",       "afd-help",          "afd-docs",        "afd-schema",
    "afd-context-list", "afd-context-enter", "afd-context-exit"};

/// Whether `name` is a tool or command that AFD servers provide themselves.
constexpr bool is_afd_builtin_name(std::string_view name) noexcept {
    return std::find(std::begin(afd_builtin_tool_names), std::end(afd_builtin_tool_names), name) !=
           std::end(afd_builtin_tool_names);
}

} // namespace afd
