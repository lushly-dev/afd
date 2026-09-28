#include "afd/schema.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <set>
#include <string_view>

#include "detail/json_io.hpp"

namespace afd {
namespace {

constexpr std::array<std::string_view, 10> annotation_keywords{
    "title",    "description", "examples", "$schema",   "$id",
    "$comment", "deprecated",  "readOnly", "writeOnly", "default"};

constexpr std::array<std::string_view, 17> validation_keywords{"type",
                                                               "properties",
                                                               "required",
                                                               "enum",
                                                               "items",
                                                               "minItems",
                                                               "maxItems",
                                                               "minLength",
                                                               "maxLength",
                                                               "minimum",
                                                               "maximum",
                                                               "exclusiveMinimum",
                                                               "exclusiveMaximum",
                                                               "additionalProperties",
                                                               "$ref",
                                                               "definitions",
                                                               "$defs"};

constexpr std::array<std::string_view, 7> type_names{"string", "number", "integer", "boolean",
                                                     "object", "array",  "null"};

// Bounds schema nesting at compile time and $ref chains at any time.
constexpr int max_schema_depth = 64;
constexpr int max_ref_chain = 32;
// Bounds the size of a failure report for hostile input.
constexpr std::size_t max_issues = 100;

template <std::size_t N>
bool contains(const std::array<std::string_view, N>& names, std::string_view name) {
    return std::find(names.begin(), names.end(), name) != names.end();
}

std::string join_path(const std::string& path, std::string_view segment) {
    return path.empty() ? std::string(segment) : path + "." + std::string(segment);
}

// Compile errors name schema locations as JSON Pointers ("#/properties/title/maxLength").
std::string join_pointer(const std::string& path, std::string_view segment) {
    return path.empty() ? std::string(segment) : path + "/" + std::string(segment);
}

std::string schema_path(const std::string& path) {
    return path.empty() ? std::string("#") : "#/" + path;
}

// Resolves a local JSON Pointer reference ("#/definitions/Priority") against `root`.
const Json* resolve_pointer(const Json& root, std::string_view ref) {
    if (ref == "#") {
        return &root;
    }
    if (ref.substr(0, 2) != "#/") {
        return nullptr;
    }
    const Json* node = &root;
    std::string_view rest = ref.substr(2);
    while (true) {
        const std::size_t slash = rest.find('/');
        std::string token(rest.substr(0, slash));
        // JSON Pointer escapes: ~1 is "/", ~0 is "~".
        for (std::size_t at = token.find("~1"); at != std::string::npos;
             at = token.find("~1", at)) {
            token.replace(at, 2, "/");
        }
        for (std::size_t at = token.find("~0"); at != std::string::npos;
             at = token.find("~0", at)) {
            token.replace(at, 2, "~");
        }
        if (!node->is_object()) {
            return nullptr;
        }
        const auto it = node->find(token);
        if (it == node->end()) {
            return nullptr;
        }
        node = &*it;
        if (slash == std::string_view::npos) {
            return node;
        }
        rest = rest.substr(slash + 1);
    }
}

// Follows $ref until a schema without one. Returns nullptr on a broken or cyclic chain.
const Json* follow_refs(const Json& root, const Json& schema) {
    const Json* current = &schema;
    for (int hops = 0; hops < max_ref_chain; ++hops) {
        if (!current->is_object()) {
            return current;
        }
        const auto ref = current->find("$ref");
        if (ref == current->end()) {
            return current;
        }
        if (!ref->is_string()) {
            return nullptr;
        }
        current = resolve_pointer(root, ref->get_ref<const std::string&>());
        if (current == nullptr) {
            return nullptr;
        }
    }
    return nullptr;
}

bool is_non_negative_integer(const Json& value) {
    if (value.is_number_unsigned()) {
        return true;
    }
    if (value.is_number_integer()) {
        return value.get<std::int64_t>() >= 0;
    }
    if (value.is_number_float()) {
        const double number = value.get<double>();
        return number >= 0 && std::trunc(number) == number;
    }
    return false;
}

// --- compile ------------------------------------------------------------------------------

// Checks what validation can reach from `schema`: its own keywords, and each referenced schema
// once. Definitions nothing references are ignored, as in JSON Schema, so a shared contract may
// carry output-only definitions that use keywords outside the subset.
using VisitedRefs = std::set<std::string>;

bool check_schema(const Json& root, const Json& schema, const std::string& path, int depth,
                  std::string& error, VisitedRefs& visited);

bool check_schema_map(const Json& root, const Json& map, const std::string& path, int depth,
                      std::string& error, VisitedRefs& visited) {
    if (!map.is_object()) {
        error = schema_path(path) + ": expected an object of schemas";
        return false;
    }
    for (auto it = map.begin(); it != map.end(); ++it) {
        if (!check_schema(root, it.value(), join_pointer(path, it.key()), depth + 1, error,
                          visited)) {
            return false;
        }
    }
    return true;
}

bool check_schema(const Json& root, const Json& schema, const std::string& path, int depth,
                  std::string& error, VisitedRefs& visited) {
    if (depth > max_schema_depth) {
        error = schema_path(path) + ": schema is nested deeper than " +
                std::to_string(max_schema_depth) + " levels";
        return false;
    }
    if (schema.is_boolean()) {
        return true;
    }
    if (!schema.is_object()) {
        error = schema_path(path) + ": a schema must be an object or a boolean";
        return false;
    }
    for (auto it = schema.begin(); it != schema.end(); ++it) {
        const std::string& key = it.key();
        const Json& value = it.value();
        const std::string here = join_pointer(path, key);
        if (contains(annotation_keywords, key)) {
            continue;
        }
        if (!contains(validation_keywords, key)) {
            error = schema_path(here) + ": unsupported JSON Schema keyword '" + key +
                    "' (afd-cpp enforces a subset; see afd/schema.hpp)";
            return false;
        }
        if (key == "type") {
            const auto valid_type = [](const Json& t) {
                return t.is_string() && contains(type_names, t.get_ref<const std::string&>());
            };
            const bool ok =
                valid_type(value) || (value.is_array() && !value.empty() &&
                                      std::all_of(value.begin(), value.end(), valid_type));
            if (!ok) {
                error = schema_path(here) + ": expected a JSON Schema type name or a list of them";
                return false;
            }
        } else if (key == "properties") {
            if (!check_schema_map(root, value, here, depth, error, visited)) {
                return false;
            }
        } else if (key == "definitions" || key == "$defs") {
            if (!value.is_object()) {
                error = schema_path(here) + ": expected an object of schemas";
                return false;
            }
        } else if (key == "required") {
            if (!value.is_array() || !std::all_of(value.begin(), value.end(),
                                                  [](const Json& n) { return n.is_string(); })) {
                error = schema_path(here) + ": expected an array of property names";
                return false;
            }
        } else if (key == "enum") {
            if (!value.is_array() || value.empty()) {
                error = schema_path(here) + ": expected a non-empty array";
                return false;
            }
        } else if (key == "items") {
            if (value.is_array()) {
                error = schema_path(here) +
                        ": tuple validation (an array of item schemas) is not supported";
                return false;
            }
            if (!check_schema(root, value, here, depth + 1, error, visited)) {
                return false;
            }
        } else if (key == "additionalProperties") {
            if (!value.is_boolean() &&
                !check_schema(root, value, here, depth + 1, error, visited)) {
                return false;
            }
        } else if (key == "minItems" || key == "maxItems" || key == "minLength" ||
                   key == "maxLength") {
            if (!is_non_negative_integer(value)) {
                error = schema_path(here) + ": expected a non-negative integer";
                return false;
            }
        } else if (key == "minimum" || key == "maximum" || key == "exclusiveMinimum" ||
                   key == "exclusiveMaximum") {
            if (!value.is_number()) {
                error = schema_path(here) + ": expected a number";
                return false;
            }
        } else if (key == "$ref") {
            if (!value.is_string()) {
                error = schema_path(here) + ": expected a string";
                return false;
            }
            const auto& ref = value.get_ref<const std::string&>();
            if (ref.substr(0, 1) != "#") {
                error = schema_path(here) + ": only local references (\"#/...\") are supported";
                return false;
            }
            const Json* target = follow_refs(root, schema);
            if (target == nullptr) {
                error = schema_path(here) + ": reference '" + ref + "' does not resolve";
                return false;
            }
            if (visited.insert(ref).second &&
                !check_schema(root, *target, ref.size() > 2 ? ref.substr(2) : std::string(),
                              depth + 1, error, visited)) {
                return false;
            }
        }
    }
    return true;
}

// --- validate -----------------------------------------------------------------------------

std::string received_name(const Json& value) {
    switch (value.type()) {
    case Json::value_t::null:
        return "null";
    case Json::value_t::boolean:
        return "boolean";
    case Json::value_t::string:
        return "string";
    case Json::value_t::array:
        return "array";
    case Json::value_t::object:
        return "object";
    case Json::value_t::number_integer:
    case Json::value_t::number_unsigned:
    case Json::value_t::number_float:
        return "number";
    default:
        return "unknown";
    }
}

bool matches_type(const Json& value, std::string_view type) {
    if (type == "string") {
        return value.is_string();
    }
    if (type == "number") {
        return value.is_number();
    }
    if (type == "integer") {
        if (value.is_number_integer()) {
            return true; // also covers unsigned
        }
        if (value.is_number_float()) {
            const double number = value.get<double>();
            return std::isfinite(number) && std::trunc(number) == number;
        }
        return false;
    }
    if (type == "boolean") {
        return value.is_boolean();
    }
    if (type == "object") {
        return value.is_object();
    }
    if (type == "array") {
        return value.is_array();
    }
    if (type == "null") {
        return value.is_null();
    }
    return false;
}

std::size_t code_points(const std::string& text) {
    std::size_t count = 0;
    for (const char c : text) {
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) {
            ++count;
        }
    }
    return count;
}

// A property's default: on the property itself (which may sit beside a $ref, as in
// {"$ref": "#/definitions/Priority", "default": "medium"}), else on the schema it references.
const Json* default_of(const Json& root, const Json& property) {
    if (property.is_object()) {
        if (const auto own = property.find("default"); own != property.end()) {
            return &*own;
        }
    }
    const Json* resolved = follow_refs(root, property);
    if (resolved != nullptr && resolved->is_object()) {
        if (const auto inherited = resolved->find("default"); inherited != resolved->end()) {
            return &*inherited;
        }
    }
    return nullptr;
}

std::string expected_type_of(const Json& root, const Json& schema) {
    const Json* resolved = follow_refs(root, schema);
    if (resolved == nullptr || !resolved->is_object()) {
        return "unknown";
    }
    const auto type = resolved->find("type");
    if (type != resolved->end() && type->is_string()) {
        return type->get<std::string>() == "integer" ? "int" : type->get<std::string>();
    }
    return "unknown";
}

class Validator {
public:
    Validator(const Json& root, std::vector<ValidationIssue>& issues)
        : root_(root), issues_(issues) {}

