// The C++ todo backend.
//
//   todo-server-cpp                      stdio MCP server (default)
//   todo-server-cpp list-commands        the registered command names
//   todo-server-cpp <command> [json]     run one command and print its result
//
// Exit codes: 0 success, 1 the command failed, 2 usage error.
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>

#include "commands.hpp"
#include "mcp_stdio.hpp"
#include "store.hpp"

int main(int argc, char** argv) {
    auto clock = std::make_shared<afd::SystemClock>();
    auto store = std::make_shared<todo::TodoStore>(clock, std::make_shared<afd::SeededRandom>());
    afd::CommandRegistry registry(afd::RegistryOptions{.clock = clock});
    if (const auto error = todo::register_todo_commands(registry, store)) {
        std::fprintf(stderr, "failed to register commands: %s\n", error->c_str());
        return 2;
    }

    const std::string mode = argc > 1 ? argv[1] : "server";
    if (mode == "server") {
        std::ios::sync_with_stdio(false);
        todo::serve(registry, std::cin, std::cout,
                    {.name = "afd-todo-cpp", .version = TODO_BACKEND_VERSION});
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
