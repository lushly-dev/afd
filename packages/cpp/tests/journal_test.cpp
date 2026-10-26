// The command journal and replay (packages/core/src/journal.test.ts,
// packages/server/src/journal.test.ts and journal-replay.test.ts, #273).
#include "afd/afd.hpp"

#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

void add_journaled(afd::CommandRegistry& registry, afd::CommandDefinition command) {
    const auto error = registry.register_command(std::move(command));
    REQUIRE_MESSAGE(!error, error.value_or(""));
}

afd::JournalRecord journal_record(std::string command) {
    return {.timestamp = "2026-01-01T00:00:00.000Z",
            .command = std::move(command),
            .context_digest = {.hash = "sha256:00"},
            .result = afd::success(afd::Json::object())};
}

afd::JournalEntry entry_of(std::int64_t seq, std::string command) {
    afd::JournalEntry entry;
    static_cast<afd::JournalRecord&>(entry) = journal_record(std::move(command));
    entry.seq = seq;
    return entry;
}

std::vector<std::int64_t> journal_seqs(const std::vector<afd::JournalEntry>& entries) {
    std::vector<std::int64_t> out;
    for (const auto& entry : entries) {
        out.push_back(entry.seq);
    }
    return out;
}

afd::Json valid_entry() {
    return {{"seq", 1},
            {"timestamp", "2026-01-01T00:00:00.000Z"},
            {"command", "todo-list"},
            {"input", afd::Json::object()},
            {"contextDigest", {{"hash", "sha256:00"}}},
            {"result", {{"success", true}}},
            {"durationMs", 0}};
}

/// A registry whose `note-add` handler reads the clock and the random source, with `middleware`.
struct JournalRecorder {
    std::shared_ptr<afd::MemoryJournalSink> sink = std::make_shared<afd::MemoryJournalSink>();
    std::shared_ptr<afd::ManualClock> clock = afd::fixed_clock(1767225600000);
    std::unique_ptr<afd::CommandRegistry> registry;

    explicit JournalRecorder(afd::JournalMiddlewareOptions options = {},
                             std::vector<afd::CommandMiddleware> outer = {}) {
        outer.push_back(afd::create_journal_middleware(sink, std::move(options)));
        registry = std::make_unique<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = std::move(outer),
                                        .clock = clock,
                                        .random = std::make_shared<afd::SeededRandom>("notes")});
        add_journaled(*registry, note_add());
        add_journaled(*registry, afd::CommandDefinition{
                                     .name = "note-fail",
                                     .description = "Always fails",
                                     .handler = [](const afd::Json&, afd::CommandContext&) {
                                         return afd::error("NOPE", "Always fails",
                                                           {.suggestion = "Do not call it"});
                                     }});
        add_journaled(*registry,
                      afd::CommandDefinition{.name = "auth-sign-in",
                                             .description = "Takes a password",
                                             .handler = [](const afd::Json&, afd::CommandContext&) {
                                                 return afd::success({{"token", "secret-token"}});
                                             }});
    }

    static afd::CommandDefinition note_add() {
        return {.name = "note-add",
                .description = "Add a note",
                .input_schema = {{"type", "object"},
                                 {"properties", {{"text", {{"type", "string"}}}}},
                                 {"required", {"text"}}},
                .handler = [](const afd::Json& input, afd::CommandContext& context) {
                    return afd::success({{"text", input.at("text")},
                                         {"at", context.clock->wall_ms()},
                                         {"roll", context.random->next()}});
                }};
    }

    std::vector<afd::JournalEntry> entries() {
        auto read = sink->read();
        REQUIRE(read.has_value());
        return *read;
    }
};

/// A sink whose appends always fail.
class FailingSink final : public afd::JournalSink {
public:
    afd::Expected<afd::JournalEntry> append(afd::JournalRecord) override {
        return afd::unexpected(std::string("disk full"));
    }
    afd::Expected<std::vector<afd::JournalEntry>> read(afd::JournalRange) override {
        return std::vector<afd::JournalEntry>{};
    }
};

} // namespace

// --- entries and sinks --------------------------------------------------------------------

