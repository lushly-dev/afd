// The tool surface of the MCP stdio server (spec/tool-strategies.md, spec/meta-tools.json): the
// strategies' tool lists, routing, the meta-tools, and the confirmation gate of afd-batch and
// afd-pipe. The confirmation and relay rounds of one command are in mcp_stdio_test.cpp.
#include "afd/afd.hpp"
#include "afd/mcp_stdio.hpp"

#include <atomic>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include <doctest.h>

using afd::Json;
using afd::mcp::ConfirmationMode;
using afd::mcp::StdioServer;
using afd::mcp::ToolStrategy;

// Named, not anonymous: unity builds put this file in one unit with mcp_stdio_test.cpp.
namespace tools_test {

/// Notes and tags: a create, a list, a confirm-gated delete, an unexposed purge, an
/// approval-gated tag removal and a tag list, with the context and bootstrap commands.
struct Fixture {
    std::shared_ptr<afd::CommandRegistry> registry;
    std::shared_ptr<std::atomic<int>> deletes = std::make_shared<std::atomic<int>>(0);
    std::shared_ptr<std::atomic<int>> removes = std::make_shared<std::atomic<int>>(0);
    std::vector<afd::ContextConfig> contexts{{.name = "reading"}, {.name = "editing"}};

    /// `listed`: the approval middleware is given the commands list, else none (#1886).
    /// `approvals`: install the approval middleware at all.
    explicit Fixture(bool with_contexts = false, bool listed = true, bool approvals = true) {
        auto deleted = deletes;
        auto removed = removes;
        std::vector<afd::CommandDefinition> commands{
            {.name = "note-create",
             .description = "Create a note. Titles are trimmed.",
             .category = "notes",
             .input_schema = Json{{"type", "object"},
                                  {"properties", {{"title", {{"type", "string"}}}}},
                                  {"required", {"title"}}},
             .handler =
                 [](const Json& input, afd::CommandContext&) {
                     return afd::success(Json{{"title", input["title"]}});
                 },
             .tags = {"write"},
             .contexts = {"editing"},
             .mutation = true,
             .expose = {.mcp = true}},
            {.name = "note-list",
             .description = "List notes",
             .category = "notes",
             .handler = [](const Json&,
                           afd::CommandContext&) { return afd::success(Json::array()); },
             .tags = {"read"},
             .expose = {.mcp = true}},
            {.name = "note-delete",
             .description = "Delete a note",
             .category = "notes",
             .input_schema = Json{{"type", "object"},
                                  {"properties", {{"id", {{"type", "string"}}}}},
                                  {"required", {"id"}}},
             .handler =
                 [deleted](const Json& input, afd::CommandContext&) {
                     ++*deleted;
                     return afd::success(Json{{"deleted", input["id"]}});
                 },
             .tags = {"write"},
             .contexts = {"editing"},
             .mutation = true,
             .destructive = true,
             .confirm_prompt = "Delete this note?",
             .expose = {.mcp = true}},
            {.name = "note-purge",
             .description = "Purge every note",
             .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
             .mutation = true},
            {.name = "tag-remove",
             .description = "Remove a tag",
             .handler =
                 [removed](const Json& input, afd::CommandContext&) {
                     ++*removed;
                     return afd::success(input);
                 },
             .mutation = true,
             .expose = {.mcp = true},
             .approval = afd::ApprovalDecision::required},
            {.name = "tag-list",
             .description = "List tags",
             .handler = [](const Json&,
                           afd::CommandContext&) { return afd::success(Json::array()); },
             .expose = {.mcp = true}},
        };
        std::vector<afd::ApprovalCommand> gated;
        if (listed) {
            gated.assign(commands.begin(), commands.end());
        }
        auto approval =
            afd::create_approval_middleware({.secrets = {std::string(32, 's')},
                                             .commands = std::move(gated),
                                             .relay = afd::ApprovalRelay::mcp_elicitation});
        REQUIRE(approval);
        std::vector<afd::CommandMiddleware> middleware;
        if (approvals) {
            middleware.push_back(*approval);
        }
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = std::move(middleware)});
        for (const auto& command : commands) {
            REQUIRE_FALSE(registry->register_command(command));
        }
        if (with_contexts) {
            REQUIRE_FALSE(afd::register_context_commands(*registry, contexts));
        }
        REQUIRE_FALSE(afd::register_bootstrap_commands(*registry));
    }
};

std::unique_ptr<StdioServer> make_server(const afd::CommandRegistry& registry,
                                         afd::mcp::StdioServerOptions options = {}) {
    auto server = StdioServer::create(registry, std::move(options));
    REQUIRE(server);
    return std::move(*server);
}

Json request(const Json& id, std::string method, Json params = Json::object()) {
    return Json{{"jsonrpc", "2.0"}, {"id", id}, {"method", std::move(method)}, {"params", params}};
}

Json send(StdioServer& server, const Json& message, const afd::mcp::ClientRequester& ask = {}) {
    const auto out = server.handle_message(afd::wire::serialize(message), ask);
    REQUIRE(out.has_value());
    return Json::parse(*out);
}

Json modern_meta(Json capabilities = Json::object()) {
    if (capabilities.is_null()) {
        capabilities = Json::object();
    }
    return Json{{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                {"io.modelcontextprotocol/clientCapabilities", std::move(capabilities)}};
}

const Json form_elicitation{{"elicitation", {{"form", Json::object()}}}};

/// A 2025-era `tools/call`; its result.
Json call(StdioServer& server, std::string name, Json arguments = Json::object(),
          const afd::mcp::ClientRequester& ask = {}) {
    return send(server,
                request(1, "tools/call", {{"name", std::move(name)}, {"arguments", arguments}}),
                ask)["result"];
}

/// A 2026-07-28 `tools/call`, with any retry fields in `extra` and `_meta` entries in
/// `meta_extra`; its result.
Json modern_call(StdioServer& server, std::string name, Json arguments,
                 Json capabilities = Json::object(), Json extra = Json::object(),
                 Json meta_extra = Json::object()) {
    Json meta = modern_meta(std::move(capabilities));
    if (meta_extra.is_object()) {
        meta.update(meta_extra);
    }
    Json params{{"name", std::move(name)}, {"arguments", std::move(arguments)}, {"_meta", meta}};
    if (extra.is_object()) {
        params.update(extra);
    }
    return send(server, request(1, "tools/call", std::move(params)))["result"];
}

Json body(const Json& result) {
    return Json::parse(result["content"][0]["text"].get<std::string>());
}

std::vector<std::string> names(const Json& tools) {
    std::vector<std::string> out;
    for (const auto& tool : tools) {
        out.push_back(tool["name"].get<std::string>());
    }
    return out;
}

Json list(StdioServer& server, Json meta = modern_meta()) {
    return send(server, request(1, "tools/list", {{"_meta", std::move(meta)}}))["result"]["tools"];
}

Json tool_named(const Json& tools, std::string_view name) {
    for (const auto& tool : tools) {
        if (tool["name"] == std::string(name)) {
            return tool;
        }
    }
    FAIL("no tool named " << name);
    return nullptr;
}

TEST_CASE("the meta-tools are spec/meta-tools.json, field for field") {
    std::ifstream in(AFD_META_TOOLS_FILE, std::ios::binary);
    REQUIRE(in);
    std::stringstream text;
    text << in.rdbuf();
    const auto spec = afd::parse_bounded(text.str());
    REQUIRE(spec);
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.tool_strategy = ToolStrategy::lazy});
    const Json tools = list(*server);
    REQUIRE(tools.size() == 5);
    for (const auto& expected : *spec) {
        CAPTURE(expected["name"].get<std::string>());
        CHECK(tool_named(tools, expected["name"].get<std::string>()) == expected);
    }
}

