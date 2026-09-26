// Private helpers for reading and writing afd types as JSON. Not installed.
//
// Reading never throws. Every reader records the first problem, with its path
// (`results[1].result.error.code: expected a string`), in a caller-owned error string.
#pragma once

#include "afd/batch.hpp"
#include "afd/errors.hpp"
#include "afd/json.hpp"
#include "afd/metadata.hpp"
#include "afd/pipeline.hpp"
#include "afd/result.hpp"
#include "afd/streaming.hpp"

#include <cstdint>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd::detail {

// --- reading ------------------------------------------------------------------------------

// One overload per wire type, declared before the templates below so they can find them.
// Each is defined next to its type's to_json.
bool read_value(const Json& value, const std::string& path, CommandError& out, std::string& error);
bool read_value(const Json& value, const std::string& path, Source& out, std::string& error);
bool read_value(const Json& value, const std::string& path, PlanStepStatus& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, PlanStepError& out, std::string& error);
bool read_value(const Json& value, const std::string& path, PlanStep& out, std::string& error);
bool read_value(const Json& value, const std::string& path, Alternative& out, std::string& error);
bool read_value(const Json& value, const std::string& path, WarningSeverity& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, Warning& out, std::string& error);
bool read_value(const Json& value, const std::string& path, ResultMetadata& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, CommandResult& out, std::string& error);
bool read_value(const Json& value, const std::string& path, BatchCommandResult& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, BatchSummary& out, std::string& error);
bool read_value(const Json& value, const std::string& path, BatchTiming& out, std::string& error);
bool read_value(const Json& value, const std::string& path, BatchWarning& out, std::string& error);
bool read_value(const Json& value, const std::string& path, BatchResult& out, std::string& error);
bool read_value(const Json& value, const std::string& path, StepConfidence& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, StepReasoning& out, std::string& error);
bool read_value(const Json& value, const std::string& path, PipelineWarning& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, PipelineSource& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, PipelineAlternative& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, PipelineMetadata& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, StepStatus& out, std::string& error);
bool read_value(const Json& value, const std::string& path, StepMetadata& out, std::string& error);
bool read_value(const Json& value, const std::string& path, StepResult& out, std::string& error);
bool read_value(const Json& value, const std::string& path, PipelineResult& out,
                std::string& error);
bool read_value(const Json& value, const std::string& path, StreamChunk& out, std::string& error);

inline void record(std::string& error, const std::string& path, std::string_view problem) {
    if (error.empty()) {
        error = (path.empty() ? std::string("(root)") : path) + ": " + std::string(problem);
    }
}

inline std::string child_path(const std::string& path, std::string_view key) {
    return path.empty() ? std::string(key) : path + "." + std::string(key);
}

inline std::string index_path(const std::string& path, std::size_t index) {
    return (path.empty() ? std::string("(root)") : path) + "[" + std::to_string(index) + "]";
}

bool read_value(const Json& value, const std::string& path, std::string& out, std::string& error);
bool read_value(const Json& value, const std::string& path, bool& out, std::string& error);
bool read_value(const Json& value, const std::string& path, double& out, std::string& error);
bool read_value(const Json& value, const std::string& path, std::int64_t& out, std::string& error);
bool read_value(const Json& value, const std::string& path, Json& out, std::string& error);

/// A JSON object: `details`, `undoArgs` and similar free-form maps.
bool read_object(const Json& value, const std::string& path, Json& out, std::string& error);

template <class T>
bool read_value(const Json& value, const std::string& path, std::vector<T>& out,
                std::string& error) {
    if (!value.is_array()) {
        record(error, path, "expected an array");
        return false;
    }
    out.clear();
    out.reserve(value.size());
    for (std::size_t i = 0; i < value.size(); ++i) {
        T item{};
        if (!read_value(value[i], index_path(path, i), item, error)) {
            return false;
        }
        out.push_back(std::move(item));
    }
    return true;
}

/// Reads the members of one JSON object. `null` members count as absent, as unset fields must be
/// omitted on the wire; `read_present` is the exception for fields where `null` is a value.
class ObjectReader {
public:
    ObjectReader(const Json& value, std::string path, std::string& error)
        : path_(std::move(path)), error_(error) {
        if (value.is_object()) {
            object_ = &value;
        } else {
            record(error_, path_, "expected an object");
        }
    }

