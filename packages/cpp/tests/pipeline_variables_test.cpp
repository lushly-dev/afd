// spec/pipeline-variables.md, rule by rule, including its "Conformance" minimum.
#include "afd/afd.hpp"

#include <string>

#include <doctest.h>

namespace {

afd::StepResult step(std::int64_t index, afd::StepStatus status, std::optional<afd::Json> data,
                     std::optional<std::string> alias = std::nullopt) {
    afd::StepResult result;
    result.index = index;
    result.status = status;
    result.data = std::move(data);
    result.alias = std::move(alias);
    result.command = "step-" + std::to_string(index);
    return result;
}

// Step 0 succeeded (alias "user"), step 1 failed, step 2 succeeded; pipeline input {"q": "milk"}.
afd::PipelineContext sample() {
    afd::PipelineContext context;
    context.pipeline_input = afd::Json{{"q", "milk"}, {"n", 2}};
    context.steps.push_back(step(0, afd::StepStatus::success,
                                 afd::Json::parse(R"({"id":"u1","name":"Ada","items":[10,20,30],
                                     "0":"zero","__proto__":{"polluted":true},"constructor":"c"})"),
                                 "user"));
    context.steps.push_back(step(1, afd::StepStatus::failure, std::nullopt, "broken"));
    context.steps.push_back(
        step(2, afd::StepStatus::success, afd::Json{{"id", "t9"}, {"done", false}}));
    context.previous_success = 2;
    return context;
}

std::optional<afd::Json> resolve(const std::string& reference) {
    return afd::resolve_variable(reference, sample());
}

} // namespace

TEST_CASE("the reference forms") {
    CHECK(resolve("$prev") == afd::Json{{"id", "t9"}, {"done", false}});
    CHECK(resolve("$prev.id") == afd::Json("t9"));
    CHECK(resolve("$first.name") == afd::Json("Ada"));
    CHECK(resolve("$steps[0].id") == afd::Json("u1"));
    CHECK(resolve("$steps[2].done") == afd::Json(false));
    CHECK(resolve("$steps.user.name") == afd::Json("Ada"));
    CHECK(resolve("$input.q") == afd::Json("milk"));
    CHECK(resolve("$input") == afd::Json{{"q", "milk"}, {"n", 2}});
}

TEST_CASE("paths: keys, key[N], and numeric segments") {
    CHECK(resolve("$first.items[1]") == afd::Json(20));
    CHECK(resolve("$first.items.2") == afd::Json(30));  // a numeric segment indexes an array
    CHECK(resolve("$first.0") == afd::Json("zero"));    // and is an own-key lookup on an object
    CHECK(resolve("$first.items.01") == afd::Json(20)); // digits read as a number, as in JS
}

TEST_CASE("literals: strings that look like references but are not") {
    for (const char* literal : {"$9.99", "$HOME", "$prevx", "$prev.", "$prev.a b", "$steps[0][1]",
                                "$steps.user[0]", "$steps", "$stepsx", "plain", "$"}) {
        CAPTURE(literal);
        CHECK(resolve(literal) == afd::Json(literal));
    }
    // A non-breaking space is JavaScript whitespace too.
    CHECK(resolve("$prev.a\xC2\xA0"
                  "b") == afd::Json("$prev.a\xC2\xA0"
                                    "b"));
}

TEST_CASE("$$ escapes a literal that looks like a reference, at any length") {
    CHECK(resolve("$$prev") == afd::Json("$prev"));
    CHECK(resolve("$$$prev") == afd::Json("$$prev"));
    const std::string long_escape = "$$" + std::string(2000, 'x');
    CHECK(resolve(long_escape) == afd::Json("$" + std::string(2000, 'x')));
}

TEST_CASE("references longer than 1024 UTF-16 code units are literals") {
    const std::string at_limit = "$prev." + std::string(1024 - 6, 'a');
    CHECK_FALSE(resolve(at_limit).has_value()); // a reference that does not resolve
    const std::string over = at_limit + "a";
    CHECK(resolve(over) == afd::Json(over));
}

TEST_CASE("__ segments, prototype names and unknown keys never resolve") {
    CHECK_FALSE(resolve("$first.__proto__").has_value());
    CHECK_FALSE(resolve("$first.__proto__.polluted").has_value());
    CHECK_FALSE(resolve("$first.__class__").has_value());
    CHECK_FALSE(resolve("$steps.__proto__").has_value());
    // "constructor" is only an own key here; with no own key it is simply missing.
    CHECK(resolve("$first.constructor") == afd::Json("c"));
    CHECK_FALSE(resolve("$prev.constructor").has_value());
}

