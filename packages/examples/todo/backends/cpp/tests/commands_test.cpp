// The todo commands, against the TypeScript backend's behavior and texts.
#include <memory>
#include <string>

#include "fixture.hpp"

using todo::testing::Fixture;

namespace {

constexpr const char* not_found_suggestion =
    "Use todo-list to see available todos. If it was deleted, find it with todo-list { deleted: "
    "true } and bring it back with todo-restore.";

} // namespace

TEST_CASE("create, get, update, toggle and delete, each naming its undo") {
    Fixture fixture;
    const auto created =
        fixture.run("todo-create", {{"title", "Buy milk"}, {"description", "2 liters"}});
    REQUIRE(created["success"] == true);
    CHECK(created["data"]["priority"] == "medium");
    CHECK(created["reasoning"] == "Created todo \"Buy milk\" with medium priority");
    CHECK(created["metadata"]["commandVersion"] == "1.0.0");
    const std::string id = created["data"]["id"];
    CHECK(id.rfind("todo-1767225600001-", 0) == 0);
    CHECK(created["data"]["createdAt"] == "2026-01-01T00:00:00.001Z");
    CHECK_FALSE(created["data"].contains("completedAt"));
    CHECK(created["undoCommand"] == "todo-delete");
    CHECK(created["undoArgs"] == afd::Json{{"id", id}});

    CHECK(fixture.run("todo-get", {{"id", id}})["data"]["title"] == "Buy milk");

    const auto updated =
        fixture.run("todo-update", {{"id", id}, {"title", "Buy oat milk"}, {"priority", "high"}});
    CHECK(updated["reasoning"] ==
          "Updated title to \"Buy oat milk\", priority to high for todo \"Buy oat milk\"");
    CHECK(updated["undoCommand"] == "todo-update");
    CHECK(updated["undoArgs"] ==
          afd::Json{{"id", id}, {"title", "Buy milk"}, {"priority", "medium"}});

    const auto toggled = fixture.run("todo-toggle", {{"id", id}});
    CHECK(toggled["data"]["completed"] == true);
    CHECK(toggled["data"].contains("completedAt"));
    CHECK(toggled["reasoning"] == "Marked as completed: \"Buy oat milk\"");
    CHECK(toggled["undoCommand"] == "todo-update");
    CHECK(toggled["undoArgs"] == afd::Json{{"id", id}, {"completed", false}});
    CHECK_FALSE(fixture.run("todo-toggle", {{"id", id}})["data"].contains("completedAt"));

    const auto deleted = fixture.run("todo-delete", {{"id", id}});
    CHECK(deleted["data"] == afd::Json{{"deleted", true}, {"id", id}});
    CHECK(deleted["reasoning"] == "Deleted todo \"Buy oat milk\"; todo-restore brings it back");
    CHECK(deleted["warnings"][0] ==
          afd::Json{{"code", "RESTORABLE"},
                    {"message", "Kept with the deleted todos: todo-restore brings it back until "
                                "todo-clear empties them"},
                    {"severity", "info"}});
    CHECK(deleted["undoCommand"] == "todo-restore");
    CHECK(deleted["undoArgs"] == afd::Json{{"ids", afd::Json::array({id})}});
    CHECK(fixture.run("todo-get", {{"id", id}})["error"]["code"] == "NOT_FOUND");
}

TEST_CASE("an update's undo sets an absent description back as empty, which removes it") {
    Fixture fixture;
    const std::string id = fixture.create("Plain");
    const auto described = fixture.run("todo-update", {{"id", id}, {"description", "Added"}});
    CHECK(described["undoArgs"] == afd::Json{{"id", id}, {"description", ""}});
    const auto undone = fixture.run("todo-update", described["undoArgs"]);
    CHECK_FALSE(undone["data"].contains("description"));
}