TEST_CASE("MemoryJournalSink assigns seq, continues a journal and reads inclusive ranges") {
    afd::MemoryJournalSink sink({entry_of(7, "b-b"), entry_of(3, "a-a")});
    auto appended = sink.append(journal_record("c-c"));
    REQUIRE(appended.has_value());
    CHECK(appended->seq == 8);
    CHECK(journal_seqs(*sink.read()) == std::vector<std::int64_t>{3, 7, 8});
    CHECK(journal_seqs(*sink.read({.from = 4})) == std::vector<std::int64_t>{7, 8});
    CHECK(journal_seqs(*sink.read({.from = 3, .to = 7})) == std::vector<std::int64_t>{3, 7});
    CHECK(afd::MemoryJournalSink().append(journal_record("a-a"))->seq == 1);
}

TEST_CASE("is_journal_entry follows the spec's shape") {
    CHECK(afd::is_journal_entry(valid_entry()));
    const auto with = [](const char* key, afd::Json value) {
        afd::Json entry = valid_entry();
        entry[key] = std::move(value);
        return entry;
    };
    const auto without = [](const char* key) {
        afd::Json entry = valid_entry();
        entry.erase(key);
        return entry;
    };
    CHECK(afd::is_journal_entry(with("seq", 2.0)));
    CHECK(afd::is_journal_entry(with("input", nullptr))); // null is an input
    CHECK(afd::is_journal_entry(with("tape", {{"clock", {1, 2}}, {"random", afd::Json::array()}})));
    CHECK_FALSE(afd::is_journal_entry(with("seq", 0)));
    CHECK_FALSE(afd::is_journal_entry(with("seq", 1.5)));
    CHECK_FALSE(afd::is_journal_entry(with("seq", 9007199254740992.0)));
    CHECK_FALSE(afd::is_journal_entry(with("traceId", nullptr))); // unset is omitted, never null
    CHECK_FALSE(afd::is_journal_entry(with("actor", {{"kind", "robot"}})));
    CHECK_FALSE(afd::is_journal_entry(with("contextDigest", afd::Json::object())));
    CHECK_FALSE(afd::is_journal_entry(with("result", {{"success", "yes"}})));
    CHECK_FALSE(afd::is_journal_entry(with("durationMs", "0")));
    CHECK_FALSE(afd::is_journal_entry(with("tape", {{"clock", {1}}})));
    CHECK_FALSE(afd::is_journal_entry(with("tape", {{"clock", {"1"}}, {"random", {0.5}}})));
    CHECK_FALSE(afd::is_journal_entry(without("input")));
    CHECK_FALSE(afd::is_journal_entry(without("command")));
    CHECK_FALSE(afd::is_journal_entry(afd::Json::array()));
}

TEST_CASE("JournalEntry::from_json names the field it rejects") {
    afd::Json entry = valid_entry();
    entry["tape"] = {{"clock", {1}}, {"random", {"x"}}};
    const auto parsed = afd::JournalEntry::from_json(entry);
    REQUIRE_FALSE(parsed.has_value());
    CHECK(parsed.error() == "tape.random: expected an array of finite numbers");
}

TEST_CASE("parse_journal skips blank lines, accepts CRLF and names the bad line") {
    const std::string line = afd::wire::serialize(valid_entry());
    auto two = afd::parse_journal(line + "\r\n\n  \n" + line);
    REQUIRE_MESSAGE(two.has_value(), two.error());
    CHECK(two->size() == 2);
    CHECK(afd::parse_journal("")->empty());

    const auto not_json = afd::parse_journal(line + "\n{oops\n");
    REQUIRE_FALSE(not_json.has_value());
    CHECK(not_json.error().rfind("Journal line 2 is not valid JSON: ", 0) == 0);
    const auto not_entry = afd::parse_journal("\n" + line + "\n{\"seq\":1}\n");
    REQUIRE_FALSE(not_entry.has_value());
    CHECK(not_entry.error().rfind("Journal line 3 is not a journal entry: ", 0) == 0);
    // Each line goes through parse_bounded's limits.
    CHECK_FALSE(afd::parse_journal(line, {.max_depth = 1}).has_value());
}