TEST_CASE("out of bounds, failed steps and unknown aliases are unresolved") {
    CHECK_FALSE(resolve("$first.items[3]").has_value());
    CHECK_FALSE(resolve("$first.items[99999999999999999999]").has_value());
    CHECK_FALSE(resolve("$steps[3]").has_value());
    CHECK_FALSE(resolve("$steps[1]").has_value()); // failed step: no data
    CHECK_FALSE(resolve("$steps.broken").has_value());
    CHECK_FALSE(resolve("$steps.nobody").has_value());
    CHECK_FALSE(resolve("$prev.id.deeper").has_value());
}

TEST_CASE("$input with and without request input") {
    CHECK(resolve("$input.n") == afd::Json(2));
    afd::PipelineContext no_input = sample();
    no_input.pipeline_input.reset();
    CHECK_FALSE(afd::resolve_variable("$input", no_input).has_value());
    CHECK_FALSE(afd::resolve_variable("$input.q", no_input).has_value());
}

TEST_CASE("$prev is the most recent successful step, not simply the previous one") {
    afd::PipelineContext context = sample();
    context.steps.push_back(step(3, afd::StepStatus::failure, std::nullopt));
    CHECK(afd::resolve_variable("$prev.id", context) == afd::Json("t9"));
    afd::PipelineContext none;
    CHECK_FALSE(afd::resolve_variable("$prev", none).has_value());
}

TEST_CASE("unresolved values: omitted from objects, null in arrays; null stays null") {
    afd::PipelineContext context = sample();
    context.steps[2].data = afd::Json{{"id", "t9"}, {"gone", nullptr}};
    const auto resolved = afd::resolve_variables(
        afd::Json::parse(R"({"a":"$prev.id","b":"$steps.nobody","c":["$prev.id","$steps.nobody"],
                             "d":"$prev.gone","e":{"f":"$$prev"},"g":7})"),
        context);
    REQUIRE(resolved.has_value());
    CHECK(*resolved ==
          afd::Json::parse(R"({"a":"t9","c":["t9",null],"d":null,"e":{"f":"$prev"},"g":7})"));
}

TEST_CASE("resolve_variables rejects input nested deeper than 64 levels") {
    afd::Json deep = afd::Json::object();
    for (int i = 0; i < 64; ++i) {
        deep = afd::Json{{"x", deep}};
    }
    CHECK_FALSE(afd::resolve_variables(deep, sample()).has_value());
    CHECK(afd::resolve_variables(deep["x"], sample()).has_value());
}

TEST_CASE("when conditions, including over unresolved paths") {
    const auto context = sample();
    const auto holds = [&](const char* condition) {
        return afd::evaluate_condition(afd::Json::parse(condition), context);
    };
    CHECK(holds(R"({"$exists":"$prev.id"})"));
    CHECK_FALSE(holds(R"({"$exists":"$prev.missing"})"));
    CHECK_FALSE(holds(R"({"$exists":"$steps.nobody.id"})"));
    CHECK(holds(R"({"$eq":["$prev.done",false]})"));
    CHECK(holds(R"({"$eq":["$first.items",[10,20,30]]})"));   // structural
    CHECK(holds(R"({"$eq":["$input",{"n":2,"q":"milk"}]})")); // key order ignored
    CHECK(holds(R"({"$eq":["$input.n",2.0]})"));
    CHECK_FALSE(holds(R"({"$ne":["$steps.nobody","x"]})")); // absent: false
    CHECK(holds(R"({"$ne":["$prev.id","other"]})"));
    CHECK(holds(R"({"$gt":["$input.n",1]})"));
    CHECK_FALSE(holds(R"({"$gt":["$prev.id",1]})")); // not a number
    CHECK_FALSE(holds(R"({"$lt":["$steps.nobody",1]})"));
    CHECK(holds(R"({"$and":[]})"));
    CHECK_FALSE(holds(R"({"$or":[]})"));
    CHECK(holds(R"({"$not":{"$exists":"$steps.nobody"}})"));
    CHECK_FALSE(holds(R"({"$exists":"not-a-reference"})"));
    CHECK_FALSE(holds(R"({"$exists":"$$prev"})"));
}

TEST_CASE("$exists is false for null") {
    afd::PipelineContext context = sample();
    context.steps[2].data = afd::Json{{"value", nullptr}};
    CHECK_FALSE(afd::evaluate_condition({{"$exists", "$prev.value"}}, context));
}
