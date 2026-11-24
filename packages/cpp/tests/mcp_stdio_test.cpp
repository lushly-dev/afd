// The MCP stdio server (afd/mcp_stdio.hpp): both protocol eras, confirmations, the approval
// relay and cancellation (spec/command-metadata.md, "Confirmations" and "Asking the human over
// MCP").
#include "afd/afd.hpp"
#include "afd/mcp_stdio.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <streambuf>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <doctest.h>

using afd::Json;
using afd::mcp::ConfirmationMode;
using afd::mcp::StdioServer;

namespace {

const std::string secret(32, 'k');

/// A registry of notes: a create, a list, a confirm-gated clear and an approval-gated open.
struct Notes {
    std::shared_ptr<afd::CommandRegistry> registry;
    std::shared_ptr<std::atomic<int>> clears = std::make_shared<std::atomic<int>>(0);
    std::shared_ptr<std::atomic<int>> opens = std::make_shared<std::atomic<int>>(0);
    // Tokens the middleware issued, as `on_approval_required` saw them; never in an MCP result.
    std::shared_ptr<std::vector<std::string>> tokens = std::make_shared<std::vector<std::string>>();

    explicit Notes(afd::ApprovalRelay relay = afd::ApprovalRelay::none) {
        const auto ok = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); };
        auto clears_seen = clears;
        auto opens_seen = opens;
        std::vector<afd::CommandDefinition> commands{
            {.name = "note-create",
             .description = "Create a note",
             .input_schema = Json{{"type", "object"},
                                  {"properties", {{"title", {{"type", "string"}}}}},
                                  {"required", {"title"}},
                                  {"additionalProperties", false}},
             .handler =
                 [](const Json& input, afd::CommandContext&) {
                     return afd::success(Json{{"title", input["title"]}});
                 },
             .mutation = true,
             .expose = {.mcp = true}},
            {.name = "note-list",
             .description = "List notes",
             .handler = ok,
             .expose = {.mcp = true}},
            {.name = "note-clear",
             .description = "Delete every note",
             .input_schema = Json{{"type", "object"},
                                  {"properties", {{"all", {{"type", "boolean"}}}}},
                                  {"additionalProperties", false}},
             .handler =
                 [clears_seen](const Json& input, afd::CommandContext&) {
                     ++*clears_seen;
                     return afd::success(Json{{"input", input}});
                 },
             .mutation = true,
             .destructive = true,
             .confirm_prompt = "Delete every note?",
             .expose = {.mcp = true}},
            {.name = "vault-open",
             .description = "Open the vault",
             .handler =
                 [opens_seen](const Json&, afd::CommandContext&) {
                     ++*opens_seen;
                     return afd::success(nullptr);
                 },
             .mutation = true,
             .confirm_prompt = "Open the vault?",
             .expose = {.mcp = true},
             .approval = afd::ApprovalDecision::required},
        };
        auto issued = tokens;
        auto approval =
            afd::create_approval_middleware({.secrets = {secret},
                                             .commands = {commands.begin(), commands.end()},
                                             .on_approval_required =
                                                 [issued](const afd::ApprovalRequest& held) {
                                                     issued->push_back(held.approval_token);
                                                 },
                                             .relay = relay});
        REQUIRE(approval);
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {*approval}});
        for (const auto& command : commands) {
            REQUIRE_FALSE(registry->register_command(command));
        }
    }
};

/// A server; the tests of command tools list them one per command (`individual`).
std::unique_ptr<StdioServer> make_server(const afd::CommandRegistry& registry,
                                         afd::mcp::StdioServerOptions options = {
                                             .tool_strategy = afd::mcp::ToolStrategy::individual}) {
    auto server = StdioServer::create(registry, std::move(options));
    REQUIRE(server);
    return std::move(*server);
}

Json reply(StdioServer& server, std::string_view line, const afd::mcp::ClientRequester& ask = {}) {
    const auto out = server.handle_message(line, ask);
    REQUIRE(out.has_value());
    return Json::parse(*out);
}

Json request(const Json& id, std::string method, Json params = Json::object()) {
    return Json{{"jsonrpc", "2.0"}, {"id", id}, {"method", std::move(method)}, {"params", params}};
}

Json send(StdioServer& server, const Json& message, const afd::mcp::ClientRequester& ask = {}) {
    return reply(server, afd::wire::serialize(message), ask);
}

