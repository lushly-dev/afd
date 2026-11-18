#include "afd/actor.hpp"
#include "afd/approval.hpp"
#include "afd/batch.hpp"
#include "afd/errors.hpp"
#include "afd/mcp.hpp"
#include "afd/mcp_stdio.hpp"
#include "afd/middleware.hpp"
#include "afd/pipeline.hpp"
#include "afd/registry.hpp"
#include "afd/result.hpp"
#include "afd/similarity.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <istream>
#include <mutex>
#include <ostream>
#include <random>
#include <set>
#include <thread>
#include <utility>

#include "detail/approval_relay.hpp"
#include "detail/canonical_json.hpp"
#include "detail/hmac.hpp"
#include "detail/sha256.hpp"
#include "tools.hpp"

namespace afd::mcp {
namespace {

// initialize-era versions, newest first. A client's requested version is echoed when supported;
// otherwise the newest.
constexpr std::array<std::string_view, 4> legacy_versions{"2025-11-25", "2025-06-18", "2025-03-26",
                                                          "2024-11-05"};
// The first initialize-era version whose elicitation request carries `mode`.
constexpr std::string_view elicitation_mode_version = "2025-11-25";

// The stateless revision: every request carries its version in _meta, there is no initialize.
constexpr std::string_view modern_version = "2026-07-28";
constexpr std::string_view protocol_version_key = "io.modelcontextprotocol/protocolVersion";
constexpr std::string_view client_capabilities_key = "io.modelcontextprotocol/clientCapabilities";
constexpr std::string_view server_info_key = "io.modelcontextprotocol/serverInfo";
constexpr int unsupported_protocol_version = -32022;
constexpr std::int64_t tools_list_ttl_ms = 300000;

// The `inputRequests` keys of the two questions.
constexpr std::string_view confirm_input_key = "confirm";
constexpr std::string_view approval_input_key = "approval";
// How long a `requestState` stays valid, and how long an answer counts from when its question
// was asked, however many rounds carry it.
constexpr std::int64_t answer_ttl_ms = 600000;
// Labels the state's associated data, so a state of another layout never verifies.
constexpr std::string_view state_binding_version = "afd.cpp.mcp-state.v1";
// Elicitation rounds one 2025 call may take in band: a confirmation, then an approval, and room
// to ask again once.
constexpr int max_in_band_rounds = 4;
constexpr std::size_t min_state_secret_bytes = 32;
// The ids of the server's own elicitation requests on a 2025 connection.
constexpr std::string_view elicitation_id_prefix = "afd-elicitation-";

std::string response(const Json& id, Json result) {
    return wire::serialize(Json{{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(result)}});
}

std::string error_response(const Json& id, int code, std::string message, Json data = nullptr) {
    Json error{{"code", code}, {"message", std::move(message)}};
    if (!data.is_null()) {
        error["data"] = std::move(data);
    }
    return wire::serialize(Json{{"jsonrpc", "2.0"}, {"id", id}, {"error", std::move(error)}});
}

/// `object[key]` when it is an object, else an empty object.
Json object_member(const Json& object, std::string_view key) {
    if (!object.is_object()) {
        return Json::object();
    }
    const auto found = object.find(std::string(key));
    return found != object.end() && found->is_object() ? *found : Json::object();
}

/// `object[key]` when it is a string, else empty. Client data is read only through this and
/// the other checked readers: nlohmann's `value()` throws (or aborts without exceptions) when the
/// member has another type.
std::string string_member(const Json& object, std::string_view key) {
    if (!object.is_object()) {
        return {};
    }
    const auto found = object.find(std::string(key));
    return found != object.end() && found->is_string() ? found->get<std::string>() : std::string();
}

bool is_true(const Json& object, std::string_view key) {
    if (!object.is_object()) {
        return false;
    }
    const auto found = object.find(std::string(key));
    return found != object.end() && found->is_boolean() && found->get<bool>();
}

/// Whether `capabilities` declare form elicitation: `elicitation: {}` (form by default) or
/// `elicitation: {form: {...}}`.
bool declares_form_elicitation(const Json& capabilities) {
    const Json elicitation = object_member(capabilities, "elicitation");
    if (!capabilities.is_object() || !capabilities.contains("elicitation") ||
        !capabilities["elicitation"].is_object()) {
        return false;
    }
    return elicitation.empty() || elicitation.contains("form");
}

Json form_schema(std::string_view field, std::string_view title, std::string_view description) {
    return Json{{"type", "object"},
                {"properties",
                 {{std::string(field),
                   {{"type", "boolean"}, {"title", title}, {"description", description}}}}},
                {"required", Json::array({std::string(field)})}};
}

Json confirm_schema() {
    return form_schema("confirm", "Confirm", "Run the command");
}

Json approval_schema() {
    return form_schema("approve", "Approve", "Allow this action to run");
}

/// The `confirm` property a confirm-gated tool advertises under `enforce`.
Json confirm_property() {
    return Json{{"type", "boolean"},
                {"description", "Set to true to confirm this command, once the user intends it. "
                                "The server asks for confirmation when it is missing."}};
}

/// Whether a command's own input schema declares a `confirm` property.
bool declares_confirm_input(const CommandDefinition& command) {
    const Json properties = object_member(command.input_schema, "properties");
    return properties.contains("confirm");
}

std::string canonical(const Json& value) {
    const auto text = detail::canonical_json_as_read(value);
    return text ? *text : wire::serialize(value);
}

/// The actor fields the state is bound to (`kind`, `id`, `onBehalfOf`), as approval tokens bind
/// them, or `null`.
Json actor_binding(const std::optional<Actor>& actor) {
    if (!actor) {
        return nullptr;
    }
    Json fields = Json::object();
    fields["kind"] = std::string(actor_kind_name(actor->kind));
    if (actor->id) {
        fields["id"] = *actor->id;
    }
    if (actor->on_behalf_of) {
        fields["onBehalfOf"] = *actor->on_behalf_of;
    }
    return fields;
}

/// The binding of a confirmation question: the unpadded base64url SHA-256 of the command and its
/// input, canonically, as TypeScript's `confirmationBinding` writes it.
std::string confirm_question(std::string_view command, const Json& input) {
    const Json steps = Json::array({Json::array({std::string(command), input})});
    return detail::base64url_encode(detail::sha256(canonical(steps)));
}

/// `'a', 'b'`.
std::string quoted(const std::vector<std::string>& names) {
    std::string out;
    for (const auto& name : names) {
        out += (out.empty() ? "'" : ", '") + name + "'";
    }
    return out;
}

CommandError declined_error(const std::vector<std::string>& names) {
    return CommandError{
        .code = error_codes::CONFIRMATION_DECLINED,
        .message = "The user did not confirm " + quoted(names),
        .suggestion =
            "Do not run this again without asking the user first; the user chose not to proceed.",
        .retryable = false,
        .details = Json{{"commands", names}},
        .cause = nullptr,
    };
}

CommandResult confirmation_declined(std::string_view command) {
    return failure(declined_error({std::string(command)}));
}

/// CONFIRMATION_REQUIRED for `names`; `how` is the tool's way to acknowledge, such as "repeat
/// the call with confirm: true".
CommandError required_error(std::string message, const std::vector<std::string>& names,
                            ConfirmationMode mode, std::string_view how) {
    return CommandError{
        .code = error_codes::CONFIRMATION_REQUIRED,
        .message = std::move(message),
        .suggestion =
            mode == ConfirmationMode::enforce
                ? "Make sure the user intends this, then " + std::string(how) + "."
                : std::string("This server accepts only a confirmation from the user: use an "
                              "MCP client that supports elicitation."),
        .retryable = false,
        .details = Json{{"commands", names}},
        .cause = nullptr,
    };
}

CommandResult confirmation_required(std::string_view command, std::string_view prompt,
                                    ConfirmationMode mode,
                                    std::string_view how = "repeat the call with confirm: true") {
    return failure(
        required_error("'" + std::string(command) + "' needs confirmation: " + std::string(prompt),
                       {std::string(command)}, mode, how));
}

/// The result when a 2025 client asked in band gave no answer.
CommandResult unanswered(std::string_view key, std::string_view command, std::string_view prompt) {
    const bool confirmation = key == confirm_input_key;
    return failure(CommandError{
        .code = confirmation ? error_codes::CONFIRMATION_REQUIRED : error_codes::APPROVAL_REQUIRED,
        .message = confirmation
                       ? "'" + std::string(command) + "' needs confirmation: " + std::string(prompt)
                       : std::string(command) + " needs approval before it runs",
        .suggestion = std::string("The client did not answer the ") +
                      (confirmation ? "confirmation" : "approval") +
                      " question. Ask the user, then call again.",
        .retryable = false,
        .details = std::nullopt,
        .cause = nullptr,
    });
}

/// A `tools/call` result: `structured` as `structuredContent` and the same JSON as text.
Json json_tool_result(Json structured, bool is_error) {
    std::string text = wire::serialize(structured);
    return {{"content", {{{"type", "text"}, {"text", std::move(text)}}}},
            {"structuredContent", std::move(structured)},
            {"isError", is_error}};
}

Json tool_result(const CommandResult& result) {
    return json_tool_result(Json(result), !result.success);
}

BatchTiming no_time(std::int64_t now) {
    const std::string at = wire::iso8601_utc(now);
    return BatchTiming{.total_ms = 0, .average_ms = 0, .started_at = at, .completed_at = at};
}

/// The result of a batch that runs nothing: no item results, and `error`.
Json batch_failure(CommandError error, std::int64_t now) {
    return json_tool_result(Json(create_failed_batch_result(std::move(error), no_time(now))), true);
}

/// The result of a pipeline that runs no step: one synthetic failed step at index -1, as
/// TypeScript reports it.
Json pipeline_failure(const CommandError& error) {
    return json_tool_result(Json{{"metadata",
                                  {{"confidence", 0},
                                   {"confidenceBreakdown", Json::array()},
                                   {"reasoning", Json::array()},
                                   {"warnings", Json::array()},
                                   {"sources", Json::array()},
                                   {"alternatives", Json::array()},
                                   {"executionTimeMs", 0},
                                   {"completedSteps", 0},
                                   {"totalSteps", 0}}},
                                 {"steps", Json::array({Json{{"index", -1},
                                                             {"command", ""},
                                                             {"status", "failure"},
                                                             {"executionTimeMs", 0},
                                                             {"error", Json(error)}}})}},
                            true);
}

/// A meta-tool argument's value, or `null` when absent.
Json member(const Json& object, std::string_view key) {
    if (!object.is_object()) {
        return nullptr;
    }
    const auto found = object.find(std::string(key));
    return found != object.end() ? *found : Json();
}

/// The answers one `tools/call` carries: the questions asked last round (`pending`), those
/// accepted in earlier rounds (`accepted`), and the client's responses to the pending ones.
struct Round {
    Json pending = Json::array();
    Json accepted = Json::array();
    Json responses = Json::object();
};

/// Whether `entry` is a question of kind `kind` whose answer still counts at `now`.
bool live(const Json& entry, std::string_view kind, std::int64_t now) {
    return entry.is_object() && string_member(entry, "k") == kind && entry.contains("t") &&
           entry["t"].is_number_integer() && now < entry["t"].get<std::int64_t>() + answer_ttl_ms;
}

/// The action of the client's response to `key`: `accept` only with `field: true`.
enum class Response { missing, accept, decline };

Response response_to(const Round& round, std::string_view key, std::string_view field) {
    const auto found = round.responses.find(std::string(key));
    if (found == round.responses.end() || !found->is_object()) {
        return Response::missing;
    }
    if (string_member(*found, "action") == "accept" &&
        is_true(object_member(*found, "content"), field)) {
        return Response::accept;
    }
    return Response::decline;
}

/// Outcome of one attempt at a call: a result, or the next question.
struct Attempt {
    std::optional<Json> complete;
    std::optional<Json> input_required;
};

} // namespace

struct StdioServer::State {
    const CommandRegistry& registry;
    StdioServerOptions options;
    std::string key;
    // The 2025 connection: set by initialize.
    bool initialized = false;
    std::string legacy_version{legacy_versions.front()};
    Json legacy_capabilities = Json::object();
    // Trace ids. Only the thread that handles messages uses it.
    SystemRandom random;
    // The 2025 connection's context stack (contexts configured).
    std::shared_ptr<ContextStack> session = std::make_shared<ContextStack>();

