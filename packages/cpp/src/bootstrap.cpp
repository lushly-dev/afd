// The bootstrap commands (bootstrap.hpp): TypeScript's afd-help.ts, afd-docs.ts, afd-schema.ts
// and json-schema-to-ts.ts (packages/server/src/bootstrap), in the same words.
#include "afd/bootstrap.hpp"

#include "afd/builtin_names.hpp"
#include "afd/contexts.hpp"
#include "afd/registry.hpp"
#include "afd/result.hpp"
#include "afd/version.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/json_io.hpp"
#include "detail/output_budget.hpp"

namespace afd {
namespace {

const std::vector<std::string>& bootstrap_tags() {
    static const std::vector<std::string> tags{"bootstrap", "read", "safe"};
    return tags;
}

CommandDefinition bootstrap_command(std::string name, std::string description, Json input_schema,
                                    CommandHandler handler) {
    CommandDefinition command;
    command.name = std::move(name);
    command.description = std::move(description);
    command.category = bootstrap_category;
    command.input_schema = std::move(input_schema);
    command.handler = std::move(handler);
    command.version = "1.0.0";
    command.tags = bootstrap_tags();
    command.expose.mcp = true;
    return command;
}

/// The commands a call may have described: those exposed to MCP and available in its active
/// context (the scope's, when the MCP server set one).
std::vector<std::shared_ptr<const RegisteredCommand>> describable(const CommandRegistry& registry,
                                                                  const CommandContext& context) {
    std::optional<std::string> active =
        context.context_scope ? context.context_scope->active() : context.active_context;
    // An empty name is no context, as the registry's own check reads it.
    if (active && active->empty()) {
        active.reset();
    }
    std::vector<std::shared_ptr<const RegisteredCommand>> commands;
    for (auto& command : registry.list_by_exposure(Interface::mcp)) {
        const auto& contexts = command->definition.contexts;
        if (!active || contexts.empty() ||
            std::find(contexts.begin(), contexts.end(), *active) != contexts.end()) {
            commands.push_back(std::move(command));
        }
    }
    return commands;
}

std::string lower(std::string_view text) {
    std::string out(text);
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

bool contains(std::string_view text, std::string_view part) {
    return text.find(part) != std::string_view::npos;
}

std::string string_or_empty(const Json& object, std::string_view key) {
    const auto found = object.find(std::string(key));
    return found != object.end() && found->is_string() ? found->get<std::string>() : std::string();
}

CommandResult described(Json data, std::string reasoning) {
    return success(std::move(data), {.confidence = 1.0, .reasoning = std::move(reasoning)});
}

// --- afd-help ---------------------------------------------------------------------------------

Json help_entry(const CommandDefinition& command, bool full) {
    Json info{{"name", command.name}, {"description", command.description}};
    if (!command.prerequisites.empty()) {
        info["requires"] = command.prerequisites;
    }
    if (full) {
        if (command.title) {
            info["title"] = *command.title;
        }
        if (command.category) {
            info["category"] = *command.category;
        }
        if (!command.tags.empty()) {
            info["tags"] = command.tags;
        }
        info["mutation"] = command.mutation;
        if (command.idempotency) {
            info["idempotency"] = std::string(idempotency_support_name(*command.idempotency));
        }
        if (command.destructive) {
            info["destructive"] = true;
        }
        if (command.undoable) {
            info["undoable"] = true;
        }
        if (!command.examples.empty()) {
            info["examples"] = detail::examples_json(command.examples);
        }
        if (command.output_budget && !detail::omits_output_budget_surface(command.name)) {
            info["outputBudget"] = *command.output_budget;
        }
    }
    return info;
}

CommandResult afd_help(const CommandRegistry& registry, const Json& input,
                       const CommandContext& context) {
    const std::string filter = string_or_empty(input, "filter");
    const bool filtered = !filter.empty();
    const bool full = string_or_empty(input, "format") == "full";
    const std::string needle = lower(filter);

    Json commands = Json::array();
    Json grouped = Json::object();
    for (const auto& command : describable(registry, context)) {
        const auto& definition = command->definition;
        if (filtered) {
            const bool tag_match =
                std::any_of(definition.tags.begin(), definition.tags.end(),
                            [&](const std::string& tag) { return contains(lower(tag), needle); });
            const bool category_match =
                definition.category && contains(lower(*definition.category), needle);
            if (!tag_match && !category_match && !contains(lower(definition.name), needle)) {
                continue;
            }
        }
        Json info = help_entry(definition, full);
        if (context.first_class_tools &&
            std::find(context.first_class_tools->begin(), context.first_class_tools->end(),
                      definition.name) != context.first_class_tools->end()) {
            info["firstClass"] = true;
        }
        const std::string category = definition.category && !definition.category->empty()
                                         ? *definition.category
                                         : "uncategorized";
        grouped[category].push_back(info);
        commands.push_back(std::move(info));
    }

    const std::size_t total = commands.size();
    Json output{{"contractVersion", std::string(contract_version)},
                {"commands", std::move(commands)},
                {"total", total},
                {"filtered", filtered},
                {"groupedByCategory", std::move(grouped)}};
    if (context.tool_strategy) {
        output["toolStrategy"] = *context.tool_strategy;
    }
    if (context.first_class_tools) {
        output["firstClassTools"] = *context.first_class_tools;
    }
    if (!registry.context_fields().empty()) {
        Json fields = Json::array();
        for (const auto& field : registry.context_fields()) {
            fields.push_back(Json{{"name", field.name},
                                  {"meta", field.meta},
                                  {"schema", field.schema},
                                  {"required", field.required},
                                  {"journal", field.journal}});
        }
        output["contextFields"] = std::move(fields);
    }
    std::string reasoning =
        filtered ? "Found " + std::to_string(total) + " commands matching \"" + filter + "\""
                 : "Listing all " + std::to_string(total) + " available commands";
    return described(std::move(output), std::move(reasoning));
}

// --- afd-docs ---------------------------------------------------------------------------------

/// TypeScript's `jsonSchemaToParameters`, as the docs table reads it.
struct Parameter {
    std::string name;
    std::string type;
    std::string description;
    bool required = false;
};

std::vector<Parameter> parameters_of(const Json& schema) {
    std::vector<Parameter> parameters;
    if (!schema.is_object() || string_or_empty(schema, "type") != "object" ||
        !schema.contains("properties") || !schema["properties"].is_object()) {
        return parameters;
    }
    std::set<std::string> required;
    if (const auto list = schema.find("required"); list != schema.end() && list->is_array()) {
        for (const auto& name : *list) {
            if (name.is_string()) {
                required.insert(name.get<std::string>());
            }
        }
    }
    for (const auto& [name, property] : schema["properties"].items()) {
        Parameter parameter{.name = name, .type = "string", .description = "Parameter: " + name};
        if (property.is_object()) {
            if (const auto type = property.find("type"); type != property.end()) {
                if (type->is_string()) {
                    parameter.type = type->get<std::string>();
                } else if (type->is_array()) {
                    // A template literal joins an array with commas.
                    std::string joined;
                    for (std::size_t i = 0; i < type->size(); ++i) {
                        const auto& item = (*type)[i];
                        joined += (i > 0 ? "," : "") + (item.is_string() ? item.get<std::string>()
                                                                         : wire::serialize(item));
                    }
                    parameter.type = joined;
                }
            }
            if (const auto description = property.find("description");
                description != property.end() && description->is_string()) {
                parameter.description = description->get<std::string>();
            }
        }
        parameter.required = required.count(name) > 0;
        parameters.push_back(std::move(parameter));
    }
    return parameters;
}

void document(std::vector<std::string>& lines, const CommandDefinition& command) {
    lines.push_back("### `" + command.name + "`");
    lines.emplace_back();
    lines.push_back(command.description);
    lines.emplace_back();
    if (!command.tags.empty()) {
        std::string tags;
        for (const auto& tag : command.tags) {
            tags += (tags.empty() ? "`" : ", `") + tag + "`";
        }
        lines.push_back("**Tags:** " + tags);
        lines.emplace_back();
    }
    lines.push_back(std::string("**Mutation:** ") + (command.mutation ? "Yes" : "No (read-only)"));
    lines.emplace_back();
    if (command.destructive) {
        lines.emplace_back("**Destructive:** Yes");
        lines.emplace_back();
    }
    if (command.confirm_prompt && !command.confirm_prompt->empty()) {
        lines.push_back("**Confirmation prompt:** " + *command.confirm_prompt);
        lines.emplace_back();
    }
    if (command.undoable) {
        lines.emplace_back("**Undoable:** Yes");
        lines.emplace_back();
    }
    if (const auto mode = approval_mode(command.approval)) {
        lines.push_back("**Approval:** " + std::string(approval_mode_name(*mode)));
        lines.emplace_back();
    }
    const auto parameters = parameters_of(
        command.advertised_input_schema ? *command.advertised_input_schema : command.input_schema);
    if (!parameters.empty()) {
        lines.emplace_back("**Parameters:**");
        lines.emplace_back();
        lines.emplace_back("| Name | Type | Required | Description |");
        lines.emplace_back("|------|------|----------|-------------|");
        for (const auto& parameter : parameters) {
            lines.push_back("| " + parameter.name + " | " + parameter.type + " | " +
                            (parameter.required ? "Yes" : "No") + " | " + parameter.description +
                            " |");
        }
        lines.emplace_back();
    }
    lines.emplace_back("---");
    lines.emplace_back();
}

CommandResult afd_docs(const CommandRegistry& registry, const Json& input,
                       const CommandContext& context) {
    const bool one = input.contains("command") && input["command"].is_string();
    const std::string name = one ? input["command"].get<std::string>() : std::string();

    std::vector<const CommandDefinition*> commands;
    const auto all = describable(registry, context);
    for (const auto& command : all) {
        if (!one || command->definition.name == name) {
            commands.push_back(&command->definition);
        }
    }
    if (one && commands.empty()) {
        return described(Json{{"markdown", ""}, {"commandCount", 0}},
                         "Command \"" + name + "\" not found");
    }

    std::map<std::string, std::vector<const CommandDefinition*>> by_category;
    for (const auto* command : commands) {
        const std::string category =
            command->category && !command->category->empty() ? *command->category : "General";
        by_category[category].push_back(command);
    }
    std::vector<std::string> lines{"# Command Documentation", ""};
    for (auto& [category, members] : by_category) {
        lines.push_back("## " + category);
        lines.emplace_back();
        std::stable_sort(members.begin(), members.end(),
                         [](const auto* a, const auto* b) { return a->name < b->name; });
        for (const auto* command : members) {
            document(lines, *command);
        }
    }
    std::string markdown;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        markdown += (i > 0 ? "\n" : "") + lines[i];
    }
    const std::size_t count = commands.size();
    std::string reasoning =
        one ? "Generated documentation for \"" + name + "\""
            : "Generated documentation for " + std::to_string(count) + " commands";
    return described(Json{{"markdown", std::move(markdown)}, {"commandCount", count}},
                     std::move(reasoning));
}

// --- afd-schema -------------------------------------------------------------------------------

CommandResult afd_schema(const CommandRegistry& registry, const Json& input,
                         const CommandContext& context) {
    Json schemas = Json::array();
    for (const auto& command : describable(registry, context)) {
        schemas.push_back(Json{{"name", command->definition.name},
                               {"description", command->definition.description},
                               {"inputSchema", command->definition.advertised_input_schema
                                                   ? *command->definition.advertised_input_schema
                                                   : command->definition.input_schema}});
    }
    const std::size_t count = schemas.size();
    if (string_or_empty(input, "format") == "typescript") {
        std::string typescript = generate_input_types(schemas);
        return described(Json{{"schemas", std::move(schemas)},
                              {"count", count},
                              {"format", "typescript"},
                              {"typescript", std::move(typescript)}},
                         "Exported " + std::to_string(count) +
                             " schemas with TypeScript input types");
    }
    return described(Json{{"schemas", std::move(schemas)}, {"count", count}, {"format", "json"}},
                     "Exported JSON schemas for " + std::to_string(count) + " commands");
}

// --- JSON Schema to TypeScript (json-schema-to-ts.ts) -----------------------------------------

constexpr int max_type_depth = 32;

/// `value` with every whole number written as an integer, as `JSON.stringify` writes `1.0`.
Json js_numbers(const Json& value) {
    if (value.is_number_float()) {
        return wire::number(value.get<double>());
    }
    if (value.is_array() || value.is_object()) {
        Json out = value;
        for (auto& item : out) {
            item = js_numbers(item);
        }
        return out;
    }
    return value;
}

/// A JSON literal as TypeScript writes it.
std::string literal(const Json& value) {
    return wire::serialize(js_numbers(value));
}

bool is_identifier(std::string_view key) {
    const auto start = [](unsigned char c) { return std::isalpha(c) || c == '_' || c == '$'; };
    if (key.empty() || !start(static_cast<unsigned char>(key.front()))) {
        return false;
    }
    return std::all_of(key.begin() + 1, key.end(), [&](char c) {
        return start(static_cast<unsigned char>(c)) || std::isdigit(static_cast<unsigned char>(c));
    });
}

bool is_space(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

/// A JSDoc line, or nothing for a missing or empty description. `*/` is escaped, and each run of
/// whitespace holding a line break becomes one space.
std::string comment(const Json& description, std::string_view indent) {
    if (!description.is_string() || description.get_ref<const std::string&>().empty()) {
        return {};
    }
    const auto& text = description.get_ref<const std::string&>();
    std::string escaped;
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '*' && i + 1 < text.size() && text[i + 1] == '/') {
            escaped += "*\\/";
            ++i;
        } else {
            escaped.push_back(text[i]);
        }
    }
    std::string flat;
    for (std::size_t i = 0; i < escaped.size();) {
        if (!is_space(escaped[i])) {
            flat.push_back(escaped[i++]);
            continue;
        }
        const std::size_t start = i;
        bool line_break = false;
        while (i < escaped.size() && is_space(escaped[i])) {
            line_break = line_break || escaped[i] == '\n';
            ++i;
        }
        flat += line_break ? std::string(" ") : escaped.substr(start, i - start);
    }
    return std::string(indent) + "/** " + flat + " */\n";
}

/// Whether a type expression has a `|` or `&` outside brackets and string literals.
bool has_top_level_operator(std::string_view type) {
    int depth = 0;
    bool in_string = false;
    for (std::size_t i = 0; i < type.size(); ++i) {
        const char c = type[i];
        if (in_string) {
            if (c == '\\') {
                ++i;
            } else if (c == '"') {
                in_string = false;
            }
        } else if (c == '"') {
            in_string = true;
        } else if (c == '{' || c == '(' || c == '<' || c == '[') {
            ++depth;
        } else if (c == '}' || c == ')' || c == '>' || c == ']') {
            --depth;
        } else if (depth == 0 && (c == '|' || c == '&')) {
            return true;
        }
    }
    return false;
}

std::string join_types(const std::vector<std::string>& members, std::string_view separator) {
    std::vector<std::string> unique;
    for (const auto& member : members) {
        if (std::find(unique.begin(), unique.end(), member) == unique.end()) {
            unique.push_back(member);
        }
    }
    if (unique.size() == 1) {
        return unique.front();
    }
    std::string out;
    for (std::size_t i = 0; i < unique.size(); ++i) {
        out += (i > 0 ? std::string(separator) : std::string()) +
               (has_top_level_operator(unique[i]) ? "(" + unique[i] + ")" : unique[i]);
    }
    return out;
}

/// The object members of a nonempty array, or `std::nullopt` when it is not one.
std::optional<std::vector<Json>> schema_list(const Json& schema, std::string_view key) {
    const auto found = schema.find(std::string(key));
    if (found == schema.end() || !found->is_array() || found->empty()) {
        return std::nullopt;
    }
    std::vector<Json> members;
    for (const auto& member : *found) {
        if (member.is_object()) {
            members.push_back(member);
        }
    }
    return members;
}

std::string to_type(const Json& schema, const std::string& indent, int depth);

std::string object_type(const Json& schema, const std::string& indent, int depth) {
    const auto properties_it = schema.find("properties");
    const Json properties = properties_it != schema.end() && properties_it->is_object()
                                ? *properties_it
                                : Json::object();
    const auto required_it = schema.find("required");
    const Json required =
        required_it != schema.end() && required_it->is_array() ? *required_it : Json::array();
    const std::string inner = indent + "\t";
    std::vector<std::string> lines;
    for (const auto& [key, value] : properties.items()) {
        const std::string name = is_identifier(key) ? key : wire::serialize(Json(key));
        const bool is_required =
            std::find(required.begin(), required.end(), Json(key)) != required.end();
        const Json description =
            value.is_object() && value.contains("description") ? value["description"] : Json();
        lines.push_back(comment(description, inner) + inner + name + (is_required ? "" : "?") +
                        ": " + to_type(value, inner, depth + 1) + ";");
    }
    if (const auto extra = schema.find("additionalProperties"); extra != schema.end()) {
        if (extra->is_object()) {
            lines.push_back(inner + "[key: string]: " + to_type(*extra, inner, depth + 1) + ";");
        } else if (extra->is_boolean() && extra->get<bool>()) {
            lines.push_back(inner + "[key: string]: unknown;");
        }
    }
    if (lines.empty()) {
        return "Record<string, never>";
    }
    std::string body;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        body += (i > 0 ? "\n" : "") + lines[i];
    }
    return "{\n" + body + "\n" + indent + "}";
}

