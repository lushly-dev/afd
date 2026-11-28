// The language-neutral vectors in spec/vectors/approver-client.json: approval evidence from an
// approver client and the approval display rules (spec/approvals.md; Loam phase 5, step 0c).
//
// The display cases run in every build. The carrier cases run when `AFD_BUILD_MCP_STDIO` is on,
// over `afd::mcp::StdioServer` with `StdioServerOptions::context_hook` populating each caller's
// verified `PrincipalCredentials` and `Actor` (stdio has no HTTP bearer layer; hosts with another
// transport populate `CommandContext::credentials` in the same way).
#include "afd/afd.hpp"

#ifdef AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <atomic>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#include "detail/exceptions.hpp"
#include "detail/hmac.hpp"
#include <doctest.h>

namespace approver_client {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

} // namespace approver_client

TEST_CASE("approver-client.json: C++ is no longer a documented gap") {
    const auto vectors = approver_client::load("approver-client.json");
    CHECK_FALSE(vectors.at("gaps").contains("cpp"));
    CHECK(vectors.at("gaps").empty());
}

TEST_CASE("approver-client.json: approval display limits and verdicts match") {
    const auto vectors = approver_client::load("approver-client.json");
    const auto& limits = vectors.at("display").at("limits");
    CHECK(limits.at("maxSerializedLength").get<std::size_t>() ==
          afd::approval_display_limits.max_serialized_length);
    CHECK(limits.at("maxStringLength").get<std::size_t>() ==
          afd::approval_display_limits.max_string_length);
    CHECK(limits.at("maxKeyLength").get<std::size_t>() ==
          afd::approval_display_limits.max_key_length);
    CHECK(limits.at("maxDepth").get<std::size_t>() == afd::approval_display_limits.max_depth);
    CHECK(limits.at("maxValues").get<std::size_t>() == afd::approval_display_limits.max_values);

    const auto& cases = vectors.at("display").at("cases");
    REQUIRE_FALSE(cases.empty());
    for (const auto& entry : cases) {
        const auto description = entry.at("description").get<std::string>();
        CAPTURE(description);
        const auto verdict = afd::approval_display(entry.at("input"));
        const std::string actual =
            verdict ? "shown" : std::string(afd::approval_display_refusal_name(verdict.error()));
        CHECK(actual == entry.at("expected").get<std::string>());
        if (verdict) {
            CHECK(*verdict == entry.at("input"));
        }
    }
}

TEST_CASE("approval_display: edge cases outside JSON vector encoding") {
    // Non-canonical inputs: unsafe 64-bit integer and non-finite float.
    const auto unsafe_int = afd::approval_display(afd::Json{{"n", std::int64_t{9007199254740993}}});
    REQUIRE_FALSE(unsafe_int.has_value());
    CHECK(unsafe_int.error() == afd::ApprovalDisplayRefusal::not_json);

    const auto nan_val =
        afd::approval_display(afd::Json{{"n", std::numeric_limits<double>::quiet_NaN()}});
    REQUIRE_FALSE(nan_val.has_value());
    CHECK(nan_val.error() == afd::ApprovalDisplayRefusal::not_json);

    // Surrogate code points are hidden when tested directly.
    CHECK(afd::is_hidden_code_point(0xD800));
    CHECK(afd::is_hidden_code_point(0xDFFF));
    CHECK_FALSE(afd::is_hidden_code_point(0xD7FF));
    CHECK_FALSE(afd::is_hidden_code_point(0xE000));
    CHECK_FALSE(afd::is_hidden_code_point(0x0009));
    CHECK_FALSE(afd::is_hidden_code_point(0x000A));
    CHECK_FALSE(afd::is_hidden_code_point(0xFE0E));
    CHECK_FALSE(afd::is_hidden_code_point(0xFE0F));

    // Combining marks: 5 allowed, 6 refused, non-mark resets run, invalid UTF-8 refused.
    std::string five = "z";
    for (int i = 0; i < 5; ++i) {
        five += "\xCC\x80"; // U+0300 COMBINING GRAVE ACCENT
    }
    CHECK_FALSE(afd::hides_characters(five));
    CHECK(afd::hides_characters(five + "\xCC\x80"));
    CHECK_FALSE(afd::hides_characters(five + "a" + five));
    CHECK(afd::hides_characters(std::string("\xFF", 1)));
}

