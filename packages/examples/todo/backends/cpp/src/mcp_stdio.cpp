#include "mcp_stdio.hpp"

#include <array>
#include <istream>
#include <ostream>
#include <string_view>

#include <afd/middleware.hpp>
#include <afd/runtime.hpp>

namespace todo {
namespace {

using afd::Json;

// Newest first. A client's requested version is echoed when supported; otherwise the newest.
constexpr std::array<std::string_view, 3> supported_protocol_versions{"2025-06-18", "2025-03-26",
                                                                      "2024-11-05"};

std::string response(const Json& id, Json result) {
    return afd::wire::serialize(
        Json{{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(result)}});
}

std::string error_response(const Json& id, int code, std::string message) {
    return afd::wire::serialize(Json{{"jsonrpc", "2.0"},
                                     {"id", id},
                                     {"error", {{"code", code}, {"message", std::move(message)}}}});
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
        tools.push_back({{"name", command->definition.name},
                         {"description", command->definition.description},
                         {"inputSchema", command->definition.input_schema}});
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
    static afd::SeededRandom random;
    afd::CommandContext context;
    context.surface = afd::Interface::mcp;
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

    if (method == "initialize") {
        return response(id, initialize_result(params, info));
    }
    if (method == "ping") {
        return response(id, Json::object());
    }
    if (method == "tools/list") {
        return response(id, tools_list(registry));
    }
    if (method == "tools/call") {
        return response(id, tools_call(registry, params));
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
