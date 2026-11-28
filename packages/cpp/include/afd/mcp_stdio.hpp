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
// It serves `tools/list` and `tools/call` for the commands exposed to MCP, by tool strategy
// (spec/tool-strategies.md: `individual`, `grouped`, the default, or `lazy`), with the
// meta-tools `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail`
// (spec/meta-tools.json). Every route runs the same exposure, context, confirmation and
// validation checks as a command's own tool, and a command not exposed to MCP is answered as an
// unknown one (spec/error-codes.md, D4). A meta-tool's `meta` argument carries
// `dev.afd/context` for clients that cannot set `_meta`.
//
// Every tool result carries the result as `structuredContent` and as JSON text, and a command
// with an `output_schema` advertises the CommandResult envelope as its top-level `outputSchema`
// (spec/command-metadata.md, "Structured results"). Command failures are results with
// `isError: true`, never JSON-RPC errors. `notifications/cancelled` cancels the call in flight
// through `CommandContext::cancellation`. It has no HTTP transport.
//
// Contexts (spec/tool-strategies.md, "Contexts"): with `StdioServerOptions::contexts`, a 2025
// connection keeps one context stack, which `afd-context-enter` and `afd-context-exit` change,
// and a 2026-07-28 request names its context in `_meta["dev.afd/context"]`. `tools/list` lists
// only the commands available in the active context, and a call outside it fails with
// COMMAND_NOT_IN_CONTEXT.
//
// Confirmations (spec/command-metadata.md, "Confirmations"): with `confirmations` on, a command
// with `confirm_prompt` runs only after an accepted form elicitation or, under `enforce`, an
// acknowledgement (`confirm: true` in the arguments or `_meta["dev.afd/confirm"]: true`).
// `afd-batch` and `afd-pipe` take a `confirm` array of command names, and ask once, before any
// step runs, for every gated step. Approvals: an approval middleware created with
// `.relay = afd::ApprovalRelay::mcp_elicitation` asks the human behind the client in the same way
// for a call to one command ("Asking the human over MCP"), and approves an `afd-batch` or
// `afd-pipe` up front, as a whole: one question for every gated step before any runs ("One
// approval up front for `afd-batch` and `afd-pipe`").
#pragma once

#include "afd/command.hpp"
#include "afd/contexts.hpp"
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

/// How `tools/list` presents the commands (spec/tool-strategies.md, "Tool lists"). Every strategy
/// lists the five meta-tools first: `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`,
/// `afd-pipe` (#533). Every strategy routes every meta-tool and every exposed command by its own
/// name, so a call never depends on which tools were listed.
enum class ToolStrategy {
    /// Then one tool per command.
    individual,
    /// Then one tool per group of commands, taking `{ action, params }`, in the order of each
    /// group's first command (the default).
    grouped,
    /// Then the context tools when contexts are configured, and nothing else; the same in every
    /// context.
    lazy,
    /// Then the context tools when contexts are configured, then the command tools of
    /// `StdioServerOptions::first_class_tools` in that order; the same in every context
    /// (spec/tool-strategies.md, "Hybrid").
    hybrid
};

/// The most first-class tools a hybrid server lists (spec/tool-strategies.md, H5).
inline constexpr std::size_t max_first_class_tools = 8;

/// Default per-command deadline in milliseconds (`spec/execution-controls.md`, `defaultTimeoutMs`).
inline constexpr double default_command_timeout_ms = 30000.0;

/// The strategy's name, as `afd-help` reports it: `individual`, `grouped`, `lazy` or `hybrid`.
std::string_view tool_strategy_name(ToolStrategy strategy) noexcept;

/// A grouped tool's name for a command; `std::nullopt` or an empty name is `general`.
using GroupBy = std::function<std::optional<std::string>(const CommandDefinition& command)>;

/// The `_meta` key a client sets to `true` to acknowledge a confirm-gated call.
inline constexpr std::string_view confirm_meta_key = "dev.afd/confirm";

/// The `_meta` key an approver client sets to the approval token of the call it retries
/// (spec/approvals.md, "Approval evidence from an approver client").
inline constexpr std::string_view approval_meta_key = "dev.afd/approval";

/// Whether the caller of one MCP `tools/call` is an approver, from its context once `context_hook`
/// has run. Only `true` makes an approver.
using ApproverPredicate = std::function<bool(const CommandContext& context)>;