#ifdef AFD_HAS_MCP_STDIO

namespace approver_client {

afd::Json decode_token_payload(const std::string& token) {
    const auto first = token.find('.');
    REQUIRE(first != std::string::npos);
    const auto second = token.find('.', first + 1);
    REQUIRE(second != std::string::npos);
    const auto decoded = afd::detail::base64url_decode(
        std::string_view(token).substr(first + 1, second - first - 1));
    REQUIRE(decoded.has_value());
    auto parsed = afd::parse_bounded(*decoded);
    REQUIRE(parsed.has_value());
    return *parsed;
}

afd::Json send_rpc(afd::mcp::StdioServer& server, const afd::Json& message,
                   const afd::mcp::ClientRequester& ask = {}) {
    const auto out = server.handle_message(afd::wire::serialize(message), ask);
    REQUIRE(out.has_value());
    auto parsed = afd::parse_bounded(*out);
    REQUIRE(parsed.has_value());
    return *parsed;
}

afd::Json tool_body(const afd::Json& response) {
    REQUIRE(response.contains("result"));
    const auto& result = response.at("result");
    REQUIRE(result.contains("content"));
    REQUIRE(result.at("content").is_array());
    REQUIRE_FALSE(result.at("content").empty());
    auto parsed = afd::parse_bounded(result.at("content").at(0).at("text").get<std::string>());
    REQUIRE(parsed.has_value());
    return *parsed;
}

struct CallerIdentity {
    afd::PrincipalCredentials credentials;
    afd::Actor actor;
};

CallerIdentity caller_from_vector(const afd::Json& entry) {
    const auto& creds = entry.at("credentials");
    const auto& actor = entry.at("actor");
    CallerIdentity id;
    id.credentials = afd::PrincipalCredentials{
        .issuer = creds.at("issuer").get<std::string>(),
        .subject = creds.at("subject").get<std::string>(),
        .client_id = creds.at("clientId").get<std::string>(),
    };
    auto parsed_actor = afd::Actor::from_json(actor);
    REQUIRE(parsed_actor.has_value());
    id.actor = *parsed_actor;
    return id;
}

struct CarrierFixture {
    std::shared_ptr<afd::CommandRegistry> registry;
    std::unique_ptr<afd::mcp::StdioServer> server;
    std::shared_ptr<std::atomic<int>> runs = std::make_shared<std::atomic<int>>(0);
    std::shared_ptr<CallerIdentity> current_caller = std::make_shared<CallerIdentity>();
};

CarrierFixture make_carrier_fixture(const afd::Json& carrier) {
    CarrierFixture fixture;
    auto runs = fixture.runs;
    std::vector<afd::CommandDefinition> commands{
        {.name = "todo-delete",
         .description = "Delete a todo",
         .input_schema = afd::Json{{"type", "object"},
                                   {"properties", {{"id", {{"type", "number"}}}}},
                                   {"required", {"id"}},
                                   {"additionalProperties", false}},
         .handler =
             [runs](const afd::Json& input, afd::CommandContext&) {
                 ++*runs;
                 return afd::success(input);
             },
         .mutation = true,
         .expose = {.mcp = true},
         .approval = afd::ApprovalDecision::required},
        {.name = "todo-list",
         .description = "List todos",
         .input_schema = afd::Json{{"type", "object"}, {"properties", afd::Json::object()}},
         .handler =
             [runs](const afd::Json& input, afd::CommandContext&) {
                 ++*runs;
                 return afd::success(input);
             },
         .expose = {.mcp = true}},
    };

    auto approval = afd::create_approval_middleware({
        .secrets = {carrier.at("secret").get<std::string>()},
        .ttl_ms = carrier.at("ttlMs").get<std::int64_t>(),
        .include_token = false,
        .clock = afd::fixed_clock(carrier.at("now").get<std::int64_t>()),
        .relay = afd::ApprovalRelay::mcp_elicitation,
    });
    REQUIRE(approval.has_value());

    fixture.registry = std::make_shared<afd::CommandRegistry>(
        afd::CommandRegistryOptions{.middleware = {*approval}});
    for (const auto& cmd : commands) {
        REQUIRE_FALSE(fixture.registry->register_command(cmd).has_value());
    }

    std::unordered_set<std::string> approver_clients;
    for (const auto& [name, info] : carrier.at("callers").items()) {
        (void)name;
        if (info.at("approver").get<bool>()) {
            approver_clients.insert(info.at("credentials").at("clientId").get<std::string>());
        }
    }

    auto active = fixture.current_caller;
    auto server = afd::mcp::StdioServer::create(
        *fixture.registry,
        {.name = "approver-client-vectors",
         .version = "1.0.0",
         .tool_strategy = afd::mcp::ToolStrategy::individual,
         .context_hook =
             [active](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                 ctx.credentials = active->credentials;
                 ctx.actor = active->actor;
             },
         .approver =
             [approver_clients = std::move(approver_clients)](const afd::CommandContext& ctx) {
                 return ctx.credentials.has_value() &&
                        approver_clients.contains(ctx.credentials->client_id);
             }});
    REQUIRE(server.has_value());
    fixture.server = std::move(*server);
    return fixture;
}

} // namespace approver_client

