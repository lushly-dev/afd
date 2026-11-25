// Behavior cases from the TypeScript engine (packages/server/src/execution.ts): dispatch order,
// errors, middleware and metadata.
#include "afd/afd.hpp"

#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include <doctest.h>

namespace {

afd::Json todo_input_schema() {
    return afd::Json::parse(
        R"({"type":"object","properties":{"title":{"type":"string","minLength":1}},
                                "required":["title"]})");
}

afd::CommandDefinition echo_command(std::string name = "todo-create") {
    return afd::CommandDefinition{
        .name = std::move(name),
        .description = "Create a todo",
        .input_schema = todo_input_schema(),
        .handler = [](const afd::Json& input, afd::CommandContext&) { return afd::success(input); },
        .version = "1.2.0",
    };
}

void add(afd::CommandRegistry& registry, afd::CommandDefinition command) {
    const auto error = registry.register_command(std::move(command));
    REQUIRE_MESSAGE(!error, error.value_or(""));
}

afd::Json as_json(const afd::CommandResult& result) {
    return result;
}

} // namespace

TEST_CASE("register_command rejects invalid, reserved, duplicate and incomplete commands") {
    afd::CommandRegistry registry;
    add(registry, echo_command());

    CHECK(registry.register_command(echo_command("todo")) ==
          "Command name 'todo' must use kebab-case with at least two segments (e.g., "
          "'domain-action'). Got 'todo'.");
    CHECK(registry.register_command(echo_command("afd-batch"))->find("is reserved") !=
          std::string::npos);
    CHECK(registry.register_command(echo_command())->find("Duplicate command name 'todo-create'") ==
          0);

    auto no_handler = echo_command("todo-delete");
    no_handler.handler = nullptr;
    CHECK(registry.register_command(no_handler) == "Command 'todo-delete' has no handler");

    auto bad_schema = echo_command("todo-update");
    bad_schema.input_schema = {{"type", "string"}, {"pattern", "^x"}};
    CHECK(registry.register_command(bad_schema)->find("unsupported input schema") !=
          std::string::npos);

    auto bad_example = echo_command("todo-toggle");
    bad_example.examples = {{"No title", afd::Json::object()}};
    CHECK(
        registry.register_command(bad_example) ==
        "Example \"No title\" for command \"todo-toggle\" fails schema validation: title: Invalid "
        "input: expected string, received undefined");
}

TEST_CASE("built-in tool names: the shared list and its predicate") {
    static_assert(afd::is_afd_builtin_name("afd-call"));
    static_assert(!afd::is_afd_builtin_name("todo-create"));

    std::vector<std::string_view> combined;
    combined.insert(combined.end(), std::begin(afd::afd_meta_tool_names),
                    std::end(afd::afd_meta_tool_names));
    combined.insert(combined.end(), std::begin(afd::afd_bootstrap_command_names),
                    std::end(afd::afd_bootstrap_command_names));
    combined.insert(combined.end(), std::begin(afd::afd_context_command_names),
                    std::end(afd::afd_context_command_names));
    CHECK(combined == std::vector<std::string_view>(std::begin(afd::afd_builtin_tool_names),
                                                    std::end(afd::afd_builtin_tool_names)));

    for (std::string_view name : {"afd-detail", "afd-help", "afd-context-enter"}) {
        CHECK(afd::is_afd_builtin_name(name));
    }
    for (std::string_view name : {"afd", "afd-custom", "AFD-CALL", "todo"}) {
        CHECK_FALSE(afd::is_afd_builtin_name(name));
    }

    // Registration rejects every meta-tool name.
    afd::CommandRegistry registry;
    for (std::string_view name : afd::afd_meta_tool_names) {
        CHECK(registry.register_command(echo_command(std::string(name)))->find("is reserved") !=
              std::string::npos);
    }
}

