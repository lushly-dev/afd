#include "detail/meta_keys.hpp"

#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/utf8.hpp"

namespace afd::detail {
namespace {

bool is_ascii_alpha(char c) noexcept {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

bool is_ascii_alnum(char c) noexcept {
    return is_ascii_alpha(c) || (c >= '0' && c <= '9');
}

char to_ascii_lower(char c) noexcept {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
}

std::string ascii_lower(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (const char c : text) {
        out.push_back(to_ascii_lower(c));
    }
    return out;
}

bool is_valid_prefix_label(std::string_view label) noexcept {
    if (label.empty() || !is_ascii_alpha(label.front()) || !is_ascii_alnum(label.back())) {
        return false;
    }
    for (const char c : label) {
        if (!is_ascii_alnum(c) && c != '-') {
            return false;
        }
    }
    return true;
}

bool is_valid_meta_name(std::string_view name) noexcept {
    if (name.empty() || !is_ascii_alnum(name.front()) || !is_ascii_alnum(name.back())) {
        return false;
    }
    for (const char c : name) {
        if (!is_ascii_alnum(c) && c != '-' && c != '_' && c != '.') {
            return false;
        }
    }
    return true;
}

} // namespace

bool is_valid_json_value(const Json& value, std::optional<std::size_t> max_depth) {
    std::vector<std::pair<const Json*, std::size_t>> stack;
    stack.emplace_back(&value, std::size_t{0});
    while (!stack.empty()) {
        const auto [node, depth] = stack.back();
        stack.pop_back();
        if (node->is_discarded() || node->is_binary()) {
            return false;
        }
        if (node->is_string()) {
            if (!is_valid_utf8(node->get_ref<const std::string&>())) {
                return false;
            }
        } else if (node->is_number_float()) {
            if (!std::isfinite(node->get<double>())) {
                return false;
            }
        } else if (node->is_object()) {
            const std::size_t next_depth = depth + 1U;
            if (max_depth && next_depth > *max_depth) {
                return false;
            }
            for (auto it = node->begin(); it != node->end(); ++it) {
                if (!is_valid_utf8(it.key())) {
                    return false;
                }
                stack.emplace_back(&it.value(), next_depth);
            }
        } else if (node->is_array()) {
            const std::size_t next_depth = depth + 1U;
            if (max_depth && next_depth > *max_depth) {
                return false;
            }
            for (const auto& item : *node) {
                stack.emplace_back(&item, next_depth);
            }
        }
    }
    return true;
}

std::optional<std::string> validate_meta_entry(std::string_view key, const Json& value,
                                               bool allow_ui) {
    if (!is_valid_utf8(key)) {
        return std::string("meta key is not valid UTF-8");
    }
    if (!is_valid_json_value(value)) {
        return "key '" + std::string(key) +
               "' holds a non-JSON value (non-finite number, binary node, or invalid UTF-8)";
    }
    if (key == "ui") {
        if (!allow_ui) {
            return "key 'ui' is not allowed on resource entries";
        }
        if (!value.is_object()) {
            return "key 'ui' must map to a JSON object";
        }
        const auto resource_uri = value.find("resourceUri");
        if (resource_uri != value.end()) {
            if (!resource_uri->is_string() ||
                !resource_uri->get_ref<const std::string&>().starts_with("ui://")) {
                return "key 'ui' field 'resourceUri' must be a string starting with 'ui://'";
            }
        }
        return std::nullopt;
    }

    const std::size_t slash = key.find('/');
    if (slash == std::string_view::npos || key.find('/', slash + 1U) != std::string_view::npos) {
        return "key '" + std::string(key) +
               "' must be a reverse-DNS prefixed key ('<prefix>/<name>') or 'ui'";
    }
    const std::string_view prefix = key.substr(0, slash);
    const std::string_view name = key.substr(slash + 1U);
    if (!is_valid_meta_name(name)) {
        return "key '" + std::string(key) + "' has an invalid name segment after '/'";
    }

    std::vector<std::string_view> labels;
    std::size_t start = 0;
    while (start <= prefix.size()) {
        const std::size_t dot = prefix.find('.', start);
        const std::string_view label = dot == std::string_view::npos
                                           ? prefix.substr(start)
                                           : prefix.substr(start, dot - start);
        if (!is_valid_prefix_label(label)) {
            return "key '" + std::string(key) + "' has an invalid prefix label";
        }
        labels.push_back(label);
        if (dot == std::string_view::npos) {
            break;
        }
        start = dot + 1U;
    }
    if (labels.size() < 2U) {
        return "key '" + std::string(key) + "' prefix must have at least two dot-separated labels";
    }

    const std::string lowered_prefix = ascii_lower(prefix);
    if (lowered_prefix == "dev.afd") {
        return "key '" + std::string(key) + "' uses the AFD-reserved prefix 'dev.afd/'";
    }
    const std::string second_label = ascii_lower(labels[1]);
    if (second_label == "modelcontextprotocol" || second_label == "mcp") {
        return "key '" + std::string(key) + "' uses an MCP-reserved prefix";
    }
    return std::nullopt;
}

std::optional<std::string> validate_meta_object(std::string_view owner, const Json& meta,
                                                bool allow_ui) {
    if (!meta.is_object()) {
        return std::string(owner) + " has invalid _meta: must be a JSON object";
    }
    for (auto it = meta.begin(); it != meta.end(); ++it) {
        if (auto reason = validate_meta_entry(it.key(), it.value(), allow_ui)) {
            return std::string(owner) + " has invalid _meta: " + *reason;
        }
    }
    return std::nullopt;
}

std::optional<std::string> validate_advertised_input_schema(std::string_view command_name,
                                                            const Json& schema) {
    if (!schema.is_object()) {
        return "Command '" + std::string(command_name) +
               "' has an invalid advertised_input_schema: must be a JSON object";
    }
    const auto type_it = schema.find("type");
    if (type_it == schema.end() || !type_it->is_string() ||
        type_it->get_ref<const std::string&>() != "object") {
        return "Command '" + std::string(command_name) +
               "' has an invalid advertised_input_schema: 'type' must be \"object\"";
    }
    if (!is_valid_json_value(schema)) {
        return "Command '" + std::string(command_name) +
               "' has an invalid advertised_input_schema: contains a non-JSON value (non-finite "
               "number, binary node, or invalid UTF-8)";
    }
    return std::nullopt;
}

} // namespace afd::detail