TEST_CASE("approver-client.json: carrier cases match") {
    using namespace approver_client;
    const auto vectors = approver_client::load("approver-client.json");
    const auto& carrier = vectors.at("carrier");
    const auto& cases = carrier.at("cases");
    REQUIRE_FALSE(cases.empty());

    for (const auto& entry : cases) {
        const auto description = entry.at("description").get<std::string>();
        auto fixture = make_carrier_fixture(carrier);
        std::vector<std::optional<std::string>> tokens;

        const auto& steps = entry.at("steps");
        for (std::size_t i = 0; i < steps.size(); ++i) {
            const auto& step = steps.at(i);
            const std::string where = description + ", step " + std::to_string(i);
            CAPTURE(where);

            *fixture.current_caller =
                caller_from_vector(carrier.at("callers").at(step.at("caller").get<std::string>()));

            std::optional<std::string> approval_value;
            if (step.contains("approval") && !step.at("approval").is_null()) {
                if (step.at("approval").is_string()) {
                    approval_value = step.at("approval").get<std::string>();
                } else {
                    const auto from = step.at("approval").at("token").get<std::size_t>();
                    REQUIRE(from < tokens.size());
                    REQUIRE(tokens.at(from).has_value());
                    approval_value = *tokens.at(from);
                }
            }

            afd::Json capabilities = afd::Json::object();
            if (step.at("elicit").get<bool>()) {
                capabilities["elicitation"] = afd::Json::object();
            }
            afd::Json meta{
                {"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                {"io.modelcontextprotocol/clientCapabilities", std::move(capabilities)},
            };
            if (approval_value) {
                meta[std::string(afd::mcp::approval_meta_key)] = *approval_value;
            }
            afd::Json req{
                {"jsonrpc", "2.0"},
                {"id", static_cast<int>(i + 1)},
                {"method", "tools/call"},
                {"params",
                 {{"name", step.at("tool")}, {"arguments", step.at("arguments")}, {"_meta", meta}}},
            };
            const auto resp = send_rpc(*fixture.server, req);
            const auto result = tool_body(resp);

            std::optional<std::string> token;
            if (result.contains("error") && result.at("error").contains("details") &&
                result.at("error").at("details").contains("approvalToken") &&
                result.at("error").at("details").at("approvalToken").is_string()) {
                token = result.at("error").at("details").at("approvalToken").get<std::string>();
            }

            const auto& expected = step.at("expected");
            if (expected.contains("success") && expected.at("success").get<bool>()) {
                CHECK(result.at("success").get<bool>());
            } else {
                CHECK_FALSE(result.at("success").get<bool>());
                CHECK(result.at("error").at("code") == expected.at("code"));
                if (expected.contains("token") && expected.at("token").is_boolean()) {
                    CHECK(token.has_value() == expected.at("token").get<bool>());
                }
                const bool has_reason = result.at("error").contains("details") &&
                                        result.at("error").at("details").contains("reason");
                if (expected.contains("reason") && !expected.at("reason").is_null()) {
                    REQUIRE(has_reason);
                    CHECK(result.at("error").at("details").at("reason") == expected.at("reason"));
                } else {
                    CHECK_FALSE(has_reason);
                }
            }

            if (expected.contains("payload")) {
                REQUIRE(token.has_value());
                auto payload = decode_token_payload(*token);
                REQUIRE(payload.contains("n"));
                REQUIRE(payload.at("n").is_string());
                const auto nonce =
                    afd::detail::base64url_decode(payload.at("n").get<std::string>());
                REQUIRE(nonce.has_value());
                CHECK(nonce->size() == 16);
                payload.erase("n");
                CHECK(payload == expected.at("payload"));
            }

            CHECK(fixture.runs->load() == step.at("runs").get<int>());
            tokens.push_back(std::move(token));
        }
    }
}

TEST_CASE(
    "approver client: 2025 era, incomplete credentials, summary, non-approver relay, nested") {
    using namespace approver_client;
    const std::string approver_secret(32, 's');
    const CallerIdentity shell{
        .credentials = {.issuer = "https://auth.example.com",
                        .subject = "person-1",
                        .client_id = "loam-shell"},
        .actor = {.kind = afd::ActorKind::agent, .id = "loam-shell", .on_behalf_of = "person-1"},
    };
    const CallerIdentity agent{
        .credentials = {.issuer = "https://auth.example.com",
                        .subject = "person-1",
                        .client_id = "todo-agent"},
        .actor = {.kind = afd::ActorKind::agent, .id = "todo-agent", .on_behalf_of = "person-1"},
    };

    SUBCASE("2025-era approver gets token on hold, refuses carried key, never runs") {
        auto runs = std::make_shared<std::atomic<int>>(0);
        auto approval = afd::create_approval_middleware({
            .secrets = {approver_secret},
            .include_token = false,
            .relay = afd::ApprovalRelay::mcp_elicitation,
        });
        REQUIRE(approval);
        afd::CommandRegistry registry({.middleware = {*approval}});
        REQUIRE_FALSE(
            registry
                .register_command({
                    .name = "todo-delete",
                    .description = "Delete a todo",
                    .input_schema = afd::Json{{"type", "object"},
                                              {"properties", {{"id", {{"type", "number"}}}}},
                                              {"required", {"id"}}},
                    .handler =
                        [runs](const afd::Json& in, afd::CommandContext&) {
                            ++*runs;
                            return afd::success(in);
                        },
                    .mutation = true,
                    .expose = {.mcp = true},
                    .approval = afd::ApprovalDecision::required,
                })
                .has_value());
        auto server = afd::mcp::StdioServer::create(
            registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                       .context_hook =
                           [&](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                               ctx.credentials = shell.credentials;
                               ctx.actor = shell.actor;
                           },
                       .approver =
                           [](const afd::CommandContext& ctx) {
                               return ctx.credentials && ctx.credentials->client_id == "loam-shell";
                           }});
        REQUIRE(server);

        // Initialize a 2025 connection with elicitation capability.
        const auto init =
            send_rpc(**server, {{"jsonrpc", "2.0"},
                                {"id", 1},
                                {"method", "initialize"},
                                {"params",
                                 {{"protocolVersion", "2025-06-18"},
                                  {"capabilities", {{"elicitation", afd::Json::object()}}}}}});
        REQUIRE(init.contains("result"));

        // First call: approver gets token, never elicits.
        bool elicited = false;
        const auto ask = [&](const afd::Json&) -> std::optional<afd::Json> {
            elicited = true;
            return afd::Json{{"action", "accept"}, {"content", {{"approved", true}}}};
        };
        const auto held_rpc =
            send_rpc(**server,
                     {{"jsonrpc", "2.0"},
                      {"id", 2},
                      {"method", "tools/call"},
                      {"params", {{"name", "todo-delete"}, {"arguments", {{"id", 7}}}}}},
                     ask);
        CHECK_FALSE(elicited);
        const auto held = tool_body(held_rpc);
        CHECK(held.at("error").at("code") == "APPROVAL_REQUIRED");
        REQUIRE(held.at("error").at("details").contains("approvalToken"));
        const auto token = held.at("error").at("details").at("approvalToken").get<std::string>();

        // Retry carrying the key over 2025 is refused without consuming the token.
        const auto refused_rpc =
            send_rpc(**server,
                     {{"jsonrpc", "2.0"},
                      {"id", 3},
                      {"method", "tools/call"},
                      {"params",
                       {{"name", "todo-delete"},
                        {"arguments", {{"id", 7}}},
                        {"_meta", {{std::string(afd::mcp::approval_meta_key), token}}}}}},
                     ask);
        const auto refused = tool_body(refused_rpc);
        CHECK(refused.at("error").at("code") == "APPROVAL_REQUIRED");
        CHECK(refused.at("error").at("retryable") == false);
        CHECK_FALSE(refused.at("error").contains("recovery"));
        CHECK(runs->load() == 0);
    }

    SUBCASE("incomplete credentials on approver fail closed with JSON-RPC -32603") {
        auto runs = std::make_shared<std::atomic<int>>(0);
        auto approval = afd::create_approval_middleware({.secrets = {approver_secret}});
        REQUIRE(approval);
        afd::CommandRegistry registry({.middleware = {*approval}});
        REQUIRE_FALSE(registry
                          .register_command({
                              .name = "todo-delete",
                              .description = "Delete",
                              .handler =
                                  [runs](const afd::Json&, afd::CommandContext&) {
                                      ++*runs;
                                      return afd::success(nullptr);
                                  },
                              .mutation = true,
                              .expose = {.mcp = true},
                              .approval = afd::ApprovalDecision::required,
                          })
                          .has_value());
        auto server = afd::mcp::StdioServer::create(
            registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                       .context_hook =
                           [](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                               ctx.credentials = afd::PrincipalCredentials{
                                   .issuer = "https://auth.example.com",
                                   .subject = "person-1",
                                   .client_id = "",
                               };
                           },
                       .approver = [](const afd::CommandContext&) { return true; }});
        REQUIRE(server);

        const auto resp =
            send_rpc(**server,
                     {{"jsonrpc", "2.0"},
                      {"id", 1},
                      {"method", "tools/call"},
                      {"params",
                       {{"name", "todo-delete"},
                        {"arguments", afd::Json::object()},
                        {"_meta",
                         {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                          {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()}}}}}});
        REQUIRE(resp.contains("error"));
        CHECK(resp.at("error").at("code") == -32603);
        CHECK(resp.at("error").at("message") == "Internal error");
        CHECK(runs->load() == 0);
    }

