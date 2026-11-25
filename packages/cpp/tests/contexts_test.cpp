// Contexts and the context commands (afd/contexts.hpp), in process. The MCP server's use of them
// is in mcp_stdio_test.cpp.
#include "afd/afd.hpp"

#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include <doctest.h>

using afd::Json;

namespace {

std::vector<afd::ContextConfig> two_contexts() {
    return {{.name = "reading", .description = "Read only", .triggers = {"review"}},
            {.name = "editing", .description = "Change things", .priority = 5}};
}

std::unique_ptr<afd::CommandRegistry> with_contexts() {
    auto registry = std::make_unique<afd::CommandRegistry>();
    REQUIRE_FALSE(afd::register_context_commands(*registry, two_contexts()));
    REQUIRE_FALSE(registry->register_command(
        {.name = "note-delete",
         .description = "Delete a note",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
         .contexts = {"editing"},
         .mutation = true}));
    return registry;
}

Json run(const afd::CommandRegistry& registry, std::string_view name, Json input,
         std::shared_ptr<const afd::ContextScope> scope = nullptr) {
    afd::CommandContext context;
    if (scope) {
        context.active_context = scope->active();
    }
    context.context_scope = std::move(scope);
    return Json(registry.execute(name, input, std::move(context)));
}

} // namespace

TEST_CASE("a context stack enters, re-enters as a no-op, exits and stops at its depth") {
    afd::ContextStack stack(2);
    CHECK_FALSE(stack.active());
    CHECK(stack.enter("a"));
    CHECK(stack.enter("a"));
    CHECK(stack.entries() == std::vector<std::string>{"a"});
    CHECK(stack.enter("b"));
    CHECK_FALSE(stack.enter("c"));
    CHECK(stack.active() == "b");
    CHECK(stack.exit() == "b");
    CHECK(stack.exit() == "a");
    CHECK_FALSE(stack.exit());
    CHECK(afd::ContextStack(0).max_depth() == 1);
}

TEST_CASE("register_context_commands refuses what other languages refuse") {
    afd::CommandRegistry registry;
    CHECK(afd::register_context_commands(registry, {}) == "Configure at least one context");
    CHECK(afd::register_context_commands(registry, {{.name = " "}}) ==
          "Context names must not be blank");
    CHECK(afd::register_context_commands(registry, {{.name = "a"}, {.name = "a"}}) ==
          "Context 'a' is configured twice");
    REQUIRE_FALSE(afd::register_context_commands(registry, {{.name = "a"}}));
    CHECK(afd::register_context_commands(registry, {{.name = "b"}}) ==
          "Reserved context command name: afd-context-list");

    const auto list = registry.get("afd-context-list");
    REQUIRE(list);
    CHECK(list->definition.category == "bootstrap");
    CHECK(list->definition.expose.mcp);
    CHECK_FALSE(list->definition.mutation);
    CHECK(registry.get("afd-context-enter")->definition.mutation);
}

TEST_CASE("afd-context-list lists by priority, then as configured, with the active context") {
    const auto owned = with_contexts();
    const auto& registry = *owned;
    const auto none = run(registry, "afd-context-list", Json::object());
    CHECK(none["data"]["contexts"] ==
          Json::array({Json{{"name", "editing"}, {"description", "Change things"}, {"priority", 5}},
                       Json{{"name", "reading"},
                            {"description", "Read only"},
                            {"triggers", Json::array({"review"})}}}));
    CHECK(none["data"]["activeContext"].is_null());
    CHECK(none["reasoning"] == "Found 2 configured contexts. Active: none");

    auto session = std::make_shared<afd::ContextStack>();
    session->enter("reading");
    const auto active =
        run(registry, "afd-context-list", Json::object(),
            std::make_shared<const afd::ContextScope>(afd::ContextScope{.session = session}));
    CHECK(active["data"]["activeContext"] == "reading");
}