    Json run(const Json& raw_schema, const Json& value, const std::string& path) {
        const Json* schema = follow_refs(root_, raw_schema);
        if (schema == nullptr || schema->is_boolean()) {
            if (schema != nullptr && !schema->get<bool>()) {
                add(path, "Invalid input", "invalid_value");
            }
            return value;
        }

        if (const auto options = schema->find("enum"); options != schema->end()) {
            if (std::none_of(options->begin(), options->end(),
                             [&](const Json& option) { return option == value; })) {
                std::string listed;
                for (const Json& option : *options) {
                    listed += (listed.empty() ? "" : "|") + wire::serialize(option);
                }
                add(path, "Invalid option: expected one of " + listed, "invalid_value");
                return value;
            }
        }

        if (const auto type = schema->find("type"); type != schema->end()) {
            bool ok = false;
            std::string expected;
            const auto consider = [&](const Json& t) {
                const auto& name = t.get_ref<const std::string&>();
                ok = ok || matches_type(value, name);
                expected +=
                    (expected.empty() ? "" : "|") + (name == "integer" ? std::string("int") : name);
            };
            if (type->is_array()) {
                for (const Json& t : *type) {
                    consider(t);
                }
            } else {
                consider(*type);
            }
            if (!ok) {
                const std::string received = expected == "int" && value.is_number()
                                                 ? std::string("number")
                                                 : received_name(value);
                add(path, "Invalid input: expected " + expected + ", received " + received,
                    "invalid_type", expected);
                return value;
            }
        }

        if (value.is_string()) {
            check_string(*schema, value.get_ref<const std::string&>(), path);
            return value;
        }
        if (value.is_number()) {
            check_number(*schema, value.get<double>(), path);
            return value;
        }
        if (value.is_array()) {
            return check_array(*schema, value, path);
        }
        if (value.is_object()) {
            return check_object(*schema, value, path);
        }
        return value;
    }

private:
    void add(const std::string& path, std::string message, std::string code,
             std::optional<std::string> expected = std::nullopt) {
        if (issues_.size() < max_issues) {
            issues_.push_back({path.empty() ? std::string("(root)") : path, std::move(message),
                               std::move(code), std::move(expected)});
        }
    }