TEST_CASE("errors carry the TypeScript codes, messages and suggestions") {
    Fixture fixture;
    CHECK(fixture.run("todo-get", {{"id", "nope"}})["error"] ==
          afd::Json{{"code", "NOT_FOUND"},
                    {"message", "Todo with ID \"nope\" not found"},
                    {"suggestion", not_found_suggestion}});
    const std::string id = fixture.create("x");
    CHECK(fixture.run("todo-update", {{"id", id}})["error"] ==
          afd::Json{
              {"code", "NO_CHANGES"},
              {"message", "No fields to update"},
              {"suggestion", "Provide at least one of: title, description, completed, priority"}});
    const auto missing = fixture.run("todo-create");
    CHECK(missing["error"]["details"]["missingFields"][0] == "title");
    CHECK(missing["error"]["details"]["errors"][0]["path"] == "title");
    CHECK(fixture.run("todo-list", {{"limit", 101}})["error"]["code"] == "VALIDATION_ERROR");
    CHECK(fixture.run("todo-create", {{"title", std::string(201, 'x')}})["error"]["code"] ==
          "VALIDATION_ERROR");
}

TEST_CASE("ids are TypeScript's for the same clock and seed") {
    auto clock = std::make_shared<afd::ManualClock>(1700000000000);
    const auto make = [&] {
        auto registry =
            todo::make_registry(std::make_shared<todo::TodoStore>(),
                                {.approvals = todo::Approvals::off,
                                 .clock = clock,
                                 .random = std::make_shared<afd::SeededRandom>("todo")});
        REQUIRE(registry.has_value());
        return std::move(*registry);
    };
    const afd::Json first = make()->execute("todo-create", {{"title", "Seeded"}});
    // TypeScript's stampFrom with seededRandom('todo') at this time makes the same id.
    CHECK(first["data"]["id"] == "todo-1700000000000-w76p4ky");
    CHECK(first["data"]["createdAt"] == "2023-11-14T22:13:20.000Z");
    CHECK(afd::Json(make()->execute("todo-create", {{"title", "Seeded"}}))["data"]["id"] ==
          first["data"]["id"]);
}

TEST_CASE("list filters, sorts newest first, paginates and offers alternatives") {
    Fixture fixture;
    for (const char* title : {"First", "Second", "Third"}) {
        fixture.create(title);
    }
    const auto page = fixture.run("todo-list", {{"limit", 2}});
    CHECK(page["data"]["total"] == 3);
    CHECK(page["data"]["hasMore"] == true);
    CHECK(page["data"]["todos"][0]["title"] == "Third");
    CHECK(page["reasoning"] == "Found 3 todos, returning 2 starting at offset 0");
    CHECK_FALSE(page.contains("alternatives"));

    const auto ascending = fixture.run("todo-list", {{"sortBy", "title"}, {"sortOrder", "asc"}});
    CHECK(ascending["data"]["todos"][0]["title"] == "First");

    const std::string first_id = page["data"]["todos"][1]["id"];
    fixture.run("todo-toggle", {{"id", first_id}});
    const auto done = fixture.run("todo-list", {{"completed", true}});
    CHECK(done["data"]["total"] == 1);
    CHECK(done["reasoning"] == "Found 1 todos (completed), returning 1 starting at offset 0");
    REQUIRE(done["alternatives"].size() == 2);
    CHECK(done["alternatives"][0]["reason"] == "View all 3 todos without filters");
    CHECK(done["alternatives"][0]["data"]["total"] == 3);
    CHECK(done["alternatives"][1]["reason"] == "View pending todos instead (2)");
    CHECK(done["alternatives"][1]["confidence"] == 1.0);
}

TEST_CASE("ties keep insertion order in both directions") {
    Fixture fixture;
    for (const char* title : {"a", "b", "c"}) {
        fixture.run("todo-create", {{"title", title}, {"priority", "high"}});
    }
    const auto titles = [&](const char* order) {
        const auto listed =
            fixture.run("todo-list", {{"sortBy", "priority"}, {"sortOrder", order}});
        std::string joined;
        for (const auto& todo : listed["data"]["todos"]) {
            joined += todo["title"].get<std::string>();
        }
        return joined;
    };
    CHECK(titles("desc") == "abc");
    CHECK(titles("asc") == "abc");
}