#if AFD_HAS_EXCEPTIONS
    SUBCASE("throwing approver predicate fails closed with JSON-RPC -32603") {
        auto approval = afd::create_approval_middleware({.secrets = {approver_secret}});
        REQUIRE(approval);
        afd::CommandRegistry registry({.middleware = {*approval}});
        REQUIRE_FALSE(registry
                          .register_command({
                              .name = "todo-delete",
                              .description = "Delete",
                              .handler = [](const afd::Json&,
                                            afd::CommandContext&) { return afd::success(nullptr); },
                              .mutation = true,
                              .expose = {.mcp = true},
                              .approval = afd::ApprovalDecision::required,
                          })
                          .has_value());
        auto server = afd::mcp::StdioServer::create(
            registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                       .context_hook =
                           [&](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                               ctx.credentials = shell.credentials;
                               ctx.actor = shell.actor;
                           },
                       .approver = [](const afd::CommandContext&) -> bool {
                           throw std::runtime_error("secret internal detail");
                       }});
        REQUIRE(server);

        const auto resp =
            send_rpc(**server,
                     {{"jsonrpc", "2.0"},
                      {"id", 1},
                      {"method", "tools/call"},
                      {"params",
                       {{"name", "todo-delete"},
                        {"arguments", afd::Json::object()},
                        {"_meta",
                         {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                          {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()}}}}}});
        REQUIRE(resp.contains("error"));
        CHECK(resp.at("error").at("code") == -32603);
        CHECK(resp.at("error").at("message") == "Internal error");
    }