/// `_meta` of a 2026-07-28 request with `capabilities`.
Json modern_meta(Json capabilities = Json::object()) {
    if (capabilities.is_null()) {
        capabilities = Json::object(); // `{}` in a call is null, not an empty object
    }
    return Json{{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                {"io.modelcontextprotocol/clientCapabilities", std::move(capabilities)}};
}

const Json form_elicitation{{"elicitation", {{"form", Json::object()}}}};

/// A modern `tools/call`, with any retry fields in `extra`.
Json modern_call(StdioServer& server, std::string name, Json arguments, Json capabilities,
                 Json extra = Json::object(), Json meta_extra = Json::object()) {
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

/// The CommandResult a tool result carries.
Json body(const Json& result) {
    return Json::parse(result["content"][0]["text"].get<std::string>());
}

/// The command tools of a tool list: everything but the meta-tools the strategy lists first.
Json command_tools(const Json& tools) {
    Json out = Json::array();
    for (const auto& tool : tools) {
        const auto name = tool["name"].get<std::string>();
        if (name != "afd-batch" && name != "afd-pipe" && name != "afd-call" &&
            name != "afd-discover" && name != "afd-detail") {
            out.push_back(tool);
        }
    }
    return out;
}

Json accept(std::string_view field) {
    return Json{{"action", "accept"}, {"content", {{std::string(field), true}}}};
}

} // namespace

TEST_CASE("initialize echoes a supported protocol version, else the newest") {
    Notes notes;
    auto server = make_server(
        *notes.registry,
        {.name = "notes", .version = "1.0.0", .tool_strategy = afd::mcp::ToolStrategy::individual});
    const auto known = send(*server, request(0, "initialize", {{"protocolVersion", "2025-03-26"}}));
    CHECK(known["result"]["protocolVersion"] == "2025-03-26");
    CHECK(known["result"]["capabilities"] == Json{{"tools", {{"listChanged", false}}}});
    CHECK(known["result"]["serverInfo"] == Json{{"name", "notes"}, {"version", "1.0.0"}});
    CHECK(send(*server, request(1, "initialize",
                                {{"protocolVersion",
                                  "1999-01-01"}}))["result"]["protocolVersion"] == "2025-11-25");
    // Legacy results carry no resultType.
    CHECK_FALSE(send(*server, request(3, "tools/list"))["result"].contains("resultType"));
}

TEST_CASE("MCP 2026-07-28 requests are served statelessly from their _meta") {
    Notes notes;
    auto server = make_server(
        *notes.registry,
        {.name = "notes", .version = "1.0.0", .tool_strategy = afd::mcp::ToolStrategy::individual});
    const auto discover =
        send(*server, request("d", "server/discover", {{"_meta", modern_meta()}}));
    CHECK(discover["result"]["resultType"] == "complete");
    CHECK(discover["result"]["supportedVersions"] == Json::array({"2026-07-28"}));
    CHECK(discover["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "notes");
    CHECK(discover["result"]["ttlMs"] == 300000);

    const auto tools = send(*server, request(1, "tools/list", {{"_meta", modern_meta()}}));
    CHECK(tools["result"]["resultType"] == "complete");
    CHECK(tools["result"]["cacheScope"] == "public");
    CHECK(command_tools(tools["result"]["tools"]).size() == 4);

    const auto created = modern_call(*server, "note-create", {{"title", "Modern"}}, {});
    CHECK(created["resultType"] == "complete");
    CHECK(created["isError"] == false);
    CHECK(created["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "notes");

    Json unsupported_meta = modern_meta();
    unsupported_meta["io.modelcontextprotocol/protocolVersion"] = "2099-01-01";
    const auto unsupported = send(*server, request(3, "tools/list", {{"_meta", unsupported_meta}}));
    CHECK(unsupported["error"]["code"] == -32022);
    CHECK(unsupported["error"]["data"]["supported"] == Json::array({"2026-07-28"}));

    const auto no_capabilities = send(
        *server, request(4, "tools/list",
                         {{"_meta", {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"}}}}));
    CHECK(no_capabilities["error"]["code"] == -32602);
    CHECK(send(*server, request(5, "ping", {{"_meta", modern_meta()}}))["error"]["code"] == -32601);
}

TEST_CASE("notifications and responses get no reply; ping does") {
    Notes notes;
    auto server = make_server(*notes.registry);
    CHECK_FALSE(
        server->handle_message(R"({"jsonrpc":"2.0","method":"notifications/initialized"})"));
    CHECK_FALSE(server->handle_message(R"({"jsonrpc":"2.0","id":"x","result":{}})"));
    CHECK(send(*server, request("p", "ping"))["result"] == Json::object());
}

TEST_CASE("tools/list carries each command's tool, title, annotations and _meta") {
    Notes notes;
    auto server = make_server(*notes.registry);
    const auto tools = command_tools(send(*server, request(1, "tools/list"))["result"]["tools"]);
    REQUIRE(tools.size() == 4);
    for (const auto& tool : tools) {
        CHECK_FALSE(tool.contains("title"));
        if (tool["name"] == "note-list") {
            CHECK_FALSE(tool.contains("annotations"));
            CHECK_FALSE(tool.contains("_meta"));
        }
        if (tool["name"] == "note-clear") {
            CHECK(tool["annotations"] == Json{{"readOnlyHint", false}, {"destructiveHint", true}});
            CHECK(tool["_meta"] == Json{{"mutation", true}, {"destructive", true}});
            // Confirmations are off: no confirm argument.
            CHECK_FALSE(tool["inputSchema"]["properties"].contains("confirm"));
        }
        if (tool["name"] == "vault-open") {
            CHECK(tool["_meta"] == Json{{"mutation", true}, {"approval", "required"}});
        }
    }
}

TEST_CASE("tools/call returns the CommandResult as text, with isError = !success") {
    Notes notes;
    auto server = make_server(*notes.registry);
    const auto ok =
        send(*server,
             request(3, "tools/call",
                     {{"name", "note-create"}, {"arguments", {{"title", "From MCP"}}}}))["result"];
    CHECK(ok["isError"] == false);
    CHECK(body(ok)["data"]["title"] == "From MCP");
    CHECK(body(ok)["metadata"]["traceId"].get<std::string>().rfind("trace-", 0) == 0);

    // Invalid arguments and unknown tools are CommandResults, never JSON-RPC errors.
    const auto invalid = send(
        *server, request(4, "tools/call",
                         {{"name", "note-create"}, {"arguments", {{"title", 123}}}}))["result"];
    CHECK(invalid["isError"] == true);
    CHECK(body(invalid)["error"]["code"] == "VALIDATION_ERROR");
    const auto unknown =
        send(*server, request(5, "tools/call", {{"name", "note-crate"}}))["result"];
    CHECK(body(unknown)["error"]["code"] == "COMMAND_NOT_FOUND");
}

TEST_CASE("tool results carry structuredContent that satisfies the advertised outputSchema") {
    // A command with an output schema whose nested type sits in $defs.
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "note-get",
         .description = "Get a note",
         .input_schema = Json{{"type", "object"},
                              {"properties", {{"id", {{"type", "string"}}}}},
                              {"required", {"id"}}},
         .output_schema =
             Json{{"type", "object"},
                  {"properties",
                   {{"id", {{"type", "string"}}},
                    {"tags", {{"type", "array"}, {"items", {{"$ref", "#/$defs/Tag"}}}}}}},
                  {"required", {"id", "tags"}},
                  {"$defs", {{"Tag", {{"type", "string"}}}}}},
         .handler =
             [](const Json& input, afd::CommandContext&) {
                 if (input["id"] == "missing") {
                     return afd::failure(afd::CommandError{.code = "NOT_FOUND",
                                                           .message = "No such note",
                                                           .suggestion = "List notes first",
                                                           .retryable = false,
                                                           .details = std::nullopt,
                                                           .cause = nullptr});
                 }
                 return afd::success(Json{{"id", input["id"]}, {"tags", {"home"}}});
             },
         .expose = {.mcp = true}}));
    REQUIRE_FALSE(registry.register_command(
        {.name = "note-list",
         .description = "List notes",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(Json::array()); },
         .expose = {.mcp = true}}));
    auto server = make_server(registry);
    const auto tools = command_tools(send(*server, request(1, "tools/list"))["result"]["tools"]);
    REQUIRE(tools.size() == 2);
    const Json& get = tools[0]["name"] == "note-get" ? tools[0] : tools[1];
    const Json& list = tools[0]["name"] == "note-get" ? tools[1] : tools[0];
    CHECK(get["outputSchema"] == afd::command_result_output_schema(get["_meta"]["outputSchema"]));
    CHECK_FALSE(list.contains("outputSchema"));

    // The advertised schema accepts a success and a failure, as an MCP client checks it.
    const auto schema = afd::CompiledSchema::compile(get["outputSchema"]);
    REQUIRE(schema);
    const auto call = [&](std::string id) {
        return send(*server,
                    request(2, "tools/call",
                            {{"name", "note-get"}, {"arguments", {{"id", id}}}}))["result"];
    };
    const auto found = call("n-1");
    CHECK(found["isError"] == false);
    CHECK(found["structuredContent"] == body(found));
    CHECK(found["structuredContent"]["data"] == Json{{"id", "n-1"}, {"tags", {"home"}}});
    CHECK(schema->validate(found["structuredContent"]));
    const auto missing = call("missing");
    CHECK(missing["isError"] == true);
    CHECK(missing["structuredContent"]["error"]["code"] == "NOT_FOUND");
    CHECK(schema->validate(missing["structuredContent"]));
    // Data that breaks the declared schema is what a client would refuse.
    Json wrong = found["structuredContent"];
    wrong["data"]["tags"] = Json::array({1});
    CHECK_FALSE(schema->validate(wrong));

    // Every result carries structuredContent, with or without an outputSchema.
    const auto listed = send(*server, request(3, "tools/call", {{"name", "note-list"}}))["result"];
    CHECK(listed["structuredContent"] == body(listed));
    const auto unknown = send(*server, request(4, "tools/call", {{"name", "note-gte"}}))["result"];
    CHECK(unknown["structuredContent"]["error"]["code"] == "COMMAND_NOT_FOUND");

    // The top-level outputSchema can be switched off; _meta.outputSchema stays.
    auto quiet = make_server(registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                        .advertise_output_schema = false});
    const auto quiet_tools =
        command_tools(send(*quiet, request(5, "tools/list"))["result"]["tools"]);
    REQUIRE(quiet_tools.size() == 2);
    for (const auto& tool : quiet_tools) {
        CHECK_FALSE(tool.contains("outputSchema"));
        if (tool["name"] == "note-get") {
            CHECK(tool["_meta"]["outputSchema"]["required"] == Json::array({"id", "tags"}));
        }
    }
}

TEST_CASE("protocol errors") {
    Notes notes;
    auto server = make_server(*notes.registry);
    CHECK(reply(*server, "{not json")["error"]["code"] == -32700);
    CHECK(reply(*server, "[]")["error"]["code"] == -32600);
    CHECK(reply(*server, R"({"jsonrpc":"2.0","id":6})")["error"]["code"] == -32600);
    CHECK(send(*server, request(7, "resources/list"))["error"]["code"] == -32601);
}

TEST_CASE("create refuses a short state secret") {
    Notes notes;
    CHECK_FALSE(StdioServer::create(*notes.registry, {.state_secret = "short"}));
    CHECK(StdioServer::create(*notes.registry, {.state_secret = secret}));
}

TEST_CASE("tools/call never takes approval from the call") {
    Notes notes;
    auto server = make_server(*notes.registry);
    const auto held = send(*server, request(2, "tools/call", {{"name", "vault-open"}}))["result"];
    // An MCP agent never gets the token; the host's on_approval_required does.
    CHECK_FALSE(body(held)["error"]["details"].contains("approvalToken"));
    REQUIRE(notes.tokens->size() == 1);
    const std::string token = notes.tokens->front();
    // The token in the arguments or in the request's _meta is ignored: the call is held again.
    const auto again = send(*server, request(3, "tools/call",
                                             {{"name", "vault-open"},
                                              {"arguments", {{"approval", token}}},
                                              {"_meta", {{"approval", token}}}}))["result"];
    const auto error = body(again)["error"];
    CHECK(error["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(error["details"].contains("reason"));
    CHECK(*notes.opens == 0);
}

TEST_CASE("enforce: an acknowledgement runs a confirm-gated command; nothing else does") {
    Notes notes;
    auto server =
        make_server(*notes.registry, {.confirmations = ConfirmationMode::enforce,
                                      .tool_strategy = afd::mcp::ToolStrategy::individual});
    const auto tools = command_tools(send(*server, request(1, "tools/list"))["result"]["tools"]);
    for (const auto& tool : tools) {
        const bool gated = tool["name"] == "note-clear" || tool["name"] == "vault-open";
        const bool advertised = tool["inputSchema"].contains("properties") &&
                                tool["inputSchema"]["properties"].contains("confirm");
        CHECK(advertised == gated);
    }

    const auto refused =
        send(*server, request(2, "tools/call",
                              {{"name", "note-clear"}, {"arguments", {{"all", true}}}}))["result"];
    CHECK(body(refused)["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(body(refused)["error"]["message"] ==
          "'note-clear' needs confirmation: Delete every note?");
    CHECK(body(refused)["error"]["suggestion"] ==
          "Make sure the user intends this, then repeat the call with confirm: true.");
    CHECK(*notes.clears == 0);

    // `confirm` is the server's: stripped before validation, which refuses unknown keys.
    const auto acknowledged =
        send(*server, request(3, "tools/call",
                              {{"name", "note-clear"},
                               {"arguments", {{"all", true}, {"confirm", true}}}}))["result"];
    CHECK(acknowledged["isError"] == false);
    CHECK(body(acknowledged)["data"]["input"] == Json{{"all", true}});

    const auto by_meta = send(*server, request(4, "tools/call",
                                               {{"name", "note-clear"},
                                                {"arguments", Json::object()},
                                                {"_meta", {{"dev.afd/confirm", true}}}}))["result"];
    CHECK(by_meta["isError"] == false);
    CHECK(*notes.clears == 2);

    // Commands without a prompt are not gated.
    CHECK(send(*server, request(5, "tools/call", {{"name", "note-list"}}))["result"]["isError"] ==
          false);
}

TEST_CASE("require-human refuses an acknowledgement") {
    Notes notes;
    auto server =
        make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human,
                                      .tool_strategy = afd::mcp::ToolStrategy::individual});
    const auto tools = command_tools(send(*server, request(1, "tools/list"))["result"]["tools"]);
    for (const auto& tool : tools) {
        const bool advertised = tool["inputSchema"].contains("properties") &&
                                tool["inputSchema"]["properties"].contains("confirm");
        CHECK_FALSE(advertised);
    }
    const auto refused = send(*server, request(2, "tools/call",
                                               {{"name", "note-clear"},
                                                {"arguments", {{"confirm", true}}},
                                                {"_meta", {{"dev.afd/confirm", true}}}}))["result"];
    CHECK(body(refused)["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(body(refused)["error"]["suggestion"] ==
          "This server accepts only a confirmation from the user: use an MCP client that "
          "supports elicitation.");
    CHECK(*notes.clears == 0);
}

TEST_CASE("2026-07-28: a confirmation is an input_required round trip bound to the call") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    const Json input{{"all", true}};
    const auto asked = modern_call(*server, "note-clear", input, form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    const auto question = asked["inputRequests"]["confirm"];
    CHECK(question["method"] == "elicitation/create");
    CHECK(question["params"]["mode"] == "form");
    CHECK(question["params"]["message"] == "Delete every note?");
    CHECK(question["params"]["requestedSchema"]["required"] == Json::array({"confirm"}));
    const Json state = asked["requestState"];
    CHECK(*notes.clears == 0);

    SUBCASE("accepted, it runs") {
        const auto ran = modern_call(
            *server, "note-clear", input, form_elicitation,
            {{"requestState", state}, {"inputResponses", {{"confirm", accept("confirm")}}}});
        CHECK(ran["resultType"] == "complete");
        CHECK(ran["isError"] == false);
        CHECK(*notes.clears == 1);
    }
    SUBCASE("declined, it fails and must not be retried") {
        const auto declined = modern_call(
            *server, "note-clear", input, form_elicitation,
            {{"requestState", state}, {"inputResponses", {{"confirm", {{"action", "decline"}}}}}});
        CHECK(body(declined)["error"]["code"] == "CONFIRMATION_DECLINED");
        CHECK(body(declined)["error"]["retryable"] == false);
        CHECK(*notes.clears == 0);
    }
    SUBCASE("for other input, or with an altered state, it asks again") {
        const auto other = modern_call(
            *server, "note-clear", Json{{"all", false}}, form_elicitation,
            {{"requestState", state}, {"inputResponses", {{"confirm", accept("confirm")}}}});
        CHECK(other["resultType"] == "input_required");
        std::string altered = state.get<std::string>();
        altered.back() = altered.back() == 'A' ? 'B' : 'A';
        const auto tampered = modern_call(
            *server, "note-clear", input, form_elicitation,
            {{"requestState", altered}, {"inputResponses", {{"confirm", accept("confirm")}}}});
        CHECK(tampered["resultType"] == "input_required");
        CHECK(*notes.clears == 0);
    }
    SUBCASE("on another server key it asks again") {
        auto other =
            make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
        const auto again = modern_call(
            *other, "note-clear", input, form_elicitation,
            {{"requestState", state}, {"inputResponses", {{"confirm", accept("confirm")}}}});
        CHECK(again["resultType"] == "input_required");
    }
}

TEST_CASE("2026-07-28: the state is bound to the caller the context hook names") {
    Notes notes;
    auto server = make_server(
        *notes.registry,
        {.confirmations = ConfirmationMode::require_human,
         .context_hook = [](afd::CommandContext& context, const afd::mcp::RequestInfo& request) {
             context.actor->id = request.meta.value("test/user", "");
         }});
    const Json input{{"all", true}};
    const auto asked =
        modern_call(*server, "note-clear", input, form_elicitation, {}, {{"test/user", "ana"}});
    REQUIRE(asked["resultType"] == "input_required");
    const Json retry{{"requestState", asked["requestState"]},
                     {"inputResponses", {{"confirm", accept("confirm")}}}};
    CHECK(modern_call(*server, "note-clear", input, form_elicitation, retry,
                      {{"test/user", "ben"}})["resultType"] == "input_required");
    CHECK(*notes.clears == 0);
    CHECK(modern_call(*server, "note-clear", input, form_elicitation, retry,
                      {{"test/user", "ana"}})["isError"] == false);
    CHECK(*notes.clears == 1);
}

TEST_CASE("2025: a confirmation is asked in band on the connection") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::enforce});
    std::vector<Json> sent;
    Json answer = accept("confirm");
    const afd::mcp::ClientRequester ask = [&](const Json& message) -> std::optional<Json> {
        sent.push_back(message);
        return answer;
    };
    const Json call =
        request(2, "tools/call", {{"name", "note-clear"}, {"arguments", {{"all", true}}}});

    SUBCASE("2025-06-18 has no elicitation mode") {
        send(*server, request(1, "initialize",
                              {{"protocolVersion", "2025-06-18"},
                               {"capabilities", {{"elicitation", Json::object()}}}}));
        const auto ran = send(*server, call, ask)["result"];
        CHECK(ran["isError"] == false);
        CHECK_FALSE(ran.contains("resultType"));
        REQUIRE(sent.size() == 1);
        CHECK(sent[0]["method"] == "elicitation/create");
        CHECK(sent[0]["params"]["message"] == "Delete every note?");
        CHECK_FALSE(sent[0]["params"].contains("mode"));
        CHECK(*notes.clears == 1);
    }
    SUBCASE("2025-11-25 asks in form mode; a decline fails the call") {
        send(*server, request(1, "initialize",
                              {{"protocolVersion", "2025-11-25"},
                               {"capabilities", {{"elicitation", {{"form", Json::object()}}}}}}));
        answer = Json{{"action", "decline"}};
        const auto declined = send(*server, call, ask)["result"];
        REQUIRE(sent.size() == 1);
        CHECK(sent[0]["params"]["mode"] == "form");
        CHECK(body(declined)["error"]["code"] == "CONFIRMATION_DECLINED");
        CHECK(*notes.clears == 0);
    }
    SUBCASE("a client without elicitation, or no way to ask, gets the acknowledgement path") {
        send(*server, request(1, "initialize", {{"protocolVersion", "2025-11-25"}}));
        CHECK(body(send(*server, call, ask)["result"])["error"]["code"] == "CONFIRMATION_REQUIRED");
        auto elicits = make_server(*notes.registry, {.confirmations = ConfirmationMode::enforce});
        send(*elicits, request(1, "initialize",
                               {{"protocolVersion", "2025-11-25"},
                                {"capabilities", {{"elicitation", Json::object()}}}}));
        CHECK(body(send(*elicits, call)["result"])["error"]["code"] == "CONFIRMATION_REQUIRED");
        CHECK(sent.empty());
    }
}

TEST_CASE("the approval relay asks the human, and an approval works once") {
    Notes notes(afd::ApprovalRelay::mcp_elicitation);
    auto server = make_server(*notes.registry);
    const auto asked = modern_call(*server, "vault-open", Json::object(), form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    const auto question = asked["inputRequests"]["approval"];
    CHECK(question["params"]["requestedSchema"]["required"] == Json::array({"approve"}));
    CHECK(question["params"]["message"] == "Open the vault?\n\nCommand: vault-open\nInput: {}");
    CHECK(*notes.opens == 0);

    const Json retry{{"requestState", asked["requestState"]},
                     {"inputResponses", {{"approval", accept("approve")}}}};
    CHECK(modern_call(*server, "vault-open", Json::object(), form_elicitation, retry)["isError"] ==
          false);
    CHECK(*notes.opens == 1);
    // The same answer again: the nonce is spent, so the human is asked again, saying why.
    const auto replayed =
        modern_call(*server, "vault-open", Json::object(), form_elicitation, retry);
    REQUIRE(replayed["resultType"] == "input_required");
    CHECK(replayed["inputRequests"]["approval"]["params"]["message"].get<std::string>().rfind(
              "The earlier approval expired or was already used", 0) == 0);
    CHECK(*notes.opens == 1);

    const auto declined =
        modern_call(*server, "vault-open", Json::object(), form_elicitation,
                    {{"requestState", asked["requestState"]},
                     {"inputResponses",
                      {{"approval", {{"action", "accept"}, {"content", {{"approve", false}}}}}}}});
    CHECK(body(declined)["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK(body(declined)["error"]["details"]["reason"] == "declined");
    CHECK(*notes.opens == 1);

    // Without elicitation, the hold is returned without a token, saying how to be asked.
    const auto held = modern_call(*server, "vault-open", Json::object(), Json::object());
    CHECK(body(held)["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(body(held)["error"]["details"].contains("reason"));
    CHECK_FALSE(body(held)["error"]["details"].contains("approvalToken"));
    CHECK(body(held)["error"]["suggestion"].get<std::string>().find(
              "Call vault-open from an MCP client that supports form elicitation") !=
          std::string::npos);
}

TEST_CASE("one state carries a confirmation and then an approval") {
    Notes notes(afd::ApprovalRelay::mcp_elicitation);
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    const auto first = modern_call(*server, "vault-open", Json::object(), form_elicitation);
    REQUIRE(first["inputRequests"].contains("confirm"));
    const auto second = modern_call(*server, "vault-open", Json::object(), form_elicitation,
                                    {{"requestState", first["requestState"]},
                                     {"inputResponses", {{"confirm", accept("confirm")}}}});
    REQUIRE(second["resultType"] == "input_required");
    REQUIRE(second["inputRequests"].contains("approval"));
    CHECK(*notes.opens == 0);
    const auto ran = modern_call(*server, "vault-open", Json::object(), form_elicitation,
                                 {{"requestState", second["requestState"]},
                                  {"inputResponses", {{"approval", accept("approve")}}}});
    CHECK(ran["isError"] == false);
    CHECK(*notes.opens == 1);
}

TEST_CASE("2025: both questions are asked in band, in turn") {
    Notes notes(afd::ApprovalRelay::mcp_elicitation);
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    send(*server, request(1, "initialize",
                          {{"protocolVersion", "2025-11-25"},
                           {"capabilities", {{"elicitation", Json::object()}}}}));
    std::vector<std::string> fields;
    const afd::mcp::ClientRequester ask = [&](const Json& message) -> std::optional<Json> {
        const auto& properties = message["params"]["requestedSchema"]["properties"];
        fields.push_back(properties.begin().key());
        return accept(fields.back());
    };
    const auto ran =
        send(*server, request(2, "tools/call", {{"name", "vault-open"}}), ask)["result"];
    CHECK(ran["isError"] == false);
    CHECK(fields == std::vector<std::string>{"confirm", "approve"});
    CHECK(*notes.opens == 1);
}

TEST_CASE("a command run by another command's handler never claims the relay") {
    Notes notes(afd::ApprovalRelay::mcp_elicitation);
    afd::CommandRegistry* registry = notes.registry.get();
    REQUIRE_FALSE(notes.registry->register_command(
        {.name = "vault-proxy",
         .description = "Open the vault through another command",
         .handler =
             [registry](const Json&, afd::CommandContext& context) {
                 return registry->execute("vault-open", Json::object(), context);
             },
         .expose = {.mcp = true}}));
    auto server = make_server(*notes.registry);
    const auto result = modern_call(*server, "vault-proxy", Json::object(), form_elicitation);
    CHECK(result["resultType"] == "complete");
    CHECK(body(result)["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(body(result)["error"]["details"].contains("approvalToken"));
    CHECK(body(result)["error"]["suggestion"].get<std::string>().find(
              "Call vault-open on its own so the client can ask the user") != std::string::npos);
    CHECK(*notes.opens == 0);
}

TEST_CASE("an answer to one question never answers the other") {
    Notes notes(afd::ApprovalRelay::mcp_elicitation);
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    const auto first = modern_call(*server, "vault-open", Json::object(), form_elicitation);
    REQUIRE(first["inputRequests"].contains("confirm"));
    // An approval offered for the pending confirmation: the confirmation is asked again.
    const auto again = modern_call(*server, "vault-open", Json::object(), form_elicitation,
                                   {{"requestState", first["requestState"]},
                                    {"inputResponses", {{"approval", accept("approve")}}}});
    REQUIRE(again["resultType"] == "input_required");
    CHECK(again["inputRequests"].contains("confirm"));
    // A confirmation offered for a pending approval is not an approval.
    const auto second = modern_call(*server, "vault-open", Json::object(), form_elicitation,
                                    {{"requestState", first["requestState"]},
                                     {"inputResponses", {{"confirm", accept("confirm")}}}});
    REQUIRE(second["inputRequests"].contains("approval"));
    const auto wrong = modern_call(*server, "vault-open", Json::object(), form_elicitation,
                                   {{"requestState", second["requestState"]},
                                    {"inputResponses", {{"confirm", accept("confirm")}}}});
    CHECK(wrong["resultType"] == "input_required");
    CHECK(wrong["inputRequests"].contains("approval"));
    CHECK(*notes.opens == 0);
}

TEST_CASE("an approval's state is bound to the caller") {
    Notes notes(afd::ApprovalRelay::mcp_elicitation);
    auto server = make_server(
        *notes.registry,
        {.context_hook = [](afd::CommandContext& context, const afd::mcp::RequestInfo& request) {
            context.actor->id =
                request.meta.contains("test/user") && request.meta["test/user"].is_string()
                    ? request.meta["test/user"].get<std::string>()
                    : std::string();
        }});
    const auto asked = modern_call(*server, "vault-open", Json::object(), form_elicitation, {},
                                   {{"test/user", "ana"}});
    REQUIRE(asked["inputRequests"].contains("approval"));
    const Json retry{{"requestState", asked["requestState"]},
                     {"inputResponses", {{"approval", accept("approve")}}}};
    CHECK(modern_call(*server, "vault-open", Json::object(), form_elicitation, retry,
                      {{"test/user", "ben"}})["resultType"] == "input_required");
    CHECK(*notes.opens == 0);
}

TEST_CASE("client fields of the wrong type are refused, never a crash") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    CHECK(reply(*server, R"({"jsonrpc":"2.0","id":1,"method":1})")["error"]["code"] == -32600);
    const auto asked = modern_call(*server, "note-clear", Json::object(), form_elicitation);
    REQUIRE(asked["resultType"] == "input_required");
    // An answer that is not a clear "accept, confirm: true" is not a confirmation: the call is
    // declined. A response that is not even an object is no answer, and it is asked again.
    for (const Json& answer : {Json{{"action", 5}}, Json{{"action", "accept"}, {"content", "yes"}},
                               Json{{"action", "accept"}, {"content", {{"confirm", "true"}}}}}) {
        const auto retried = modern_call(
            *server, "note-clear", Json::object(), form_elicitation,
            {{"requestState", asked["requestState"]}, {"inputResponses", {{"confirm", answer}}}});
        CHECK(body(retried)["error"]["code"] == "CONFIRMATION_DECLINED");
    }
    const auto not_an_answer = modern_call(
        *server, "note-clear", Json::object(), form_elicitation,
        {{"requestState", asked["requestState"]}, {"inputResponses", {{"confirm", 7}}}});
    CHECK(not_an_answer["resultType"] == "input_required");
    CHECK(*notes.clears == 0);
    // In serve, the reader thread reads them too.
    std::istringstream in("{\"jsonrpc\":\"2.0\",\"method\":1}\n"
                          "{\"jsonrpc\":\"2.0\",\"method\":{\"x\":1},\"params\":[]}\n"
                          "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n");
    std::ostringstream out;
    server->serve(in, out);
    CHECK(out.str().find("\"id\":2") != std::string::npos);
}

TEST_CASE("serve answers each request line and stops at EOF") {
    Notes notes;
    auto server = make_server(*notes.registry);
    std::istringstream in("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n"
                          "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\r\n"
                          "\n"
                          "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/"
                          "call\",\"params\":{\"name\":\"note-list\"}}");
    std::ostringstream out;
    server->serve(in, out);
    std::istringstream lines(out.str());
    std::string first;
    std::string second;
    std::string third;
    std::getline(lines, first);
    std::getline(lines, second);
    CHECK_FALSE(std::getline(lines, third));
    CHECK(Json::parse(first)["id"] == 1);
    CHECK(Json::parse(second)["id"] == 2);
}

TEST_CASE("an oversized line is rejected without buffering it") {
    Notes notes;
    auto server = make_server(*notes.registry, {.max_line_bytes = 1024});
    std::istringstream in(std::string(2048, 'x') +
                          "\n{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}\n");
    std::ostringstream out;
    server->serve(in, out);
    std::istringstream lines(out.str());
    std::string first;
    std::string second;
    std::getline(lines, first);
    std::getline(lines, second);
    CHECK(Json::parse(first)["error"]["message"] == "Message too large");
    CHECK(Json::parse(second)["id"] == 9);
}

namespace {

/// A blocking pipe for `serve`: the test writes the client's lines when it chooses, and reads what
/// the server wrote, so an answer is sent only after its question, as a real client sends it.
class ClientPipe {
public:
    ClientPipe() : in_(&input_), out_(&output_) {}

    std::istream& in() { return in_; }
    std::ostream& out() { return out_; }

    void send(std::string_view line) { input_.push(std::string(line) + "\n"); }
    void close() { input_.close(); }
    bool wait_drained() { return input_.wait_drained(); }

    /// Waits up to five seconds for the server to write `text`.
    bool wait_for(std::string_view text) { return output_.wait_for(text); }
    std::vector<Json> written() { return output_.lines(); }

private:
    class Input : public std::streambuf {
    public:
        void push(std::string text) {
            const std::lock_guard lock(mutex_);
            data_ += text;
            changed_.notify_all();
        }
        void close() {
            const std::lock_guard lock(mutex_);
            closed_ = true;
            changed_.notify_all();
        }
        bool wait_drained() {
            std::unique_lock lock(mutex_);
            return drained_.wait_for(lock, std::chrono::seconds(5),
                                     [&] { return position_ >= data_.size() || closed_; });
        }

    protected:
        int_type underflow() override {
            std::unique_lock lock(mutex_);
            changed_.wait(lock, [&] { return position_ < data_.size() || closed_; });
            if (position_ >= data_.size()) {
                drained_.notify_all();
                return traits_type::eof();
            }
            current_ = data_[position_++];
            if (position_ >= data_.size()) {
                drained_.notify_all();
            }
            setg(&current_, &current_, &current_ + 1);
            return traits_type::to_int_type(current_);
        }

    private:
        std::mutex mutex_;
        std::condition_variable changed_;
        std::condition_variable drained_;
        std::string data_;
        std::size_t position_ = 0;
        bool closed_ = false;
        char current_ = 0;
    };

    class Output : public std::streambuf {
    public:
        bool wait_for(std::string_view text) {
            std::unique_lock lock(mutex_);
            return changed_.wait_for(lock, std::chrono::seconds(5),
                                     [&] { return text_.find(text) != std::string::npos; });
        }
        std::vector<Json> lines() {
            const std::lock_guard lock(mutex_);
            std::vector<Json> parsed;
            std::istringstream stream(text_);
            for (std::string line; std::getline(stream, line);) {
                parsed.push_back(Json::parse(line));
            }
            return parsed;
        }

    protected:
        int_type overflow(int_type c) override {
            if (c != traits_type::eof()) {
                const std::lock_guard lock(mutex_);
                text_.push_back(traits_type::to_char_type(c));
                changed_.notify_all();
            }
            return c;
        }

    private:
        std::mutex mutex_;
        std::condition_variable changed_;
        std::string text_;
    };

    Input input_;
    Output output_;
    std::istream in_;
    std::ostream out_;
};

constexpr std::string_view initialize_with_elicitation =
    R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{}}}})";
constexpr std::string_view clear_call =
    R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note-clear","arguments":{"all":true}}})";

} // namespace

TEST_CASE("serve asks a 2025 client in band and reads its answer") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    ClientPipe pipe;
    std::thread serving([&] { server->serve(pipe.in(), pipe.out()); });
    pipe.send(initialize_with_elicitation);
    pipe.send(clear_call);
    const bool asked = pipe.wait_for("elicitation/create");
    pipe.send(
        R"({"jsonrpc":"2.0","id":"afd-elicitation-1","result":{"action":"accept","content":{"confirm":true}}})");
    const bool answered = pipe.wait_for(R"("id":2)");
    pipe.close();
    serving.join();
    CHECK(asked);
    CHECK(answered);
    const auto written = pipe.written();
    REQUIRE(written.size() == 3);
    CHECK(written[1]["id"] == "afd-elicitation-1");
    CHECK(written[2]["result"]["isError"] == false);
    CHECK(*notes.clears == 1);
}

TEST_CASE("an answer sent before its question is dropped") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    // The whole input, a pre-answer included, is read at once; the question is then asked of a
    // client that has gone away, so the call fails as unanswered and nothing runs.
    std::istringstream in(
        std::string(initialize_with_elicitation) + "\n" +
        R"({"jsonrpc":"2.0","id":"afd-elicitation-1","result":{"action":"accept","content":{"confirm":true}}})"
        "\n" +
        std::string(clear_call) + "\n");
    std::ostringstream out;
    server->serve(in, out);
    CHECK(out.str().find("The client did not answer the confirmation question") !=
          std::string::npos);
    CHECK(*notes.clears == 0);
}

TEST_CASE("an unanswered question times out and the connection goes on") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human,
                                                .elicitation_timeout_ms = 100});
    ClientPipe pipe;
    std::thread serving([&] { server->serve(pipe.in(), pipe.out()); });
    pipe.send(initialize_with_elicitation);
    pipe.send(clear_call);
    pipe.send(R"({"jsonrpc":"2.0","id":3,"method":"ping"})");
    const bool pinged = pipe.wait_for(R"("id":3)");
    pipe.close();
    serving.join();
    CHECK(pinged);
    const auto written = pipe.written();
    REQUIRE(written.size() == 4);
    CHECK(written[2]["id"] == 2);
    CHECK(body(written[2]["result"])["error"]["code"] == "CONFIRMATION_REQUIRED");
    CHECK(*notes.clears == 0);
}

TEST_CASE("a call cancelled while its question waits is not answered") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    ClientPipe pipe;
    std::thread serving([&] { server->serve(pipe.in(), pipe.out()); });
    pipe.send(initialize_with_elicitation);
    pipe.send(clear_call);
    const bool asked = pipe.wait_for("elicitation/create");
    pipe.send(R"({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}})");
    pipe.send(R"({"jsonrpc":"2.0","id":3,"method":"ping"})");
    const bool pinged = pipe.wait_for(R"("id":3)");
    pipe.close();
    serving.join();
    CHECK(asked);
    CHECK(pinged);
    for (const auto& line : pipe.written()) {
        CHECK(line["id"] != 2);
    }
    CHECK(*notes.clears == 0);
}

