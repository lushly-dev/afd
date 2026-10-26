// The golden journal fixture, spec/wire/journal.jsonl (spec/journal.md). The same session the
// TypeScript test records (packages/server/src/journal-wire.test.ts) is recorded here and must
// equal the file entry for entry as JSON. The file must round-trip through parse_journal and
// serialize_journal, and replay to `same` on a fresh registry.
#include "afd/afd.hpp"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

std::string fixture_text() {
    std::ifstream in(std::filesystem::path(AFD_WIRE_DIR) / "journal.jsonl", std::ios::binary);
    REQUIRE(in.good());
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> lines;
    std::size_t start = 0;
    for (std::size_t end = text.find('\n'); end != std::string::npos;
         start = end + 1, end = text.find('\n', start)) {
        lines.push_back(text.substr(start, end - start));
    }
    REQUIRE_MESSAGE(start == text.size(), "every line ends in a newline");
    return lines;
}

afd::Json json_of(const std::string& line) {
    auto parsed = afd::parse_bounded(line);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error().message);
    return *parsed;
}

/// TypeScript's clocks have one reading, `now()`: steady and wall time are the same here, so the
/// tape holds the fixture's epoch readings.
class EpochClock final : public afd::Clock {
public:
    explicit EpochClock(std::int64_t ms) : ms_(ms) {}
    [[nodiscard]] double steady_ms() const override { return static_cast<double>(ms_); }
    [[nodiscard]] std::int64_t wall_ms() const override { return ms_; }
    void advance(std::int64_t ms) { ms_ += ms; }

private:
    std::int64_t ms_;
};

afd::Json string_input(const char* name) {
    return {{"type", "object"},
            {"properties", {{name, {{"type", "string"}}}}},
            {"required", afd::Json::array({name})}};
}

// The fixture's todo commands: ids from context.random, timestamps from context.clock.
std::unique_ptr<afd::CommandRegistry> todo_registry(afd::CommandRegistryOptions options) {
    auto registry = std::make_unique<afd::CommandRegistry>(std::move(options));
    auto todos = std::make_shared<std::map<std::string, afd::Json>>();
    auto order = std::make_shared<std::vector<std::string>>();
    const afd::ExposeOptions mcp{.mcp = true};
    for (auto command : {
             afd::CommandDefinition{
                 .name = "todo-create",
                 .description = "Create a todo",
                 .input_schema = string_input("title"),
                 .handler =
                     [todos, order](const afd::Json& input, afd::CommandContext& context) {
                         char id[32];
                         std::snprintf(
                             id, sizeof id, "todo-%x",
                             static_cast<unsigned>(std::floor(context.random->next() * 0x10000)));
                         const std::string title = input.at("title").get<std::string>();
                         afd::Json todo = {
                             {"id", id},
                             {"title", title},
                             {"createdAt", afd::wire::iso8601_utc(context.clock->wall_ms())}};
                         (*todos)[id] = todo;
                         order->push_back(id);
                         return afd::success(
                             todo, {.confidence = 1, .reasoning = "Created \"" + title + "\""});
                     },
                 .version = "1.0.0",
                 .mutation = true,
                 .expose = mcp,
             },
             afd::CommandDefinition{
                 .name = "todo-get",
                 .description = "Get a todo",
                 .input_schema = string_input("id"),
                 .handler =
                     [todos](const afd::Json& input, afd::CommandContext&) {
                         const std::string id = input.at("id").get<std::string>();
                         const auto it = todos->find(id);
                         if (it == todos->end()) {
                             return afd::failure(afd::create_error(
                                 "NOT_FOUND", "Todo " + id + " not found",
                                 {.suggestion = "Use todo-list to see the todo ids"}));
                         }
                         return afd::success(it->second);
                     },
                 .version = "1.0.0",
                 .expose = mcp,
             },
             afd::CommandDefinition{
                 .name = "todo-list",
                 .description = "List todos",
                 .handler =
                     [todos, order](const afd::Json&, afd::CommandContext&) {
                         afd::Json items = afd::Json::array();
                         for (const auto& id : *order) {
                             items.push_back(todos->at(id));
                         }
                         return afd::success({{"items", items}, {"count", items.size()}});
                     },
                 .version = "1.0.0",
                 .expose = mcp,
             },
         }) {
        const auto error = registry->register_command(std::move(command));
        REQUIRE_MESSAGE(!error, error.value_or(""));
    }
    return registry;
}

