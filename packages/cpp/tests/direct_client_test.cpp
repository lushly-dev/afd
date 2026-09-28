// Behavior cases from the TypeScript DirectClient (packages/client/src/direct.ts).
#include "afd/afd.hpp"

#include <memory>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

struct Fixture {
    std::shared_ptr<afd::ManualClock> clock = std::make_shared<afd::ManualClock>(1767225600000);
    std::shared_ptr<afd::CommandRegistry> registry = std::make_shared<afd::CommandRegistry>();
    std::vector<afd::CommandContext> seen;

    Fixture() {
        add("todo-list", afd::ExposeOptions{}, 0);
        add("todo-slow", afd::ExposeOptions{}, 250);
        add("admin-reset", afd::ExposeOptions{.agent = false}, 0);
    }

    void add(std::string name, afd::ExposeOptions expose, double duration_ms) {
        const auto error = registry->register_command(afd::CommandDefinition{
            .name = std::move(name),
            .description = "A command",
            .handler =
                [this, duration_ms](const afd::Json&, afd::CommandContext& context) {
                    clock->advance(duration_ms);
                    seen.push_back(context);
                    return afd::success(afd::Json::array());
                },
            .expose = expose,
        });
        REQUIRE_FALSE(error.has_value());
    }

    afd::DirectClient client(afd::DirectClientOptions options = {}) {
        options.clock = clock;
        options.random = std::make_shared<afd::SeededRandom>(7);
        return afd::DirectClient(registry, std::move(options));
    }
};

} // namespace

TEST_CASE("the client sees only commands exposed to its surface") {
    Fixture fixture;
    const auto client = fixture.client();
    CHECK(client.list_command_names() == std::vector<std::string>{"todo-list", "todo-slow"});
    CHECK(client.has_command("todo-list"));
    CHECK_FALSE(client.has_command("admin-reset"));
}

TEST_CASE("an unknown or hidden command is UNKNOWN_TOOL with structured recovery data") {
    Fixture fixture;
    const auto client = fixture.client();
    const auto hidden = client.call("admin-reset");
    CHECK(hidden.error->code == "UNKNOWN_TOOL");
    CHECK(hidden.error->message == "Tool 'admin-reset' not found in registry");
    CHECK(hidden.error->retryable == false);

    const auto typo = client.call("todo-lst");
    CHECK(typo.error->suggestion == "Did you mean 'todo-list'?");
    REQUIRE(typo.data.has_value());
    CHECK(*typo.data == afd::Json::parse(R"({"error":"UNKNOWN_TOOL",
        "message":"Tool 'todo-lst' not found in registry","requested_tool":"todo-lst",
        "available_tools":["todo-list","todo-slow"],"suggestions":["todo-list","todo-slow"],
        "hint":"Did you mean 'todo-list'?"})"));
}

TEST_CASE("allow restricts the client further") {
    Fixture fixture;
    const auto client =
        fixture.client({.allow = [](std::string_view name) { return name != "todo-slow"; }});
    const auto blocked = client.call("todo-slow");
    CHECK(blocked.error->code == "COMMAND_NOT_ALLOWED");
    CHECK(blocked.error->message == "Command 'todo-slow' is not allowed for this client");
    CHECK(client.list_command_names() == std::vector<std::string>{"todo-list"});
}

TEST_CASE("calls carry a trace ID, the client's surface and its source") {
    Fixture fixture;
    const auto client = fixture.client({.source = "chat-panel"});
    CHECK(client.call("todo-list").success);
    REQUIRE(fixture.seen.size() == 1);
    const auto& context = fixture.seen.front();
    REQUIRE(context.trace_id.has_value());
    CHECK(context.trace_id->rfind("trace-1767225600000-", 0) == 0);
    CHECK(context.trace_id->size() == std::string("trace-1767225600000-").size() + 7);
    CHECK(context.surface == afd::Interface::agent);
    CHECK(context.extra["source"] == "chat-panel");

    afd::CommandContext given;
    given.trace_id = "caller-trace";
    CHECK(client.call("todo-list", afd::Json::object(), given).metadata->trace_id ==
          "caller-trace");
}