TEST_CASE("serialize_journal writes one line per entry, keys in the spec's order") {
    afd::JournalEntry entry = entry_of(4, "note-add");
    entry.trace_id = "trace\nwith a newline";
    entry.tape = afd::JournalTape{.clock = {1.5}, .random = {}, .truncated = true};
    const std::string text = afd::serialize_journal({entry, entry_of(5, "note-add")});
    CHECK(text.find('\n') == text.find("}\n") + 1); // the newline in the trace ID is escaped
    CHECK(text.rfind("{\"seq\":4,\"timestamp\":", 0) == 0);
    CHECK(text.find("\"tape\":{\"clock\":[1.5],\"random\":[],\"truncated\":true}}\n") !=
          std::string::npos);
    auto back = afd::parse_journal(text);
    REQUIRE(back.has_value());
    CHECK(afd::Json(back->at(0)) == afd::Json(entry));
}

// --- context digest: no secrets -----------------------------------------------------------

TEST_CASE("create_context_digest hashes the allowlist and key names, never other values") {
    afd::CommandContext context;
    context.trace_id = "trace-1";
    context.actor =
        afd::Actor{.kind = afd::ActorKind::agent, .label = "Claude", .on_behalf_of = "user-1"};
    context.surface = afd::Interface::mcp;
    context.clock = afd::fixed_clock();
    context.random = std::make_shared<afd::SeededRandom>("x");
    // The same input as spec/wire/journal.jsonl's first entry, so the same hash as TypeScript.
    const auto digest = afd::create_context_digest(context);
    CHECK(digest.hash == "sha256:93446ef6497335d8e4510fef9fb11dd12398e71dc24b0d8738dfdede3ae9e6e9");
    CHECK(digest.surface == "mcp");

    afd::CommandContext with_secret = context;
    with_secret.extra = {{"authToken", "secret-1"}};
    afd::CommandContext other_secret = context;
    other_secret.extra = {{"authToken", "secret-2"}};
    const auto first = afd::create_context_digest(with_secret);
    CHECK(first.hash != digest.hash);                                   // another key name
    CHECK(first.hash == afd::create_context_digest(other_secret).hash); // never the value

    afd::CommandContext empty;
    CHECK(afd::create_context_digest(empty).hash ==
          afd::create_context_digest(afd::CommandContext{}).hash);
    CHECK_FALSE(afd::create_context_digest(empty).surface.has_value());
}

TEST_CASE("journal entries never hold auth or session values from the context") {
    JournalRecorder recorder;
    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::human, .id = "user-1"};
    context.extra = {{"authorization", "Bearer secret-bearer"},
                     {"session", {{"token", "secret-session"}, {"userId", "user-1"}}},
                     {"cookie", "sid=secret-cookie"}};
    REQUIRE(recorder.registry->execute("note-add", {{"text", "hi"}}, context).success);
    const auto entries = recorder.entries();
    REQUIRE(entries.size() == 1);
    const std::string line = afd::serialize_journal_entry(entries[0]);
    CHECK(line.find("secret") == std::string::npos);
    CHECK(line.find("Bearer") == std::string::npos);
    CHECK(line.find("sid=") == std::string::npos);
    REQUIRE(entries[0].actor.has_value());
    CHECK(entries[0].actor->id == "user-1");
}

// --- recording ----------------------------------------------------------------------------