TEST_CASE("each strategy lists the five meta-tools first, then its own tools (#533)") {
    Fixture fixture;
    auto individual = make_server(*fixture.registry, {.tool_strategy = ToolStrategy::individual});
    CHECK(names(list(*individual)) ==
          std::vector<std::string>{"afd-discover", "afd-detail", "afd-call", "afd-batch",
                                   "afd-pipe", "note-create", "note-list", "note-delete",
                                   "tag-remove", "tag-list", "afd-help", "afd-docs", "afd-schema"});
    auto lazy = make_server(*fixture.registry, {.tool_strategy = ToolStrategy::lazy});
    CHECK(names(list(*lazy)) == std::vector<std::string>{"afd-discover", "afd-detail", "afd-call",
                                                         "afd-batch", "afd-pipe"});
    // The default: one tool per group, in the order of each group's first command.
    auto grouped = make_server(*fixture.registry);
    const Json tools = list(*grouped);
    CHECK(names(tools) == std::vector<std::string>{"afd-discover", "afd-detail", "afd-call",
                                                   "afd-batch", "afd-pipe", "notes", "tag",
                                                   "bootstrap"});
    CHECK(send(*grouped, request(1, "tools/list"))["result"]["tools"] == tools);
    CHECK(grouped->tools() == tools);

    // group_by decides the group; an empty name is `general`.
    auto by = make_server(
        *fixture.registry,
        {.group_by = [](const afd::CommandDefinition& command) -> std::optional<std::string> {
            if (command.name.rfind("afd-", 0) == 0) {
                return std::nullopt;
            }
            return std::string("app");
        }});
    CHECK(names(list(*by)) == std::vector<std::string>{"afd-discover", "afd-detail", "afd-call",
                                                       "afd-batch", "afd-pipe", "app", "general"});
}

TEST_CASE("lazy lists the meta-tools and the context tools, the same in every context") {
    Fixture fixture(true);
    auto server = make_server(*fixture.registry,
                              {.tool_strategy = ToolStrategy::lazy, .contexts = fixture.contexts});
    const std::vector<std::string> expected{
        "afd-discover", "afd-detail",       "afd-call",          "afd-batch",
        "afd-pipe",     "afd-context-list", "afd-context-enter", "afd-context-exit"};
    CHECK(names(list(*server)) == expected);
    Json reading = modern_meta();
    reading["dev.afd/context"] = "reading";
    CHECK(names(list(*server, reading)) == expected);
    // It does not vary by context, so it keeps the default ttlMs.
    CHECK(send(*server, request(1, "tools/list", {{"_meta", modern_meta()}}))["result"]["ttlMs"] ==
          300000);
    auto grouped = make_server(*fixture.registry, {.contexts = fixture.contexts});
    CHECK(send(*grouped, request(1, "tools/list", {{"_meta", modern_meta()}}))["result"]["ttlMs"] ==
          0);
}

TEST_CASE("a grouped tool takes { action, params } and describes every action") {
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce});
    const Json notes = tool_named(list(*server), "notes");
    CHECK(notes["description"] == "notes operations: create, list, delete");
    const Json& schema = notes["inputSchema"];
    CHECK(schema["required"] == Json::array({"action"}));
    CHECK(schema["properties"]["action"] ==
          Json{{"type", "string"},
               {"enum", Json::array({"create", "list", "delete"})},
               {"description", "Action to perform: create | list | delete"}});
    // note-delete is confirm-gated under enforce, so the group takes `confirm`.
    CHECK(schema["properties"]["confirm"]["type"] == "boolean");
    // Small groups inline each action's schema as a titled anyOf branch.
    const Json& branches = schema["properties"]["params"]["anyOf"];
    REQUIRE(branches.size() == 3);
    CHECK(branches[0]["title"] == "create");
    CHECK(branches[0]["description"] == "Parameters for action 'create' (note-create)");
    CHECK(branches[0]["required"] == Json::array({"title"}));
    const Json& actions = notes["_meta"]["actions"];
    REQUIRE(actions.size() == 3);
    CHECK(actions[2]["action"] == "delete");
    CHECK(actions[2]["command"] == "note-delete");
    CHECK(actions[2]["destructive"] == true);
    CHECK(actions[2]["contexts"] == Json::array({"editing"}));
    CHECK(actions[2]["inputSchema"]["properties"].contains("confirm"));
    CHECK_FALSE(notes.contains("annotations"));
    CHECK_FALSE(tool_named(list(*server), "tag")["inputSchema"]["properties"].contains("confirm"));

    // A group whose schemas are too large lists them only in _meta.actions.
    afd::CommandRegistry big;
    Json properties = Json::object();
    for (int i = 0; i < 300; ++i) {
        properties["field" + std::to_string(i)] = Json{{"type", "string"}};
    }
    REQUIRE_FALSE(big.register_command(
        {.name = "big-run",
         .description = "Run big",
         .input_schema = Json{{"type", "object"}, {"properties", properties}},
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
         .expose = {.mcp = true}}));
    auto large = make_server(big);
    const Json params = tool_named(list(*large), "big")["inputSchema"]["properties"]["params"];
    CHECK_FALSE(params.contains("anyOf"));
    CHECK(params["description"].get<std::string>().find("_meta.actions") != std::string::npos);
}

TEST_CASE("a grouped call runs the action's command, with every check of its own tool") {
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce});
    const Json created =
        call(*server, "notes", {{"action", "create"}, {"params", {{"title", "A"}}}});
    CHECK(created["isError"] == false);
    CHECK(body(created)["data"] == Json{{"title", "A"}});
    CHECK(body(call(*server, "notes", {{"action", "list"}}))["success"] == true);

    const Json missing = body(call(*server, "notes", {{"params", Json::object()}}));
    CHECK(missing["error"]["code"] == "INVALID_GROUPED_CALL");
    CHECK(missing["error"]["suggestion"] ==
          "Provide { action: \"<action>\", params: {...} }. Available actions: create, list, "
          "delete");
    CHECK(body(call(*server, "notes", {{"action", "rename"}}))["error"]["code"] ==
          "COMMAND_NOT_FOUND");
    // The input is validated as the command's own.
    CHECK(body(call(*server, "notes",
                    {{"action", "create"}, {"params", {{"title", 3}}}}))["error"]["code"] ==
          "VALIDATION_ERROR");

    // The confirmation gate, acknowledged by the group's `confirm`.
    const Json refused =
        body(call(*server, "notes", {{"action", "delete"}, {"params", {{"id", "n"}}}}));
    CHECK(refused["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(refused["error"]["suggestion"] ==
          "Make sure the user intends this, then repeat the notes call with confirm: true.");
    CHECK(*fixture.deletes == 0);
    const Json confirmed = body(call(
        *server, "notes", {{"action", "delete"}, {"params", {{"id", "n"}}}, {"confirm", true}}));
    CHECK(confirmed["success"] == true);
    CHECK(*fixture.deletes == 1);

    // Two commands with one action in a group.
    afd::CommandRegistry twins;
    for (const auto* name : {"box-open", "crate-open"}) {
        REQUIRE_FALSE(twins.register_command(
            {.name = name,
             .description = "Open",
             .category = "storage",
             .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
             .expose = {.mcp = true}}));
    }
    auto ambiguous = make_server(twins);
    CHECK(body(call(*ambiguous, "storage", {{"action", "open"}}))["error"]["code"] ==
          "AMBIGUOUS_ACTION");
    // A command is still callable by its own name in every strategy.
    CHECK(body(call(*ambiguous, "box-open"))["success"] == true);
}

