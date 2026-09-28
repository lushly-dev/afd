// A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, enough for MCP clients and the
// todo conformance runner (initialize, notifications/initialized, ping, tools/list, tools/call).
//
// Lives in the example backend, not the library: afd-cpp stays transport-free (proposal D10).
#pragma once

#include <cstddef>
#include <iosfwd>
#include <optional>
#include <string>

#include <afd/registry.hpp>

namespace todo {

struct McpServerInfo {
    std::string name = "afd-todo-cpp";
    std::string version = "1.0.0";
    /// Lines longer than this are rejected, bounding memory for a hostile client.
    std::size_t max_line_bytes = std::size_t{1} << 20;
};

/// Handles one JSON-RPC message (one line). Returns the response line, or `std::nullopt` for a
/// notification. Command failures are CommandResults with `isError: true`, never JSON-RPC errors.
std::optional<std::string> handle_message(const afd::CommandRegistry& registry,
                                          std::string_view line, const McpServerInfo& info = {});

/// Reads messages from `in` until EOF and writes one response line per request to `out`.
void serve(const afd::CommandRegistry& registry, std::istream& in, std::ostream& out,
           const McpServerInfo& info = {});

} // namespace todo
