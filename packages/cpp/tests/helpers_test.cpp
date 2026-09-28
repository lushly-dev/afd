// Small helpers that mirror TypeScript core exports (metadata.ts, streaming.ts, batch.ts,
// pipeline.ts).
#include "afd/afd.hpp"

#include <doctest.h>

TEST_CASE("metadata helpers") {
    CHECK(afd::Json(afd::create_source("document", {.id = "doc-7"})) ==
          afd::Json{{"type", "document"}, {"id", "doc-7"}});
    const auto step = afd::create_step("store", "Store todo", "Write it");
    CHECK(step.status == afd::PlanStepStatus::pending);
    const auto running =
        afd::update_step_status(step, afd::PlanStepStatus::in_progress, afd::Json(1));
    CHECK_FALSE(running.result.has_value()); // a result is kept only on completion
    const auto done = afd::update_step_status(running, afd::PlanStepStatus::complete, afd::Json(1));
    CHECK(done.result == afd::Json(1));
    CHECK(afd::Json(afd::create_warning("W", "careful")) ==
          afd::Json{{"code", "W"}, {"message", "careful"}, {"severity", "warning"}});
    const afd::ErrorCode code = afd::error_codes::NOT_FOUND;
    CHECK(code == "NOT_FOUND");
}

TEST_CASE("stream chunk guards") {
    const afd::StreamChunk data = afd::create_data_chunk(1, 0, true);
    CHECK(afd::is_data_chunk(data));
    CHECK_FALSE(afd::is_error_chunk(data));
    CHECK(afd::is_progress_chunk(afd::StreamChunk{afd::create_progress_chunk(0.5)}));
    CHECK(afd::is_complete_chunk(afd::StreamChunk{afd::create_complete_chunk(1, 0)}));
    CHECK(afd::is_stream_chunk(afd::Json{{"type", "complete"}}));
    CHECK_FALSE(afd::is_stream_chunk(afd::Json{{"type", "other"}}));
    CHECK_FALSE(afd::is_stream_chunk(afd::Json::array()));
}

TEST_CASE("batch and pipeline helpers") {
    const auto request = afd::create_batch_request(
        {{std::nullopt, "a-b", afd::Json::object()}, {"mine", "c-d", std::nullopt}});
    CHECK(request.commands[0].id == "cmd-0");
    CHECK(request.commands[1].id == "mine");
    CHECK(afd::is_batch_request(afd::Json(request)));
    CHECK_FALSE(afd::is_batch_request(afd::Json{{"commands", afd::Json::array()}}));
    CHECK(afd::is_batch_result(afd::Json::parse(
        R"({"success":true,"results":[],"summary":{},"timing":{},"confidence":1,"reasoning":""})")));
    CHECK_FALSE(afd::is_batch_result(afd::Json{{"success", true}}));

    const auto pipeline = afd::create_pipeline({{.command = "a-b"}});
    CHECK(afd::Json(pipeline) == afd::Json{{"steps", {{{"command", "a-b"}}}}});
    CHECK(afd::is_pipeline_request(afd::Json(pipeline)));
    CHECK(afd::is_pipeline_result(
        afd::Json{{"metadata", afd::Json::object()}, {"steps", afd::Json::array()}}));
    CHECK_FALSE(afd::is_pipeline_result(afd::Json{{"steps", 1}}));
}