    State(const CommandRegistry& source, StdioServerOptions settings, std::string secret)
        : registry(source), options(std::move(settings)), key(std::move(secret)) {}

    [[nodiscard]] std::int64_t now() const { return options.clock->wall_ms(); }

    [[nodiscard]] Json server_info() const {
        return {{"name", options.name}, {"version", options.version}};
    }

    /// A modern (2026-07-28) result: `resultType` and the server's identity in `_meta`.
    [[nodiscard]] Json modern_result(Json result) const {
        if (!result.contains("resultType")) {
            result["resultType"] = "complete";
        }
        result["_meta"][std::string(server_info_key)] = server_info();
        return result;
    }

    [[nodiscard]] std::int64_t ttl_ms() const {
        return options.tools_list_ttl_ms.value_or(options.contexts.empty() ? tools_list_ttl_ms : 0);
    }

    [[nodiscard]] std::string default_instructions() const {
        std::string text = options.name +
                           " is an AFD server. Every tool returns a CommandResult as JSON text: "
                           "{ success, data, error: { code, message, suggestion } }; follow "
                           "error.suggestion to recover.";
        switch (options.tool_strategy) {
        case ToolStrategy::lazy:
            text += " Call afd-discover to find commands, afd-detail for a command schema, and "
                    "afd-call to run one.";
            break;
        case ToolStrategy::grouped:
            text += " Each tool groups related commands: pass { action, params }. afd-detail "
                    "returns a command schema; afd-call runs any command by name.";
            break;
        case ToolStrategy::individual:
            text += " Each command is its own tool; afd-call also runs any command by name.";
            break;
        }
        text += " Use afd-batch for several independent commands and afd-pipe to chain them.";
        // With the bootstrap commands (afd::register_bootstrap_commands), as Rust: all three
        // registered and exposed to MCP.
        const bool bootstrap = std::all_of(
            std::begin(afd_bootstrap_command_names), std::end(afd_bootstrap_command_names),
            [this](std::string_view name) {
                const auto command = registry.get(name);
                return command && is_exposed_to(command->definition.expose, Interface::mcp);
            });
        if (bootstrap) {
            text += " afd-help, afd-docs and afd-schema describe this server.";
        }
        if (!options.contexts.empty()) {
            text += " Commands are scoped by context (afd-context-list lists them). Send _meta[\"" +
                    std::string(context_meta_key) +
                    "\"] with a context name on tools/list and tools/call to work in that context.";
        }
        return text;
    }

    /// The context scope of one request: a 2025 connection's stack, or the context a 2026-07-28
    /// request names in `_meta`. Unset without contexts; an error message for a context the
    /// server does not configure.
    [[nodiscard]] Expected<std::shared_ptr<const ContextScope>>
    request_scope(const RequestInfo& info) const {
        if (options.contexts.empty()) {
            return std::shared_ptr<const ContextScope>();
        }
        if (!info.modern) {
            return std::make_shared<const ContextScope>(ContextScope{.session = session});
        }
        const auto requested = info.meta.find(std::string(context_meta_key));
        if (requested == info.meta.end()) {
            return std::make_shared<const ContextScope>();
        }
        if (requested->is_string()) {
            const auto& name = requested->get_ref<const std::string&>();
            for (const auto& config : options.contexts) {
                if (config.name == name) {
                    return std::make_shared<const ContextScope>(ContextScope{.request = name});
                }
            }
        }
        return unexpected("Unknown context in _meta[\"" + std::string(context_meta_key) + "\"]");
    }

    [[nodiscard]] std::string known_contexts() const {
        std::string names;
        for (const auto& config : options.contexts) {
            names += (names.empty() ? "" : ", ") + config.name;
        }
        return names;
    }

