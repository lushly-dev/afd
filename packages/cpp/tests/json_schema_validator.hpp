// A self-contained JSON Schema 2020-12 evaluator for the schemas in spec/schema/*.json, shared by
// the tests that validate wire fixtures and vectors against them. Test-only, not installed.
//
// It implements the keywords those schemas use with their 2020-12 meaning. Any other keyword, or a
// `$ref` it cannot resolve, fails the test outright, when the schemas are loaded and again if met
// while validating: reported as an ordinary validation failure, it would flip the result of an
// enclosing `not`, `if` or `anyOf` instead of being noticed.
#pragma once

#include "afd/afd.hpp"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include <doctest.h>

namespace afd_test {

class SchemaRegistry {
public:
    /// Loads every schema in spec/schema (AFD_SCHEMA_DIR), keyed by file name and `$id`.
    static SchemaRegistry load() {
        SchemaRegistry reg;
        for (const char* file : {"error.json", "result.json", "output-envelope.json", "batch.json",
                                 "pipeline.json", "stream.json"}) {
            std::ifstream in(std::filesystem::path(AFD_SCHEMA_DIR) / file, std::ios::binary);
            const std::string text{std::istreambuf_iterator<char>(in),
                                   std::istreambuf_iterator<char>()};
            auto parsed = afd::parse_bounded(text);
            REQUIRE_MESSAGE(parsed.has_value(), file << ": " << parsed.error().message);
            const std::string id = parsed->at("$id").get<std::string>();
            reg.by_file_[file] = id;
            reg.by_id_[id] = std::move(*parsed);
        }
        for (const auto& [id, schema] : reg.by_id_) {
            reg.check_schema(id, schema, id + "#");
        }
        return reg;
    }

    /// The first problem `value` has against the schema in `file`, or `std::nullopt` if it passes.
    [[nodiscard]] std::optional<std::string> validate(const std::string& file,
                                                      const afd::Json& value) const {
        const std::string& id = by_file_.at(file);
        return validate_node(id, by_id_.at(id), value, "$");
    }

private:
    std::map<std::string, afd::Json> by_id_;
    std::map<std::string, std::string> by_file_;

    // Annotations, and keywords another keyword reads (`then` and `else` belong to `if`).
    static bool is_known_keyword(std::string_view key) {
        for (std::string_view known :
             {"$schema",     "$id",           "$comment", "$defs",      "title",
              "description", "examples",      "default",  "deprecated", "readOnly",
              "writeOnly",   "$ref",          "const",    "enum",       "type",
              "minLength",   "minProperties", "minItems", "minimum",    "maximum",
              "items",       "uniqueItems",   "required", "properties", "additionalProperties",
              "allOf",       "anyOf",         "oneOf",    "not",        "if",
              "then",        "else"}) {
            if (key == known) {
                return true;
            }
        }
        return false;
    }

    // Every keyword in `schema` and its subschemas is one this validator implements, every `type`
    // names a JSON type, and every `$ref` resolves. Fails the test on the first that is not.
    void check_schema(const std::string& current_id, const afd::Json& schema,
                      const std::string& where) const {
        if (schema.is_boolean()) {
            return;
        }
        REQUIRE_MESSAGE(schema.is_object(), where << ": a schema is an object or a boolean");
        for (auto it = schema.begin(); it != schema.end(); ++it) {
            REQUIRE_MESSAGE(is_known_keyword(it.key()),
                            where << ": the test validator does not support the keyword "
                                  << it.key());
        }
        if (const auto it = schema.find("$ref"); it != schema.end()) {
            REQUIRE_MESSAGE(it->is_string(), where << ": $ref is a string");
            REQUIRE_MESSAGE(resolve_ref(current_id, it->get<std::string>()).second != nullptr,
                            where << ": unresolved $ref " << it->get<std::string>());
        }
        if (const auto it = schema.find("type"); it != schema.end()) {
            const auto check_type = [&](const afd::Json& name) {
                REQUIRE_MESSAGE((name.is_string() && is_type_name(name.get<std::string>())),
                                where << ": unknown type " << name.dump());
            };
            if (it->is_array()) {
                for (const auto& name : *it) {
                    check_type(name);
                }
            } else {
                check_type(*it);
            }
        }
        for (const char* key : {"$defs", "properties"}) {
            if (const auto it = schema.find(key); it != schema.end()) {
                for (const auto& [name, sub] : it->items()) {
                    check_schema(current_id, sub, where + "/" + key + "/" + name);
                }
            }
        }
        for (const char* key : {"allOf", "anyOf", "oneOf"}) {
            if (const auto it = schema.find(key); it != schema.end()) {
                for (std::size_t i = 0; i < it->size(); ++i) {
                    check_schema(current_id, (*it)[i], where + "/" + key + "/" + std::to_string(i));
                }
            }
        }
        for (const char* key : {"additionalProperties", "items", "not", "if", "then", "else"}) {
            if (const auto it = schema.find(key); it != schema.end()) {
                check_schema(current_id, *it, where + "/" + key);
            }
        }
    }