TEST_CASE("an unexposed command is answered exactly as an unknown one, on every route (D4)") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    const auto answer = [](const Json& result) {
        Json error = body(result)["error"];
        return error;
    };
    const Json unknown = answer(call(*server, "note-prune"));
    const Json hidden = answer(call(*server, "note-purge"));
    CHECK(hidden["code"] == "COMMAND_NOT_FOUND");
    CHECK(hidden["message"] == "Command 'note-purge' not found");
    CHECK(unknown["code"] == "COMMAND_NOT_FOUND");
    // Neither suggestion names the unexposed command, and both point to afd-discover.
    for (const auto& error : {unknown, hidden}) {
        const auto suggestion = error["suggestion"].get<std::string>();
        CHECK(suggestion.find("note-purge") == std::string::npos);
        CHECK(suggestion.find("Use afd-discover to list all commands.") != std::string::npos);
    }
    CHECK(answer(call(*server, "afd-call", {{"command", "note-purge"}})) == hidden);
    // A grouped tool: an unexposed command is no action of its group.
    afd::CommandRegistry& registry = *fixture.registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "note-hide",
         .description = "Hide a note",
         .category = "notes",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); }}));
    const Json grouped_hidden = answer(call(*server, "notes", {{"action", "hide"}}));
    const Json grouped_unknown = answer(call(*server, "notes", {{"action", "hdie"}}));
    CHECK(grouped_hidden["code"] == "COMMAND_NOT_FOUND");
    CHECK(grouped_hidden["suggestion"] == grouped_unknown["suggestion"]);
    // A grouped tool's unknown action names no command a recovery could call: none
    // (spec/recovery.md, "Engine errors").
    CHECK_FALSE(grouped_unknown.contains("recovery"));
    CHECK_FALSE(grouped_hidden.contains("recovery"));
    CHECK(answer(call(*server, "notes"))["suggestion"].get<std::string>().find("hide") ==
          std::string::npos);
    const Json batch =
        body(call(*server, "afd-batch", {{"commands", {{{"command", "note-purge"}}}}}));
    CHECK(batch["results"][0]["result"]["error"] == hidden);
    const Json pipe = body(call(*server, "afd-pipe", {{"steps", {{{"command", "note-purge"}}}}}));
    CHECK(pipe["steps"][0]["error"] == hidden);
    const Json detail = body(call(*server, "afd-detail", {{"command", "note-purge"}}));
    CHECK(detail["data"][0]["found"] == false);
    CHECK(body(call(*server, "afd-discover"))["data"]["total"] == 8);
}

TEST_CASE("afd-call runs any exposed command, through the same checks as its own tool") {
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce});
    const Json created =
        body(call(*server, "afd-call", {{"command", "note-create"}, {"input", {{"title", "B"}}}}));
    CHECK(created["data"] == Json{{"title", "B"}});
    // Missing or null input is an empty one; nulls count as omitted.
    CHECK(body(call(*server, "afd-call",
                    {{"command", "note-list"}, {"input", nullptr}}))["success"] == true);

    const Json invalid = body(call(*server, "afd-call", {{"command", ""}}));
    CHECK(invalid["error"]["code"] == "VALIDATION_ERROR");
    CHECK(invalid["error"]["message"] == "Invalid afd-call arguments");
    CHECK(invalid["error"]["suggestion"].get<std::string>().find(
              "Provide { command: \"command-name\", input: {...} }") != std::string::npos);

    const Json refused =
        body(call(*server, "afd-call", {{"command", "note-delete"}, {"input", {{"id", "n"}}}}));
    CHECK(refused["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(refused["error"]["suggestion"] ==
          "Make sure the user intends this, then repeat the afd-call with confirm: true.");
    CHECK(body(call(*server, "afd-call",
                    {{"command", "note-delete"},
                     {"input", {{"id", "n"}}},
                     {"confirm", true}}))["success"] == true);
    CHECK(*fixture.deletes == 1);

    // A held command over a client that cannot elicit: APPROVAL_REQUIRED, no token.
    const Json held = body(call(*server, "afd-call", {{"command", "tag-remove"}}));
    CHECK(held["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(held["error"]["details"].contains("approvalToken"));
}

TEST_CASE("2026-07-28: afd-call asks for a confirmation as the command's own tool does") {
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce});
    const Json arguments{{"command", "note-delete"}, {"input", {{"id", "n"}}}};
    const Json asked = modern_call(*server, "afd-call", arguments, form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    CHECK(asked["inputRequests"]["confirm"]["params"]["message"] == "Delete this note?");
    const Json done =
        modern_call(*server, "afd-call", arguments, form_elicitation,
                    {{"requestState", asked["requestState"]},
                     {"inputResponses",
                      {{"confirm", {{"action", "accept"}, {"content", {{"confirm", true}}}}}}}});
    CHECK(done["isError"] == false);
    CHECK(*fixture.deletes == 1);
}

TEST_CASE("afd-discover filters, pages and summarizes the exposed commands") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    const Json all = body(call(*server, "afd-discover"));
    CHECK(all["data"]["total"] == 8);
    CHECK(all["data"]["availableCategories"] == Json::array({"bootstrap", "notes", "tag"}));
    CHECK(all["data"]["availableTags"] == Json::array({"bootstrap", "read", "safe", "write"}));
    CHECK(all["data"]["commands"][0] ==
          Json{{"name", "note-create"}, {"description", "Create a note"}, {"category", "notes"}});
    CHECK(all["reasoning"] == "Returned 8 of 8 matching commands (8 total)");
    CHECK(all["metadata"].contains("executionTimeMs"));

    const Json writes =
        body(call(*server, "afd-discover", {{"tag", "write"}, {"includeMutation", true}}));
    CHECK(writes["data"]["filtered"] == 2);
    CHECK(writes["data"]["commands"][0]["mutation"] == true);
    CHECK(body(call(*server, "afd-discover",
                    {{"tag", {"read", "write"}}, {"tagMode", "all"}}))["data"]["filtered"] == 0);
    CHECK(body(call(*server, "afd-discover", {{"category", "tag"}}))["reasoning"] ==
          "Returned 2 of 2 matching commands (8 total) in category 'tag'");
    CHECK(body(call(*server, "afd-discover", {{"search", "LIST note"}}))["data"]["filtered"] == 1);
    const Json page = body(call(*server, "afd-discover", {{"limit", 3}, {"offset", 2}}));
    CHECK(page["data"]["returned"] == 3);
    CHECK(page["data"]["hasMore"] == true);
    CHECK(page["data"]["commands"][0]["name"] == "note-delete");
    CHECK(page["reasoning"] ==
          "Returned 3 of 8 matching commands (8 total). Use offset: 5 to see more.");
    CHECK(body(call(*server, "afd-discover", {{"tagMode", "some"}}))["error"]["code"] ==
          "VALIDATION_ERROR");
}

TEST_CASE("afd-detail describes up to ten commands, with their tools' schemas") {
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce});
    const Json detail =
        body(call(*server, "afd-detail", {{"command", {"note-delete", "note-dlete"}}}));
    CHECK(detail["reasoning"] == "Resolved 1 of 2 requested commands");
    const Json& found = detail["data"][0];
    CHECK(found["found"] == true);
    CHECK(found["callable"] == true);
    CHECK(found["confirmPrompt"] == "Delete this note?");
    CHECK(found["destructive"] == true);
    CHECK(found["mutation"] == true);
    // The tool's schema: the confirm acknowledgement the server adds under enforce included.
    CHECK(found["inputSchema"]["properties"].contains("confirm"));
    const Json& missing = detail["data"][1];
    CHECK(missing["found"] == false);
    CHECK(missing["error"]["code"] == "COMMAND_NOT_FOUND");
    CHECK(missing["error"]["suggestion"] ==
          "Did you mean 'note-delete'? Other close matches: 'note-create', 'note-list'. Use "
          "afd-discover to list all commands.");
    // A per-entry not-found carries no recovery (spec/recovery.md, "Engine errors").
    CHECK_FALSE(missing["error"].contains("recovery"));

    Json many = Json::array();
    for (int i = 0; i < 12; ++i) {
        many.push_back("note-list");
    }
    CHECK(body(call(*server, "afd-detail", {{"command", many}}))["data"].size() == 10);
    CHECK(body(call(*server, "afd-detail"))["error"]["code"] == "VALIDATION_ERROR");
}