TEST_CASE("notifications/cancelled cancels the call it names, which gets no reply") {
    auto started = std::make_shared<std::atomic<bool>>(false);
    auto saw_cancel = std::make_shared<std::atomic<bool>>(false);
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "job-wait",
         .description = "Wait until cancelled",
         .handler =
             [started, saw_cancel](const Json&, afd::CommandContext& context) {
                 started->store(true, std::memory_order_release);
                 const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
                 while (!context.cancellation.is_cancelled() &&
                        std::chrono::steady_clock::now() < deadline) {
                     std::this_thread::sleep_for(std::chrono::milliseconds(1));
                 }
                 *saw_cancel = context.cancellation.is_cancelled();
                 return afd::success(nullptr);
             },
         .expose = {.mcp = true}}));
    auto server = make_server(registry);
    ClientPipe pipe;
    std::thread serving([&] { server->serve(pipe.in(), pipe.out()); });
    struct PipeGuard {
        ClientPipe& pipe;
        std::thread& thread;
        ~PipeGuard() {
            pipe.close();
            if (thread.joinable()) {
                thread.join();
            }
        }
    } const guard{pipe, serving};
    pipe.send(R"({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"job-wait"}})");
    const auto wait_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (!started->load(std::memory_order_acquire) &&
           std::chrono::steady_clock::now() < wait_deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    REQUIRE(started->load(std::memory_order_acquire));
    pipe.send(R"({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}})");
    pipe.send(R"({"jsonrpc":"2.0","id":8,"method":"ping"})");
    const bool pinged = pipe.wait_for(R"("id":8)");
    pipe.close();
    serving.join();
    CHECK(pinged);
    CHECK(*saw_cancel);
    for (const auto& line : pipe.written()) {
        CHECK(line["id"] != 7);
    }
}

