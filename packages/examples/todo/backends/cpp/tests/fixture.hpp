// A registry with the todo commands on a manual clock and a seeded random, for deterministic
// tests, and the shared contract read from spec/commands.schema.json.
#pragma once

#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "app.hpp"
#include "commands.hpp"
#include "store.hpp"
#include <afd/afd.hpp>
#include <doctest.h>

namespace todo::testing {

inline constexpr const char* secret = "a test approval secret of 32 bytes or more";

struct Fixture {
    std::shared_ptr<afd::ManualClock> clock = std::make_shared<afd::ManualClock>(1767225600000);
    std::shared_ptr<TodoStore> store = std::make_shared<TodoStore>();
    std::unique_ptr<afd::CommandRegistry> registry;

    explicit Fixture(Approvals approvals = Approvals::off) {
        auto made = make_registry(store, {.approvals = approvals,
                                          .secret = secret,
                                          .clock = clock,
                                          .random = std::make_shared<afd::SeededRandom>("1")});
        REQUIRE_MESSAGE(made.has_value(), (made ? std::string() : made.error()));
        registry = std::move(*made);
    }

    /// The todo commands: every registered command but the context and bootstrap commands
    /// (category `bootstrap`).
    [[nodiscard]] std::vector<std::shared_ptr<const afd::RegisteredCommand>> todo_commands() const {
        std::vector<std::shared_ptr<const afd::RegisteredCommand>> commands;
        for (const auto& command : registry->list()) {
            if (command->definition.category != "bootstrap") {
                commands.push_back(command);
            }
        }
        return commands;
    }

    /// Runs `name` as `actor` (a person by default), a millisecond after the last call.
    afd::Json run(const char* name, const afd::Json& input = afd::Json::object(),
                  afd::ActorKind actor = afd::ActorKind::human,
                  std::optional<std::string> actor_id = std::nullopt) {
        clock->advance(1); // distinct timestamps, as real time would give
        afd::CommandContext context;
        context.actor = afd::Actor{.kind = actor, .id = std::move(actor_id)};
        return registry->execute(name, input, std::move(context));
    }

    /// Creates a todo and returns its id.
    std::string create(const char* title) {
        const auto created = run("todo-create", {{"title", title}});
        REQUIRE(created["success"] == true);
        return created["data"]["id"].get<std::string>();
    }
};

/// spec/commands.schema.json, read from the source tree.
inline const afd::Json& spec() {
    static const afd::Json parsed = [] {
        std::ifstream in(TODO_SPEC_PATH, std::ios::binary);
        const std::string text{std::istreambuf_iterator<char>(in),
                               std::istreambuf_iterator<char>()};
        auto result = afd::parse_bounded(text);
        REQUIRE_MESSAGE(result.has_value(), TODO_SPEC_PATH);
        return *result;
    }();
    return parsed;
}

} // namespace todo::testing
