// Handoff helpers from packages/core/src/handoff.ts.
#include "afd/afd.hpp"

#include <doctest.h>

TEST_CASE("create_handoff always carries a reconnect policy") {
    const afd::Json handoff =
        afd::create_handoff({.protocol = "websocket", .endpoint = "wss://example.com/chat"});
    CHECK(handoff ==
          afd::Json::parse(R"({"protocol":"websocket","endpoint":"wss://example.com/chat",
        "metadata":{"reconnect":{"allowed":true,"maxAttempts":3,"backoffMs":1000}}})"));

    afd::HandoffMetadata metadata;
    metadata.reconnect = afd::ReconnectPolicy{.allowed = false};
    metadata.capabilities = std::vector<std::string>{"text"};
    const afd::Json custom =
        afd::create_handoff({.protocol = "sse",
                             .endpoint = "https://example.com/events",
                             .credentials = afd::HandoffCredentials{.token = "t"},
                             .metadata = metadata});
    CHECK(custom["metadata"]["reconnect"] == afd::Json{{"allowed", false}});
    CHECK(custom["credentials"] == afd::Json{{"token", "t"}});
}

TEST_CASE("handoff results round-trip and are recognized by shape") {
    const afd::Json wire = afd::Json::parse(R"({"protocol":"webrtc","endpoint":"https://x/offer",
        "credentials":{"token":"a","headers":{"X-Key":"k"},"sessionId":"s1"},
        "metadata":{"expectedLatency":50,"capabilities":["audio"],"expiresAt":"2026-01-01T00:00:00.000Z",
                    "reconnect":{"allowed":true,"maxAttempts":5},"description":"Voice"}})");
    const auto parsed = afd::HandoffResult::from_json(wire);
    REQUIRE(parsed.has_value());
    CHECK(afd::Json(*parsed) == wire);
    CHECK(afd::is_handoff(wire));
    CHECK(afd::is_handoff_protocol(*parsed, "webrtc"));

    CHECK_FALSE(afd::is_handoff(afd::Json{{"protocol", ""}, {"endpoint", "x"}}));
    CHECK_FALSE(afd::is_handoff(afd::Json{
        {"protocol", "sse"}, {"endpoint", "x"}, {"metadata", {{"reconnect", {{"allowed", 1}}}}}}));
    CHECK(afd::is_reconnect_policy(afd::Json{{"allowed", true}}));
    CHECK_FALSE(afd::is_reconnect_policy(afd::Json{{"allowed", true}, {"backoffMs", "fast"}}));
    CHECK(afd::HandoffResult::from_json(afd::Json{{"protocol", "sse"},
                                                  {"endpoint", "x"},
                                                  {"credentials", {{"headers", {{"a", 1}}}}}})
              .error() == "credentials.headers.a: expected a string");
}

TEST_CASE("handoff commands and their protocol") {
    afd::CommandDefinition by_flag{.name = "chat-connect",
                                   .description = "d",
                                   .handoff = true,
                                   .handoff_protocol = "websocket"};
    CHECK(afd::is_handoff_command(by_flag));
    CHECK(afd::get_handoff_protocol(by_flag) == "websocket");

    afd::CommandDefinition by_tag{
        .name = "feed-watch", .description = "d", .tags = {"handoff", "handoff:sse"}};
    CHECK(afd::is_handoff_command(by_tag));
    CHECK(afd::get_handoff_protocol(by_tag) == "sse");

    afd::CommandDefinition plain{.name = "todo-list", .description = "d"};
    CHECK_FALSE(afd::is_handoff_command(plain));
    CHECK_FALSE(afd::get_handoff_protocol(plain).has_value());
}
