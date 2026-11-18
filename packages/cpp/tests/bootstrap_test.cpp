// The bootstrap commands (afd/bootstrap.hpp), in process. The expected TypeScript types are those
// of packages/server/src/bootstrap/json-schema-to-ts.test.ts.
#include "afd/afd.hpp"

#include <memory>
#include <string>
#include <vector>

#include <doctest.h>

using afd::Json;

namespace {

afd::CommandHandler echo() {
    return [](const Json& input, afd::CommandContext&) { return afd::success(input); };
}

std::unique_ptr<afd::CommandRegistry> described() {
    auto registry = std::make_unique<afd::CommandRegistry>();
    REQUIRE_FALSE(registry->register_command(
        {.name = "todo-create",
         .description = "Create a todo. Titles are trimmed.",
         .title = "Create a todo",
         .category = "todos",
         .input_schema = {{"type", "object"},
                          {"properties",
                           {{"title", {{"type", "string"}, {"description", "Todo title"}}},
                            {"priority", {{"type", "string"}}}}},
                          {"required", Json::array({"title"})}},
         .handler = echo(),
         .tags = {"crud", "write"},
         .prerequisites = {"todo-list"},
         .mutation = true,
         .confirm_prompt = "Create it?",
         .undoable = true,
         .expose = {.mcp = true},
         .examples = {{.title = "One", .input = {{"title", "Milk"}}}},
         .approval = afd::ApprovalDecision::required}));
    REQUIRE_FALSE(registry->register_command({.name = "todo-list",
                                              .description = "List todos",
                                              .category = "todos",
                                              .handler = echo(),
                                              .tags = {"read"},
                                              .contexts = {"reading"},
                                              .expose = {.mcp = true}}));
    REQUIRE_FALSE(
        registry->register_command({.name = "user-get",
                                    .description = "Get a user",
                                    .category = "users",
                                    .input_schema = {{"type", "object"},
                                                     {"properties", {{"id", {{"type", "number"}}}}},
                                                     {"required", Json::array({"id"})}},
                                    .handler = echo(),
                                    .contexts = {"admin"},
                                    .expose = {.mcp = true}}));
    // Not exposed to MCP: never described.
    REQUIRE_FALSE(registry->register_command(
        {.name = "store-reset", .description = "Reset the store", .handler = echo()}));
    REQUIRE_FALSE(afd::register_bootstrap_commands(*registry));
    return registry;
}

Json run(const afd::CommandRegistry& registry, std::string_view name, Json input = Json::object(),
         std::optional<std::string> active = std::nullopt) {
    afd::CommandContext context;
    context.active_context = std::move(active);
    return Json(registry.execute(name, input, std::move(context)));
}

std::vector<std::string> names(const Json& commands) {
    std::vector<std::string> out;
    for (const auto& command : commands) {
        out.push_back(command["name"].get<std::string>());
    }
    return out;
}

/// The type `generate_input_types` writes for one schema.
std::string type_of(const Json& schema) {
    const std::string source = afd::generate_input_types(
        Json::array({Json{{"name", "x-y"}, {"description", "d"}, {"inputSchema", schema}}}));
    const std::string head = "/** Input of `x-y`: d */\nexport type XYInput = ";
    REQUIRE(source.rfind(head, 0) == 0);
    REQUIRE(source.size() >= head.size() + 2);
    return source.substr(head.size(), source.size() - head.size() - 2);
}

} // namespace

TEST_CASE("the bootstrap commands are MCP-exposed, read-only and refuse to register twice") {
    afd::CommandRegistry registry;
    REQUIRE_FALSE(afd::register_bootstrap_commands(registry));
    for (const auto name : afd::afd_bootstrap_command_names) {
        const auto command = registry.get(name);
        REQUIRE(command);
        CHECK(command->definition.category == "bootstrap");
        CHECK(command->definition.tags == std::vector<std::string>{"bootstrap", "read", "safe"});
        CHECK(command->definition.version == "1.0.0");
        CHECK(command->definition.expose.mcp);
        CHECK_FALSE(command->definition.mutation);
    }
    CHECK(afd::register_bootstrap_commands(registry) == "Command 'afd-help' is already registered");

    afd::CommandRegistry taken;
    REQUIRE_FALSE(
        taken.register_command({.name = "afd-docs", .description = "Mine", .handler = echo()}));
    CHECK(afd::register_bootstrap_commands(taken) == "Command 'afd-docs' is already registered");
    CHECK_FALSE(taken.has("afd-help"));
}

