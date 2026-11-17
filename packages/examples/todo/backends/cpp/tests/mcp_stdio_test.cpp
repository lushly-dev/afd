// The todo commands over the library's MCP stdio server (afd::mcp_stdio). The protocol itself is
// tested in packages/cpp/tests/mcp_stdio_test.cpp; asking the person is the conformance runner's
// approvals suite.
#include "fixture.hpp"
#include <afd/mcp_stdio.hpp>

using todo::testing::Fixture;

namespace {

afd::Json reply(afd::mcp::StdioServer& server, const std::string& line) {
    const auto out = server.handle_message(line);
    REQUIRE(out.has_value());
    return afd::Json::parse(*out);
}

std::unique_ptr<afd::mcp::StdioServer> make_server(Fixture& fixture) {
    auto server = afd::mcp::StdioServer::create(*fixture.registry, {.name = "afd-todo-cpp"});
    REQUIRE(server);
    return std::move(*server);
}

afd::Json call(afd::mcp::StdioServer& server, const char* name, const afd::Json& arguments) {
    const afd::Json request{{"jsonrpc", "2.0"},
                            {"id", 1},
                            {"method", "tools/call"},
                            {"params", {{"name", name}, {"arguments", arguments}}}};
    const auto result = reply(server, request.dump())["result"];
    return afd::Json::parse(result["content"][0]["text"].get<std::string>());
}

} // namespace

TEST_CASE("tools/list lists every todo command with its title, annotations and _meta") {
    Fixture fixture;
    auto server = make_server(fixture);
    const auto tools =
        reply(*server, R"({"jsonrpc":"2.0","id":2,"method":"tools/list"})")["result"]["tools"];
    CHECK(tools.size() == 13);
    for (const auto& tool : tools) {
        CAPTURE(tool["name"].get<std::string>());
        CHECK(tool.contains("inputSchema"));
        CHECK(tool.contains("title"));
        CHECK(tool["_meta"]["category"] == "todo");
        CHECK(tool["_meta"].contains("outputSchema"));
        if (tool["name"] == "todo-list") {
            CHECK(tool["title"] == "List todos");
            // Only a change carries annotations (afd::command_tool_annotations).
            CHECK_FALSE(tool.contains("annotations"));
            CHECK_FALSE(tool["_meta"].contains("mutation"));
        }
        if (tool["name"] == "todo-create") {
            CHECK(tool["annotations"]["readOnlyHint"] == false);
            CHECK(tool["annotations"]["destructiveHint"] == false);
            CHECK(tool["_meta"]["mutation"] == true);
            CHECK(tool["_meta"]["undoable"] == true);
            CHECK(tool["_meta"]["approval"] == "not-required");
        }
        if (tool["name"] == "todo-clear") {
            CHECK(tool["annotations"]["destructiveHint"] == true);
            CHECK(tool["_meta"]["approval"] == "conditional");
        }
    }
}

TEST_CASE("tools/call runs a todo command as an agent and returns its CommandResult") {
    Fixture fixture;
    auto server = make_server(fixture);
    const auto body = call(*server, "todo-create", {{"title", "From MCP"}});
    CHECK(body["data"]["title"] == "From MCP");
    CHECK(body["metadata"]["actorKind"] == "agent");
    CHECK(body["undoCommand"] == "todo-delete");
    const auto history = call(*server, "todo-history", afd::Json::object());
    CHECK(history["data"]["entries"][0]["actor"]["kind"] == "agent");

    const auto modern = reply(
        *server,
        R"({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"todo-stats","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(modern["result"]["resultType"] == "complete");
    CHECK(modern["result"]["isError"] == false);
}

TEST_CASE("an MCP agent's clear is held without a token when the client cannot be asked") {
    Fixture fixture(todo::Approvals::agents);
    auto server = make_server(fixture);
    const std::string id = call(*server, "todo-create", {{"title", "Done"}})["data"]["id"];
    call(*server, "todo-toggle", {{"id", id}});
    const auto held = call(*server, "todo-clear", afd::Json::object());
    CHECK(held["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK_FALSE(held["error"]["details"].contains("approvalToken"));
    CHECK(call(*server, "todo-list", {{"completed", true}})["data"]["total"] == 1);
}