    [[nodiscard]] Json discover_result() const {
        return {{"resultType", "complete"},
                {"supportedVersions", Json::array({std::string(modern_version)})},
                {"capabilities", {{"tools", {{"listChanged", false}}}}},
                {"_meta", {{std::string(server_info_key), server_info()}}},
                {"instructions", options.instructions.value_or(default_instructions())},
                {"ttlMs", ttl_ms()},
                {"cacheScope", "public"}};
    }

    Json initialize_result(const Json& params) {
        std::string version(legacy_versions.front());
        if (params.is_object()) {
            if (const auto requested = params.find("protocolVersion");
                requested != params.end() && requested->is_string()) {
                for (const auto supported : legacy_versions) {
                    if (requested->get_ref<const std::string&>() == supported) {
                        version = std::string(supported);
                    }
                }
            }
        }
        initialized = true;
        legacy_version = version;
        legacy_capabilities = object_member(params, "capabilities");
        return {{"protocolVersion", version},
                {"capabilities", {{"tools", {{"listChanged", false}}}}},
                {"serverInfo", server_info()}};
    }

    /// Whether `command` is available in `active` (every command is with none active).
    static bool in_context(const CommandDefinition& command,
                           const std::optional<std::string>& active) {
        return !active || command.contexts.empty() ||
               std::find(command.contexts.begin(), command.contexts.end(), *active) !=
                   command.contexts.end();
    }

    /// Whether a command's tool advertises the `confirm` acknowledgement.
    [[nodiscard]] bool accepts_confirm(const CommandDefinition& command) const {
        return options.confirmations == ConfirmationMode::enforce && command.confirm_prompt &&
               !declares_confirm_input(command);
    }

    /// The command tool of `command`, as the individual strategy lists it.
    [[nodiscard]] Json command_tool(const CommandDefinition& command) const {
        Json tool = command_to_mcp_tool(command);
        if (accepts_confirm(command)) {
            Json& schema = tool["inputSchema"];
            if (!schema.is_object()) {
                schema = Json{{"type", "object"}};
            }
            schema["properties"]["confirm"] = confirm_property();
        }
        if (options.advertise_output_schema && command.output_schema) {
            tool["outputSchema"] = command_result_output_schema(*command.output_schema);
        }
        return tool;
    }

    /// The commands exposed to MCP and available in `active`, in registration order.
    [[nodiscard]] std::vector<std::shared_ptr<const RegisteredCommand>>
    callable(const std::optional<std::string>& active) const {
        std::vector<std::shared_ptr<const RegisteredCommand>> commands;
        for (auto& command : registry.list_by_exposure(Interface::mcp)) {
            if (in_context(command->definition, active)) {
                commands.push_back(std::move(command));
            }
        }
        return commands;
    }

    /// `commands` with their command tools. The definitions stay owned by `commands`.
    [[nodiscard]] std::vector<surface::Listed>
    listed(const std::vector<std::shared_ptr<const RegisteredCommand>>& commands) const {
        std::vector<surface::Listed> out;
        for (const auto& command : commands) {
            out.push_back({.command = &command->definition,
                           .tool = command_tool(command->definition),
                           .accepts_confirm = accepts_confirm(command->definition)});
        }
        return out;
    }

    /// The grouped tool name of `command`.
    [[nodiscard]] std::string group_of(const CommandDefinition& command) const {
        if (options.group_by) {
            auto group = options.group_by(command);
            return group && !group->empty() ? *group : std::string("general");
        }
        return surface::default_command_group(command);
    }

    [[nodiscard]] Json tools(const std::optional<std::string>& active = std::nullopt) const {
        Json tools = Json::array();
        if (options.tool_strategy == ToolStrategy::lazy) {
            for (const auto* name :
                 {"afd-discover", "afd-detail", "afd-batch", "afd-pipe", "afd-call"}) {
                tools.push_back(surface::meta_tool(name));
            }
            return tools;
        }
        for (const auto* name : {"afd-batch", "afd-pipe", "afd-call"}) {
            tools.push_back(surface::meta_tool(name));
        }
        const auto commands = callable(active);
        const auto entries = listed(commands);
        if (options.tool_strategy == ToolStrategy::individual) {
            for (const auto& entry : entries) {
                tools.push_back(entry.tool);
            }
            return tools;
        }
        tools.push_back(surface::meta_tool("afd-detail"));
        std::vector<std::pair<std::string, std::vector<const surface::Listed*>>> groups;
        for (const auto& entry : entries) {
            const std::string group = group_of(*entry.command);
            auto it = std::find_if(groups.begin(), groups.end(),
                                   [&](const auto& existing) { return existing.first == group; });
            if (it == groups.end()) {
                groups.emplace_back(group, std::vector<const surface::Listed*>{&entry});
            } else {
                it->second.push_back(&entry);
            }
        }
        for (const auto& [group, members] : groups) {
            tools.push_back(surface::grouped_tool(group, members));
        }
        return tools;
    }

    // --- requestState -------------------------------------------------------------------------

    /// The state's associated data: the layout, the caller and the call, canonically.
    static std::string state_binding(const std::optional<Actor>& actor, std::string_view command,
                                     const Json& input) {
        return canonical(Json::array({std::string(state_binding_version), actor_binding(actor),
                                      Json::array({std::string(command), input})}));
    }

    [[nodiscard]] std::string state_mac(std::string_view payload, std::string_view binding) const {
        std::string data(state_binding_version);
        data.push_back('\0');
        data.append(payload);
        data.push_back('\0');
        data.append(binding);
        return detail::base64url_encode(detail::hmac_sha256(key, data));
    }

    [[nodiscard]] std::string seal(const Json& payload, std::string_view binding) const {
        const std::string encoded = detail::base64url_encode(wire::serialize(payload));
        return encoded + "." + state_mac(encoded, binding);
    }

    /// The payload of `state` when it verifies for `binding` and has not expired; otherwise
    /// nothing, and the server asks again.
    [[nodiscard]] std::optional<Json> open(std::string_view state, std::string_view binding) const {
        const auto dot = state.find('.');
        if (dot == std::string_view::npos || state.size() > 65536) {
            return std::nullopt;
        }
        const std::string_view encoded = state.substr(0, dot);
        if (!detail::constant_time_equal(state.substr(dot + 1), state_mac(encoded, binding))) {
            return std::nullopt;
        }
        const auto decoded = detail::base64url_decode(encoded);
        if (!decoded) {
            return std::nullopt;
        }
        auto parsed = parse_bounded(*decoded, {.max_depth = 8, .max_bytes = 65536});
        if (!parsed || !parsed->is_object() || !parsed->contains("x") ||
            !(*parsed)["x"].is_number_integer() || now() >= (*parsed)["x"].get<std::int64_t>()) {
            return std::nullopt;
        }
        return std::move(*parsed);
    }

    /// The round a modern retry carries: its state's questions, and the client's responses.
    [[nodiscard]] Round modern_round(const Json& params, std::string_view binding) const {
        Round round;
        if (!params.is_object()) {
            return round;
        }
        const auto state = params.find("requestState");
        if (state == params.end() || !state->is_string()) {
            return round;
        }
        const auto payload = open(state->get_ref<const std::string&>(), binding);
        if (!payload) {
            return round;
        }
        if (payload->contains("p") && (*payload)["p"].is_array()) {
            round.pending = (*payload)["p"];
        }
        if (payload->contains("a") && (*payload)["a"].is_array()) {
            round.accepted = (*payload)["a"];
        }
        round.responses = object_member(params, "inputResponses");
        return round;
    }

