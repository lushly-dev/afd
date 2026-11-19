// Commands as MCP tools (afd/mcp.hpp; spec/command-metadata.md, "Reporting rules").
#include "afd/mcp.hpp"
#include "afd/schema.hpp"

#include <doctest.h>

using afd::Json;

namespace {

afd::CommandResult ok(const Json&, afd::CommandContext&) {
    return afd::success(nullptr);
}

afd::CommandDefinition full_command() {
    return afd::CommandDefinition{
        .name = "note-delete",
        .description = "Delete a note",
        .title = "Delete a note",
        .category = "notes",
        .input_schema = Json{{"type", "object"},
                             {"properties", {{"id", {{"type", "string"}}}}},
                             {"required", {"id"}}},
        .output_schema = Json{{"type", "object"}},
        .handler = ok,
        .version = "1.2.0",
        .tags = {"notes", "delete"},
        .prerequisites = {"note-list"},
        .contexts = {"notes"},
        .errors = {"NOT_FOUND"},
        .mutation = true,
        .destructive = true,
        .confirm_prompt = "Delete this note?",
        .undoable = true,
        .expose = {.mcp = true},
        .handoff = false,
        .handoff_protocol = std::nullopt,
        .examples = {{.title = "Delete one", .input = Json{{"id", "n-1"}}}},
        .execution_time = afd::ExecutionTime::long_running,
        .approval = afd::ApprovalDecision::required,
    };
}

} // namespace

TEST_CASE("command_to_mcp_tool reports what the command sets, and display text only as title") {
    const Json tool = afd::command_to_mcp_tool(full_command());
    CHECK(tool["name"] == "note-delete");
    CHECK(tool["title"] == "Delete a note");
    CHECK(tool["description"] == "Delete a note");
    CHECK(tool["inputSchema"]["required"] == Json::array({"id"}));
    CHECK(tool["annotations"] == Json{{"readOnlyHint", false}, {"destructiveHint", true}});
    CHECK(tool["_meta"] ==
          Json{{"category", "notes"},
               {"requires", {"note-list"}},
               {"mutation", true},
               {"destructive", true},
               {"undoable", true},
               {"approval", "required"},
               {"examples", {{{"title", "Delete one"}, {"input", {{"id", "n-1"}}}}}},
               {"outputSchema", {{"type", "object"}}},
               {"contexts", {"notes"}}});
    // confirmPrompt and title are display text, never _meta.
    CHECK_FALSE(tool["_meta"].contains("confirmPrompt"));
    CHECK_FALSE(tool["_meta"].contains("title"));
}

TEST_CASE("a bare command has no title, annotations or _meta") {
    const afd::CommandDefinition bare{
        .name = "note-list", .description = "List notes", .handler = ok};
    const Json tool = afd::command_to_mcp_tool(bare);
    CHECK(tool == Json{{"name", "note-list"},
                       {"description", "List notes"},
                       {"inputSchema", {{"type", "object"}}}});
    CHECK_FALSE(afd::command_tool_meta(bare));
    CHECK_FALSE(afd::command_tool_annotations(bare));
    // A function policy is reported as conditional.
    afd::CommandDefinition conditional = bare;
    conditional.approval = [](const Json&, const afd::CommandContext&) {
        return afd::ApprovalDecision::not_required;
    };
    CHECK((*afd::command_tool_meta(conditional))["approval"] == "conditional");
}

