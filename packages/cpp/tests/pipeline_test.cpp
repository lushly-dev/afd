// Pipeline execution semantics from packages/core/src/pipeline-executor.ts.
#include "afd/afd.hpp"

#include <memory>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

struct Calls {
    std::vector<std::string> names;
    std::vector<afd::Json> inputs;
    std::vector<std::string> traces;
};

// Echoes its input as data; "fail-*" commands fail; "slow-*" commands advance the clock by 50 ms.
afd::CommandExecutor recorder(Calls& calls, std::shared_ptr<afd::ManualClock> clock = nullptr) {
    return [&calls, clock](std::string_view name, const afd::Json& input,
                           afd::CommandContext& context) {
        calls.names.emplace_back(name);
        calls.inputs.push_back(input);
        calls.traces.push_back(context.trace_id.value_or(""));
        if (clock && name.substr(0, 5) == "slow-") {
            clock->advance(50);
        }
        if (name.substr(0, 5) == "fail-") {
            return afd::failure(afd::create_error("EXPECTED", "failed on purpose"));
        }
        afd::ResultOptions options;
        options.confidence = input.contains("confidence")
                                 ? std::optional<double>(input["confidence"].get<double>())
                                 : std::nullopt;
        if (input.contains("reasoning")) {
            options.reasoning = input["reasoning"].get<std::string>();
        }
        return afd::success(input, options);
    };
}

afd::PipelineResult run(const char* request, Calls& calls, afd::ExecutorOptions options = {}) {
    return afd::execute_pipeline(afd::Json::parse(request), recorder(calls), {}, options);
}

} // namespace

TEST_CASE("steps chain through references; data is the last successful step's") {
    Calls calls;
    const auto result = run(R"({"id":"p1","input":{"q":"milk"},"steps":[
        {"command":"todo-search","input":{"query":"$input.q"},"as":"search"},
        {"command":"todo-get","input":{"id":"$prev.query","from":"$steps.search.query","first":"$first"}}]})",
                            calls);
    REQUIRE(calls.inputs.size() == 2);
    CHECK(calls.inputs[0] == afd::Json{{"query", "milk"}});
    CHECK(calls.inputs[1] ==
          afd::Json::parse(R"({"id":"milk","from":"milk","first":{"query":"milk"}})"));
    CHECK(calls.traces == std::vector<std::string>{"p1-step-0", "p1-step-1"});
    CHECK(result.data == calls.inputs[1]);
    CHECK(result.metadata.completed_steps == 2);
    CHECK(result.metadata.total_steps == 2);
    CHECK(result.steps[0].alias == "search");
    CHECK(result.steps[1].metadata.has_value());
}

TEST_CASE("a step without input gets {}; a false when skips the step") {
    Calls calls;
    const auto result = run(R"({"steps":[
        {"command":"todo-list"},
        {"command":"todo-archive","when":{"$exists":"$prev.missing"}},
        {"command":"todo-count","when":{"$exists":"$first"}}]})",
                            calls);
    CHECK(calls.names == std::vector<std::string>{"todo-list", "todo-count"});
    CHECK(calls.inputs[0] == afd::Json::object());
    CHECK(result.steps[1].status == afd::StepStatus::skipped);
    CHECK_FALSE(result.steps[1].error.has_value());
    CHECK(result.metadata.completed_steps == 2);
}

TEST_CASE("a failure stops the pipeline unless continueOnFailure") {
    Calls calls;
    const auto stopped =
        run(R"({"steps":[{"command":"fail-now"},{"command":"never-run"}]})", calls);
    CHECK(calls.names == std::vector<std::string>{"fail-now"});
    CHECK(stopped.steps[0].status == afd::StepStatus::failure);
    CHECK(stopped.steps[1].status == afd::StepStatus::skipped);
    CHECK_FALSE(stopped.steps[1].error.has_value());
    CHECK_FALSE(stopped.data.has_value());
    CHECK(stopped.metadata.confidence == 0);

    Calls more;
    const auto kept_going =
        run(R"({"steps":[{"command":"fail-now"},{"command":"then-run","input":{"x":"$steps[0]"}}],
                                    "options":{"continueOnFailure":true}})",
            more);
    CHECK(more.names == std::vector<std::string>{"fail-now", "then-run"});
    CHECK(more.inputs[1] == afd::Json::object()); // $steps[0] failed: absent, omitted
    CHECK(kept_going.steps[1].status == afd::StepStatus::success);
}