TEST_CASE("a call that finishes past its timeout returns TIMEOUT") {
    Fixture fixture;
    const auto client = fixture.client();
    afd::CommandContext context;
    context.timeout_ms = 100;
    const afd::Json late = client.call("todo-slow", afd::Json::object(), context);
    CHECK(late == afd::Json::parse(R"({"success":false,"error":{"code":"TIMEOUT",
        "message":"Command 'todo-slow' timed out after 100ms",
        "suggestion":"Retry with a larger timeout. The command was signalled to abort but may have completed, so check its effect before retrying a mutation.",
        "retryable":true,"details":{"command":"todo-slow","timeoutMs":100}}})"));
    // The handler saw the deadline on its cancellation token.
    REQUIRE(fixture.seen.back().cancellation.deadline_ms().has_value());
    CHECK(*fixture.seen.back().cancellation.deadline_ms() == doctest::Approx(100.0));

    context.timeout_ms = 1000;
    CHECK(client.call("todo-slow", afd::Json::object(), context).success);
}

TEST_CASE("a timeout keeps the caller's cancellation") {
    Fixture fixture;
    afd::CancellationSource caller;
    bool observed = false;
    REQUIRE_FALSE(fixture.registry
                      ->register_command(afd::CommandDefinition{
                          .name = "todo-watch",
                          .description = "A command",
                          .handler =
                              [&](const afd::Json&, afd::CommandContext& context) {
                                  caller.cancel(); // The caller cancels while the command runs.
                                  observed = context.cancellation.is_cancelled();
                                  return afd::failure(afd::create_error(
                                      afd::error_codes::COMMAND_CANCELLED, "Cancelled",
                                      {.suggestion = "Retry the command"}));
                              },
                      })
                      .has_value());
    const auto client = fixture.client();
    afd::CommandContext context;
    context.cancellation = caller.token();
    context.timeout_ms = 1000;
    const auto result = client.call("todo-watch", afd::Json::object(), context);
    CHECK(observed);
    // The deadline has not passed, so the call returns the handler's result, not TIMEOUT.
    CHECK(result.error->code == "COMMAND_CANCELLED");
}

TEST_CASE("a pipe step with a timeout keeps the pipeline's deadline") {
    Fixture fixture;
    bool observed = false;
    REQUIRE_FALSE(fixture.registry
                      ->register_command(afd::CommandDefinition{
                          .name = "todo-watch",
                          .description = "A command",
                          .handler =
                              [&](const afd::Json&, afd::CommandContext& context) {
                                  fixture.clock->advance(250);
                                  observed = context.cancellation.is_cancelled();
                                  return afd::success(afd::Json::array());
                              },
                      })
                      .has_value());
    const auto client = fixture.client();
    afd::CommandContext context;
    context.timeout_ms = 1000;
    const auto result = client.pipe(afd::Json::parse(R"({"steps":[{"command":"todo-watch"}],
        "options":{"timeoutMs":100}})"),
                                    context);
    // The step's own 1000ms timeout has not passed, but the pipeline's 100ms deadline has.
    CHECK(observed);
    CHECK(result.steps[0].error->code == "PIPELINE_TIMEOUT");
}

TEST_CASE("client middleware wraps the registry") {
    Fixture fixture;
    std::vector<std::string> order;
    const auto client =
        fixture.client({.middleware = {[&](std::string_view name, const afd::Json&,
                                           afd::CommandContext&, const afd::Next& next) {
                            order.push_back("client:" + std::string(name));
                            return next();
                        }}});
    CHECK(client.call("todo-list").success);
    CHECK(order == std::vector<std::string>{"client:todo-list"});
}