TEST_CASE("contexts scope afd-discover, afd-detail and every route") {
    Fixture fixture(true);
    auto server = make_server(*fixture.registry, {.contexts = fixture.contexts});
    const Json reading{{"dev.afd/context", "reading"}};
    const Json discovered =
        body(modern_call(*server, "afd-discover", Json::object(), {}, {}, reading));
    // note-create and note-delete belong to `editing`.
    CHECK(discovered["data"]["total"] == 9);
    const Json detail =
        body(modern_call(*server, "afd-detail", {{"command", "note-create"}}, {}, {}, reading));
    CHECK(detail["data"][0]["found"] == false);
    for (const auto& [tool, arguments] : std::vector<std::pair<std::string, Json>>{
             {"note-create", {{"title", "x"}}},
             {"afd-call", {{"command", "note-create"}, {"input", {{"title", "x"}}}}},
             {"notes", {{"action", "create"}, {"params", {{"title", "x"}}}}}}) {
        CAPTURE(tool);
        const Json refused = body(modern_call(*server, tool, arguments, {}, {}, reading));
        CHECK(refused["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
        CHECK(refused["error"]["suggestion"] ==
              "Use afd-context-list to see available contexts, or afd-context-enter to switch.");
    }
    // A grouped call without an action offers only the context's actions.
    CHECK(body(modern_call(*server, "notes", Json::object(), {}, {},
                           reading))["error"]["suggestion"] ==
          "Provide { action: \"<action>\", params: {...} }. Available actions: list");
    // The grouped list holds only the commands of the context.
    const Json notes = tool_named(list(*server,
                                       [] {
                                           Json meta = modern_meta();
                                           meta["dev.afd/context"] = "reading";
                                           return meta;
                                       }()),
                                  "notes");
    CHECK(notes["inputSchema"]["properties"]["action"]["enum"] == Json::array({"list"}));
}

TEST_CASE("a meta-tool's meta argument names the context for clients that cannot set _meta") {
    Fixture fixture(true);
    auto server = make_server(*fixture.registry, {.contexts = fixture.contexts});
    const Json lifted = body(modern_call(*server, "afd-call",
                                         {{"command", "note-create"},
                                          {"input", {{"title", "x"}}},
                                          {"meta", {{"dev.afd/context", "reading"}}}}));
    CHECK(lifted["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
    // Agreeing with _meta is fine; disagreeing is not.
    CHECK(body(modern_call(*server, "afd-discover", {{"meta", {{"dev.afd/context", "reading"}}}},
                           {}, {}, {{"dev.afd/context", "reading"}}))["success"] == true);
    const Json disagree =
        body(modern_call(*server, "afd-discover", {{"meta", {{"dev.afd/context", "editing"}}}}, {},
                         {}, {{"dev.afd/context", "reading"}}));
    CHECK(disagree["error"]["code"] == "VALIDATION_ERROR");
    CHECK(disagree["error"]["message"] ==
          "_meta[\"dev.afd/context\"] and the meta argument of afd-discover disagree");
    const Json not_object =
        body(modern_call(*server, "afd-detail", {{"command", "note-list"}, {"meta", 3}}));
    CHECK(not_object["error"]["message"] == "The meta argument of afd-detail must be an object");
    // An unknown context in the argument is an unknown context in _meta.
    const Json unknown =
        send(*server, request(1, "tools/call",
                              {{"name", "afd-discover"},
                               {"arguments", {{"meta", {{"dev.afd/context", "nowhere"}}}}},
                               {"_meta", modern_meta()}}));
    CHECK(unknown["error"]["code"] == -32602);
    // On a command's own tool, `meta` is input like any other.
    CHECK(body(modern_call(*server, "note-list",
                           {{"meta", {{"dev.afd/context", "reading"}}}}))["success"] == true);
}

TEST_CASE("afd-batch runs its commands and answers a bad envelope with INVALID_BATCH_REQUEST") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    const Json ran = call(*server, "afd-batch",
                          {{"commands",
                            {{{"id", "a"}, {"command", "note-create"}, {"input", {{"title", "x"}}}},
                             {{"command", "tag-list"}}}}});
    CHECK(ran["isError"] == false);
    const Json result = body(ran);
    CHECK(result["summary"]["successCount"] == 2);
    CHECK(result["results"][0]["id"] == "a");
    CHECK(result["results"][0]["result"]["data"] == Json{{"title", "x"}});

    for (const auto& arguments :
         {Json{{"commands", Json::array()}}, Json{{"commands", "x"}},
          Json{{"commands", {{{"command", "tag-list"}}}}, {"confirm", "tag-list"}}}) {
        CAPTURE(arguments.dump());
        const Json refused = call(*server, "afd-batch", arguments);
        CHECK(refused["isError"] == true);
        const Json error = body(refused)["error"];
        CHECK(error["code"] == "INVALID_BATCH_REQUEST");
        CHECK(error["suggestion"] == "Provide { commands: [...] } with command objects");
    }
}

TEST_CASE("afd-pipe chains its steps and answers a bad envelope with INVALID_PIPELINE_REQUEST") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    const Json ran = call(*server, "afd-pipe",
                          {{"input", {{"title", "piped"}}},
                           {"steps",
                            {{{"command", "note-create"}, {"input", {{"title", "$input.title"}}}},
                             {{"command", "tag-list"}}}}});
    CHECK(ran["isError"] == false);
    CHECK(body(ran)["steps"][0]["data"] == Json{{"title", "piped"}});

    const Json failed = call(*server, "afd-pipe", {{"steps", {{{"command", "note-create"}}}}});
    CHECK(failed["isError"] == true);

    const Json refused = body(call(*server, "afd-pipe", {{"steps", {{{"command", ""}}}}}));
    REQUIRE(refused["steps"].size() == 1);
    CHECK(refused["steps"][0]["index"] == -1);
    CHECK(refused["steps"][0]["error"]["code"] == "INVALID_PIPELINE_REQUEST");
}

TEST_CASE("afd-batch and afd-pipe confirm every gated step before any runs") {
    Fixture fixture;
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce});
    const Json batch{{"commands",
                      {{{"command", "note-delete"}, {"input", {{"id", "1"}}}},
                       {{"command", "note-create"}, {"input", {{"title", "y"}}}}}}};
    const Json refused = call(*server, "afd-batch", batch);
    CHECK(refused["isError"] == true);
    const Json error = body(refused)["error"];
    CHECK(error["code"] == "CONFIRMATION_REQUIRED");
    CHECK(error["message"] == "'note-delete' needs confirmation: Delete this note?");
    CHECK(error["suggestion"] == "Make sure the user intends this, then repeat the afd-batch with "
                                 "confirm: [the command names].");
    CHECK(error["details"]["commands"] == Json::array({"note-delete"}));
    CHECK(body(refused)["results"].empty());
    CHECK(*fixture.deletes == 0);

    // Naming another command is no acknowledgement; naming it is.
    Json other = batch;
    other["confirm"] = Json::array({"note-create"});
    CHECK(body(call(*server, "afd-batch", other))["error"]["code"] == "CONFIRMATION_REQUIRED");
    Json named = batch;
    named["confirm"] = Json::array({"note-delete"});
    CHECK(body(call(*server, "afd-batch", named))["summary"]["successCount"] == 2);
    CHECK(*fixture.deletes == 1);

    const Json pipe{{"steps",
                     {{{"command", "note-delete"}, {"input", {{"id", "2"}}}},
                      {{"command", "note-delete"}, {"input", {{"id", "3"}}}}}}};
    const Json held = body(call(*server, "afd-pipe", pipe));
    CHECK(held["steps"][0]["index"] == -1);
    CHECK(held["steps"][0]["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(*fixture.deletes == 1);
    // _meta["dev.afd/confirm"] acknowledges every step.
    const Json acknowledged =
        body(modern_call(*server, "afd-pipe", pipe, {}, {}, {{"dev.afd/confirm", true}}));
    CHECK(acknowledged["steps"].size() == 2);
    CHECK(*fixture.deletes == 3);
}

TEST_CASE("2026-07-28: one question covers a batch's gated steps, bound to the request") {
    Fixture fixture;
    auto server =
        make_server(*fixture.registry, {.confirmations = ConfirmationMode::require_human});
    afd::CommandRegistry& registry = *fixture.registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "tag-purge",
         .description = "Purge tags",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
         .mutation = true,
         .confirm_prompt = "Purge every tag?",
         .expose = {.mcp = true}}));
    const Json batch{
        {"commands",
         {{{"command", "note-delete"}, {"input", {{"id", "1"}}}}, {{"command", "tag-purge"}}}}};
    const Json asked = modern_call(*server, "afd-batch", batch, form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    CHECK(asked["inputRequests"]["confirm"]["params"]["message"] ==
          "This request runs commands that need confirmation:\n- note-delete: Delete this "
          "note?\n- tag-purge: Purge every tag?");
    const Json accept{{"confirm", {{"action", "accept"}, {"content", {{"confirm", true}}}}}};

    // The state answers only this request: another batch is asked again.
    Json changed = batch;
    changed["commands"][0]["input"]["id"] = "2";
    const Json again =
        modern_call(*server, "afd-batch", changed, form_elicitation,
                    {{"requestState", asked["requestState"]}, {"inputResponses", accept}});
    CHECK(again["resultType"] == "input_required");
    CHECK(*fixture.deletes == 0);

    const Json done =
        modern_call(*server, "afd-batch", batch, form_elicitation,
                    {{"requestState", asked["requestState"]}, {"inputResponses", accept}});
    CHECK(done["isError"] == false);
    CHECK(body(done)["summary"]["successCount"] == 2);
    CHECK(*fixture.deletes == 1);

    const Json declined = modern_call(*server, "afd-batch", batch, form_elicitation,
                                      {{"requestState", asked["requestState"]},
                                       {"inputResponses", {{"confirm", {{"action", "decline"}}}}}});
    const Json error = body(declined)["error"];
    CHECK(error["code"] == "CONFIRMATION_DECLINED");
    CHECK(error["message"] == "The user did not confirm 'note-delete', 'tag-purge'");
    // The user chose not to proceed (spec/recovery.md, "Engine errors").
    CHECK(error.value("recovery", Json()) == Json{{"kind", "stop"}});
    CHECK(error["retryable"] == false);
    CHECK(*fixture.deletes == 1);

    // Without elicitation, require-human refuses.
    const Json unconfirmed = body(modern_call(*server, "afd-batch", batch))["error"];
    CHECK(unconfirmed["suggestion"] ==
          "This server accepts only a confirmation from the user: use an MCP client that "
          "supports elicitation.");
    CHECK(unconfirmed.value("recovery", Json()) == Json{{"kind", "external"}});
}

