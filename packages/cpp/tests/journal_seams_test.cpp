// The dispatch id and the approval summary beyond the vectors (spec/dispatch.md, "The dispatch
// id"; spec/command-metadata.md, "The approval summary"): what reviews of the other languages
// found, held for C++.
#include "afd/afd.hpp"
#if AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/exceptions.hpp"
#include <doctest.h>

#if AFD_HAS_EXCEPTIONS
#include <stdexcept>
#endif

// Named, so a unity build does not merge these helpers with another test file's.
namespace journal_seams_test {
namespace {

using afd::Json;

const std::string secret = "afd-journal-seams-test-secret-0123456789";

/// Each reader's dispatch id, in the order they read it.
struct Readings {
    std::mutex mutex;
    std::vector<std::pair<std::string, std::string>> ids;

    void note(std::string reader, const afd::CommandContext& context) {
        const std::lock_guard lock(mutex);
        ids.emplace_back(std::move(reader), context.dispatch_id.value());
    }
};

afd::CommandDefinition echo(std::shared_ptr<Readings> readings, std::string name = "item-echo") {
    return {.name = std::move(name),
            .description = "Returns its input",
            .handler = [readings = std::move(readings)](const Json& input,
                                                        afd::CommandContext& context) {
                readings->note("handler", context);
                return afd::success(input);
            }};
}

bool well_formed(const std::string& id) {
    if (id.size() != 22) {
        return false;
    }
    for (std::size_t i = 0; i + 1 < id.size(); ++i) {
        const char c = id[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
              c == '-' || c == '_')) {
            return false;
        }
    }
    return std::string_view("AQgw").find(id.back()) != std::string_view::npos;
}

/// `todo-delete`, which needs approval; its handler counts its runs and notes its dispatch id.
struct Gated {
    std::shared_ptr<std::vector<std::string>> handler_ids =
        std::make_shared<std::vector<std::string>>();
    /// Whether the handler fails (after it ran) with HANDLER_FAILED.
    bool fails = false;

    [[nodiscard]] afd::CommandDefinition definition() const {
        auto ids = handler_ids;
        return {.name = "todo-delete",
                .description = "Delete a todo",
                .handler =
                    [ids, fails = fails](const Json& input, afd::CommandContext& context) {
                        ids->push_back(context.dispatch_id.value());
                        if (fails) {
                            return afd::error("HANDLER_FAILED", "The delete failed",
                                              {.suggestion = "Try again"});
                        }
                        return afd::success(input);
                    },
                .mutation = true,
                .expose = {.mcp = true},
                .approval = afd::ApprovalDecision::required};
    }
};

/// What the registry reported: `on_error` messages and `on_command` calls.
struct Reported {
    std::vector<std::string> errors;
    int commands = 0;
};

/// Runs `todo-delete` behind `middleware`: once with no evidence, to be held, then with the token
/// that hold issued, whose result it returns. `reported` holds what the second call reported.
afd::CommandResult call_with_token(std::vector<afd::CommandMiddleware> middleware,
                                   const Gated& command, Reported& reported) {
    afd::CommandRegistry registry(afd::CommandRegistryOptions{
        .middleware = std::move(middleware),
        .on_command = [&reported](std::string_view, const Json&,
                                  const afd::CommandResult&) { ++reported.commands; },
        .on_error =
            [&reported](std::string_view message) { reported.errors.emplace_back(message); }});
    REQUIRE_FALSE(registry.register_command(command.definition()));
    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "a1"};
    const auto held = registry.execute("todo-delete", Json{{"id", 1}}, context);
    REQUIRE(held.error);
    REQUIRE(held.error->code == "APPROVAL_REQUIRED");
    context.approval = held.error->details->at("approvalToken").get<std::string>();
    reported = Reported{};
    return registry.execute("todo-delete", Json{{"id", 1}}, context);
}

