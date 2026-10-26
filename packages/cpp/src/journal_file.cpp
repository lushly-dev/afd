#include "afd/journal_file.hpp"

#include <algorithm>
#include <fstream>
#include <iterator>
#include <string>
#include <system_error>
#include <utility>

namespace afd {

FileJournalSink::FileJournalSink(std::filesystem::path path, ParseLimits limits)
    : path_(std::move(path)), limits_(limits) {}

Expected<FileJournalSink::Contents> FileJournalSink::load() const {
    Contents contents;
    std::error_code error;
    if (!std::filesystem::exists(path_, error)) {
        if (error) {
            return unexpected("Cannot read journal " + path_.string() + ": " + error.message());
        }
        return contents;
    }
    std::ifstream in(path_, std::ios::binary);
    if (!in) {
        return unexpected("Cannot read journal " + path_.string());
    }
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    if (in.bad()) {
        return unexpected("Cannot read journal " + path_.string());
    }
    const std::size_t cut = text.rfind('\n') == std::string::npos ? 0 : text.rfind('\n') + 1;
    auto entries = parse_journal(std::string_view(text).substr(0, cut), limits_);
    if (!entries) {
        return unexpected(path_.string() + ": " + entries.error());
    }
    contents.entries = std::move(*entries);
    const std::string_view tail = std::string_view(text).substr(cut);
    contents.unterminated = !tail.empty();
    if (contents.unterminated) {
        auto last = parse_journal(tail, limits_);
        if (last) {
            contents.entries.insert(contents.entries.end(), last->begin(), last->end());
        } else {
            contents.torn_at = cut;
        }
    }
    std::stable_sort(contents.entries.begin(), contents.entries.end(),
                     [](const JournalEntry& a, const JournalEntry& b) { return a.seq < b.seq; });
    return contents;
}

Expected<JournalEntry> FileJournalSink::append(JournalRecord record) {
    const std::lock_guard lock(mutex_);
    std::string prefix;
    if (!last_seq_) {
        auto existing = load();
        if (!existing) {
            return unexpected(existing.error());
        }
        std::error_code error;
        if (existing->torn_at) {
            std::filesystem::resize_file(path_, *existing->torn_at, error);
        } else if (existing->unterminated) {
            prefix = "\n";
        }
        if (!error && path_.has_parent_path()) {
            std::filesystem::create_directories(path_.parent_path(), error);
        }
        if (error) {
            return unexpected("Cannot prepare journal " + path_.string() + ": " + error.message());
        }
        last_seq_ = existing->entries.empty() ? 0 : existing->entries.back().seq;
    }
    JournalEntry entry;
    static_cast<JournalRecord&>(entry) = std::move(record);
    entry.seq = *last_seq_ + 1;
    const std::string line = serialize_journal_entry(entry);
    // A line the next load could not parse would end the journal there.
    if (auto check = parse_bounded(line, limits_); !check) {
        return unexpected("Journal entry " + std::to_string(entry.seq) +
                          " exceeds the sink's parse limits: " + check.error().message);
    }
    std::ofstream out(path_, std::ios::binary | std::ios::app);
    out << prefix << line << '\n';
    out.flush();
    if (!out) {
        return unexpected("Cannot append to journal " + path_.string());
    }
    last_seq_ = entry.seq;
    return entry;
}

Expected<std::vector<JournalEntry>> FileJournalSink::read(JournalRange range) {
    const std::lock_guard lock(mutex_);
    auto contents = load();
    if (!contents) {
        return unexpected(contents.error());
    }
    return select_journal_range(contents->entries, range);
}

} // namespace afd
