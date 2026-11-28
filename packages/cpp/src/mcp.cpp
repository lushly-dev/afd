#include "afd/mcp.hpp"

#include <algorithm>
#include <initializer_list>
#include <string>
#include <string_view>
#include <utility>

#include "detail/json_io.hpp"
#include "detail/output_budget.hpp"

namespace afd {
namespace {

// Whether `schema` starts a schema resource: a string `$id` that is not a bare fragment, the
// validators' test (spec/validation.md), so its local references resolve against it.
bool starts_resource(const Json& schema) {
    if (!schema.is_object()) {
        return false;
    }
    const auto id = schema.find("$id");
    return id != schema.end() && id->is_string() &&
           !id->get_ref<const std::string&>().starts_with('#');
}

bool is_one_of(std::string_view key, std::initializer_list<std::string_view> keys) {
    return std::find(keys.begin(), keys.end(), key) != keys.end();
}

// Points every `"$ref": "#"` naming `schema`'s root, outside any nested schema resource, at
// `target`. Values and annotations (`const`, `enum`, `default`, `examples`) are left alone, and so
// is a draft-07 `dependencies` entry that lists property names.
void retarget_root(Json& schema, const std::string& target, bool root) {
    if (!schema.is_object() || (!root && starts_resource(schema))) {
        return;
    }
    for (auto it = schema.begin(); it != schema.end(); ++it) {
        const std::string& key = it.key();
        Json& value = it.value();
        if (key == "$ref" && value == "#") {
            value = target;
        } else if (is_one_of(key, {"allOf", "anyOf", "oneOf", "prefixItems", "items"}) &&
                   value.is_array()) {
            for (Json& item : value) {
                retarget_root(item, target, false);
            }
        } else if (is_one_of(key, {"items", "additionalProperties", "not", "if", "then", "else",
                                   "contains", "propertyNames", "additionalItems",
                                   "unevaluatedItems", "unevaluatedProperties"})) {
            retarget_root(value, target, false);
        } else if (is_one_of(key, {"properties", "patternProperties", "$defs", "definitions",
                                   "dependentSchemas", "dependencies"}) &&
                   value.is_object()) {
            for (auto entry = value.begin(); entry != value.end(); ++entry) {
                retarget_root(entry.value(), target, false);
            }
        }
    }
}

} // namespace

bool is_mcp_exposed(const CommandDefinition& command) noexcept {
    return is_exposed_to(command.expose, Interface::mcp);
}

std::string_view execution_time_name(ExecutionTime time) noexcept {
    switch (time) {
    case ExecutionTime::instant:
        return "instant";
    case ExecutionTime::fast:
        return "fast";
    case ExecutionTime::slow:
        return "slow";
    case ExecutionTime::long_running:
        return "long-running";
    }
    return "instant";
}

std::optional<Json> command_tool_meta(const CommandDefinition& command) {
    Json meta = Json::object();
    // Extra tool _meta entries (spec/mcp-resources.md, T1) go before the server's own fields so
    // they can never replace one; the T2 key rule already forbids reserved and unprefixed keys.
    if (command.tool_meta && command.tool_meta->is_object() && !command.tool_meta->empty() &&
        !detail::omits_output_budget_surface(command.name)) {
        for (auto it = command.tool_meta->begin(); it != command.tool_meta->end(); ++it) {
            meta[it.key()] = it.value();
        }
    }
    if (command.category) {
        meta["category"] = *command.category;
    }
    if (!command.prerequisites.empty()) {
        meta["requires"] = command.prerequisites;
    }
    if (command.mutation) {
        meta["mutation"] = true;
    }
    if (command.idempotency) {
        meta["idempotency"] = std::string(idempotency_support_name(*command.idempotency));
    }
    if (command.destructive) {
        meta["destructive"] = true;
    }
    if (command.undoable) {
        meta["undoable"] = true;
    }
    if (const auto mode = approval_mode(command.approval)) {
        meta["approval"] = std::string(approval_mode_name(*mode));
    }
    if (!command.examples.empty()) {
        meta["examples"] = detail::examples_json(command.examples);
    }
    if (command.output_schema) {
        meta["outputSchema"] = *command.output_schema;
    }
    if (!command.contexts.empty()) {
        meta["contexts"] = command.contexts;
    }
    if (command.output_budget && !detail::omits_output_budget_surface(command.name)) {
        meta[std::string(output_budget_meta_key)] = *command.output_budget;
    }
    if (meta.empty()) {
        return std::nullopt;
    }
    return meta;
}

std::optional<Json> command_tool_annotations(const CommandDefinition& command) {
    // A declared `natural` is the only source of `idempotentHint` (spec/idempotency.md, D2).
    const bool idempotent = command.idempotency == IdempotencySupport::natural;
    if (!command.mutation) {
        return idempotent ? std::optional<Json>(Json{{"idempotentHint", true}}) : std::nullopt;
    }
    Json annotations{{"readOnlyHint", false}, {"destructiveHint", command.destructive}};
    if (idempotent) {
        annotations["idempotentHint"] = true;
    }
    return annotations;
}

Json command_to_mcp_tool(const CommandDefinition& command) {
    Json tool{{"name", command.name}};
    // The display label (spec/command-metadata.md, "Tool titles"): only when the command sets
    // one, never derived from the name.
    if (command.title) {
        tool["title"] = *command.title;
    }
    tool["description"] = command.description;
    tool["inputSchema"] =
        command.advertised_input_schema ? *command.advertised_input_schema : command.input_schema;
    if (auto annotations = command_tool_annotations(command)) {
        tool["annotations"] = std::move(*annotations);
    }
    if (auto meta = command_tool_meta(command)) {
        tool["_meta"] = std::move(*meta);
    }
    return tool;
}

Json command_result_output_schema(const Json& data_schema) {
    Json data = data_schema;
    Json envelope{{"type", "object"}};
    if (data.is_object()) {
        data.erase("$schema");
    }
    // When `data` starts a schema resource, its local references resolve against it, so its
    // definitions stay inside it. Otherwise they move to the envelope, and a `"$ref": "#"` that
    // named `data` names "#/properties/data", since `#` now names the envelope.
    if (data.is_object() && !starts_resource(data)) {
        retarget_root(data, "#/properties/data", true);
        for (const char* key : {"$defs", "definitions"}) {
            if (const auto defs = data.find(key); defs != data.end()) {
                envelope[key] = std::move(*defs);
                data.erase(key);
            }
        }
    }
    envelope["properties"] = Json{{"success", {{"type", "boolean"}}},
                                  {"data", std::move(data)},
                                  {"error",
                                   {{"type", "object"},
                                    {"properties",
                                     {{"code", {{"type", "string"}}},
                                      {"message", {{"type", "string"}}},
                                      {"suggestion", {{"type", "string"}}},
                                      {"retryable", {{"type", "boolean"}}}}},
                                    {"required", {"code", "message"}}}},
                                  {"metadata", {{"type", "object"}}}};
    envelope["required"] = Json::array({"success"});
    return envelope;
}

std::vector<Json> commands_to_mcp_tools(const std::vector<CommandDefinition>& commands) {
    std::vector<Json> tools;
    for (const auto& command : commands) {
        if (is_mcp_exposed(command)) {
            tools.push_back(command_to_mcp_tool(command));
        }
    }
    return tools;
}

Json to_json(const CommandDefinition& command) {
    Json out{{"name", command.name}};
    if (command.title) {
        out["title"] = *command.title;
    }
    out["description"] = command.description;
    if (command.category) {
        out["category"] = *command.category;
    }
    if (!command.tags.empty()) {
        out["tags"] = command.tags;
    }
    out["mutation"] = command.mutation;
    if (command.idempotency) {
        out["idempotency"] = std::string(idempotency_support_name(*command.idempotency));
    }
    if (command.execution_time) {
        out["executionTime"] = std::string(execution_time_name(*command.execution_time));
    }
    if (!command.errors.empty()) {
        out["errors"] = command.errors;
    }
    out["inputSchema"] =
        command.advertised_input_schema ? *command.advertised_input_schema : command.input_schema;
    if (command.output_schema) {
        out["outputSchema"] = *command.output_schema;
    }
    if (command.destructive) {
        out["destructive"] = true;
    }
    if (command.confirm_prompt) {
        out["confirmPrompt"] = *command.confirm_prompt;
    }
    if (command.undoable) {
        out["undoable"] = true;
    }
    if (const auto mode = approval_mode(command.approval)) {
        out["approval"] = std::string(approval_mode_name(*mode));
    }
    if (command.handoff) {
        out["handoff"] = true;
    }
    if (command.handoff_protocol) {
        out["handoffProtocol"] = *command.handoff_protocol;
    }
    if (command.version) {
        out["version"] = *command.version;
    }
    if (!command.prerequisites.empty()) {
        out["requires"] = command.prerequisites;
    }
    if (!command.contexts.empty()) {
        out["contexts"] = command.contexts;
    }
    if (!command.examples.empty()) {
        out["examples"] = detail::examples_json(command.examples);
    }
    if (command.output_budget && !detail::omits_output_budget_surface(command.name)) {
        out["outputBudget"] = *command.output_budget;
    }
    if (command.tool_meta && command.tool_meta->is_object() && !command.tool_meta->empty() &&
        !detail::omits_output_budget_surface(command.name)) {
        out["toolMeta"] = *command.tool_meta;
    }
    return out;
}

} // namespace afd
