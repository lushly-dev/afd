// A registry with the todo commands on a manual clock, for deterministic tests.
#pragma once

#include <memory>

#include "commands.hpp"
#include "store.hpp"
#include <afd/afd.hpp>
#include <doctest.h>

namespace todo::testing {

struct Fixture {
    std::shared_ptr<afd::ManualClock> clock = std::make_shared<afd::ManualClock>(1767225600000);
    std::shared_ptr<TodoStore> store =
        std::make_shared<TodoStore>(clock, std::make_shared<afd::SeededRandom>(1));
    std::unique_ptr<afd::CommandRegistry> registry =
        std::make_unique<afd::CommandRegistry>(afd::RegistryOptions{.clock = clock});

    Fixture() {
        const auto error = register_todo_commands(*registry, store);
        REQUIRE_MESSAGE(!error, error.value_or(""));
    }

    afd::Json run(const char* name, const afd::Json& input = afd::Json::object()) {
        clock->advance(1); // distinct timestamps, as real time would give
        return registry->execute(name, input);
    }
};

} // namespace todo::testing
