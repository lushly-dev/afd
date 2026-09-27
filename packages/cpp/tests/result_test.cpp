#include "afd/afd.hpp"

#include <stdexcept>

#include <doctest.h>

namespace {

afd::Json serialize(const afd::CommandResult& result) {
    return result;
}

} // namespace

TEST_CASE("success and failure build the TypeScript shapes") {
    const auto ok =
        afd::success({{"id", "todo-1"}},
                     {.confidence = 0.9, .reasoning = "Created", .undo_command = "todo-delete"});
    CHECK(serialize(ok) == afd::Json::parse(R"({"success":true,"data":{"id":"todo-1"},
        "confidence":0.9,"reasoning":"Created","undoCommand":"todo-delete"})"));
    CHECK(afd::is_success(ok));

    const auto failed = afd::failure(afd::not_found_error("Todo", "42"));
    CHECK_FALSE(serialize(failed).contains("data"));
    CHECK(afd::is_failure(failed));

    const auto coded =
        afd::error("CUSTOM", "Something broke", {.suggestion = "Try again", .retryable = true});
    CHECK(serialize(coded) == afd::Json::parse(R"({"success":false,"error":{"code":"CUSTOM",
        "message":"Something broke","suggestion":"Try again","retryable":true}})"));
}

TEST_CASE("data: null is a value, distinct from absent data") {
    const auto null_data =
        afd::CommandResult::from_json(afd::Json::parse(R"({"success":true,"data":null})"));
    REQUIRE(null_data.has_value());
    REQUIRE(null_data->data.has_value());
    CHECK(null_data->data->is_null());
    CHECK(serialize(*null_data) == afd::Json::parse(R"({"success":true,"data":null})"));

    const auto no_data = afd::CommandResult::from_json(afd::Json::parse(R"({"success":false})"));
    REQUIRE(no_data.has_value());
    CHECK_FALSE(no_data->data.has_value());
    CHECK_FALSE(serialize(*no_data).contains("data"));
}

TEST_CASE("unset fields are omitted, never written as null") {
    afd::CommandResult result;
    result.success = true;
    result.metadata = afd::ResultMetadata{};
    const afd::Json out = result;
    CHECK(out == afd::Json::parse(R"({"success":true,"metadata":{}})"));
}

TEST_CASE("null optional members are read as absent") {
    const auto parsed = afd::CommandResult::from_json(
        afd::Json::parse(R"({"success":true,"reasoning":null,"metadata":{"traceId":null}})"));
    REQUIRE(parsed.has_value());
    CHECK_FALSE(parsed->reasoning.has_value());
    REQUIRE(parsed->metadata.has_value());
    CHECK_FALSE(parsed->metadata->trace_id.has_value());
}

TEST_CASE("from_json reports the path of the first problem") {
    const auto bad_code = afd::BatchResult::from_json(afd::Json::parse(R"({
        "success": true,
        "results": [{"id":"a","index":0,"command":"x","result":{"success":true},"durationMs":0},
                    {"id":"b","index":1,"command":"y",
                     "result":{"success":false,"error":{"code":7,"message":"m"}},"durationMs":0}],
        "summary": {"total":2,"successCount":1,"failureCount":1,"skippedCount":0},
        "timing": {"totalMs":0,"averageMs":0,"startedAt":"t","completedAt":"t"},
        "confidence": 0.5, "reasoning": "r"})"));
    REQUIRE_FALSE(bad_code.has_value());
    CHECK(bad_code.error() == "results[1].result.error.code: expected a string");

    const auto missing = afd::CommandResult::from_json(afd::Json::parse(R"({"data":1})"));
    REQUIRE_FALSE(missing.has_value());
    CHECK(missing.error() == "success: is required");

    const auto not_object = afd::CommandResult::from_json(afd::Json::parse("[]"));
    REQUIRE_FALSE(not_object.has_value());
    CHECK(not_object.error() == "(root): expected an object");

    const auto bad_status =
        afd::PlanStep::from_json(afd::Json::parse(R"({"id":"s","action":"a","status":"done"})"));
    REQUIRE_FALSE(bad_status.has_value());
    CHECK(bad_status.error() == "status: unknown value 'done'");
}