TEST_CASE("command_result_output_schema wraps data in the CommandResult envelope") {
    const Json envelope = afd::command_result_output_schema(
        Json{{"$schema", "https://json-schema.org/draft/2020-12/schema"},
             {"type", "object"},
             {"properties", {{"tag", {{"$ref", "#/$defs/Tag"}}}}},
             {"$defs", {{"Tag", {{"type", "string"}}}}}});
    CHECK(
        envelope ==
        Json{{"type", "object"},
             {"$defs", {{"Tag", {{"type", "string"}}}}},
             {"properties",
              {{"success", {{"type", "boolean"}}},
               {"data", {{"type", "object"}, {"properties", {{"tag", {{"$ref", "#/$defs/Tag"}}}}}}},
               {"error", {{"type", "object"}}},
               {"metadata", {{"type", "object"}}}}},
             {"required", {"success"}}});
    // Without $defs, data is the schema as given, less $schema.
    CHECK(afd::command_result_output_schema(Json{{"type", "string"}})["properties"]["data"] ==
          Json{{"type", "string"}});
    CHECK_FALSE(afd::command_result_output_schema(Json{{"type", "string"}}).contains("$defs"));
    // `definitions`, which CompiledSchema resolves as it does $defs, moves the same way.
    const Json legacy = afd::command_result_output_schema(
        Json{{"type", "object"},
             {"properties", {{"p", {{"$ref", "#/definitions/P"}}}}},
             {"definitions", {{"P", {{"type", "integer"}}}}}});
    CHECK(legacy["definitions"] == Json{{"P", {{"type", "integer"}}}});
    CHECK_FALSE(legacy["properties"]["data"].contains("definitions"));
    const auto compiled = afd::CompiledSchema::compile(legacy);
    REQUIRE(compiled);
    CHECK(compiled->validate(Json{{"success", true}, {"data", {{"p", 1}}}}));
    CHECK_FALSE(compiled->validate(Json{{"success", true}, {"data", {{"p", "one"}}}}));
}

TEST_CASE("command_result_output_schema keeps definitions with data when it has its own $id") {
    const Json data{{"$id", "https://example.com/item"},
                    {"type", "object"},
                    {"properties", {{"tag", {{"type", "string"}, {"$ref", "#/$defs/Tag"}}}}},
                    {"$defs", {{"Tag", {{"$ref", "#/definitions/Name"}}}}},
                    {"definitions", {{"Name", {{"minLength", 1}}}}}};
    const Json schema = afd::command_result_output_schema(data);
    CHECK(schema["properties"]["data"] == data);
    CHECK_FALSE(schema.contains("$defs"));
    CHECK_FALSE(schema.contains("definitions"));
    // CompiledSchema resolves local references from its input root. Here the $id makes
    // the emitted data schema the resource root for both references.
    const auto compiled = afd::CompiledSchema::compile(schema["properties"]["data"]);
    REQUIRE(compiled);
    CHECK(compiled->validate(Json{{"tag", "home"}}));
    CHECK_FALSE(compiled->validate(Json{{"tag", ""}}));
}

TEST_CASE("commands_to_mcp_tools keeps only commands exposed to MCP, in order") {
    afd::CommandDefinition hidden{.name = "note-hide", .description = "Hidden", .handler = ok};
    afd::CommandDefinition first = full_command();
    afd::CommandDefinition second{
        .name = "note-list", .description = "List notes", .handler = ok, .expose = {.mcp = true}};
    CHECK_FALSE(afd::is_mcp_exposed(hidden));
    const auto tools = afd::commands_to_mcp_tools({first, hidden, second});
    REQUIRE(tools.size() == 2);
    CHECK(tools[0]["name"] == "note-delete");
    CHECK(tools[1]["name"] == "note-list");
}

TEST_CASE("to_json describes a command as afd-detail does") {
    const Json detail = afd::to_json(full_command());
    CHECK(detail == Json{{"name", "note-delete"},
                         {"title", "Delete a note"},
                         {"description", "Delete a note"},
                         {"category", "notes"},
                         {"tags", {"notes", "delete"}},
                         {"mutation", true},
                         {"executionTime", "long-running"},
                         {"errors", {"NOT_FOUND"}},
                         {"inputSchema", full_command().input_schema},
                         {"outputSchema", {{"type", "object"}}},
                         {"destructive", true},
                         {"confirmPrompt", "Delete this note?"},
                         {"undoable", true},
                         {"approval", "required"},
                         {"version", "1.2.0"},
                         {"requires", {"note-list"}},
                         {"contexts", {"notes"}},
                         {"examples", {{{"title", "Delete one"}, {"input", {{"id", "n-1"}}}}}}});
    // mutation is always reported; unset fields and empty arrays never are.
    const Json bare =
        afd::to_json({.name = "note-list", .description = "List notes", .handler = ok});
    CHECK(bare == Json{{"name", "note-list"},
                       {"description", "List notes"},
                       {"mutation", false},
                       {"inputSchema", {{"type", "object"}}}});
}
