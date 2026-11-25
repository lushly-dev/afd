// The hybrid tool strategy (spec/tool-strategies.md, "Hybrid", H1 to H8): every server and
// construction failure of spec/vectors/tool-strategies.json, then what the file does not pin: each
// first-class tool equals the individual strategy's, afd-help's report, the instructions and
// listChanged.
#include "afd/afd.hpp"
#include "afd/mcp_stdio.hpp"

#include <algorithm>
#include <fstream>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include <doctest.h>

using afd::Json;
using afd::mcp::ConfirmationMode;
using afd::mcp::StdioServer;
using afd::mcp::StdioServerOptions;
using afd::mcp::ToolStrategy;

// Named, not anonymous: a unity build can put this file in one unit with any other test file.
namespace hybrid_test {

Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    REQUIRE(in);
    std::stringstream text;
    text << in.rdbuf();
    auto parsed = afd::parse_bounded(text.str());
    REQUIRE(parsed);
    return *parsed;
}

Json vectors() {
    return load_vectors("tool-strategies.json");
}

std::optional<ToolStrategy> strategy_named(const std::string& name) {
    if (name == "individual") {
        return ToolStrategy::individual;
    }
    if (name == "grouped") {
        return ToolStrategy::grouped;
    }
    if (name == "lazy") {
        return ToolStrategy::lazy;
    }
    if (name == "hybrid") {
        return ToolStrategy::hybrid;
    }
    return std::nullopt;
}

/// The file's commands and, with `config.contexts`, its contexts, on one registry: each takes an
/// object with no required properties and succeeds with its input as data.
std::shared_ptr<afd::CommandRegistry> registry_for(const Json& file, const Json& config,
                                                   std::vector<afd::ContextConfig>& contexts) {
    auto registry = std::make_shared<afd::CommandRegistry>();
    for (const auto& spec : file["commands"]) {
        afd::CommandDefinition command{
            .name = spec["name"].get<std::string>(),
            .description = spec["description"].get<std::string>(),
            .handler = [](const Json& input, afd::CommandContext&) { return afd::success(input); },
            .mutation = spec.value("mutation", false),
            .expose = {.mcp = spec["expose"].value("mcp", false)}};
        if (spec.contains("contexts")) {
            for (const auto& context : spec["contexts"]) {
                command.contexts.push_back(context.get<std::string>());
            }
        }
        if (spec.contains("destructive")) {
            command.destructive = spec["destructive"].get<bool>();
        }
        if (spec.contains("confirmPrompt")) {
            command.confirm_prompt = spec["confirmPrompt"].get<std::string>();
        }
        REQUIRE_FALSE(registry->register_command(std::move(command)));
    }
    if (config.value("contexts", false)) {
        for (const auto& context : file["contexts"]) {
            contexts.push_back({.name = context["name"].get<std::string>(),
                                .description = context["description"].get<std::string>()});
        }
        REQUIRE_FALSE(afd::register_context_commands(*registry, contexts));
    }
    if (config.value("bootstrap", false)) {
        REQUIRE_FALSE(afd::register_bootstrap_commands(*registry));
    }
    return registry;
}

StdioServerOptions options_for(const Json& config, std::vector<afd::ContextConfig> contexts) {
    StdioServerOptions options;
    const auto strategy = strategy_named(config["toolStrategy"].get<std::string>());
    REQUIRE(strategy);
    options.tool_strategy = *strategy;
    if (config.contains("firstClassTools")) {
        std::vector<std::string> names;
        for (const auto& name : config["firstClassTools"]) {
            names.push_back(name.get<std::string>());
        }
        options.first_class_tools = std::move(names);
    }
    options.contexts = std::move(contexts);
    if (config.contains("confirmations")) {
        const auto mode = config["confirmations"].get<std::string>();
        options.confirmations = mode == "enforce"         ? ConfirmationMode::enforce
                                : mode == "require-human" ? ConfirmationMode::require_human
                                                          : ConfirmationMode::off;
    }
    if (config.contains("toolsListTtlMs")) {
        options.tools_list_ttl_ms = config["toolsListTtlMs"].get<std::int64_t>();
    }
    return options;
}