    /// An `input_required` result that asks one question, with the state for the retry.
    [[nodiscard]] Json input_required(std::string_view key_name, std::string message,
                                      Json requested_schema, Json question, const Json& accepted,
                                      std::string_view binding) const {
        const std::int64_t asked = now();
        question["t"] = asked;
        Json kept = Json::array();
        for (const auto& entry : accepted) {
            if (entry.is_object() && entry.contains("t") && entry["t"].is_number_integer() &&
                asked < entry["t"].get<std::int64_t>() + answer_ttl_ms) {
                kept.push_back(entry);
            }
        }
        const Json payload{{"p", Json::array({std::move(question)})},
                           {"a", std::move(kept)},
                           {"x", asked + answer_ttl_ms}};
        return {{"resultType", "input_required"},
                {"inputRequests",
                 {{std::string(key_name),
                   {{"method", "elicitation/create"},
                    {"params",
                     {{"mode", "form"},
                      {"message", std::move(message)},
                      {"requestedSchema", std::move(requested_schema)}}}}}}},
                {"requestState", seal(payload, binding)}};
    }

    // --- tools/call ---------------------------------------------------------------------------

    CommandContext call_context(const RequestInfo& info, const CancellationToken& cancellation,
                                const std::shared_ptr<const ContextScope>& scope) {
        CommandContext context;
        context.surface = Interface::mcp;
        context.actor = Actor{.kind = ActorKind::agent};
        // `context.approval` stays unset: approval evidence comes only from trusted surface code
        // after a human approved, never from the arguments or `_meta` of a tool call.
        context.trace_id = "trace-" + std::to_string(options.clock->wall_ms()) + "-" +
                           random_uuid(random).substr(0, 8);
        context.cancellation = cancellation;
        if (options.context_hook) {
            options.context_hook(context, info);
        }
        context.approval.reset();
        context.mcp_approval_relay.reset();
        // The server's: what the request named, or the connection's stack. The registry runs the
        // call in the scope's active context.
        context.context_scope = scope;
        // A remote caller: an unexposed command is an unknown one (D4).
        context.remote = true;
        context.tool_strategy = std::string(tool_strategy_name(options.tool_strategy));
        return context;
    }

    /// One attempt at a call with the answers `round` carries.
    /// `bound` is the validated input when the arguments are valid, the arguments otherwise.
    Attempt attempt(const std::string& name, const Json& arguments, const Json& bound, bool valid,
                    const CommandContext& base, const RegisteredCommand* command, bool gated,
                    bool acknowledged, bool can_elicit, Round& round, std::string_view binding,
                    std::string_view how) {
        const std::int64_t at = now();
        // Invalid input is never confirmed: the registry answers VALIDATION_ERROR instead.
        if (gated && !acknowledged && valid) {
            const std::string question = confirm_question(name, bound);
            bool confirmed = false;
            for (const auto& entry : round.accepted) {
                confirmed = confirmed ||
                            (live(entry, "confirm", at) && string_member(entry, "q") == question);
            }
            if (!confirmed) {
                bool asked = false;
                for (const auto& entry : round.pending) {
                    asked = asked ||
                            (live(entry, "confirm", at) && string_member(entry, "q") == question);
                }
                const Response answer =
                    asked ? response_to(round, confirm_input_key, "confirm") : Response::missing;
                if (answer == Response::decline) {
                    return {.complete = tool_result(confirmation_declined(name)),
                            .input_required = std::nullopt};
                }
                if (answer == Response::accept) {
                    round.accepted.push_back(Json{{"k", "confirm"}, {"q", question}, {"t", at}});
                } else if (can_elicit) {
                    return {.complete = std::nullopt,
                            .input_required = input_required(
                                confirm_input_key, *command->definition.confirm_prompt,
                                confirm_schema(), Json{{"k", "confirm"}, {"q", question}},
                                round.accepted, binding)};
                } else {
                    return {
                        .complete = tool_result(confirmation_required(
                            name, *command->definition.confirm_prompt, options.confirmations, how)),
                        .input_required = std::nullopt};
                }
            }
        }

        CommandContext context = base;
        std::shared_ptr<detail::McpApprovalRelay> relay;
        if (can_elicit && command != nullptr) {
            const Round answers = round;
            relay = std::make_shared<detail::McpApprovalRelay>(
                name, [answers, at](const std::vector<std::string>& bindings) {
                    detail::RelayAnswer answer;
                    for (const auto& entry : answers.pending) {
                        if (!live(entry, "approval", at)) {
                            continue;
                        }
                        const std::string held = string_member(entry, "b");
                        bool matches = false;
                        for (const auto& candidate : bindings) {
                            matches = matches || candidate == held;
                        }
                        if (!matches) {
                            continue;
                        }
                        const Response response =
                            response_to(answers, approval_input_key, "approve");
                        if (response == Response::decline) {
                            answer.kind = detail::RelayAnswer::Kind::decline;
                        } else if (response == Response::accept && entry.contains("e") &&
                                   entry["e"].is_number_integer()) {
                            answer.kind = detail::RelayAnswer::Kind::accept;
                            answer.binding = held;
                            answer.nonce = string_member(entry, "n");
                            answer.expires_at_ms = entry["e"].get<std::int64_t>();
                            answer.mac = string_member(entry, "m");
                        }
                    }
                    return answer;
                });
            context.mcp_approval_relay = relay;
        }

        const CommandResult result = registry.execute(name, arguments, std::move(context));
        if (relay) {
            if (auto hold = relay->take_hold()) {
                return {.complete = std::nullopt,
                        .input_required = input_required(
                            approval_input_key, std::move(hold->message), approval_schema(),
                            Json{{"k", "approval"},
                                 {"b", hold->binding},
                                 {"n", hold->nonce},
                                 {"e", hold->expires_at_ms},
                                 {"m", hold->mac}},
                            round.accepted, binding)};
            }
        }
        return {.complete = tool_result(result), .input_required = std::nullopt};
    }

    /// A call that routes to the one command `name` with `arguments` as its input: the
    /// confirmation gate, then the approval relay, asked in turn. `command` is the exposed command
    /// in the active context, or null (the registry then answers the name). `how` is the tool's
    /// way to acknowledge a confirmation.
    Json single(const std::string& name, const Json& arguments, const RegisteredCommand* command,
                bool acknowledged, std::string_view how, const Json& params,
                const RequestInfo& info, const ClientRequester& ask,
                const CommandContext& context) {
        const bool gated = command != nullptr && options.confirmations != ConfirmationMode::off &&
                           command->definition.confirm_prompt.has_value();
        // Questions and their state bind the validated input, as the person decides on exactly
        // what will run: defaults filled in and undeclared members removed.
        Json bound = arguments;
        bool valid = false;
        if (command != nullptr) {
            if (auto validated = command->input_schema.validate(arguments)) {
                bound = std::move(*validated);
                valid = true;
            }
        }
        const std::string binding = state_binding(context.actor, name, bound);
        const bool can_elicit = declares_form_elicitation(info.client_capabilities) &&
                                (info.modern || static_cast<bool>(ask));
        Round round = info.modern ? modern_round(params, binding) : Round{};

        for (int rounds = 0;; ++rounds) {
            Attempt next = attempt(name, arguments, bound, valid, context, command, gated,
                                   acknowledged, can_elicit, round, binding, how);
            if (next.complete) {
                return std::move(*next.complete);
            }
            if (info.modern) {
                return std::move(*next.input_required);
            }
            if (rounds + 1 >= max_in_band_rounds) {
                return tool_result(confirmation_required(
                    name, command->definition.confirm_prompt.value_or("Run " + name),
                    ConfirmationMode::require_human));
            }
            // A 2025 connection: ask the client in band, then retry with its answers.
            Json responses = Json::object();
            for (const auto& [key_name, request] :
                 (*next.input_required)["inputRequests"].items()) {
                const auto answer = ask_in_band(request, info, ask);
                if (!answer) {
                    // Cancelled (serve sends no reply then), or the client went away, timed out
                    // or answered with an error: nobody declined, so do not say so.
                    return tool_result(unanswered(key_name, name,
                                                  command->definition.confirm_prompt.value_or("")));
                }
                responses[key_name] = *answer;
            }
            Json retry{{"requestState", (*next.input_required)["requestState"]},
                       {"inputResponses", std::move(responses)}};
            round = modern_round(retry, binding);
        }
    }

