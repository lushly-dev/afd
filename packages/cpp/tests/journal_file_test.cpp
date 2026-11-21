// FileJournalSink (packages/core/src/journal-file.test.ts). Built when AFD_JOURNAL_FILE is ON.
#include "afd/afd.hpp"
#include "afd/journal_file.hpp"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <limits>
#include <memory>
#include <string>
#include <system_error>
#include <vector>

#include <doctest.h>

namespace {

namespace fs = std::filesystem;

/// A fresh directory under the system temp directory, removed at the end of the test.
class TempDir {
public:
    TempDir() {
        afd::SystemRandom random;
        path_ = fs::temp_directory_path() / ("afd-journal-" + afd::random_uuid(random));
    }
    ~TempDir() {
        std::error_code error;
        fs::remove_all(path_, error);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    [[nodiscard]] const fs::path& path() const { return path_; }

private:
    fs::path path_;
};

afd::JournalRecord file_record(std::string command) {
    return {.timestamp = "2026-01-01T00:00:00.000Z",
            .command = std::move(command),
            .context_digest = {.hash = "sha256:00"},
            .result = afd::success(afd::Json::object())};
}

std::string read_text(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

void write_text(const fs::path& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

std::vector<std::int64_t> file_seqs(afd::FileJournalSink& sink) {
    auto entries = sink.read();
    REQUIRE_MESSAGE(entries.has_value(), entries.error());
    std::vector<std::int64_t> out;
    for (const auto& entry : *entries) {
        out.push_back(entry.seq);
    }
    return out;
}

} // namespace

TEST_CASE("FileJournalSink creates the file and its directory, and continues it") {
    TempDir dir;
    const fs::path path = dir.path() / "nested" / "session.jsonl";
    afd::FileJournalSink sink(path);
    CHECK(sink.read()->empty()); // a missing file is an empty journal
    REQUIRE(sink.append(file_record("todo-create")).has_value());
    REQUIRE(sink.append(file_record("todo-list"))->seq == 2);
    const std::string text = read_text(path);
    CHECK(std::count(text.begin(), text.end(), '\n') == 2);
    CHECK(text.rfind("{\"seq\":1,", 0) == 0);

    afd::FileJournalSink reopened(path);
    CHECK(reopened.append(file_record("todo-get"))->seq == 3);
    CHECK(file_seqs(reopened) == std::vector<std::int64_t>{1, 2, 3});
    auto range = reopened.read({.from = 2, .to = 2});
    REQUIRE(range.has_value());
    REQUIRE(range->size() == 1);
    CHECK(range->at(0).command == "todo-list");
}

TEST_CASE("FileJournalSink drops a torn last line and completes an unterminated entry") {
    TempDir dir;
    fs::create_directories(dir.path());
    afd::JournalEntry first;
    static_cast<afd::JournalRecord&>(first) = file_record("todo-create");
    const std::string line = afd::serialize_journal_entry(first);

    const fs::path torn = dir.path() / "torn.jsonl";
    write_text(torn, line + "\n{\"seq\":2,\"timest");
    afd::FileJournalSink torn_sink(torn);
    CHECK(file_seqs(torn_sink) == std::vector<std::int64_t>{1}); // reads skip the torn line
    CHECK(torn_sink.append(file_record("todo-list"))->seq == 2);
    CHECK(afd::parse_journal(read_text(torn)).has_value()); // the torn line is gone
    CHECK(file_seqs(torn_sink) == std::vector<std::int64_t>{1, 2});

    const fs::path unterminated = dir.path() / "unterminated.jsonl";
    write_text(unterminated, line);
    afd::FileJournalSink unterminated_sink(unterminated);
    CHECK(unterminated_sink.append(file_record("todo-list"))->seq == 2);
    CHECK(file_seqs(unterminated_sink) == std::vector<std::int64_t>{1, 2});
    const std::string text = read_text(unterminated);
    CHECK(text.back() == '\n');
    CHECK(std::count(text.begin(), text.end(), '\n') == 2);
}

TEST_CASE("FileJournalSink reports a corrupt journal instead of appending to it") {
    TempDir dir;
    fs::create_directories(dir.path());
    const fs::path path = dir.path() / "corrupt.jsonl";
    write_text(path, "not json\n");
    afd::FileJournalSink sink(path);
    const auto appended = sink.append(file_record("todo-list"));
    REQUIRE_FALSE(appended.has_value());
    CHECK(appended.error().find("Journal line 1 is not valid JSON") != std::string::npos);
    CHECK(read_text(path) == "not json\n");
    CHECK_FALSE(sink.read().has_value());
}

TEST_CASE("FileJournalSink reads the golden fixture") {
    afd::FileJournalSink sink(fs::path(AFD_WIRE_DIR) / "journal.jsonl");
    CHECK(file_seqs(sink) == std::vector<std::int64_t>{1, 2, 3, 4, 5, 6});
}

TEST_CASE(
    "FileJournalSink does not corrupt an unterminated journal after a failed append (#1717)") {
    TempDir dir;
    fs::create_directories(dir.path());
    afd::JournalEntry first;
    static_cast<afd::JournalRecord&>(first) = file_record("todo-create");
    const std::string line = afd::serialize_journal_entry(first);

    const fs::path path = dir.path() / "unterminated-retry.jsonl";
    write_text(path, line); // intentionally no trailing '\n'

    // Limits large enough for the first line and a normal second line, too small for oversized.
    afd::ParseLimits limits;
    limits.max_bytes = line.size() + 128;
    afd::FileJournalSink sink(path, limits);

    afd::JournalRecord oversized = file_record("todo-big");
    oversized.input = {{"payload", std::string(limits.max_bytes + 64, 'x')}};
    const auto failed = sink.append(oversized);
    REQUIRE_FALSE(failed.has_value());
    CHECK(read_text(path) == line); // untouched on validation failure

    const auto retry = sink.append(file_record("todo-list"));
    REQUIRE(retry.has_value());
    CHECK(retry->seq == 2);
    CHECK(file_seqs(sink) == std::vector<std::int64_t>{1, 2});
    const std::string text = read_text(path);
    CHECK(afd::parse_journal(text).has_value());
    CHECK(std::count(text.begin(), text.end(), '\n') == 2);
}

TEST_CASE("FileJournalSink clamps recorded hostile random samples and rejects invalid tapes "
          "(#1716)") {
    struct HostileRandom final : afd::RandomSource {
        std::vector<double> samples = {
            -1.0,
            1.0,
            1e9,
            std::numeric_limits<double>::quiet_NaN(),
            std::numeric_limits<double>::infinity(),
        };
        std::size_t index = 0;
        [[nodiscard]] double next() override { return samples[index++ % samples.size()]; }
    };

    TempDir dir;
    const fs::path recorded_path = dir.path() / "recorded.jsonl";
    auto sink = std::make_shared<afd::FileJournalSink>(recorded_path);

    afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(sink)},
                                   .clock = afd::fixed_clock(1700000000000),
                                   .random = std::make_shared<HostileRandom>()});
    REQUIRE_FALSE(
        registry.register_command({.name = "rand-sample",
                                   .description = "Sample random values",
                                   .handler = [](const afd::Json&, afd::CommandContext& ctx) {
                                       afd::Json draws = afd::Json::array();
                                       for (int i = 0; i < 5; ++i) {
                                           const double value = ctx.random->next();
                                           CHECK(value >= 0.0);
                                           CHECK(value < 1.0);
                                           draws.push_back(value);
                                       }
                                       return afd::success(draws);
                                   }}));

