// The todo commands over the library's MCP stdio server (afd::mcp_stdio). The protocol itself is
// tested in packages/cpp/tests/mcp_stdio_test.cpp.
#include "fixture.hpp"
#include <afd/mcp_stdio.hpp>

using todo::testing::Fixture;

namespace {

afd::Json reply(afd::mcp::StdioServer& server, const char* line) {
    const auto out = server.handle_message(line);
    REQUIRE(out.has_value());
    return afd::Json::parse(*out);
}

std::unique_ptr<afd::mcp::StdioServer> make_server(Fixture& fixture) {
    auto server = afd::mcp::StdioServer::create(*fixture.registry, {.name = "afd-todo-cpp"});
    REQUIRE(server);
    return std::move(*server);
}

} // namespace

TEST_CASE("tools/list lists every todo command with its annotations and _meta") {
    Fixture fixture;
    auto server = make_server(fixture);
    const auto tools =
        reply(*server, R"({"jsonrpc":"2.0","id":2,"method":"tools/list"})")["result"]["tools"];
    CHECK(tools.size() == 11);
    for (const auto& tool : tools) {
        CHECK(tool.contains("inputSchema"));
        // No todo command sets a title, and none is derived from the name.
        CHECK_FALSE(tool.contains("title"));
        CHECK(tool["_meta"]["category"] == "todo");
        if (tool["name"] == "todo-list") {
            CHECK_FALSE(tool.contains("annotations"));
            CHECK_FALSE(tool["_meta"].contains("mutation"));
        }
        if (tool["name"] == "todo-create") {
            CHECK(tool["annotations"] ==
                  afd::Json{{"readOnlyHint", false}, {"destructiveHint", false}});
            CHECK(tool["_meta"]["mutation"] == true);
        }
        if (tool["name"] == "todo-delete") {
            CHECK(tool["annotations"]["destructiveHint"] == true);
        }
    }
}

TEST_CASE("tools/call runs a todo command and returns its CommandResult") {
    Fixture fixture;
    auto server = make_server(fixture);
    const auto ok = reply(
        *server,
        R"({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":"From MCP"}}})");
    CHECK(ok["result"]["isError"] == false);
    const auto body = afd::Json::parse(ok["result"]["content"][0]["text"].get<std::string>());
    CHECK(body["data"]["title"] == "From MCP");
    CHECK(body["metadata"]["actorKind"] == "agent");

    const auto modern = reply(
        *server,
        R"({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"todo-stats","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(modern["result"]["resultType"] == "complete");
    CHECK(modern["result"]["isError"] == false);
}
