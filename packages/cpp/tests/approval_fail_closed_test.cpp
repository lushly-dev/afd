// A declared approval policy holds without the approval middleware
// (packages/server/src/approval-fail-closed.test.ts; spec/command-metadata.md "Approvals", #1886).
#include "afd/afd.hpp"

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "detail/approval_admission.hpp"
#include <doctest.h>

namespace {

using afd::Json;

const std::string secret = "afd-approval-fail-closed-secret-0123456789";

const afd::Actor agent{.kind = afd::ActorKind::agent, .id = "u1"};

/// `todo-delete` (approval required unless overridden) and `todo-touch` (no policy). Each handler
/// appends `<name>:<id>` to `ran`.
struct Commands {
    std::shared_ptr<std::vector<std::string>> ran = std::make_shared<std::vector<std::string>>();

    [[nodiscard]] afd::CommandDefinition
    remove(std::optional<afd::ApprovalPolicy> policy = afd::ApprovalDecision::required) const {
        auto log = ran;
        return {.name = "todo-delete",
                .description = "Delete a todo",
                .input_schema = {{"type", "object"},
                                 {"properties", {{"id", {{"type", "integer"}}}}},
                                 {"required", {"id"}}},
                .handler =
                    [log](const Json& input, afd::CommandContext&) {
                        log->push_back("todo-delete:" + input["id"].dump());
                        return afd::success(input);
                    },
                .mutation = true,
                .confirm_prompt = "Delete the todo",
                .approval = std::move(policy)};
    }

    [[nodiscard]] afd::CommandDefinition touch() const {
        auto log = ran;
        return {.name = "todo-touch",
                .description = "Touch a todo",
                .handler = [log](const Json& input, afd::CommandContext&) {
                    log->push_back("todo-touch:" + input.value("id", Json()).dump());
                    return afd::success(input);
                }};
    }
};

std::unique_ptr<afd::CommandRegistry>
registry_of(std::vector<afd::CommandDefinition> commands,
            std::vector<afd::CommandMiddleware> middleware = {}) {
    auto registry = std::make_unique<afd::CommandRegistry>(
        afd::CommandRegistryOptions{.middleware = std::move(middleware)});
    for (auto& command : commands) {
        REQUIRE_FALSE(registry->register_command(std::move(command)));
    }
    return registry;
}

afd::CommandMiddleware approval_middleware(std::vector<afd::ApprovalCommand> commands = {}) {
    auto middleware =
        afd::create_approval_middleware({.secrets = {secret}, .commands = std::move(commands)});
    REQUIRE_MESSAGE(middleware.has_value(), (middleware ? "" : middleware.error()));
    return *middleware;
}

afd::CommandContext as_agent(std::optional<std::string> approval = std::nullopt) {
    afd::CommandContext context;
    context.actor = agent;
    context.approval = std::move(approval);
    return context;
}

// The helpers return early on a wrong result: tests build without exceptions, so a failed
// REQUIRE does not stop them.
std::string token_of(const afd::CommandResult& result) {
    const bool held = !result.success && result.error && result.error->details &&
                      result.error->code == "APPROVAL_REQUIRED" &&
                      (*result.error->details)["approvalToken"].is_string();
    REQUIRE_MESSAGE(held, Json(result).dump());
    return held ? (*result.error->details)["approvalToken"].get<std::string>() : "";
}

void check_unavailable(const afd::CommandResult& result, const std::string& name,
                       const std::string& reason) {
    if (result.success || !result.error || !result.error->details || !result.error->suggestion) {
        FAIL_CHECK("not refused: " << Json(result).dump());
        return;
    }
    CHECK(result.error->code == afd::error_codes::APPROVAL_UNAVAILABLE);
    CHECK(result.error->message ==
          name + " needs a person's approval, and this server cannot ask for it");
    CHECK(result.error->retryable == std::optional<bool>(false));
    CHECK((*result.error->details)["reason"] == reason);
    if (reason == "no-approval-step") {
        CHECK(*result.error->suggestion ==
              "Tell the user that " + name +
                  " needs their approval and this server has no approval step; do not retry. "
                  "The operator adds the approval middleware (create_approval_middleware) or "
                  "removes the command's approval policy.");
    } else {
        CHECK(*result.error->suggestion ==
              "Do not retry: this call is not the one approved. The operator moves middleware "
              "that retries or changes input before the approval middleware.");
    }
}

} // namespace