std::vector<afd::JournalEntry> parse_fixture() {
    auto entries = afd::parse_journal(fixture_text());
    REQUIRE_MESSAGE(entries.has_value(), entries.error());
    return *entries;
}

} // namespace

TEST_CASE("journal.jsonl: a recorded session equals the fixture entry for entry") {
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    auto clock = std::make_shared<EpochClock>(1767225600000); // 2026-01-01T00:00:00Z
    auto registry = todo_registry(
        {.middleware = {afd::create_journal_middleware(sink, {.record_failures = true})},
         .clock = clock,
         .random = std::make_shared<afd::SeededRandom>("journal-fixture")});
    const afd::Actor agent{
        .kind = afd::ActorKind::agent, .label = "Claude", .on_behalf_of = "user-1"};
    const afd::Actor human{.kind = afd::ActorKind::human, .id = "user-1"};
    struct Call {
        const char* command;
        afd::Json input;
        afd::Actor actor;
        const char* trace_id;
    };
    for (const auto& call : std::vector<Call>{
             {"todo-create", {{"title", "Buy milk"}}, agent, "trace-1"},
             {"todo-create", {{"title", "Walk the dog"}}, human, "trace-2"},
             {"todo-get", {{"id", "todo-missing"}}, agent, "trace-3"},
             {"todo-list", afd::Json::object(), agent, "trace-4"},
         }) {
        afd::CommandContext context;
        context.trace_id = call.trace_id;
        context.actor = call.actor;
        context.surface = afd::Interface::mcp;
        (void)registry->execute(call.command, call.input, context);
        clock->advance(1000);
    }

    auto recorded = sink->read();
    REQUIRE(recorded.has_value());
    const auto lines = lines_of(afd::serialize_journal(*recorded));
    const auto expected = lines_of(fixture_text());
    REQUIRE(lines.size() == expected.size());
    for (std::size_t i = 0; i < lines.size(); ++i) {
        CAPTURE(i);
        // The context digest hashes match too: C++ and TypeScript name the same context keys.
        CHECK_MESSAGE(json_of(lines[i]) == json_of(expected[i]),
                      "\nexpected: " << expected[i] << "\nactual:   " << lines[i]);
    }
}

TEST_CASE("journal.jsonl round-trips through parse_journal and serialize_journal") {
    const auto entries = parse_fixture();
    REQUIRE(entries.size() == 4);
    for (std::size_t i = 0; i < entries.size(); ++i) {
        CHECK(entries[i].seq == static_cast<std::int64_t>(i + 1));
    }
    const auto expected = lines_of(fixture_text());
    const auto lines = lines_of(afd::serialize_journal(entries));
    REQUIRE(lines.size() == expected.size());
    for (std::size_t i = 0; i < lines.size(); ++i) {
        CAPTURE(i);
        CHECK(json_of(lines[i]) == json_of(expected[i]));
        // Top-level keys follow the spec's order, so each line matches the TypeScript text up to
        // the result, whose nested keys C++ writes sorted.
        const std::size_t result = expected[i].find(",\"result\":");
        REQUIRE(result != std::string::npos);
        CHECK(lines[i].substr(0, result) == expected[i].substr(0, result));
    }
    REQUIRE(entries[0].tape.has_value());
    CHECK(entries[0].tape->clock.size() == 3);
    CHECK(entries[0].tape->random == std::vector<double>{0.7345767796505243});
    CHECK(entries[0].context_digest.surface == "mcp");
    REQUIRE(entries[1].actor.has_value());
    CHECK(entries[1].actor->id == "user-1");
}

TEST_CASE("journal.jsonl replays to the same results on a fresh registry") {
    auto replay_sink = std::make_shared<afd::MemoryJournalSink>();
    // No fixed clock or seed: every value the handlers read comes from the tapes.
    auto fresh = todo_registry({.middleware = {afd::create_journal_middleware(replay_sink)}});
    const auto report =
        afd::replay_journal(*fresh, parse_fixture(), {.ignore = std::vector<std::string>{}});
    REQUIRE(report.entries.size() == 4);
    for (const auto& entry : report.entries) {
        CAPTURE(entry.seq);
        CHECK(entry.status == afd::ReplayStatus::same);
        CHECK(entry.notes.empty());
        CHECK(entry.differences.empty());
    }
    CHECK(report.same == 4);
    CHECK_FALSE(report.diverged);
    // The journal middleware records nothing during replay.
    CHECK(replay_sink->read()->empty());
}