/// A middleware that runs the rest of the chain again once when it fails, or throws.
afd::CommandMiddleware retry_once() {
    return [](std::string_view, const Json&, afd::CommandContext&, const afd::Next& next) {
#if AFD_HAS_EXCEPTIONS
        try {
            afd::CommandResult result = next();
            return result.success ? result : next();
        } catch (const std::exception&) {
            return next();
        }
#else
        afd::CommandResult result = next();
        return result.success ? result : next();
#endif
    };
}

/// What `on_approval_accepted` was given.
struct Accepted {
    std::mutex mutex;
    std::vector<afd::ApprovalSummary> summaries;
    std::vector<std::string> dispatch_ids;
};

} // namespace

// The new members come last, so positional initializers written before they existed still
// compile: `CommandContext`'s second member is still `timeout_ms`, and `ApprovalMiddlewareOptions`'
// ninth is still `clock`. Templates, so an initializer that does not fit reads as false.
template <class Context>
constexpr bool context_takes_positional_timeout =
    requires { Context{std::optional<std::string>{"trace-1"}, std::optional<double>{500.0}}; };
static_assert(context_takes_positional_timeout<afd::CommandContext>);

template <class Options>
constexpr bool options_take_positional_clock = requires(std::shared_ptr<const afd::Clock> clock) {
    Options{std::vector<std::string>{},
            std::vector<afd::ApprovalCommand>{},
            std::int64_t{1000},
            afd::ApprovalReplay::single_use,
            std::shared_ptr<afd::ApprovalNonceStore>{},
            {},
            std::optional<bool>{},
            std::function<void(const afd::ApprovalRequest&)>{},
            clock};
};
static_assert(options_take_positional_clock<afd::ApprovalMiddlewareOptions>);

TEST_CASE("a composed middleware cannot make its links read different dispatch ids") {
    // compose_middleware runs its parts inside one link of the registry's chain, so a registry
    // that restored the id before each of its own links would not reach between them. The id
    // itself cannot change: assigning a context, or an id, leaves it as it was.
    auto readings = std::make_shared<Readings>();
    const afd::CommandMiddleware replacing = [readings](std::string_view, const Json&,
                                                        afd::CommandContext& context,
                                                        const afd::Next& next) {
        readings->note("replacing", context);
        context = afd::CommandContext{};
        context.dispatch_id = afd::DispatchId{};
        afd::CommandContext copy = context;
        context = std::move(copy);
        return next();
    };
    const afd::CommandMiddleware reading = [readings](std::string_view, const Json&,
                                                      afd::CommandContext& context,
                                                      const afd::Next& next) {
        readings->note("reading", context);
        return next();
    };
    afd::CommandRegistry registry(
        afd::CommandRegistryOptions{.middleware = {afd::compose_middleware({replacing, reading})}});
    REQUIRE_FALSE(registry.register_command(echo(readings)));
    CHECK(registry.execute("item-echo", Json{{"id", 1}}).success);

    REQUIRE(readings->ids.size() == 3);
    std::set<std::string> ids;
    for (const auto& [reader, id] : readings->ids) {
        CAPTURE(reader);
        CHECK(well_formed(id));
        ids.insert(id);
    }
    CHECK(ids.size() == 1);
}