TEST_CASE("a gated command without the approval middleware is refused before its handler") {
    Commands commands;

    SUBCASE("on its own, also with other middleware installed") {
        auto registry =
            registry_of({commands.remove()}, afd::default_middleware({.logging = std::nullopt}));
        check_unavailable(registry->execute("todo-delete", {{"id", 1}}, as_agent()), "todo-delete",
                          "no-approval-step");
        CHECK(commands.ran->empty());
    }

    SUBCASE("a policy function is not evaluated, and still needs an approval step") {
        int evaluated = 0;
        auto registry = registry_of({commands.remove(
            afd::ApprovalPolicy([&evaluated](const Json&, const afd::CommandContext&) {
                ++evaluated;
                return afd::ApprovalDecision::not_required;
            }))});
        check_unavailable(registry->execute("todo-delete", {{"id", 1}}, as_agent()), "todo-delete",
                          "no-approval-step");
        CHECK(evaluated == 0);
        CHECK(commands.ran->empty());
    }

    SUBCASE("through DirectClient") {
        std::shared_ptr<const afd::CommandRegistry> registry = registry_of({commands.remove()});
        const afd::DirectClient client(registry,
                                       {.on_approval_needed = [](const auto&) { return true; }});
        check_unavailable(client.call("todo-delete", {{"id", 1}}), "todo-delete",
                          "no-approval-step");
        CHECK(commands.ran->empty());
    }

    SUBCASE("a context carrying its own admission record is not admitted") {
        auto registry = registry_of({commands.remove()});
        afd::CommandContext context = as_agent();
        const Json input{{"id", 1}};
        context.approval_admission = std::make_shared<afd::detail::ApprovalAdmission>();
        context.approval_admission->admitted =
            afd::detail::AdmittedCall{.name = "todo-delete", .canonical = R"({"id":1})"};
        check_unavailable(registry->execute("todo-delete", input, context), "todo-delete",
                          "no-approval-step");
        CHECK(commands.ran->empty());
    }
}

TEST_CASE("a 'not-required' or undeclared policy runs without the approval middleware") {
    Commands commands;
    auto registry =
        registry_of({commands.remove(afd::ApprovalDecision::not_required), commands.touch()});
    CHECK(registry->execute("todo-delete", {{"id", 1}}, as_agent()).success);
    CHECK(registry->execute("todo-touch", {{"id", 2}}, as_agent()).success);
    CHECK(*commands.ran == std::vector<std::string>{"todo-delete:1", "todo-touch:2"});
}

TEST_CASE("every batch item and pipeline step is checked on its own") {
    Commands commands;
    auto registry = registry_of({commands.remove(), commands.touch()});

    const afd::BatchResult batch =
        registry->execute_batch(Json{{"commands",
                                      {{{"command", "todo-touch"}, {"input", {{"id", 1}}}},
                                       {{"command", "todo-delete"}, {"input", {{"id", 2}}}}}}},
                                as_agent());
    REQUIRE(batch.results.size() == 2);
    CHECK(batch.results[0].result.success);
    check_unavailable(batch.results[1].result, "todo-delete", "no-approval-step");

    const afd::PipelineResult pipeline =
        registry->execute_pipeline(Json{{"steps",
                                         {{{"command", "todo-touch"}, {"input", {{"id", 3}}}},
                                          {{"command", "todo-delete"}, {"input", {{"id", 4}}}}}}},
                                   as_agent());
    REQUIRE(pipeline.steps.size() == 2);
    CHECK(pipeline.steps[0].status == afd::StepStatus::success);
    CHECK(pipeline.steps[1].status == afd::StepStatus::failure);
    CHECK((pipeline.steps[1].error &&
           pipeline.steps[1].error->code == afd::error_codes::APPROVAL_UNAVAILABLE));
    CHECK(*commands.ran == std::vector<std::string>{"todo-touch:1", "todo-touch:3"});
}