TEST_CASE("afd-help lists the MCP-exposed commands, itself among them, briefly by default") {
    const auto registry = described();
    const Json help = run(*registry, "afd-help");
    CHECK(help["success"] == true);
    CHECK(help["confidence"] == 1.0);
    CHECK(help["reasoning"] == "Listing all 6 available commands");
    const Json& data = help["data"];
    CHECK(data["contractVersion"] == std::string(afd::contract_version));
    CHECK(names(data["commands"]) == std::vector<std::string>{"todo-create", "todo-list",
                                                              "user-get", "afd-help", "afd-docs",
                                                              "afd-schema"});
    CHECK(data["total"] == 6);
    CHECK(data["filtered"] == false);
    CHECK_FALSE(data.contains("toolStrategy"));
    CHECK_FALSE(data.contains("contextFields"));
    // Brief: the name, the description and `requires`.
    CHECK(data["commands"][0] == Json{{"name", "todo-create"},
                                      {"description", "Create a todo. Titles are trimmed."},
                                      {"requires", Json::array({"todo-list"})}});
    CHECK(names(data["groupedByCategory"]["todos"]) ==
          std::vector<std::string>{"todo-create", "todo-list"});
    CHECK(names(data["groupedByCategory"]["bootstrap"]).size() == 3);
}

TEST_CASE("afd-help filters by tag, category or name, and reports everything in full") {
    const auto registry = described();
    const Json write = run(*registry, "afd-help", {{"filter", "WRITE"}});
    CHECK(names(write["data"]["commands"]) == std::vector<std::string>{"todo-create"});
    CHECK(write["data"]["filtered"] == true);
    CHECK(write["reasoning"] == "Found 1 commands matching \"WRITE\"");
    CHECK(names(run(*registry, "afd-help", {{"filter", "users"}})["data"]["commands"]) ==
          std::vector<std::string>{"user-get"});
    CHECK(names(run(*registry, "afd-help", {{"filter", "afd-"}})["data"]["commands"]).size() == 3);

    const Json full = run(*registry, "afd-help", {{"format", "full"}});
    CHECK(
        full["data"]["commands"][0] ==
        Json{{"name", "todo-create"},
             {"title", "Create a todo"},
             {"description", "Create a todo. Titles are trimmed."},
             {"category", "todos"},
             {"tags", Json::array({"crud", "write"})},
             {"mutation", true},
             {"undoable", true},
             {"requires", Json::array({"todo-list"})},
             {"examples", Json::array({Json{{"title", "One"}, {"input", {{"title", "Milk"}}}}})}});
    CHECK(full["data"]["commands"][1]["mutation"] == false);
    CHECK_FALSE(full["data"]["commands"][1].contains("destructive"));

    CHECK(run(*registry, "afd-help", {{"format", "verbose"}})["error"]["code"] ==
          "VALIDATION_ERROR");
}

TEST_CASE("the bootstrap commands describe only the commands of the active context") {
    const auto registry = described();
    const Json reading = run(*registry, "afd-help", Json::object(), "reading");
    CHECK(names(reading["data"]["commands"]) == std::vector<std::string>{"todo-create", "todo-list",
                                                                         "afd-help", "afd-docs",
                                                                         "afd-schema"});
    // The MCP server's scope wins over `active_context`.
    afd::CommandContext context;
    context.active_context = "reading";
    context.context_scope =
        std::make_shared<const afd::ContextScope>(afd::ContextScope{.request = "admin"});
    const Json admin(registry->execute("afd-schema", Json::object(), std::move(context)));
    CHECK(names(admin["data"]["schemas"]) == std::vector<std::string>{"todo-create", "user-get",
                                                                      "afd-help", "afd-docs",
                                                                      "afd-schema"});
    CHECK(run(*registry, "afd-docs", {{"command", "todo-list"}}, "admin")["data"]["commandCount"] ==
          0);
}