TEST_CASE("2025: a pipeline's confirmation is asked in band, once") {
    Fixture fixture;
    auto server =
        make_server(*fixture.registry, {.confirmations = ConfirmationMode::require_human});
    send(*server, request(0, "initialize",
                          {{"protocolVersion", "2025-06-18"}, {"capabilities", form_elicitation}}));
    const Json pipe{{"steps", {{{"command", "note-delete"}, {"input", {{"id", "1"}}}}}}};
    int asked = 0;
    const afd::mcp::ClientRequester accept = [&](const Json& sent) -> std::optional<Json> {
        ++asked;
        CHECK(sent["method"] == "elicitation/create");
        CHECK(sent["params"]["message"] == "Delete this note?");
        // 2025-06-18 predates the elicitation `mode`.
        CHECK_FALSE(sent["params"].contains("mode"));
        return Json{{"action", "accept"}, {"content", {{"confirm", true}}}};
    };
    CHECK(call(*server, "afd-pipe", pipe, accept)["isError"] == false);
    CHECK(asked == 1);
    CHECK(*fixture.deletes == 1);

    const afd::mcp::ClientRequester decline = [](const Json&) -> std::optional<Json> {
        return Json{{"action", "decline"}};
    };
    const Json declined = body(call(*server, "afd-pipe", pipe, decline));
    CHECK(declined["steps"][0]["error"]["code"] == "CONFIRMATION_DECLINED");
    // A pipeline step carries the same recovery as the error on its own.
    CHECK(declined["steps"][0]["error"].value("recovery", Json()) == Json{{"kind", "stop"}});
    const afd::mcp::ClientRequester silent = [](const Json&) -> std::optional<Json> {
        return std::nullopt;
    };
    const Json unanswered = body(call(*server, "afd-pipe", pipe, silent))["steps"][0]["error"];
    CHECK(unanswered["code"] == "CONFIRMATION_REQUIRED");
    CHECK(unanswered.value("recovery", Json()) == Json{{"kind", "external"}});
    CHECK(*fixture.deletes == 1);
}

const Json approve{{"action", "accept"}, {"content", {{"approve", true}}}};

/// A 2025 client that declares form elicitation, and the questions it was asked.
struct Legacy {
    std::vector<Json> asked;
    std::optional<Json> answer = approve;

    void connect(StdioServer& server) {
        send(server,
             request(0, "initialize",
                     {{"protocolVersion", "2025-11-25"}, {"capabilities", form_elicitation}}));
    }

    afd::mcp::ClientRequester requester() {
        return [this](const Json& sent) -> std::optional<Json> {
            asked.push_back(sent);
            return answer;
        };
    }
};