TEST_CASE("a session's stack is changed by enter and exit") {
    const auto owned = with_contexts();
    const auto& registry = *owned;
    auto session = std::make_shared<afd::ContextStack>();
    const auto scope =
        std::make_shared<const afd::ContextScope>(afd::ContextScope{.session = session});

    const auto entered = run(registry, "afd-context-enter", {{"context", "reading"}}, scope);
    CHECK(entered["data"] == Json{{"entered", "reading"}, {"previous", nullptr}});
    CHECK(entered["reasoning"] == "Entered context 'reading'");
    CHECK(session->active() == "reading");

    // A command outside the active context, named with the context tools.
    const auto refused = run(registry, "note-delete", Json::object(), scope);
    CHECK(refused["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
    CHECK(refused["error"]["message"] ==
          "Command 'note-delete' is not available in context 'reading'");
    CHECK(refused["error"]["suggestion"] ==
          "Use afd-context-list to see available contexts, or afd-context-enter to switch.");
    CHECK(refused["error"].value("recovery", Json()) ==
          Json{{"kind", "call"}, {"command", "afd-context-list"}});

    const auto again = run(registry, "afd-context-enter", {{"context", "reading"}}, scope);
    CHECK(again["reasoning"] == "Already in context 'reading'; nothing changed");
    const auto switched = run(registry, "afd-context-enter", {{"context", "editing"}}, scope);
    CHECK(switched["data"]["previous"] == "reading");
    CHECK(switched["reasoning"] == "Entered context 'editing' (was 'reading')");

    const auto unknown = run(registry, "afd-context-enter", {{"context", "nowhere"}}, scope);
    CHECK(unknown["error"]["code"] == "CONTEXT_NOT_FOUND");
    CHECK(unknown["error"]["suggestion"] ==
          "Available contexts: reading, editing. Use afd-context-list to see all contexts.");
    // Recovery: list the contexts (spec/recovery.md, "Engine errors").
    CHECK(unknown["error"].value("recovery", Json()) ==
          Json{{"kind", "call"}, {"command", "afd-context-list"}});
    CHECK(unknown["error"]["retryable"] == false);

    CHECK(run(registry, "afd-context-exit", Json::object(), scope)["reasoning"] ==
          "Exited context 'editing', now in 'reading'");
    const auto last = run(registry, "afd-context-exit", Json::object(), scope);
    CHECK(last["data"] == Json{{"exited", "reading"}, {"current", nullptr}});
    CHECK(last["reasoning"] == "Exited context 'reading', no active context");
    CHECK(run(registry, "afd-context-exit", Json::object(), scope)["reasoning"] ==
          "No active context to exit");
}

TEST_CASE("a full stack refuses another context") {
    const auto owned = with_contexts();
    const auto& registry = *owned;
    auto session = std::make_shared<afd::ContextStack>(1);
    const auto scope =
        std::make_shared<const afd::ContextScope>(afd::ContextScope{.session = session});
    run(registry, "afd-context-enter", {{"context", "reading"}}, scope);
    const auto full = run(registry, "afd-context-enter", {{"context", "editing"}}, scope);
    CHECK(full["error"]["code"] == "CONTEXT_DEPTH_EXCEEDED");
    CHECK(full["error"]["message"] == "Context stack is limited to 1 levels");
    // Recovery: leave a context, then enter again (spec/recovery.md, "Engine errors").
    CHECK(full["error"].value("recovery", Json()) ==
          Json{{"kind", "call"}, {"command", "afd-context-exit"}, {"thenRetry", true}});
    CHECK(full["error"]["retryable"] == false);
}

TEST_CASE("one request's context is validated, never changed") {
    const auto owned = with_contexts();
    const auto& registry = *owned;
    const auto scope =
        std::make_shared<const afd::ContextScope>(afd::ContextScope{.request = "reading"});
    const auto entered = run(registry, "afd-context-enter", {{"context", "editing"}}, scope);
    CHECK(entered["data"] ==
          Json{{"entered", "editing"}, {"previous", "reading"}, {"persisted", false}});
    CHECK(entered["reasoning"].get<std::string>().find("do not persist") != std::string::npos);
    const auto exited = run(registry, "afd-context-exit", Json::object(), scope);
    CHECK(exited["data"] ==
          Json{{"exited", nullptr}, {"current", "reading"}, {"persisted", false}});
}

TEST_CASE("in process, with no session, enter and exit need one") {
    const auto owned = with_contexts();
    const auto& registry = *owned;
    for (const auto* name : {"afd-context-enter", "afd-context-exit"}) {
        const auto result = run(registry, name, {{"context", "reading"}});
        CHECK(result["error"]["code"] == "SESSION_REQUIRED");
        CHECK(result["error"]["retryable"] == false);
    }
}

TEST_CASE("without context tools, COMMAND_NOT_IN_CONTEXT names the command's contexts") {
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "note-delete",
         .description = "Delete a note",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
         .contexts = {"editing"}}));
    afd::CommandContext context;
    context.active_context = "reading";
    const Json result(registry.execute("note-delete", Json::object(), context));
    CHECK(result["error"]["suggestion"] ==
          "Switch to a context this command belongs to ('editing'), or call it with no active "
          "context.");
    // No command the caller can call does it: no recovery (spec/recovery.md, "Engine errors").
    CHECK_FALSE(result["error"].contains("recovery"));
}

