#include "mcp_stdio.hpp"

#include <array>
#include <cstdint>
#include <istream>
#include <ostream>
#include <string_view>

#include <afd/middleware.hpp>
#include <afd/runtime.hpp>

namespace todo {
namespace {

using afd::Json;

// initialize-era versions, newest first. A client's requested version is echoed when supported;
// otherwise the newest.
constexpr std::array<std::string_view, 4> supported_protocol_versions{"2025-11-25", "2025-06-18",
                                                                      "2025-03-26", "2024-11-05"};

// The stateless revision: every request carries its version in _meta, there is no initialize.
constexpr std::string_view modern_protocol_version = "2026-07-28";
constexpr std::string_view protocol_version_key = "io.modelcontextprotocol/protocolVersion";
constexpr std::string_view client_capabilities_key = "io.modelcontextprotocol/clientCapabilities";
constexpr std::string_view server_info_key = "io.modelcontextprotocol/serverInfo";
constexpr int unsupported_protocol_version = -32022;
constexpr std::int64_t tools_list_ttl_ms = 300000;

std::string response(const Json& id, Json result) {
    return afd::wire::serialize(
        Json{{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(result)}});
}

std::string error_response(const Json& id, int code, std::string message, Json data = nullptr) {
    Json error{{"code", code}, {"message", std::move(message)}};
    if (!data.is_null()) {
        error["data"] = std::move(data);
    }
    return afd::wire::serialize(Json{{"jsonrpc", "2.0"}, {"id", id}, {"error", std::move(error)}});
}

/// The `_meta` object of a request's params, or nullptr.
const Json* request_meta(const Json& params) {
    if (!params.is_object()) {
        return nullptr;
    }
    const auto meta = params.find("_meta");
    return meta != params.end() && meta->is_object() ? &*meta : nullptr;
}

Json server_info_json(const McpServerInfo& info) {
    return {{"name", info.name}, {"version", info.version}};
}

/// A modern (2026-07-28) result: `resultType` and the server's identity in `_meta`.
Json modern_result(Json result, const McpServerInfo& info) {
    result["resultType"] = "complete";
    result["_meta"][std::string(server_info_key)] = server_info_json(info);
    return result;
}

Json discover_result(const McpServerInfo& info) {
    return {{"resultType", "complete"},
            {"supportedVersions", Json::array({std::string(modern_protocol_version)})},
            {"capabilities", {{"tools", {{"listChanged", false}}}}},
            {"_meta", {{std::string(server_info_key), server_info_json(info)}}},
            {"instructions",
             info.name +
                 " is an AFD server. Every tool returns a CommandResult as JSON text; follow "
                 "error.suggestion to recover."},
            {"ttlMs", tools_list_ttl_ms},
            {"cacheScope", "public"}};
}

Json initialize_result(const Json& params, const McpServerInfo& info) {
    std::string version(supported_protocol_versions.front());
    if (params.is_object()) {
        if (const auto requested = params.find("protocolVersion");
            requested != params.end() && requested->is_string()) {
            for (const auto supported : supported_protocol_versions) {
                if (requested->get_ref<const std::string&>() == supported) {
                    version = std::string(supported);
                }
            }
        }
    }
    return {{"protocolVersion", version},
            {"capabilities", {{"tools", {{"listChanged", false}}}}},
            {"serverInfo", {{"name", info.name}, {"version", info.version}}}};
}

Json tools_list(const afd::CommandRegistry& registry) {
    Json tools = Json::array();
    for (const auto& command : registry.list_by_exposure(afd::Interface::mcp)) {
        Json tool{{"name", command->definition.name},
                  {"description", command->definition.description},
                  {"inputSchema", command->definition.input_schema}};
        // The display label (spec/command-metadata.md, "Tool titles"): only when the command sets
        // one, never derived from the name, never in `_meta` or `annotations`.
        if (command->definition.title) {
            tool["title"] = *command->definition.title;
        }
        // MCP annotations (spec/command-metadata.md): `mutation` has no unset state here, so only
        // a mutation claims anything.
        if (command->definition.mutation) {
            tool["annotations"] = {{"readOnlyHint", false},
                                   {"destructiveHint", command->definition.destructive}};
        }
        // The approval policy (spec/command-metadata.md, "Approvals"); `conditional` for a
        // function policy.
        if (const auto mode = afd::approval_mode(command->definition.approval)) {
            tool["_meta"] = {{"approval", std::string(afd::approval_mode_name(*mode))}};
        }
        tools.push_back(std::move(tool));
    }
    return {{"tools", std::move(tools)}};
}

Json tools_call(const afd::CommandRegistry& registry, const Json& params) {
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
    static afd::SystemClock clock;
    static afd::SystemRandom random;
    afd::CommandContext context;
    context.surface = afd::Interface::mcp;
    context.actor = afd::Actor{.kind = afd::ActorKind::agent};
    // `context.approval` stays unset: approval evidence comes only from trusted surface code
    // after a human approved, never from the arguments or `_meta` of a tool call.
    context.trace_id =
        "trace-" + std::to_string(clock.wall_ms()) + "-" + afd::random_uuid(random).substr(0, 8);

    // Unknown tools and invalid arguments come back as CommandResults, not JSON-RPC errors.
    const afd::CommandResult result = registry.execute(name, arguments, context);
    return {{"content", {{{"type", "text"}, {"text", afd::wire::serialize(Json(result))}}}},
            {"isError", !result.success}};
}

} // namespace

std::optional<std::string> handle_message(const afd::CommandRegistry& registry,
                                          std::string_view line, const McpServerInfo& info) {
    if (line.size() > info.max_line_bytes) {
        return error_response(nullptr, -32600, "Message too large");
    }
    const auto parsed = afd::parse_bounded(line);
    if (!parsed) {
        return error_response(nullptr, -32700, "Parse error");
    }
    const Json& message = *parsed;
    if (message.is_array()) {
        return error_response(nullptr, -32600, "Batch requests are not supported");
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
    const Json* meta = request_meta(params);
    const auto version =
        meta != nullptr ? meta->find(std::string(protocol_version_key)) : Json::const_iterator{};
    const bool modern = meta != nullptr && version != meta->end() && version->is_string();
    if (modern) {
        const auto& requested = version->get_ref<const std::string&>();
        if (requested != modern_protocol_version) {
            return error_response(
                id, unsupported_protocol_version, "Unsupported protocol version",
                {{"supported", Json::array({std::string(modern_protocol_version)})},
                 {"requested", requested}});
        }
        const auto capabilities = meta->find(std::string(client_capabilities_key));
        if (capabilities == meta->end() || !capabilities->is_object()) {
            return error_response(id, -32602,
                                  "Missing _meta[\"io.modelcontextprotocol/clientCapabilities\"]");
        }
    }

    if (method == "server/discover") {
        return response(id, discover_result(info));
    }
    if (method == "initialize") {
        return response(id, initialize_result(params, info));
    }
    if (method == "ping" && !modern) {
        return response(id, Json::object()); // removed in 2026-07-28
    }
    if (method == "tools/list") {
        Json result = tools_list(registry);
        if (!modern) {
            return response(id, std::move(result));
        }
        result["ttlMs"] = tools_list_ttl_ms;
        result["cacheScope"] = "public";
        return response(id, modern_result(std::move(result), info));
    }
    if (method == "tools/call") {
        Json result = tools_call(registry, params);
        return response(id, modern ? modern_result(std::move(result), info) : std::move(result));
    }
    return error_response(id, -32601, "Method not found: " + method);
}

void serve(const afd::CommandRegistry& registry, std::istream& in, std::ostream& out,
           const McpServerInfo& info) {
    std::string line;
    while (true) {
        line.clear();
        bool too_long = false;
        char c = 0;
        bool got_any = false;
        while (in.get(c)) {
            got_any = true;
            if (c == '\n') {
                break;
            }
            if (line.size() < info.max_line_bytes) {
                line.push_back(c);
            } else {
                too_long = true; // keep reading to the end of the line, but store nothing more
            }
        }
        if (!got_any) {
            return; // EOF
        }
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.empty() && !too_long) {
            continue;
        }
        const auto reply =
            too_long
                ? std::optional<std::string>(error_response(nullptr, -32600, "Message too large"))
                : handle_message(registry, line, info);
        if (reply) {
            out << *reply << '\n';
            out.flush();
        }
    }
}

} // namespace todo