TEST_CASE("a queued request cancelled before it starts never runs its handler (#1766)") {
    auto first_started = std::make_shared<std::atomic<bool>>(false);
    auto release_first = std::make_shared<std::atomic<bool>>(false);
    auto queued_ran = std::make_shared<std::atomic<bool>>(false);
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "job-block",
         .description = "Block until released",
         .handler =
             [first_started, release_first](const Json&, afd::CommandContext&) {
                 first_started->store(true, std::memory_order_release);
                 const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
                 while (!release_first->load(std::memory_order_acquire) &&
                        std::chrono::steady_clock::now() < deadline) {
                     std::this_thread::sleep_for(std::chrono::milliseconds(1));
                 }
                 return afd::success(Json{{"blocked", true}});
             },
         .expose = {.mcp = true}}));
    REQUIRE_FALSE(
        registry.register_command({.name = "job-delete",
                                   .description = "Mutation that never polls cancellation",
                                   .handler =
                                       [queued_ran](const Json&, afd::CommandContext&) {
                                           queued_ran->store(true, std::memory_order_release);
                                           return afd::success(Json{{"deleted", true}});
                                       },
                                   .mutation = true,
                                   .expose = {.mcp = true}}));
    auto server = make_server(registry);
    ClientPipe pipe;
    std::thread serving([&] { server->serve(pipe.in(), pipe.out()); });
    struct PipeGuard {
        ClientPipe& pipe;
        std::shared_ptr<std::atomic<bool>> release;
        std::thread& thread;
        ~PipeGuard() {
            release->store(true, std::memory_order_release);
            pipe.close();
            if (thread.joinable()) {
                thread.join();
            }
        }
    } const guard{pipe, release_first, serving};
    pipe.send(R"({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"job-block"}})");
    const auto wait_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (!first_started->load(std::memory_order_acquire) &&
           std::chrono::steady_clock::now() < wait_deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    REQUIRE(first_started->load(std::memory_order_acquire));
    // Queue id 2 while id 1 is still running, cancel id 2, then queue id 3 behind it.
    // Waiting for the reader thread to drain the pipe through id 3 guarantees route() has
    // already processed id 2 and its cancellation before we release id 1.
    pipe.send(R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"job-delete"}})");
    pipe.send(R"({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}})");
    pipe.send(R"({"jsonrpc":"2.0","id":3,"method":"ping"})");
    REQUIRE(pipe.wait_drained());
    release_first->store(true, std::memory_order_release);
    const bool pinged = pipe.wait_for(R"("id":3)");
    pipe.close();
    serving.join();
    CHECK(pinged);
    CHECK_FALSE(queued_ran->load(std::memory_order_acquire));
    bool saw_1 = false;
    bool saw_3 = false;
    for (const auto& line : pipe.written()) {
        CHECK(line["id"] != 2);
        saw_1 = saw_1 || line["id"] == 1;
        saw_3 = saw_3 || line["id"] == 3;
    }
    CHECK(saw_1);
    CHECK(saw_3);
}

