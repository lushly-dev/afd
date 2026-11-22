// Round-trips every golden wire fixture in spec/wire (see spec/wire/README.md): parse it into
// the native types, serialize those back, and require the result to equal the file, key order
// aside. The same contract is enforced for TypeScript, Python and Rust.
#include "afd/afd.hpp"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

namespace fs = std::filesystem;

fs::path wire_dir() {
    return fs::path(AFD_WIRE_DIR);
}

std::vector<std::string> fixture_names() {
    std::vector<std::string> names;
    std::error_code error;
    for (fs::directory_iterator it(wire_dir(), error), end; !error && it != end;
         it.increment(error)) {
        if (it->path().extension() == ".json") {
            names.push_back(it->path().filename().string());
        }
    }
    std::sort(names.begin(), names.end());
    return names;
}

afd::Json load(const std::string& name) {
    std::ifstream in(wire_dir() / name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name << ": " << parsed.error().message);
    return *parsed;
}

template <class T>
T parse_as(const std::string& name, const afd::Json& original) {
    auto parsed = T::from_json(original);
    REQUIRE_MESSAGE(parsed.has_value(), name << ": " << parsed.error());
    return *parsed;
}

std::vector<afd::StreamChunk> parse_chunks(const std::string& name, const afd::Json& original) {
    REQUIRE(original.is_array());
    std::vector<afd::StreamChunk> chunks;
    for (const auto& item : original) {
        auto chunk = afd::stream_chunk_from_json(item);
        REQUIRE_MESSAGE(chunk.has_value(), name << ": " << chunk.error());
        chunks.push_back(*chunk);
    }
    return chunks;
}

// Parses `name` into its native type and serializes it back.
afd::Json round_trip(const std::string& name, const afd::Json& original) {
    if (name == "result-success-minimal.json" || name == "result-success-full.json" ||
        name == "result-failure.json") {
        return parse_as<afd::CommandResult>(name, original);
    }
    if (name == "batch-result.json") {
        return parse_as<afd::BatchResult>(name, original);
    }
    if (name == "pipeline-result.json") {
        return parse_as<afd::PipelineResult>(name, original);
    }
    if (name == "stream-chunks.json") {
        afd::Json out = afd::Json::array();
        for (const auto& chunk : parse_chunks(name, original)) {
            out.push_back(chunk);
        }
        return out;
    }
    FAIL("no C++ type mapping for spec/wire/" << name << "; every language must round-trip it");
    return {};
}

// Self-contained JSON Schema 2020-12 evaluator covering the keywords used by spec/schema/*.json.
struct SchemaRegistry {
    std::map<std::string, afd::Json> by_id;
    std::map<std::string, std::string> by_file;

