// Per-call costs of the registry, DirectClient, batch, pipeline and wire helpers (issue #340).
// Usage: afd_benchmarks [filter]. Runs every case whose name contains `filter`, and prints the
// median and fastest nanoseconds per operation over five batches, and the batch size.
#include "afd/afd.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "harness.hpp"

namespace {

using afd_bench::run_case;

// Adds `count` trivial commands named `bench-command-<suffix>`, the first `bench-command-aaaa`.
bool register_trivial(afd::CommandRegistry& registry, int count) {
    for (int index = 0; index < count; ++index) {
        std::string suffix(4, 'a');
        int remaining = index;
        for (char& letter : suffix) {
            letter = static_cast<char>('a' + remaining % 26);
            remaining /= 26;
        }
        const auto problem =
            registry.register_command({.name = "bench-command-" + suffix,
                                       .description = "Benchmark command",
                                       .handler = [](const afd::Json&, afd::CommandContext&) {
                                           return afd::success(nullptr);
                                       }});
        if (problem) {
            std::fprintf(stderr, "%s\n", problem->c_str());
            return false;
        }
    }
    return true;
}

// An object of `count` required string properties, and an input that satisfies it.
std::pair<afd::Json, afd::Json> string_schema(int count) {
    afd::Json properties = afd::Json::object();
    afd::Json required = afd::Json::array();
    afd::Json input = afd::Json::object();
    for (int index = 0; index < count; ++index) {
        const std::string key = "field" + std::to_string(index);
        properties[key] = {{"type", "string"}, {"maxLength", 64}};
        required.push_back(key);
        input[key] = "value " + std::to_string(index);
    }
    return {{{"type", "object"}, {"properties", properties}, {"required", required}}, input};
}

// A todo-like list whose compact serialization is at least `bytes` long.
afd::Json payload(std::size_t bytes) {
    afd::Json items = afd::Json::array();
    std::size_t size = 0;
    for (int index = 0; size < bytes; ++index) {
        afd::Json item = {{"id", "todo-" + std::to_string(index)},
                          {"title", "Benchmark item " + std::to_string(index)},
                          {"completed", index % 2 == 0},
                          {"priority", index % 5}};
        size += afd::wire::serialize(item).size() + 1;
        items.push_back(std::move(item));
    }
    return {{"items", items}};
}

bool all_succeeded(const afd::BatchResult& result, std::size_t count) {
    return result.success && result.summary.success_count == static_cast<std::int64_t>(count);
}

bool all_succeeded(const afd::PipelineResult& result, std::size_t count) {
    return result.metadata.completed_steps == static_cast<std::int64_t>(count);
}

} // namespace