TEST_CASE("StdioServerOptions::default_timeout_ms validates, enforces, overrides, and guards "
          "confirmation (#1766)") {
    auto clock = std::make_shared<afd::ManualClock>();
    int confirmed_runs = 0;
    afd::CommandRegistry registry({.clock = clock});
    REQUIRE_FALSE(
        registry.register_command({.name = "job-slow",
                                   .description = "Advances clock without polling cancellation",
                                   .handler =
                                       [clock](const Json&, afd::CommandContext&) {
                                           clock->advance(50);
                                           return afd::success(Json{{"done", true}});
                                       },
                                   .expose = {.mcp = true}}));
    REQUIRE_FALSE(
        registry.register_command({.name = "job-confirm",
                                   .description = "Requires confirmation",
                                   .handler =
                                       [&confirmed_runs](const Json&, afd::CommandContext&) {
                                           ++confirmed_runs;
                                           return afd::success(Json{{"ran", true}});
                                       },
                                   .mutation = true,
                                   .confirm_prompt = "Run job-confirm?",
                                   .expose = {.mcp = true}}));

    // Negative and non-finite defaults fail creation.
    CHECK_FALSE(afd::mcp::StdioServer::create(registry, {.default_timeout_ms = -1.0}).has_value());
    CHECK_FALSE(afd::mcp::StdioServer::create(
                    registry, {.default_timeout_ms = std::numeric_limits<double>::infinity()})
                    .has_value());
    CHECK_FALSE(afd::mcp::StdioServer::create(
                    registry, {.default_timeout_ms = std::numeric_limits<double>::quiet_NaN()})
                    .has_value());

    const std::string call =
        R"({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"job-slow"}})";

    // Positive default_timeout_ms times out a late handler that never polls cancellation.
    auto timed =
        afd::mcp::StdioServer::create(registry, {.clock = clock, .default_timeout_ms = 25});
    REQUIRE(timed.has_value());
    const auto timed_reply = (*timed)->handle_message(call);
    REQUIRE(timed_reply.has_value());
    const Json timed_body = body(Json::parse(*timed_reply)["result"]);
    CHECK_FALSE(timed_body["success"].get<bool>());
    CHECK(timed_body["error"]["code"] == "TIMEOUT");

    // 0 and std::nullopt both disable the default deadline.
    for (const std::optional<double> disabled :
         {std::optional<double>(0.0), std::optional<double>(std::nullopt)}) {
        auto unlimited = afd::mcp::StdioServer::create(
            registry, {.clock = clock, .default_timeout_ms = disabled});
        REQUIRE(unlimited.has_value());
        const auto ok_reply = (*unlimited)->handle_message(call);
        REQUIRE(ok_reply.has_value());
        CHECK(body(Json::parse(*ok_reply)["result"])["success"].get<bool>());
    }

    // context_hook can override default_timeout_ms (both tightening and disabling with 0).
    auto tightened = afd::mcp::StdioServer::create(
        registry, {.clock = clock,
                   .context_hook = [](afd::CommandContext& ctx,
                                      const afd::mcp::RequestInfo&) { ctx.timeout_ms = 10.0; },
                   .default_timeout_ms = 500.0});
    REQUIRE(tightened.has_value());
    const auto tight_reply = (*tightened)->handle_message(call);
    REQUIRE(tight_reply.has_value());
    const Json tight_body = body(Json::parse(*tight_reply)["result"]);
    CHECK_FALSE(tight_body["success"].get<bool>());
    CHECK(tight_body["error"]["code"] == "TIMEOUT");
    CHECK(tight_body["error"]["details"]["timeoutMs"] == 10);

    auto disabled_by_hook = afd::mcp::StdioServer::create(
        registry, {.clock = clock,
                   .context_hook = [](afd::CommandContext& ctx,
                                      const afd::mcp::RequestInfo&) { ctx.timeout_ms = 0.0; },
                   .default_timeout_ms = 10.0});
    REQUIRE(disabled_by_hook.has_value());
    const auto hook_ok = (*disabled_by_hook)->handle_message(call);
    REQUIRE(hook_ok.has_value());
    CHECK(body(Json::parse(*hook_ok)["result"])["success"].get<bool>());

    // 2025 in-band confirmation answered affirmatively AFTER default_timeout_ms expires must
    // return TIMEOUT and never invoke the mutation handler.
    auto confirm_server =
        afd::mcp::StdioServer::create(registry, {.confirmations = ConfirmationMode::require_human,
                                                 .clock = clock,
                                                 .default_timeout_ms = 25.0});
    REQUIRE(confirm_server.has_value());
    REQUIRE((*confirm_server)->handle_message(initialize_with_elicitation).has_value());
    const std::string confirm_call =
        R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"job-confirm"}})";
    const auto late_confirm =
        (*confirm_server)
            ->handle_message(confirm_call, [clock](const Json&) -> std::optional<Json> {
                clock->advance(30);
                return Json{{"action", "accept"}, {"content", {{"confirm", true}}}};
            });
    REQUIRE(late_confirm.has_value());
    const Json confirm_body = body(Json::parse(*late_confirm)["result"]);
    CHECK_FALSE(confirm_body["success"].get<bool>());
    CHECK(confirm_body["error"]["code"] == "TIMEOUT");
    CHECK(confirmed_runs == 0);
}

