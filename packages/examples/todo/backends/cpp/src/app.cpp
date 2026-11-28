#include "app.hpp"

#include <cstddef>
#include <random>
#include <string_view>
#include <utility>
#include <vector>

#include "commands.hpp"
#include <afd/approval.hpp>
#include <afd/bootstrap.hpp>

namespace todo {

afd::Expected<Approvals> approvals_from(const char* value) {
    const std::string_view mode = value != nullptr ? value : "agents";
    if (mode == "agents") {
        return Approvals::agents;
    }
    if (mode == "off") {
        return Approvals::off;
    }
    return afd::unexpected("APPROVALS must be agents or off, not \"" + std::string(mode) + "\"");
}

afd::Expected<std::string> approval_secret(const char* value) {
    if (value != nullptr) {
        std::string secret = value;
        if (secret.size() < 32) {
            return afd::unexpected(std::string("TODO_APPROVAL_SECRET must be at least 32 bytes"));
        }
        return secret;
    }
    // The OS entropy source on every platform this backend builds for (see approval.hpp).
    std::random_device device;
    std::string secret(32, '\0');
    for (char& byte : secret) {
        byte = static_cast<char>(device() & 0xFFU);
    }
    return secret;
}

std::vector<afd::ContextConfig> todo_contexts() {
    return {
        {.name = "todo-reading",
         .description = "Review todos without changing them: list, get, stats and history only",
         .triggers = {"review", "summarize", "report", "what is left"}},
        {.name = "todo-editing",
         .description = "Add, change, complete and remove todos",
         .triggers = {"add", "create", "complete", "update", "delete", "clear"}},
    };
}

afd::Expected<std::unique_ptr<afd::CommandRegistry>>
make_registry(const std::shared_ptr<TodoStore>& store, RegistryOptions options) {
    // The idempotency step answers a repeat of todo-create, todo-update, todo-toggle,
    // todo-create-batch and todo-toggle-batch, which declare `keyed`, from an in-memory store
    // (spec/idempotency.md, S1 to S13): a repeat with the same key and input gets the first
    // result instead of applying the change again. The keys last as long as this process.
    auto registry = std::make_unique<afd::CommandRegistry>(
        afd::CommandRegistryOptions{.clock = options.clock,
                                    .random = options.random,
                                    .idempotency = afd::IdempotencyOptions{}});
    // With APPROVALS=off there is no approval middleware, and the registry refuses a command that
    // declares an approval policy without one (APPROVAL_UNAVAILABLE), so the commands are served
    // without their policies: todo-clear runs for every caller, and `_meta.approval` advertises
    // no hold the server does not make. TypeScript's createTodoCommands does the same.
    for (auto& command : todo_commands(store)) {
        if (options.approvals == Approvals::off) {
            command.approval.reset();
        }
        if (auto error = registry->register_command(std::move(command))) {
            return afd::unexpected(*error);
        }
    }
    if (options.protocol_conformance) {
        if (auto error = registry->register_command({
                .name = "todo-internal-ping",
                .description = "Private internal probe not exposed to MCP",
                .input_schema = {{"type", "object"}, {"properties", afd::Json::object()}},
                .handler = [](const afd::Json&,
                              afd::CommandContext&) { return afd::success({{"pong", true}}); },
                .expose = {.palette = false, .mcp = false, .agent = true, .cli = false},
            })) {
            return afd::unexpected(*error);
        }
    }
    if (auto error = afd::register_context_commands(*registry, todo_contexts())) {
        return afd::unexpected(*error);
    }
    // afd-help, afd-docs and afd-schema, as TypeScript's `bootstrap: true` registers them.
    if (auto error = afd::register_bootstrap_commands(*registry)) {
        return afd::unexpected(*error);
    }
    if (options.approvals == Approvals::agents) {
        // The middleware decides from the policy of the command each call runs.
        auto approval = afd::create_approval_middleware(
            {.secrets = {std::move(options.secret)},
             .summarize = [store](std::string_view command, const afd::Json& input,
                                  const afd::CommandContext&) -> std::optional<std::string> {
                 if (command != "todo-clear") {
                     return std::nullopt;
                 }
                 return summarize_clear(*store, input);
             },
             .relay = afd::ApprovalRelay::mcp_elicitation});
        if (!approval) {
            return afd::unexpected(approval.error());
        }
        registry->use(std::move(*approval));
    }
    return registry;
}

} // namespace todo