/// The `_meta` key the server sets on a resource entry to carry its SHA-256 digest
/// (spec/mcp-resources.md, R6).
inline constexpr std::string_view digest_meta_key = "dev.afd/digest";

/// The MCP Skills extension identifier (spec/mcp-resources.md, S1; SEP-2640).
inline constexpr std::string_view skills_extension_id = "io.modelcontextprotocol/skills";

/// One entry of `resources/list` (spec/mcp-resources.md, R2).
struct ResourceEntry {
    /// Required absolute RFC 3986 URI (scheme, no whitespace or control characters).
    std::string uri;
    /// Required non-empty display name.
    std::string name;
    std::optional<std::string> title;
    std::optional<std::string> description;
    std::optional<std::string> mime_type;
    /// Raw byte length; required when content bytes are supplied up front.
    std::optional<std::uint64_t> size;
    /// Optional MCP `icons` array, passed through unchanged.
    std::optional<Json> icons;
    /// Optional MCP `annotations` object, passed through unchanged.
    std::optional<Json> annotations;
    /// Optional extra `_meta` entries (T2 key rule; `ui` is not allowed on resource entries).
    std::optional<Json> meta;
};

/// Content returned by a `ResourceProvider::read` callback (spec/mcp-resources.md, R4).
struct ResourceContents {
    /// Raw bytes; emitted as `text` if valid UTF-8, otherwise padded RFC 4648 base64 `blob`.
    std::string bytes;
    /// Optional fallback MIME type (used when the listed entry omits `mime_type`).
    std::optional<std::string> mime_type;
    /// Optional `_meta` on the read content item (T2 key rule; `ui` is allowed here).
    std::optional<Json> meta;
};

/// A static resource with its content bytes supplied up front (`size` and `dev.afd/digest` are
/// computed automatically and checked at startup).
struct StaticResource {
    ResourceEntry entry;
    std::string bytes;
    /// Optional `_meta` on the `resources/read` content item (`ui` is allowed here).
    std::optional<Json> content_meta;
};

/// Resource provider for `StdioServerOptions::resources` (spec/mcp-resources.md, R1-R6).
struct ResourceProvider {
    /// Static resources whose bytes are known up front.
    std::vector<StaticResource> static_resources;
    /// Optional dynamic listing callback; validated at startup and on every `resources/list`.
    std::function<Expected<std::vector<ResourceEntry>>()> list;
    /// Optional dynamic read callback; returns `std::nullopt` when the URI is not found.
    std::function<Expected<std::optional<ResourceContents>>(std::string_view uri)> read;
};

/// One file inside a skill (spec/mcp-resources.md, S2).
struct SkillFile {
    /// Relative `/`-separated UTF-8 path (for example `"SKILL.md"`, `"references/STYLE.md"`).
    std::string path;
    /// Raw file bytes.
    std::string bytes;
};

/// One Agent Skill in a `SkillCatalog` (spec/mcp-resources.md, S2).
struct Skill {
    /// `/`-separated skill path whose last segment equals frontmatter `name`.
    std::string path;
    /// The skill's files (must include `"SKILL.md"`).
    std::vector<SkillFile> files;
};

/// Loads a skill from a directory on disk (spec/mcp-resources.md, S2): refuses symbolic links
/// that leave the skill directory, non-regular files, and enforces the 512-file and 16 MiB caps.
Expected<Skill> skill_from_directory(std::string_view skill_path, std::string_view directory);

/// An ordered, fixed catalog of Agent Skills (spec/mcp-resources.md, S1-S7).
struct SkillCatalog {
    std::vector<Skill> skills;
    /// Enable `resources/directory/read` and advertise `directoryRead: true` (S6). Off by default.
    bool directory_read = false;
};