TEST_CASE("a gated command run from inside another command is refused without the middleware") {
    Commands commands;
    std::optional<afd::CommandResult> nested;
    afd::CommandRegistry* self = nullptr;
    afd::CommandDefinition outer{
        .name = "todo-sweep",
        .description = "Runs todo-delete",
        .handler =
            [&](const Json&, afd::CommandContext& context) {
                nested = self->execute("todo-delete", {{"id", 1}}, context);
                return afd::success(nullptr);
            },
    };
    auto registry = registry_of({commands.remove(), outer});
    self = registry.get();
    CHECK(registry->execute("todo-sweep", Json::object(), as_agent()).success);
    check_unavailable(nested.value_or(afd::success(nullptr)), "todo-delete", "no-approval-step");
    CHECK(commands.ran->empty());
}

TEST_CASE("the approval middleware decides from the command it runs") {
    Commands commands;

    SUBCASE("it holds a gated command missing from its commands list") {
        auto registry = registry_of({commands.remove(), commands.touch()},
                                    {approval_middleware({commands.touch()})});
        const auto held = registry->execute("todo-delete", {{"id", 1}}, as_agent());
        const std::string token = token_of(held);
        CHECK(commands.ran->empty());
        CHECK(registry->execute("todo-delete", {{"id", 1}}, as_agent(token)).success);
        CHECK(*commands.ran == std::vector<std::string>{"todo-delete:1"});
    }

    SUBCASE("it works without a commands list, and the approved retry runs") {
        auto registry = registry_of({commands.remove()}, {approval_middleware()});
        const auto held = registry->execute("todo-delete", {{"id", 1}}, as_agent());
        const std::string token = token_of(held);
        // The summary is the confirm_prompt of the command it runs.
        CHECK(Json(held)["error"]["details"]["summary"] == "Delete the todo");
        CHECK(registry->execute("todo-delete", {{"id", 1}}, as_agent(token)).success);
        CHECK(*commands.ran == std::vector<std::string>{"todo-delete:1"});
    }

    SUBCASE("it covers a command registered after the middleware was built") {
        auto registry = registry_of({}, {approval_middleware()});
        REQUIRE_FALSE(registry->register_command(commands.remove()));
        const std::string token =
            token_of(registry->execute("todo-delete", {{"id", 1}}, as_agent()));
        CHECK(commands.ran->empty());
        CHECK(registry->execute("todo-delete", {{"id", 1}}, as_agent(token)).success);
    }

    SUBCASE("a nested call does not inherit the outer call's admission") {
        std::optional<afd::CommandResult> nested;
        afd::CommandRegistry* self = nullptr;
        afd::CommandDefinition outer{
            .name = "todo-sweep",
            .description = "Admitted by its policy, then runs todo-delete",
            .handler =
                [&](const Json&, afd::CommandContext& context) {
                    commands.ran->push_back("outer");
                    nested = self->execute("todo-delete", {{"id", 1}}, context);
                    return afd::success(nullptr);
                },
            .approval = afd::ApprovalPolicy([](const Json&, const afd::CommandContext&) {
                return afd::ApprovalDecision::not_required;
            }),
        };
        auto registry = registry_of({commands.remove(), outer}, {approval_middleware()});
        self = registry.get();
        CHECK(registry->execute("todo-sweep", Json::object(), as_agent()).success);
        CHECK((nested && nested->error && nested->error->code == "APPROVAL_REQUIRED"));
        CHECK(*commands.ran == std::vector<std::string>{"outer"});
    }
}

