// What the journal records for a call that ends at a deadline (#2678; spec/journal.md, "Calls
// that end at a deadline"). The handler blocks on a gate the test opens, and the deadline is on a
// ManualClock the test moves, so nothing here races a timer: the call runs on its own thread,
// the test moves the clock past the deadline while the handler waits, then opens the gate.
// The tests build without exceptions (DOCTEST_CONFIG_NO_EXCEPTIONS_BUT_WITH_ALL_ASSERTS), where a
// failed REQUIRE does not stop the test, so nothing here dereferences what a check found missing.
#include "afd/afd.hpp"

#if AFD_ENABLE_THREADS

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <doctest.h>

namespace {

/// Opened once by the test; the handler says when it is waiting on it.
struct Gate {
    std::mutex mutex;
    std::condition_variable changed;
    bool started = false;
    bool open = false;

    /// Whether the handler started. The bound only turns a call that never reaches the handler
    /// into a failure rather than a hang; a passing run never waits that long.
    bool wait_started() {
        std::unique_lock lock(mutex);
        return changed.wait_for(lock, std::chrono::seconds(10), [&] { return started; });
    }
    void release() {
        {
            const std::lock_guard lock(mutex);
            open = true;
        }
        changed.notify_all();
    }
    void enter() {
        std::unique_lock lock(mutex);
        started = true;
        changed.notify_all();
        changed.wait(lock, [&] { return open; });
    }
};

struct Fixture {
    std::shared_ptr<afd::ManualClock> clock = afd::fixed_clock(1767225600000);
    std::shared_ptr<afd::MemoryJournalSink> sink = std::make_shared<afd::MemoryJournalSink>();
    std::shared_ptr<Gate> gate = std::make_shared<Gate>();
    std::shared_ptr<afd::CommandRegistry> registry;
    std::shared_ptr<std::atomic<int>> quick_runs = std::make_shared<std::atomic<int>>(0);
    /// How many entries the journal held when the call returned, read on the caller's thread.
    std::size_t entries_at_return = 0;

    /// `outer` runs before the journal middleware.
    explicit Fixture(std::vector<afd::CommandMiddleware> outer = {}) {
        outer.push_back(afd::create_journal_middleware(sink, {.record_failures = true}));
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = std::move(outer), .clock = clock});
        auto held = gate;
        REQUIRE_FALSE(registry->register_command(
            afd::CommandDefinition{.name = "work-slow",
                                   .description = "Wait for the test",
                                   .handler = [held](const afd::Json&, afd::CommandContext&) {
                                       held->enter();
                                       return afd::success("late");
                                   }}));
        REQUIRE_FALSE(registry->register_command(afd::CommandDefinition{
            .name = "work-quick",
            .description = "Return at once",
            .handler = [runs = quick_runs](const afd::Json&, afd::CommandContext&) {
                ++*runs;
                return afd::success("quick");
            }}));
    }

    /// The entry count, for another thread: no assertion, which only the test's thread makes.
    std::size_t entries_now() const {
        auto read = sink->read();
        return read.has_value() ? read->size() : 0;
    }

    std::vector<afd::JournalEntry> entries() const {
        auto read = sink->read();
        CHECK(read.has_value());
        return read.has_value() ? *read : std::vector<afd::JournalEntry>{};
    }

    /// Runs `call` on its own thread, moves the clock past a 20 ms deadline while the gate holds
    /// the call, checks the journal is still empty, then opens the gate and waits for the call.
    /// The caller's thread counts the entries as soon as the call returns, so a test can pin that
    /// the entry was written before the caller was given the deadline failure.
    template <typename Call>
    auto run_past_deadline(Call call) {
        decltype(call()) result;
        std::thread caller([&] {
            result = call();
            entries_at_return = entries_now();
        });
        const bool started = gate->wait_started();
        if (started) {
            clock->advance(25);
            // The engine has not stopped waiting: nothing is recorded while the handler runs.
            CHECK(entries().empty());
        }
        gate->release();
        caller.join();
        REQUIRE_MESSAGE(started, "the handler never started");
        return result;
    }
};