    void check_string(const Json& schema, const std::string& text, const std::string& path) {
        const std::size_t length = code_points(text);
        if (const auto min = schema.find("minLength");
            min != schema.end() && length < min->get<std::size_t>()) {
            add(path,
                "Too small: expected string to have >=" + wire::serialize(*min) + " characters",
                "too_small");
        }
        if (const auto max = schema.find("maxLength");
            max != schema.end() && length > max->get<std::size_t>()) {
            add(path, "Too big: expected string to have <=" + wire::serialize(*max) + " characters",
                "too_big");
        }
    }

    void check_number(const Json& schema, double number, const std::string& path) {
        const auto bound = [&](const char* key, bool fails_below, bool exclusive, const char* code,
                               const char* word, const char* op) {
            const auto it = schema.find(key);
            if (it == schema.end()) {
                return;
            }
            const double limit = it->get<double>();
            const bool fails = fails_below ? (exclusive ? number <= limit : number < limit)
                                           : (exclusive ? number >= limit : number > limit);
            if (fails) {
                add(path,
                    std::string(word) + ": expected number to be " + op + wire::serialize(*it),
                    code);
            }
        };
        bound("minimum", true, false, "too_small", "Too small", ">=");
        bound("exclusiveMinimum", true, true, "too_small", "Too small", ">");
        bound("maximum", false, false, "too_big", "Too big", "<=");
        bound("exclusiveMaximum", false, true, "too_big", "Too big", "<");
    }

