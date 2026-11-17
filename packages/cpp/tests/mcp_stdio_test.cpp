// The MCP stdio server (afd/mcp_stdio.hpp): both protocol eras, confirmations, the approval
// relay and cancellation (spec/command-metadata.md, "Confirmations" and "Asking the human over
// MCP").
#include "afd/afd.hpp"
#include "afd/mcp_stdio.hpp"

#include <atomic>
#include <chrono>
#include <memory>
#include <sstream>
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
        auto approval = afd::create_approval_middleware(
            {.secrets = {secret}, .commands = {commands.begin(), commands.end()}, .relay = relay});
        REQUIRE(approval);
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {*approval}});
        for (const auto& command : commands) {
            REQUIRE_FALSE(registry->register_command(command));
        }
    }
};

std::unique_ptr<StdioServer> make_server(const afd::CommandRegistry& registry,
                                         afd::mcp::StdioServerOptions options = {}) {
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

Json accept(std::string_view field) {
    return Json{{"action", "accept"}, {"content", {{std::string(field), true}}}};
}

} // namespace

TEST_CASE("initialize echoes a supported protocol version, else the newest") {
    Notes notes;
    auto server = make_server(*notes.registry, {.name = "notes", .version = "1.0.0"});
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
    auto server = make_server(*notes.registry, {.name = "notes", .version = "1.0.0"});
    const auto discover =
        send(*server, request("d", "server/discover", {{"_meta", modern_meta()}}));
    CHECK(discover["result"]["resultType"] == "complete");
    CHECK(discover["result"]["supportedVersions"] == Json::array({"2026-07-28"}));
    CHECK(discover["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "notes");
    CHECK(discover["result"]["ttlMs"] == 300000);

    const auto tools = send(*server, request(1, "tools/list", {{"_meta", modern_meta()}}));
    CHECK(tools["result"]["resultType"] == "complete");
    CHECK(tools["result"]["cacheScope"] == "public");
    CHECK(tools["result"]["tools"].size() == 4);

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
    const auto tools = send(*server, request(1, "tools/list"))["result"]["tools"];
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
    const auto token = body(held)["error"]["details"]["approvalToken"].get<std::string>();
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
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::enforce});
    const auto tools = send(*server, request(1, "tools/list"))["result"]["tools"];
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
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    const auto tools = send(*server, request(1, "tools/list"))["result"]["tools"];
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

    // Without elicitation, the hold is returned as it is.
    const auto held = modern_call(*server, "vault-open", Json::object(), Json::object());
    CHECK(body(held)["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(body(held)["error"]["details"].contains("reason"));
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
    CHECK(*notes.opens == 0);
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

TEST_CASE("serve asks a 2025 client in band and reads its answer") {
    Notes notes;
    auto server = make_server(*notes.registry, {.confirmations = ConfirmationMode::require_human});
    std::istringstream in(
        R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{}}}})"
        "\n"
        R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note-clear","arguments":{"all":true}}})"
        "\n"
        R"({"jsonrpc":"2.0","id":"afd-elicitation-1","result":{"action":"accept","content":{"confirm":true}}})"
        "\n");
    std::ostringstream out;
    server->serve(in, out);
    std::istringstream lines(out.str());
    std::vector<Json> written;
    for (std::string line; std::getline(lines, line);) {
        written.push_back(Json::parse(line));
    }
    REQUIRE(written.size() == 3);
    CHECK(written[0]["id"] == 1);
    CHECK(written[1]["method"] == "elicitation/create");
    CHECK(written[1]["id"] == "afd-elicitation-1");
    CHECK(written[2]["id"] == 2);
    CHECK(written[2]["result"]["isError"] == false);
    CHECK(*notes.clears == 1);
}

TEST_CASE("notifications/cancelled cancels the call it names") {
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "job-wait",
         .description = "Wait until cancelled",
         .handler =
             [](const Json&, afd::CommandContext& context) {
                 const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
                 while (!context.cancellation.is_cancelled() &&
                        std::chrono::steady_clock::now() < deadline) {
                     std::this_thread::sleep_for(std::chrono::milliseconds(1));
                 }
                 return afd::success(Json{{"cancelled", context.cancellation.is_cancelled()}});
             },
         .expose = {.mcp = true}}));
    auto server = make_server(registry);
    std::istringstream in(
        R"({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"job-wait"}})"
        "\n"
        R"({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}})"
        "\n");
    std::ostringstream out;
    server->serve(in, out);
    const auto result = Json::parse(out.str())["result"];
    CHECK(body(result)["data"]["cancelled"] == true);
}