int main(int argc, char** argv) {
    const std::string_view filter = argc > 1 ? argv[1] : "";
    bool ok = true;
    std::printf("%-40s %14s %14s %8s\n", "case", "median_ns/op", "min_ns/op", "batch");

    // Dispatch: lookup, exposure, validation, handler and result metadata.
    {
        afd::CommandRegistry registry;
        ok = register_trivial(registry, 1) && ok;
        ok = run_case(filter, "execute/trivial",
                      [&] { return registry.execute("bench-command-aaaa").success; }) &&
             ok;
    }
    {
        afd::CommandRegistry registry({.middleware = afd::default_middleware(
                                           {.logging = std::nullopt, .timing = std::nullopt})});
        ok = register_trivial(registry, 1) && ok;
        ok = run_case(filter, "execute/trace_id_middleware",
                      [&] { return registry.execute("bench-command-aaaa").success; }) &&
             ok;
    }
    {
        // Logging goes to a discarding sink, so this measures formatting, not terminal output.
        afd::CommandRegistry registry(
            {.middleware = afd::default_middleware(
                 {.logging = afd::LoggingOptions{.log = [](std::string_view) {}}})});
        ok = register_trivial(registry, 1) && ok;
        ok = run_case(filter, "execute/default_middleware",
                      [&] { return registry.execute("bench-command-aaaa").success; }) &&
             ok;
    }
    {
        auto registry = std::make_shared<afd::CommandRegistry>();
        ok = register_trivial(*registry, 1) && ok;
        const afd::DirectClient client(registry);
        ok = run_case(filter, "direct_client/call",
                      [&] { return client.call("bench-command-aaaa").success; }) &&
             ok;
    }

    // Validation: schemas of 3, 20 and 100 required string properties, through `execute`.
    for (const int count : {3, 20, 100}) {
        auto [schema, input] = string_schema(count);
        afd::CommandRegistry registry;
        const auto problem =
            registry.register_command({.name = "bench-validate",
                                       .description = "Validation benchmark",
                                       .input_schema = std::move(schema),
                                       .handler = [](const afd::Json&, afd::CommandContext&) {
                                           return afd::success(nullptr);
                                       }});
        if (problem) {
            std::fprintf(stderr, "%s\n", problem->c_str());
            return 1;
        }
        ok = run_case(filter, "execute/validate/string_properties=" + std::to_string(count),
                      [&] { return registry.execute("bench-validate", input).success; }) &&
             ok;
    }

    // A registry of 1,000 commands: dispatch, `get` and `list`.
    {
        afd::CommandRegistry registry;
        ok = register_trivial(registry, 1000) && ok;
        ok = run_case(filter, "registry_1000/execute",
                      [&] { return registry.execute("bench-command-aaaa").success; }) &&
             ok;
        ok = run_case(filter, "registry_1000/get",
                      [&] { return registry.get("bench-command-aaaa") != nullptr; }) &&
             ok;
        ok = run_case(filter, "registry_1000/list",
                      [&] { return registry.list().size() == 1000; }) &&
             ok;
    }

    // Batch and pipeline: one operation is the whole batch or pipeline of N commands.
    {
        afd::CommandRegistry registry;
        ok = register_trivial(registry, 1) && ok;
        const auto problem = registry.register_command(
            {.name = "bench-echo",
             .description = "Returns its input",
             .input_schema = {{"type", "object"},
                              {"properties", {{"value", {{"type", "integer"}}}}}},
             .handler = [](const afd::Json& input, afd::CommandContext&) {
                 return afd::success(input);
             }});
        if (problem) {
            std::fprintf(stderr, "%s\n", problem->c_str());
            return 1;
        }
        for (const std::size_t count : {std::size_t{1}, std::size_t{10}, std::size_t{100}}) {
            std::vector<afd::BatchCommand> commands(
                count, {.command = "bench-command-aaaa", .input = afd::Json::object()});
            const auto batch = afd::create_batch_request(std::move(commands));
            ok = run_case(filter, "execute_batch/n=" + std::to_string(count),
                          [&] { return all_succeeded(registry.execute_batch(batch), count); }) &&
                 ok;

            // Each step after the first reads the previous step's output.
            std::vector<afd::PipelineStep> steps;
            steps.push_back({.command = "bench-echo", .input = afd::Json{{"value", 1}}});
            while (steps.size() < count) {
                steps.push_back(
                    {.command = "bench-echo", .input = afd::Json{{"value", "$prev.value"}}});
            }
            const auto pipeline = afd::create_pipeline(std::move(steps));
            ok = run_case(
                     filter, "execute_pipeline/n=" + std::to_string(count),
                     [&] { return all_succeeded(registry.execute_pipeline(pipeline), count); }) &&
                 ok;
        }
    }

    // Wire: bounded parsing of JSON text, and a result to compact JSON text.
    for (const auto& [label, bytes] :
         {std::pair<std::string_view, std::size_t>{"1KB", 1024},
          std::pair<std::string_view, std::size_t>{"100KB", 100 * 1024}}) {
        const afd::CommandResult result = afd::success(payload(bytes));
        const std::string text = afd::wire::serialize(afd::Json(result));
        ok = run_case(filter, "parse_bounded/" + std::string(label),
                      [&] { return afd::parse_bounded(text).has_value(); }) &&
             ok;
        ok = run_case(
                 filter, "serialize_result/" + std::string(label),
                 [&] { return afd::wire::serialize(afd::Json(result)).size() == text.size(); }) &&
             ok;
    }

    if (afd_bench::cases_run == 0) {
        std::fprintf(stderr, "No case matches \"%.*s\"\n", static_cast<int>(filter.size()),
                     filter.data());
        return 1;
    }
    return ok ? 0 : 1;
}