TEST_CASE("afd-help lists the declared context fields") {
    auto created = afd::CommandRegistry::create({.context_fields = {{.name = "tenant",
                                                                     .meta = "dev.example/tenant",
                                                                     .schema = {{"type", "string"}},
                                                                     .required = true}}});
    REQUIRE(created);
    auto& registry = **created;
    REQUIRE_FALSE(afd::register_bootstrap_commands(registry));
    const Json help = run(registry, "afd-help");
    CHECK(help["data"]["contextFields"] == Json::array({Json{{"name", "tenant"},
                                                             {"meta", "dev.example/tenant"},
                                                             {"schema", {{"type", "string"}}},
                                                             {"required", true},
                                                             {"journal", false}}}));
}

TEST_CASE("afd-docs writes markdown by category, then by name") {
    const auto registry = described();
    const Json docs = run(*registry, "afd-docs");
    CHECK(docs["data"]["commandCount"] == 6);
    CHECK(docs["reasoning"] == "Generated documentation for 6 commands");
    const auto markdown = docs["data"]["markdown"].get<std::string>();
    CHECK(markdown.rfind("# Command Documentation\n\n## bootstrap\n\n### `afd-docs`", 0) == 0);
    CHECK(markdown.find("## bootstrap") < markdown.find("## todos"));
    CHECK(markdown.find("## todos") < markdown.find("## users"));
    CHECK(markdown.find("store-reset") == std::string::npos);

    const Json one = run(*registry, "afd-docs", {{"command", "todo-create"}});
    CHECK(one["reasoning"] == "Generated documentation for \"todo-create\"");
    CHECK(one["data"]["markdown"] == "# Command Documentation\n"
                                     "\n"
                                     "## todos\n"
                                     "\n"
                                     "### `todo-create`\n"
                                     "\n"
                                     "Create a todo. Titles are trimmed.\n"
                                     "\n"
                                     "**Tags:** `crud`, `write`\n"
                                     "\n"
                                     "**Mutation:** Yes\n"
                                     "\n"
                                     "**Confirmation prompt:** Create it?\n"
                                     "\n"
                                     "**Undoable:** Yes\n"
                                     "\n"
                                     "**Approval:** required\n"
                                     "\n"
                                     "**Parameters:**\n"
                                     "\n"
                                     "| Name | Type | Required | Description |\n"
                                     "|------|------|----------|-------------|\n"
                                     "| priority | string | No | Parameter: priority |\n"
                                     "| title | string | Yes | Todo title |\n"
                                     "\n"
                                     "---\n");
    CHECK(run(*registry, "afd-docs", {{"command", "user-get"}})["data"]["markdown"]
              .get<std::string>()
              .find("**Mutation:** No (read-only)") != std::string::npos);

    for (const auto* missing : {"todo-nothing", "store-reset"}) {
        const Json none = run(*registry, "afd-docs", {{"command", missing}});
        CHECK(none["success"] == true);
        CHECK(none["data"] == Json{{"markdown", ""}, {"commandCount", 0}});
        CHECK(none["reasoning"] == "Command \"" + std::string(missing) + "\" not found");
    }
}

TEST_CASE("afd-schema exports input schemas, and TypeScript types on request") {
    const auto registry = described();
    const Json json = run(*registry, "afd-schema");
    CHECK(json["data"]["format"] == "json");
    CHECK(json["data"]["count"] == 6);
    CHECK_FALSE(json["data"].contains("typescript"));
    CHECK(json["reasoning"] == "Exported JSON schemas for 6 commands");
    CHECK(json["data"]["schemas"][2] == Json{{"name", "user-get"},
                                             {"description", "Get a user"},
                                             {"inputSchema",
                                              {{"type", "object"},
                                               {"properties", {{"id", {{"type", "number"}}}}},
                                               {"required", Json::array({"id"})}}}});

    const Json typed = run(*registry, "afd-schema", {{"format", "typescript"}});
    CHECK(typed["data"]["format"] == "typescript");
    CHECK(typed["reasoning"] == "Exported 6 schemas with TypeScript input types");
    const auto source = typed["data"]["typescript"].get<std::string>();
    CHECK(source.find("export type TodoCreateInput = {") != std::string::npos);
    CHECK(source.find("\t/** Todo title */\n\ttitle: string;") != std::string::npos);
    CHECK(source.find("\tpriority?: string;") != std::string::npos);
    CHECK(source.find("export type TodoListInput = Record<string, never>;") != std::string::npos);
    CHECK(source.find("\tid: number;") != std::string::npos);
}

