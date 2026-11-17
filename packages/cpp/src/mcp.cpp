#include "afd/mcp.hpp"

#include <utility>

namespace afd {
namespace {

Json examples_json(const std::vector<CommandExample>& examples) {
    Json out = Json::array();
    for (const auto& example : examples) {
        out.push_back(Json{{"title", example.title}, {"input", example.input}});
    }
    return out;
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
    if (command.category) {
        meta["category"] = *command.category;
    }
    if (!command.prerequisites.empty()) {
        meta["requires"] = command.prerequisites;
    }
    if (command.mutation) {
        meta["mutation"] = true;
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
        meta["examples"] = examples_json(command.examples);
    }
    if (command.output_schema) {
        meta["outputSchema"] = *command.output_schema;
    }
    if (!command.contexts.empty()) {
        meta["contexts"] = command.contexts;
    }
    if (meta.empty()) {
        return std::nullopt;
    }
    return meta;
}

std::optional<Json> command_tool_annotations(const CommandDefinition& command) {
    if (!command.mutation) {
        return std::nullopt;
    }
    return Json{{"readOnlyHint", false}, {"destructiveHint", command.destructive}};
}

Json command_to_mcp_tool(const CommandDefinition& command) {
    Json tool{{"name", command.name}};
    // The display label (spec/command-metadata.md, "Tool titles"): only when the command sets
    // one, never derived from the name.
    if (command.title) {
        tool["title"] = *command.title;
    }
    tool["description"] = command.description;
    tool["inputSchema"] = command.input_schema;
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
        for (const char* key : {"$defs", "definitions"}) {
            if (const auto defs = data.find(key); defs != data.end()) {
                envelope[key] = std::move(*defs);
                data.erase(key);
            }
        }
    }
    envelope["properties"] = Json{{"success", {{"type", "boolean"}}},
                                  {"data", std::move(data)},
                                  {"error", {{"type", "object"}}},
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
    if (command.execution_time) {
        out["executionTime"] = std::string(execution_time_name(*command.execution_time));
    }
    if (!command.errors.empty()) {
        out["errors"] = command.errors;
    }
    out["inputSchema"] = command.input_schema;
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
        out["examples"] = examples_json(command.examples);
    }
    return out;
}

} // namespace afd