TEST_CASE(
    "an unknown command gets COMMAND_NOT_FOUND with close matches, never echoing long names") {
    afd::CommandRegistry registry;
    add(registry, echo_command("todo-create"));
    add(registry, echo_command("todo-update"));

    const auto typo = registry.execute("todo-crate");
    REQUIRE(typo.error.has_value());
    CHECK(typo.error->code == "COMMAND_NOT_FOUND");
    CHECK(typo.error->message == "Command 'todo-crate' not found");
    CHECK(typo.error->suggestion ==
          "Did you mean 'todo-create'? Other close matches: 'todo-update'. Check the command name "
          "against the available commands.");
    CHECK_FALSE(typo.metadata.has_value());

    const auto nothing_close = registry.execute("zzzz-zzzz");
    CHECK(nothing_close.error->suggestion ==
          "Check the command name against the available commands.");
    // Spelling a name correctly is the caller's own step: no recovery (spec/recovery.md).
    CHECK_FALSE(nothing_close.error->recovery.has_value());

    const auto huge = registry.execute(std::string(10000, 'x'));
    CHECK(huge.error->message == "Command '" + std::string(128, 'x') + "…' not found");
    CHECK(huge.error->suggestion == "Check the command name against the available commands.");

    // Suggestions name only tools the host provides (spec/error-codes.md, D4): C++ has no
    // afd-discover, so a registered afd-help is named instead.
    add(registry, echo_command("afd-help"));
    const auto with_help = registry.execute("zzzz-zzzz");
    CHECK(with_help.error->suggestion == "Use afd-help to list all commands.");
    CHECK(with_help.error->recovery ==
          afd::Recovery{.kind = afd::RecoveryKind::call, .command = "afd-help"});
    // afd-help hidden from the caller's surface is neither named nor the recovery (rule 2).
    afd::CommandContext cli;
    cli.surface = afd::Interface::cli;
    const auto hidden_help = registry.execute("zzzz-zzzz", afd::Json::object(), cli);
    CHECK(hidden_help.error->suggestion ==
          "Check the command name against the available commands.");
    CHECK_FALSE(hidden_help.error->recovery.has_value());
}

TEST_CASE("exposure: a surface only reaches commands exposed to it") {
    afd::CommandRegistry registry;
    auto hidden = echo_command("admin-reset");
    hidden.expose = afd::ExposeOptions{.agent = false};
    add(registry, hidden);
    add(registry, echo_command("todo-create"));

    afd::CommandContext agent;
    agent.surface = afd::Interface::agent;
    const auto blocked = registry.execute("admin-reset", {{"title", "x"}}, agent);
    CHECK(as_json(blocked) == afd::Json::parse(R"({"success":false,"error":{
        "code":"COMMAND_NOT_EXPOSED","message":"Command 'admin-reset' is not exposed to agent",
        "suggestion":"Use one of the commands exposed to agent: todo-create","retryable":false,
        "recovery":{"kind":"external"}}})"));

    // A hidden command is never offered as a suggestion.
    const auto typo = registry.execute("admin-rese", afd::Json::object(), agent);
    CHECK(typo.error->suggestion == "Check the command name against the available commands.");

    // Without a surface, exposure is not checked (a trusted, in-process caller).
    CHECK(registry.execute("admin-reset", {{"title", "x"}}).success);

    afd::CommandContext mcp;
    mcp.surface = afd::Interface::mcp;
    CHECK(registry.execute("todo-create", {{"title", "x"}}, mcp).error->suggestion ==
          "No commands are exposed to mcp; set expose.mcp on the commands it should call");
}

