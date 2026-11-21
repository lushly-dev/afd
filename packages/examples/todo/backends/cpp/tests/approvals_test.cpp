// The approval hold on todo-clear (`APPROVALS`, `TODO_APPROVAL_SECRET`), in process. Over MCP
// the conformance runner's approvals suite runs it.
#include <string>

#include "fixture.hpp"

using todo::Approvals;
using todo::testing::Fixture;

TEST_CASE("APPROVALS is agents by default, or off, exactly") {
    CHECK(*todo::approvals_from(nullptr) == Approvals::agents);
    CHECK(*todo::approvals_from("agents") == Approvals::agents);
    CHECK(*todo::approvals_from("off") == Approvals::off);
    const auto wrong = todo::approvals_from("Off");
    REQUIRE_FALSE(wrong.has_value());
    CHECK(wrong.error() == "APPROVALS must be agents or off, not \"Off\"");
}

TEST_CASE("TODO_APPROVAL_SECRET must be at least 32 bytes; unset, a random key is made") {
    CHECK_FALSE(todo::approval_secret("too short").has_value());
    CHECK(*todo::approval_secret(todo::testing::secret) == todo::testing::secret);
    const auto first = todo::approval_secret(nullptr);
    const auto second = todo::approval_secret(nullptr);
    REQUIRE(first.has_value());
    CHECK(first->size() == 32);
    CHECK(*first != *second);
}

TEST_CASE("an agent's clear is held with a summary, and is not recorded") {
    Fixture fixture(Approvals::agents);
    const std::string id = fixture.create("Done already");
    fixture.run("todo-toggle", {{"id", id}});
    const auto held = fixture.run("todo-clear", afd::Json::object(), afd::ActorKind::agent);
    REQUIRE(held["success"] == false);
    CHECK(held["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK(held["error"]["details"]["summary"] ==
          "Remove the completed todos for good (1 todo now)");
    CHECK(held["error"].contains("suggestion"));
    CHECK(fixture.run("todo-list", {{"completed", true}})["data"]["total"] == 1);
    CHECK(fixture.run("todo-history", {{"todoId", id}})["data"]["total"] == 2);

    // Only the clear is held: a delete can be undone.
    CHECK(fixture.run("todo-delete", {{"id", id}}, afd::ActorKind::agent)["success"] == true);
    CHECK(fixture.run("todo-clear", {{"deleted", true}},
                      afd::ActorKind::agent)["error"]["details"]["summary"] ==
          "Empty the deleted todos for good (1 todo now)");
    CHECK(fixture.run("todo-clear", {{"all", true}},
                      afd::ActorKind::agent)["error"]["details"]["summary"] ==
          "Remove every todo for good, live and deleted (1 todo now)");
}

TEST_CASE("a person's clear runs without approval") {
    Fixture fixture(Approvals::agents);
    const std::string id = fixture.create("Done already");
    fixture.run("todo-toggle", {{"id", id}});
    CHECK(fixture.run("todo-clear")["data"]["cleared"] == 1);
}

TEST_CASE("an approved clear runs once with the token, for the same call") {
    Fixture fixture(Approvals::agents);
    const std::string id = fixture.create("Done already");
    fixture.run("todo-toggle", {{"id", id}});
    const auto held = fixture.run("todo-clear", afd::Json::object(), afd::ActorKind::agent);
    // In process, outside MCP, the hold carries the token for trusted code to retry with.
    const std::string token = held["error"]["details"]["approvalToken"];

    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::agent};
    context.approval = token;
    const afd::Json cleared = fixture.registry->execute("todo-clear", afd::Json::object(), context);
    CHECK(cleared["data"]["cleared"] == 1);
    const afd::Json again = fixture.registry->execute("todo-clear", afd::Json::object(), context);
    CHECK(again["error"]["code"] == "APPROVAL_REQUIRED");
    CHECK(again["error"]["details"]["reason"] == "already-used");
}

TEST_CASE("with APPROVALS=off an agent's clear runs, served without its approval policy") {
    Fixture fixture(Approvals::off);
    for (const auto& command : fixture.todo_commands()) {
        CAPTURE(command->definition.name);
        CHECK_FALSE(command->definition.approval.has_value());
    }
    const std::string id = fixture.create("Done already");
    fixture.run("todo-toggle", {{"id", id}});
    CHECK(fixture.run("todo-clear", afd::Json::object(),
                      afd::ActorKind::agent)["data"]["cleared"] == 1);
}