    const auto result = registry.execute("rand-sample", afd::Json::object());
    REQUIRE(result.success);

    // Every recorded sample must survive FileJournalSink::read() without breaking the journal.
    const auto entries = sink->read();
    REQUIRE_MESSAGE(entries.has_value(), entries.error());
    REQUIRE(entries->size() == 1);
    REQUIRE(entries->at(0).tape.has_value());
    REQUIRE(entries->at(0).tape->random.size() == 5);
    for (double sample : entries->at(0).tape->random) {
        CHECK(sample >= 0.0);
        CHECK(sample < 1.0);
    }

    // A caller-supplied JournalRecord with an out-of-range tape.random must be rejected before
    // writing so it cannot poison the journal file.
    const fs::path direct_path = dir.path() / "direct.jsonl";
    afd::FileJournalSink direct_sink(direct_path);
    REQUIRE(direct_sink.append(file_record("todo-list")).has_value());
    const std::string before = read_text(direct_path);

    afd::JournalRecord bad = file_record("todo-bad");
    bad.tape = afd::JournalTape{.random = {1.0}};
    const auto rejected = direct_sink.append(bad);
    REQUIRE_FALSE(rejected.has_value());
    CHECK(rejected.error().find("is not a valid journal entry") != std::string::npos);
    CHECK(read_text(direct_path) == before);
    CHECK(file_seqs(direct_sink) == std::vector<std::int64_t>{1});
}