TEST_CASE("a direct handler call, which is not a dispatch, carries no outer dispatch id") {
    // A copy of a context is not the dispatch, so a handler that runs another command's handler
    // itself, with a copy of its context, passes on no id (Rust's `CommandDefinition::execute`
    // clears it). Through the registry, the inner call is a dispatch with its own id.
    auto readings = std::make_shared<Readings>();
    auto registry = std::make_shared<afd::CommandRegistry>();
    REQUIRE_FALSE(registry->register_command(echo(readings)));
    const std::weak_ptr<afd::CommandRegistry> self = registry;
    REQUIRE_FALSE(registry->register_command(
        {.name = "item-outer",
         .description = "Runs item-echo's handler directly, then through the registry",
         .handler = [readings, self](const Json&, afd::CommandContext& context) {
             readings->note("outer", context);
             const auto inner = self.lock()->get("item-echo");
             afd::CommandContext copy = context;
             (void)inner->definition.handler(Json::object(), copy);
             (void)self.lock()->execute("item-echo", Json::object(), context);
             return afd::success(Json::object());
         }}));
    CHECK(registry->execute("item-outer").success);

    REQUIRE(readings->ids.size() == 3);
    const std::string outer = readings->ids[0].second;
    CHECK(well_formed(outer));
    CHECK(readings->ids[1].second.empty());
    CHECK(well_formed(readings->ids[2].second));
    CHECK(readings->ids[2].second != outer);
}

TEST_CASE("the dispatch id is drawn from the registry's random_bytes, never the caller's") {
    auto readings = std::make_shared<Readings>();
    auto zeros =
        afd::CommandRegistry::create({.random_bytes = [](std::uint8_t* out, std::size_t size) {
            for (std::size_t i = 0; i < size; ++i) {
                out[i] = 0;
            }
            return true;
        }});
    REQUIRE(zeros);
    auto& registry = **zeros;
    REQUIRE_FALSE(registry.register_command(
        {.name = "item-extra",
         .description = "Notes its id and what extra holds",
         .handler = [readings](const Json&, afd::CommandContext& context) {
             readings->note("handler", context);
             return afd::success(context.extra);
         }}));
    afd::CommandContext context;
    context.extra["dispatch_id"] = "caller-chosen-id-000000";
    context.extra["dispatchId"] = "caller-chosen-id-000000";
    context.extra["kept"] = true;
    const auto result = registry.execute("item-extra", Json::object(), context);
    REQUIRE(result.success);
    REQUIRE(readings->ids.size() == 1);
    // 128 zero bits, as 22 characters of unpadded base64url.
    CHECK(readings->ids[0].second == "AAAAAAAAAAAAAAAAAAAAAA");
    // A value the caller put under the id's name is removed before any check.
    CHECK(*result.data == Json{{"kept", true}});
}

TEST_CASE("a random_bytes that fails fails the call with a structured error, before any check") {
    // Rust answers a failed draw the same way. A host without exceptions returns false; one with
    // them may also throw, and the registry keeps the exception from escaping `execute`.
    auto ran = std::make_shared<int>(0);
    const auto run = [&ran](afd::CommandRegistryOptions options) {
        auto registry = afd::CommandRegistry::create(std::move(options));
        REQUIRE(registry);
        REQUIRE_FALSE(
            (*registry)->register_command({.name = "item-run",
                                           .description = "Counts its runs",
                                           .handler = [ran](const Json&, afd::CommandContext&) {
                                               ++*ran;
                                               return afd::success(nullptr);
                                           }}));
        return (*registry)->execute("item-run");
    };
    std::vector<afd::CommandResult> results;
    results.push_back(run({.random_bytes = [](std::uint8_t*, std::size_t) { return false; }}));
#if AFD_HAS_EXCEPTIONS
    results.push_back(run({.random_bytes = [](std::uint8_t*, std::size_t) -> bool {
        throw std::runtime_error("no entropy");
    }}));
#endif
    for (const auto& result : results) {
        REQUIRE(result.error);
        CHECK(result.error->code == "COMMAND_EXECUTION_ERROR");
        CHECK(result.error->message ==
              "Cannot draw a dispatch id: the secure random source failed");
        CHECK(result.error->suggestion == "The system random source failed; try again later");
    }
    CHECK(*ran == 0);
}

