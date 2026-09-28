#include "fixture.hpp"

TEST_CASE("equal timestamps keep insertion order (stable sort)") {
    auto clock = std::make_shared<afd::ManualClock>(0);
    todo::TodoStore store(clock, std::make_shared<afd::SeededRandom>(2));
    store.create("a", std::nullopt, "low");
    store.create("b", std::nullopt, "high");
    store.create("c", std::nullopt, "medium");
    const auto newest = store.list({});
    REQUIRE(newest.size() == 3);
    CHECK(newest[0].title == "a"); // all created in the same millisecond
    const auto by_priority = store.list({.sort_by = "priority"});
    CHECK(by_priority[0].title == "b");
    CHECK(by_priority[2].title == "a");
}

TEST_CASE("update sets and clears completedAt only on a change") {
    auto clock = std::make_shared<afd::ManualClock>(0);
    todo::TodoStore store(clock, std::make_shared<afd::SeededRandom>(3));
    const auto todo = store.create("x", std::nullopt, "medium");
    clock->advance(5);
    const auto done = store.update(todo.id, {.completed = true});
    REQUIRE(done.has_value());
    CHECK(done->completed_at == "1970-01-01T00:00:00.005Z");
    clock->advance(5);
    CHECK(store.update(todo.id, {.completed = true})->completed_at == "1970-01-01T00:00:00.005Z");
    CHECK_FALSE(store.update(todo.id, {.completed = false})->completed_at.has_value());
    CHECK_FALSE(store.update("missing", {.title = "y"}).has_value());
}