    static bool is_type_name(std::string_view name) {
        for (std::string_view known :
             {"null", "boolean", "string", "array", "object", "number", "integer"}) {
            if (name == known) {
                return true;
            }
        }
        return false;
    }

    // The schema resource and node a `$ref` names, or a null node when it names none.
    [[nodiscard]] std::pair<std::string, const afd::Json*>
    resolve_ref(const std::string& current_id, const std::string& ref) const {
        const auto hash = ref.find('#');
        std::string target_id =
            hash == 0 ? current_id
                      : resolve_relative(current_id,
                                         hash == std::string::npos ? ref : ref.substr(0, hash));
        const std::string fragment =
            hash == std::string::npos ? std::string() : ref.substr(hash + 1);
        const auto root_it = by_id_.find(target_id);
        if (root_it == by_id_.end()) {
            return {std::move(target_id), nullptr};
        }
        return {std::move(target_id), resolve_pointer(root_it->second, fragment)};
    }

    static std::string resolve_relative(const std::string& base_id, const std::string& rel) {
        if (rel.find("://") != std::string::npos) {
            return rel;
        }
        const auto slash = base_id.rfind('/');
        return slash == std::string::npos ? rel : base_id.substr(0, slash + 1) + rel;
    }

    static const afd::Json* resolve_pointer(const afd::Json& root, std::string_view fragment) {
        if (fragment.empty()) {
            return &root;
        }
        if (fragment.front() != '/') {
            return nullptr;
        }
        const afd::Json* node = &root;
        std::string_view rest = fragment.substr(1);
        while (true) {
            const auto slash = rest.find('/');
            std::string token(rest.substr(0, slash));
            for (std::size_t pos = token.find("~1"); pos != std::string::npos;
                 pos = token.find("~1", pos + 1)) {
                token.replace(pos, 2, "/");
            }
            for (std::size_t pos = token.find("~0"); pos != std::string::npos;
                 pos = token.find("~0", pos + 1)) {
                token.replace(pos, 2, "~");
            }
            if (!node->is_object() || !node->contains(token)) {
                return nullptr;
            }
            node = &node->at(token);
            if (slash == std::string_view::npos) {
                return node;
            }
            rest = rest.substr(slash + 1);
        }
    }

    static bool matches_type(const afd::Json& value, std::string_view expected) {
        if (expected == "null")
            return value.is_null();
        if (expected == "boolean")
            return value.is_boolean();
        if (expected == "string")
            return value.is_string();
        if (expected == "array")
            return value.is_array();
        if (expected == "object")
            return value.is_object();
        if (expected == "number")
            return value.is_number();
        if (expected == "integer") {
            if (value.is_number_integer() || value.is_number_unsigned())
                return true;
            if (value.is_number_float()) {
                const double n = value.get<double>();
                return std::isfinite(n) && std::trunc(n) == n;
            }
            return false;
        }
        return false;
    }

