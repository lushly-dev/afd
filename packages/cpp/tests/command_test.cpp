#include "afd/command.hpp"

#include <doctest.h>

TEST_CASE("validate_command_name accepts domain-action kebab-case only") {
    for (const char* name : {"todo-create", "user-get", "a1-b2", "todo-list-all"}) {
        CAPTURE(name);
        CHECK(afd::validate_command_name(name).valid);
    }
    for (const char* name : {"todo", "Todo-create", "todo_create", "todo-", "-todo", "todo--create",
                             "1todo-create", "todo-1create", "todo.create"}) {
        CAPTURE(name);
        const auto check = afd::validate_command_name(name);
        CHECK_FALSE(check.valid);
        CHECK(check.reason == "Command name '" + std::string(name) +
                                  "' must use kebab-case with at least two segments (e.g., "
                                  "'domain-action'). Got '" +
                                  std::string(name) + "'.");
    }
    CHECK(afd::validate_command_name("").reason == "Command name must not be empty");
}

TEST_CASE("exposure defaults: palette and agent on, mcp and cli opt-in") {
    const auto expose = afd::default_expose();
    CHECK(afd::is_exposed_to(expose, afd::Interface::palette));
    CHECK(afd::is_exposed_to(expose, afd::Interface::agent));
    CHECK_FALSE(afd::is_exposed_to(expose, afd::Interface::mcp));
    CHECK_FALSE(afd::is_exposed_to(expose, afd::Interface::cli));
    CHECK(afd::is_exposed_to(afd::ExposeOptions{.mcp = true}, afd::Interface::mcp));
}
