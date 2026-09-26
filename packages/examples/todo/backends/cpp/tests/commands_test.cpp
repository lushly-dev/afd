// The todo commands, against the TypeScript backend's behavior and texts.
#include <algorithm>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "fixture.hpp"
#include "spec.hpp"

using todo::testing::Fixture;

TEST_CASE("the registered commands are exactly those in commands.schema.json") {
    Fixture fixture;
    std::vector<std::string> registered;
    for (const auto& command : fixture.registry->list()) {
        registered.push_back(command->definition.name);
        CHECK(command->definition.expose.mcp);
    }
    std::vector<std::string> specified = todo::spec_command_names();
    std::sort(registered.begin(), registered.end());
    std::sort(specified.begin(), specified.end());
    CHECK(registered == specified);
    CHECK(registered.size() == 11);
}

TEST_CASE("the embedded contract is the file on disk") {
    std::ifstream in(TODO_SPEC_PATH, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    CHECK(todo::embedded_spec() == text);
}

TEST_CASE("create, get, update, toggle and delete") {
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

    CHECK(fixture.run("todo-get", {{"id", id}})["data"]["title"] == "Buy milk");

    const auto updated =
        fixture.run("todo-update", {{"id", id}, {"title", "Buy oat milk"}, {"priority", "high"}});
    CHECK(updated["reasoning"] ==
          "Updated title to \"Buy oat milk\", priority to high for todo \"Buy oat milk\"");

    const auto toggled = fixture.run("todo-toggle", {{"id", id}});
    CHECK(toggled["data"]["completed"] == true);
    CHECK(toggled["data"].contains("completedAt"));
    CHECK(toggled["reasoning"] == "Marked as completed: \"Buy oat milk\"");
    CHECK_FALSE(fixture.run("todo-toggle", {{"id", id}})["data"].contains("completedAt"));

    const auto deleted = fixture.run("todo-delete", {{"id", id}});
    CHECK(deleted["data"] == afd::Json{{"deleted", true}, {"id", id}});
    CHECK(deleted["warnings"][0] == afd::Json{{"code", "PERMANENT"},
                                              {"message", "This action cannot be undone"},
                                              {"severity", "info"}});
}

TEST_CASE("errors carry the TypeScript codes, messages and suggestions") {
    Fixture fixture;
    CHECK(fixture.run("todo-get", {{"id", "nope"}})["error"] ==
          afd::Json{{"code", "NOT_FOUND"},
                    {"message", "Todo with ID \"nope\" not found"},
                    {"suggestion", "Use todo-list to see available todos"}});
    const std::string id = fixture.run("todo-create", {{"title", "x"}})["data"]["id"];
    CHECK(fixture.run("todo-update", {{"id", id}})["error"] ==
          afd::Json{
              {"code", "NO_CHANGES"},
              {"message", "No fields to update"},
              {"suggestion", "Provide at least one of: title, description, completed, priority"}});
    const auto missing = fixture.run("todo-create");
    CHECK(missing["error"]["details"]["missingFields"][0] == "title");
    CHECK(missing["error"]["details"]["errors"][0]["path"] == "title");
    CHECK(fixture.run("todo-list", {{"limit", 101}})["error"]["code"] == "VALIDATION_ERROR");
}

TEST_CASE("list filters, sorts newest first, paginates and offers alternatives") {
    Fixture fixture;
    for (const char* title : {"First", "Second", "Third"}) {
        fixture.run("todo-create", {{"title", title}});
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
    CHECK(done["alternatives"][1]["reason"] == "View pending todos instead (2)");
}

TEST_CASE("clear and stats") {
    Fixture fixture;
    const std::string id = fixture.run("todo-create", {{"title", "Done"}})["data"]["id"];
    fixture.run("todo-create", {{"title", "Pending"}});
    CHECK(fixture.run("todo-stats")["reasoning"] ==
          "2 total todos, 0 completed, 2 pending, 0% completion rate");
    fixture.run("todo-toggle", {{"id", id}});
    const auto stats = fixture.run("todo-stats");
    CHECK(stats["data"]["completionRate"] == 0.5);
    CHECK(stats["data"]["byPriority"]["medium"] == 2);
    CHECK(stats["reasoning"] == "2 total todos, 1 completed, 1 pending, 50% completion rate");
    const auto cleared = fixture.run("todo-clear");
    CHECK(cleared["data"] == afd::Json{{"cleared", 1}, {"remaining", 1}});
    CHECK(cleared["reasoning"] == "Cleared 1 completed todo, 1 remaining");
    CHECK(fixture.run("todo-clear", {{"all", true}})["data"] ==
          afd::Json{{"cleared", 1}, {"remaining", 0}});
    CHECK(fixture.run("todo-stats")["reasoning"] == "No todos yet");
}

TEST_CASE("batch commands report partial failure") {
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
    const auto flipped = fixture.run("todo-toggle-batch", {{"ids", {id, "missing"}}});
    CHECK(flipped["reasoning"] == "Toggled 1 of 2 todos. 1 were not found.");
    CHECK(flipped["data"]["summary"]["markedComplete"] == 1);

    const auto deleted = fixture.run("todo-delete-batch", {{"ids", {id, "missing"}}});
    CHECK(deleted["data"]["deletedIds"] == afd::Json{id});
    CHECK(deleted["warnings"][0]["code"] == "DESTRUCTIVE_BATCH");
    CHECK(deleted["warnings"][1]["code"] == "PARTIAL_SUCCESS");
    CHECK(fixture.run("todo-create-batch", {{"todos", afd::Json::array()}})["error"]["code"] ==
          "VALIDATION_ERROR");
}
