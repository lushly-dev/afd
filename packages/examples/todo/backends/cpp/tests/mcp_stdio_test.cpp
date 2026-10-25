// The stdio MCP protocol the conformance runner (MCP SDK client) speaks.
#include <sstream>

#include "fixture.hpp"
#include "mcp_stdio.hpp"

using todo::testing::Fixture;

namespace {

afd::Json reply(Fixture& fixture, const char* line) {
    const auto out = todo::handle_message(*fixture.registry, line);
    REQUIRE(out.has_value());
    return afd::Json::parse(*out);
}

} // namespace

TEST_CASE("initialize echoes a supported protocol version, else the newest") {
    Fixture fixture;
    const auto known = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26"}})");
    CHECK(known["result"]["protocolVersion"] == "2025-03-26");
    CHECK(known["result"]["capabilities"] == afd::Json{{"tools", {{"listChanged", false}}}});
    CHECK(known["result"]["serverInfo"]["name"] == "afd-todo-cpp");
    const auto newest = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}})");
    CHECK(newest["result"]["protocolVersion"] == "2025-11-25");
    const auto unknown = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}})");
    CHECK(unknown["result"]["protocolVersion"] == "2025-11-25");
    // Legacy results carry no resultType.
    CHECK_FALSE(
        reply(fixture, R"({"jsonrpc":"2.0","id":3,"method":"tools/list"})")["result"].contains(
            "resultType"));
}

TEST_CASE("MCP 2026-07-28 requests are served statelessly from their _meta") {
    Fixture fixture;
    const auto discover = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":"d","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(discover["result"]["resultType"] == "complete");
    CHECK(discover["result"]["supportedVersions"] == afd::Json::array({"2026-07-28"}));
    CHECK(discover["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] ==
          "afd-todo-cpp");

    const auto tools = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(tools["result"]["resultType"] == "complete");
    CHECK(tools["result"]["ttlMs"] == 300000);
    CHECK(tools["result"]["cacheScope"] == "public");
    CHECK(tools["result"]["tools"].size() == 11);

    const auto created = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":"Modern"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(created["result"]["resultType"] == "complete");
    CHECK(created["result"]["isError"] == false);

    const auto unsupported = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2099-01-01","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(unsupported["error"]["code"] == -32022);
    CHECK(unsupported["error"]["data"]["supported"] == afd::Json::array({"2026-07-28"}));

    const auto no_capabilities = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":4,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}})");
    CHECK(no_capabilities["error"]["code"] == -32602);

    const auto ping = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":5,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})");
    CHECK(ping["error"]["code"] == -32601);
}

TEST_CASE("notifications get no reply; ping and tools/list do") {
    Fixture fixture;
    CHECK_FALSE(todo::handle_message(*fixture.registry,
                                     R"({"jsonrpc":"2.0","method":"notifications/initialized"})"));
    CHECK(reply(fixture, R"({"jsonrpc":"2.0","id":"p","method":"ping"})")["result"] ==
          afd::Json::object());
    const auto tools =
        reply(fixture, R"({"jsonrpc":"2.0","id":2,"method":"tools/list"})")["result"]["tools"];
    CHECK(tools.size() == 11);
    CHECK(tools[0].contains("inputSchema"));
}

TEST_CASE("tools/call returns the CommandResult as text, with isError = !success") {
    Fixture fixture;
    const auto ok = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":"From MCP"}}})");
    CHECK(ok["result"]["isError"] == false);
    const auto body = afd::Json::parse(ok["result"]["content"][0]["text"].get<std::string>());
    CHECK(body["data"]["title"] == "From MCP");
    CHECK(body["metadata"]["traceId"].get<std::string>().rfind("trace-", 0) == 0);

    // Invalid arguments and unknown tools are CommandResults, never JSON-RPC errors.
    const auto invalid = reply(
        fixture,
        R"({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":123}}})");
    CHECK(invalid["result"]["isError"] == true);
    CHECK(afd::Json::parse(
              invalid["result"]["content"][0]["text"].get<std::string>())["error"]["code"] ==
          "VALIDATION_ERROR");
    const auto unknown =
        reply(fixture,
              R"({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"todo-crate"}})");
    CHECK(unknown["result"]["isError"] == true);
    CHECK(afd::Json::parse(
              unknown["result"]["content"][0]["text"].get<std::string>())["error"]["code"] ==
          "COMMAND_NOT_FOUND");
}

TEST_CASE("protocol errors") {
    Fixture fixture;
    CHECK(reply(fixture, "{not json")["error"]["code"] == -32700);
    CHECK(reply(fixture, "[]")["error"]["code"] == -32600);
    CHECK(reply(fixture, R"({"jsonrpc":"2.0","id":6})")["error"]["code"] == -32600);
    CHECK(
        reply(fixture, R"({"jsonrpc":"2.0","id":7,"method":"resources/list"})")["error"]["code"] ==
        -32601);
}

TEST_CASE("serve answers each request line and stops at EOF") {
    Fixture fixture;
    std::istringstream in("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n"
                          "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\r\n"
                          "\n"
                          "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/"
                          "call\",\"params\":{\"name\":\"todo-stats\"}}");
    std::ostringstream out;
    todo::serve(*fixture.registry, in, out);
    std::istringstream lines(out.str());
    std::string first;
    std::string second;
    std::string third;
    std::getline(lines, first);
    std::getline(lines, second);
    CHECK_FALSE(std::getline(lines, third));
    CHECK(afd::Json::parse(first)["id"] == 1);
    CHECK(afd::Json::parse(second)["id"] == 2);
}

TEST_CASE("an oversized line is rejected without buffering it") {
    Fixture fixture;
    std::istringstream in(std::string(2048, 'x') +
                          "\n{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}\n");
    std::ostringstream out;
    todo::serve(*fixture.registry, in, out, {.max_line_bytes = 1024});
    std::istringstream lines(out.str());
    std::string first;
    std::string second;
    std::getline(lines, first);
    std::getline(lines, second);
    CHECK(afd::Json::parse(first)["error"]["message"] == "Message too large");
    CHECK(afd::Json::parse(second)["id"] == 9);
}