TEST_CASE("a policy given only in the commands list still holds") {
    Commands commands;

    SUBCASE("the command declares none") {
        auto registry = registry_of({commands.remove(std::nullopt)},
                                    {approval_middleware({afd::ApprovalCommand(
                                        "todo-delete", afd::ApprovalDecision::required)})});
        const std::string token =
            token_of(registry->execute("todo-delete", {{"id", 1}}, as_agent()));
        CHECK(commands.ran->empty());
        CHECK(registry->execute("todo-delete", {{"id", 1}}, as_agent(token)).success);
        CHECK(*commands.ran == std::vector<std::string>{"todo-delete:1"});
    }

    SUBCASE("a listed function holds, though the command declares not-required") {
        auto registry = registry_of(
            {commands.remove(afd::ApprovalDecision::not_required)},
            {approval_middleware({afd::ApprovalCommand(
                "todo-delete", afd::ApprovalPolicy([](const Json&, const afd::CommandContext&) {
                    return afd::ApprovalDecision::required;
                }))})});
        token_of(registry->execute("todo-delete", {{"id", 1}}, as_agent()));
        CHECK(commands.ran->empty());
    }
}

TEST_CASE("one admission runs one handler, on what was approved") {
    Commands commands;
    /// A registry whose todo-delete is approved through DirectClient, with `after` behind the
    /// approval middleware.
    const auto approved = [&](afd::CommandMiddleware after) {
        std::shared_ptr<const afd::CommandRegistry> registry = registry_of(
            {commands.remove(), commands.touch()}, {approval_middleware(), std::move(after)});
        return afd::DirectClient(
            registry, {.actor = agent, .on_approval_needed = [](const auto&) { return true; }});
    };

    SUBCASE("a retry placed after the approval middleware is refused") {
        int attempts = 0;
        afd::CommandDefinition flaky = commands.remove();
        flaky.handler = [&attempts](const Json&, afd::CommandContext&) {
            ++attempts;
            return attempts == 1 ? afd::error("TRANSIENT_ERROR", "try again")
                                 : afd::success(nullptr);
        };
        const afd::CommandMiddleware retry = [](std::string_view, const Json&, afd::CommandContext&,
                                                const afd::Next& next) {
            afd::CommandResult result = next();
            for (int i = 0; i < 2 && !result.success && result.error &&
                            result.error->code == "TRANSIENT_ERROR";
                 ++i) {
                result = next();
            }
            return result;
        };
        std::shared_ptr<const afd::CommandRegistry> registry =
            registry_of({flaky}, {approval_middleware(), retry});
        const afd::DirectClient client(
            registry, {.actor = agent, .on_approval_needed = [](const auto&) { return true; }});
        const auto result = client.call("todo-delete", {{"id", 1}});
        CHECK(attempts == 1);
        check_unavailable(result, "todo-delete", "admission-mismatch");
    }

    SUBCASE("an input changed in place after the approval is refused") {
        const auto client = approved(
            [](std::string_view, const Json& input, afd::CommandContext&, const afd::Next& next) {
                // The registry's validated input is not const; a middleware can still write it.
                const_cast<Json&>(input)["id"] = 99;
                return next();
            });
        check_unavailable(client.call("todo-delete", {{"id", 1}}), "todo-delete",
                          "admission-mismatch");
        CHECK(commands.ran->empty());
    }

    SUBCASE("an admission for another command is refused") {
        const afd::CommandMiddleware approval = approval_middleware();
        // Asks the middleware about an ungated command, then lets the gated one through.
        const afd::CommandMiddleware swap = [approval](std::string_view, const Json& input,
                                                       afd::CommandContext& context,
                                                       const afd::Next& next) {
            return approval("todo-touch", input, context, next);
        };
        auto registry = registry_of({commands.remove(), commands.touch()}, {swap});
        check_unavailable(registry->execute("todo-delete", {{"id", 1}}, as_agent()), "todo-delete",
                          "admission-mismatch");
        CHECK(commands.ran->empty());
    }

    SUBCASE("an approved call whose middleware after the approval leaves it alone runs") {
        const auto client = approved([](std::string_view, const Json&, afd::CommandContext&,
                                        const afd::Next& next) { return next(); });
        CHECK(client.call("todo-delete", {{"id", 2}}).success);
        CHECK(*commands.ran == std::vector<std::string>{"todo-delete:2"});
    }
}