TEST_CASE("the pipeline deadline: a late step and everything after it time out") {
    auto clock = std::make_shared<afd::ManualClock>();
    Calls calls;
    const auto result = afd::execute_pipeline(
        afd::Json::parse(
            R"({"steps":[{"command":"quick-a"},{"command":"slow-b"},{"command":"quick-c"}],
                             "options":{"timeoutMs":20,"continueOnFailure":true}})"),
        recorder(calls, clock), {}, {.clock = clock});
    CHECK(calls.names == std::vector<std::string>{"quick-a", "slow-b"});
    CHECK(result.steps[0].status == afd::StepStatus::success);
    CHECK(result.steps[1].status == afd::StepStatus::failure);
    CHECK(result.steps[1].error->code == "PIPELINE_TIMEOUT");
    CHECK(result.steps[1].error->message == "Pipeline timeout exceeded (20ms)");
    CHECK(result.steps[2].status == afd::StepStatus::skipped);
    CHECK(result.steps[2].error->code == "PIPELINE_TIMEOUT"); // even with continueOnFailure
}

TEST_CASE("timeoutMs 0 times out the first step without running it") {
    Calls calls;
    const auto result = run(R"({"steps":[{"command":"a-b"}],"options":{"timeoutMs":0}})", calls,
                            {.clock = std::make_shared<afd::ManualClock>()});
    CHECK(calls.names.empty());
    CHECK(result.steps[0].error->code == "PIPELINE_TIMEOUT");
}

TEST_CASE("unsupported options fail one step and skip the rest, running nothing") {
    Calls calls;
    const auto parallel = run(
        R"({"steps":[{"command":"a-b"},{"command":"c-d"}],"options":{"parallel":true}})", calls);
    CHECK(calls.names.empty());
    CHECK(parallel.steps[0].error->code == "UNSUPPORTED_OPTION");
    CHECK(parallel.steps[0].error->message == "Parallel pipeline execution is not supported");
    CHECK(parallel.steps[1].status == afd::StepStatus::skipped);
    CHECK(parallel.metadata.total_steps == 2);

    const auto stream =
        run(R"({"steps":[{"command":"a-b"},{"command":"c-d","stream":true}]})", calls);
    CHECK(calls.names.empty());
    CHECK(stream.steps[0].status == afd::StepStatus::skipped);
    CHECK(stream.steps[1].error->message ==
          "Streaming pipeline steps are not supported (step 1 sets stream: true)");
}

TEST_CASE("rejected envelopes give one synthetic step; an empty pipeline gives none") {
    Calls calls;
    for (const char* text :
         {R"({"steps":[{"command":" "}]})", R"({"steps":[{"command":"a-b","input":[]}]})",
          R"({"steps":[{"command":"a-b","when":{"$exists":1}}]})",
          R"({"steps":[{"command":"a-b","when":{"$gt":["$prev",true]}}]})",
          R"({"steps":[{"command":"a-b","when":{"$exists":"$prev","$not":{}}}]})",
          R"({"steps":[{"command":"a-b"}],"options":{"timeoutMs":-5}})",
          R"({"steps":[{"command":"a-b"}],"options":{"onProgress":1}})", R"({"steps":{}})",
          R"({"id":7,"steps":[]})", R"({"steps":[{"command":"a-b","as":null}]})"}) {
        CAPTURE(text);
        const auto result = run(text, calls);
        REQUIRE(result.steps.size() == 1);
        CHECK(result.steps[0].index == -1);
        CHECK(result.steps[0].error->code == "INVALID_PIPELINE_REQUEST");
        CHECK(afd::Json(result) ==
              afd::Json::parse(R"({"metadata":{"confidence":0,"confidenceBreakdown":[],
            "reasoning":[],"warnings":[],"sources":[],"alternatives":[],"executionTimeMs":0,"completedSteps":0,
            "totalSteps":0},"steps":[{"index":-1,"command":"","status":"failure","executionTimeMs":0,
            "error":{"code":"INVALID_PIPELINE_REQUEST","message":"Invalid pipeline request envelope",
            "suggestion":"Provide steps with nonempty command names, object inputs, valid conditions, and correctly typed options; input must be JSON"}}]})"));
    }
    CHECK(calls.names.empty());
    CHECK(run(R"({"steps":[]})", calls).steps.empty());
}