TEST_CASE("error causes round-trip, and hostile cause chains are bounded") {
    auto error = afd::internal_error("outer");
    error.cause = std::make_shared<const afd::CommandError>(afd::validation_error("inner"));
    const afd::Json json = error;
    const auto parsed = afd::CommandError::from_json(json);
    REQUIRE(parsed.has_value());
    REQUIRE(parsed->cause != nullptr);
    CHECK(parsed->cause->code == afd::error_codes::VALIDATION_ERROR);
    CHECK(afd::Json(*parsed) == json);

    afd::Json chain = {{"code", "E"}, {"message", "m"}};
    for (int i = 0; i < 100; ++i) {
        chain = afd::Json{{"code", "E"}, {"message", "m"}, {"cause", chain}};
    }
    const auto too_deep = afd::CommandError::from_json(chain);
    REQUIRE_FALSE(too_deep.has_value());
    CHECK(too_deep.error().find("cause chain is too deep") != std::string::npos);
}

TEST_CASE("error constructors match the TypeScript text") {
    const auto not_found = afd::not_found_error("Todo", "42");
    CHECK(not_found.code == "NOT_FOUND");
    CHECK(not_found.message == "Todo with ID '42' not found");
    CHECK(not_found.suggestion == "Verify the todo ID exists and try again");
    CHECK(not_found.retryable == false);
    CHECK(not_found.details == afd::Json{{"resourceType", "Todo"}, {"resourceId", "42"}});

    const auto validation = afd::validation_error("Bad title");
    CHECK(validation.code == "VALIDATION_ERROR");
    CHECK(validation.suggestion == "Check the input and try again");
    CHECK(validation.retryable == false);
    CHECK_FALSE(validation.details.has_value());

    const auto limited = afd::rate_limit_error(30);
    CHECK(limited.message == "Rate limit exceeded");
    CHECK(limited.suggestion == "Wait 30 seconds and try again");
    CHECK(limited.details == afd::Json{{"retryAfterSeconds", 30}});
    CHECK(limited.retryable == true);
    const auto limited_unknown = afd::rate_limit_error();
    CHECK(limited_unknown.suggestion == "Wait a moment and try again");
    CHECK_FALSE(limited_unknown.details.has_value());
    CHECK(afd::rate_limit_error(0).suggestion == "Wait a moment and try again");

    const auto timeout = afd::timeout_error("sync", 1500);
    CHECK(timeout.message == "Operation 'sync' timed out after 1500ms");
    CHECK(timeout.suggestion ==
          "Try again with a simpler request or contact support if this persists");
    CHECK(timeout.details == afd::Json{{"operationName", "sync"}, {"timeoutMs", 1500}});
    CHECK(afd::timeout_error("sync", 2.5).message == "Operation 'sync' timed out after 2.5ms");

    const auto internal = afd::internal_error("boom");
    CHECK(internal.code == "INTERNAL_ERROR");
    CHECK(internal.suggestion == "Please try again. If this persists, contact support.");
    CHECK(internal.retryable == true);

    CHECK(afd::wrap_error(not_found).message == not_found.message);
    CHECK(afd::wrap_error(std::runtime_error("disk full")).message == "disk full");
    CHECK(afd::wrap_error(std::runtime_error("disk full")).code == "INTERNAL_ERROR");
    CHECK(afd::wrap_error("odd").code == "UNKNOWN_ERROR");

    CHECK(afd::is_command_error(afd::Json{{"code", "X"}, {"message", "m"}}));
    CHECK_FALSE(afd::is_command_error(afd::Json{{"code", 1}, {"message", "m"}}));
    CHECK_FALSE(afd::is_command_error(afd::Json("X")));
}

TEST_CASE("execution_failure hides details outside dev mode") {
    const afd::Json hidden = afd::execution_failure("secret path /etc/x", false, "stack");
    CHECK(hidden == afd::Json::parse(R"({"success":false,"error":{"code":"COMMAND_EXECUTION_ERROR",
        "message":"An internal error occurred","suggestion":"Contact support if this persists"}})"));

    const afd::Json shown = afd::execution_failure("boom", true, "at handler");
    CHECK(shown == afd::Json::parse(R"({"success":false,"error":{"code":"COMMAND_EXECUTION_ERROR",
        "message":"boom","suggestion":"Check the command implementation",
        "details":{"stack":"at handler"}}})"));
}

TEST_CASE("metadata extra members round-trip without overriding named fields") {
    afd::ResultMetadata metadata;
    metadata.trace_id = "t-1";
    metadata.extra = {{"region", "eu"}, {"traceId", "ignored"}};
    const afd::Json out = metadata;
    CHECK(out == afd::Json{{"traceId", "t-1"}, {"region", "eu"}});
}