TEST_CASE("clear removes completed todos for good and lists their ids") {
    Fixture fixture;
    const std::string id = fixture.create("Done");
    fixture.create("Pending");
    CHECK(fixture.run("todo-stats")["reasoning"] ==
          "2 total todos, 0 completed, 2 pending, 0% completion rate");
    fixture.run("todo-toggle", {{"id", id}});
    const auto stats = fixture.run("todo-stats");
    CHECK(stats["data"]["completionRate"] == 0.5);
    CHECK(stats["data"]["byPriority"]["medium"] == 2);
    CHECK(stats["reasoning"] == "2 total todos, 1 completed, 1 pending, 50% completion rate");
    const auto cleared = fixture.run("todo-clear");
    CHECK(cleared["data"] ==
          afd::Json{{"cleared", 1}, {"remaining", 1}, {"clearedIds", afd::Json::array({id})}});
    CHECK(cleared["reasoning"] == "Cleared 1 completed todo, 1 remaining");
    CHECK(cleared["warnings"][0]["code"] == "PERMANENT");
    CHECK_FALSE(cleared.contains("undoCommand"));
    CHECK(fixture.run("todo-clear")["reasoning"] == "No completed todos to clear, 1 remaining");
    CHECK(fixture.run("todo-clear", {{"all", true}})["reasoning"] == "Cleared all 1 todos");
    CHECK(fixture.run("todo-stats")["reasoning"] == "No todos yet");
}

TEST_CASE("batch commands report partial failure and name their undo") {
    Fixture fixture;
    const auto created =
        fixture.run("todo-create-batch", {{"todos", {{{"title", "Valid"}}, {{"title", "   "}}}}});
    CHECK(created["data"]["summary"] ==
          afd::Json{{"total", 2}, {"successCount", 1}, {"failureCount", 1}});
    CHECK(created["data"]["failed"][0]["index"] == 1);
    CHECK(created["data"]["failed"][0]["error"]["suggestion"] ==
          "Provide a non-empty title for this todo");
    CHECK(created["warnings"][0]["code"] == "PARTIAL_SUCCESS");
    CHECK(created["confidence"] == 0.5);
    CHECK(created["reasoning"] == "Created 1 of 2 todos. 1 failed validation.");
    const std::string id = created["data"]["succeeded"][0]["id"];
    CHECK(created["undoCommand"] == "todo-delete-batch");
    CHECK(created["undoArgs"] == afd::Json{{"ids", afd::Json::array({id})}});

    const auto flipped = fixture.run("todo-toggle-batch", {{"ids", {id, "missing"}}});
    CHECK(flipped["reasoning"] == "Toggled 1 of 2 todos. 1 were not found.");
    CHECK(flipped["data"]["summary"]["markedComplete"] == 1);
    CHECK(flipped["data"]["failed"][0]["error"]["suggestion"] == not_found_suggestion);
    CHECK(flipped["undoArgs"] == afd::Json{{"ids", afd::Json::array({id})}, {"completed", false}});

    const auto deleted = fixture.run("todo-delete-batch", {{"ids", {id, "missing"}}});
    CHECK(deleted["data"]["deletedIds"] == afd::Json::array({id}));
    CHECK(deleted["warnings"][0]["code"] == "DESTRUCTIVE_BATCH");
    CHECK(deleted["warnings"][0]["message"] ==
          "Deleted 1 todos; todo-restore brings them back until todo-clear empties the deleted "
          "todos");
    CHECK(deleted["warnings"][1]["code"] == "PARTIAL_SUCCESS");
    CHECK(deleted["undoCommand"] == "todo-restore");
    CHECK(fixture.run("todo-create-batch", {{"todos", afd::Json::array()}})["error"]["code"] ==
          "VALIDATION_ERROR");
}

TEST_CASE("toggle-batch names no single undo when the todos had different states") {
    Fixture fixture;
    const std::string open = fixture.create("Open");
    const std::string done = fixture.create("Done");
    fixture.run("todo-toggle", {{"id", done}});
    const auto flipped = fixture.run("todo-toggle-batch", {{"ids", {open, done}}});
    CHECK_FALSE(flipped.contains("undoCommand"));
    CHECK(flipped["warnings"][0]["code"] == "NO_SINGLE_UNDO");

    // Now `open` is done and `done` is open. Setting a state skips todos already in it, and the
    // undo covers only those it changed.
    const auto set = fixture.run("todo-toggle-batch", {{"ids", {open, done}}, {"completed", true}});
    CHECK(set["reasoning"] ==
          "Successfully set to complete all 2 todos (2 complete, 0 incomplete)");
    CHECK(set["undoArgs"] == afd::Json{{"ids", afd::Json::array({done})}, {"completed", false}});
}