    /// Sends an `inputRequests` entry to a 2025 client in band; its answer, or nothing.
    static std::optional<Json> ask_in_band(const Json& request, const RequestInfo& info,
                                           const ClientRequester& ask) {
        Json sent = request;
        if (info.protocol_version < elicitation_mode_version) {
            sent["params"].erase("mode");
        }
        auto answer = ask(sent);
        if (!answer || !answer->is_object()) {
            return std::nullopt;
        }
        return answer;
    }

    /// The exposed command `name` when it is available in the active context, else null.
    [[nodiscard]] std::shared_ptr<const RegisteredCommand> routable(std::string_view name,
                                                                    const RequestInfo& info) const {
        auto command = registry.get(name);
        if (!command || !is_exposed_to(command->definition.expose, Interface::mcp) ||
            !in_context(command->definition, info.active_context)) {
            return nullptr;
        }
        return command;
    }

    [[nodiscard]] bool acknowledges(const Json& flag, const RequestInfo& info) const {
        return options.confirmations == ConfirmationMode::enforce &&
               ((flag.is_boolean() && flag.get<bool>()) || is_true(info.meta, confirm_meta_key));
    }

    /// A call to a command's own tool, in any strategy.
    Json direct(const std::string& name, Json arguments, const Json& params,
                const RequestInfo& info, const ClientRequester& ask,
                const CommandContext& context) {
        const auto command = routable(name, info);
        // A command outside the active context, unknown or unexposed, is answered by the registry
        // before anyone is asked.
        bool acknowledged = false;
        if (command && options.confirmations != ConfirmationMode::off &&
            command->definition.confirm_prompt && arguments.is_object() &&
            arguments.contains("confirm")) {
            acknowledged = acknowledges(arguments["confirm"], info);
            // The acknowledgement is the server's, so the command's schema never sees it, unless
            // the command declares a `confirm` of its own.
            if (!declares_confirm_input(command->definition)) {
                arguments.erase("confirm");
            }
        } else if (command) {
            acknowledged = acknowledges(Json(), info);
        }
        return single(name, arguments, command.get(), acknowledged,
                      "repeat the call with confirm: true", params, info, ask, context);
    }

    Json afd_call(const Json& arguments, const Json& params, const RequestInfo& info,
                  const ClientRequester& ask, const CommandContext& context) {
        auto parsed = surface::parse_meta_args(
            "afd-call", arguments, "Provide { command: \"command-name\", input: {...} }");
        if (!parsed) {
            return tool_result(failure(parsed.error()));
        }
        const std::string name = (*parsed)["command"].get<std::string>();
        const Json input = parsed->contains("input") && !(*parsed)["input"].is_null()
                               ? (*parsed)["input"]
                               : Json::object();
        const auto command = routable(name, info);
        if (!command) {
            // Unknown, unexposed (D4) or outside the active context: the registry's answer.
            return tool_result(registry.execute(name, input, context));
        }
        return single(name, input, command.get(), acknowledges(member(*parsed, "confirm"), info),
                      "repeat the afd-call with confirm: true", params, info, ask, context);
    }

    /// A grouped tool call; `std::nullopt` when `name` is not a group.
    std::optional<Json> grouped(const std::string& name, const Json& arguments, const Json& params,
                                const RequestInfo& info, const ClientRequester& ask,
                                const CommandContext& context) {
        std::vector<std::shared_ptr<const RegisteredCommand>> members;
        for (auto& command : registry.list_by_exposure(Interface::mcp)) {
            if (group_of(command->definition) == name) {
                members.push_back(std::move(command));
            }
        }
        if (members.empty()) {
            return std::nullopt;
        }
        const Json action = member(arguments, "action");
        if (!action.is_string() || action.get_ref<const std::string&>().empty()) {
            // The actions the caller is shown: those of the active context.
            std::string actions;
            for (const auto& command : members) {
                if (in_context(command->definition, info.active_context)) {
                    actions += (actions.empty() ? "" : ", ") +
                               surface::command_action(command->definition);
                }
            }
            return tool_result(failure(create_error(
                error_codes::INVALID_GROUPED_CALL,
                "Grouped tool '" + name + "' requires an 'action' parameter",
                {.suggestion = "Provide { action: \"<action>\", params: {...} }. Available "
                               "actions: " +
                               actions})));
        }
        const auto& wanted = action.get_ref<const std::string&>();
        std::vector<std::shared_ptr<const RegisteredCommand>> candidates;
        for (const auto& command : members) {
            if (surface::command_action(command->definition) == wanted) {
                candidates.push_back(command);
            }
        }
        if (candidates.size() != 1) {
            return tool_result(failure(create_error(
                candidates.empty() ? error_codes::COMMAND_NOT_FOUND : error_codes::AMBIGUOUS_ACTION,
                "Action '" + truncate_name(wanted) + "' does not identify one command in group '" +
                    truncate_name(name) + "'",
                {.suggestion = "Use afd-call with the full command name, or list tools to find a "
                               "valid action."})));
        }
        const auto& command = candidates.front();
        const Json found = member(arguments, "params");
        const Json input = found.is_null() ? Json::object() : found;
        if (!in_context(command->definition, info.active_context)) {
            return tool_result(registry.execute(command->definition.name, input, context));
        }
        return single(command->definition.name, input, command.get(),
                      acknowledges(member(arguments, "confirm"), info),
                      "repeat the " + name + " call with confirm: true", params, info, ask,
                      context);
    }

    Json afd_discover(const Json& arguments, const RequestInfo& info) {
        auto parsed = surface::parse_meta_args(
            "afd-discover", arguments,
            "Provide optional { category, tag, tagMode, search, includeMutation, limit, offset }");
        if (!parsed) {
            return tool_result(failure(parsed.error()));
        }
        const auto commands = callable(info.active_context);
        std::vector<const CommandDefinition*> definitions;
        for (const auto& command : commands) {
            definitions.push_back(&command->definition);
        }
        return tool_result(surface::discover(definitions, *parsed));
    }

    Json afd_detail(const Json& arguments, const RequestInfo& info) {
        auto parsed = surface::parse_meta_args(
            "afd-detail", arguments,
            "Provide { command: \"command-name\" } or { command: [\"name-1\", \"name-2\"] } (max "
            "10)");
        if (!parsed) {
            return tool_result(failure(parsed.error()));
        }
        const auto commands = callable(info.active_context);
        const auto entries = listed(commands);
        std::vector<const surface::Listed*> pointers;
        std::vector<std::string> names;
        for (const auto& entry : entries) {
            pointers.push_back(&entry);
            names.push_back(entry.command->name);
        }
        return tool_result(surface::detail(pointers, *parsed, [&](std::string_view name) {
            return not_found_suggestion(name, names, true);
        }));
    }

    /// What the confirmation gate decided for a batch or pipeline.
    struct StepsDecision {
        enum class Kind { proceed, refuse, ask } kind = Kind::proceed;
        std::optional<CommandError> error;
        Json response;
    };