TEST_CASE("a handler that re-enters the registry names only what its client's allow list admits") {
    // A DirectClient answers an unknown or unexposed name itself, so the registry's not-found
    // candidates and not-exposed list are reached by a handler calling back in with its context,
    // which carries the client's allow list (spec/recovery.md, rule 2).
    auto owned = std::make_shared<afd::CommandRegistry>();
    const afd::ExposeOptions mcp_only{.mcp = true};
    auto help = echo_command("afd-help");
    help.expose = mcp_only;
    add(*owned, help);
    auto create = echo_command("todo-create");
    create.expose = mcp_only;
    add(*owned, create);
    auto hidden = echo_command("admin-reset");
    hidden.expose = afd::ExposeOptions{.mcp = false};
    add(*owned, hidden);
    const afd::CommandRegistry* inner = owned.get();
    add(*owned, afd::CommandDefinition{
                    .name = "probe-run",
                    .description = "Run another command from inside a handler",
                    .input_schema = afd::Json::parse(
                        R"({"type":"object","properties":{"target":{"type":"string"}},
                            "required":["target"]})"),
                    .handler =
                        [inner](const afd::Json& input, afd::CommandContext& context) {
                            return inner->execute(input["target"].get<std::string>(),
                                                  {{"title", "x"}}, context);
                        },
                    .expose = mcp_only,
                });
    const std::shared_ptr<const afd::CommandRegistry> registry = owned;
    const afd::DirectClient client(
        registry, {.surface = afd::Interface::mcp,
                   .allow = [](std::string_view name) { return name != "afd-help"; }});

    const auto missing = client.call("probe-run", {{"target", "zzzz-zzzz"}});
    REQUIRE(missing.error);
    CHECK(missing.error->code == "COMMAND_NOT_FOUND");
    CHECK(missing.error->suggestion == "Check the command name against the available commands.");
    CHECK_FALSE(missing.error->recovery.has_value());

    const auto unexposed = client.call("probe-run", {{"target", "admin-reset"}});
    REQUIRE(unexposed.error);
    CHECK(unexposed.error->code == "COMMAND_NOT_EXPOSED");
    CHECK(unexposed.error->suggestion ==
          "Use one of the commands exposed to mcp: todo-create, probe-run");

    // The same client without the allow list is offered afd-help, so the list above is the cause.
    const afd::DirectClient open(registry, {.surface = afd::Interface::mcp});
    const auto offered = open.call("probe-run", {{"target", "zzzz-zzzz"}});
    REQUIRE(offered.error);
    CHECK(offered.error->suggestion == "Use afd-help to list all commands.");
    CHECK(offered.error->recovery ==
          afd::Recovery{.kind = afd::RecoveryKind::call, .command = "afd-help"});
}

TEST_CASE("contexts: a command outside the active context is unavailable") {
    afd::CommandRegistry registry;
    auto scoped = echo_command("plan-order");
    scoped.contexts = {"planning"};
    add(registry, scoped);

    afd::CommandContext combat;
    combat.active_context = "combat";
    const auto blocked = registry.execute("plan-order", {{"title", "x"}}, combat);
    CHECK(blocked.error->code == "COMMAND_NOT_IN_CONTEXT");
    CHECK(blocked.error->message == "Command 'plan-order' is not available in context 'combat'");
    CHECK(blocked.error->suggestion ==
          "Switch to a context this command belongs to ('planning'), or call it with no active "
          "context.");

    afd::CommandContext planning;
    planning.active_context = "planning";
    CHECK(registry.execute("plan-order", {{"title", "x"}}, planning).success);
}

TEST_CASE("validation runs before middleware and the handler, which get the parsed input") {
    std::vector<std::string> calls;
    afd::CommandRegistry registry(afd::CommandRegistryOptions{
        .middleware = {[&](std::string_view, const afd::Json& input, afd::CommandContext&,
                           const afd::Next& next) {
            calls.push_back("middleware:" + input.dump());
            return next();
        }}});
    add(registry, echo_command());

    const auto invalid = registry.execute("todo-create", {{"title", ""}});
    CHECK(invalid.error->code == "VALIDATION_ERROR");
    CHECK(calls.empty());

    const auto ok = registry.execute("todo-create", {{"title", "x"}, {"undeclared", true}});
    CHECK(ok.success);
    CHECK(*ok.data == afd::Json{{"title", "x"}});
    CHECK(calls == std::vector<std::string>{"middleware:{\"title\":\"x\"}"});
}

TEST_CASE("middleware: first is outermost, may short-circuit, may retry") {
    std::vector<std::string> order;
    const auto tracer = [&](std::string label) {
        return [&order, label](std::string_view, const afd::Json&, afd::CommandContext&,
                               const afd::Next& next) {
            order.push_back(label + ":before");
            auto result = next();
            order.push_back(label + ":after");
            return result;
        };
    };
    afd::CommandRegistry registry(
        afd::CommandRegistryOptions{.middleware = {tracer("outer"), tracer("inner")}});
    add(registry, echo_command());
    CHECK(registry.execute("todo-create", {{"title", "x"}}).success);
    CHECK(order ==
          std::vector<std::string>{"outer:before", "inner:before", "inner:after", "outer:after"});

    afd::CommandRegistry blocking(
        afd::CommandRegistryOptions{.middleware = {[](std::string_view, const afd::Json&,
                                                      afd::CommandContext&, const afd::Next&) {
                                        return afd::error("BLOCKED", "Blocked by policy");
                                    }}});
    int handled = 0;
    auto counted = echo_command();
    counted.handler = [&](const afd::Json& input, afd::CommandContext&) {
        ++handled;
        return afd::success(input);
    };
    add(blocking, counted);
    const auto short_circuit = blocking.execute("todo-create", {{"title", "x"}});
    CHECK(short_circuit.error->code == "BLOCKED");
    CHECK_FALSE(short_circuit.metadata.has_value()); // no stamping without the handler
    CHECK(handled == 0);

    int attempts = 0;
    afd::CommandRegistry retrying(
        afd::CommandRegistryOptions{.middleware = {[](std::string_view, const afd::Json&,
                                                      afd::CommandContext&, const afd::Next& next) {
                                        auto result = next();
                                        return result.success ? result : next();
                                    }}});
    auto flaky = echo_command();
    flaky.handler = [&](const afd::Json& input, afd::CommandContext&) {
        return ++attempts == 1 ? afd::error("TRANSIENT_ERROR", "Try again") : afd::success(input);
    };
    add(retrying, flaky);
    CHECK(retrying.execute("todo-create", {{"title", "x"}}).success);
    CHECK(attempts == 2);
}