TEST_CASE("COMMAND_NOT_IN_CONTEXT names afd-context-list only where the caller can call it") {
    // note-delete is exposed to MCP and the CLI; the context commands are not exposed to the CLI.
    auto owned = std::make_shared<afd::CommandRegistry>();
    REQUIRE_FALSE(afd::register_context_commands(*owned, two_contexts()));
    REQUIRE_FALSE(owned->register_command(
        {.name = "note-delete",
         .description = "Delete a note",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
         .contexts = {"editing"},
         .expose = {.mcp = true, .cli = true}}));
    const std::shared_ptr<const afd::CommandRegistry> registry = owned;
    const std::string contexts_text =
        "Switch to a context this command belongs to ('editing'), or call it with no active "
        "context.";
    const auto refused = [](const afd::CommandResult& result) {
        REQUIRE(result.error);
        CHECK(result.error->code == "COMMAND_NOT_IN_CONTEXT");
        return *result.error;
    };
    afd::CommandContext reading;
    reading.active_context = "reading";

    SUBCASE("a surface the context commands are not exposed to") {
        afd::CommandContext cli = reading;
        cli.surface = afd::Interface::cli;
        const auto error = refused(owned->execute("note-delete", Json::object(), cli));
        CHECK(error.suggestion == contexts_text);
        CHECK_FALSE(error.recovery);
    }
    SUBCASE("a DirectClient whose allow list refuses afd-context-list") {
        afd::DirectClient client(
            registry, {.surface = afd::Interface::mcp,
                       .allow = [](std::string_view name) { return name != "afd-context-list"; }});
        const auto error = refused(client.call("note-delete", Json::object(), reading));
        CHECK(error.suggestion == contexts_text);
        CHECK_FALSE(error.recovery);
    }
    SUBCASE("a DirectClient whose allow list refuses only afd-context-enter") {
        afd::DirectClient client(
            registry, {.surface = afd::Interface::mcp,
                       .allow = [](std::string_view name) { return name != "afd-context-enter"; }});
        const auto error = refused(client.call("note-delete", Json::object(), reading));
        // The second clause names afd-context-enter, so it goes with it; the recovery stays.
        CHECK(error.suggestion == "Use afd-context-list to see available contexts.");
        CHECK(error.recovery ==
              afd::Recovery{.kind = afd::RecoveryKind::call, .command = "afd-context-list"});
    }
    SUBCASE("a DirectClient whose allow list admits it") {
        afd::DirectClient client(registry, {.surface = afd::Interface::mcp});
        const auto error = refused(client.call("note-delete", Json::object(), reading));
        CHECK(error.suggestion ==
              "Use afd-context-list to see available contexts, or afd-context-enter to switch.");
        CHECK(error.recovery ==
              afd::Recovery{.kind = afd::RecoveryKind::call, .command = "afd-context-list"});
    }
}