    Json check_array(const Json& schema, const Json& value, const std::string& path) {
        if (const auto min = schema.find("minItems");
            min != schema.end() && value.size() < min->get<std::size_t>()) {
            add(path, "Too small: expected array to have >=" + wire::serialize(*min) + " items",
                "too_small");
        }
        if (const auto max = schema.find("maxItems");
            max != schema.end() && value.size() > max->get<std::size_t>()) {
            add(path, "Too big: expected array to have <=" + wire::serialize(*max) + " items",
                "too_big");
        }
        const auto items = schema.find("items");
        if (items == schema.end()) {
            return value;
        }
        Json parsed = Json::array();
        for (std::size_t i = 0; i < value.size(); ++i) {
            parsed.push_back(run(*items, value[i], join_path(path, std::to_string(i))));
        }
        return parsed;
    }

    Json check_object(const Json& schema, const Json& value, const std::string& path) {
        const auto properties = schema.find("properties");
        const auto required = schema.find("required");
        const auto additional = schema.find("additionalProperties");
        const bool has_properties = properties != schema.end() && properties->is_object();

        Json parsed = Json::object();
        if (has_properties) {
            for (auto it = properties->begin(); it != properties->end(); ++it) {
                const auto present = value.find(it.key());
                if (present != value.end()) {
                    parsed[it.key()] = run(it.value(), *present, join_path(path, it.key()));
                    continue;
                }
                if (const Json* fallback = default_of(root_, it.value())) {
                    parsed[it.key()] = *fallback;
                }
            }
        }

        if (required != schema.end()) {
            for (const Json& name_json : *required) {
                const auto& name = name_json.get_ref<const std::string&>();
                if (value.contains(name) || parsed.contains(name)) {
                    continue;
                }
                std::string expected = "unknown";
                if (has_properties) {
                    if (const auto declared = properties->find(name);
                        declared != properties->end()) {
                        expected = expected_type_of(root_, *declared);
                    }
                }
                add(join_path(path, name),
                    "Invalid input: expected " + expected + ", received undefined", "invalid_type",
                    expected);
            }
        }

        std::vector<std::string> unknown;
        for (auto it = value.begin(); it != value.end(); ++it) {
            if (has_properties && properties->contains(it.key())) {
                continue;
            }
            if (additional == schema.end()) {
                if (!has_properties) {
                    parsed[it.key()] = it.value(); // no declared shape: keep everything
                }
                continue; // declared shape: strip undeclared members, as Zod does
            }
            if (additional->is_boolean()) {
                if (additional->get<bool>()) {
                    parsed[it.key()] = it.value();
                } else {
                    unknown.push_back(it.key());
                }
                continue;
            }
            parsed[it.key()] = run(*additional, it.value(), join_path(path, it.key()));
        }
        if (!unknown.empty()) {
            std::string listed;
            for (const auto& key : unknown) {
                listed += (listed.empty() ? "" : ", ") + wire::serialize(Json(key));
            }
            add(path,
                std::string(unknown.size() == 1 ? "Unrecognized key: " : "Unrecognized keys: ") +
                    listed,
                "unrecognized_keys");
        }
        return parsed;
    }