    /// The confirmation gate of a batch or pipeline (`tool`, sent as `request`): it asks once,
    /// before any step runs, for every gated step (an exposed command with a `confirm_prompt`),
    /// listing them all. `acknowledged` holds the `confirm` names.
    StepsDecision confirm_steps(std::string_view tool, const Json& request,
                                const std::vector<std::pair<std::string, Json>>& steps,
                                const std::set<std::string>& acknowledged, std::string_view how,
                                const Json& params, const RequestInfo& info,
                                const ClientRequester& ask, const CommandContext& context) {
        using Kind = StepsDecision::Kind;
        if (options.confirmations == ConfirmationMode::off) {
            return {};
        }
        std::vector<std::pair<const std::pair<std::string, Json>*, std::string>> gated;
        std::vector<std::string> names;
        for (const auto& step : steps) {
            // Every exposed command, whatever the active context: an earlier step can change a
            // 2025 connection's context (afd-context-enter) before a later one runs.
            const auto command = registry.get(step.first);
            if (command && is_exposed_to(command->definition.expose, Interface::mcp) &&
                command->definition.confirm_prompt) {
                gated.emplace_back(&step, *command->definition.confirm_prompt);
                if (std::find(names.begin(), names.end(), step.first) == names.end()) {
                    names.push_back(step.first);
                }
            }
        }
        if (gated.empty()) {
            return {};
        }
        // The question binds the gated commands and their input as sent; the state binds the
        // caller and the whole request.
        Json gated_steps = Json::array();
        for (const auto& [step, prompt] : gated) {
            gated_steps.push_back(Json::array({step->first, step->second}));
        }
        const std::string question =
            detail::base64url_encode(detail::sha256(canonical(gated_steps)));
        const std::string binding = state_binding(context.actor, tool, request);
        const std::int64_t at = now();
        const Round round = info.modern ? modern_round(params, binding) : Round{};
        for (const auto& entry : round.accepted) {
            if (live(entry, "confirm", at) && string_member(entry, "q") == question) {
                return {};
            }
        }
        for (const auto& entry : round.pending) {
            if (live(entry, "confirm", at) && string_member(entry, "q") == question) {
                const Response answer = response_to(round, confirm_input_key, "confirm");
                if (answer == Response::decline) {
                    return {.kind = Kind::refuse, .error = declined_error(names), .response = {}};
                }
                if (answer == Response::accept) {
                    return {};
                }
            }
        }
        if (options.confirmations == ConfirmationMode::enforce &&
            (is_true(info.meta, confirm_meta_key) ||
             std::all_of(names.begin(), names.end(),
                         [&](const std::string& name) { return acknowledged.count(name) > 0; }))) {
            return {};
        }
        const bool can_elicit = declares_form_elicitation(info.client_capabilities) &&
                                (info.modern || static_cast<bool>(ask));
        if (can_elicit) {
            std::string message;
            if (gated.size() == 1) {
                message = gated.front().second;
            } else {
                message = "This request runs commands that need confirmation:";
                for (const auto& [step, prompt] : gated) {
                    message += "\n- " + step->first + ": " + prompt;
                }
            }
            Json asked =
                input_required(confirm_input_key, message, confirm_schema(),
                               Json{{"k", "confirm"}, {"q", question}}, round.accepted, binding);
            if (info.modern) {
                return {.kind = Kind::ask, .error = std::nullopt, .response = std::move(asked)};
            }
            const auto answer =
                ask_in_band(asked["inputRequests"][std::string(confirm_input_key)], info, ask);
            if (answer) {
                if (string_member(*answer, "action") == "accept" &&
                    is_true(object_member(*answer, "content"), "confirm")) {
                    return {};
                }
                return {.kind = Kind::refuse, .error = declined_error(names), .response = {}};
            }
            // Cancelled, or the client went away, timed out or answered with an error: nobody
            // declined, so do not say so.
            return {.kind = Kind::refuse,
                    .error =
                        *unanswered(confirm_input_key, names.front(), gated.front().second).error,
                    .response = {}};
        }
        std::string message;
        if (gated.size() == 1 || names.size() == 1) {
            message = "'" + names.front() + "' needs confirmation: " + gated.front().second;
        } else {
            message = quoted(names) + " need confirmation";
        }
        return {.kind = Kind::refuse,
                .error = required_error(std::move(message), names, options.confirmations, how),
                .response = {}};
    }

    /// The `confirm` names of a batch or pipeline, or nothing when `confirm` is not a string array.
    static std::optional<std::set<std::string>> confirm_names(const Json& arguments) {
        std::set<std::string> names;
        const Json value = member(arguments, "confirm");
        if (value.is_null()) {
            return names;
        }
        if (!value.is_array()) {
            return std::nullopt;
        }
        for (const auto& name : value) {
            if (!name.is_string()) {
                return std::nullopt;
            }
            names.insert(name.get<std::string>());
        }
        return names;
    }

    /// The context of a batch's or pipeline's steps. When the request could carry a form
    /// elicitation, a relay that no command can claim, so the approval middleware tells the agent
    /// to call the command on its own.
    CommandContext step_context(const CommandContext& context, const RequestInfo& info,
                                const ClientRequester& ask) const {
        CommandContext steps = context;
        if (declares_form_elicitation(info.client_capabilities) &&
            (info.modern || static_cast<bool>(ask))) {
            steps.mcp_approval_relay =
                std::make_shared<detail::McpApprovalRelay>(std::string(), nullptr);
        }
        return steps;
    }

    Json afd_batch(const Json& arguments, const Json& params, const RequestInfo& info,
                   const ClientRequester& ask, const CommandContext& context) {
        const auto invalid = [this](std::optional<Json> details = std::nullopt) {
            return batch_failure(create_error(error_codes::INVALID_BATCH_REQUEST,
                                              "Invalid batch request envelope",
                                              {.suggestion = "Provide { commands: [...] } with "
                                                             "command objects",
                                               .details = std::move(details)}),
                                 now());
        };
        const auto acknowledged = confirm_names(arguments);
        if (!arguments.is_object() || !acknowledged) {
            return invalid();
        }
        // `context` is not an afd-batch argument: declared context fields come only from _meta.
        Json request = arguments;
        request.erase("confirm");
        request.erase("context");
        auto parsed = parse_batch_request(request);
        if (!parsed) {
            return invalid(parsed.error().details);
        }
        std::vector<std::pair<std::string, Json>> steps;
        for (auto& item : parsed->commands) {
            // A missing or null input is an empty one, as on a command's own tool.
            if (!item.input || item.input->is_null()) {
                item.input = Json::object();
            }
            steps.emplace_back(item.command, item.input.value_or(Json::object()));
        }
        auto decision = confirm_steps("afd-batch", request, steps, *acknowledged,
                                      "repeat the afd-batch with confirm: [the command names]",
                                      params, info, ask, context);
        if (decision.kind == StepsDecision::Kind::ask) {
            return std::move(decision.response);
        }
        if (decision.kind == StepsDecision::Kind::refuse) {
            return batch_failure(std::move(*decision.error), now());
        }
        const BatchResult result =
            registry.execute_batch(*parsed, step_context(context, info, ask));
        return json_tool_result(Json(result), !result.success);
    }

    Json afd_pipe(const Json& arguments, const Json& params, const RequestInfo& info,
                  const ClientRequester& ask, const CommandContext& context) {
        const auto invalid = [](std::optional<Json> details = std::nullopt) {
            return pipeline_failure(create_error(
                error_codes::INVALID_PIPELINE_REQUEST, "Invalid pipeline request envelope",
                {.suggestion = "Provide steps with nonempty command names, object inputs, valid "
                               "conditions, and correctly typed options; input must be JSON",
                 .details = std::move(details)}));
        };
        const auto acknowledged = confirm_names(arguments);
        if (!arguments.is_object() || !acknowledged) {
            return invalid();
        }
        Json request = arguments;
        request.erase("confirm");
        auto parsed = parse_pipeline_request(request);
        if (!parsed) {
            return invalid(parsed.error().details);
        }
        std::vector<std::pair<std::string, Json>> steps;
        for (const auto& step : parsed->steps) {
            steps.emplace_back(step.command, step.input.value_or(Json::object()));
        }
        auto decision = confirm_steps("afd-pipe", request, steps, *acknowledged,
                                      "repeat the afd-pipe with confirm: [the command names]",
                                      params, info, ask, context);
        if (decision.kind == StepsDecision::Kind::ask) {
            return std::move(decision.response);
        }
        if (decision.kind == StepsDecision::Kind::refuse) {
            return pipeline_failure(*decision.error);
        }
        const PipelineResult result =
            registry.execute_pipeline(*parsed, step_context(context, info, ask));
        const bool failed =
            std::any_of(result.steps.begin(), result.steps.end(),
                        [](const StepResult& step) { return step.status == StepStatus::failure; });
        return json_tool_result(Json(result), failed);
    }