#endif

    SUBCASE("on_approval_accepted reports ApprovalVia::token, grouped and nested spend once") {
        auto seen = std::make_shared<std::vector<afd::ApprovalSummary>>();
        auto approval = afd::create_approval_middleware({
            .secrets = {approver_secret},
            .include_token = false,
            .relay = afd::ApprovalRelay::mcp_elicitation,
            .on_approval_accepted = [seen](const afd::ApprovalSummary& summary,
                                           std::string_view) -> std::optional<std::string> {
                seen->push_back(summary);
                return std::nullopt;
            },
        });
        REQUIRE(approval);
        auto registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {*approval}});
        REQUIRE_FALSE(
            registry
                ->register_command({
                    .name = "todo-delete",
                    .description = "Delete",
                    .category = "todo",
                    .input_schema = afd::Json{{"type", "object"},
                                              {"properties", {{"id", {{"type", "number"}}}}},
                                              {"required", {"id"}}},
                    .handler = [](const afd::Json& in,
                                  afd::CommandContext&) { return afd::success(in); },
                    .mutation = true,
                    .expose = {.mcp = true},
                    .approval = afd::ApprovalDecision::required,
                })
                .has_value());
        REQUIRE_FALSE(
            registry
                ->register_command({
                    .name = "todo-nested",
                    .description = "Nested delete",
                    .category = "todo",
                    .input_schema = afd::Json{{"type", "object"},
                                              {"properties", {{"id", {{"type", "number"}}}}},
                                              {"required", {"id"}}},
                    .handler =
                        [reg = registry.get()](const afd::Json& in, afd::CommandContext& ctx) {
                            return reg->execute("todo-delete", in, ctx);
                        },
                    .expose = {.mcp = true},
                })
                .has_value());

        auto active = std::make_shared<CallerIdentity>(shell);
        auto server = afd::mcp::StdioServer::create(
            *registry, {.tool_strategy = afd::mcp::ToolStrategy::grouped,
                        .context_hook =
                            [active](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                                ctx.credentials = active->credentials;
                                ctx.actor = active->actor;
                            },
                        .approver =
                            [](const afd::CommandContext& ctx) {
                                return ctx.credentials &&
                                       ctx.credentials->client_id == "loam-shell";
                            }});
        REQUIRE(server);

        const auto call_2026 = [&](const std::string& tool, const afd::Json& args,
                                   std::optional<std::string> tok = std::nullopt) {
            afd::Json meta{
                {"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                {"io.modelcontextprotocol/clientCapabilities",
                 {{"elicitation", {{"form", afd::Json::object()}}}}},
            };
            if (tok) {
                meta[std::string(afd::mcp::approval_meta_key)] = *tok;
            }
            return send_rpc(**server,
                            {{"jsonrpc", "2.0"},
                             {"id", 1},
                             {"method", "tools/call"},
                             {"params", {{"name", tool}, {"arguments", args}, {"_meta", meta}}}});
        };

        // Grouped tool hold + redeem.
        const auto held =
            tool_body(call_2026("todo", {{"action", "delete"}, {"params", {{"id", 7}}}}));
        CHECK(held.at("error").at("code") == "APPROVAL_REQUIRED");
        const auto tok = held.at("error").at("details").at("approvalToken").get<std::string>();
        const auto ok =
            tool_body(call_2026("todo", {{"action", "delete"}, {"params", {{"id", 7}}}}, tok));
        CHECK(ok.at("success") == true);
        REQUIRE(seen->size() == 1);
        CHECK(seen->at(0).via == afd::ApprovalVia::token);
        CHECK(seen->at(0).command == "todo-delete");

        // Non-string carried key on approver is malformed.
        afd::Json bad_meta{
            {"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
            {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()},
            {std::string(afd::mcp::approval_meta_key), 123},
        };
        const auto malformed = tool_body(send_rpc(
            **server,
            {{"jsonrpc", "2.0"},
             {"id", 2},
             {"method", "tools/call"},
             {"params",
              {{"name", "todo-delete"}, {"arguments", {{"id", 7}}}, {"_meta", bad_meta}}}}));
        CHECK(malformed.at("error").at("code") == "APPROVAL_REQUIRED");
        CHECK(malformed.at("error").at("details").at("reason") == "malformed");

        // Nested call: carrying a token on `todo-nested` (which needs no approval) consumes the
        // carried evidence on `todo-nested`'s middleware pass so it never leaks into `todo-delete`,
        // while leaving the token itself unspent for a direct retry of `todo-delete`.
        const auto nested_held = tool_body(call_2026("todo-nested", {{"id", 9}}));
        CHECK(nested_held.at("error").at("code") == "APPROVAL_REQUIRED");
        const auto nested_tok =
            nested_held.at("error").at("details").at("approvalToken").get<std::string>();
        const auto nested_retry = tool_body(call_2026("todo-nested", {{"id", 9}}, nested_tok));
        CHECK(nested_retry.at("error").at("code") == "APPROVAL_REQUIRED");
        CHECK_FALSE(nested_retry.at("error").at("details").contains("reason"));
        const auto direct_retry = tool_body(
            call_2026("todo", {{"action", "delete"}, {"params", {{"id", 9}}}}, nested_tok));
        CHECK(direct_retry.at("success") == true);

        // Non-approver still gets form elicitation (input_required).
        *active = agent;
        const auto elicited = call_2026("todo-delete", {{"id", 7}});
        REQUIRE(elicited.contains("result"));
        CHECK(elicited.at("result").at("resultType") == "input_required");
        // Another caller with different credentials (same actor) cannot open that requestState.
        const auto state = elicited.at("result").at("requestState").get<std::string>();
        active->credentials.client_id = "other-agent";
        const auto cross_client = send_rpc(
            **server, {{"jsonrpc", "2.0"},
                       {"id", 3},
                       {"method", "tools/call"},
                       {"params",
                        {{"name", "todo-delete"},
                         {"arguments", {{"id", 7}}},
                         {"requestState", state},
                         {"inputResponses",
                          {{"approval", {{"action", "accept"}, {"content", {{"approve", true}}}}}}},
                         {"_meta",
                          {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                           {"io.modelcontextprotocol/clientCapabilities",
                            {{"elicitation", {{"form", afd::Json::object()}}}}}}}}}});
        REQUIRE(cross_client.contains("result"));
        CHECK(cross_client.at("result").at("resultType") == "input_required");
        // The original caller opens its own requestState and runs the command.
        active->credentials.client_id = agent.credentials.client_id;
        const auto same_client = send_rpc(
            **server, {{"jsonrpc", "2.0"},
                       {"id", 4},
                       {"method", "tools/call"},
                       {"params",
                        {{"name", "todo-delete"},
                         {"arguments", {{"id", 7}}},
                         {"requestState", state},
                         {"inputResponses",
                          {{"approval", {{"action", "accept"}, {"content", {{"approve", true}}}}}}},
                         {"_meta",
                          {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                           {"io.modelcontextprotocol/clientCapabilities",
                            {{"elicitation", {{"form", afd::Json::object()}}}}}}}}}});
        CHECK(tool_body(same_client).at("success") == true);
    }

    SUBCASE("DirectClient::call strips approver_call when forwarded from an approver MCP handler") {
        auto saw_cleared = std::make_shared<std::atomic<bool>>(false);
        auto approval = afd::create_approval_middleware({
            .secrets = {approver_secret},
            .include_token = false,
            .relay = afd::ApprovalRelay::mcp_elicitation,
        });
        REQUIRE(approval);
        auto registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {*approval}});
        REQUIRE_FALSE(registry
                          ->register_command({
                              .name = "inner-delete",
                              .description = "Inner delete",
                              .handler = [](const afd::Json&,
                                            afd::CommandContext&) { return afd::success(true); },
                              .mutation = true,
                              .expose = {.mcp = true, .agent = true},
                              .approval = afd::ApprovalDecision::required,
                          })
                          .has_value());
        // No `on_approval_needed` so approval middleware's own suggestion reaches the caller
        // unmasked, plus client middleware verifying `approver_call` and `up_front_approval` were
        // cleared before entering the registry.
        auto direct = std::make_shared<afd::DirectClient>(
            registry,
            afd::DirectClientOptions{
                .surface = afd::Interface::agent,
                .middleware = {[saw_cleared](std::string_view, const afd::Json&,
                                             afd::CommandContext& ctx, const afd::Next& next) {
                    saw_cleared->store(ctx.approver_call == nullptr &&
                                       ctx.up_front_approval == nullptr);
                    return next();
                }},
            });
        REQUIRE_FALSE(
            registry
                ->register_command({
                    .name = "outer-bridge",
                    .description = "Forwards context to DirectClient",
                    .handler =
                        [direct_ptr = direct.get()](const afd::Json&, afd::CommandContext& ctx) {
                            return direct_ptr->call("inner-delete", afd::Json::object(), ctx);
                        },
                    .expose = {.mcp = true},
                })
                .has_value());
        auto server = afd::mcp::StdioServer::create(
            *registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                        .context_hook =
                            [&](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                                ctx.credentials = shell.credentials;
                                ctx.actor = shell.actor;
                            },
                        .approver =
                            [](const afd::CommandContext& ctx) {
                                return ctx.credentials &&
                                       ctx.credentials->client_id == "loam-shell";
                            }});
        REQUIRE(server);

        const auto resp = send_rpc(
            **server, {{"jsonrpc", "2.0"},
                       {"id", 1},
                       {"method", "tools/call"},
                       {"params",
                        {{"name", "outer-bridge"},
                         {"arguments", afd::Json::object()},
                         {"_meta",
                          {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                           {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()},
                           {std::string(afd::mcp::approval_meta_key), "afdap1.not-a-token"}}}}}});
        const auto res = tool_body(resp);
        CHECK(res.at("success") == false);
        CHECK(res.at("error").at("code") == "APPROVAL_REQUIRED");
        CHECK_FALSE(res.at("error").at("details").contains("approvalToken"));
        CHECK(res.at("error").at("suggestion").get<std::string>().find("dev.afd/approval") ==
              std::string::npos);
        CHECK(saw_cleared->load() == true);
    }
}

#endif // AFD_HAS_MCP_STDIO