TEST_CASE("the handler's result is stamped with timing, version and the post-middleware trace ID") {
    auto clock = std::make_shared<afd::ManualClock>();
    afd::CommandRegistry registry(afd::CommandRegistryOptions{
        .middleware = {[](std::string_view, const afd::Json&, afd::CommandContext& context,
                          const afd::Next& next) {
            context.trace_id = "trace-from-middleware";
            return next();
        }},
        .clock = clock});
    auto slow = echo_command();
    slow.handler = [&](const afd::Json& input, afd::CommandContext&) {
        clock->advance(42.4);
        afd::ResultMetadata metadata;
        metadata.command_version = "handler-says-9";
        metadata.execution_time_ms = 1;
        metadata.extra = {{"region", "eu"}};
        return afd::success(input, {.metadata = metadata});
    };
    add(registry, slow);

    const auto result = registry.execute("todo-create", {{"title", "x"}});
    REQUIRE(result.metadata.has_value());
    CHECK(result.metadata->execution_time_ms == 42);
    CHECK(result.metadata->command_version == "1.2.0");
    CHECK(result.metadata->trace_id == "trace-from-middleware");
    CHECK(result.metadata->extra == afd::Json{{"region", "eu"}});
}

TEST_CASE("handler failures are stamped too; a missing version is omitted") {
    afd::CommandRegistry registry(
        afd::CommandRegistryOptions{.clock = std::make_shared<afd::ManualClock>()});
    auto failing = echo_command();
    failing.version = std::nullopt;
    failing.handler = [](const afd::Json&, afd::CommandContext&) {
        return afd::failure(afd::not_found_error("Todo", "42"));
    };
    add(registry, failing);
    afd::CommandContext context;
    context.trace_id = "t-1";
    const afd::Json result = registry.execute("todo-create", {{"title", "x"}}, context);
    CHECK(result["metadata"] == afd::Json{{"executionTimeMs", 0}, {"traceId", "t-1"}});
}

TEST_CASE("on_command sees executions that reached the chain, with the raw input") {
    std::vector<std::string> seen;
    afd::CommandRegistry registry(
        afd::CommandRegistryOptions{.on_command = [&](std::string_view name, const afd::Json& input,
                                                      const afd::CommandResult& result) {
            seen.push_back(std::string(name) + " " + input.dump() + " " +
                           (result.success ? "ok" : "fail"));
        }});
    add(registry, echo_command());
    (void)registry.execute("todo-create", {{"title", "x"}, {"extra", 1}});
    (void)registry.execute("todo-create", {{"title", ""}}); // validation failure: not reported
    (void)registry.execute("todo-missing");                 // not found: not reported
    CHECK(seen == std::vector<std::string>{"todo-create {\"extra\":1,\"title\":\"x\"} ok"});
}

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
TEST_CASE(
    "an exception from a handler becomes COMMAND_EXECUTION_ERROR, detailed only in dev mode") {
    std::vector<std::string> reported;
    const auto throwing = [] {
        auto command = echo_command();
        command.handler = [](const afd::Json&, afd::CommandContext&) -> afd::CommandResult {
            throw std::runtime_error("database password is hunter2");
        };
        return command;
    };

    afd::CommandRegistry production(afd::CommandRegistryOptions{
        .on_error = [&](std::string_view message) { reported.emplace_back(message); }});
    add(production, throwing());
    const afd::Json hidden = production.execute("todo-create", {{"title", "x"}});
    CHECK(hidden == afd::Json::parse(R"({"success":false,"error":{"code":"COMMAND_EXECUTION_ERROR",
        "message":"An internal error occurred","suggestion":"Contact support if this persists"}})"));
    CHECK(reported == std::vector<std::string>{"database password is hunter2"});

    afd::CommandRegistry development(afd::CommandRegistryOptions{.dev_mode = true});
    add(development, throwing());
    const auto shown = development.execute("todo-create", {{"title", "x"}});
    CHECK(shown.error->message == "database password is hunter2");
    CHECK(shown.error->suggestion == "Check the command implementation");
}