// --- Contexts (spec/tool-strategies.md, "Contexts") ---------------------------------------------

namespace {

/// Notes with two contexts: `note-clear` only while editing.
struct ScopedNotes {
    std::shared_ptr<afd::CommandRegistry> registry = std::make_shared<afd::CommandRegistry>();
    std::vector<afd::ContextConfig> contexts{{.name = "reading"}, {.name = "editing"}};

    ScopedNotes() {
        REQUIRE_FALSE(afd::register_context_commands(*registry, contexts));
        const auto ok = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); };
        REQUIRE_FALSE(registry->register_command({.name = "note-list",
                                                  .description = "List notes",
                                                  .handler = ok,
                                                  .contexts = {"reading", "editing"},
                                                  .expose = {.mcp = true}}));
        REQUIRE_FALSE(registry->register_command({.name = "note-clear",
                                                  .description = "Delete every note",
                                                  .handler = ok,
                                                  .contexts = {"editing"},
                                                  .mutation = true,
                                                  .confirm_prompt = "Delete every note?",
                                                  .expose = {.mcp = true}}));
    }
};

/// The names of a list's command tools.
std::vector<std::string> names(const Json& tools) {
    std::vector<std::string> out;
    for (const auto& tool : command_tools(tools)) {
        out.push_back(tool["name"].get<std::string>());
    }
    return out;
}