TEST_CASE("2025: a batch is approved up front, once, before any step runs") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    Legacy client;
    client.connect(*server);
    const Json batch{{"commands",
                      {{{"command", "note-create"}, {"input", {{"title", "first"}}}},
                       {{"command", "tag-remove"}, {"input", {{"tag", "old"}}}}}}};
    const Json ran = body(call(*server, "afd-batch", batch, client.requester()));
    REQUIRE(client.asked.size() == 1);
    const auto message = client.asked[0]["params"]["message"].get<std::string>();
    CHECK(message == "This batch includes a step that needs your approval. Approving lets each "
                     "run once, exactly as shown; if you do not approve, nothing in the batch "
                     "runs.\n\nStep 2: Run tag-remove\nCommand: tag-remove\nInput: "
                     "{\"tag\":\"old\"}");
    CHECK(client.asked[0]["params"]["requestedSchema"]["required"] == Json::array({"approve"}));
    CHECK(ran["summary"]["successCount"] == 2);
    CHECK(*fixture.removes == 1);

    // Declined: nothing in the batch runs, the earlier step included.
    client.answer = Json{{"action", "decline"}};
    const Json declined = body(call(*server, "afd-batch", batch, client.requester()));
    CHECK(declined["success"] == false);
    CHECK(declined["results"].empty());
    CHECK(declined["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK(declined["error"]["details"]["reason"] == "declined");
    CHECK(declined["error"]["message"] == "The user did not approve tag-remove; nothing in the "
                                          "batch ran");
    CHECK(declined["error"].value("recovery", Json()) == Json{{"kind", "stop"}});
    CHECK(*fixture.removes == 1);

    // Unanswered: nobody declined, and nothing ran.
    client.answer = std::nullopt;
    const Json silent = body(call(*server, "afd-batch", batch, client.requester()));
    CHECK(silent["results"].empty());
    CHECK(silent["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(silent["error"].contains("details"));
    // Unanswered: a person must still approve.
    CHECK(silent["error"].value("recovery", Json()) == Json{{"kind", "external"}});
    CHECK(*fixture.removes == 1);
}

TEST_CASE("without a commands list, a batch is approved up front from the server's commands") {
    Fixture fixture(false, false);
    auto server = make_server(*fixture.registry);
    Legacy client;
    client.connect(*server);
    const Json batch{{"commands",
                      {{{"command", "note-create"}, {"input", {{"title", "first"}}}},
                       {{"command", "tag-remove"}, {"input", {{"tag", "old"}}}}}}};
    const Json ran = body(call(*server, "afd-batch", batch, client.requester()));
    REQUIRE(client.asked.size() == 1);
    CHECK(client.asked[0]["params"]["message"].get<std::string>().find("Step 2: Run tag-remove") !=
          std::string::npos);
    CHECK(ran["summary"]["successCount"] == 2);
    CHECK(*fixture.removes == 1);

    // A pipeline step whose input comes from an earlier one cannot be asked about up front.
    const Json pipe{{"steps",
                     {{{"command", "tag-list"}},
                      {{"command", "tag-remove"}, {"input", {{"tag", "$prev.0"}}}}}}};
    const Json refused = body(call(*server, "afd-pipe", pipe, client.requester()));
    CHECK(client.asked.size() == 1);
    CHECK(refused["steps"][0]["error"]["details"]["reason"] == "input-not-known");
    // The caller reshapes the pipeline: no recovery.
    CHECK_FALSE(refused["steps"][0]["error"].contains("recovery"));
    CHECK(*fixture.removes == 1);
}

TEST_CASE("a step gated only by the commands list is approved up front, before any step runs") {
    // note-create records each run; tag-purge declares no policy, and only the approval
    // middleware's commands list gates it, which the server cannot see.
    auto created = std::make_shared<std::atomic<int>>(0);
    auto purged = std::make_shared<std::atomic<int>>(0);
    auto approval = afd::create_approval_middleware(
        {.secrets = {std::string(32, 's')},
         .commands = {afd::ApprovalCommand("tag-purge", afd::ApprovalDecision::required)},
         .relay = afd::ApprovalRelay::mcp_elicitation});
    REQUIRE(approval);
    afd::CommandRegistry registry(afd::CommandRegistryOptions{.middleware = {*approval}});
    REQUIRE_FALSE(
        registry.register_command({.name = "note-create",
                                   .description = "Create a note",
                                   .handler =
                                       [created](const Json& input, afd::CommandContext&) {
                                           ++*created;
                                           return afd::success(input);
                                       },
                                   .mutation = true,
                                   .expose = {.mcp = true}}));
    REQUIRE_FALSE(registry.register_command({.name = "tag-purge",
                                             .description = "Purge a tag",
                                             .handler =
                                                 [purged](const Json& input, afd::CommandContext&) {
                                                     ++*purged;
                                                     return afd::success(input);
                                                 },
                                             .mutation = true,
                                             .expose = {.mcp = true}}));
    REQUIRE_FALSE(afd::register_bootstrap_commands(registry));
    auto server = make_server(registry);
    Legacy client;
    client.connect(*server);
    const Json batch{{"commands",
                      {{{"command", "note-create"}, {"input", {{"title", "first"}}}},
                       {{"command", "tag-purge"}, {"input", {{"tag", "old"}}}}}}};
    const Json pipe{{"steps",
                     {{{"command", "note-create"}, {"input", {{"title", "first"}}}},
                      {{"command", "tag-purge"}, {"input", {{"tag", "old"}}}}}}};

    std::string tool;
    Json arguments;
    SUBCASE("afd-batch") {
        tool = "afd-batch";
        arguments = batch;
    }
    SUBCASE("afd-pipe") {
        tool = "afd-pipe";
        arguments = pipe;
    }
    // Declined: the human is asked once, before the earlier step runs, and nothing runs.
    client.answer = Json{{"action", "decline"}};
    const Json declined = body(call(*server, tool, arguments, client.requester()));
    REQUIRE(client.asked.size() == 1);
    CHECK(client.asked[0]["params"]["message"].get<std::string>().find("Step 2: Run tag-purge") !=
          std::string::npos);
    CHECK(declined.dump().find("\"reason\":\"declined\"") != std::string::npos);
    CHECK(*created == 0);
    CHECK(*purged == 0);

    // Approved: each step runs once.
    client.answer = approve;
    body(call(*server, tool, arguments, client.requester()));
    CHECK(client.asked.size() == 2);
    CHECK(*created == 1);
    CHECK(*purged == 1);
}

TEST_CASE("an up-front step whose input has no canonical form is refused before any step runs") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    Legacy client;
    client.connect(*server);
    const Json big = Json::parse(R"({"tag": 9007199254740993})");
    const Json batch{{"commands",
                      {{{"command", "note-create"}, {"input", {{"title", "first"}}}},
                       {{"command", "tag-remove"}, {"input", big}}}}};
    const Json batched = body(call(*server, "afd-batch", batch, client.requester()));
    CHECK(batched["error"]["code"] == "APPROVAL_UNAVAILABLE");
    CHECK(batched["error"]["details"]["reason"] == "input-not-canonical");
    CHECK(batched["results"].empty());

    const Json pipe{
        {"steps", {{{"command", "tag-list"}}, {{"command", "tag-remove"}, {"input", big}}}}};
    const Json piped = body(call(*server, "afd-pipe", pipe, client.requester()));
    CHECK(piped["steps"][0]["error"]["code"] == "APPROVAL_UNAVAILABLE");
    CHECK(piped["steps"][0]["error"]["details"]["reason"] == "input-not-canonical");
    CHECK(client.asked.empty());
    CHECK(*fixture.removes == 0);
}

TEST_CASE("without the approval middleware, a gated tool is refused before its handler") {
    Fixture fixture(false, false, false);
    auto server = make_server(*fixture.registry);
    for (const auto& [name, arguments] : std::vector<std::pair<std::string, Json>>{
             {"tag-remove", {{"tag", "old"}}},
             {"afd-call", {{"command", "tag-remove"}, {"input", {{"tag", "old"}}}}}}) {
        CAPTURE(name);
        const Json result = body(call(*server, name, arguments));
        CHECK(result["error"]["code"] == "APPROVAL_UNAVAILABLE");
        CHECK(result["error"]["details"]["reason"] == "no-approval-step");
    }
    CHECK(*fixture.removes == 0);
}

TEST_CASE("2026-07-28: one input_required approves the whole batch, and a replay runs nothing") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    const Json batch{{"commands",
                      {{{"command", "tag-remove"}, {"input", {{"tag", "a"}}}},
                       {{"command", "tag-remove"}, {"input", {{"tag", "a"}}}}}}};
    const Json asked = modern_call(*server, "afd-batch", batch, form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    const Json& form = asked["inputRequests"]["approval"]["params"];
    CHECK(form["message"].get<std::string>().rfind(
              "This batch includes 2 steps that need your approval.", 0) == 0);
    CHECK(*fixture.removes == 0);
    const Json answer{{"requestState", asked["requestState"]},
                      {"inputResponses", {{"approval", approve}}}};

    // Another request cannot use the approval.
    Json other = batch;
    other["commands"][1]["input"]["tag"] = "b";
    CHECK(modern_call(*server, "afd-batch", other, form_elicitation, answer)["resultType"] ==
          "input_required");
    // Nor a call to the command on its own.
    CHECK(modern_call(*server, "tag-remove", {{"tag", "a"}}, form_elicitation,
                      answer)["resultType"] == "input_required");
    CHECK(*fixture.removes == 0);

    // Two identical steps, two approvals, one answer.
    const Json done = modern_call(*server, "afd-batch", batch, form_elicitation, answer);
    CHECK(done["isError"] == false);
    CHECK(body(done)["summary"]["successCount"] == 2);
    CHECK(*fixture.removes == 2);

    // A replay of the approved request runs nothing and asks again, saying why.
    const Json replay = modern_call(*server, "afd-batch", batch, form_elicitation, answer);
    REQUIRE(replay["resultType"] == "input_required");
    CHECK(replay["inputRequests"]["approval"]["params"]["message"].get<std::string>().rfind(
              "The earlier approval expired, was already used or no longer matches", 0) == 0);
    CHECK(*fixture.removes == 2);

    const Json declined =
        modern_call(*server, "afd-batch", batch, form_elicitation,
                    {{"requestState", asked["requestState"]},
                     {"inputResponses", {{"approval", {{"action", "decline"}}}}}});
    CHECK(body(declined)["error"]["details"]["reason"] == "declined");
    CHECK(body(declined)["error"].value("recovery", Json()) == Json{{"kind", "stop"}});
    CHECK(*fixture.removes == 2);
}

TEST_CASE("a pipeline step is shown with its $input resolved; a step reading $prev cannot be") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    Legacy client;
    client.connect(*server);
    const Json known{{"input", {{"tag", "piped"}}},
                     {"steps",
                      {{{"command", "tag-list"}},
                       {{"command", "tag-remove"},
                        {"input", {{"tag", "$input.tag"}}},
                        {"when", {{"$exists", "$prev"}}}}}}};
    const Json ran = body(call(*server, "afd-pipe", known, client.requester()));
    REQUIRE(client.asked.size() == 1);
    const auto message = client.asked[0]["params"]["message"].get<std::string>();
    CHECK(message.find("This pipeline includes a step") == 0);
    CHECK(message.find("Some steps run only when their conditions hold") != std::string::npos);
    CHECK(message.find("Step 2: Run tag-remove\nCommand: tag-remove\nInput: {\"tag\":\"piped\"}") !=
          std::string::npos);
    CHECK(ran["steps"][1]["data"] == Json{{"tag", "piped"}});
    CHECK(*fixture.removes == 1);

    const Json late{{"steps",
                     {{{"command", "tag-list"}},
                      {{"command", "tag-remove"}, {"input", {{"tag", "$prev.0"}}}}}}};
    const Json refused = body(call(*server, "afd-pipe", late, client.requester()));
    CHECK(client.asked.size() == 1);
    const Json& error = refused["steps"][0]["error"];
    CHECK(refused["steps"][0]["index"] == -1);
    CHECK(error["code"] == "APPROVAL_REQUIRED");
    CHECK(error["details"] ==
          Json{{"reason", "input-not-known"}, {"step", 1}, {"command", "tag-remove"}});
    CHECK(error["suggestion"].get<std::string>().rfind(
              "Split the pipeline before the step at index 1", 0) == 0);
    CHECK_FALSE(error.contains("recovery"));
    CHECK(*fixture.removes == 1);
}

TEST_CASE("more than 20 gated steps are not asked about") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    Json commands = Json::array();
    for (int i = 0; i < 21; ++i) {
        commands.push_back(
            Json{{"command", "tag-remove"}, {"input", {{"tag", std::to_string(i)}}}});
    }
    const Json refused =
        body(modern_call(*server, "afd-batch", {{"commands", commands}}, form_elicitation));
    CHECK(refused["error"]["details"] == Json{{"reason", "too-many-approvals"}, {"limit", 20}});
    CHECK_FALSE(refused["error"].contains("recovery"));
    CHECK(*fixture.removes == 0);
}