TEST_CASE("the journal middleware records successful calls with their tape") {
    JournalRecorder recorder;
    afd::CommandContext context;
    context.trace_id = "trace-9";
    context.surface = afd::Interface::agent;
    const auto result = recorder.registry->execute("note-add", {{"text", "hi"}, {"x", 1}}, context);
    REQUIRE(result.success);
    const auto entries = recorder.entries();
    REQUIRE(entries.size() == 1);
    const auto& entry = entries[0];
    CHECK(entry.seq == 1);
    CHECK(entry.command == "note-add");
    CHECK(entry.timestamp == "2026-01-01T00:00:00.000Z");
    CHECK(entry.trace_id == "trace-9");
    CHECK(entry.input == afd::Json{{"text", "hi"}}); // validated: the undeclared key is gone
    CHECK(entry.context_digest.surface == "agent");
    CHECK(afd::Json(entry.result) == afd::Json(result));
    REQUIRE(entry.tape.has_value());
    // The registry's two steady readings around the handler, and the handler's wall reading.
    CHECK(entry.tape->clock == std::vector<double>{0, 1767225600000, 0});
    CHECK(entry.tape->random == std::vector<double>{afd::SeededRandom("notes").next()});
    CHECK_FALSE(entry.tape->truncated);
}

TEST_CASE("the journal middleware skips failures, auth-* and validation errors by default") {
    JournalRecorder recorder;
    CHECK_FALSE(recorder.registry->execute("note-fail").success);
    CHECK(recorder.registry->execute("auth-sign-in").success);
    CHECK_FALSE(recorder.registry->execute("note-add", {{"text", 1}}).success);
    CHECK(recorder.entries().empty());

    JournalRecorder failures({.record_failures = true});
    CHECK_FALSE(failures.registry->execute("note-fail").success);
    const auto entries = failures.entries();
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].result.error->code == "NOPE");
    REQUIRE(entries[0].tape.has_value());
    CHECK(entries[0].tape->clock.size() == 2); // the registry's timing of the handler
    CHECK(entries[0].tape->random.empty());
}

TEST_CASE("filter, redact and max_tape_reads shape what is stored") {
    JournalRecorder filtered({.filter = [](std::string_view name) { return name != "note-add"; }});
    CHECK(filtered.registry->execute("auth-sign-in").success); // a custom filter replaces auth-*
    CHECK(filtered.registry->execute("note-add", {{"text", "a"}}).success);
    REQUIRE(filtered.entries().size() == 1);
    CHECK(filtered.entries()[0].command == "auth-sign-in");

    JournalRecorder redacted(
        {.redact = [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
            if (record.input.value("text", "") == "skip") {
                return std::nullopt;
            }
            record.input["text"] = "[redacted]";
            record.tape.reset();
            return record;
        }});
    CHECK(redacted.registry->execute("note-add", {{"text", "skip"}}).success);
    CHECK(redacted.registry->execute("note-add", {{"text", "secret"}}).success);
    const auto entries = redacted.entries();
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].input.at("text") == "[redacted]");
    CHECK_FALSE(entries[0].tape.has_value());

    JournalRecorder truncated({.max_tape_reads = 1});
    CHECK(truncated.registry->execute("note-add", {{"text", "a"}}).success);
    REQUIRE(truncated.entries()[0].tape.has_value());
    CHECK(truncated.entries()[0].tape->clock.size() == 1);
    CHECK(truncated.entries()[0].tape->random.size() == 1);
    CHECK(truncated.entries()[0].tape->truncated);
}

TEST_CASE("a sink failure goes to on_error and never changes the result") {
    std::vector<std::string> errors;
    auto registry = std::make_unique<afd::CommandRegistry>(afd::CommandRegistryOptions{
        .middleware = {afd::create_journal_middleware(
            std::make_shared<FailingSink>(),
            {.on_error = [&errors](std::string_view message) { errors.emplace_back(message); }})}});
    add_journaled(*registry, JournalRecorder::note_add());
    CHECK(registry->execute("note-add", {{"text", "a"}}).success);
    CHECK(errors == std::vector<std::string>{"disk full"});
}

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
TEST_CASE("a throwing handler is recorded without the exception message, and still throws") {
    JournalRecorder recorder({.record_failures = true});
    add_journaled(*recorder.registry,
                  afd::CommandDefinition{
                      .name = "note-throw",
                      .description = "Throws",
                      .handler = [](const afd::Json&, afd::CommandContext&) -> afd::CommandResult {
                          throw std::runtime_error("secret detail");
                      }});
    const auto result = recorder.registry->execute("note-throw");
    CHECK(result.error->code == "COMMAND_EXECUTION_ERROR");
    const auto entries = recorder.entries();
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].result.error->code == "COMMAND_EXECUTION_ERROR");
    CHECK(afd::serialize_journal_entry(entries[0]).find("secret") == std::string::npos);
}
#endif

