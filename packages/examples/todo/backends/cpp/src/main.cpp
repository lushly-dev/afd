// The C++ todo backend.
//
//   todo-server-cpp                      stdio MCP server (default)
//   todo-server-cpp list-commands        the registered command names
//   todo-server-cpp <command> [json]     run one command, as the person at the terminal, and
//                                        print its result
//
// Settings, as the other backends read them: CONFIRMATIONS (off, enforce or require-human),
// APPROVALS (agents or off) and TODO_APPROVAL_SECRET (at least 32 bytes).
//
// Exit codes: 0 success, 1 the command failed, 2 usage or configuration error.
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "app.hpp"
#include "store.hpp"
#include <afd/mcp_stdio.hpp>

namespace {

/// The environment variable's value, or nothing when it is unset. MSVC's runtime deprecates
/// `std::getenv` (C4996, an error under `AFD_WARNINGS_AS_ERRORS`), so there it is read with
/// `_dupenv_s`, which returns a copy the caller frees.
std::optional<std::string> environment(const char* name) {
#if defined(_MSC_VER)
    char* buffer = nullptr;
    std::size_t length = 0;
    if (_dupenv_s(&buffer, &length, name) != 0 || buffer == nullptr) {
        std::free(buffer);
        return std::nullopt;
    }
    std::string value(buffer);
    std::free(buffer);
    return value;
#else
    const char* value = std::getenv(name);
    if (value == nullptr) {
        return std::nullopt;
    }
    return std::string(value);
#endif
}

/// The value as the settings readers take it: null when unset.
const char* or_null(const std::optional<std::string>& value) {
    return value ? value->c_str() : nullptr;
}

/// `CONFIRMATIONS`: `off` (the default), `enforce` or `require-human`.
std::optional<afd::mcp::ConfirmationMode> confirmations_from_environment() {
    const std::string mode = environment("CONFIRMATIONS").value_or("off");
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
    const auto approvals_setting = environment("APPROVALS");
    const auto approvals = todo::approvals_from(or_null(approvals_setting));
    if (!approvals) {
        std::fprintf(stderr, "%s\n", approvals.error().c_str());
        return 2;
    }
    // The key is read only when clears are held, as TypeScript reads it.
    std::string secret;
    if (*approvals == todo::Approvals::agents) {
        const auto secret_setting = environment("TODO_APPROVAL_SECRET");
        auto read = todo::approval_secret(or_null(secret_setting));
        if (!read) {
            std::fprintf(stderr, "%s\n", read.error().c_str());
            return 2;
        }
        secret = std::move(*read);
    }

    auto clock = std::make_shared<afd::SystemClock>();
    auto registry =
        todo::make_registry(std::make_shared<todo::TodoStore>(),
                            {.approvals = *approvals, .secret = std::move(secret), .clock = clock});
    if (!registry) {
        std::fprintf(stderr, "failed to register commands: %s\n", registry.error().c_str());
        return 2;
    }

    const std::string mode = argc > 1 ? argv[1] : "server";
    if (mode == "server") {
        const auto confirmations = confirmations_from_environment();
        if (!confirmations) {
            return 2;
        }
        auto server = afd::mcp::StdioServer::create(**registry, {.name = "afd-todo-cpp",
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
        for (const auto& command : (*registry)->list()) {
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
    // The command line is the person at the terminal, so todo-clear is not held for them.
    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::human};
    const afd::CommandResult result = (*registry)->execute(mode, input, std::move(context));
    if (result.error && result.error->code == afd::error_codes::COMMAND_NOT_FOUND) {
        std::fprintf(stderr, "%s\n", afd::wire::serialize(afd::Json(result)).c_str());
        return 2;
    }
    std::printf("%s\n",
                afd::Json(result).dump(2, ' ', false, afd::Json::error_handler_t::replace).c_str());
    return result.success ? 0 : 1;
}