    [[nodiscard]] bool ok() const noexcept { return object_ != nullptr && error_.empty(); }

    template <class T>
    void required(std::string_view key, T& out) {
        const Json* member = find(key, /*null_is_absent=*/true);
        if (member == nullptr) {
            if (object_ != nullptr) {
                record(error_, child_path(path_, key), "is required");
            }
            return;
        }
        read_value(*member, child_path(path_, key), out, error_);
    }

    template <class T>
    void optional(std::string_view key, std::optional<T>& out) {
        out.reset();
        const Json* member = find(key, /*null_is_absent=*/true);
        if (member == nullptr) {
            return;
        }
        T value{};
        if (read_value(*member, child_path(path_, key), value, error_)) {
            out = std::move(value);
        }
    }

    /// An optional free-form JSON object (`details`, `undoArgs`).
    void optional_object(std::string_view key, std::optional<Json>& out) {
        out.reset();
        const Json* member = find(key, /*null_is_absent=*/true);
        if (member == nullptr) {
            return;
        }
        Json value;
        if (read_object(*member, child_path(path_, key), value, error_)) {
            out = std::move(value);
        }
    }

    /// A field whose presence matters and where `null` is a value (`data`, `result`).
    void read_present(std::string_view key, std::optional<Json>& out) {
        out.reset();
        if (const Json* member = find(key, /*null_is_absent=*/false)) {
            out = *member;
        }
    }

    /// The members not named in `known`, as an object (for `[key: string]: unknown` types).
    [[nodiscard]] Json unknown_members(std::initializer_list<std::string_view> known) const {
        Json rest = Json::object();
        if (object_ == nullptr) {
            return rest;
        }
        for (auto it = object_->begin(); it != object_->end(); ++it) {
            bool is_known = false;
            for (std::string_view name : known) {
                is_known = is_known || it.key() == name;
            }
            if (!is_known) {
                rest[it.key()] = it.value();
            }
        }
        return rest;
    }

    [[nodiscard]] const std::string& path() const noexcept { return path_; }
    [[nodiscard]] std::string& error() noexcept { return error_; }

private:
    [[nodiscard]] const Json* find(std::string_view key, bool null_is_absent) const {
        if (object_ == nullptr) {
            return nullptr;
        }
        const auto it = object_->find(key);
        if (it == object_->end() || (null_is_absent && it->is_null())) {
            return nullptr;
        }
        return &*it;
    }

    const Json* object_ = nullptr;
    std::string path_;
    std::string& error_;
};

/// Runs `read_value` for a whole document: the public `T::from_json` entry point.
template <class T>
Expected<T> parse_document(const Json& value) {
    std::string error;
    T out{};
    if (!read_value(value, std::string(), out, error) || !error.empty()) {
        return unexpected(error.empty() ? std::string("(root): invalid value") : error);
    }
    return out;
}

// --- writing ------------------------------------------------------------------------------

inline void put(Json& object, const char* key, const std::optional<std::string>& value) {
    if (value) {
        object[key] = *value;
    }
}

inline void put(Json& object, const char* key, const std::optional<bool>& value) {
    if (value) {
        object[key] = *value;
    }
}

inline void put(Json& object, const char* key, const std::optional<double>& value) {
    if (value) {
        object[key] = wire::number(*value);
    }
}

inline void put(Json& object, const char* key, const std::optional<std::int64_t>& value) {
    if (value) {
        object[key] = *value;
    }
}

inline void put(Json& object, const char* key, const std::optional<Json>& value) {
    if (value) {
        object[key] = *value;
    }
}

template <class T>
void put(Json& object, const char* key, const std::optional<T>& value) {
    if (value) {
        object[key] = *value; // ADL to_json
    }
}

/// Copies `extra` members that do not collide with fields already written.
inline void merge_extra(Json& object, const Json& extra) {
    if (!extra.is_object()) {
        return;
    }
    for (auto it = extra.begin(); it != extra.end(); ++it) {
        if (!object.contains(it.key())) {
            object[it.key()] = it.value();
        }
    }
}

/// A number in JavaScript's `String(number)` form, for messages such as "timed out after 1500ms".
std::string format_number(double value);

} // namespace afd::detail
