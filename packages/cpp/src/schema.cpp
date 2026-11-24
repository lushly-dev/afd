#include "afd/schema.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
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

// Bounds schema nesting at compile time, validation recursion at runtime, and $ref chains.
constexpr int max_schema_depth = 64;
constexpr int max_validation_depth = 128;
constexpr int max_ref_chain = 32;

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

// The definition a reference in the subset names (spec/validation.md): "#", or
// "#/$defs/<name>" and "#/definitions/<name>" with one JSON Pointer token, never a deeper pointer,
// which could reach into a nested `$id` subschema and resolve its references in the wrong
// resource. Returns nullptr outside the subset (see `in_ref_subset`) or when it does not resolve.
bool in_ref_subset(std::string_view ref) {
    if (ref == "#") {
        return true;
    }
    for (const std::string_view prefix : {"#/$defs/", "#/definitions/"}) {
        if (ref.substr(0, prefix.size()) == prefix) {
            const std::string_view name = ref.substr(prefix.size());
            return !name.empty() && name.find('/') == std::string_view::npos;
        }
    }
    return false;
}

const Json* resolve_pointer(const Json& root, std::string_view ref) {
    if (!in_ref_subset(ref)) {
        return nullptr;
    }
    if (ref == "#") {
        return &root;
    }
    const std::size_t slash = ref.find('/', 2);
    const std::string keyword(ref.substr(2, slash - 2));
    std::string token(ref.substr(slash + 1));
    // JSON Pointer escapes, each decoded once: ~1 is "/", ~0 is "~" ("~01" is "~1").
    for (std::size_t at = token.find("~1"); at != std::string::npos;
         at = token.find("~1", at + 1)) {
        token.replace(at, 2, "/");
    }
    for (std::size_t at = token.find("~0"); at != std::string::npos;
         at = token.find("~0", at + 1)) {
        token.replace(at, 2, "~");
    }
    if (!root.is_object()) {
        return nullptr;
    }
    const auto definitions = root.find(keyword);
    if (definitions == root.end() || !definitions->is_object()) {
        return nullptr;
    }
    const auto it = definitions->find(token);
    return it == definitions->end() ? nullptr : &*it;
}

// The schema resource `schema` belongs to: itself when it has its own string `$id` (Draft
// 2020-12) that is not a bare fragment, which draft-07 used as an anchor; else `base`, the
// resource around it. A local `$ref` resolves against its resource.
const Json& resource_of(const Json& base, const Json& schema) {
    if (schema.is_object()) {
        if (const auto id = schema.find("$id");
            id != schema.end() && id->is_string() &&
            !id->get_ref<const std::string&>().starts_with('#')) {
            return schema;
        }
    }
    return base;
}

// Follows $ref until a schema without one. Returns nullptr on a broken or cyclic chain. `base`
// is the resource of `schema` on entry and is left as the resource of the schema returned.
const Json* follow_refs(const Json*& base, const Json& schema) {
    const Json* current = &schema;
    for (int hops = 0; hops < max_ref_chain; ++hops) {
        if (!current->is_object()) {
            return current;
        }
        base = &resource_of(*base, *current);
        const auto ref = current->find("$ref");
        if (ref == current->end()) {
            return current;
        }
        if (!ref->is_string()) {
            return nullptr;
        }
        current = resolve_pointer(*base, ref->get_ref<const std::string&>());
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
        return std::isfinite(number) && number >= 0 && std::trunc(number) == number;
    }
    return false;
}

// Compare a size with a checked nonnegative integral bound without narrowing the bound.
// In particular, valid huge minima must fail and huge maxima must pass on wasm32 too.
int compare_size(std::size_t size, const Json& bound) {
    if (bound.is_number_float()) {
        const double number = bound.get<double>();
        // 2^digits is the first value outside size_t, exactly representable as a double.
        if (number >= std::ldexp(1.0, std::numeric_limits<std::size_t>::digits)) {
            return -1;
        }
        const auto limit = static_cast<std::size_t>(number);
        return size < limit ? -1 : size > limit ? 1 : 0;
    }
    const auto limit = bound.is_number_unsigned()
                           ? bound.get<std::uint64_t>()
                           : static_cast<std::uint64_t>(bound.get<std::int64_t>());
    return size < limit ? -1 : size > limit ? 1 : 0;
}