    static SchemaRegistry load() {
        SchemaRegistry reg;
        for (const char* file : {"error.json", "result.json", "output-envelope.json", "batch.json",
                                 "pipeline.json", "stream.json"}) {
            std::ifstream in(fs::path(AFD_SCHEMA_DIR) / file, std::ios::binary);
            const std::string text{std::istreambuf_iterator<char>(in),
                                   std::istreambuf_iterator<char>()};
            auto parsed = afd::parse_bounded(text);
            REQUIRE_MESSAGE(parsed.has_value(), file << ": " << parsed.error().message);
            const std::string id = parsed->at("$id").get<std::string>();
            reg.by_file[file] = id;
            reg.by_id[id] = std::move(*parsed);
        }
        return reg;
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
        if (const auto it = schema.find("$ref"); it != schema.end()) {
            const std::string ref = it->get<std::string>();
            const auto hash = ref.find('#');
            const std::string target_id =
                hash == 0 ? current_id
                          : resolve_relative(current_id,
                                             hash == std::string::npos ? ref : ref.substr(0, hash));
            const std::string fragment =
                hash == std::string::npos ? std::string() : ref.substr(hash + 1);
            const auto root_it = by_id.find(target_id);
            if (root_it == by_id.end()) {
                return path + ": unresolved $ref " + ref;
            }
            const afd::Json* target = resolve_pointer(root_it->second, fragment);
            if (target == nullptr) {
                return path + ": unresolved pointer " + ref;
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

    std::optional<std::string> validate(const std::string& file, const afd::Json& value) const {
        const std::string& id = by_file.at(file);
        return validate_node(id, by_id.at(id), value, "$");
    }
};

} // namespace

TEST_CASE("every wire fixture round-trips") {
    const auto names = fixture_names();
    REQUIRE_MESSAGE(names.size() >= 6,
                    "expected the spec/wire fixtures in " << wire_dir().string());
    for (const auto& name : names) {
        CAPTURE(name);
        const afd::Json original = load(name);
        const afd::Json reencoded = round_trip(name, original);
        CHECK_MESSAGE(reencoded == original, name << "\nexpected: " << original.dump(2)
                                                  << "\nactual:   " << reencoded.dump(2));
    }
}

TEST_CASE("result-success-minimal carries only server metadata") {
    const auto result =
        parse_as<afd::CommandResult>("minimal", load("result-success-minimal.json"));
    CHECK(result.success);
    REQUIRE(result.data.has_value());
    CHECK(result.data->at("id") == "todo-1");
    REQUIRE(result.metadata.has_value());
    CHECK(result.metadata->trace_id == "trace-fixture");
    CHECK(result.metadata->command_version == "1.0.0");
    // The caller's kind; `agent` over MCP.
    CHECK(result.metadata->actor_kind == afd::ActorKind::agent);
    CHECK(result.metadata->extra == afd::Json::object());
    CHECK_FALSE(result.error.has_value());
}

TEST_CASE("result-success-full keeps every optional field and extra metadata") {
    const auto result = parse_as<afd::CommandResult>("full", load("result-success-full.json"));
    CHECK(result.confidence == doctest::Approx(0.92));
    REQUIRE(result.plan.has_value());
    REQUIRE(result.plan->size() == 2);
    CHECK(result.plan->at(0).status == afd::PlanStepStatus::complete);
    CHECK(result.plan->at(1).status == afd::PlanStepStatus::failed);
    REQUIRE(result.plan->at(1).depends_on.has_value());
    CHECK(result.plan->at(1).depends_on->at(0) == "validate");
    REQUIRE(result.warnings.has_value());
    CHECK(result.warnings->at(0).severity == afd::WarningSeverity::caution);
    REQUIRE(result.metadata.has_value());
    CHECK(result.metadata->actor_kind == afd::ActorKind::agent);
    CHECK(result.metadata->extra == afd::Json{{"region", "test"}});
    CHECK(result.undo_command == "todo-delete");
    REQUIRE(result.undo_args.has_value());
    CHECK(result.undo_args->at("id") == "todo-2");
}

TEST_CASE("result-failure carries the error and stamped metadata") {
    const auto result = parse_as<afd::CommandResult>("failure", load("result-failure.json"));
    CHECK_FALSE(result.success);
    CHECK_FALSE(result.data.has_value());
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == afd::error_codes::NOT_FOUND);
    CHECK(result.error->retryable == false);
    REQUIRE(result.error->details.has_value());
    CHECK(result.error->details->at("id") == "todo-42");
}

TEST_CASE("batch-result counts and confidence") {
    const auto batch = parse_as<afd::BatchResult>("batch", load("batch-result.json"));
    CHECK(batch.success);
    REQUIRE(batch.results.size() == 2);
    CHECK(batch.results[1].id == "second");
    CHECK(batch.results[1].index == 1);
    CHECK_FALSE(batch.results[1].result.success);
    CHECK(batch.summary.total == 2);
    CHECK(batch.summary.success_count == 1);
    CHECK(batch.summary.failure_count == 1);
    CHECK(batch.summary.skipped_count == 0);
    CHECK(batch.confidence == doctest::Approx(0.75));
    CHECK(batch.timing.started_at == "2026-01-01T00:00:00.000Z");
}

TEST_CASE("pipeline-result aliases and step indexes") {
    const auto pipeline = parse_as<afd::PipelineResult>("pipeline", load("pipeline-result.json"));
    REQUIRE(pipeline.steps.size() == 2);
    CHECK(pipeline.steps[0].alias == "first");
    CHECK_FALSE(pipeline.steps[1].alias.has_value());
    CHECK(pipeline.steps[1].status == afd::StepStatus::success);
    REQUIRE(pipeline.steps[1].metadata.has_value());
    CHECK(pipeline.steps[1].metadata->confidence == doctest::Approx(0.92));
    REQUIRE(pipeline.metadata.warnings.size() == 1);
    CHECK(pipeline.metadata.warnings[0].step_index == 1);
    CHECK(pipeline.metadata.warnings[0].code == "DUPLICATE_TITLE");
    CHECK(pipeline.metadata.sources.at(0).step_index == 1);
    CHECK(pipeline.metadata.completed_steps == 2);
}

TEST_CASE("stream-chunks has one of each chunk type") {
    const auto chunks = parse_chunks("stream", load("stream-chunks.json"));
    REQUIRE(chunks.size() == 4);
    REQUIRE(std::holds_alternative<afd::ProgressChunk>(chunks[0]));
    CHECK(std::get_if<afd::ProgressChunk>(&chunks[0])->progress == doctest::Approx(0.5));
    REQUIRE(std::holds_alternative<afd::DataChunk>(chunks[1]));
    CHECK(std::get_if<afd::DataChunk>(&chunks[1])->chunk_id == "chunk-0");
    REQUIRE(std::holds_alternative<afd::CompleteChunk>(chunks[2]));
    CHECK(std::get_if<afd::CompleteChunk>(&chunks[2])->total_chunks == 1);
    REQUIRE(std::holds_alternative<afd::ErrorChunk>(chunks[3]));
    CHECK(std::get_if<afd::ErrorChunk>(&chunks[3])->error.code == afd::error_codes::STREAM_ERROR);
}

TEST_CASE("every wire fixture validates against spec/schema/ (JSON Schema 2020-12)") {
    const auto schemas = SchemaRegistry::load();
    for (const auto& [fixture, schema] : std::vector<std::pair<std::string, std::string>>{
             {"result-success-minimal.json", "result.json"},
             {"result-success-full.json", "result.json"},
             {"result-failure.json", "result.json"},
             {"batch-result.json", "batch.json"},
             {"pipeline-result.json", "pipeline.json"}}) {
        const afd::Json original = load(fixture);
        const auto err = schemas.validate(schema, original);
        CHECK_MESSAGE(!err.has_value(), fixture << " vs " << schema << ": " << err.value_or(""));
    }
    const afd::Json chunks = load("stream-chunks.json");
    REQUIRE(chunks.is_array());
    for (std::size_t i = 0; i < chunks.size(); ++i) {
        const auto err = schemas.validate("stream.json", chunks[i]);
        CHECK_MESSAGE(!err.has_value(), "stream-chunks[" << i << "]: " << err.value_or(""));
    }

    // Negative cases: the schemas reject malformed results, errors and stream chunks.
    CHECK(schemas.validate("result.json", afd::Json{{"success", true}, {"confidence", 1.5}})
              .has_value());
    CHECK(schemas
              .validate("result.json", afd::Json{{"success", true},
                                                 {"error", {{"code", "E"}, {"message", "bad"}}}})
              .has_value());
    CHECK(schemas.validate("result.json", afd::Json{{"success", false}}).has_value());
    CHECK(schemas
              .validate("result.json", afd::Json{{"success", false},
                                                 {"data", afd::Json::object()},
                                                 {"error", {{"code", "E"}, {"message", "bad"}}}})
              .has_value());
    CHECK(schemas.validate("result.json", afd::Json{{"success", true}, {"unknownField", 1}})
              .has_value());
    CHECK(schemas.validate("error.json", afd::Json{{"message", "missing code"}}).has_value());
    CHECK(schemas.validate("stream.json", afd::Json{{"type", "unknown"}}).has_value());
}