TEST_CASE("an inner journal's own timing stays off the outer journal's tape") {
    auto inner_sink = std::make_shared<afd::MemoryJournalSink>();
    JournalRecorder recorder({}, {});
    recorder.registry->use(afd::create_journal_middleware(inner_sink));
    CHECK(recorder.registry->execute("note-add", {{"text", "a"}}).success);
    const auto outer = recorder.entries();
    const auto inner = *inner_sink->read();
    REQUIRE(outer.size() == 1);
    REQUIRE(inner.size() == 1);
    CHECK(outer[0].tape->clock == inner[0].tape->clock);
    CHECK(outer[0].tape->random == inner[0].tape->random);
}

// --- replay -------------------------------------------------------------------------------

TEST_CASE("replay restores the tape and reports same, different and error") {
    JournalRecorder recorder;
    REQUIRE(recorder.registry->execute("note-add", {{"text", "a"}}).success);
    recorder.clock->advance(5000);
    REQUIRE(recorder.registry->execute("note-add", {{"text", "b"}}).success);
    auto entries = recorder.entries();

    // A fresh registry with another clock and seed: the tape decides what the handler sees.
    JournalRecorder fresh;
    fresh.clock->set(0);
    auto report = afd::replay_journal(*fresh.registry, entries);
    CHECK(report.same == 2);
    CHECK_FALSE(report.diverged);
    CHECK(fresh.entries().empty());

    entries[1].result.data = afd::Json{{"text", "changed"}, {"extra", true}};
    entries.push_back(entry_of(9, "note-add"));
    entries.back().timestamp = "yesterday";
    report = afd::replay_journal(*fresh.registry, entries);
    REQUIRE(report.entries.size() == 3);
    CHECK(report.same == 1);
    CHECK(report.different == 1);
    CHECK(report.errors == 1);
    CHECK(report.diverged);
    const auto& different = report.entries[1];
    CHECK(different.status == afd::ReplayStatus::different);
    REQUIRE(different.differences.size() == 4);
    CHECK(different.differences[0].path == "data.at");
    CHECK(different.differences[0].kind == afd::ReplayDifferenceKind::added);
    CHECK(different.differences[1].path == "data.extra");
    CHECK(different.differences[1].kind == afd::ReplayDifferenceKind::removed);
    CHECK(different.differences[2].path == "data.roll");
    CHECK(different.differences[3].path == "data.text");
    CHECK(different.differences[3].kind == afd::ReplayDifferenceKind::changed);
    CHECK(different.differences[3].recorded == afd::Json("changed"));
    CHECK(different.differences[3].replayed == afd::Json("b"));
    CHECK(report.entries[2].status == afd::ReplayStatus::error);
    CHECK(report.entries[2].error.value_or("").find("yesterday") != std::string::npos);

    report = afd::replay_journal(
        *fresh.registry, entries,
        {.ignore = std::vector<std::string>{"data", "metadata"}, .stop_on_divergence = true});
    CHECK(report.same == 2);
    CHECK(report.errors == 1);

    report = afd::replay_journal(*fresh.registry, entries,
                                 {.stop_on_divergence = true, .max_differences = 1});
    CHECK(report.entries.size() == 2);
    CHECK(report.skipped == 1);
    CHECK(report.entries[1].differences.size() == 1);
}

TEST_CASE("replay notes tapes that run out or are not used up") {
    JournalRecorder recorder;
    REQUIRE(recorder.registry->execute("note-add", {{"text", "a"}}).success);
    auto entries = recorder.entries();
    entries[0].tape->random.clear();
    entries[0].tape->clock.push_back(1);
    entries[0].tape->truncated = true;
    JournalRecorder fresh;
    const auto report = afd::replay_journal(*fresh.registry, entries,
                                            {.ignore = std::vector<std::string>{"data.roll"}});
    REQUIRE(report.entries.size() == 1);
    CHECK(report.entries[0].status == afd::ReplayStatus::same);
    CHECK(report.entries[0].notes ==
          std::vector<std::string>{
              "the recorded tape was truncated; values past it are not restored",
              "clock: the replay read 3 of 4 recorded readings",
              "random: the tape holds 0 values and the replay read more; later values come from "
              "seed 'afd-replay:1'"});
}

