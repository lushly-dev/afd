// Deleted todos, todo-restore and todo-history: jobs 3 to 5 of the to-do reference plan.
#include <string>
#include <thread>
#include <vector>

#include "fixture.hpp"

using todo::testing::Fixture;

TEST_CASE("a deleted todo is listed as deleted and restored exactly as it was") {
    Fixture fixture;
    const std::string id =
        fixture.run("todo-create", {{"title", "Keep me"}, {"priority", "high"}})["data"]["id"];
    const auto before = fixture.run("todo-get", {{"id", id}})["data"];
    fixture.run("todo-delete", {{"id", id}});

    CHECK(fixture.run("todo-list")["data"]["total"] == 0);
    const auto deleted = fixture.run("todo-list", {{"deleted", true}, {"sortBy", "deletedAt"}});
    CHECK(deleted["data"]["total"] == 1);
    CHECK(deleted["data"]["todos"][0]["deletedAt"] == "2026-01-01T00:00:00.003Z");
    CHECK(deleted["reasoning"] == "Found 1 todos (deleted), returning 1 starting at offset 0");

    const auto restored = fixture.run("todo-restore", {{"ids", {id}}});
    CHECK(restored["reasoning"] == "Restored 1 todo");
    CHECK(restored["data"]["restoredIds"] == afd::Json::array({id}));
    CHECK(restored["data"]["restored"][0] == before);
    CHECK(restored["undoCommand"] == "todo-delete-batch");
    CHECK(restored["undoArgs"] == afd::Json{{"ids", afd::Json::array({id})}});
    CHECK(fixture.run("todo-get", {{"id", id}})["data"] == before);
    CHECK(fixture.run("todo-list", {{"deleted", true}})["data"]["total"] == 0);
}

TEST_CASE("restore reports ids it cannot bring back") {
    Fixture fixture;
    const std::string live = fixture.create("Live");
    const std::string gone = fixture.create("Gone");
    fixture.run("todo-delete", {{"id", gone}});
    const auto result = fixture.run("todo-restore", {{"ids", {gone, live, "missing"}}});
    CHECK(result["reasoning"] == "Restored 1 of 3 todos; 2 could not be restored");
    CHECK(result["warnings"][0]["message"] == "2 of 3 could not be restored");
    CHECK(result["data"]["failed"][0]["error"] ==
          afd::Json{{"code", "NOT_FOUND"},
                    {"message", "Todo \"" + live + "\" is not deleted"},
                    {"suggestion", "It is already a live todo: use todo-get to read it"}});
    CHECK(result["data"]["failed"][1]["error"]["message"] == "No deleted todo has ID \"missing\"");
    CHECK(fixture.run("todo-restore", {{"ids", {"missing"}}})["reasoning"] ==
          "Restored none of 1: no deleted todo has that ID");
}

TEST_CASE("clear empties the deleted todos with deleted, and everything with all") {
    Fixture fixture;
    const std::string live = fixture.create("Live");
    const std::string gone = fixture.create("Gone");
    fixture.run("todo-delete", {{"id", gone}});
    const auto emptied = fixture.run("todo-clear", {{"deleted", true}});
    CHECK(emptied["data"] ==
          afd::Json{{"cleared", 1}, {"remaining", 1}, {"clearedIds", afd::Json::array({gone})}});
    CHECK(emptied["reasoning"] == "Emptied 1 deleted todo, 1 remaining");
    CHECK(fixture.run("todo-restore", {{"ids", {gone}}})["data"]["summary"]["failureCount"] == 1);

    const std::string other = fixture.create("Other");
    fixture.run("todo-delete", {{"id", other}});
    const auto all = fixture.run("todo-clear", {{"all", true}});
    CHECK(all["data"]["clearedIds"] == afd::Json::array({live, other}));
    CHECK(all["reasoning"] == "Cleared all 2 todos");
}

TEST_CASE("history records each change with its actor, time, todos and undo, newest first") {
    Fixture fixture;
    const std::string id = fixture.run("todo-create", {{"title", "Tracked"}}, afd::ActorKind::agent,
                                       "assistant")["data"]["id"];
    fixture.run("todo-toggle", {{"id", id}});
    fixture.run("todo-get", {{"id", id}});                           // reads are not recorded
    fixture.run("todo-update", {{"id", "missing"}, {"title", "x"}}); // nor failures

    const auto history = fixture.run("todo-history");
    CHECK(history["data"]["total"] == 2);
    CHECK(history["data"]["hasMore"] == false);
    const auto& latest = history["data"]["entries"][0];
    CHECK(latest["seq"] == 2);
    CHECK(latest["command"] == "todo-toggle");
    CHECK(latest["actor"] == afd::Json{{"kind", "human"}});
    CHECK(latest["ids"] == afd::Json::array({id}));
    CHECK(latest["undoCommand"] == "todo-update");
    CHECK(latest["at"] == "2026-01-01T00:00:00.002Z");
    CHECK(history["reasoning"] == "2 changes recorded; the latest shown is todo-toggle by human at "
                                  "2026-01-01T00:00:00.002Z");

    // The create is no longer its todo's latest change, so its undo is not offered.
    const auto& first = history["data"]["entries"][1];
    CHECK(first["actor"] == afd::Json{{"kind", "agent"}, {"id", "assistant"}});
    CHECK(first["superseded"] == true);
    CHECK_FALSE(first.contains("undoCommand"));
    CHECK_FALSE(first.contains("undoArgs"));

    CHECK(fixture.run("todo-history", {{"actor", "agent"}})["data"]["total"] == 1);
    CHECK(fixture.run("todo-history", {{"todoId", "other"}})["reasoning"] ==
          "No changes recorded that match");
    CHECK(fixture.run("todo-history", {{"limit", 1}, {"offset", 1}})["data"]["entries"][0]["seq"] ==
          1);
}

TEST_CASE("history keeps the latest changes") {
    todo::TodoStore store;
    for (std::size_t i = 0; i < todo::history_limit + 5; ++i) {
        store.record({.actor_kind = "test", .command = "todo-create", .ids = {"x"}});
    }
    const auto history = store.history();
    REQUIRE(history.size() == todo::history_limit);
    CHECK(history.front().seq == 6);
    CHECK(history.back().seq == static_cast<std::int64_t>(todo::history_limit + 5));
}

TEST_CASE("concurrent changes are recorded in the order they happened") {
    Fixture fixture;
    const std::string id = fixture.create("Busy");
    std::vector<std::thread> threads;
    for (int t = 0; t < 4; ++t) {
        threads.emplace_back([&] {
            for (int i = 0; i < 50; ++i) {
                (void)fixture.registry->execute("todo-toggle", {{"id", id}});
            }
        });
    }
    for (auto& thread : threads) {
        thread.join();
    }
    const auto entries = fixture.store->history();
    REQUIRE(entries.size() == 201);
    // Each toggle's undo sets back the state the previous toggle left.
    for (std::size_t i = 2; i < entries.size(); ++i) {
        CHECK(entries[i].undo_args->at("completed") == (i % 2 == 0));
    }
    CHECK(fixture.run("todo-get", {{"id", id}})["data"]["completed"] == false);
}