std::string type_keyword(const Json& type, const Json& schema, const std::string& indent,
                         int depth) {
    if (!type.is_string()) {
        return "unknown";
    }
    const auto& name = type.get_ref<const std::string&>();
    if (name == "string" || name == "boolean" || name == "null") {
        return name;
    }
    if (name == "number" || name == "integer") {
        return "number";
    }
    if (name == "array") {
        const auto items = schema.find("items");
        return items != schema.end() && items->is_object()
                   ? "Array<" + to_type(*items, indent, depth + 1) + ">"
                   : "unknown[]";
    }
    if (name == "object") {
        return object_type(schema, indent, depth);
    }
    return "unknown";
}

std::string to_type(const Json& schema, const std::string& indent, int depth) {
    if (!schema.is_object() || depth > max_type_depth) {
        return "unknown";
    }
    if (const auto value = schema.find("const"); value != schema.end()) {
        return literal(*value);
    }
    if (const auto values = schema.find("enum");
        values != schema.end() && values->is_array() && !values->empty()) {
        std::vector<std::string> members;
        for (const auto& value : *values) {
            members.push_back(literal(value));
        }
        return join_types(members, " | ");
    }
    auto alternatives = schema_list(schema, "anyOf");
    if (!alternatives) {
        alternatives = schema_list(schema, "oneOf");
    }
    if (alternatives) {
        std::vector<std::string> members;
        for (const auto& member : *alternatives) {
            members.push_back(to_type(member, indent, depth + 1));
        }
        return join_types(members, " | ");
    }
    if (const auto parts = schema_list(schema, "allOf")) {
        std::vector<std::string> members;
        for (const auto& member : *parts) {
            members.push_back(to_type(member, indent, depth + 1));
        }
        return join_types(members, " & ");
    }
    const auto type = schema.find("type");
    if (type != schema.end() && type->is_array()) {
        std::vector<std::string> members;
        for (const auto& member : *type) {
            members.push_back(type_keyword(member, schema, indent, depth));
        }
        return join_types(members, " | ");
    }
    if (type == schema.end()) {
        const auto properties = schema.find("properties");
        if (properties != schema.end() && properties->is_object()) {
            return object_type(schema, indent, depth);
        }
        return "unknown";
    }
    return type_keyword(*type, schema, indent, depth);
}