TEST_CASE("afd-context-enter names the context command it sends to only where the caller can call "
          "it") {
    auto owned = std::make_shared<afd::CommandRegistry>();
    REQUIRE_FALSE(afd::register_context_commands(*owned, two_contexts()));
    const std::shared_ptr<const afd::CommandRegistry> registry = owned;
    auto session = std::make_shared<afd::ContextStack>(1);
    const auto scope =
        std::make_shared<const afd::ContextScope>(afd::ContextScope{.session = session});
    const auto enter = [&](const afd::DirectClient& client, const std::string& name) {
        afd::CommandContext context;
        context.context_scope = scope;
        context.active_context = scope->active();
        const auto result = client.call("afd-context-enter", {{"context", name}}, context);
        REQUIRE(result.error);
        return *result.error;
    };

    SUBCASE("CONTEXT_NOT_FOUND, with afd-context-list refused") {
        const afd::DirectClient client(
            registry, {.surface = afd::Interface::mcp,
                       .allow = [](std::string_view name) { return name != "afd-context-list"; }});
        const auto error = enter(client, "nowhere");
        CHECK(error.code == "CONTEXT_NOT_FOUND");
        CHECK(error.suggestion == "Available contexts: reading, editing.");
        CHECK_FALSE(error.recovery);
    }
    SUBCASE("CONTEXT_NOT_FOUND, with afd-context-list admitted") {
        const afd::DirectClient client(
            registry, {.surface = afd::Interface::mcp,
                       .allow = [](std::string_view name) { return name != "afd-context-exit"; }});
        const auto error = enter(client, "nowhere");
        CHECK(error.suggestion ==
              "Available contexts: reading, editing. Use afd-context-list to see all contexts.");
        CHECK(error.recovery ==
              afd::Recovery{.kind = afd::RecoveryKind::call, .command = "afd-context-list"});
    }
    SUBCASE("CONTEXT_DEPTH_EXCEEDED, with afd-context-exit refused") {
        REQUIRE(session->enter("reading"));
        const afd::DirectClient client(
            registry, {.surface = afd::Interface::mcp,
                       .allow = [](std::string_view name) { return name != "afd-context-exit"; }});
        const auto error = enter(client, "editing");
        CHECK(error.code == "CONTEXT_DEPTH_EXCEEDED");
        CHECK(error.suggestion == "Leave a context before entering another");
        CHECK_FALSE(error.recovery);
        CHECK_FALSE(error.retryable.value_or(true));
    }
    SUBCASE("CONTEXT_DEPTH_EXCEEDED, with afd-context-exit admitted") {
        REQUIRE(session->enter("reading"));
        const afd::DirectClient client(
            registry, {.surface = afd::Interface::mcp,
                       .allow = [](std::string_view name) { return name != "afd-context-list"; }});
        const auto error = enter(client, "editing");
        CHECK(error.suggestion ==
              "Call afd-context-exit to leave a context before entering another");
        CHECK(error.recovery == afd::Recovery{.kind = afd::RecoveryKind::call,
                                              .command = "afd-context-exit",
                                              .then_retry = true});
    }
}

TEST_CASE("a call with a context scope runs in the scope's context, whatever active_context says") {
    const auto owned = with_contexts();
    auto session = std::make_shared<afd::ContextStack>();
    session->enter("reading");
    afd::CommandContext context;
    context.active_context = "editing";
    context.context_scope =
        std::make_shared<const afd::ContextScope>(afd::ContextScope{.session = session});
    const Json result(owned->execute("note-delete", Json::object(), std::move(context)));
    CHECK(result["error"]["code"] == "COMMAND_NOT_IN_CONTEXT");
}
