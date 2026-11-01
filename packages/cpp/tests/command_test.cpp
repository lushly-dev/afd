#include "afd/command.hpp"
#include "afd/registry.hpp"
#include "afd/result.hpp"

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

TEST_CASE("title is optional, unset by default, and carried through the registry") {
    const afd::CommandDefinition untitled{.name = "todo-list", .description = "List todos"};
    CHECK_FALSE(untitled.title.has_value());

    const afd::CommandDefinition titled{
        .name = "todo-create",
        .description = "Create a todo",
        .title = "Create a todo item",
        .category = "todo",
        .handler = [](const afd::Json&, afd::CommandContext&) { return afd::success(nullptr); },
        .mutation = true,
        .confirm_prompt = "Create it",
    };
    CHECK(titled.title == "Create a todo item");

    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(titled));
    REQUIRE_FALSE(registry.register_command(
        {.name = "todo-get",
         .description = "Get a todo",
         .handler = [](const afd::Json&, afd::CommandContext&) { return afd::success(nullptr); }}));
    const auto stored = registry.get("todo-create");
    REQUIRE(stored);
    CHECK(stored->definition.title == "Create a todo item");
    const auto plain = registry.get("todo-get");
    REQUIRE(plain);
    CHECK_FALSE(plain->definition.title.has_value());
}