/// The request a `tools/call` context is built for, as `StdioServerOptions::context_hook` sees it.
struct RequestInfo {
    /// The negotiated (2025) or requested (2026-07-28) protocol version.
    std::string protocol_version;
    /// Whether the request is a 2026-07-28 one.
    bool modern = false;
    /// The client's declared capabilities: from `initialize`, or the request's `_meta`.
    Json client_capabilities = Json::object();
    /// The active context, when the server configures contexts.
    std::optional<std::string> active_context;
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
    /// How `tools/list` presents the commands. Default: `grouped`, as in every language.
    ToolStrategy tool_strategy = ToolStrategy::grouped;
    /// Under `hybrid`, and only then: the commands listed as their own tools after the
    /// meta-tools and context tools, in this order. At most `max_first_class_tools`, each a
    /// registered command exposed to MCP, listed once, and neither a meta-tool nor a context
    /// tool; a bootstrap command may be one. `create` fails otherwise, naming the entry.
    std::optional<std::vector<std::string>> first_class_tools;
    /// The grouped tool of each command under `grouped`. Default: its `category`, else the first
    /// kebab-case segment of its name, else `general`.
    GroupBy group_by;
    /// The contexts the server serves (contexts.hpp). Register their commands first with
    /// `afd::register_context_commands(registry, contexts)`; `create` fails when they are
    /// missing. Empty (the default): no contexts.
    std::vector<ContextConfig> contexts;
    /// The `ttlMs` of `tools/list` and `server/discover` on 2026-07-28. Default: 300000, or 0
    /// with contexts under `individual` or `grouped`, whose lists vary by
    /// `_meta["dev.afd/context"]`, which clients leave out of their cache key.
    std::optional<std::int64_t> tools_list_ttl_ms;
    /// Advertise the CommandResult envelope (`command_result_output_schema`) as the top-level
    /// `outputSchema` of each tool whose command has an `output_schema`. Clients validate
    /// `structuredContent` against it, so a handler whose `data` does not match fails on the
    /// client. `_meta.outputSchema` and `structuredContent` are sent either way.
    bool advertise_output_schema = true;
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
    /// Called if `serve` stops before `in` reaches EOF (for example, when writing to `out`
    /// fails), so a host using a blocking input stream can close or unblock `in` before the
    /// reader thread is joined.
    std::function<void()> on_shutdown;
    /// Optional resource provider (spec/mcp-resources.md, R1-R6). When set (or when `skills` is
    /// set), the server declares `resources` and serves `resources/*`.
    std::optional<ResourceProvider> resources;
    /// Optional Agent Skills catalog (spec/mcp-resources.md, S1-S7). When set, the server
    /// declares `resources` and `extensions["io.modelcontextprotocol/skills"]`, validates every
    /// skill at startup, and serves `skills/list`, `skills/get`, skill files as resources, and
    /// (when `directory_read` is true) `resources/directory/read`.
    std::optional<SkillCatalog> skills;
    /// Default per-command deadline in milliseconds (`spec/execution-controls.md`,
    /// `defaultTimeoutMs`). Applied when `context_hook` leaves `CommandContext::timeout_ms` unset,
    /// without mutating `CommandContext::timeout_ms` or journal context digests. Set to
    /// `std::nullopt` or `0` to disable the default deadline. Negative or non-finite values fail
    /// `StdioServer::create`.
    std::optional<double> default_timeout_ms = default_command_timeout_ms;
    /// Which MCP callers are approvers (`spec/approvals.md`, "Approval evidence from an approver
    /// client"). For an approver, a held call carries `details.approvalToken` and never triggers a
    /// form elicitation, and `_meta["dev.afd/approval"]` carries its token back on single-command
    /// MCP 2026-07-28 calls, bound to the call's principal binding (M8).
    ApproverPredicate approver;
};

/// Sends a request (`{"method", "params"}`) to the client and returns its `result`, or
/// `std::nullopt` when the client answered with an error, went away or the call was cancelled.
/// `StdioServer::serve` supplies one for 2025 connections.
using ClientRequester = std::function<std::optional<Json>(const Json& request)>;

/// The server for one stdio connection. Not thread-safe: `serve` handles one message at a time.
class StdioServer {
public:
    /// Fails when `state_secret` is set but shorter than 32 bytes, when `contexts` are set but
    /// their commands are not registered and exposed to MCP, when `tools_list_ttl_ms` is
    /// negative, or when `first_class_tools` does not suit `tool_strategy` (see that option).
    /// `registry` must outlive the server, and the commands it serves as first-class tools must
    /// stay registered and exposed.
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

    /// The tools `tools/list` returns with no active context, by the server's strategy.
    [[nodiscard]] Json tools() const;

private:
    struct State;
    explicit StdioServer(std::unique_ptr<State> state);
    std::unique_ptr<State> state_;
};

} // namespace afd::mcp