// --- compile ------------------------------------------------------------------------------

// Checks what validation can reach from `schema`: its own keywords, and each referenced schema
// once. Definitions nothing references are ignored, as in JSON Schema, so a shared contract may
// carry output-only definitions that use keywords outside the subset.
// The $ref targets already checked, by address, since the same reference text names a
// different target in each schema resource.
using VisitedRefs = std::set<const Json*>;

bool check_schema(const Json& root, const Json& schema, const std::string& path, int depth,
                  std::string& error, VisitedRefs& visited);

// Checks every `$ref` under `schema`, which may sit in a definition nothing references: each must
// be a local reference in the subset that resolves in its schema resource, as Python and Rust
// require at registration. Other keywords of an unreferenced definition are not
// checked, since validation never reaches them.
bool check_refs(const Json& outer, const Json& schema, const std::string& path, int depth,
                std::string& error) {
    if (!schema.is_object()) {
        return true;
    }
    if (depth > max_schema_depth) {
        error = schema_path(path) + ": schema is nested deeper than " +
                std::to_string(max_schema_depth) + " levels";
        return false;
    }
    const Json& root = resource_of(outer, schema);
    for (auto it = schema.begin(); it != schema.end(); ++it) {
        const std::string& key = it.key();
        const Json& value = it.value();
        const std::string here = join_pointer(path, key);
        if (key == "$ref") {
            if (!value.is_string() || !in_ref_subset(value.get_ref<const std::string&>())) {
                error = schema_path(here) +
                        ": reference is not '#', '#/$defs/<name>' or '#/definitions/<name>'";
                return false;
            }
            if (resolve_pointer(root, value.get_ref<const std::string&>()) == nullptr) {
                error = schema_path(here) + ": reference '" + value.get_ref<const std::string&>() +
                        "' does not resolve";
                return false;
            }
        } else if (value.is_array() && (key == "allOf" || key == "anyOf" || key == "oneOf" ||
                                        key == "items" || key == "prefixItems")) {
            for (std::size_t i = 0; i < value.size(); ++i) {
                if (!check_refs(root, value[i], join_pointer(here, std::to_string(i)), depth + 1,
                                error)) {
                    return false;
                }
            }
        } else if (value.is_object() &&
                   (key == "properties" || key == "patternProperties" || key == "$defs" ||
                    key == "definitions" || key == "dependentSchemas" || key == "dependencies")) {
            for (auto entry = value.begin(); entry != value.end(); ++entry) {
                if (!check_refs(root, entry.value(), join_pointer(here, entry.key()), depth + 1,
                                error)) {
                    return false;
                }
            }
        } else if (key == "items" || key == "additionalProperties" || key == "not" || key == "if" ||
                   key == "then" || key == "else" || key == "contains" || key == "propertyNames" ||
                   key == "additionalItems" || key == "unevaluatedItems" ||
                   key == "unevaluatedProperties") {
            if (!check_refs(root, value, here, depth + 1, error)) {
                return false;
            }
        }
    }
    return true;
}

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