TEST_CASE("a batch that needs a confirmation and an approval asks for each in turn") {
    // vault-open asks for confirmation and needs approval; vault-sync runs it from its handler.
    auto registry = std::make_shared<afd::CommandRegistry>();
    auto opens = std::make_shared<std::atomic<int>>(0);
    std::weak_ptr<afd::CommandRegistry> weak = registry;
    std::vector<afd::CommandDefinition> commands{
        {.name = "vault-open",
         .description = "Open the vault",
         .handler =
             [opens](const Json&, afd::CommandContext&) {
                 ++*opens;
                 return afd::success(nullptr);
             },
         .mutation = true,
         .confirm_prompt = "Open the vault?",
         .expose = {.mcp = true},
         .approval = afd::ApprovalDecision::required},
        {.name = "vault-sync",
         .description = "Sync the vault, opening it",
         .handler =
             [weak](const Json&, afd::CommandContext& context) {
                 return weak.lock()->execute("vault-open", Json::object(), context);
             },
         .expose = {.mcp = true},
         .approval = afd::ApprovalDecision::required}};
    auto approval = afd::create_approval_middleware({.secrets = {std::string(32, 's')},
                                                     .commands = {commands.begin(), commands.end()},
                                                     .relay = afd::ApprovalRelay::mcp_elicitation});
    REQUIRE(approval);
    registry->use(*approval);
    for (const auto& command : commands) {
        REQUIRE_FALSE(registry->register_command(command));
    }
    auto server = make_server(*registry, {.confirmations = ConfirmationMode::require_human});
    const Json batch{{"commands", {{{"command", "vault-open"}}}}};
    const Json confirm_asked = modern_call(*server, "afd-batch", batch, form_elicitation);
    REQUIRE(confirm_asked["inputRequests"].contains("confirm"));
    const Json approval_asked =
        modern_call(*server, "afd-batch", batch, form_elicitation,
                    {{"requestState", confirm_asked["requestState"]},
                     {"inputResponses",
                      {{"confirm", {{"action", "accept"}, {"content", {{"confirm", true}}}}}}}});
    REQUIRE(approval_asked["inputRequests"].contains("approval"));
    const Json done = modern_call(*server, "afd-batch", batch, form_elicitation,
                                  {{"requestState", approval_asked["requestState"]},
                                   {"inputResponses", {{"approval", approve}}}});
    CHECK(done["isError"] == false);
    CHECK(*opens == 1);

    // A command a step runs never sees the step's approval: it falls back, telling the agent to
    // call it on its own.
    const Json sync{{"commands", {{{"command", "vault-sync"}}}}};
    const Json sync_asked = modern_call(*server, "afd-batch", sync, form_elicitation);
    REQUIRE(sync_asked["inputRequests"].contains("approval"));
    const Json nested = body(modern_call(*server, "afd-batch", sync, form_elicitation,
                                         {{"requestState", sync_asked["requestState"]},
                                          {"inputResponses", {{"approval", approve}}}}));
    const Json& error = nested["results"][0]["result"]["error"];
    CHECK(error["code"] == "APPROVAL_REQUIRED");
    CHECK(error["suggestion"].get<std::string>().find("Call vault-open on its own") !=
          std::string::npos);
    CHECK(*opens == 1);
}

TEST_CASE("parallel steps share one plan, each gated step on its own approval") {
    // `tag-drop` needs approval only for tag "keep": a policy function, evaluated per step.
    auto drops = std::make_shared<std::atomic<int>>(0);
    std::vector<afd::CommandDefinition> commands{
        {.name = "tag-drop",
         .description = "Drop a tag",
         .input_schema = Json{{"type", "object"},
                              {"properties", {{"tag", {{"type", "string"}}}}},
                              {"required", {"tag"}}},
         .handler =
             [drops](const Json&, afd::CommandContext&) {
                 ++*drops;
                 return afd::success(nullptr);
             },
         .mutation = true,
         .expose = {.mcp = true},
         .approval =
             [](const Json& input, const afd::CommandContext&) {
                 return input["tag"] == "keep" ? afd::ApprovalDecision::required
                                               : afd::ApprovalDecision::not_required;
             }}};
    auto approval = afd::create_approval_middleware({.secrets = {std::string(32, 's')},
                                                     .commands = {commands.begin(), commands.end()},
                                                     .relay = afd::ApprovalRelay::mcp_elicitation});
    REQUIRE(approval);
    afd::CommandRegistry registry(
        {.middleware = {*approval}, .runner = std::make_shared<afd::ThreadTaskRunner>()});
    REQUIRE_FALSE(registry.register_command(commands.front()));
    auto server = make_server(registry);
    Json items = Json::array();
    for (int i = 0; i < 8; ++i) {
        items.push_back(
            Json{{"command", "tag-drop"}, {"input", {{"tag", i % 2 == 0 ? "keep" : "x"}}}});
    }
    const Json batch{{"commands", items}, {"options", {{"parallelism", 8}}}};
    const Json asked = modern_call(*server, "afd-batch", batch, form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    // Only the four steps the policy holds are listed.
    CHECK(asked["inputRequests"]["approval"]["params"]["message"].get<std::string>().rfind(
              "This batch includes 4 steps that need your approval.", 0) == 0);
    CHECK(*drops == 0);
    const Json done = body(modern_call(
        *server, "afd-batch", batch, form_elicitation,
        {{"requestState", asked["requestState"]}, {"inputResponses", {{"approval", approve}}}}));
    CHECK(done["summary"]["successCount"] == 8);
    CHECK(*drops == 8);
}

TEST_CASE("an approved step that a condition skips does not run, and its approval is not reused") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    Legacy client;
    client.connect(*server);
    const Json pipe{{"steps",
                     {{{"command", "tag-remove"},
                       {"input", {{"tag", "a"}}},
                       {"when", {{"$exists", "$prev.missing"}}}},
                      {{"command", "tag-remove"}, {"input", {{"tag", "b"}}}}}}};
    const Json ran = body(call(*server, "afd-pipe", pipe, client.requester()));
    CHECK(client.asked.size() == 1);
    CHECK(ran["steps"][0]["status"] == "skipped");
    CHECK(ran["steps"][1]["data"] == Json{{"tag", "b"}});
    CHECK(*fixture.removes == 1);
}