/// A modern-era (MCP 2026-07-28) request's `_meta`, with the active context when given.
Json modern_meta(const Json& context) {
    Json meta{{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
              {"io.modelcontextprotocol/clientCapabilities", Json::object()}};
    if (context.is_string()) {
        meta["dev.afd/context"] = context;
    }
    return meta;
}

Json send(StdioServer& server, std::string method, Json params) {
    const Json message{
        {"jsonrpc", "2.0"}, {"id", 1}, {"method", std::move(method)}, {"params", params}};
    const auto out = server.handle_message(afd::wire::serialize(message));
    REQUIRE(out.has_value());
    const Json response = Json::parse(*out);
    REQUIRE(response.contains("result"));
    return response["result"];
}

Json list(StdioServer& server, const Json& context = nullptr) {
    return send(server, "tools/list", {{"_meta", modern_meta(context)}});
}

Json call(StdioServer& server, const std::string& tool, const Json& arguments,
          const Json& context = nullptr) {
    const Json result =
        send(server, "tools/call",
             {{"name", tool}, {"arguments", arguments}, {"_meta", modern_meta(context)}});
    return Json::parse(result["content"][0]["text"].get<std::string>());
}

std::vector<std::string> names(const Json& tools) {
    std::vector<std::string> out;
    for (const auto& tool : tools) {
        out.push_back(tool["name"].get<std::string>());
    }
    return out;
}

std::vector<std::string> strings(const Json& array) {
    std::vector<std::string> out;
    for (const auto& entry : array) {
        out.push_back(entry.get<std::string>());
    }
    return out;
}

/// One built server of the file, with its registry.
struct Built {
    std::shared_ptr<afd::CommandRegistry> registry;
    std::unique_ptr<StdioServer> server;
};

Built build(const Json& file, const Json& config) {
    std::vector<afd::ContextConfig> contexts;
    auto registry = registry_for(file, config, contexts);
    auto server = StdioServer::create(*registry, options_for(config, contexts));
    REQUIRE(server);
    return {std::move(registry), std::move(*server)};
}

TEST_CASE("spec/vectors/tool-strategies.json: the cap and the tool names") {
    const Json file = vectors();
    CHECK(file["cap"].get<std::size_t>() == afd::mcp::max_first_class_tools);
    CHECK(strings(file["metaTools"]) == std::vector<std::string>{"afd-discover", "afd-detail",
                                                                 "afd-call", "afd-batch",
                                                                 "afd-pipe"});
    CHECK(strings(file["contextTools"]) ==
          std::vector<std::string>(std::begin(afd::afd_context_command_names),
                                   std::end(afd::afd_context_command_names)));
}

TEST_CASE("spec/vectors/tool-strategies.json: servers") {
    const Json file = vectors();
    REQUIRE(file["servers"].size() == 4);
    for (const auto& entry : file["servers"]) {
        const std::string id = entry["id"].get<std::string>();
        CAPTURE(id);
        auto built = build(file, entry["config"]);
        for (const auto& expected : entry["lists"]) {
            CAPTURE(expected["context"].dump());
            const Json result = list(*built.server, expected["context"]);
            CHECK(names(result["tools"]) == strings(expected["tools"]));
            CHECK(result["ttlMs"] == entry["ttlMs"]);
        }
        for (const auto& expected : entry["calls"]) {
            const std::string tool = expected["tool"].get<std::string>();
            CAPTURE(tool);
            CAPTURE(expected["context"].dump());
            const Json arguments =
                expected.contains("arguments") ? expected["arguments"] : Json::object();
            const Json result = call(*built.server, tool, arguments, expected["context"]);
            CHECK(result["success"] == expected["expected"]["success"]);
            if (expected["expected"].contains("code")) {
                CHECK(result["error"]["code"] == expected["expected"]["code"]);
            }
            // `expected.recovery`: `error.recovery` equals it, and `null` means none, which the
            // wire omits (spec/tool-strategies.md, "Conformance").
            if (expected["expected"].contains("recovery")) {
                const Json& want = expected["expected"]["recovery"];
                const Json& error = result["error"];
                CHECK(error.value("recovery", Json(nullptr)) == want);
                if (want.is_null()) {
                    CHECK_FALSE(error.contains("recovery"));
                }
            }
        }
    }
}

TEST_CASE("spec/vectors/tool-strategies.json: construction failures") {
    const Json file = vectors();
    REQUIRE(file["constructionFailures"].size() == 10);
    for (const auto& entry : file["constructionFailures"]) {
        const std::string id = entry["id"].get<std::string>();
        CAPTURE(id);
        std::vector<afd::ContextConfig> contexts;
        auto registry = registry_for(file, entry["config"], contexts);
        auto server = StdioServer::create(*registry, options_for(entry["config"], contexts));
        REQUIRE_FALSE(server);
        if (entry["entry"].is_string()) {
            const std::string wanted = "'" + entry["entry"].get<std::string>() + "'";
            CHECK(server.error().find(wanted) != std::string::npos);
        }
    }
}

TEST_CASE("H3: each first-class tool is the individual strategy's tool, field for field") {
    const Json file = vectors();
    for (const auto& entry : file["servers"]) {
        const std::string id = entry["id"].get<std::string>();
        CAPTURE(id);
        Json individual_config = entry["config"];
        individual_config["toolStrategy"] = "individual";
        individual_config.erase("firstClassTools");
        auto hybrid = build(file, entry["config"]);
        auto individual = build(file, individual_config);
        const Json hybrid_tools = list(*hybrid.server)["tools"];
        const Json individual_tools = list(*individual.server)["tools"];
        for (const auto& name : entry["config"]["firstClassTools"]) {
            CAPTURE(name.get<std::string>());
            Json mine;
            for (const auto& tool : hybrid_tools) {
                if (tool["name"] == name) {
                    mine = tool;
                }
            }
            Json theirs;
            for (const auto& tool : individual_tools) {
                if (tool["name"] == name) {
                    theirs = tool;
                }
            }
            REQUIRE(theirs.is_object());
            CHECK(mine == theirs);
        }
    }
}

TEST_CASE("H6 and H8: the hybrid server's discovery, afd-help and listChanged") {
    const Json file = vectors();
    const Json config = file["servers"][0]["config"];
    auto built = build(file, config);

    const Json discover = send(*built.server, "server/discover", {{"_meta", modern_meta(nullptr)}});
    CHECK(discover["capabilities"]["tools"]["listChanged"] == false);
    CHECK(discover["ttlMs"] == 300000);
    CHECK(discover["instructions"].get<std::string>().find(
              "The command tools listed are the common ones. Call afd-discover to find "
              "others, afd-detail for a schema, and afd-call to run one.") != std::string::npos);

    const Json help = call(*built.server, "afd-call", {{"command", "afd-help"}});
    REQUIRE(help["success"] == true);
    CHECK(help["data"]["toolStrategy"] == "hybrid");
    CHECK(help["data"]["firstClassTools"] == config["firstClassTools"]);
    const auto configured = strings(config["firstClassTools"]);
    for (const auto& command : help["data"]["commands"]) {
        const std::string name = command["name"].get<std::string>();
        CAPTURE(name);
        const bool first_class =
            std::find(configured.begin(), configured.end(), name) != configured.end();
        CHECK(command.contains("firstClass") == first_class);
        if (first_class) {
            CHECK(command["firstClass"] == true);
        }
    }

    // Another strategy reports neither field.
    Json grouped = config;
    grouped["toolStrategy"] = "grouped";
    grouped.erase("firstClassTools");
    auto other = build(file, grouped);
    const Json plain = call(*other.server, "afd-call", {{"command", "afd-help"}});
    CHECK(plain["data"]["toolStrategy"] == "grouped");
    CHECK_FALSE(plain["data"].contains("firstClassTools"));
    for (const auto& command : plain["data"]["commands"]) {
        CHECK_FALSE(command.contains("firstClass"));
    }
}

TEST_CASE("H4 on 2025: a session's context stack does not change the hybrid list") {
    const Json file = vectors();
    const Json& entry = file["servers"][0];
    auto built = build(file, entry["config"]);
    const auto legacy = [&](int id, std::string method, Json params) {
        const Json message{
            {"jsonrpc", "2.0"}, {"id", id}, {"method", std::move(method)}, {"params", params}};
        const auto out = built.server->handle_message(afd::wire::serialize(message));
        REQUIRE(out.has_value());
        const Json response = Json::parse(*out);
        REQUIRE(response.contains("result"));
        return response["result"];
    };
    legacy(0, "initialize", {{"protocolVersion", "2025-06-18"}, {"capabilities", Json::object()}});
    const auto expected = strings(entry["lists"][0]["tools"]);
    CHECK(names(legacy(1, "tools/list", Json::object())["tools"]) == expected);

    const Json entered = legacy(
        2, "tools/call", {{"name", "afd-context-enter"}, {"arguments", {{"context", "review"}}}});
    REQUIRE(entered["isError"] == false);
    CHECK(names(legacy(3, "tools/list", Json::object())["tools"]) == expected);
    // The first-class plan-draft stays listed but is outside the session's context.
    const Json refused =
        legacy(4, "tools/call", {{"name", "plan-draft"}, {"arguments", Json::object()}});
    const Json result = Json::parse(refused["content"][0]["text"].get<std::string>());
    CHECK(result["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
}

TEST_CASE("the hybrid strategy is named hybrid") {
    CHECK(afd::mcp::tool_strategy_name(ToolStrategy::hybrid) == "hybrid");
}

} // namespace hybrid_test