bool check_schema(const Json& outer, const Json& schema, const std::string& path, int depth,
                  std::string& error, VisitedRefs& visited) {
    const Json& root = resource_of(outer, schema);
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
            for (auto entry = value.begin(); entry != value.end(); ++entry) {
                if (!check_refs(root, entry.value(), join_pointer(here, entry.key()), depth + 1,
                                error)) {
                    return false;
                }
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
            if (!in_ref_subset(ref)) {
                error = schema_path(here) + ": reference '" + ref +
                        "' is not '#', '#/$defs/<name>' or '#/definitions/<name>'";
                return false;
            }
            const Json* base = &root;
            const Json* target = follow_refs(base, schema);
            if (target == nullptr) {
                error = schema_path(here) + ": reference '" + ref + "' does not resolve";
                return false;
            }
            if (visited.insert(target).second &&
                !check_schema(*base, *target, ref.size() > 2 ? ref.substr(2) : std::string(),
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
    const Json* base = &root;
    const Json* resolved = follow_refs(base, property);
    if (resolved != nullptr && resolved->is_object()) {
        if (const auto inherited = resolved->find("default"); inherited != resolved->end()) {
            return &*inherited;
        }
    }
    return nullptr;
}

// Deep-copies a JSON value using an explicit heap stack so pass-through schema branches
// (boolean `true`, untyped `{}`, arrays without `items`, open objects) never recurse on the
// C++/Wasm call stack when copying deep subtrees (#2404).
Json copy_json_iterative(const Json& root) {
    if (!root.is_array() && !root.is_object()) {
        return root;
    }
    struct CopyFrame {
        const Json* source = nullptr;
        Json built;
        bool is_array = false;
        std::size_t next_index = 0;
        Json::const_iterator next_it{};
        std::string key_in_parent;
        bool parent_is_array = false;
    };
    const auto make_frame = [](const Json& source, std::string key_in_parent,
                               bool parent_is_array) {
        CopyFrame frame;
        frame.source = &source;
        frame.is_array = source.is_array();
        frame.built = frame.is_array ? Json::array() : Json::object();
        if (frame.is_array) {
            frame.built.get_ref<Json::array_t&>().reserve(source.size());
        } else {
            frame.next_it = source.begin();
        }
        frame.key_in_parent = std::move(key_in_parent);
        frame.parent_is_array = parent_is_array;
        return frame;
    };

    std::vector<CopyFrame> stack;
    stack.push_back(make_frame(root, std::string(), false));

    while (!stack.empty()) {
        CopyFrame& frame = stack.back();
        if (frame.is_array) {
            if (frame.next_index < frame.source->size()) {
                const Json& child = (*frame.source)[frame.next_index++];
                if (child.is_array() || child.is_object()) {
                    if (child.empty()) {
                        frame.built.push_back(child.is_array() ? Json::array() : Json::object());
                    } else {
                        stack.push_back(make_frame(child, std::string(), true));
                    }
                } else {
                    frame.built.push_back(child);
                }
                continue;
            }
        } else {
            if (frame.next_it != frame.source->end()) {
                const auto it = frame.next_it++;
                const Json& child = it.value();
                if (child.is_array() || child.is_object()) {
                    if (child.empty()) {
                        frame.built[it.key()] = child.is_array() ? Json::array() : Json::object();
                    } else {
                        stack.push_back(make_frame(child, it.key(), false));
                    }
                } else {
                    frame.built[it.key()] = child;
                }
                continue;
            }
        }

        Json finished = std::move(frame.built);
        std::string key = std::move(frame.key_in_parent);
        const bool parent_is_array = frame.parent_is_array;
        stack.pop_back();
        if (stack.empty()) {
            return finished;
        }
        if (parent_is_array) {
            stack.back().built.push_back(std::move(finished));
        } else {
            stack.back().built[std::move(key)] = std::move(finished);
        }
    }
    return Json();
}

class Validator {
public:
    Validator(const Json& root, std::vector<ValidationIssue>& issues)
        : root_(&root), issues_(issues) {}

    // Iterative explicit-stack validation: keeps O(1) C++/Wasm call-stack depth even at
    // max_validation_depth (128), avoiding Emscripten's 64 KiB stack overflow (#1719).
    Json run(const Json& raw_schema, const Json& value) {
        Json root_result;
        std::vector<Frame> stack;

        const auto deliver = [&](Target target, Json result) {
            switch (target) {
            case Target::root:
                root_result = std::move(result);
                return;
            case Target::array_push:
                stack.back().parsed.push_back(std::move(result));
                return;
            case Target::object_key:
                stack.back().parsed[std::move(stack.back().pending_key)] = std::move(result);
                return;
            case Target::discard:
                return;
            }
        };

        const auto enter = [&](const Json* resource, const Json& current_schema,
                               const Json& current_value, std::string current_path, bool is_absent,
                               int depth, Target target) {
            if (depth > max_validation_depth) {
                add(current_path,
                    "Too deep: input exceeds maximum validation depth of " +
                        std::to_string(max_validation_depth),
                    "too_deep");
                deliver(target, nullptr);
                return;
            }
            const Json* schema = follow_refs(resource, current_schema);
            if (schema == nullptr || schema->is_boolean()) {
                // A boolean schema (spec/validation.md): `false` is `not: {}`, which no value
                // satisfies, so its issue is TypeScript's for `z.never()`.
                if (schema != nullptr && !schema->get<bool>()) {
                    const std::string received =
                        is_absent ? "undefined" : received_name(current_value);
                    add(current_path, "Invalid input: expected never, received " + received,
                        "invalid_type", "never");
                    deliver(target, nullptr);
                    return;
                }
                if (is_absent) {
                    add_missing_required(current_path);
                    deliver(target, nullptr);
                    return;
                }
                deliver(target, copy_json_iterative(current_value));
                return;
            }

            if (const auto options = schema->find("enum"); options != schema->end()) {
                if (is_absent ||
                    std::none_of(options->begin(), options->end(),
                                 [&](const Json& option) { return option == current_value; })) {
                    std::string listed;
                    for (const Json& option : *options) {
                        listed += (listed.empty() ? "" : "|") + wire::serialize(option);
                    }
                    add(current_path,
                        (options->size() == 1 ? "Invalid input: expected "
                                              : "Invalid option: expected one of ") +
                            listed,
                        "invalid_value");
                    deliver(target, nullptr);
                    return;
                }
            }

            if (const auto type = schema->find("type"); type != schema->end()) {
                bool ok = false;
                std::string expected;
                std::size_t non_null_types = 0;
                const auto consider = [&](const Json& t) {
                    const auto& name = t.get_ref<const std::string&>();
                    ok = ok || (!is_absent && matches_type(current_value, name));
                    if (name != "null") {
                        ++non_null_types;
                        expected =
                            name == "integer"
                                ? (!is_absent && current_value.is_number() ? "int" : "number")
                                : name;
                    }
                };
                if (type->is_array()) {
                    for (const Json& t : *type) {
                        consider(t);
                    }
                } else {
                    consider(*type);
                }
                if (!ok) {
                    if (non_null_types > 1) {
                        add(current_path, "Invalid input", "invalid_union");
                    } else {
                        if (expected.empty()) {
                            expected = "null";
                        }
                        const std::string received =
                            is_absent ? "undefined" : received_name(current_value);
                        add(current_path,
                            "Invalid input: expected " + expected + ", received " + received,
                            "invalid_type", expected);
                    }
                    deliver(target, nullptr);
                    return;
                }
            }
            if (is_absent) {
                add_missing_required(current_path);
                deliver(target, nullptr);
                return;
            }

            if (current_value.is_string()) {
                check_string(*schema, current_value.get_ref<const std::string&>(), current_path);
                deliver(target, current_value);
                return;
            }
            if (current_value.is_number()) {
                check_number(*schema, current_value.get<double>(), current_path);
                deliver(target, current_value);
                return;
            }
            if (current_value.is_array()) {
                const auto items = schema->find("items");
                if (items == schema->end()) {
                    check_array_bounds(*schema, current_value.size(), current_path);
                    deliver(target, copy_json_iterative(current_value));
                    return;
                }
                Frame array_frame;
                array_frame.kind = Frame::Kind::array;
                array_frame.target = target;
                array_frame.resource = resource;
                array_frame.schema = schema;
                array_frame.value = &current_value;
                array_frame.path = std::move(current_path);
                array_frame.depth = depth;
                array_frame.items_schema = &*items;
                array_frame.parsed = Json::array();
                stack.push_back(std::move(array_frame));
                return;
            }
            if (current_value.is_object()) {
                const auto properties = schema->find("properties");
                const auto required = schema->find("required");
                const auto additional = schema->find("additionalProperties");
                const bool has_properties = properties != schema->end() && properties->is_object();

                Frame object_frame;
                object_frame.kind = Frame::Kind::object;
                object_frame.target = target;
                object_frame.resource = resource;
                object_frame.schema = schema;
                object_frame.value = &current_value;
                object_frame.path = std::move(current_path);
                object_frame.depth = depth;
                object_frame.properties = has_properties ? &*properties : nullptr;
                object_frame.required = required != schema->end() ? &*required : nullptr;
                object_frame.additional = additional != schema->end() ? &*additional : nullptr;
                if (object_frame.properties != nullptr) {
                    object_frame.prop_it = object_frame.properties->begin();
                }
                object_frame.val_it = current_value.begin();
                object_frame.parsed = Json::object();
                stack.push_back(std::move(object_frame));
                return;
            }
            deliver(target, current_value);
        };

        enter(root_, raw_schema, value, "", false, 0, Target::root);

        while (!stack.empty()) {
            Frame& frame = stack.back();
            if (frame.kind == Frame::Kind::array) {
                if (frame.next_index < frame.value->size()) {
                    const std::size_t index = frame.next_index++;
                    const Json* items_schema = frame.items_schema;
                    const Json* item_value = &(*frame.value)[index];
                    std::string child_path = join_path(frame.path, std::to_string(index));
                    const Json* resource = frame.resource;
                    const int child_depth = frame.depth + 1;
                    enter(resource, *items_schema, *item_value, std::move(child_path), false,
                          child_depth, Target::array_push);
                    continue;
                }
                check_array_bounds(*frame.schema, frame.value->size(), frame.path);
                Json finished = std::move(frame.parsed);
                const Target target = frame.target;
                stack.pop_back();
                deliver(target, std::move(finished));
                continue;
            }

            if (frame.phase == Frame::Phase::properties) {
                bool pushed = false;
                while (frame.properties != nullptr && frame.prop_it != frame.properties->end()) {
                    const auto it = frame.prop_it++;
                    const auto present = frame.value->find(it.key());
                    if (present != frame.value->end()) {
                        frame.pending_key = it.key();
                        const Json* prop_schema = &it.value();
                        const Json* prop_value = &*present;
                        std::string child_path = join_path(frame.path, it.key());
                        const Json* resource = frame.resource;
                        const int child_depth = frame.depth + 1;
                        enter(resource, *prop_schema, *prop_value, std::move(child_path), false,
                              child_depth, Target::object_key);
                        pushed = true;
                        break;
                    }
                    if (const Json* fallback = default_of(*frame.resource, it.value())) {
                        frame.parsed[it.key()] = copy_json_iterative(*fallback);
                    }
                }
                if (pushed) {
                    continue;
                }
                frame.phase = Frame::Phase::required;
            }

            if (frame.phase == Frame::Phase::required) {
                bool pushed = false;
                while (frame.required != nullptr && frame.req_index < frame.required->size()) {
                    const auto& name =
                        (*frame.required)[frame.req_index++].get_ref<const std::string&>();
                    if (frame.value->contains(name) || frame.parsed.contains(name)) {
                        continue;
                    }
                    const auto declared = frame.properties != nullptr ? frame.properties->find(name)
                                                                      : frame.schema->end();
                    if (frame.properties != nullptr && declared != frame.properties->end()) {
                        const Json* declared_schema = &*declared;
                        std::string child_path = join_path(frame.path, name);
                        const Json* resource = frame.resource;
                        const int child_depth = frame.depth + 1;
                        enter(resource, *declared_schema, null_json_, std::move(child_path), true,
                              child_depth, Target::discard);
                        pushed = true;
                        break;
                    }
                    add_missing_required(join_path(frame.path, name));
                }
                if (pushed) {
                    continue;
                }
                frame.phase = Frame::Phase::additional;
            }

            bool pushed = false;
            while (frame.val_it != frame.value->end()) {
                const auto it = frame.val_it++;
                if (frame.properties != nullptr && frame.properties->contains(it.key())) {
                    continue;
                }
                if (frame.additional == nullptr) {
                    if (frame.properties == nullptr) {
                        frame.parsed[it.key()] =
                            copy_json_iterative(it.value()); // no declared shape: keep everything
                    }
                    continue; // declared shape: strip undeclared members, as Zod does
                }
                if (frame.additional->is_boolean()) {
                    if (frame.additional->get<bool>()) {
                        frame.parsed[it.key()] = copy_json_iterative(it.value());
                    } else {
                        frame.unknown.push_back(it.key());
                    }
                    continue;
                }
                frame.pending_key = it.key();
                const Json* add_schema = frame.additional;
                const Json* add_value = &it.value();
                std::string child_path = join_path(frame.path, it.key());
                const Json* resource = frame.resource;
                const int child_depth = frame.depth + 1;
                enter(resource, *add_schema, *add_value, std::move(child_path), false, child_depth,
                      Target::object_key);
                pushed = true;
                break;
            }
            if (pushed) {
                continue;
            }

            if (!frame.unknown.empty()) {
                std::string listed;
                for (const auto& key : frame.unknown) {
                    listed += (listed.empty() ? "" : ", ") + wire::serialize(Json(key));
                }
                add(frame.path,
                    std::string(frame.unknown.size() == 1 ? "Unrecognized key: "
                                                          : "Unrecognized keys: ") +
                        listed,
                    "unrecognized_keys");
            }
            Json finished = std::move(frame.parsed);
            const Target target = frame.target;
            stack.pop_back();
            deliver(target, std::move(finished));
        }

        return root_result;
    }

private:
    enum class Target { root, array_push, object_key, discard };

    struct Frame {
        enum class Kind { array, object };
        enum class Phase { properties, required, additional };

        Kind kind = Kind::object;
        Target target = Target::root;
        const Json* resource = nullptr;
        const Json* schema = nullptr;
        const Json* value = nullptr;
        std::string path;
        int depth = 0;

        // Array state.
        const Json* items_schema = nullptr;
        std::size_t next_index = 0;

        // Object state.
        Phase phase = Phase::properties;
        const Json* properties = nullptr;
        const Json* required = nullptr;
        const Json* additional = nullptr;
        Json::const_iterator prop_it{};
        std::size_t req_index = 0;
        Json::const_iterator val_it{};
        std::string pending_key;
        std::vector<std::string> unknown;

        Json parsed;
    };

    void add(const std::string& path, std::string message, std::string code,
             std::optional<std::string> expected = std::nullopt) {
        issues_.push_back({path.empty() ? std::string("(root)") : path, std::move(message),
                           std::move(code), std::move(expected)});
    }

    void add_missing_required(const std::string& path) {
        add(path, "Invalid input: expected nonoptional, received undefined", "invalid_type",
            "nonoptional");
    }

    void check_string(const Json& schema, const std::string& text, const std::string& path) {
        const std::size_t length = code_points(text);
        if (const auto min = schema.find("minLength");
            min != schema.end() && compare_size(length, *min) < 0) {
            add(path,
                "Too small: expected string to have >=" + wire::serialize(*min) + " characters",
                "too_small");
        }
        if (const auto max = schema.find("maxLength");
            max != schema.end() && compare_size(length, *max) > 0) {
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

    void check_array_bounds(const Json& schema, std::size_t size, const std::string& path) {
        if (const auto min = schema.find("minItems");
            min != schema.end() && compare_size(size, *min) < 0) {
            add(path, "Too small: expected array to have >=" + wire::serialize(*min) + " items",
                "too_small");
        }
        if (const auto max = schema.find("maxItems");
            max != schema.end() && compare_size(size, *max) > 0) {
            add(path, "Too big: expected array to have <=" + wire::serialize(*max) + " items",
                "too_big");
        }
    }

    const Json* root_;
    const Json null_json_{};
    std::vector<ValidationIssue>& issues_;
};

// TypeScript's extractSchemaInfo, for the top-level object shape.
void describe_fields(const Json& root, const Json& input, ValidationFailure& failure) {
    const Json* base = &root;
    const Json* schema = follow_refs(base, root);
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
        const bool has_default = default_of(*base, (*properties)[field]) != nullptr;
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
    return CompiledSchema(std::make_shared<const Json>(copy_json_iterative(schema)));
}

Expected<Json, ValidationFailure> CompiledSchema::validate(const Json& input,
                                                           std::size_t max_issues) const {
    const std::size_t effective_limit =
        max_issues == 0 ? default_max_validation_issues : max_issues;
    std::vector<ValidationIssue> issues;
    Validator validator(*schema_, issues);
    Json parsed = validator.run(*schema_, input);
    if (issues.empty()) {
        return parsed;
    }
    ValidationFailure failure;
    if (issues.size() > effective_limit) {
        failure.total_errors = issues.size();
        failure.limit = effective_limit;
        failure.truncated = true;
        issues.resize(effective_limit);
    }
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
    if (failure.truncated) {
        const std::size_t shown = failure.limit.value_or(failure.errors.size());
        parts.push_back("Showing first " + std::to_string(shown) +
                        " validation issues; fix these and retry");
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
    if (failure.truncated) {
        details["truncated"] = true;
        details["limit"] = failure.limit.value_or(failure.errors.size());
        if (failure.total_errors) {
            details["totalErrors"] = *failure.total_errors;
        }
    }
    return create_error(error_codes::VALIDATION_ERROR, "Input validation failed",
                        {.suggestion = join(parts, ". "), .details = std::move(details)});
}

} // namespace afd