TEST_CASE("2026-07-28: an up-front approval answers only the caller it was asked of") {
    Fixture fixture;
    auto server = make_server(
        *fixture.registry,
        {.context_hook = [](afd::CommandContext& context, const afd::mcp::RequestInfo& info) {
            if (info.meta.contains("dev.example/who") && info.meta["dev.example/who"].is_string()) {
                context.actor->id = info.meta["dev.example/who"].get<std::string>();
            }
        }});
    const Json batch{{"commands", {{{"command", "tag-remove"}, {"input", {{"tag", "a"}}}}}}};
    const Json asked = modern_call(*server, "afd-batch", batch, form_elicitation, {},
                                   {{"dev.example/who", "ada"}});
    REQUIRE(asked["resultType"] == "input_required");
    const Json answer{{"requestState", asked["requestState"]},
                      {"inputResponses", {{"approval", approve}}}};
    CHECK(modern_call(*server, "afd-batch", batch, form_elicitation, answer,
                      {{"dev.example/who", "bob"}})["resultType"] == "input_required");
    CHECK(*fixture.removes == 0);
    CHECK(modern_call(*server, "afd-batch", batch, form_elicitation, answer,
                      {{"dev.example/who", "ada"}})["isError"] == false);
    CHECK(*fixture.removes == 1);
}

TEST_CASE("without a form elicitation, a batch step that needs approval is held step by step") {
    Fixture fixture;
    auto server = make_server(*fixture.registry);
    const Json batch =
        body(call(*server, "afd-batch", {{"commands", {{{"command", "tag-remove"}}}}}));
    const Json& error = batch["results"][0]["result"]["error"];
    CHECK(error["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(error["details"].contains("approvalToken"));
    CHECK(*fixture.removes == 0);
}

TEST_CASE("server/discover and afd-help describe the strategy") {
    Fixture fixture;
    for (const auto& [strategy, sentence] : std::vector<std::pair<ToolStrategy, std::string>>{
             {ToolStrategy::lazy, " Call afd-discover to find commands, afd-detail for a command "
                                  "schema, and afd-call to run one."},
             {ToolStrategy::individual,
              " Each command is its own tool; afd-call also runs any command by name."}}) {
        auto server = make_server(*fixture.registry, {.name = "notes", .tool_strategy = strategy});
        const auto instructions =
            send(*server, request(1, "server/discover",
                                  {{"_meta", modern_meta()}}))["result"]["instructions"]
                .get<std::string>();
        CHECK(instructions.find(sentence + " Use afd-batch for several independent commands and "
                                           "afd-pipe to chain them.") != std::string::npos);
        CHECK(body(call(*server, "afd-help"))["data"]["toolStrategy"] ==
              std::string(afd::mcp::tool_strategy_name(strategy)));
    }
    auto grouped = make_server(*fixture.registry);
    CHECK(body(call(*grouped, "bootstrap", {{"action", "help"}}))["data"]["toolStrategy"] ==
          "grouped");
    // In process there is no strategy to report.
    CHECK_FALSE(Json(fixture.registry->execute("afd-help"))["data"].contains("toolStrategy"));
}

TEST_CASE("2025: a batch cannot enter a context to run a gated step unconfirmed") {
    Fixture fixture(true);
    auto server = make_server(*fixture.registry, {.confirmations = ConfirmationMode::enforce,
                                                  .contexts = fixture.contexts});
    const Json steps =
        Json::array({Json{{"command", "afd-context-enter"}, {"input", {{"context", "editing"}}}},
                     Json{{"command", "note-delete"}, {"input", {{"id", "1"}}}}});
    // The connection is in `reading`, where note-delete is not available; the batch's first step
    // switches to `editing` before the second runs, so the gate must count note-delete anyway.
    CHECK(body(call(*server, "afd-context-enter", {{"context", "reading"}}))["success"] == true);
    const Json batch = body(call(*server, "afd-batch", {{"commands", steps}}));
    CHECK(batch["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(batch["error"]["details"]["commands"] == Json::array({"note-delete"}));
    CHECK(body(call(*server, "afd-context-exit"))["success"] == true);
    CHECK(body(call(*server, "afd-context-enter", {{"context", "reading"}}))["success"] == true);
    const Json pipe = body(call(*server, "afd-pipe", {{"steps", steps}}));
    CHECK(pipe["steps"][0]["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(*fixture.deletes == 0);

    // Confirmed, the step runs once the context allows it.
    const Json confirmed =
        body(call(*server, "afd-batch", {{"commands", steps}, {"confirm", {"note-delete"}}}));
    CHECK(confirmed["summary"]["successCount"] == 2);
    CHECK(*fixture.deletes == 1);
}

TEST_CASE("2025: a batch question nobody answers is no decline") {
    Fixture fixture;
    auto server =
        make_server(*fixture.registry, {.confirmations = ConfirmationMode::require_human});
    send(*server, request(0, "initialize",
                          {{"protocolVersion", "2025-11-25"}, {"capabilities", form_elicitation}}));
    const afd::mcp::ClientRequester silent = [](const Json&) -> std::optional<Json> {
        return std::nullopt;
    };
    const Json refused = body(
        call(*server, "afd-batch",
             {{"commands", {{{"command", "note-delete"}, {"input", {{"id", "1"}}}}}}}, silent));
    CHECK(refused["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(refused["error"]["suggestion"] ==
          "The client did not answer the confirmation question. Ask the user, then call again.");
    CHECK(refused["error"].value("recovery", Json()) == Json{{"kind", "external"}});
}

TEST_CASE("2026-07-28: a batch's confirmation answers only the caller it was asked of") {
    Fixture fixture;
    auto server = make_server(
        *fixture.registry,
        {.confirmations = ConfirmationMode::require_human,
         .context_hook = [](afd::CommandContext& context, const afd::mcp::RequestInfo& info) {
             if (info.meta.contains("dev.example/who") &&
                 info.meta["dev.example/who"].is_string()) {
                 context.actor->id = info.meta["dev.example/who"].get<std::string>();
             }
         }});
    const Json batch{{"commands", {{{"command", "note-delete"}, {"input", {{"id", "1"}}}}}}};
    const Json asked = modern_call(*server, "afd-batch", batch, form_elicitation, {},
                                   {{"dev.example/who", "ada"}});
    REQUIRE(asked["resultType"] == "input_required");
    const Json answer{{"requestState", asked["requestState"]},
                      {"inputResponses",
                       {{"confirm", {{"action", "accept"}, {"content", {{"confirm", true}}}}}}}};
    const Json other = modern_call(*server, "afd-batch", batch, form_elicitation, answer,
                                   {{"dev.example/who", "bob"}});
    CHECK(other["resultType"] == "input_required");
    CHECK(*fixture.deletes == 0);
    const Json same = modern_call(*server, "afd-batch", batch, form_elicitation, answer,
                                  {{"dev.example/who", "ada"}});
    CHECK(same["isError"] == false);
    CHECK(*fixture.deletes == 1);
}

} // namespace tools_test
