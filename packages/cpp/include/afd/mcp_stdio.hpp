// An MCP server over stdio for a CommandRegistry: the opt-in `afd::mcp_stdio` target
// (CMake option AFD_BUILD_MCP_STDIO). The core `afd::afd` library stays transport-free.
//
// Newline-delimited JSON-RPC 2.0 on one connection, in both MCP eras:
//
// - MCP 2026-07-28: every request names its version and client capabilities in `_meta`, and
//   `server/discover` describes the server. Results carry `resultType`; an elicitation is an
//   `input_required` result that the client answers by retrying with `inputResponses` and the
//   signed `requestState`.
// - 2025 clients: `initialize`, `notifications/initialized` and `ping`. An elicitation is a
//   server-sent `elicitation/create` request on the same connection.
//
// It serves `tools/list` and `tools/call` with one tool per command exposed to MCP
// (`command_to_mcp_tool`, afd/mcp.hpp). Command failures are CommandResults with
// `isError: true`, never JSON-RPC errors. `notifications/cancelled` cancels the call in flight
// through `CommandContext::cancellation`. It has no meta-tools, context tools or HTTP transport.
//
// Confirmations (spec/command-metadata.md, "Confirmations"): with `confirmations` on, a command
// with `confirm_prompt` runs only after an accepted form elicitation or, under `enforce`, an
// acknowledgement (`confirm: true` in the arguments or `_meta["dev.afd/confirm"]: true`).
// Approvals: an approval middleware created with `.relay = afd::ApprovalRelay::mcp_elicitation`
// asks the human behind the client in the same way ("Asking the human over MCP").
#pragma once

#include "afd/command.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/registry.hpp"
#include "afd/runtime.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <iosfwd>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd::mcp {

/// How the server treats `confirm_prompt`.
enum class ConfirmationMode {
    /// No enforcement (the default).
    off,
    /// An accepted elicitation, or an acknowledgement from the caller.
    enforce,
    /// An accepted elicitation only.
    require_human
};

/// The `_meta` key a client sets to `true` to acknowledge a confirm-gated call.
inline constexpr std::string_view confirm_meta_key = "dev.afd/confirm";

/// The request a `tools/call` context is built for, as `StdioServerOptions::context_hook` sees it.
struct RequestInfo {
    /// The negotiated (2025) or requested (2026-07-28) protocol version.
    std::string protocol_version;
    /// Whether the request is a 2026-07-28 one.
    bool modern = false;
    /// The client's declared capabilities: from `initialize`, or the request's `_meta`.
    Json client_capabilities = Json::object();
    /// The request's `_meta`, or an empty object.
    Json meta = Json::object();
};

/// Options for `StdioServer::create`.
struct StdioServerOptions {
    std::string name = "afd-server";
    std::string version = "0.0.0";
    /// The `instructions` of `server/discover`. Default: a sentence saying the server is an AFD
    /// server whose tools return CommandResults.
    std::optional<std::string> instructions;
    /// Lines longer than this are rejected, bounding memory for a hostile client.
    std::size_t max_line_bytes = std::size_t{1} << 20;
    ConfirmationMode confirmations = ConfirmationMode::off;
    /// The HMAC key of `requestState`, at least 32 bytes. Default (empty): 32 random bytes for
    /// this server, so a state works only on the process that issued it.
    std::string state_secret;
    /// Expires `requestState` and times answers. Default: a `SystemClock`.
    std::shared_ptr<const Clock> clock;
    /// How long `serve` waits for a 2025 client to answer a question it asked in band, in
    /// milliseconds. The call then fails as unanswered, so one unanswered form cannot hold up the
    /// connection for good. Default: 10 minutes, as long as an answer counts.
    std::int64_t elicitation_timeout_ms = 600000;
    /// Called for every `tools/call` after the server filled the context (`surface` MCP, an
    /// `agent` actor, a trace id and the call's cancellation), to add what the host knows, such
    /// as the actor's id. Never set `approval` here from anything the request carries.
    std::function<void(CommandContext& context, const RequestInfo& request)> context_hook;
};

/// Sends a request (`{"method", "params"}`) to the client and returns its `result`, or
/// `std::nullopt` when the client answered with an error, went away or the call was cancelled.
/// `StdioServer::serve` supplies one for 2025 connections.
using ClientRequester = std::function<std::optional<Json>(const Json& request)>;

/// The server for one stdio connection. Not thread-safe: `serve` handles one message at a time.
class StdioServer {
public:
    /// Fails when `state_secret` is set but shorter than 32 bytes. `registry` must outlive the
    /// server.
    static Expected<std::unique_ptr<StdioServer>> create(const CommandRegistry& registry,
                                                         StdioServerOptions options = {});

    ~StdioServer();
    StdioServer(const StdioServer&) = delete;
    StdioServer& operator=(const StdioServer&) = delete;

    /// Handles one JSON-RPC message (one line) and returns the response line, or `std::nullopt`
    /// for a notification or a response. On a 2025 connection, `ask` (when given) carries
    /// elicitations to the client; without it the call is handled as for a client that cannot
    /// elicit. `cancellation` becomes the call's `CommandContext::cancellation`.
    std::optional<std::string> handle_message(std::string_view line,
                                              const ClientRequester& ask = {},
                                              const CancellationToken& cancellation = {});

    /// Reads messages from `in` until EOF and writes one line per response to `out`. A reader
    /// thread watches for `notifications/cancelled` and elicitation responses while a call runs.
    void serve(std::istream& in, std::ostream& out);

    /// The tools `tools/list` returns.
    [[nodiscard]] Json tools() const;

private:
    struct State;
    explicit StdioServer(std::unique_ptr<State> state);
    std::unique_ptr<State> state_;
};

} // namespace afd::mcp