    const Json& root_;
    std::vector<ValidationIssue>& issues_;
};

// TypeScript's extractSchemaInfo, for the top-level object shape.
void describe_fields(const Json& root, const Json& input, ValidationFailure& failure) {
    const Json* schema = follow_refs(root, root);
    if (schema == nullptr || !schema->is_object()) {
        return;
    }
    const auto properties = schema->find("properties");
    if (properties == schema->end() || !properties->is_object()) {
        return;
    }
    for (auto it = properties->begin(); it != properties->end(); ++it) {
        failure.expected_fields.push_back(it.key());
    }
    if (!input.is_object()) {
        return;
    }
    for (auto it = input.begin(); it != input.end(); ++it) {
        if (!properties->contains(it.key())) {
            failure.unexpected_fields.push_back(it.key());
        }
    }
    const auto required = schema->find("required");
    if (required == schema->end()) {
        return;
    }
    for (const auto& field : failure.expected_fields) {
        if (input.contains(field)) {
            continue;
        }
        const bool is_required = std::any_of(required->begin(), required->end(),
                                             [&](const Json& name) { return name == field; });
        const bool has_default = default_of(root, (*properties)[field]) != nullptr;
        if (is_required && !has_default) {
            failure.missing_fields.push_back(field);
        }
    }
}

std::string join(const std::vector<std::string>& items, std::string_view separator) {
    std::string out;
    for (const auto& item : items) {
        out += (out.empty() ? "" : std::string(separator)) + item;
    }
    return out;
}

} // namespace

Expected<CompiledSchema> CompiledSchema::compile(const Json& schema) {
    std::string error;
    VisitedRefs visited;
    if (!check_schema(schema, schema, "", 0, error, visited)) {
        return unexpected(error);
    }
    return CompiledSchema(std::make_shared<const Json>(schema));
}

Expected<Json, ValidationFailure> CompiledSchema::validate(const Json& input) const {
    std::vector<ValidationIssue> issues;
    Validator validator(*schema_, issues);
    Json parsed = validator.run(*schema_, input, "");
    if (issues.empty()) {
        return parsed;
    }
    ValidationFailure failure;
    failure.errors = std::move(issues);
    describe_fields(*schema_, input, failure);
    return unexpected(std::move(failure));
}

std::string format_validation_errors(const std::vector<ValidationIssue>& errors) {
    if (errors.empty()) {
        return "No validation errors";
    }
    if (errors.size() == 1) {
        const auto& error = errors.front();
        return error.path == "(root)" ? error.message : error.path + ": " + error.message;
    }
    std::string out;
    for (const auto& error : errors) {
        out += (out.empty() ? "" : "\n") + (error.path == "(root)"
                                                ? "- " + error.message
                                                : "- " + error.path + ": " + error.message);
    }
    return out;
}

CommandError validation_failure_error(const ValidationFailure& failure) {
    std::vector<std::string> parts;
    if (!failure.errors.empty()) {
        parts.push_back(format_validation_errors(failure.errors));
    }
    if (!failure.unexpected_fields.empty()) {
        parts.push_back("Unknown field(s): " + join(failure.unexpected_fields, ", "));
    }
    if (!failure.missing_fields.empty()) {
        parts.push_back("Missing required field(s): " + join(failure.missing_fields, ", "));
    }
    if (!failure.expected_fields.empty()) {
        parts.push_back("Expected fields: " + join(failure.expected_fields, ", "));
    }

    Json errors = Json::array();
    for (const auto& issue : failure.errors) {
        Json entry = {{"path", issue.path}, {"message", issue.message}, {"code", issue.code}};
        if (issue.expected) {
            entry["expected"] = *issue.expected;
        }
        errors.push_back(std::move(entry));
    }
    Json details = {{"errors", std::move(errors)}};
    if (!failure.expected_fields.empty()) {
        details["expectedFields"] = failure.expected_fields;
    }
    if (!failure.unexpected_fields.empty()) {
        details["unexpectedFields"] = failure.unexpected_fields;
    }
    if (!failure.missing_fields.empty()) {
        details["missingFields"] = failure.missing_fields;
    }
    return create_error(error_codes::VALIDATION_ERROR, "Input validation failed",
                        {.suggestion = join(parts, ". "), .details = std::move(details)});
}

} // namespace afd