TEST_CASE("a refusal stands when a middleware outside the approval step turns it into a success") {
    // spec/command-metadata.md, "The approval summary", rule 2: the handler did not run, so the
    // caller never sees a success, in either build.
    // Turns a COMMAND_EXECUTION_ERROR, or an exception, into a success and passes the rest on.
    const afd::CommandMiddleware fallback = [](std::string_view, const Json&, afd::CommandContext&,
                                               const afd::Next& next) {
#if AFD_HAS_EXCEPTIONS
        try {
            afd::CommandResult result = next();
            return result.success || result.error->code != "COMMAND_EXECUTION_ERROR"
                       ? result
                       : afd::success("fallback");
        } catch (const std::exception&) {
            return afd::success("fallback");
        }
#else
        afd::CommandResult result = next();
        return result.success || result.error->code != "COMMAND_EXECUTION_ERROR"
                   ? result
                   : afd::success("fallback");
#endif
    };
    auto approval = afd::create_approval_middleware(
        {.secrets = {secret},
         .on_approval_accepted = [](const afd::ApprovalSummary&,
                                    std::string_view) -> std::optional<std::string> {
             return std::string("the record could not be written");
         }});
    REQUIRE(approval);
    Gated command;
    Reported reported;
    const auto result = call_with_token({fallback, *approval}, command, reported);
    REQUIRE(result.error);
    CHECK(result.error->code == "COMMAND_EXECUTION_ERROR");
    CHECK(result.error->message == "An internal error occurred");
    CHECK(command.handler_ids->empty());
    CHECK(reported.errors ==
          std::vector<std::string>{
              "The on_approval_accepted hook refused the call: the record could not be written"});
    CHECK(reported.commands == 0);
}

#if AFD_HAS_EXCEPTIONS
TEST_CASE("a hook that throws stands as a refusal when an outer middleware catches it") {
    // A throwing hook refuses as one that returns a message does: the outer middleware sees the
    // exception, and its fallback success does not reach the caller.
    const afd::CommandMiddleware fallback = [](std::string_view, const Json&, afd::CommandContext&,
                                               const afd::Next& next) {
        try {
            return next();
        } catch (const std::exception&) {
            return afd::success("fallback");
        }
    };
    auto approval = afd::create_approval_middleware(
        {.secrets = {secret},
         .on_approval_accepted = [](const afd::ApprovalSummary&,
                                    std::string_view) -> std::optional<std::string> {
             throw std::runtime_error("the record store is down");
         }});
    REQUIRE(approval);
    Gated command;
    Reported reported;
    const auto result = call_with_token({fallback, *approval}, command, reported);
    REQUIRE(result.error);
    CHECK(result.error->code == "COMMAND_EXECUTION_ERROR");
    CHECK(result.error->message == "An internal error occurred");
    CHECK(command.handler_ids->empty());
    CHECK(reported.errors == std::vector<std::string>{"the record store is down"});
    CHECK(reported.commands == 0);
}
#endif

TEST_CASE("a retry the hook admits is not reported as the refusal of an earlier pass") {
    // Under within_ttl, a retry outside the approval step reaches it again with the same token:
    // the hook refuses the first pass and admits the second, whose handler runs and fails. The
    // call reports that failure, as any handler failure, not the first pass's refusal.
    auto calls = std::make_shared<int>(0);
    auto approval = afd::create_approval_middleware(
        {.secrets = {secret},
         .replay = afd::ApprovalReplay::within_ttl,
         .on_approval_accepted = [calls](const afd::ApprovalSummary&,
                                         std::string_view) -> std::optional<std::string> {
             if (++*calls == 1) {
                 return std::string("not yet");
             }
             return std::nullopt;
         }});
    REQUIRE(approval);
    Gated command;
    command.fails = true;
    Reported reported;
    const auto result = call_with_token({retry_once(), *approval}, command, reported);
    CHECK(*calls == 2);
    CHECK(command.handler_ids->size() == 1);
    REQUIRE(result.error);
    CHECK(result.error->code == "HANDLER_FAILED");
    CHECK(reported.errors.empty());
    CHECK(reported.commands == 1);
}

