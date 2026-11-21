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
    std::int64_t base_seq = 0;
    std::optional<std::size_t> torn_at;
    bool needs_prepare = false;
    if (last_seq_) {
        base_seq = *last_seq_;
    } else {
        auto existing = load();
        if (!existing) {
            return unexpected(existing.error());
        }
        torn_at = existing->torn_at;
        if (!torn_at && existing->unterminated) {
            prefix = "\n";
        }
        base_seq = existing->entries.empty() ? 0 : existing->entries.back().seq;
        needs_prepare = true;
    }
    JournalEntry entry;
    static_cast<JournalRecord&>(entry) = std::move(record);
    entry.seq = base_seq + 1;
    const std::string line = serialize_journal_entry(entry);
    // A line the next load could not parse would end the journal there.
    auto parsed = parse_bounded(line, limits_);
    if (!parsed) {
        return unexpected("Journal entry " + std::to_string(entry.seq) +
                          " exceeds the sink's parse limits: " + parsed.error().message);
    }
    if (auto validated = JournalEntry::from_json(*parsed); !validated) {
        return unexpected("Journal entry " + std::to_string(entry.seq) +
                          " is not a valid journal entry: " + validated.error());
    }
    if (needs_prepare) {
        std::error_code error;
        if (torn_at) {
            std::filesystem::resize_file(path_, *torn_at, error);
        }
        if (!error && path_.has_parent_path()) {
            std::filesystem::create_directories(path_.parent_path(), error);
        }
        if (error) {
            return unexpected("Cannot prepare journal " + path_.string() + ": " + error.message());
        }
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
