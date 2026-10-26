// A journal sink that appends JSON Lines to a file (packages/core/src/journal-file.ts).
//
// An optional component: built when AFD_JOURNAL_FILE is ON (the default), and not included by
// afd/afd.hpp. Hosts with their own storage implement `JournalSink` instead.
#pragma once

#include "afd/journal.hpp"

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <optional>
#include <vector>

namespace afd {

/// A `JournalSink` that appends one JSON line per entry to `path`. Thread-safe.
///
/// The file and its directory are created on the first append. An existing file is continued:
/// the next `seq` follows its last entry. Do not point two sinks, or two processes, at one file.
///
/// A last line without a newline is a write that did not finish. Reads skip it when it is not a
/// complete entry, and the first append removes it; a complete entry that only lacks its newline
/// is kept and the newline is added. The first append reads the whole existing file once.
class FileJournalSink final : public JournalSink {
public:
    explicit FileJournalSink(std::filesystem::path path, ParseLimits limits = {});

    Expected<JournalEntry> append(JournalRecord record) override;
    [[nodiscard]] Expected<std::vector<JournalEntry>> read(JournalRange range = {}) override;

    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

private:
    struct Contents {
        std::vector<JournalEntry> entries;
        /// The file does not end in a newline.
        bool unterminated = false;
        /// The byte offset of a last line that is not a complete entry.
        std::optional<std::uintmax_t> torn_at;
    };
    [[nodiscard]] Expected<Contents> load() const;

    std::filesystem::path path_;
    ParseLimits limits_;
    std::mutex mutex_;
    /// The last `seq` written, once the existing file has been read.
    std::optional<std::int64_t> last_seq_;
};

} // namespace afd