/// `todo-create` becomes `TodoCreateInput`.
std::string input_type_name(std::string_view command) {
    std::string pascal;
    bool start = true;
    for (const char c : command) {
        if (!std::isalnum(static_cast<unsigned char>(c))) {
            start = true;
            continue;
        }
        pascal.push_back(start ? static_cast<char>(std::toupper(static_cast<unsigned char>(c)))
                               : c);
        start = false;
    }
    if (pascal.empty()) {
        pascal = "Command";
    }
    const bool digit = std::isdigit(static_cast<unsigned char>(pascal.front())) != 0;
    return (digit ? "_" : "") + pascal + "Input";
}

} // namespace

std::string generate_input_types(const Json& schemas) {
    std::set<std::string> used;
    std::string out;
    if (!schemas.is_array()) {
        return "\n";
    }
    for (std::size_t i = 0; i < schemas.size(); ++i) {
        const Json& entry = schemas[i];
        const std::string command = string_or_empty(entry, "name");
        const std::string base = input_type_name(command);
        std::string name = base;
        for (int suffix = 2; used.count(name) > 0; ++suffix) {
            name = base + std::to_string(suffix);
        }
        used.insert(name);
        const std::string doc = comment(
            Json("Input of `" + command + "`: " + string_or_empty(entry, "description")), "");
        const Json schema = entry.contains("inputSchema") ? entry["inputSchema"] : Json();
        out += (i > 0 ? "\n\n" : "") + doc + "export type " + name + " = " +
               to_type(schema, "", 0) + ";";
    }
    return out + "\n";
}

