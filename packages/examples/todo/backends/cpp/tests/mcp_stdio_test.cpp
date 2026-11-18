// The todo commands over the library's MCP stdio server (afd::mcp_stdio). The protocol itself is
// tested in packages/cpp/tests/mcp_stdio_test.cpp; asking the person is the conformance runner's
// approvals suite.
#include <algorithm>
#include <string>
#include <string_view>
#include <vector>

#include "fixture.hpp"
#include <afd/mcp_stdio.hpp>

using todo::testing::Fixture;

namespace {

afd::Json reply(afd::mcp::StdioServer& server, const std::string& line) {
    const auto out = server.handle_message(line);
    REQUIRE(out.has_value());
    return afd::Json::parse(*out);
}

/// The server as `main` builds it: the default grouped strategy, as in TypeScript.
std::unique_ptr<afd::mcp::StdioServer>
make_server(Fixture& fixture, afd::mcp::ToolStrategy strategy = afd::mcp::ToolStrategy::grouped) {
    auto server = afd::mcp::StdioServer::create(
        *fixture.registry,
        {.name = "afd-todo-cpp", .tool_strategy = strategy, .contexts = todo::todo_contexts()});
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

TEST_CASE("tools/list is TypeScript's grouped list: the todo and bootstrap groups") {
    Fixture fixture;
    auto server = make_server(fixture);
    const auto list = [&](const char* context) {
        afd::Json params = afd::Json::object();
        if (context != nullptr) {
            params["_meta"] = {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                               {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()},
                               {"dev.afd/context", context}};
        }
        return reply(
            *server,
            afd::Json{{"jsonrpc", "2.0"}, {"id", 2}, {"method", "tools/list"}, {"params", params}}
                .dump())["result"]["tools"];
    };
    const auto actions = [](const afd::Json& tools, std::string_view group) {
        std::vector<std::string> out;
        for (const auto& tool : tools) {
            if (tool["name"] == group) {
                out = tool["inputSchema"]["properties"]["action"]["enum"]
                          .get<std::vector<std::string>>();
            }
        }
        return out;
    };
    const auto tools = list(nullptr);
    std::vector<std::string> names;
    for (const auto& tool : tools) {
        names.push_back(tool["name"].get<std::string>());
    }
    CHECK(names == std::vector<std::string>{"afd-batch", "afd-pipe", "afd-call", "afd-detail",
                                            "todo", "bootstrap"});
    CHECK(actions(tools, "todo").size() == 13);
    CHECK(actions(tools, "bootstrap") == std::vector<std::string>{"context-list", "context-enter",
                                                                  "context-exit", "help", "docs",
                                                                  "schema"});
    auto reading = actions(list("todo-reading"), "todo");
    std::sort(reading.begin(), reading.end());
    CHECK(reading == std::vector<std::string>{"get", "history", "list", "stats"});
}

TEST_CASE("each todo command's own tool carries its title, annotations and _meta") {
    Fixture fixture;
    auto server = make_server(fixture, afd::mcp::ToolStrategy::individual);
    const auto tools =
        reply(*server, R"({"jsonrpc":"2.0","id":2,"method":"tools/list"})")["result"]["tools"];
    // afd-batch, afd-pipe and afd-call; the thirteen todo commands; then the three context tools
    // and the three bootstrap tools.
    CHECK(tools.size() == 22);
    for (const auto& tool : tools) {
        CAPTURE(tool["name"].get<std::string>());
        const auto name = tool["name"].get<std::string>();
        if (name == "afd-batch" || name == "afd-pipe" || name == "afd-call") {
            CHECK_FALSE(tool.contains("_meta"));
            continue;
        }
        if (name.rfind("afd-", 0) == 0) {
            CHECK(tool["_meta"]["category"] == "bootstrap");
            continue;
        }
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

TEST_CASE("a clear the person approves over MCP runs once and is recorded; a declined one is not") {
    Fixture fixture(todo::Approvals::agents);
    auto server = make_server(fixture);
    reply(*server,
          afd::Json{{"jsonrpc", "2.0"},
                    {"id", 0},
                    {"method", "initialize"},
                    {"params",
                     {{"protocolVersion", "2025-11-25"},
                      {"capabilities", {{"elicitation", {{"form", afd::Json::object()}}}}}}}}
              .dump());
    const std::string id = call(*server, "todo-create", {{"title", "Done"}})["data"]["id"];
    call(*server, "todo-toggle", {{"id", id}});

    afd::Json answer{{"action", "decline"}};
    int asked = 0;
    const afd::mcp::ClientRequester ask = [&](const afd::Json&) -> std::optional<afd::Json> {
        ++asked;
        return answer;
    };
    const afd::Json clear{{"jsonrpc", "2.0"},
                          {"id", 5},
                          {"method", "tools/call"},
                          {"params", {{"name", "todo-clear"}, {"arguments", afd::Json::object()}}}};
    const auto body = [&] {
        const auto out = server->handle_message(clear.dump(), ask);
        REQUIRE(out.has_value());
        return afd::Json::parse(
            afd::Json::parse(*out)["result"]["content"][0]["text"].get<std::string>());
    };

    const auto declined = body();
    CHECK(asked == 1);
    CHECK(declined["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK(declined["error"]["details"]["reason"] == "declined");
    CHECK(call(*server, "todo-history", {{"todoId", id}})["data"]["total"] == 2);

    answer = afd::Json{{"action", "accept"}, {"content", {{"approve", true}}}};
    const auto approved = body();
    CHECK(asked == 2);
    CHECK(approved["data"]["clearedIds"] == afd::Json::array({id}));
    const auto history = call(*server, "todo-history", {{"todoId", id}});
    CHECK(history["data"]["total"] == 3);
    CHECK(history["data"]["entries"][0]["command"] == "todo-clear");
    CHECK(history["data"]["entries"][0]["actor"]["kind"] == "agent");
}

TEST_CASE("todo-reading hides the changes, over both MCP eras") {
    Fixture fixture;
    auto server = make_server(fixture, afd::mcp::ToolStrategy::individual);
    const auto names = [](const afd::Json& tools) {
        std::vector<std::string> out;
        for (const auto& tool : tools) {
            if (tool.contains("_meta") && tool["_meta"]["category"] == "todo") {
                out.push_back(tool["name"].get<std::string>());
            }
        }
        return out;
    };
    const std::vector<std::string> reading{"todo-list", "todo-get", "todo-stats", "todo-history"};

    // 2026-07-28: the request names its context.
    const afd::Json meta{{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                         {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()},
                         {"dev.afd/context", "todo-reading"}};
    const auto listed = reply(*server, afd::Json{{"jsonrpc", "2.0"},
                                                 {"id", 3},
                                                 {"method", "tools/list"},
                                                 {"params", {{"_meta", meta}}}}
                                           .dump())["result"];
    CHECK(names(listed["tools"]) == reading);
    CHECK(listed["ttlMs"] == 0);

    // 2025: the connection enters it.
    CHECK(call(*server, "afd-context-enter", {{"context", "todo-reading"}})["success"] == true);
    CHECK(names(reply(*server,
                      R"({"jsonrpc":"2.0","id":4,"method":"tools/list"})")["result"]["tools"]) ==
          reading);
    const auto refused = call(*server, "todo-create", {{"title", "Not while reading"}});
    CHECK(refused["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
    CHECK(call(*server, "afd-context-exit", afd::Json::object())["success"] == true);
    CHECK(call(*server, "todo-create", {{"title", "Now"}})["success"] == true);
}
