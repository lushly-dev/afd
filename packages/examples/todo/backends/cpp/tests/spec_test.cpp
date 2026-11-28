// The commands against the shared contract, spec/commands.schema.json.
#include <algorithm>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "fixture.hpp"

using todo::testing::Fixture;
using todo::testing::spec;

namespace {

/// The spec's commands that C++ implements: those without implementedBy, or naming cpp.
std::vector<std::string> spec_command_names() {
    std::vector<std::string> names;
    for (const auto& [name, entry] : spec()["commands"].items()) {
        if (entry.contains("implementedBy")) {
            const auto& languages = entry["implementedBy"];
            if (std::find(languages.begin(), languages.end(), "cpp") == languages.end()) {
                continue;
            }
        }
        names.push_back(name);
    }
    return names;
}

/// `schema` with `$ref`s to the spec's definitions resolved, descriptions dropped and input
/// properties another language implements (x-implementedBy without cpp) left out: what the
/// contract asks C++ to validate.
afd::Json contract(afd::Json schema) {
    if (schema.is_object()) {
        if (schema.contains("$ref")) {
            const std::string ref = schema["$ref"].get<std::string>();
            const std::string prefix = "#/definitions/";
            REQUIRE(ref.rfind(prefix, 0) == 0);
            afd::Json resolved = spec()["definitions"][ref.substr(prefix.size())];
            schema.erase("$ref");
            for (auto& [key, value] : schema.items()) {
                resolved[key] = value;
            }
            return contract(std::move(resolved));
        }
        schema.erase("description");
        if (schema.contains("properties")) {
            auto& properties = schema["properties"];
            for (auto it = properties.begin(); it != properties.end();) {
                const auto& languages = it.value().value("x-implementedBy", afd::Json::array());
                const bool other =
                    !languages.empty() &&
                    std::find(languages.begin(), languages.end(), "cpp") == languages.end();
                it = other ? properties.erase(it) : std::next(it);
            }
        }
        for (auto& [key, value] : schema.items()) {
            if (key != "default" && key != "enum") {
                value = contract(value);
            }
        }
    } else if (schema.is_array()) {
        for (auto& item : schema) {
            item = contract(item);
        }
    }
    return schema;
}

} // namespace

TEST_CASE("the registered commands are exactly those in commands.schema.json") {
    Fixture fixture;
    std::vector<std::string> registered;
    for (const auto& command : fixture.todo_commands()) {
        registered.push_back(command->definition.name);
        CHECK(command->definition.expose.mcp);
    }
    std::vector<std::string> specified = spec_command_names();
    std::sort(registered.begin(), registered.end());
    std::sort(specified.begin(), specified.end());
    CHECK(registered == specified);
    CHECK(registered.size() == 13);
}

TEST_CASE("each command declares the metadata in commands.schema.json") {
    Fixture fixture;
    for (const auto& command : fixture.todo_commands()) {
        const auto& definition = command->definition;
        CAPTURE(definition.name);
        const auto& metadata = spec()["commands"][definition.name]["metadata"];
        CHECK(definition.mutation == metadata["mutation"].get<bool>());
        CHECK(definition.destructive == metadata["destructive"].get<bool>());
        auto contexts = definition.contexts;
        auto expected = metadata["contexts"].get<std::vector<std::string>>();
        std::sort(contexts.begin(), contexts.end());
        std::sort(expected.begin(), expected.end());
        CHECK(contexts == expected);
        std::optional<std::string> prompt;
        if (metadata.contains("confirmPrompt")) {
            prompt = metadata["confirmPrompt"].get<std::string>();
        }
        CHECK(definition.confirm_prompt == prompt);
    }
}

TEST_CASE("each command declares the idempotency the spec gives it, and every mutation one") {
    Fixture fixture;
    for (const auto& command : fixture.todo_commands()) {
        const auto& definition = command->definition;
        CAPTURE(definition.name);
        const auto& entry = spec()["commands"][definition.name];
        std::optional<std::string> declared;
        if (definition.idempotency) {
            declared = std::string(afd::idempotency_support_name(*definition.idempotency));
        }
        std::optional<std::string> expected;
        if (entry.contains("idempotency")) {
            expected = entry["idempotency"].get<std::string>();
        }
        CHECK(declared == expected);
        if (definition.mutation) {
            CHECK(declared.has_value());
        }
    }
}

TEST_CASE("each input schema is the contract's, descriptions aside") {
    Fixture fixture;
    for (const auto& command : fixture.todo_commands()) {
        const auto& definition = command->definition;
        CAPTURE(definition.name);
        const afd::Json expected = contract(spec()["commands"][definition.name]["input"]);
        afd::Json declared = contract(definition.input_schema);
        // The contract leaves `properties` out where a command takes nothing.
        if (!expected.contains("properties") && declared["properties"].empty()) {
            declared.erase("properties");
        }
        CHECK(declared.dump() == expected.dump());
    }
}

TEST_CASE("every command has a title, an output schema, examples and the version") {
    Fixture fixture;
    for (const auto& command : fixture.todo_commands()) {
        const auto& definition = command->definition;
        CAPTURE(definition.name);
        CHECK(definition.title.has_value());
        CHECK(definition.output_schema.has_value());
        CHECK_FALSE(definition.examples.empty());
        CHECK(definition.version == "1.0.0");
        CHECK(definition.category == "todo");
    }
}

TEST_CASE("every change declares an approval policy, and the undoable ones say so") {
    const std::set<std::string> undoable{
        "todo-create",       "todo-update",       "todo-toggle",       "todo-delete",
        "todo-create-batch", "todo-delete-batch", "todo-toggle-batch", "todo-restore"};
    Fixture fixture(todo::Approvals::agents);
    for (const auto& command : fixture.todo_commands()) {
        const auto& definition = command->definition;
        CAPTURE(definition.name);
        CHECK(definition.approval.has_value() == definition.mutation);
        CHECK(definition.undoable == undoable.contains(definition.name));
        const auto mode = afd::approval_mode(definition.approval);
        if (definition.name == "todo-clear") {
            CHECK(mode == afd::ApprovalMode::conditional);
        } else if (definition.mutation) {
            CHECK(mode == afd::ApprovalMode::not_required);
        }
    }
}

TEST_CASE("the two contexts are served, as src/contexts.ts defines them") {
    Fixture fixture;
    for (const char* name : {"afd-context-list", "afd-context-enter", "afd-context-exit"}) {
        const auto command = fixture.registry->get(name);
        REQUIRE(command);
        CHECK(command->definition.expose.mcp);
    }
    const auto listed = fixture.run("afd-context-list");
    CHECK(listed["data"]["contexts"].size() == 2);
    CHECK(listed["data"]["contexts"][0]["name"] == "todo-reading");
    CHECK(listed["data"]["contexts"][1]["name"] == "todo-editing");
}

TEST_CASE("todo-history's description states the history limit") {
    Fixture fixture;
    const auto history = fixture.registry->get("todo-history");
    REQUIRE(history);
    CHECK(history->definition.description.find(std::to_string(todo::history_limit)) !=
          std::string::npos);
}