TEST_CASE("65-level nesting is rejected before any step runs; 64 is fine") {
    const auto nested = [](int levels) {
        afd::Json value = afd::Json::object();
        for (int i = 1; i < levels; ++i) {
            value = afd::Json{{"x", value}};
        }
        return value;
    };
    Calls calls;
    afd::Json request = {{"steps", {{{"command", "a-b"}, {"input", nested(65)}}}}};
    const auto rejected = afd::execute_pipeline(request, recorder(calls));
    CHECK(calls.names.empty());
    REQUIRE(rejected.steps.size() == 1);
    CHECK(rejected.steps[0].error->code == "VALIDATION_ERROR");
    CHECK(rejected.steps[0].error->message ==
          "The input of step 0 is nested deeper than 64 levels");
    CHECK(rejected.steps[0].error->details == afd::Json{{"stepIndex", 0}, {"maxDepth", 64}});

    request = {{"steps", {{{"command", "a-b"}, {"input", nested(64)}}}}};
    CHECK(afd::execute_pipeline(request, recorder(calls)).steps[0].status ==
          afd::StepStatus::success);

    request = {{"input", nested(65)}, {"steps", {{{"command", "a-b"}}}}};
    CHECK(afd::execute_pipeline(request, recorder(calls)).steps[0].error->message ==
          "The pipeline input is nested deeper than 64 levels");
}

TEST_CASE("metadata aggregates successful steps like the pipeline-result fixture") {
    Calls calls;
    const auto result = run(R"({"steps":[
        {"command":"a-one","input":{"confidence":0.9},"as":"first"},
        {"command":"a-two","input":{"confidence":0.6,"reasoning":"Because"}}]})",
                            calls);
    CHECK(result.metadata.confidence == doctest::Approx(0.6));
    REQUIRE(result.metadata.confidence_breakdown.size() == 2);
    CHECK(afd::Json(result.metadata.confidence_breakdown[0]) ==
          afd::Json::parse(R"({"step":0,"alias":"first","command":"a-one","confidence":0.9})"));
    REQUIRE(result.metadata.reasoning.size() == 1);
    CHECK(result.metadata.reasoning[0].step_index == 1);
    // A successful step's metadata keeps only what the command set.
    CHECK(afd::Json(*result.steps[0].metadata) == afd::Json{{"confidence", 0.9}});
}

TEST_CASE("a caller trace ID is shared by every step") {
    Calls calls;
    afd::CommandContext context;
    context.trace_id = "caller";
    (void)afd::execute_pipeline(
        afd::Json::parse(R"({"steps":[{"command":"a-b"},{"command":"c-d"}]})"), recorder(calls),
        context);
    CHECK(calls.traces == std::vector<std::string>{"caller", "caller"});
}

TEST_CASE("DirectClient::pipe numbers step trace IDs by calls made") {
    auto registry = std::make_shared<afd::CommandRegistry>();
    std::vector<std::string> traces;
    for (const char* name : {"todo-one", "todo-two"}) {
        REQUIRE_FALSE(
            registry
                ->register_command({.name = name,
                                    .description = "Step",
                                    .handler =
                                        [&traces](const afd::Json&, afd::CommandContext& context) {
                                            traces.push_back(*context.trace_id);
                                            return afd::success({{"ok", true}});
                                        }})
                .has_value());
    }
    afd::DirectClient client(registry);
    afd::CommandContext context;
    context.trace_id = "t";
    const auto result = client.pipe(afd::Json::parse(R"({"steps":[
        {"command":"todo-one"},{"command":"todo-skip","when":{"$exists":"$prev.missing"}},{"command":"todo-two"}]})"),
                                    context);
    CHECK(traces == std::vector<std::string>{"t-step-0", "t-step-1"});
    CHECK(result.metadata.completed_steps == 2);
}