    Json call_tool(const Json& params, const RequestInfo& info, const ClientRequester& ask,
                   const CancellationToken& cancellation,
                   const std::shared_ptr<const ContextScope>& scope) {
        const std::string name =
            params.is_object() && params.contains("name") && params["name"].is_string()
                ? params["name"].get<std::string>()
                : "";
        // Missing or null arguments mean an empty input, as MCP clients send.
        Json arguments = Json::object();
        if (params.is_object()) {
            if (const auto it = params.find("arguments"); it != params.end() && !it->is_null()) {
                arguments = *it;
            }
        }
        const CommandContext context = call_context(info, cancellation, scope);
        // 1. A meta-tool, whether or not the strategy lists it.
        if (name == "afd-call") {
            return afd_call(arguments, params, info, ask, context);
        }
        if (name == "afd-batch") {
            return afd_batch(arguments, params, info, ask, context);
        }
        if (name == "afd-pipe") {
            return afd_pipe(arguments, params, info, ask, context);
        }
        if (name == "afd-discover") {
            return afd_discover(arguments, info);
        }
        if (name == "afd-detail") {
            return afd_detail(arguments, info);
        }
        // 2. Under `grouped`, a grouped tool.
        if (options.tool_strategy == ToolStrategy::grouped) {
            if (auto result = grouped(name, arguments, params, info, ask, context)) {
                return std::move(*result);
            }
        }
        // 3. A command by its own name.
        return direct(name, std::move(arguments), params, info, ask, context);
    }

    // --- dispatch -----------------------------------------------------------------------------

    /// Moves a meta-tool's `meta` argument into `info.meta`: its `dev.afd/context`, the one key a
    /// C++ server reads from `_meta` that a client may be unable to set. Other keys are dropped,
    /// as undeclared `_meta` keys are. A failure when `meta` is not an object, or disagrees with
    /// `_meta`.
    static std::optional<CommandResult> lift_meta_argument(Json& params, RequestInfo& info) {
        const std::string tool = string_member(params, "name");
        const bool meta_tool =
            std::find(std::begin(afd_meta_tool_names), std::end(afd_meta_tool_names), tool) !=
            std::end(afd_meta_tool_names);
        if (!meta_tool || !params.contains("arguments") || !params["arguments"].is_object() ||
            !params["arguments"].contains("meta")) {
            return std::nullopt;
        }
        Json& arguments = params["arguments"];
        const Json argument = arguments["meta"];
        arguments.erase("meta");
        if (argument.is_null()) {
            return std::nullopt;
        }
        const std::string context_key(context_meta_key);
        if (!argument.is_object()) {
            return failure(create_error(
                error_codes::VALIDATION_ERROR,
                "The meta argument of " + tool + " must be an object",
                {.suggestion = "Send meta as an object whose keys are _meta keys: " + context_key,
                 .details = Json{{"argument", "meta"}}}));
        }
        const auto value = argument.find(context_key);
        if (value == argument.end() || value->is_null()) {
            return std::nullopt;
        }
        const auto sent = info.meta.find(context_key);
        if (sent != info.meta.end() && !sent->is_null() && *sent != *value) {
            return failure(create_error(
                error_codes::VALIDATION_ERROR,
                "_meta[\"" + context_key + "\"] and the meta argument of " + tool + " disagree",
                {.suggestion = "Send " + context_key +
                               " in _meta or in the meta argument, or the same " + "value in both",
                 .details = Json{{"meta", context_key}}}));
        }
        info.meta[context_key] = *value;
        return std::nullopt;
    }