/// The error code, or "" for a result without an error.
std::string code_of(const std::optional<afd::CommandError>& error) {
    return error ? error->code : std::string();
}

void check_one_late_entry(const Fixture& f) {
    CHECK_MESSAGE(f.entries_at_return == 1, "the entry was written before the call returned");
    const auto entries = f.entries();
    REQUIRE(entries.size() == 1);
    if (entries.size() == 1) {
        CHECK(entries[0].command == "work-slow");
        CHECK(entries[0].result.success);
        CHECK(entries[0].result.data == afd::Json("late"));
    }
}

} // namespace

TEST_CASE("journal at TIMEOUT: the handler's result, recorded when it returns") {
    Fixture f;
    afd::CommandContext context;
    context.timeout_ms = 20;
    const auto result = f.run_past_deadline(
        [&] { return f.registry->execute("work-slow", afd::Json::object(), context); });
    CHECK(code_of(result.error) == afd::error_codes::TIMEOUT);
    check_one_late_entry(f);
}

TEST_CASE("journal at a DirectClient TIMEOUT: the same, inside the registry") {
    Fixture f;
    const afd::DirectClient client(f.registry, {.clock = f.clock});
    afd::CommandContext context;
    context.timeout_ms = 20;
    const auto result =
        f.run_past_deadline([&] { return client.call("work-slow", afd::Json::object(), context); });
    CHECK(code_of(result.error) == afd::error_codes::TIMEOUT);
    check_one_late_entry(f);
}

TEST_CASE("journal at BATCH_TIMEOUT: the running item recorded, the unstarted one never") {
    Fixture f;
    const afd::Json request = {{"commands",
                                {{{"command", "work-slow"}, {"input", afd::Json::object()}},
                                 {{"command", "work-quick"}, {"input", afd::Json::object()}}}},
                               {"options", {{"timeout", 20}, {"parallelism", 1}}}};
    const auto batch = f.run_past_deadline([&] { return f.registry->execute_batch(request); });
    REQUIRE(batch.results.size() == 2);
    for (const auto& item : batch.results) {
        CHECK(code_of(item.result.error) == afd::error_codes::BATCH_TIMEOUT);
    }
    check_one_late_entry(f);
}

TEST_CASE("journal at PIPELINE_TIMEOUT: the running step recorded, the later one never") {
    Fixture f;
    const afd::Json request = {{"steps", {{{"command", "work-slow"}}, {{"command", "work-quick"}}}},
                               {"options", {{"timeoutMs", 20}}}};
    const auto pipeline =
        f.run_past_deadline([&] { return f.registry->execute_pipeline(request); });
    REQUIRE(pipeline.steps.size() == 2);
    for (const auto& step : pipeline.steps) {
        CHECK(code_of(step.error) == afd::error_codes::PIPELINE_TIMEOUT);
    }
    check_one_late_entry(f);
}

TEST_CASE(
    "journal at a deadline before the handler starts: COMMAND_CANCELLED, handler never runs") {
    // A middleware outside the journal holds the call, as an approval wait can, past the deadline.
    std::shared_ptr<Gate> hold = std::make_shared<Gate>();
    Fixture f(
        {[hold](std::string_view, const afd::Json&, afd::CommandContext&, const afd::Next& next) {
            hold->enter();
            return next();
        }});
    f.gate = hold;
    afd::CommandContext context;
    context.timeout_ms = 20;
    const auto result = f.run_past_deadline(
        [&] { return f.registry->execute("work-quick", afd::Json::object(), context); });
    CHECK(code_of(result.error) == afd::error_codes::TIMEOUT);
    CHECK(f.entries_at_return == 1);
    const auto entries = f.entries();
    REQUIRE(entries.size() == 1);
    if (entries.size() == 1) {
        CHECK(entries[0].command == "work-quick");
        CHECK(code_of(entries[0].result.error) == afd::error_codes::COMMAND_CANCELLED);
    }
    CHECK(f.quick_runs->load() == 0);
}

#endif