TEST_CASE("a context field cannot be declared under the dispatch id's name") {
    for (const char* name : {"dispatchId", "dispatch_id"}) {
        CAPTURE(name);
        const auto created = afd::CommandRegistry::create(
            {.context_fields = {afd::ContextField{
                 .name = name, .meta = "dev.example/dispatch", .schema = {{"type", "string"}}}}});
        CHECK_FALSE(created);
    }
}

TEST_CASE("a refusing approval hook is seen by an outer middleware as a middleware error is") {
    // spec/command-metadata.md, "The approval summary", rule 2: the refusal fails the call as an
    // uncaught middleware error does. With exceptions, an outer middleware sees an exception for
    // both; the registry reports each to on_error, answers COMMAND_EXECUTION_ERROR with the same
    // message and skips on_command. Without exceptions there is no thrown middleware error to
    // compare with, and the registry reports the refusal the same way.
    struct Seen {
        std::vector<std::string> outer;
        std::vector<std::string> errors;
        int commands = 0;
    };
    const auto run_with = [](const afd::CommandMiddleware& inner, bool gated, Seen& seen,
                             Gated& command) {
        const afd::CommandMiddleware outer = [&seen](std::string_view, const Json&,
                                                     afd::CommandContext&, const afd::Next& next) {
#if AFD_HAS_EXCEPTIONS
            try {
                afd::CommandResult result = next();
                seen.outer.emplace_back(result.success ? "success" : "failure");
                return result;
            } catch (const std::exception&) {
                seen.outer.emplace_back("exception");
                throw;
            }
#else
            afd::CommandResult result = next();
            seen.outer.emplace_back(result.success ? "success" : "failure");
            return result;
#endif
        };
        afd::CommandRegistry registry(afd::CommandRegistryOptions{
            .middleware = {outer, inner},
            .on_command = [&seen](std::string_view, const Json&,
                                  const afd::CommandResult&) { ++seen.commands; },
            .on_error = [&seen](std::string_view message) { seen.errors.emplace_back(message); }});
        REQUIRE_FALSE(registry.register_command(command.definition()));
        afd::CommandContext context;
        context.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "a1"};
        if (gated) {
            const auto held = registry.execute("todo-delete", Json{{"id", 1}}, context);
            REQUIRE(held.error);
            REQUIRE(held.error->code == "APPROVAL_REQUIRED");
            context.approval = held.error->details->at("approvalToken").get<std::string>();
            seen = Seen{};
        }
        return registry.execute("todo-delete", Json{{"id", 1}}, context);
    };

    Seen refused;
    Gated refused_command;
    auto accepted = std::make_shared<int>(0);
    auto approval = afd::create_approval_middleware(
        {.secrets = {secret},
         .on_approval_accepted = [accepted](const afd::ApprovalSummary&,
                                            std::string_view) -> std::optional<std::string> {
             ++*accepted;
             return std::string("the record could not be written");
         }});
    REQUIRE(approval);
    const auto by_hook = run_with(*approval, true, refused, refused_command);
    CHECK(*accepted == 1);
    REQUIRE(by_hook.error);
    CHECK(by_hook.error->code == "COMMAND_EXECUTION_ERROR");
    CHECK(by_hook.error->message == "An internal error occurred");
    CHECK(refused_command.handler_ids->empty());
    CHECK(refused.commands == 0);
    CHECK(refused.errors ==
          std::vector<std::string>{
              "The on_approval_accepted hook refused the call: the record could not be written"});

#if AFD_HAS_EXCEPTIONS
    CHECK(refused.outer == std::vector<std::string>{"exception"});
    Seen thrown;
    Gated thrown_command;
    const afd::CommandMiddleware throwing = [](std::string_view, const Json&, afd::CommandContext&,
                                               const afd::Next&) -> afd::CommandResult {
        throw std::runtime_error("a middleware failed");
    };
    const auto by_middleware = run_with(throwing, false, thrown, thrown_command);
    REQUIRE(by_middleware.error);
    CHECK(by_middleware.error->code == by_hook.error->code);
    CHECK(by_middleware.error->message == by_hook.error->message);
    CHECK(thrown.outer == refused.outer);
    CHECK(thrown.commands == refused.commands);
    CHECK(thrown.errors.size() == refused.errors.size());