    std::optional<std::string> handle(std::string_view line, const ClientRequester& ask,
                                      const CancellationToken& cancellation) {
        if (line.size() > options.max_line_bytes) {
            return error_response(nullptr, -32600, "Message too large");
        }
        const auto parsed = parse_bounded(line);
        if (!parsed) {
            return error_response(nullptr, -32700, "Parse error");
        }
        const Json& message = *parsed;
        if (message.is_array()) {
            return error_response(nullptr, -32600, "Batch requests are not supported");
        }
        if (message.is_object() && !message.contains("method") &&
            (message.contains("result") || message.contains("error"))) {
            return std::nullopt; // a response to a request this server did not send, or a late one
        }
        if (!message.is_object() || !message.contains("method") || !message["method"].is_string()) {
            const Json id = message.is_object() && message.contains("id") ? message["id"] : Json();
            return error_response(id, -32600, "Invalid Request");
        }
        const std::string& method = message["method"].get_ref<const std::string&>();
        const auto id_it = message.find("id");
        if (id_it == message.end()) {
            return std::nullopt; // a notification (notifications/initialized, …): never answered
        }
        const Json& id = *id_it;
        const Json params = message.contains("params") ? message["params"] : Json::object();

        // A modern request names its protocol version in _meta; a legacy one relies on initialize.
        const Json meta = object_member(params, "_meta");
        const auto version = meta.find(std::string(protocol_version_key));
        const bool modern = version != meta.end() && version->is_string();
        RequestInfo info;
        info.meta = meta;
        if (modern) {
            const auto& requested = version->get_ref<const std::string&>();
            if (requested != modern_version) {
                return error_response(id, unsupported_protocol_version,
                                      "Unsupported protocol version",
                                      {{"supported", Json::array({std::string(modern_version)})},
                                       {"requested", requested}});
            }
            const auto capabilities = meta.find(std::string(client_capabilities_key));
            if (capabilities == meta.end() || !capabilities->is_object()) {
                return error_response(
                    id, -32602, "Missing _meta[\"io.modelcontextprotocol/clientCapabilities\"]");
            }
            info.modern = true;
            info.protocol_version = requested;
            info.client_capabilities = *capabilities;
        } else {
            info.protocol_version = legacy_version;
            info.client_capabilities = legacy_capabilities;
        }

        if (method == "server/discover") {
            return response(id, discover_result());
        }
        if (method == "initialize") {
            return response(id, initialize_result(params));
        }
        if (method == "ping" && !modern) {
            return response(id, Json::object()); // removed in 2026-07-28
        }
        // A meta-tool's `meta` argument counts as `_meta` from here on (TypeScript's
        // `liftMetaArgument`), so it can name the active context.
        Json routed = params;
        if (method == "tools/call") {
            if (auto refused = lift_meta_argument(routed, info)) {
                Json result = tool_result(*refused);
                return response(id, modern ? modern_result(std::move(result)) : std::move(result));
            }
        }
        std::shared_ptr<const ContextScope> scope;
        if (method == "tools/list" || method == "tools/call") {
            auto requested = request_scope(info);
            if (!requested) {
                return error_response(id, -32602, requested.error(),
                                      {{"suggestion", "Use one of: " + known_contexts()}});
            }
            scope = std::move(*requested);
            if (scope) {
                info.active_context = scope->active();
            }
        }
        if (method == "tools/list") {
            Json result{{"tools", tools(info.active_context)}};
            if (!modern) {
                return response(id, std::move(result));
            }
            result["ttlMs"] = ttl_ms();
            result["cacheScope"] = "public";
            return response(id, modern_result(std::move(result)));
        }
        if (method == "tools/call") {
            Json result =
                call_tool(routed, info, modern ? ClientRequester{} : ask, cancellation, scope);
            return response(id, modern ? modern_result(std::move(result)) : std::move(result));
        }
        return error_response(id, -32601, "Method not found: " + method);
    }
};

std::string_view tool_strategy_name(ToolStrategy strategy) noexcept {
    switch (strategy) {
    case ToolStrategy::individual:
        return "individual";
    case ToolStrategy::lazy:
        return "lazy";
    case ToolStrategy::grouped:
        break;
    }
    return "grouped";
}

Expected<std::unique_ptr<StdioServer>> StdioServer::create(const CommandRegistry& registry,
                                                           StdioServerOptions options) {
    std::string secret = options.state_secret;
    if (!secret.empty() && secret.size() < min_state_secret_bytes) {
        return unexpected("state_secret must be at least " +
                          std::to_string(min_state_secret_bytes) + " bytes");
    }
    if (secret.empty()) {
        std::random_device device;
        while (secret.size() < min_state_secret_bytes) {
            auto word = device();
            for (std::size_t b = 0; b < sizeof word && secret.size() < min_state_secret_bytes;
                 ++b) {
                secret.push_back(static_cast<char>(word & 0xFFU));
                word >>= 8;
            }
        }
    }
    if (options.tools_list_ttl_ms && *options.tools_list_ttl_ms < 0) {
        return unexpected(std::string("tools_list_ttl_ms must not be negative"));
    }
    if (!options.contexts.empty()) {
        std::set<std::string> configured;
        for (const auto& config : options.contexts) {
            if (config.name.find_first_not_of(" \t\r\n") == std::string::npos) {
                return unexpected(std::string("Context names must not be blank"));
            }
            if (!configured.insert(config.name).second) {
                return unexpected("Context '" + config.name + "' is configured twice");
            }
        }
        for (const auto name : afd_context_command_names) {
            const auto command = registry.get(name);
            if (!command || !is_exposed_to(command->definition.expose, Interface::mcp)) {
                return unexpected("contexts are set but " + std::string(name) +
                                  " is not registered and exposed to MCP: call "
                                  "afd::register_context_commands(registry, contexts) first");
            }
        }
        // The server and the context tools must serve the same contexts.
        CommandContext probe;
        const Json listed(
            registry.get("afd-context-list")->definition.handler(Json::object(), probe));
        std::set<std::string> registered;
        if (listed.contains("data") && listed["data"].contains("contexts")) {
            for (const auto& entry : listed["data"]["contexts"]) {
                if (entry.contains("name") && entry["name"].is_string()) {
                    registered.insert(entry["name"].get<std::string>());
                }
            }
        }
        if (registered != configured) {
            return unexpected(std::string(
                "contexts differ from those passed to afd::register_context_commands: pass the "
                "same list to both"));
        }
    }
    if (!options.clock) {
        options.clock = std::make_shared<SystemClock>();
    }
    options.state_secret.clear();
    return std::unique_ptr<StdioServer>(
        new StdioServer(std::make_unique<State>(registry, std::move(options), std::move(secret))));
}

StdioServer::StdioServer(std::unique_ptr<State> state) : state_(std::move(state)) {}

StdioServer::~StdioServer() = default;

std::optional<std::string> StdioServer::handle_message(std::string_view line,
                                                       const ClientRequester& ask,
                                                       const CancellationToken& cancellation) {
    return state_->handle(line, ask, cancellation);
}

Json StdioServer::tools() const {
    return state_->tools();
}

namespace {

/// One line read from the client: its text, or a line over the limit.
struct Line {
    std::string text;
    bool too_long = false;
    /// The request's id, when it is a request.
    std::optional<Json> id;
    /// Set when `notifications/cancelled` named it while it waited in the queue.
    bool cancelled = false;
};

/// Shared between the reader thread and the thread that handles messages.
struct Connection {
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<Line> queue;
    bool eof = false;
    // The request being handled, so `notifications/cancelled` can reach it.
    std::optional<Json> current_id;
    std::shared_ptr<CancellationSource> current_cancel;
    // The elicitation request waiting for the client's response, and the response.
    std::optional<std::string> waiting_for;
    std::optional<Json> answer;
};

/// Reads one line of at most `limit` bytes from `in`; `std::nullopt` at EOF.
std::optional<Line> read_line(std::istream& in, std::size_t limit) {
    Line line;
    char c = 0;
    bool got_any = false;
    while (in.get(c)) {
        got_any = true;
        if (c == '\n') {
            break;
        }
        if (line.text.size() < limit) {
            line.text.push_back(c);
        } else {
            line.too_long = true; // keep reading to the end of the line, but store nothing more
        }
    }
    if (!got_any) {
        return std::nullopt;
    }
    if (!line.text.empty() && line.text.back() == '\r') {
        line.text.pop_back();
    }
    return line;
}

/// Routes what the client sends: a cancellation reaches its call (running or queued), a response
/// reaches the elicitation waiting for it, and everything else waits in the queue.
void route(Connection& connection, Line line) {
    if (!line.too_long) {
        const auto parsed = parse_bounded(line.text);
        if (parsed && parsed->is_object()) {
            const Json& message = *parsed;
            const std::lock_guard lock(connection.mutex);
            if (!message.contains("method") && message.contains("id")) {
                // A response: the elicitation waiting for it takes it; any other is dropped.
                if (connection.waiting_for && message["id"].is_string() &&
                    message["id"].get_ref<const std::string&>() == *connection.waiting_for) {
                    connection.answer = message;
                    connection.changed.notify_all();
                }
                return;
            }
            if (string_member(message, "method") == "notifications/cancelled") {
                const Json params = object_member(message, "params");
                if (!params.contains("requestId")) {
                    return;
                }
                const Json& id = params["requestId"];
                if (connection.current_id && id == *connection.current_id) {
                    connection.current_cancel->cancel();
                    connection.changed.notify_all();
                    return;
                }
                // A request still in the queue is cancelled before it starts; an unknown or
                // finished one is ignored.
                for (auto& queued : connection.queue) {
                    if (queued.id && *queued.id == id) {
                        queued.cancelled = true;
                    }
                }
                return;
            }
            if (message.contains("id")) {
                line.id = message["id"];
            }
        }
    }
    const std::lock_guard lock(connection.mutex);
    connection.queue.push_back(std::move(line));
    connection.changed.notify_all();
}

} // namespace

void StdioServer::serve(std::istream& in, std::ostream& out) {
    Connection connection;
    // Writes are serialized on their own lock, never under `connection.mutex`: a client that
    // stops reading must not stop the reader thread from draining its input.
    std::mutex write_mutex;
    const auto write = [&](const std::string& text) {
        const std::lock_guard lock(write_mutex);
        out << text << '\n';
        out.flush();
    };
    const std::size_t limit = state_->options.max_line_bytes;
    std::thread reader([&connection, &in, limit] {
        while (auto line = read_line(in, limit)) {
            if (line->text.empty() && !line->too_long) {
                continue;
            }
            route(connection, std::move(*line));
        }
        const std::lock_guard lock(connection.mutex);
        connection.eof = true;
        connection.changed.notify_all();
    });

    std::uint64_t asked = 0;
    const auto timeout = std::chrono::milliseconds(state_->options.elicitation_timeout_ms);
    const ClientRequester ask = [&](const Json& request) -> std::optional<Json> {
        const std::string request_id = std::string(elicitation_id_prefix) + std::to_string(++asked);
        CancellationToken cancelled;
        {
            const std::lock_guard lock(connection.mutex);
            connection.waiting_for = request_id;
            connection.answer.reset();
            cancelled = connection.current_cancel->token();
        }
        Json message = request;
        message["jsonrpc"] = "2.0";
        message["id"] = request_id;
        write(wire::serialize(message));
        std::unique_lock lock(connection.mutex);
        // Cancellation sets no condition the wait can see without a notify, so poll it too.
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        while (!connection.answer && !connection.eof && !cancelled.is_cancelled() &&
               std::chrono::steady_clock::now() < deadline) {
            connection.changed.wait_until(lock,
                                          (std::min)(deadline, std::chrono::steady_clock::now() +
                                                                   std::chrono::milliseconds(100)));
        }
        connection.waiting_for.reset();
        auto answer = std::move(connection.answer);
        connection.answer.reset();
        if (!answer || !answer->contains("result")) {
            return std::nullopt;
        }
        return (*answer)["result"];
    };

    while (true) {
        Line line;
        CancellationToken token;
        {
            std::unique_lock lock(connection.mutex);
            connection.changed.wait(lock,
                                    [&] { return !connection.queue.empty() || connection.eof; });
            if (connection.queue.empty()) {
                break;
            }
            line = std::move(connection.queue.front());
            connection.queue.pop_front();
            connection.current_id = line.id;
            connection.current_cancel = std::make_shared<CancellationSource>();
            if (line.cancelled) {
                connection.current_cancel->cancel();
            }
            token = connection.current_cancel->token();
        }
        const auto reply =
            line.too_long
                ? std::optional<std::string>(error_response(nullptr, -32600, "Message too large"))
                : state_->handle(line.text, ask, token);
        {
            const std::lock_guard lock(connection.mutex);
            connection.current_id.reset();
        }
        // A cancelled request gets no response (MCP, cancellation).
        if (reply && !(line.id && token.is_cancelled())) {
            write(*reply);
        }
    }
    reader.join();
}

} // namespace afd::mcp
