// Pipeline requests, references, conditions and execution (packages/core/src/pipeline-variables.ts,
// request-validation.ts and pipeline-executor.ts; normative rules in spec/pipeline-variables.md).
#include "afd/pipeline.hpp"

#include <cmath>
#include <utility>

#include "detail/exceptions.hpp"
#include "detail/json_io.hpp"
#include "detail/utf8.hpp"

namespace afd {
namespace {

constexpr double max_safe_integer = 9007199254740991.0;
constexpr std::size_t max_condition_depth = 128;

double round2(double ms) {
    return std::round(ms * 100) / 100;
}

// --- references ---------------------------------------------------------------------------

enum class SourceKind { prev, first, input, index, alias };

struct Segment {
    std::string key;
    bool has_index = false;
    /// Absent when the digits exceed JavaScript's safe-integer range (never resolves).
    std::optional<std::size_t> index;
};

struct Reference {
    SourceKind kind = SourceKind::prev;
    std::optional<std::size_t> step_index;
    std::string alias;
    std::vector<Segment> path;
};

bool is_ascii_digit(char c) {
    return c >= '0' && c <= '9';
}

// Digits as a JavaScript Number would read them; nullopt above 2^53 - 1.
std::optional<std::size_t> parse_index(std::string_view digits) {
    double value = 0;
    for (char c : digits) {
        value = value * 10 + (c - '0');
        if (value > max_safe_integer) {
            return std::nullopt;
        }
    }
    return static_cast<std::size_t>(value);
}

// `[^.[\]\s]+`: a key or alias contains no dot, bracket or JavaScript whitespace.
bool is_name(std::string_view text) {
    if (text.empty()) {
        return false;
    }
    for (std::size_t i = 0; i < text.size();) {
        const auto decoded = detail::decode_utf8(text, i);
        const char32_t c = decoded.code_point;
        if (c == U'.' || c == U'[' || c == U']' || detail::is_js_whitespace(c)) {
            return false;
        }
        i += decoded.byte_length;
    }
    return true;
}

// `^([^.[\]\s]+)(?:\[(\d+)\])?$`
std::optional<Segment> parse_segment(std::string_view part) {
    const std::size_t bracket = part.find('[');
    Segment segment;
    const std::string_view key = part.substr(0, bracket);
    if (!is_name(key)) {
        return std::nullopt;
    }
    segment.key = std::string(key);
    if (bracket == std::string_view::npos) {
        return segment;
    }
    const std::string_view rest = part.substr(bracket + 1);
    if (rest.size() < 2 || rest.back() != ']') {
        return std::nullopt;
    }
    const std::string_view digits = rest.substr(0, rest.size() - 1);
    for (char c : digits) {
        if (!is_ascii_digit(c)) {
            return std::nullopt;
        }
    }
    segment.has_index = true;
    segment.index = parse_index(digits);
    return segment;
}

std::optional<std::vector<Segment>> parse_path(std::string_view path) {
    std::vector<Segment> segments;
    while (true) {
        const std::size_t dot = path.find('.');
        auto segment = parse_segment(path.substr(0, dot));
        if (!segment) {
            return std::nullopt;
        }
        segments.push_back(std::move(*segment));
        if (dot == std::string_view::npos) {
            return segments;
        }
        path = path.substr(dot + 1);
    }
}

bool starts_with(std::string_view text, std::string_view prefix) {
    return text.substr(0, prefix.size()) == prefix;
}

std::optional<Reference> parse_reference(std::string_view ref) {
    if (ref.empty() || ref.front() != '$' || starts_with(ref, "$$") ||
        detail::utf16_length(ref) > max_reference_length) {
        return std::nullopt;
    }
    Reference reference;
    std::string_view rest;
    if (starts_with(ref, "$steps[")) {
        std::size_t end = 7;
        while (end < ref.size() && is_ascii_digit(ref[end])) {
            ++end;
        }
        if (end > 7 && end < ref.size() && ref[end] == ']') {
            reference.kind = SourceKind::index;
            reference.step_index = parse_index(ref.substr(7, end - 7));
            rest = ref.substr(end + 1);
        } else {
            return std::nullopt;
        }
    } else if (starts_with(ref, "$steps.")) {
        const std::string_view body = ref.substr(7);
        const std::size_t dot = body.find('.');
        const std::string_view alias = body.substr(0, dot);
        if (!is_name(alias)) {
            return std::nullopt;
        }
        reference.kind = SourceKind::alias;
        reference.alias = std::string(alias);
        rest = dot == std::string_view::npos ? std::string_view() : body.substr(dot);
    } else {
        constexpr std::pair<std::string_view, SourceKind> named[] = {{"$prev", SourceKind::prev},
                                                                     {"$first", SourceKind::first},
                                                                     {"$input", SourceKind::input}};
        bool matched = false;
        for (const auto& [name, kind] : named) {
            if (ref == name || starts_with(ref, std::string(name) + ".")) {
                reference.kind = kind;
                rest = ref.substr(name.size());
                matched = true;
                break;
            }
        }
        if (!matched) {
            return std::nullopt;
        }
    }
    if (rest.empty()) {
        return reference;
    }
    if (rest.front() != '.') {
        return std::nullopt;
    }
    auto path = parse_path(rest.substr(1));
    if (!path) {
        return std::nullopt;
    }
    reference.path = std::move(*path);
    return reference;
}

std::optional<Json> element(const Json& array, std::optional<std::size_t> index) {
    if (!index || *index >= array.size()) {
        return std::nullopt;
    }
    return array[*index];
}

std::optional<Json> child(const Json& container, const std::string& key) {
    if (starts_with(key, "__")) {
        return std::nullopt;
    }
    if (container.is_array()) {
        for (char c : key) {
            if (!is_ascii_digit(c)) {
                return std::nullopt;
            }
        }
        return element(container, parse_index(key));
    }
    if (container.is_object()) {
        const auto it = container.find(key);
        return it == container.end() ? std::nullopt : std::optional<Json>(*it);
    }
    return std::nullopt;
}

std::optional<Json> traverse(std::optional<Json> current, const std::vector<Segment>& path) {
    for (const auto& segment : path) {
        if (!current) {
            return std::nullopt;
        }
        current = child(*current, segment.key);
        if (segment.has_index) {
            current =
                current && current->is_array() ? element(*current, segment.index) : std::nullopt;
        }
    }
    return current;
}

std::optional<Json> source_data(const Reference& reference, const PipelineContext& context) {
    switch (reference.kind) {
    case SourceKind::prev:
        return context.previous_success && *context.previous_success < context.steps.size()
                   ? context.steps[*context.previous_success].data
                   : std::nullopt;
    case SourceKind::first:
        return context.steps.empty() ? std::nullopt : context.steps.front().data;
    case SourceKind::input:
        return context.pipeline_input;
    case SourceKind::index:
        return reference.step_index && *reference.step_index < context.steps.size()
                   ? context.steps[*reference.step_index].data
                   : std::nullopt;
    case SourceKind::alias:
        if (starts_with(reference.alias, "__")) {
            return std::nullopt;
        }
        for (const auto& step : context.steps) {
            if (step.alias == reference.alias) {
                return step.data;
            }
        }
        return std::nullopt;
    }
    return std::nullopt;
}

std::optional<Json> lookup(const Reference& reference, const PipelineContext& context) {
    return traverse(source_data(reference, context), reference.path);
}

// nullopt is TypeScript's ABSENT marker.
std::optional<Json> resolve_value(const Json& value, const PipelineContext& context,
                                  std::size_t depth, bool& too_deep) {
    if (value.is_string()) {
        const auto& text = value.get_ref<const std::string&>();
        if (starts_with(text, "$$")) {
            return Json(text.substr(1));
        }
        const auto reference = parse_reference(text);
        return reference ? lookup(*reference, context) : std::optional<Json>(value);
    }
    if (!value.is_array() && !value.is_object()) {
        return value;
    }
    if (depth >= max_pipeline_nesting_depth) {
        too_deep = true;
        return value;
    }
    if (value.is_array()) {
        Json out = Json::array();
        for (const Json& item : value) {
            auto resolved = resolve_value(item, context, depth + 1, too_deep);
            out.push_back(resolved ? std::move(*resolved) : Json());
        }
        return out;
    }
    Json out = Json::object();
    for (auto it = value.begin(); it != value.end(); ++it) {
        if (auto resolved = resolve_value(it.value(), context, depth + 1, too_deep)) {
            out[it.key()] = std::move(*resolved);
        }
    }
    return out;
}

// --- conditions ---------------------------------------------------------------------------

std::optional<Json> operand(const Json& ref, const PipelineContext& context) {
    if (!ref.is_string()) {
        return std::nullopt;
    }
    const auto reference = parse_reference(ref.get_ref<const std::string&>());
    return reference ? lookup(*reference, context) : std::nullopt;
}

bool is_comparison(const std::string& key) {
    return key == "$eq" || key == "$ne" || key == "$gt" || key == "$gte" || key == "$lt" ||
           key == "$lte";
}

bool valid_condition(const Json& condition, std::size_t depth) {
    if (!condition.is_object() || condition.size() != 1 || depth >= max_condition_depth) {
        return false;
    }
    const auto it = condition.begin();
    const std::string& key = it.key();
    const Json& value = it.value();
    if (key == "$exists") {
        return value.is_string();
    }
    if (is_comparison(key)) {
        return value.is_array() && value.size() == 2 && value[0].is_string() &&
               (key == "$eq" || key == "$ne" || value[1].is_number());
    }
    if (key == "$not") {
        return valid_condition(value, depth + 1);
    }
    if (key == "$and" || key == "$or") {
        if (!value.is_array()) {
            return false;
        }
        for (const Json& item : value) {
            if (!valid_condition(item, depth + 1)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

// --- envelope -----------------------------------------------------------------------------

CommandError invalid_pipeline_error() {
    return create_error(error_codes::INVALID_PIPELINE_REQUEST, "Invalid pipeline request envelope",
                        {.suggestion =
                             "Provide steps with nonempty command names, object inputs, valid "
                             "conditions, and correctly typed options; input must be JSON"});
}

// Whether `value` nests deeper than the limit (iteratively, so hostile depth is safe).
bool too_deep(const Json& value) {
    std::vector<std::pair<const Json*, std::size_t>> pending{{&value, 0}};
    while (!pending.empty()) {
        const auto [current, depth] = pending.back();
        pending.pop_back();
        if (!current->is_array() && !current->is_object()) {
            continue;
        }
        if (depth >= max_pipeline_nesting_depth) {
            return true;
        }
        for (const Json& item : *current) {
            pending.emplace_back(&item, depth + 1);
        }
    }
    return false;
}

CommandError depth_error(const std::string& what, Json details) {
    details["maxDepth"] = max_pipeline_nesting_depth;
    const std::string limit = std::to_string(max_pipeline_nesting_depth);
    return create_error(error_codes::VALIDATION_ERROR,
                        what + " is nested deeper than " + limit + " levels",
                        {.suggestion = "Flatten it to at most " + limit +
                                       " levels of nested objects and arrays and retry",
                         .retryable = false,
                         .details = std::move(details)});
}

std::optional<CommandError> limit_error(const PipelineRequest& request) {
    if (request.input && too_deep(*request.input)) {
        return depth_error("The pipeline input", {{"field", "input"}});
    }
    for (std::size_t i = 0; i < request.steps.size(); ++i) {
        if (request.steps[i].input && too_deep(*request.steps[i].input)) {
            return depth_error("The input of step " + std::to_string(i), {{"stepIndex", i}});
        }
    }
    return std::nullopt;
}

// --- results ------------------------------------------------------------------------------

PipelineResult rejected(std::optional<CommandError> error) {
    PipelineResult result;
    if (error) {
        StepResult step;
        step.index = -1;
        step.status = StepStatus::failure;
        step.error = std::move(error);
        result.steps.push_back(std::move(step));
    }
    return result;
}

StepResult step_result(std::size_t index, const PipelineStep& step, StepStatus status) {
    StepResult result;
    result.index = static_cast<std::int64_t>(index);
    result.alias = step.as;
    result.command = step.command;
    result.status = status;
    return result;
}

PipelineResult finish(const PipelineRequest& request, std::vector<StepResult> steps,
                      double elapsed_ms) {
    PipelineResult result;
    PipelineMetadata& metadata = result.metadata;
    bool any_success = false;
    double minimum = 1;
    for (const auto& step : steps) {
        const StepMetadata empty;
        const StepMetadata& meta = step.metadata ? *step.metadata : empty;
        if (step.status == StepStatus::success) {
            const double confidence = meta.confidence.value_or(1.0);
            minimum = any_success ? (std::min)(minimum, confidence) : confidence;
            any_success = true;
            ++metadata.completed_steps;
            result.data = step.data;
            metadata.confidence_breakdown.push_back(
                {step.index, step.alias, step.command, confidence, meta.reasoning});
            if (meta.reasoning && !meta.reasoning->empty()) {
                metadata.reasoning.push_back({step.index, step.command, *meta.reasoning});
            }
        }
        if (meta.warnings) {
            for (const auto& warning : *meta.warnings) {
                PipelineWarning tagged;
                static_cast<Warning&>(tagged) = warning;
                tagged.step_index = step.index;
                tagged.step_alias = step.alias;
                metadata.warnings.push_back(std::move(tagged));
            }
        }
        if (meta.sources) {
            for (const auto& source : *meta.sources) {
                PipelineSource tagged;
                static_cast<Source&>(tagged) = source;
                tagged.step_index = step.index;
                metadata.sources.push_back(std::move(tagged));
            }
        }
        if (meta.alternatives) {
            for (const auto& alternative : *meta.alternatives) {
                PipelineAlternative tagged;
                static_cast<Alternative&>(tagged) = alternative;
                tagged.step_index = step.index;
                metadata.alternatives.push_back(std::move(tagged));
            }
        }
    }
    metadata.confidence = any_success ? minimum : 0;
    metadata.execution_time_ms = round2(elapsed_ms);
    metadata.total_steps = static_cast<std::int64_t>(request.steps.size());
    result.steps = std::move(steps);
    return result;
}

std::string random_suffix(RandomSource& random) {
    constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    std::string out;
    for (int i = 0; i < 11; ++i) {
        out.push_back(digits[static_cast<std::size_t>(random.next() * 36.0)]);
    }
    return out;
}

} // namespace

// --- public API ---------------------------------------------------------------------------

bool is_pipeline_request(const Json& request) {
    return parse_pipeline_request(request).has_value();
}

bool is_pipeline_result(const Json& value) {
    // `data` may be absent on the wire (no successful step), so only metadata and steps are
    // required.
    return value.is_object() && value.contains("metadata") && value.contains("steps") &&
           value["steps"].is_array();
}

PipelineRequest create_pipeline(std::vector<PipelineStep> steps,
                                std::optional<PipelineOptions> options) {
    PipelineRequest request;
    request.steps = std::move(steps);
    request.options = std::move(options);
    return request;
}

void to_json(Json& out, const PipelineStep& step) {
    out = Json::object();
    out["command"] = step.command;
    detail::put(out, "input", step.input);
    detail::put(out, "as", step.as);
    detail::put(out, "when", step.when);
    detail::put(out, "stream", step.stream);
}

void to_json(Json& out, const PipelineOptions& options) {
    out = Json::object();
    detail::put(out, "continueOnFailure", options.continue_on_failure);
    detail::put(out, "timeoutMs", options.timeout_ms);
    detail::put(out, "parallel", options.parallel);
}

void to_json(Json& out, const PipelineRequest& request) {
    out = Json::object();
    detail::put(out, "id", request.id);
    out["steps"] = request.steps;
    detail::put(out, "options", request.options);
    detail::put(out, "input", request.input);
}

Expected<PipelineRequest, CommandError> parse_pipeline_request(const Json& request) {
    // Optional members must be absent or correctly typed; null is a wrong type, as in TypeScript.
    const auto fail = [] { return unexpected(invalid_pipeline_error()); };
    if (!request.is_object()) {
        return fail();
    }
    PipelineRequest parsed;
    if (const auto id = request.find("id"); id != request.end()) {
        if (!id->is_string()) {
            return fail();
        }
        parsed.id = id->get<std::string>();
    }
    if (const auto input = request.find("input"); input != request.end()) {
        parsed.input = *input;
    }
    const auto steps = request.find("steps");
    if (steps == request.end() || !steps->is_array()) {
        return fail();
    }
    for (const Json& entry : *steps) {
        if (!entry.is_object()) {
            return fail();
        }
        PipelineStep step;
        const auto command = entry.find("command");
        if (command == entry.end() || !command->is_string() ||
            detail::is_blank(command->get_ref<const std::string&>())) {
            return fail();
        }
        step.command = command->get<std::string>();
        if (const auto as = entry.find("as"); as != entry.end()) {
            if (!as->is_string()) {
                return fail();
            }
            step.as = as->get<std::string>();
        }
        if (const auto stream = entry.find("stream"); stream != entry.end()) {
            if (!stream->is_boolean()) {
                return fail();
            }
            step.stream = stream->get<bool>();
        }
        if (const auto input = entry.find("input"); input != entry.end()) {
            if (!input->is_object()) {
                return fail();
            }
            step.input = *input;
        }
        if (const auto when = entry.find("when"); when != entry.end()) {
            if (!valid_condition(*when, 0)) {
                return fail();
            }
            step.when = *when;
        }
        parsed.steps.push_back(std::move(step));
    }
    if (const auto options = request.find("options"); options != request.end()) {
        if (!options->is_object() || options->contains("onProgress")) {
            return fail();
        }
        PipelineOptions pipeline_options;
        if (const auto value = options->find("continueOnFailure"); value != options->end()) {
            if (!value->is_boolean()) {
                return fail();
            }
            pipeline_options.continue_on_failure = value->get<bool>();
        }
        if (const auto value = options->find("parallel"); value != options->end()) {
            if (!value->is_boolean()) {
                return fail();
            }
            pipeline_options.parallel = value->get<bool>();
        }
        if (const auto value = options->find("timeoutMs"); value != options->end()) {
            if (!value->is_number() || value->get<double>() < 0) {
                return fail();
            }
            pipeline_options.timeout_ms = value->get<double>();
        }
        parsed.options = pipeline_options;
    }
    return parsed;
}

std::optional<Json> resolve_variable(std::string_view reference, const PipelineContext& context) {
    if (starts_with(reference, "$$")) {
        return Json(std::string(reference.substr(1)));
    }
    const auto parsed = parse_reference(reference);
    return parsed ? lookup(*parsed, context) : std::optional<Json>(Json(std::string(reference)));
}

Expected<Json> resolve_variables(const Json& input, const PipelineContext& context) {
    bool deep = false;
    auto resolved = resolve_value(input, context, 0, deep);
    if (deep) {
        return unexpected("Pipeline step input is nested deeper than " +
                          std::to_string(max_pipeline_nesting_depth) + " levels");
    }
    return resolved ? std::move(*resolved) : Json();
}

bool evaluate_condition(const Json& condition, const PipelineContext& context) {
    if (!condition.is_object() || condition.size() != 1) {
        return false;
    }
    const auto it = condition.begin();
    const std::string& key = it.key();
    const Json& value = it.value();
    if (key == "$exists") {
        const auto resolved = operand(value, context);
        return resolved && !resolved->is_null();
    }
    if (is_comparison(key)) {
        if (!value.is_array() || value.size() != 2) {
            return false;
        }
        const auto resolved = operand(value[0], context);
        const Json& expected = value[1];
        if (!resolved) {
            return false;
        }
        if (key == "$eq") {
            return *resolved == expected;
        }
        if (key == "$ne") {
            return *resolved != expected;
        }
        if (!resolved->is_number() || !expected.is_number()) {
            return false;
        }
        const double a = resolved->get<double>();
        const double b = expected.get<double>();
        return key == "$gt" ? a > b : key == "$gte" ? a >= b : key == "$lt" ? a < b : a <= b;
    }
    if (key == "$and" && value.is_array()) {
        for (const Json& item : value) {
            if (!evaluate_condition(item, context)) {
                return false;
            }
        }
        return true;
    }
    if (key == "$or" && value.is_array()) {
        for (const Json& item : value) {
            if (evaluate_condition(item, context)) {
                return true;
            }
        }
        return false;
    }
    if (key == "$not") {
        return !evaluate_condition(value, context);
    }
    return false;
}

PipelineResult execute_pipeline(const PipelineRequest& request, const CommandExecutor& execute,
                                const CommandContext& context, const ExecutorOptions& options) {
    // Typed requests go through the same envelope checks as JSON ones.
    return execute_pipeline(Json(request), execute, context, options);
}

PipelineResult execute_pipeline(const Json& raw_request, const CommandExecutor& execute,
                                const CommandContext& context, const ExecutorOptions& options) {
    const auto clock = options.clock ? options.clock : std::make_shared<SystemClock>();
    const double start = clock->steady_ms();

    auto parsed = parse_pipeline_request(raw_request);
    if (!parsed) {
        return rejected(parsed.error());
    }
    const PipelineRequest& request = *parsed;
    if (request.steps.empty()) {
        return rejected(std::nullopt);
    }
    if (auto error = limit_error(request)) {
        return rejected(std::move(error));
    }

    const PipelineOptions pipeline_options = request.options.value_or(PipelineOptions{});
    // Unsupported options: blame one step and skip the rest, so no command runs.
    std::optional<std::pair<std::size_t, CommandError>> unsupported;
    if (pipeline_options.parallel.value_or(false)) {
        unsupported.emplace(
            0, create_error(error_codes::UNSUPPORTED_OPTION,
                            "Parallel pipeline execution is not supported",
                            {.suggestion = "Remove parallel or set it to false to execute "
                                           "steps sequentially"}));
    } else {
        for (std::size_t i = 0; i < request.steps.size(); ++i) {
            if (request.steps[i].stream.value_or(false)) {
                unsupported.emplace(
                    i, create_error(error_codes::UNSUPPORTED_OPTION,
                                    "Streaming pipeline steps are not supported (step " +
                                        std::to_string(i) + " sets stream: true)",
                                    {.suggestion =
                                         "Remove stream or set it to false; to stream one command, "
                                         "use the /stream endpoint or executeStream()"}));
                break;
            }
        }
    }
    if (unsupported) {
        std::vector<StepResult> steps;
        for (std::size_t i = 0; i < request.steps.size(); ++i) {
            StepResult step =
                step_result(i, request.steps[i],
                            i == unsupported->first ? StepStatus::failure : StepStatus::skipped);
            if (i == unsupported->first) {
                step.error = unsupported->second;
            }
            steps.push_back(std::move(step));
        }
        return finish(request, std::move(steps), clock->steady_ms() - start);
    }

    std::shared_ptr<RandomSource> random =
        options.random ? options.random : std::make_shared<SeededRandom>();
    const std::string pipeline_id =
        request.id ? *request.id
                   : "pipeline-" + std::to_string(clock->wall_ms()) + "-" + random_suffix(*random);
    const std::optional<double> timeout_ms = pipeline_options.timeout_ms;
    const std::optional<double> deadline =
        timeout_ms ? std::optional<double>(start + *timeout_ms) : std::nullopt;
    const std::string timeout_message = "Pipeline timeout exceeded (" +
                                        (timeout_ms ? detail::format_number(*timeout_ms) : "") +
                                        "ms)";
    const auto timeout_error = [&] {
        return create_error(
            error_codes::PIPELINE_TIMEOUT, timeout_message,
            {.suggestion = "Increase timeoutMs or reduce the number of pipeline steps",
             .retryable = true});
    };
    const auto skip_rest = [&](std::vector<StepResult>& steps, std::size_t from,
                               const std::optional<CommandError>& error) {
        for (std::size_t j = from; j < request.steps.size(); ++j) {
            StepResult skipped = step_result(j, request.steps[j], StepStatus::skipped);
            skipped.error = error;
            steps.push_back(std::move(skipped));
        }
    };

    PipelineContext pipeline;
    pipeline.pipeline_input = request.input;
    std::vector<StepResult>& steps = pipeline.steps;

    for (std::size_t i = 0; i < request.steps.size(); ++i) {
        const PipelineStep& step = request.steps[i];
        const double step_start = clock->steady_ms();

        if (step.when && !evaluate_condition(*step.when, pipeline)) {
            steps.push_back(step_result(i, step, StepStatus::skipped));
            continue;
        }

        CommandResult result;
        Json input = Json::object();
        bool resolution_failed = false;
        if (step.input) {
            auto resolved = resolve_variables(*step.input, pipeline);
            if (resolved) {
                input = std::move(*resolved);
            } else {
                resolution_failed = true;
            }
        }

        if (resolution_failed) {
            result = failure(create_error(
                error_codes::INTERNAL_ERROR,
                "Could not evaluate the step condition or resolve its input references",
                {.suggestion = "Check that earlier steps return plain JSON data, then retry"}));
        } else if (deadline && clock->steady_ms() >= *deadline) {
            result = failure(timeout_error());
        } else {
            CancellationSource cancellation(context.cancellation, deadline, clock);
            CommandContext step_context = context;
            step_context.cancellation = cancellation.token();
            step_context.trace_id = context.trace_id && !context.trace_id->empty()
                                        ? *context.trace_id
                                        : pipeline_id + "-step-" + std::to_string(i);
#if AFD_HAS_EXCEPTIONS
            try {
                result = execute(step.command, input, step_context);
            } catch (const std::exception& error) {
                result = execution_failure(error.what(), options.dev_mode);
            } catch (...) {
                result = execution_failure("unknown exception", options.dev_mode);
            }
#else
            result = execute(step.command, input, step_context);
#endif
            // A step still running at the deadline times out, as if TypeScript's race had fired.
            if (deadline && clock->steady_ms() >= *deadline) {
                cancellation.cancel();
                result = failure(timeout_error());
            }
        }

        const double elapsed = round2(clock->steady_ms() - step_start);
        if (result.success) {
            StepResult success = step_result(i, step, StepStatus::success);
            success.data = result.data;
            success.execution_time_ms = elapsed;
            success.metadata = StepMetadata{result.confidence, result.reasoning,    result.warnings,
                                            result.sources,    result.alternatives, Json::object()};
            steps.push_back(std::move(success));
            pipeline.previous_success = steps.size() - 1;
        } else {
            StepResult failed = step_result(i, step, StepStatus::failure);
            failed.error = result.error;
            failed.execution_time_ms = elapsed;
            steps.push_back(std::move(failed));
            const bool timed_out =
                result.error && result.error->code == error_codes::PIPELINE_TIMEOUT;
            if (!pipeline_options.continue_on_failure.value_or(false) || timed_out) {
                skip_rest(steps, i + 1, timed_out ? result.error : std::nullopt);
                break;
            }
        }

        // TypeScript checks `options.timeoutMs &&`, so a zero timeout never reaches this check.
        if (timeout_ms && *timeout_ms != 0 && clock->steady_ms() - start > *timeout_ms) {
            skip_rest(steps, i + 1, timeout_error());
            break;
        }
    }

    std::vector<StepResult> finished = std::move(pipeline.steps);
    return finish(request, std::move(finished), clock->steady_ms() - start);
}

} // namespace afd
