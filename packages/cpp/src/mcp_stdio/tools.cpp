#include "tools.hpp"

#include "afd/builtin_names.hpp"
#include "afd/contexts.hpp"
#include "afd/idempotency.hpp"
#include "afd/mcp.hpp"
#include "afd/output_budget.hpp"
#include "afd/schema.hpp"
#include "afd/similarity.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <map>
#include <set>
#include <utility>

namespace afd::mcp::surface {
namespace {

constexpr char confirm_flag[] =
    "Set to true to confirm a command that asks for confirmation, once the user intends it (only "
    "on servers that enforce confirmations)";
constexpr char meta_argument[] =
    "Request values for clients that cannot set _meta: dev.afd/context, dev.afd/outputBudget and "
    "the server's declared context fields' _meta keys, applied as if sent in _meta";
constexpr char confirm_names[] =
    "Names of the commands that ask for confirmation and are confirmed, once the user intends "
    "them (only on servers that enforce confirmations)";
constexpr char step_input[] =
    "Input parameters. A string value that is exactly $prev, $first, $steps[n], $steps.alias or "
    "$input, optionally followed by .path (e.g. $prev.items[0].id), is replaced by that data; "
    "unresolved references are omitted. Other strings are literals; start one with $$ to send a "
    "literal $ (e.g. $$prev).";

/// Largest serialized size, in UTF-16 code units as TypeScript measures it, of a grouped tool's
/// action schemas that are inlined as `params.anyOf`.
constexpr std::size_t grouped_params_schema_budget = 8192;
/// The most names one afd-detail call resolves.
constexpr std::size_t max_detail_names = 10;

Json meta_object() {
    return Json{{"type", "object"}, {"description", meta_argument}};
}

Json names_schema() {
    return Json{{"anyOf", Json::array({Json{{"type", "string"}},
                                       Json{{"type", "array"}, {"items", {{"type", "string"}}}}})}};
}

Json call_tool() {
    return Json{
        {"name", "afd-call"},
        {"title", "Call a command"},
        {"description",
         "Invoke any command by name with runtime input validation. Works in all server "
         "strategies."},
        {"inputSchema",
         {{"type", "object"},
          {"properties",
           {{"command",
             {{"type", "string"}, {"minLength", 1}, {"description", "Command name to invoke"}}},
            {"input",
             {{"type", "object"},
              {"description",
               "Command input (validated against the command's own schema at runtime)"}}},
            {"confirm", {{"description", confirm_flag}, {"type", "boolean"}}},
            {"meta", meta_object()}}},
          {"required", Json::array({"command"})}}}};
}

Json batch_tool() {
    return Json{
        {"name", "afd-batch"},
        {"title", "Run commands in a batch"},
        {"description",
         "Execute multiple commands in a single batch request with partial success semantics"},
        {"inputSchema",
         {{"type", "object"},
          {"properties",
           {{"commands",
             {{"type", "array"},
              {"items",
               {{"type", "object"},
                {"properties",
                 {{"id",
                   {{"description", "Optional client-provided ID for correlating results"},
                    {"type", "string"}}},
                  {"command", {{"type", "string"}, {"description", "The command name to execute"}}},
                  {"input",
                   {{"type", "object"}, {"description", "Input parameters for the command"}}}}},
                {"required", Json::array({"command"})}}},
              {"description", "Array of commands to execute"}}},
            {"options",
             {{"description", "Batch execution options"},
              {"type", "object"},
              {"properties",
               {{"stopOnError",
                 {{"description", "Stop execution on first error"}, {"type", "boolean"}}},
                {"timeout",
                 {{"description", "Timeout in milliseconds for entire batch"},
                  {"type", "number"},
                  {"minimum", 0}}},
                {"parallelism",
                 {{"description", "Maximum commands to run concurrently (default 1)"},
                  {"type", "integer"},
                  {"minimum", 1},
                  {"maximum", 9007199254740991}}}}}}},
            {"confirm",
             {{"description", confirm_names}, {"type", "array"}, {"items", {{"type", "string"}}}}},
            {"meta", meta_object()}}},
          {"required", Json::array({"commands"})}}}};
}

Json pipe_tool() {
    const Json open_object{{"type", "object"},
                           {"propertyNames", {{"type", "string"}}},
                           {"additionalProperties", Json::object()}};
    Json input = open_object;
    input["description"] = step_input;
    Json when = open_object;
    when["description"] =
        "Optional condition for running this step (e.g., { $exists: '$prev.id' })";
    return Json{
        {"name", "afd-pipe"},
        {"title", "Run a command pipeline"},
        {"description",
         "Execute a pipeline of chained commands where the output of one becomes the input of "
         "the next"},
        {"inputSchema",
         {{"type", "object"},
          {"properties",
           {{"input",
             {{"description",
               "Optional pipeline input (any JSON value), available to steps as $input and "
               "$input.<path>"}}},
            {"steps",
             {{"type", "array"},
              {"items",
               {{"type", "object"},
                {"properties",
                 {{"command", {{"type", "string"}, {"description", "Command name to execute"}}},
                  {"input", input},
                  {"as",
                   {{"description", "Optional alias for referencing this step's output"},
                    {"type", "string"}}},
                  {"when", when}}},
                {"required", Json::array({"command"})}}},
              {"description", "Ordered list of pipeline steps to execute"}}},
            {"options",
             {{"description", "Pipeline execution options"},
              {"type", "object"},
              {"properties",
               {{"continueOnFailure",
                 {{"description", "Continue on failure or stop immediately"}, {"type", "boolean"}}},
                {"timeoutMs",
                 {{"description", "Timeout for entire pipeline in milliseconds"},
                  {"type", "number"},
                  {"minimum", 0}}}}}}},
            {"confirm",
             {{"description", confirm_names}, {"type", "array"}, {"items", {{"type", "string"}}}}},
            {"meta", meta_object()}}},
          {"required", Json::array({"steps"})}}}};
}

Json discover_tool() {
    Json tag = names_schema();
    tag["description"] = "Filter by tag(s). String for single, array for multiple.";
    return Json{
        {"name", "afd-discover"},
        {"title", "Discover commands"},
        {"description",
         "List available commands with optional filtering by category, tag, or search text. "
         "Returns compact summaries."},
        {"inputSchema",
         {{"type", "object"},
          {"properties",
           {{"category", {{"description", "Filter commands by category"}, {"type", "string"}}},
            {"tag", tag},
            {"tagMode",
             {{"description", "Tag matching mode (default: any)"},
              {"type", "string"},
              {"enum", Json::array({"all", "any"})}}},
            {"search",
             {{"description", "Text search across names and descriptions"}, {"type", "string"}}},
            {"includeMutation",
             {{"description", "Include mutation classification"}, {"type", "boolean"}}},
            {"limit", {{"description", "Max results (1-200, default 50)"}, {"type", "number"}}},
            {"offset", {{"description", "Results to skip for pagination"}, {"type", "number"}}},
            {"meta", meta_object()}}}}}};
}

Json detail_tool() {
    Json command = names_schema();
    command["description"] = "Command name or names (exact match, kebab-case). String or array of "
                             "strings (max 10).";
    return Json{
        {"name", "afd-detail"},
        {"title", "Describe commands"},
        {"description", "Get the full input schema and metadata for one or more commands by name."},
        {"inputSchema",
         {{"type", "object"},
          {"properties", {{"command", command}, {"meta", meta_object()}}},
          {"required", Json::array({"command"})}}}};
}

/// The schemas the arguments are checked against: the advertised ones, in the keywords the
/// validator supports (a string-or-array `anyOf` becomes a type list).
Json check_schema(std::string_view tool) {
    const Json names{{"type", Json::array({"string", "array"})}, {"items", {{"type", "string"}}}};
    if (tool == "afd-call") {
        return Json{{"type", "object"},
                    {"properties",
                     {{"command", {{"type", "string"}, {"minLength", 1}}},
                      {"input", Json::object()},
                      {"confirm", {{"type", "boolean"}}}}},
                    {"required", Json::array({"command"})}};
    }
    if (tool == "afd-discover") {
        return Json{{"type", "object"},
                    {"properties",
                     {{"category", {{"type", "string"}}},
                      {"tag", names},
                      {"tagMode", {{"type", "string"}, {"enum", Json::array({"all", "any"})}}},
                      {"search", {{"type", "string"}}},
                      {"includeMutation", {{"type", "boolean"}}},
                      {"limit", {{"type", "number"}}},
                      {"offset", {{"type", "number"}}}}}};
    }
    return Json{{"type", "object"},
                {"properties", {{"command", names}}},
                {"required", Json::array({"command"})}};
}

std::string lower(std::string_view text) {
    std::string out(text);
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

bool is_space(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

/// UTF-8 code points in `text`, counting each beyond the BMP twice, as UTF-16 does.
std::size_t utf16_length(std::string_view text) {
    std::size_t units = 0;
    for (std::size_t i = 0; i < text.size(); ++i) {
        const auto byte = static_cast<unsigned char>(text[i]);
        if ((byte & 0xC0U) != 0x80U) {
            units += byte >= 0xF0U ? 2 : 1;
        }
    }
    return units;
}

/// The first `count` code points of `text`.
std::string first_code_points(std::string_view text, std::size_t count) {
    std::size_t i = 0;
    for (std::size_t seen = 0; i < text.size(); ++i) {
        if ((static_cast<unsigned char>(text[i]) & 0xC0U) != 0x80U) {
            if (seen == count) {
                break;
            }
            ++seen;
        }
    }
    return std::string(text.substr(0, i));
}

std::size_t code_points(std::string_view text) {
    return static_cast<std::size_t>(std::count_if(text.begin(), text.end(), [](char c) {
        return (static_cast<unsigned char>(c) & 0xC0U) != 0x80U;
    }));
}

/// The first sentence of `description` (the text before a `.` and whitespace), or its first
/// `max - 1` characters and an ellipsis.
std::string truncate_description(std::string_view description, std::size_t max = 120) {
    std::string_view first = description;
    for (std::size_t i = 0; i + 1 < description.size(); ++i) {
        if (description[i] == '.' && is_space(description[i + 1])) {
            first = description.substr(0, i);
            break;
        }
    }
    if (code_points(first) <= max) {
        return std::string(first);
    }
    return first_code_points(description, max - 1) + "\xE2\x80\xA6";
}

std::vector<std::string> strings(const Json& value) {
    std::vector<std::string> out;
    if (value.is_string()) {
        out.push_back(value.get<std::string>());
    } else if (value.is_array()) {
        for (const auto& item : value) {
            if (item.is_string()) {
                out.push_back(item.get<std::string>());
            }
        }
    }
    return out;
}

std::string format_number(double value) {
    if (std::trunc(value) == value && std::fabs(value) < 1e15) {
        return std::to_string(static_cast<long long>(value));
    }
    return wire::serialize(wire::number(value));
}

CommandResult timed(Json data, std::string reasoning,
                    std::chrono::steady_clock::time_point started) {
    const double elapsed =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started)
            .count();
    ResultMetadata metadata;
    metadata.execution_time_ms = std::round(elapsed * 100.0) / 100.0;
    return success(std::move(data),
                   {.confidence = 1.0, .reasoning = std::move(reasoning), .metadata = metadata});
}

/// A tool's `inputSchema` as an object schema.
Json object_schema(const Json& tool) {
    Json schema =
        tool.is_object() && tool.contains("inputSchema") && tool["inputSchema"].is_object()
            ? tool["inputSchema"]
            : Json::object();
    schema["type"] = "object";
    return schema;
}

} // namespace

Json meta_tool(std::string_view name) {
    if (name == "afd-call") {
        return call_tool();
    }
    if (name == "afd-batch") {
        return batch_tool();
    }
    if (name == "afd-pipe") {
        return pipe_tool();
    }
    if (name == "afd-discover") {
        return discover_tool();
    }
    return detail_tool();
}

Expected<Json, CommandError> parse_meta_args(std::string_view tool, const Json& arguments,
                                             std::string_view usage) {
    Json args = Json::object();
    if (arguments.is_object()) {
        for (const auto& [key, value] : arguments.items()) {
            if (!value.is_null()) {
                args[key] = value;
            }
        }
    } else {
        args = arguments;
    }
    const auto schema = CompiledSchema::compile(check_schema(tool));
    if (!schema) {
        return unexpected(create_error(error_codes::INTERNAL_ERROR,
                                       "The " + std::string(tool) + " argument schema is invalid"));
    }
    auto checked = schema->validate(args);
    if (checked) {
        return std::move(*checked);
    }
    const CommandError invalid = validation_failure_error(checked.error());
    std::string prefix = invalid.suggestion.value_or(invalid.message);
    while (!prefix.empty() && prefix.back() == '.') {
        prefix.pop_back();
    }
    return unexpected(create_error(
        error_codes::VALIDATION_ERROR, "Invalid " + std::string(tool) + " arguments",
        {.suggestion = prefix + ". " + std::string(usage), .details = invalid.details}));
}

std::string default_command_group(const CommandDefinition& command) {
    if (command.category && !command.category->empty()) {
        return *command.category;
    }
    const auto dash = command.name.find('-');
    const std::string first = command.name.substr(0, dash);
    return first.empty() ? std::string("general") : first;
}

std::string command_action(const CommandDefinition& command) {
    const auto dash = command.name.find('-');
    return dash == std::string::npos ? command.name : command.name.substr(dash + 1);
}

Json grouped_tool(const std::string& group, const std::vector<const Listed*>& members) {
    std::vector<std::string> actions;
    Json entries = Json::array();
    Json branches = Json::array();
    bool accepts_confirm = false;
    for (const auto* member : members) {
        const auto& command = *member->command;
        const std::string action = command_action(command);
        if (std::find(actions.begin(), actions.end(), action) == actions.end()) {
            actions.push_back(action);
        }
        Json entry{{"action", action},
                   {"command", command.name},
                   {"description", command.description},
                   {"inputSchema", object_schema(member->tool)}};
        if (const auto meta = command_tool_meta(command)) {
            entry.update(*meta);
        }
        entries.push_back(std::move(entry));
        Json branch = object_schema(member->tool);
        branch["title"] = action;
        branch["description"] = "Parameters for action '" + action + "' (" + command.name + ")";
        branches.push_back(std::move(branch));
        accepts_confirm = accepts_confirm || member->accepts_confirm;
    }
    const std::string serialized = wire::serialize(branches);
    const bool inline_schemas = utf16_length(serialized) <= grouped_params_schema_budget &&
                                serialized.find("\"$ref\"") == std::string::npos;
    Json params{
        {"type", "object"},
        {"description", inline_schemas
                            ? "Parameters for the action: the anyOf branch titled with the action"
                            : "Parameters for the action: see _meta.actions[].inputSchema, or call "
                              "afd-detail with the action's command name"}};
    if (inline_schemas) {
        params["anyOf"] = std::move(branches);
    }
    std::string listed;
    std::string described;
    for (std::size_t i = 0; i < actions.size(); ++i) {
        listed += (i > 0 ? " | " : "") + actions[i];
        described += (i > 0 ? ", " : "") + actions[i];
    }
    Json properties{
        {"action",
         {{"type", "string"}, {"enum", actions}, {"description", "Action to perform: " + listed}}},
        {"params", std::move(params)}};
    if (accepts_confirm) {
        properties["confirm"] = Json{
            {"type", "boolean"},
            {"description", "Set to true to confirm this command, once the user intends it. The "
                            "server asks for confirmation when it is missing."}};
    }
    return Json{{"name", group},
                {"description", group + " operations: " + described},
                {"inputSchema",
                 {{"type", "object"},
                  {"properties", std::move(properties)},
                  {"required", Json::array({"action"})}}},
                {"_meta", {{"actions", std::move(entries)}}}};
}

CommandResult discover(const std::vector<const CommandDefinition*>& commands, const Json& args) {
    const auto started = std::chrono::steady_clock::now();
    const std::optional<std::string> category =
        args.contains("category") && args["category"].is_string()
            ? std::optional<std::string>(args["category"].get<std::string>())
            : std::nullopt;
    const bool by_tag = args.contains("tag");
    const std::vector<std::string> tags =
        by_tag ? strings(args["tag"]) : std::vector<std::string>{};
    const bool all_tags_mode = args.contains("tagMode") && args["tagMode"] == "all";
    const std::optional<std::string> search =
        args.contains("search") && args["search"].is_string()
            ? std::optional<std::string>(args["search"].get<std::string>())
            : std::nullopt;
    const bool include_mutation =
        args.contains("includeMutation") && args["includeMutation"] == true;
    const double limit_arg =
        args.contains("limit") && args["limit"].is_number() ? args["limit"].get<double>() : 50.0;
    const double offset_arg =
        args.contains("offset") && args["offset"].is_number() ? args["offset"].get<double>() : 0.0;

    std::set<std::string> categories;
    std::set<std::string> all_tags;
    for (const auto* command : commands) {
        categories.insert(default_command_group(*command));
        all_tags.insert(command->tags.begin(), command->tags.end());
    }

    std::vector<std::string> tokens;
    if (search) {
        std::string token;
        for (const char c : lower(*search)) {
            if (is_space(c)) {
                if (!token.empty()) {
                    tokens.push_back(std::move(token));
                    token.clear();
                }
            } else {
                token.push_back(c);
            }
        }
        if (!token.empty()) {
            tokens.push_back(std::move(token));
        }
    }
    std::vector<const CommandDefinition*> filtered;
    for (const auto* command : commands) {
        if (category && default_command_group(*command) != *category) {
            continue;
        }
        if (by_tag) {
            const auto has = [&](const std::string& tag) {
                return std::find(command->tags.begin(), command->tags.end(), tag) !=
                       command->tags.end();
            };
            const bool matches = !command->tags.empty() &&
                                 (all_tags_mode ? std::all_of(tags.begin(), tags.end(), has)
                                                : std::any_of(tags.begin(), tags.end(), has));
            if (!matches) {
                continue;
            }
        }
        if (search) {
            const std::string target = lower(command->name + " " + command->description);
            if (!std::all_of(tokens.begin(), tokens.end(), [&](const std::string& token) {
                    return target.find(token) != std::string::npos;
                })) {
                continue;
            }
        }
        filtered.push_back(command);
    }

    const double limit =
        std::trunc(std::clamp(std::isfinite(limit_arg) ? limit_arg : 50.0, 1.0, 200.0));
    const double offset = std::trunc((std::max)(std::isfinite(offset_arg) ? offset_arg : 0.0, 0.0));
    const std::size_t total = commands.size();
    const std::size_t count = filtered.size();
    const std::size_t start =
        offset >= static_cast<double>(count) ? count : static_cast<std::size_t>(offset);
    const std::size_t end = (std::min)(count, start + static_cast<std::size_t>(limit));
    Json page = Json::array();
    for (std::size_t i = start; i < end; ++i) {
        const auto& command = *filtered[i];
        Json summary{{"name", command.name},
                     {"description", truncate_description(command.description)},
                     {"category", default_command_group(command)}};
        if (include_mutation) {
            summary["mutation"] = command.mutation;
        }
        page.push_back(std::move(summary));
    }
    const bool has_more = offset + limit < static_cast<double>(count);
    const std::size_t returned = page.size();
    std::string reasoning = "Returned " + std::to_string(returned) + " of " +
                            std::to_string(count) + " matching commands (" + std::to_string(total) +
                            " total)";
    if (category) {
        reasoning += " in category '" + *category + "'";
    }
    if (has_more) {
        reasoning += ". Use offset: " + format_number(offset + limit) + " to see more.";
    }
    return timed(Json{{"commands", std::move(page)},
                      {"total", total},
                      {"filtered", count},
                      {"returned", returned},
                      {"hasMore", has_more},
                      {"availableCategories", categories},
                      {"availableTags", all_tags}},
                 std::move(reasoning), started);
}

CommandResult detail(const std::vector<const Listed*>& commands, const Json& args,
                     const std::function<std::string(std::string_view)>& not_found) {
    const auto started = std::chrono::steady_clock::now();
    std::vector<std::string> names = strings(args.contains("command") ? args["command"] : Json());
    if (names.size() > max_detail_names) {
        names.resize(max_detail_names);
    }
    std::map<std::string, const Listed*, std::less<>> by_name;
    for (const auto* listed : commands) {
        by_name.emplace(listed->command->name, listed);
    }
    Json entries = Json::array();
    std::size_t found = 0;
    for (const auto& name : names) {
        const auto it = by_name.find(name);
        if (it == by_name.end()) {
            const std::string shown = truncate_name(name);
            entries.push_back(Json{{"name", shown},
                                   {"found", false},
                                   {"error",
                                    {{"code", error_codes::COMMAND_NOT_FOUND},
                                     {"message", "No command named '" + shown + "'"},
                                     {"suggestion", not_found(name)}}}});
            continue;
        }
        Json entry = afd::to_json(*it->second->command);
        entry["found"] = true;
        entry["inputSchema"] = object_schema(it->second->tool);
        // Every command afd-detail can see is exposed to MCP, so callable.
        entry["callable"] = true;
        entries.push_back(std::move(entry));
        ++found;
    }
    return timed(std::move(entries),
                 "Resolved " + std::to_string(found) + " of " + std::to_string(names.size()) +
                     " requested commands",
                 started);
}

std::optional<std::string> first_class_fault(const CommandRegistry& registry,
                                             const StdioServerOptions& options) {
    const auto& names = options.first_class_tools;
    const bool hybrid = options.tool_strategy == ToolStrategy::hybrid;
    if (!names) {
        if (hybrid) {
            return std::string("ToolStrategy::hybrid needs first_class_tools: the names of the "
                               "commands to list as their own tools");
        }
        return std::nullopt;
    }
    if (!hybrid) {
        return "first_class_tools is only valid with ToolStrategy::hybrid (got " +
               std::string(tool_strategy_name(options.tool_strategy)) +
               "): set the strategy to hybrid, or remove first_class_tools";
    }
    if (names->empty()) {
        return std::string("first_class_tools is empty: a hybrid server with no first-class "
                           "tools is the lazy strategy, so use ToolStrategy::lazy, or name the "
                           "commands to list");
    }
    const auto listed_anyway = [](std::string_view name) {
        return std::find(std::begin(afd_meta_tool_names), std::end(afd_meta_tool_names), name) !=
                   std::end(afd_meta_tool_names) ||
               std::find(std::begin(afd_context_command_names), std::end(afd_context_command_names),
                         name) != std::end(afd_context_command_names);
    };
    std::set<std::string> seen;
    for (std::size_t index = 0; index < names->size(); ++index) {
        const std::string& entry = (*names)[index];
        const std::string quoted = "first-class tool '" + entry + "'";
        if (index >= max_first_class_tools) {
            return quoted + " is beyond the cap of " + std::to_string(max_first_class_tools) +
                   " first-class tools: remove it, or use the individual or grouped strategy "
                   "to list more tools";
        }
        if (listed_anyway(entry)) {
            return quoted + " is already listed by the hybrid strategy (meta-tools and context "
                            "tools always are): remove it";
        }
        if (!seen.insert(entry).second) {
            return quoted + " appears more than once: each tool is listed once";
        }
        const auto command = registry.get(entry);
        if (!command) {
            const bool bootstrap = std::find(std::begin(afd_bootstrap_command_names),
                                             std::end(afd_bootstrap_command_names),
                                             entry) != std::end(afd_bootstrap_command_names);
            return quoted + " is not a registered command" +
                   (bootstrap ? ": call afd::register_bootstrap_commands to register it"
                              : ": register it, or remove it");
        }
        if (!is_exposed_to(command->definition.expose, Interface::mcp)) {
            return quoted + " is not exposed to MCP (expose.mcp is not true), so it cannot be "
                            "listed: expose it, or remove it";
        }
    }
    return std::nullopt;
}

std::optional<CommandResult> lift_meta_argument(Json& params, Json& meta) {
    const std::string tool =
        params.is_object() && params.contains("name") && params["name"].is_string()
            ? params["name"].get<std::string>()
            : std::string();
    const bool meta_tool = std::find(std::begin(afd_meta_tool_names), std::end(afd_meta_tool_names),
                                     tool) != std::end(afd_meta_tool_names);
    if (!meta_tool || !params.contains("arguments") || !params["arguments"].is_object() ||
        !params["arguments"].contains("meta")) {
        return std::nullopt;
    }
    Json& arguments = params["arguments"];
    const Json argument = arguments["meta"];
    arguments.erase("meta");
    if (argument.is_null()) {
        return std::nullopt;
    }
    const std::array<std::string, 3> allowed_keys{std::string(context_meta_key),
                                                  std::string(output_budget_meta_key),
                                                  std::string(afd_idempotency_key_meta_key)};
    if (!argument.is_object()) {
        return failure(create_error(
            error_codes::VALIDATION_ERROR, "The meta argument of " + tool + " must be an object",
            {.suggestion = "Send meta as an object whose keys are _meta keys: " + allowed_keys[0] +
                           ", " + allowed_keys[1] + ", " + allowed_keys[2],
             .details = Json{{"argument", "meta"}}}));
    }
    for (const std::string& key : allowed_keys) {
        const auto value = argument.find(key);
        if (value == argument.end() || value->is_null()) {
            continue;
        }
        const auto sent = meta.find(key);
        if (sent != meta.end() && !sent->is_null() && *sent != *value) {
            return failure(create_error(
                error_codes::VALIDATION_ERROR,
                "_meta[\"" + key + "\"] and the meta argument of " + tool + " disagree",
                {.suggestion =
                     "Send " + key + " in _meta or in the meta argument, or the same value in both",
                 .details = Json{{"meta", key}}}));
        }
        meta[key] = *value;
    }
    return std::nullopt;
}

} // namespace afd::mcp::surface
