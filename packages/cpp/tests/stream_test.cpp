// Stream execution semantics from packages/core/src/command-execution.ts `executeStream`.
#include "afd/afd.hpp"

#include <memory>
#include <vector>

#include <doctest.h>

namespace {

afd::CommandExecutor returning(afd::CommandResult result,
                               std::shared_ptr<afd::ManualClock> clock = nullptr,
                               double advance_ms = 0) {
    return [result, clock, advance_ms](std::string_view, const afd::Json&, afd::CommandContext&) {
        if (clock) {
            clock->advance(advance_ms);
        }
        return result;
    };
}

afd::Json as_json(const std::vector<afd::StreamChunk>& chunks) {
    afd::Json out = afd::Json::array();
    for (const auto& chunk : chunks) {
        out.push_back(chunk);
    }
    return out;
}

} // namespace

TEST_CASE("an array result streams one data chunk per item, then complete") {
    auto clock = std::make_shared<afd::ManualClock>();
    const auto chunks =
        afd::execute_stream("todo-list", afd::Json::object(),
                            returning(afd::success(afd::Json::array({1, 2}),
                                                   {.confidence = 0.8, .reasoning = "Listed"}),
                                      clock, 7),
                            {}, {{.clock = clock}});
    CHECK(as_json(chunks) == afd::Json::parse(R"([
        {"type":"data","data":1,"index":0,"isLast":false},
        {"type":"data","data":2,"index":1,"isLast":true},
        {"type":"complete","totalChunks":2,"totalDurationMs":7,"confidence":0.8,"reasoning":"Listed"}])"));
}

TEST_CASE("a non-array result is one data chunk; an empty array is none") {
    CHECK(as_json(afd::execute_stream("a-b", {}, returning(afd::success({{"id", 1}}))))[0] ==
          afd::Json::parse(R"({"type":"data","data":{"id":1},"index":0,"isLast":true})"));
    const auto empty = afd::execute_stream("a-b", {}, returning(afd::success(afd::Json::array())));
    REQUIRE(empty.size() == 1);
    CHECK(std::get_if<afd::CompleteChunk>(&empty[0])->total_chunks == 0);
}

TEST_CASE("a failure result becomes an error chunk; recoverable follows retryable") {
    const auto failed = afd::execute_stream(
        "a-b", {},
        returning(afd::failure(afd::create_error("BUSY", "Try later", {.retryable = true}))));
    REQUIRE(failed.size() == 1);
    const auto* error = std::get_if<afd::ErrorChunk>(&failed[0]);
    REQUIRE(error != nullptr);
    CHECK(error->error.code == "BUSY");
    CHECK(error->recoverable);
    CHECK(error->chunks_before_error == 0);

    afd::CommandResult no_error;
    const auto defaulted = afd::execute_stream("a-b", {}, returning(no_error));
    CHECK(std::get_if<afd::ErrorChunk>(&defaulted[0])->error.code == "COMMAND_FAILED");
    CHECK_FALSE(std::get_if<afd::ErrorChunk>(&defaulted[0])->recoverable);
}

TEST_CASE("invalid timeouts and cancelled callers stop before running") {
    int runs = 0;
    const afd::CommandExecutor counting = [&](std::string_view, const afd::Json&,
                                              afd::CommandContext&) {
        ++runs;
        return afd::success(1);
    };
    afd::StreamOptions negative;
    negative.timeout = -1;
    const auto invalid = afd::execute_stream("a-b", {}, counting, {}, negative);
    CHECK(std::get_if<afd::ErrorChunk>(&invalid[0])->error.code == "VALIDATION_ERROR");

    afd::CancellationSource source;
    source.cancel();
    afd::CommandContext cancelled;
    cancelled.cancellation = source.token();
    const auto aborted = afd::execute_stream("a-b", {}, counting, cancelled);
    CHECK(std::get_if<afd::ErrorChunk>(&aborted[0])->error.message ==
          "Stream was aborted before starting");
    CHECK(runs == 0);
}

TEST_CASE("passing the deadline during execution gives STREAM_TIMEOUT, over the result") {
    auto clock = std::make_shared<afd::ManualClock>();
    afd::StreamOptions options;
    options.clock = clock;
    options.timeout = 10;
    const auto chunks = afd::execute_stream(
        "a-b", {}, returning(afd::success(afd::Json::array({1, 2})), clock, 20), {}, options);
    REQUIRE(chunks.size() == 1);
    CHECK(afd::Json(chunks[0]) ==
          afd::Json::parse(R"({"type":"error","error":{"code":"STREAM_TIMEOUT",
        "message":"Stream timed out after 10ms","suggestion":"Increase the stream timeout, or request less data, and retry",
        "retryable":true},"chunksBeforeError":0,"recoverable":true})"));
}

TEST_CASE("consume_stream dispatches chunks and returns the final one") {
    const auto chunks =
        afd::execute_stream("a-b", {}, returning(afd::success(afd::Json::array({1, 2}))));
    std::vector<afd::Json> data;
    int completes = 0;
    const auto last = afd::consume_stream(
        chunks, {.on_data = [&](const afd::DataChunk& chunk) { data.push_back(chunk.data); },
                 .on_complete = [&](const afd::CompleteChunk&) { ++completes; }});
    CHECK(data == std::vector<afd::Json>{1, 2});
    CHECK(completes == 1);
    CHECK(std::holds_alternative<afd::CompleteChunk>(last));

    const auto ended = afd::consume_stream({afd::create_data_chunk(1, 0, false)});
    REQUIRE(std::holds_alternative<afd::ErrorChunk>(ended));
    CHECK(std::get_if<afd::ErrorChunk>(&ended)->error.code == "STREAM_ENDED_UNEXPECTEDLY");
}

TEST_CASE("collect_stream_data returns the data or the first error") {
    const auto ok = afd::collect_stream_data(
        afd::execute_stream("a-b", {}, returning(afd::success(afd::Json::array({1, 2})))));
    REQUIRE(ok.has_value());
    CHECK(*ok == std::vector<afd::Json>{1, 2});
    const auto failed = afd::collect_stream_data(
        afd::execute_stream("a-b", {}, returning(afd::failure(afd::create_error("E", "broken")))));
    REQUIRE_FALSE(failed.has_value());
    CHECK(failed.error().code == "E");
}

TEST_CASE("chunk factories") {
    CHECK(afd::create_progress_chunk(1.5).progress == 1.0);
    CHECK(afd::create_progress_chunk(-1).progress == 0.0);
    CHECK_FALSE(afd::create_data_chunk(1, 0, true, "").chunk_id.has_value());
    CHECK(afd::create_data_chunk(1, 0, true, "c-1").chunk_id == "c-1");
    CHECK_FALSE(afd::create_error_chunk(afd::create_error("E", "m"), 0).resume_from.has_value());
}

TEST_CASE("the registry streams through execute") {
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry
                      .register_command({.name = "todo-list",
                                         .description = "List",
                                         .handler =
                                             [](const afd::Json&, afd::CommandContext&) {
                                                 return afd::success(afd::Json::array({"a", "b"}));
                                             }})
                      .has_value());
    CHECK(afd::collect_stream_data(registry.execute_stream("todo-list")).value() ==
          std::vector<afd::Json>{"a", "b"});
    const auto missing = registry.execute_stream("todo-lst");
    CHECK(std::get_if<afd::ErrorChunk>(&missing[0])->error.code == "COMMAND_NOT_FOUND");
}
