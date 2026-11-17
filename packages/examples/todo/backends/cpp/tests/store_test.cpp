#include "fixture.hpp"

namespace {

todo::Todo add(todo::TodoStore& store, const char* id, const char* priority, const char* at) {
    return store.create({.id = id, .title = id, .priority = priority, .now = at});
}

std::string ids(const std::vector<todo::Todo>& todos) {
    std::string joined;
    for (const auto& todo : todos) {
        joined += todo.id;
    }
    return joined;
}

} // namespace

TEST_CASE("equal keys keep insertion order in both directions (stable sort)") {
    todo::TodoStore store;
    add(store, "a", "low", "t1");
    add(store, "b", "high", "t1");
    add(store, "c", "medium", "t1");
    add(store, "d", "medium", "t2");
    CHECK(ids(store.list({}, "createdAt", "desc")) == "dabc");
    CHECK(ids(store.list({}, "createdAt", "asc")) == "abcd");
    CHECK(ids(store.list({}, "priority", "desc")) == "bcda");
}

TEST_CASE("a restored todo counts as added again") {
    todo::TodoStore store;
    add(store, "a", "low", "t1");
    add(store, "b", "low", "t1");
    REQUIRE(store.remove("a", "t2"));
    REQUIRE(store.restore("a"));
    CHECK(ids(store.list({}, "createdAt", "asc")) == "ba");
}

TEST_CASE("update sets and clears completedAt only on a change") {
    todo::TodoStore store;
    const auto todo = add(store, "x", "medium", "t0");
    const auto done = store.update(todo.id, {.completed = true}, "t5");
    REQUIRE(done.has_value());
    CHECK(done->completed_at == "t5");
    CHECK(store.update(todo.id, {.completed = true}, "t9")->completed_at == "t5");
    CHECK_FALSE(store.update(todo.id, {.completed = false}, "t10")->completed_at.has_value());
    CHECK_FALSE(store.update("missing", {.title = "y"}, "t11").has_value());
}

TEST_CASE("a deleted todo leaves the live list and comes back as it was") {
    todo::TodoStore store;
    const auto created = add(store, "a", "high", "t1");
    const auto deleted = store.remove("a", "t5");
    REQUIRE(deleted.has_value());
    CHECK(deleted->deleted_at == "t5");
    CHECK_FALSE(store.get("a").has_value());
    CHECK(ids(store.list({.deleted = true}, "deletedAt", "desc")) == "a");
    const auto restored = store.restore("a");
    REQUIRE(restored.has_value());
    CHECK_FALSE(restored->deleted_at.has_value());
    CHECK(restored->created_at == created.created_at);
    CHECK_FALSE(store.restore("a").has_value());
}