    std::optional<std::string> validate_node(const std::string& current_id, const afd::Json& schema,
                                             const afd::Json& value,
                                             const std::string& path) const {
        if (schema.is_boolean()) {
            return schema.get<bool>() ? std::nullopt
                                      : std::optional<std::string>(path + ": schema is false");
        }
        if (!schema.is_object()) {
            return path + ": schema must be object or bool";
        }
        // `load` checked every schema already; this is the backstop for a schema it never saw.
        // The test fails outright, and the returned problem is only for a build without
        // exceptions, where FAIL records the failure and returns.
        for (auto it = schema.begin(); it != schema.end(); ++it) {
            if (!is_known_keyword(it.key())) {
                FAIL(path << ": the test validator does not support the keyword " << it.key());
                return path + ": unsupported keyword " + it.key();
            }
        }
        if (const auto it = schema.find("$ref"); it != schema.end()) {
            const std::string ref = it->get<std::string>();
            const auto [target_id, target] = resolve_ref(current_id, ref);
            if (target == nullptr) {
                FAIL(path << ": unresolved $ref " << ref);
                return path + ": unresolved $ref " + ref;
            }
            if (auto err = validate_node(target_id, *target, value, path)) {
                return err;
            }
        }
        if (const auto it = schema.find("const"); it != schema.end()) {
            if (value != *it) {
                return path + ": const mismatch";
            }
        }
        if (const auto it = schema.find("enum"); it != schema.end()) {
            bool found = false;
            for (const auto& item : *it) {
                if (item == value) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return path + ": enum mismatch";
            }
        }
        if (const auto it = schema.find("type"); it != schema.end()) {
            bool matched = false;
            if (it->is_string()) {
                matched = matches_type(value, it->get<std::string>());
            } else if (it->is_array()) {
                for (const auto& item : *it) {
                    if (matches_type(value, item.get<std::string>())) {
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) {
                return path + ": type mismatch";
            }
        }
        if (value.is_string()) {
            if (const auto it = schema.find("minLength"); it != schema.end()) {
                const auto& str = value.get_ref<const std::string&>();
                std::size_t code_points = 0;
                for (char ch : str) {
                    if ((static_cast<unsigned char>(ch) & 0xC0u) != 0x80u) {
                        ++code_points;
                    }
                }
                if (code_points < it->get<std::size_t>()) {
                    return path + ": minLength failed";
                }
            }
        }
        if (value.is_number()) {
            const double n = value.get<double>();
            if (const auto it = schema.find("minimum"); it != schema.end()) {
                if (n < it->get<double>())
                    return path + ": minimum failed";
            }
            if (const auto it = schema.find("maximum"); it != schema.end()) {
                if (n > it->get<double>())
                    return path + ": maximum failed";
            }
        }
        if (value.is_array()) {
            if (const auto it = schema.find("items"); it != schema.end()) {
                for (std::size_t i = 0; i < value.size(); ++i) {
                    if (auto err = validate_node(current_id, *it, value[i],
                                                 path + "[" + std::to_string(i) + "]")) {
                        return err;
                    }
                }
            }
            if (const auto it = schema.find("minItems"); it != schema.end()) {
                if (value.size() < it->get<std::size_t>()) {
                    return path + ": minItems failed";
                }
            }
            // JSON equality: 1 and 1.0 are the same item, and object key order does not matter.
            if (const auto it = schema.find("uniqueItems"); it != schema.end() && it->get<bool>()) {
                for (std::size_t i = 0; i < value.size(); ++i) {
                    for (std::size_t j = i + 1; j < value.size(); ++j) {
                        if (value[i] == value[j]) {
                            return path + ": uniqueItems failed at [" + std::to_string(i) +
                                   "] and [" + std::to_string(j) + "]";
                        }
                    }
                }
            }
        }
        if (value.is_object()) {
            if (const auto it = schema.find("required"); it != schema.end()) {
                for (const auto& req : *it) {
                    const std::string key = req.get<std::string>();
                    if (!value.contains(key)) {
                        return path + ": missing required property " + key;
                    }
                }
            }
            if (const auto it = schema.find("minProperties"); it != schema.end()) {
                if (value.size() < it->get<std::size_t>()) {
                    return path + ": minProperties failed";
                }
            }
            const auto props = schema.find("properties");
            const auto addl = schema.find("additionalProperties");
            for (const auto& [k, v] : value.items()) {
                if (props != schema.end() && props->contains(k)) {
                    if (auto err = validate_node(current_id, props->at(k), v, path + "." + k)) {
                        return err;
                    }
                } else if (addl != schema.end()) {
                    if (addl->is_boolean() && !addl->get<bool>()) {
                        return path + ": unexpected property " + k;
                    }
                    if (addl->is_object()) {
                        if (auto err = validate_node(current_id, *addl, v, path + "." + k)) {
                            return err;
                        }
                    }
                }
            }
        }
        if (const auto it = schema.find("allOf"); it != schema.end()) {
            for (const auto& branch : *it) {
                if (auto err = validate_node(current_id, branch, value, path)) {
                    return err;
                }
            }
        }
        if (const auto it = schema.find("anyOf"); it != schema.end()) {
            bool matched = false;
            for (const auto& branch : *it) {
                if (!validate_node(current_id, branch, value, path).has_value()) {
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                return path + ": anyOf matched no branch";
            }
        }
        if (const auto it = schema.find("oneOf"); it != schema.end()) {
            int matches = 0;
            for (const auto& branch : *it) {
                if (!validate_node(current_id, branch, value, path).has_value()) {
                    ++matches;
                }
            }
            if (matches != 1) {
                return path + ": oneOf matched " + std::to_string(matches) + " branches";
            }
        }
        if (const auto it = schema.find("if"); it != schema.end()) {
            const bool matched = !validate_node(current_id, *it, value, path).has_value();
            if (matched) {
                if (const auto then_it = schema.find("then"); then_it != schema.end()) {
                    if (auto err = validate_node(current_id, *then_it, value, path))
                        return err;
                }
            } else if (const auto else_it = schema.find("else"); else_it != schema.end()) {
                if (auto err = validate_node(current_id, *else_it, value, path))
                    return err;
            }
        }
        if (const auto it = schema.find("not"); it != schema.end()) {
            if (!validate_node(current_id, *it, value, path).has_value()) {
                return path + ": matched forbidden not schema";
            }
        }
        return std::nullopt;
    }
};

} // namespace afd_test