TEST_CASE("generate_input_types maps primitive types, integer and null") {
    CHECK(type_of({{"type", "string"}}) == "string");
    CHECK(type_of({{"type", "number"}}) == "number");
    CHECK(type_of({{"type", "integer"}}) == "number");
    CHECK(type_of({{"type", "boolean"}}) == "boolean");
    CHECK(type_of({{"type", "null"}}) == "null");
    CHECK(type_of({{"type", Json::array({"string", "null"})}}) == "string | null");
}

TEST_CASE("generate_input_types maps enum, const, unions and intersections") {
    CHECK(type_of({{"type", "string"}, {"enum", Json::array({"a", "b"})}}) == "\"a\" | \"b\"");
    CHECK(type_of({{"const", 3}}) == "3");
    CHECK(type_of({{"anyOf", Json::array({{{"type", "string"}}, {{"type", "number"}}})}}) ==
          "string | number");
    CHECK(type_of({{"oneOf", Json::array({{{"const", "x"}}, {{"const", "x"}}})}}) == "\"x\"");
    CHECK(type_of(
              {{"allOf", Json::array({{{"type", "object"},
                                       {"properties", {{"a", {{"type", "string"}}}}},
                                       {"required", Json::array({"a"})}},
                                      {{"type", "object"},
                                       {"properties",
                                        {{"b",
                                          {{"anyOf", Json::array({{{"type", "string"}},
                                                                  {{"type", "null"}}})}}}}}}})}}) ==
          "{\n\ta: string;\n} & {\n\tb?: string | null;\n}");
    CHECK(type_of({{"type", "array"},
                   {"items",
                    {{"anyOf", Json::array({{{"type", "string"}}, {{"type", "number"}}})}}}}) ==
          "Array<string | number>");
    CHECK(type_of({{"anyOf", Json::array({{{"type", "array"}, {"items", {{"type", "string"}}}},
                                          {{"enum", Json::array({"a", "b"})}}})}}) ==
          "Array<string> | (\"a\" | \"b\")");
    CHECK(type_of({{"anyOf", Json::array({{{"const", "a|\"b&"}}, {{"type", "number"}}})}}) ==
          "\"a|\\\"b&\" | number");
}

TEST_CASE("generate_input_types maps arrays and objects, quoting keys and documenting properties") {
    CHECK(type_of({{"type", "array"}}) == "unknown[]");
    CHECK(
        type_of({{"type", "object"},
                 {"properties",
                  {{"first-name", {{"type", "string"}, {"description", "Given */ name\nline two"}}},
                   {"tags", {{"type", "array"}, {"items", {{"type", "string"}}}}}}},
                 {"required", Json::array({"first-name"})},
                 {"additionalProperties", {{"type", "number"}}}}) ==
        "{\n\t/** Given *\\/ name line two */\n\t\"first-name\": string;\n\ttags?: "
        "Array<string>;\n\t[key: string]: number;\n}");
    CHECK(type_of({{"type", "object"}, {"additionalProperties", true}}) ==
          "{\n\t[key: string]: unknown;\n}");
    CHECK(type_of({{"type", "object"}, {"properties", Json::object()}}) == "Record<string, never>");
    CHECK(type_of({{"properties", {{"a", {{"type", "string"}}}}}}) == "{\n\ta?: string;\n}");
}

