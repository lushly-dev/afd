// Declared context fields (spec/context-fields.md; packages/server/src/context-fields.ts and
// the journal half of packages/server/src/journal.ts).
#include "detail/context_fields.hpp"

#include "afd/approval.hpp"
#include "afd/errors.hpp"

#include <algorithm>
#include <array>
#include <set>
#include <string_view>
#include <utility>

namespace afd::detail {
namespace {

/// Context keys a declared field cannot take: TypeScript's reserved names, the snake_case and
/// camelCase names of `CommandContext`'s own members (the digest uses the camelCase ones), and
/// `source`, which `DirectClient` sets in `extra`.
constexpr std::array<std::string_view, 23> reserved_context_field_names = {
    // TypeScript's.
    "actor", "approval", "auth", "clock", "credentials", "interface", "random", "session", "signal",
    "timeout", "traceId",
    // CommandContext's own members, and the names the context digest gives them.
    "trace_id", "timeout_ms", "timeoutMs", "surface", "active_context", "activeContext",
    "cancellation", "extra", "journal", "direct_approval", "journaled_fields",
    // DirectClient's `extra` key.
    "source"};

bool is_meta_alpha(char c) noexcept {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

bool is_meta_alnum(char c) noexcept {
    return is_meta_alpha(c) || (c >= '0' && c <= '9');
}

char lower_ascii(char c) noexcept {
    return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c;
}

std::string lowercase_ascii(std::string_view text) {
    std::string out(text);
    std::transform(out.begin(), out.end(), out.begin(), lower_ascii);
    return out;
}

/// `[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?`
bool is_meta_label(std::string_view label) noexcept {
    return !label.empty() && is_meta_alpha(label.front()) && is_meta_alnum(label.back()) &&
           std::all_of(label.begin(), label.end(),
                       [](char c) { return is_meta_alnum(c) || c == '-'; });
}

/// `[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?`
bool is_meta_key_name(std::string_view name) noexcept {
    return !name.empty() && is_meta_alnum(name.front()) && is_meta_alnum(name.back()) &&
           std::all_of(name.begin(), name.end(),
                       [](char c) { return is_meta_alnum(c) || c == '.' || c == '_' || c == '-'; });
}

/// The prefix labels of `meta` when it is `<label>(.<label>)+/<name>`, else nothing. TypeScript
/// matches the same grammar with a regular expression; `<regex>` throws, so this reads it by hand.
std::optional<std::vector<std::string_view>> meta_key_labels(std::string_view meta) {
    const std::size_t slash = meta.find('/');
    if (slash == std::string_view::npos || !is_meta_key_name(meta.substr(slash + 1))) {
        return std::nullopt;
    }
    std::vector<std::string_view> labels;
    const std::string_view prefix = meta.substr(0, slash);
    std::size_t start = 0;
    while (true) {
        const std::size_t dot = prefix.find('.', start);
        const std::string_view label = prefix.substr(
            start, dot == std::string_view::npos ? std::string_view::npos : dot - start);
        if (!is_meta_label(label)) {
            return std::nullopt;
        }
        labels.push_back(label);
        if (dot == std::string_view::npos) {
            break;
        }
        start = dot + 1;
    }
    if (labels.size() < 2) {
        return std::nullopt;
    }
    return labels;
}

bool is_reserved_meta(std::string_view meta, const std::vector<std::string_view>& labels) {
    if (lowercase_ascii(meta).rfind("dev.afd/", 0) == 0) {
        return true;
    }
    return std::any_of(labels.begin(), labels.end(), [](std::string_view label) {
        const std::string lower = lowercase_ascii(label);
        return lower == "mcp" || lower == "modelcontextprotocol";
    });
}

CommandResult context_field_failure(const ContextField& field, std::string message, Json errors) {
    Json details = Json::object();
    details["field"] = field.name;
    details["meta"] = field.meta;
    details["errors"] = std::move(errors);
    // TypeScript's suggestion, without its pointer to server/discover: C++ has no MCP server.
    return failure(
        create_error(error_codes::VALIDATION_ERROR, std::move(message),
                     {.suggestion = "Send '" + field.name + "' in _meta[\"" + field.meta +
                                    "\"] as its schema describes" +
                                    (field.required ? "; it is required" : ", or leave it out"),
                      .details = std::move(details)}));
}

Json context_field_issue(std::string path, std::string message) {
    Json issue = Json::object();
    issue["path"] = std::move(path);
    issue["message"] = std::move(message);
    return issue;
}

/// The byte length of `value`'s UTF-8 canonical JSON, as TypeScript measures it. `canonical_json`
/// writes numbers as JavaScript does; a value it refuses (an unsafe integer, invalid UTF-8) is
/// measured as `wire::serialize` writes it.
std::size_t canonical_json_bytes(const Json& value) {
    if (auto text = canonical_json(value)) {
        return text->size();
    }
    return wire::serialize(value).size();
}

} // namespace

Expected<CompiledContextFields> compile_context_fields(const std::vector<ContextField>& fields) {
    CompiledContextFields compiled;
    std::set<std::string, std::less<>> names;
    std::set<std::string, std::less<>> meta_keys;
    std::vector<std::string> journaled;
    for (const ContextField& field : fields) {
        const std::string& name = field.name;
        if (name.empty()) {
            return unexpected(std::string("A context field needs a non-empty name"));
        }
        if (std::find(reserved_context_field_names.begin(), reserved_context_field_names.end(),
                      name) != reserved_context_field_names.end()) {
            return unexpected("Context field '" + name +
                              "' uses a name AFD sets itself; choose another name");
        }
        if (names.count(name) != 0) {
            return unexpected("Context field '" + name + "' is declared twice");
        }
        const auto labels = meta_key_labels(field.meta);
        if (!labels) {
            return unexpected("Context field '" + name +
                              "' needs a meta key with a reverse-DNS prefix, such as "
                              "'dev.example/" +
                              name + "'");
        }
        if (is_reserved_meta(field.meta, *labels)) {
            return unexpected("Context field '" + name + "' uses the reserved meta prefix of '" +
                              field.meta + "'; use your own domain");
        }
        if (meta_keys.count(field.meta) != 0) {
            return unexpected("Meta key '" + field.meta + "' of context field '" + name +
                              "' is declared twice");
        }
        if (field.schema.is_null()) {
            return unexpected("Context field '" + name + "' needs a JSON Schema");
        }
        auto schema = CompiledSchema::compile(field.schema);
        if (!schema) {
            return unexpected("Context field '" + name +
                              "' has an unsupported schema: " + schema.error());
        }
        compiled.schemas.push_back(std::move(*schema));
        names.insert(name);
        meta_keys.insert(field.meta);
        if (field.journal) {
            journaled.push_back(name);
        }
    }
    if (!journaled.empty()) {
        std::sort(journaled.begin(), journaled.end());
        compiled.journaled =
            std::make_shared<const JournaledContextFields>(JournaledContextFields{journaled});
    }
    return compiled;
}

std::optional<CommandResult> apply_context_fields(const std::vector<ContextField>& fields,
                                                  const std::vector<CompiledSchema>& schemas,
                                                  std::string_view command,
                                                  CommandContext& context) {
    // AFD's own commands (afd-help and the rest) run without required fields, so a client can
    // discover what to send; a value they do get is still validated.
    const bool enforce_required = command.substr(0, 4) != "afd-";
    for (std::size_t i = 0; i < fields.size() && i < schemas.size(); ++i) {
        const ContextField& field = fields[i];
        Json* value = nullptr;
        if (context.extra.is_object()) {
            const auto found = context.extra.find(field.name);
            // A JSON `null` counts as no value, like an absent key.
            if (found != context.extra.end() && !found->is_null()) {
                value = &*found;
            }
        }
        if (value == nullptr) {
            if (field.required && enforce_required) {
                return context_field_failure(field,
                                             "Context field '" + field.name + "' is required",
                                             Json::array({context_field_issue("", "Required")}));
            }
            continue;
        }
        auto parsed = schemas[i].validate(*value);
        if (!parsed) {
            Json errors = Json::array();
            for (const ValidationIssue& issue : parsed.error().errors) {
                // TypeScript joins Zod's path, which is empty at the value itself.
                errors.push_back(
                    context_field_issue(issue.path == "(root)" ? "" : issue.path, issue.message));
            }
            return context_field_failure(field, "Context field '" + field.name + "' is not valid",
                                         std::move(errors));
        }
        *value = std::move(*parsed);
    }
    return std::nullopt;
}

JournaledContextValues journaled_context_values(const CommandContext& context) {
    JournaledContextValues out;
    if (!context.journaled_fields || !context.extra.is_object()) {
        return out;
    }
    Json kept = Json::object();
    std::vector<std::string> omitted;
    for (const std::string& name : context.journaled_fields->names) {
        const auto found = context.extra.find(name);
        if (found == context.extra.end() || found->is_null()) {
            continue;
        }
        if (canonical_json_bytes(*found) > max_journal_context_bytes) {
            omitted.push_back(name);
        } else {
            kept[name] = *found;
        }
    }
    if (!kept.empty()) {
        out.context = std::move(kept);
    }
    if (!omitted.empty()) {
        out.omitted = std::move(omitted);
    }
    return out;
}

} // namespace afd::detail