Json context_meta(std::string_view name) {
    Json meta = modern_meta();
    meta["dev.afd/context"] = std::string(name);
    return meta;
}

} // namespace

TEST_CASE("create refuses contexts whose commands are not registered") {
    Notes notes;
    auto refused = StdioServer::create(*notes.registry, {.contexts = {{.name = "reading"}}});
    REQUIRE_FALSE(refused);
    CHECK(refused.error().find("register_context_commands") != std::string::npos);
    CHECK_FALSE(StdioServer::create(*notes.registry, {.tools_list_ttl_ms = -1}));
}

TEST_CASE("create never runs a gated afd-context-list to check the contexts (#1886)") {
    afd::CommandRegistry registry;
    const std::vector<afd::ContextConfig> contexts{{.name = "reading"}};
    auto listed = std::make_shared<int>(0);
    for (auto command : afd::context_commands(contexts)) {
        if (command.name == "afd-context-list") {
            command.approval = afd::ApprovalDecision::required;
            command.handler = [listed, inner = std::move(command.handler)](
                                  const Json& input, afd::CommandContext& context) {
                ++*listed;
                return inner(input, context);
            };
        }
        REQUIRE_FALSE(registry.register_command(std::move(command)));
    }
    auto refused = StdioServer::create(registry, {.contexts = contexts});
    CHECK(*listed == 0);
    REQUIRE_FALSE(refused);
    if (!refused) {
        CHECK(refused.error().find("afd-context-list declares an approval policy") !=
              std::string::npos);
    }
}

TEST_CASE("2025: the connection keeps a context stack that scopes tools/list and tools/call") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human,
                                                .tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts});
    send(*server, request(0, "initialize", {{"protocolVersion", "2025-11-25"}}));
    const std::vector<std::string> every{"afd-context-list", "afd-context-enter",
                                         "afd-context-exit", "note-list", "note-clear"};
    CHECK(names(send(*server, request(1, "tools/list"))["result"]["tools"]) == every);

    const auto entered = send(
        *server, request(2, "tools/call",
                         {{"name", "afd-context-enter"}, {"arguments", {{"context", "reading"}}}}));
    CHECK(body(entered["result"])["data"]["entered"] == "reading");
    CHECK(names(send(*server, request(3, "tools/list"))["result"]["tools"]) ==
          std::vector<std::string>{"afd-context-list", "afd-context-enter", "afd-context-exit",
                                   "note-list"});

    // Refused before anyone is asked to confirm it.
    bool asked = false;
    const auto refused = send(
        *server, request(4, "tools/call", {{"name", "note-clear"}, {"arguments", Json::object()}}),
        [&](const Json&) -> std::optional<Json> {
            asked = true;
            return accept("confirm");
        });
    CHECK_FALSE(asked);
    CHECK(body(refused["result"])["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
    CHECK(body(refused["result"])["error"]["suggestion"] ==
          "Use afd-context-list to see available contexts, or afd-context-enter to switch.");

    send(*server,
         request(5, "tools/call", {{"name", "afd-context-exit"}, {"arguments", Json::object()}}));
    CHECK(names(send(*server, request(6, "tools/list"))["result"]["tools"]) == every);
}

TEST_CASE("2026-07-28: each request names its context in _meta, and nothing persists") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.name = "notes",
                                                .tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts});
    const auto discover =
        send(*server, request("d", "server/discover", {{"_meta", modern_meta()}}));
    CHECK(discover["result"]["ttlMs"] == 0);
    CHECK(discover["result"]["instructions"].get<std::string>().find(
              "Commands are scoped by context (afd-context-list lists them). Send "
              "_meta[\"dev.afd/context\"] with a context name on tools/list and tools/call to "
              "work in that context.") != std::string::npos);

    const auto reading =
        send(*server, request(1, "tools/list", {{"_meta", context_meta("reading")}}));
    CHECK(reading["result"]["ttlMs"] == 0);
    CHECK(names(reading["result"]["tools"]).back() == "note-list");

    const auto refused = modern_call(*server, "note-clear", Json::object(), {}, Json::object(),
                                     {{"dev.afd/context", "reading"}});
    CHECK(body(refused)["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");

    const auto entered = modern_call(*server, "afd-context-enter", {{"context", "editing"}}, {},
                                     Json::object(), {{"dev.afd/context", "reading"}});
    CHECK(body(entered)["data"] ==
          Json{{"entered", "editing"}, {"previous", "reading"}, {"persisted", false}});
    // Still five tools with no context named: nothing was stored.
    CHECK(names(send(*server,
                     request(2, "tools/list", {{"_meta", modern_meta()}}))["result"]["tools"])
              .size() == 5);

    const auto listed = modern_call(*server, "afd-context-list", Json::object(), {}, Json::object(),
                                    {{"dev.afd/context", "editing"}});
    CHECK(body(listed)["data"]["activeContext"] == "editing");
}

TEST_CASE("2026-07-28: an unknown context in _meta is invalid params") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts});
    for (const Json& name : {Json("nowhere"), Json(7)}) {
        Json meta = modern_meta();
        meta["dev.afd/context"] = name;
        const auto list = send(*server, request(1, "tools/list", {{"_meta", meta}}));
        CHECK(list["error"]["code"] == -32602);
        CHECK(list["error"]["message"] == "Unknown context in _meta[\"dev.afd/context\"]");
        CHECK(list["error"]["data"]["suggestion"] == "Use one of: reading, editing");
        const auto call =
            send(*server,
                 request(2, "tools/call",
                         {{"name", "note-list"}, {"arguments", Json::object()}, {"_meta", meta}}));
        CHECK(call["error"]["code"] == -32602);
    }
}

TEST_CASE("a set tools_list_ttl_ms wins over the contexts default") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts,
                                                .tools_list_ttl_ms = 1234});
    CHECK(send(*server, request(1, "tools/list", {{"_meta", modern_meta()}}))["result"]["ttlMs"] ==
          1234);
}

TEST_CASE("create refuses server contexts that differ from the registered ones") {
    ScopedNotes notes;
    CHECK_FALSE(StdioServer::create(*notes.registry, {.contexts = {{.name = "reading"}}}));
    CHECK_FALSE(
        StdioServer::create(*notes.registry, {.contexts = {{.name = "reading"}, {.name = ""}}}));
    CHECK_FALSE(StdioServer::create(
        *notes.registry,
        {.contexts = {{.name = "reading"}, {.name = "editing"}, {.name = "reading"}}}));
    CHECK(StdioServer::create(*notes.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts}));
}

TEST_CASE("2026-07-28: a confirm-gated command outside the context is refused, not asked") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human,
                                                .tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts});
    const auto refused = modern_call(*server, "note-clear", Json::object(), form_elicitation,
                                     Json::object(), {{"dev.afd/context", "reading"}});
    CHECK(refused["resultType"] == "complete");
    CHECK(body(refused)["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
}

TEST_CASE("2025: _meta[\"dev.afd/context\"] is ignored; the connection's stack decides") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts});
    send(*server, request(0, "initialize", {{"protocolVersion", "2025-11-25"}}));
    const auto listed =
        send(*server, request(1, "tools/list", {{"_meta", {{"dev.afd/context", "nowhere"}}}}));
    CHECK(names(listed["result"]["tools"]).size() == 5);
}