std::vector<CommandDefinition> bootstrap_commands(const CommandRegistry& registry) {
    const CommandRegistry* described_registry = &registry;
    std::vector<CommandDefinition> commands;
    commands.push_back(bootstrap_command(
        "afd-help", "List all available commands with tags and grouping",
        Json{{"type", "object"},
             {"properties",
              {{"filter",
                {{"type", "string"}, {"description", "Tag filter: e.g., \"todo\" or \"read\""}}},
               {"format",
                {{"type", "string"},
                 {"enum", Json::array({"brief", "full"})},
                 {"default", "brief"},
                 {"description", "Output format"}}}}}},
        [described_registry](const Json& input, CommandContext& context) {
            return afd_help(*described_registry, input, context);
        }));
    commands.push_back(bootstrap_command(
        "afd-docs", "Get detailed documentation for commands",
        Json{{"type", "object"},
             {"properties",
              {{"command",
                {{"type", "string"}, {"description", "Specific command name, or omit for all"}}}}}},
        [described_registry](const Json& input, CommandContext& context) {
            return afd_docs(*described_registry, input, context);
        }));
    commands.push_back(bootstrap_command(
        "afd-schema", "Export input schemas for all commands as JSON Schema or TypeScript types",
        Json{{"type", "object"},
             {"properties",
              {{"format",
                {{"type", "string"},
                 {"enum", Json::array({"json", "typescript"})},
                 {"default", "json"},
                 {"description",
                  "Output format: JSON Schemas, or TypeScript input types in addition"}}}}}},
        [described_registry](const Json& input, CommandContext& context) {
            return afd_schema(*described_registry, input, context);
        }));
    return commands;
}

std::optional<std::string> register_bootstrap_commands(CommandRegistry& registry) {
    for (const auto name : afd_bootstrap_command_names) {
        if (registry.has(name)) {
            return "Command '" + std::string(name) + "' is already registered";
        }
    }
    for (auto& command : bootstrap_commands(registry)) {
        if (auto error = registry.register_command(std::move(command))) {
            return error;
        }
    }
    return std::nullopt;
}

} // namespace afd