TEST_CASE("an exception from on_command never changes the result") {
    afd::CommandRegistry registry(afd::CommandRegistryOptions{
        .on_command = [](std::string_view, const afd::Json&, const afd::CommandResult&) {
            throw std::runtime_error("telemetry is down");
        }});
    add(registry, echo_command());
    CHECK(registry.execute("todo-create", {{"title", "x"}}).success);
}
#endif

TEST_CASE("listing commands") {
    afd::CommandRegistry registry;
    auto first = echo_command("todo-create");
    first.category = "todo";
    auto second = echo_command("user-get");
    second.expose = afd::ExposeOptions{.mcp = true};
    auto streamed = echo_command("chat-connect");
    streamed.handoff = true;
    streamed.handoff_protocol = "websocket";
    add(registry, first);
    add(registry, second);
    add(registry, streamed);

    const auto names = [](const auto& commands) {
        std::vector<std::string> out;
        for (const auto& command : commands) {
            out.push_back(command->definition.name);
        }
        return out;
    };
    CHECK(names(registry.list()) ==
          std::vector<std::string>{"todo-create", "user-get", "chat-connect"});
    CHECK(names(registry.list_by_category("todo")) == std::vector<std::string>{"todo-create"});
    CHECK(names(registry.list_by_exposure(afd::Interface::mcp)) ==
          std::vector<std::string>{"user-get"});
    CHECK(names(registry.list_handoff_commands()) == std::vector<std::string>{"chat-connect"});
    CHECK(registry.get("chat-connect")->definition.tags ==
          std::vector<std::string>{"handoff", "handoff:websocket"});
    CHECK(registry.has("user-get"));
    CHECK_FALSE(registry.has("user-delete"));
}

TEST_CASE("list_by_tags filters by all or any tags in registration order") {
    afd::CommandRegistry registry;
    auto read_cmd = echo_command("todo-list");
    read_cmd.tags = {"crud", "read", "safe"};
    auto write_cmd = echo_command("todo-create");
    write_cmd.tags = {"crud", "write"};
    auto untagged = echo_command("todo-stats");
    auto handoff_cmd = echo_command("chat-stream");
    handoff_cmd.tags = {"read"};
    handoff_cmd.handoff = true;
    handoff_cmd.handoff_protocol = "sse";

    add(registry, read_cmd);
    add(registry, write_cmd);
    add(registry, untagged);
    add(registry, handoff_cmd);

    const auto names = [](const auto& commands) {
        std::vector<std::string> out;
        for (const auto& command : commands) {
            out.push_back(command->definition.name);
        }
        return out;
    };

    CHECK(registry.list_by_tags({}, afd::TagMatchMode::all).empty());
    CHECK(registry.list_by_tags({}, afd::TagMatchMode::any).empty());
    CHECK(names(registry.list_by_tags({"crud", "read"}, afd::TagMatchMode::all)) ==
          std::vector<std::string>{"todo-list"});
    CHECK(names(registry.list_by_tags({"read", "write"}, afd::TagMatchMode::any)) ==
          std::vector<std::string>{"todo-list", "todo-create", "chat-stream"});
    CHECK(names(registry.list_by_tags({"crud"}, afd::TagMatchMode::all)) ==
          std::vector<std::string>{"todo-list", "todo-create"});
    CHECK(names(registry.list_by_tags({"handoff", "handoff:sse"}, afd::TagMatchMode::all)) ==
          std::vector<std::string>{"chat-stream"});
    CHECK(registry.list_by_tags({"missing"}, afd::TagMatchMode::any).empty());
}