TEST_CASE("generate_input_types falls back to unknown for refs, unknown types and deep nesting") {
    CHECK(type_of({{"$ref", "#/definitions/Node"}}) == "unknown");
    CHECK(type_of(Json::object()) == "unknown");
    CHECK(type_of("string") == "unknown");
    Json deep{{"type", "string"}};
    for (int i = 0; i < 40; ++i) {
        deep = Json{{"type", "array"}, {"items", deep}};
    }
    CHECK(type_of(deep).find("unknown") != std::string::npos);
}

TEST_CASE("generate_input_types names types after commands and avoids collisions") {
    const std::string source = afd::generate_input_types(Json::array(
        {Json{{"name", "todo-create"},
              {"description", "Create"},
              {"inputSchema", {{"type", "object"}}}},
         Json{{"name", "todo_create"},
              {"description", "Create too"},
              {"inputSchema", {{"type", "object"}}}},
         Json{{"name", "3d-render"}, {"description", "Render"}, {"inputSchema", Json::object()}},
         Json{{"name", "--"}, {"description", "None"}, {"inputSchema", Json::object()}}}));
    CHECK(source == "/** Input of `todo-create`: Create */\n"
                    "export type TodoCreateInput = Record<string, never>;\n\n"
                    "/** Input of `todo_create`: Create too */\n"
                    "export type TodoCreateInput2 = Record<string, never>;\n\n"
                    "/** Input of `3d-render`: Render */\n"
                    "export type _3dRenderInput = unknown;\n\n"
                    "/** Input of `--`: None */\n"
                    "export type CommandInput = unknown;\n");

    // TypeScript lists properties in declaration order; afd::Json keeps keys sorted.
    const Json schema{
        {"type", "object"},
        {"properties",
         {{"title", {{"type", "string"}, {"description", "Title"}}},
          {"priority",
           {{"type", "string"}, {"enum", Json::array({"low", "high"})}, {"default", "low"}}},
          {"limit", {{"type", "integer"}}}}},
        {"required", Json::array({"title"})}};
    CHECK(afd::generate_input_types(Json::array(
              {Json{{"name", "todo-list"}, {"description", "List"}, {"inputSchema", schema}}})) ==
          "/** Input of `todo-list`: List */\nexport type TodoListInput = {\n\tlimit?: "
          "number;\n\tpriority?: \"low\" | \"high\";\n\t/** Title */\n\ttitle: string;\n};\n");
}

TEST_CASE("generate_input_types stops at a depth of 32, as TypeScript does") {
    const auto nested = [](int levels, const std::string& inner) {
        Json schema{{"type", "string"}};
        std::string expected = inner;
        for (int i = 0; i < levels; ++i) {
            schema = Json{{"type", "array"}, {"items", schema}};
            expected = "Array<" + expected + ">";
        }
        return std::pair{schema, expected};
    };
    const auto [at_limit, at_limit_type] = nested(32, "string");
    CHECK(type_of(at_limit) == at_limit_type);
    const auto [beyond, beyond_type] = nested(33, "unknown");
    CHECK(type_of(beyond) == beyond_type);
}

TEST_CASE("generate_input_types writes descriptions and literals as TypeScript does") {
    const auto described_as = [](const std::string& description) {
        return type_of(
            {{"type", "object"},
             {"properties", {{"a", {{"type", "string"}, {"description", description}}}}}});
    };
    CHECK(described_as("a  b") == "{\n\t/** a  b */\n\ta?: string;\n}");
    CHECK(described_as("a \r\n  b") == "{\n\t/** a b */\n\ta?: string;\n}");
    CHECK(described_as("a **/ b") == "{\n\t/** a **\\/ b */\n\ta?: string;\n}");
    // JSON.stringify writes a whole number without a fraction.
    CHECK(type_of({{"const", 1.0}}) == "1");
    CHECK(type_of({{"enum", Json::array({1.0, 2.5, Json::array({3.0})})}}) == "1 | 2.5 | [3]");
    // Members that are not schemas leave an empty union, as in TypeScript.
    CHECK(type_of({{"anyOf", Json::array({1, 2})}}).empty());
}

TEST_CASE("an empty active context is no context, as the registry reads it") {
    const auto registry = described();
    CHECK(run(*registry, "afd-help", Json::object(), "")["data"]["total"] == 6);
}