#else
    CHECK(refused.outer == std::vector<std::string>{"failure"});
#endif
}

#if AFD_HAS_MCP_STDIO
TEST_CASE("an afd-pipe approved up front gives each gated step its own summary") {
    // Rule 4: each gated step is admitted on its own answer, as it runs, with its own dispatch id.
    Gated command;
    auto accepted = std::make_shared<Accepted>();
    auto approval = afd::create_approval_middleware(
        {.secrets = {secret},
         .relay = afd::ApprovalRelay::mcp_elicitation,
         .on_approval_accepted =
             [accepted](const afd::ApprovalSummary& summary,
                        std::string_view dispatch_id) -> std::optional<std::string> {
             const std::lock_guard lock(accepted->mutex);
             accepted->summaries.push_back(summary);
             accepted->dispatch_ids.emplace_back(dispatch_id);
             return std::nullopt;
         }});
    REQUIRE(approval);
    afd::CommandRegistry registry(afd::CommandRegistryOptions{.middleware = {*approval}});
    REQUIRE_FALSE(registry.register_command(command.definition()));
    REQUIRE_FALSE(afd::register_bootstrap_commands(registry));
    auto server = afd::mcp::StdioServer::create(
        registry, {.tool_strategy = afd::mcp::ToolStrategy::individual});
    REQUIRE(server);
    int asked = 0;
    const afd::mcp::ClientRequester approve = [&asked](const Json&) -> std::optional<Json> {
        ++asked;
        return Json{{"action", "accept"}, {"content", {{"approve", true}}}};
    };
    const auto send = [&](const Json& message) {
        const auto out = (*server)->handle_message(afd::wire::serialize(message), approve);
        REQUIRE(out.has_value());
        return Json::parse(*out);
    };
    send(Json{{"jsonrpc", "2.0"},
              {"id", 0},
              {"method", "initialize"},
              {"params",
               {{"protocolVersion", "2025-11-25"},
                {"capabilities", {{"elicitation", {{"form", Json::object()}}}}}}}});
    const Json pipe{{"steps",
                     {{{"command", "todo-delete"}, {"input", {{"id", 1}}}},
                      {{"command", "todo-delete"}, {"input", {{"id", 2}}}}}}};
    const Json reply = send(Json{{"jsonrpc", "2.0"},
                                 {"id", 1},
                                 {"method", "tools/call"},
                                 {"params", {{"name", "afd-pipe"}, {"arguments", pipe}}}});
    const Json ran =
        Json::parse(reply.at("result").at("content").at(0).at("text").get<std::string>());
    CAPTURE(ran.dump());
    CHECK(ran.at("metadata").at("completedSteps") == 2);
    CHECK(asked == 1);

    REQUIRE(accepted->summaries.size() == 2);
    CHECK(accepted->dispatch_ids == *command.handler_ids);
    std::set<std::string> approval_ids;
    std::set<std::string> input_digests;
    for (const auto& summary : accepted->summaries) {
        CHECK(summary.via == afd::ApprovalVia::elicitation);
        CHECK(summary.command == "todo-delete");
        CHECK_FALSE(summary.issued_at);
        CHECK(summary.expires_at);
        approval_ids.insert(summary.approval_id);
        input_digests.insert(summary.input_digest);
    }
    CHECK(approval_ids.size() == 2);
    CHECK(input_digests.size() == 2);
    const std::set<std::string> dispatch_ids(accepted->dispatch_ids.begin(),
                                             accepted->dispatch_ids.end());
    CHECK(dispatch_ids.size() == 2);
}
#endif

} // namespace journal_seams_test
