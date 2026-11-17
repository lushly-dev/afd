// The C++ todo backend.
//
//   todo-server-cpp                      stdio MCP server (default); CONFIRMATIONS=off|enforce|
//                                        require-human sets confirmation enforcement
//   todo-server-cpp list-commands        the registered command names
//   todo-server-cpp <command> [json]     run one command and print its result
//
// Exit codes: 0 success, 1 the command failed, 2 usage error.
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <optional>
#include <string>

#include "commands.hpp"
#include "store.hpp"
#include <afd/mcp_stdio.hpp>

namespace {

/// `CONFIRMATIONS`: `off` (the default), `enforce` or `require-human`, as the other backends read
/// it.
std::optional<afd::mcp::ConfirmationMode> confirmations_from_environment() {
    const char* value = std::getenv("CONFIRMATIONS");
    const std::string mode = value != nullptr ? value : "off";
    if (mode == "off") {
        return afd::mcp::ConfirmationMode::off;
    }
    if (mode == "enforce") {
        return afd::mcp::ConfirmationMode::enforce;
    }
    if (mode == "require-human") {
        return afd::mcp::ConfirmationMode::require_human;
    }
    std::fprintf(stderr, "CONFIRMATIONS must be off, enforce or require-human, got \"%s\"\n",
                 mode.c_str());
    return std::nullopt;
}

} // namespace

int main(int argc, char** argv) {
    auto clock = std::make_shared<afd::SystemClock>();
    auto store = std::make_shared<todo::TodoStore>(clock, std::make_shared<afd::SystemRandom>());
    afd::CommandRegistry registry(afd::CommandRegistryOptions{.clock = clock});
    if (const auto error = todo::register_todo_commands(registry, store)) {
        std::fprintf(stderr, "failed to register commands: %s\n", error->c_str());
        return 2;
    }

    const std::string mode = argc > 1 ? argv[1] : "server";
    if (mode == "server") {
        const auto confirmations = confirmations_from_environment();
        if (!confirmations) {
            return 2;
        }
        auto server = afd::mcp::StdioServer::create(registry, {.name = "afd-todo-cpp",
                                                               .version = TODO_BACKEND_VERSION,
                                                               .confirmations = *confirmations,
                                                               .clock = clock});
        if (!server) {
            std::fprintf(stderr, "failed to start the MCP server: %s\n", server.error().c_str());
            return 2;
        }
        std::ios::sync_with_stdio(false);
        (*server)->serve(std::cin, std::cout);
        return 0;
    }
    if (mode == "list-commands") {
        for (const auto& command : registry.list()) {
            std::printf("%s\n", command->definition.name.c_str());
        }
        return 0;
    }

    afd::Json input = afd::Json::object();
    if (argc > 2) {
        auto parsed = afd::parse_bounded(argv[2]);
        if (!parsed) {
            std::fprintf(stderr, "invalid JSON input: %s\n", parsed.error().message.c_str());
            return 2;
        }
        input = *parsed;
    }
    const afd::CommandResult result = registry.execute(mode, input);
    if (result.error && result.error->code == afd::error_codes::COMMAND_NOT_FOUND) {
        std::fprintf(stderr, "%s\n", afd::wire::serialize(afd::Json(result)).c_str());
        return 2;
    }
    std::printf("%s\n",
                afd::Json(result).dump(2, ' ', false, afd::Json::error_handler_t::replace).c_str());
    return result.success ? 0 : 1;
}