TEST_CASE("the context hook sees the active context but cannot change the scope") {
    ScopedNotes notes;
    std::optional<std::string> seen;
    auto server = make_server(
        *notes.registry,
        {.tool_strategy = afd::mcp::ToolStrategy::individual,
         .contexts = notes.contexts,
         .context_hook = [&](afd::CommandContext& context, const afd::mcp::RequestInfo& info) {
             seen = info.active_context;
             context.active_context.reset();
             context.context_scope.reset();
         }});
    const auto refused = modern_call(*server, "note-clear", Json::object(), {}, Json::object(),
                                     {{"dev.afd/context", "reading"}});
    CHECK(seen == "reading");
    CHECK(body(refused)["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
}

TEST_CASE("server/discover never reads a context; without contexts nothing changes") {
    ScopedNotes notes;
    auto server = make_server(*notes.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                                .contexts = notes.contexts});
    Json meta = modern_meta();
    meta["dev.afd/context"] = "nowhere";
    CHECK(send(*server, request(1, "server/discover", {{"_meta", meta}}))["result"]["resultType"] ==
          "complete");

    Notes plain;
    auto without = make_server(*plain.registry, {.name = "notes"});
    const auto discover = send(*without, request(2, "server/discover", {{"_meta", modern_meta()}}));
    CHECK(discover["result"]["ttlMs"] == 300000);
    CHECK(discover["result"]["instructions"] ==
          "notes is an AFD server. Every tool returns a CommandResult as JSON text: { success, "
          "data, error: { code, message, suggestion } }; follow error.suggestion to recover. "
          "Each tool groups related commands: pass { action, params }. afd-detail returns a "
          "command schema; afd-call runs any command by name. Use afd-batch for several "
          "independent commands and afd-pipe to chain them.");
}

TEST_CASE("server/discover says the bootstrap tools describe the server, once all three serve") {
    Notes notes;
    REQUIRE_FALSE(afd::register_bootstrap_commands(*notes.registry));
    auto server = make_server(*notes.registry, {.name = "notes"});
    const auto discover = send(*server, request(1, "server/discover", {{"_meta", modern_meta()}}));
    CHECK(discover["result"]["instructions"] ==
          "notes is an AFD server. Every tool returns a CommandResult as JSON text: { success, "
          "data, error: { code, message, suggestion } }; follow error.suggestion to recover. "
          "Each tool groups related commands: pass { action, params }. afd-detail returns a "
          "command schema; afd-call runs any command by name. Use afd-batch for several "
          "independent commands and afd-pipe to chain them. afd-help, afd-docs and afd-schema "
          "describe this server.");
    // Grouped: the bootstrap commands are the `bootstrap` group.
    const auto listed = send(*server, request(2, "tools/list"))["result"]["tools"];
    CHECK(names(listed) == std::vector<std::string>{"note", "vault", "bootstrap"});

    // An unknown command now points to afd-help, which the caller can call.
    const auto unknown =
        body(send(*server, request(3, "tools/call", {{"name", "note-craete"}}))["result"]);
    CHECK(unknown["error"]["suggestion"] == "Did you mean 'note-create'? Other close matches: "
                                            "'note-clear', 'note-list'. Use afd-discover to list "
                                            "all commands.");

    // Two of three is not the bootstrap tools.
    afd::CommandRegistry partial;
    for (auto& command : afd::bootstrap_commands(partial)) {
        if (command.name != "afd-schema") {
            REQUIRE_FALSE(partial.register_command(std::move(command)));
        }
    }
    auto without = make_server(partial, {.name = "notes"});
    const auto partial_discover =
        send(*without, request(4, "server/discover", {{"_meta", modern_meta()}}));
    CHECK(partial_discover["result"]["instructions"].get<std::string>().find("afd-help") ==
          std::string::npos);
}

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
TEST_CASE("StdioServer catches throwing context_hook and group_by and joins reader on stream throw "
          "(#1718)") {
    Notes notes;
    {
        auto server =
            make_server(*notes.registry,
                        {.context_hook = [](afd::CommandContext&, const afd::mcp::RequestInfo&) {
                            throw std::runtime_error("hook boom");
                        }});
        std::istringstream in(
            request(1, "tools/call", {{"name", "note-list"}, {"arguments", Json::object()}})
                .dump() +
            "\n" + request(2, "ping").dump() + "\n");
        std::ostringstream out;
        server->serve(in, out);

        std::istringstream lines(out.str());
        std::string first_line;
        std::string second_line;
        REQUIRE(std::getline(lines, first_line));
        REQUIRE(std::getline(lines, second_line));
        const Json first = Json::parse(first_line);
        const Json second = Json::parse(second_line);
        CHECK(first["id"] == 1);
        CHECK(first["error"]["code"] == -32603);
        CHECK(first["error"]["message"] == "Internal error");
        CHECK(second["id"] == 2);
        CHECK(second["result"] == Json::object());
    }

    {
        auto server = make_server(
            *notes.registry,
            {.group_by = [](const afd::CommandDefinition&) -> std::optional<std::string> {
                throw std::runtime_error("group boom");
            }});
        std::istringstream in(request(10, "tools/list").dump() + "\n" + request(11, "ping").dump() +
                              "\n");
        std::ostringstream out;
        server->serve(in, out);

        std::istringstream lines(out.str());
        std::string first_line;
        std::string second_line;
        REQUIRE(std::getline(lines, first_line));
        REQUIRE(std::getline(lines, second_line));
        const Json first = Json::parse(first_line);
        const Json second = Json::parse(second_line);
        CHECK(first["id"] == 10);
        CHECK(first["error"]["code"] == -32603);
        CHECK(second["id"] == 11);
        CHECK(second["result"] == Json::object());
    }

    {
        // Input stays open after output fails: on_shutdown must unblock the reader so serve()
        // unwinds cleanly without deadlocking or calling std::terminate().
        struct FailingBuf final : std::streambuf {
            int_type overflow(int_type) override { return traits_type::eof(); }
        };
        ClientPipe pipe;
        std::atomic<bool> shutdown_called{false};
        auto server = make_server(*notes.registry, {.on_shutdown = [&] {
            shutdown_called.store(true);
            pipe.close();
        }});
        FailingBuf buf;
        std::ostream out(&buf);
        out.exceptions(std::ios::badbit | std::ios::failbit);
        pipe.send(request(20, "ping").dump());
        bool caught = false;
        try {
            server->serve(pipe.in(), out);
        } catch (const std::ios_base::failure&) {
            caught = true;
        }
        CHECK(caught);
        CHECK(shutdown_called.load());
    }

    {
        // Same open-input shutdown when out fails without throwing (default stream flags).
        struct FailingBuf final : std::streambuf {
            int_type overflow(int_type) override { return traits_type::eof(); }
        };
        ClientPipe pipe;
        std::atomic<bool> shutdown_called{false};
        auto server = make_server(*notes.registry, {.on_shutdown = [&] {
            shutdown_called.store(true);
            pipe.close();
        }});
        FailingBuf buf;
        std::ostream out(&buf);
        pipe.send(request(21, "ping").dump());
        server->serve(pipe.in(), out);
        CHECK(shutdown_called.load());
    }
}
#endif

TEST_CASE("StdioServer restores Interface::mcp after context_hook") {
    int app_runs = 0;
    auto reg = afd::CommandRegistry::create(
        {.call_grant = [](std::string_view, const afd::CommandContext&) { return true; }});
    REQUIRE(reg.has_value());
    REQUIRE_FALSE((*reg)
                      ->register_command({.name = "app-secret",
                                          .description = "Apps-only command",
                                          .handler =
                                              [&app_runs](const afd::Json&, afd::CommandContext&) {
                                                  ++app_runs;
                                                  return afd::success(afd::Json{{"ok", true}});
                                              },
                                          .expose = {.palette = false,
                                                     .mcp = false,
                                                     .agent = false,
                                                     .cli = false,
                                                     .apps = true}})
                      .has_value());

    for (const std::optional<afd::Interface> mutated :
         {std::optional<afd::Interface>{afd::Interface::apps}, std::optional<afd::Interface>{}}) {
        auto server = make_server(**reg, {.context_hook = [mutated](afd::CommandContext& ctx,
                                                                    const afd::mcp::RequestInfo&) {
            ctx.surface = mutated;
        }});

        const auto direct = modern_call(*server, "app-secret", Json::object(), Json::object());
        CHECK(direct["isError"] == true);
        CHECK(direct["structuredContent"]["error"]["code"] == "COMMAND_NOT_FOUND");

        const auto via_call =
            modern_call(*server, "afd-call", {{"command", "app-secret"}, {"input", Json::object()}},
                        Json::object());
        CHECK(via_call["isError"] == true);
        CHECK(via_call["structuredContent"]["error"]["code"] == "COMMAND_NOT_FOUND");

        const auto via_batch = modern_call(
            *server, "afd-batch",
            {{"commands", Json::array({{{"command", "app-secret"}, {"input", Json::object()}}})}},
            Json::object());
        CHECK(via_batch["structuredContent"]["results"][0]["result"]["success"] == false);
        CHECK(via_batch["structuredContent"]["results"][0]["result"]["error"]["code"] ==
              "COMMAND_NOT_FOUND");

        const auto via_pipe = modern_call(
            *server, "afd-pipe",
            {{"steps", Json::array({{{"command", "app-secret"}, {"input", Json::object()}}})}},
            Json::object());
        CHECK(via_pipe["isError"] == true);
        CHECK(via_pipe["structuredContent"]["steps"][0]["error"]["code"] == "COMMAND_NOT_FOUND");
    }
    CHECK(app_runs == 0);
}