TEST_CASE("replay restores trace ID, actor and surface, and context adjustments win") {
    std::optional<afd::CommandContext> seen;
    afd::CommandRegistry registry;
    add_journaled(registry, afd::CommandDefinition{
                                .name = "who-am-i",
                                .description = "Echoes the context",
                                .handler =
                                    [&seen](const afd::Json&, afd::CommandContext& context) {
                                        seen = context;
                                        return afd::success(afd::Json::object());
                                    },
                                .expose = {.mcp = true}});
    afd::JournalEntry entry = entry_of(1, "who-am-i");
    entry.trace_id = "trace-7";
    entry.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "a-1"};
    entry.context_digest.surface = "mcp";
    const auto report = afd::replay_journal(
        registry, {entry},
        {.context = [](const afd::JournalEntry&,
                       afd::CommandContext& context) { context.extra["db"] = "fresh"; },
         .ignore = std::vector<std::string>{"metadata"}});
    CHECK(report.same == 1);
    REQUIRE(seen.has_value());
    CHECK(seen->trace_id == "trace-7");
    CHECK(seen->actor->id == "a-1");
    CHECK(seen->surface == afd::Interface::mcp);
    CHECK(seen->extra.at("db") == "fresh");
    // No tape: the clock is fixed at the timestamp and the random source is seeded per entry.
    CHECK(seen->clock->wall_ms() == 1767225600000);
    CHECK(seen->random->seed() == "afd-replay:1");

    entry.context_digest.surface = "carrier-pigeon";
    const auto unknown =
        afd::replay_journal(registry, {entry}, {.ignore = std::vector<std::string>{"metadata"}});
    CHECK(unknown.same == 1);
    REQUIRE(unknown.entries[0].notes.size() == 1);
    CHECK(unknown.entries[0].notes[0].find("carrier-pigeon") != std::string::npos);
}

TEST_CASE("middleware outside the journal does not shift the handler's tape on replay") {
    // An outer middleware reads the clock and random source before and after the journal.
    const afd::CommandMiddleware noisy = [](std::string_view, const afd::Json&,
                                            afd::CommandContext& context, const afd::Next& next) {
        (void)context.clock->steady_ms();
        (void)context.random->next();
        auto result = next();
        (void)context.clock->steady_ms();
        return result;
    };
    JournalRecorder recorder({}, {noisy});
    REQUIRE(recorder.registry->execute("note-add", {{"text", "a"}}).success);
    const auto entries = recorder.entries();
    JournalRecorder fresh({}, {noisy});
    const auto report = afd::replay_journal(*fresh.registry, entries);
    REQUIRE(report.entries.size() == 1);
    CHECK(report.entries[0].status == afd::ReplayStatus::same);
    CHECK(report.entries[0].notes.empty());

    // Without a journal in the replayed chain, the outer reads consume the handler's values.
    afd::CommandRegistry bare({.middleware = {noisy}});
    add_journaled(bare, JournalRecorder::note_add());
    CHECK(afd::replay_journal(bare, entries).different == 1);
}

TEST_CASE("replay_status_name and replay_difference_kind_name") {
    CHECK(afd::replay_status_name(afd::ReplayStatus::same) == "same");
    CHECK(afd::replay_status_name(afd::ReplayStatus::different) == "different");
    CHECK(afd::replay_status_name(afd::ReplayStatus::error) == "error");
    CHECK(afd::replay_difference_kind_name(afd::ReplayDifferenceKind::changed) == "changed");
    CHECK(afd::replay_difference_kind_name(afd::ReplayDifferenceKind::added) == "added");
    CHECK(afd::replay_difference_kind_name(afd::ReplayDifferenceKind::removed) == "removed");
}
