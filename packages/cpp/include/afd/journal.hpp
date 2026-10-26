// The command journal: an ordered, append-only record of executed commands, and its replay
// (packages/core/src/journal.ts, packages/server/src/journal.ts and journal-replay.ts). The wire
// format is spec/journal.md: JSON Lines, one `JournalEntry` per line.
//
// A journal never stores a value from the command context outside an allowlist: the actor, the
// surface (`interface` on the wire) and the trace ID. The context digest hashes those values with
// the names, never the values, of the context's other members.
//
// The file sink is an optional component in afd/journal_file.hpp.
#pragma once

#include "afd/actor.hpp"
#include "afd/command.hpp"
#include "afd/execution.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

class CommandRegistry;

/// The clock readings and random numbers a handler took from `context.clock` and
/// `context.random`, in the order it took them. Replay feeds them back.
struct JournalTape {
    /// Each clock reading: `steady_ms()` and `wall_ms()` alike, in the order they were read.
    std::vector<double> clock;
    /// Each `random->next()` value.
    std::vector<double> random;
    /// Set when the handler read more values than the recorder keeps; replay cannot restore
    /// the rest.
    bool truncated = false;
};

/// The parts of the context a journal keeps besides the actor and trace ID.
struct JournalContextDigest {
    /// `sha256:` and the hex SHA-256 of the canonical JSON of the actor, the surface, the trace ID
    /// and the sorted names of the context's other members (spec/journal.md).
    std::string hash;
    /// The surface that invoked the command: `interface` on the wire. A string, so a journal
    /// recorded elsewhere keeps a surface this version does not know.
    std::optional<std::string> surface;
};

/// An entry before the sink assigns its `seq`. TypeScript's `Omit<JournalEntry, 'seq'>`.
struct JournalRecord {
    /// When the command started: ISO 8601 from `context.clock`'s wall time.
    std::string timestamp;
    std::optional<std::string> trace_id;
    std::string command;
    /// The validated input the handler received.
    Json input = Json::object();
    /// Who called: `kind`, and `id`, `label` and `on_behalf_of` when set.
    std::optional<Actor> actor;
    JournalContextDigest context_digest;
    /// The command result, metadata included.
    CommandResult result;
    /// Time of the call through the rest of the middleware chain, from `context.clock`.
    double duration_ms = 0;
    /// The clock and random values the handler read. Unset when it read none.
    std::optional<JournalTape> tape;
};

/// One executed command in a journal.
struct JournalEntry : JournalRecord {
    /// Position in the journal, from 1, assigned by the sink. Increasing; gaps are allowed.
    std::int64_t seq = 1;

    /// Reads an entry, rejecting what `is_journal_entry` rejects.
    static Expected<JournalEntry> from_json(const Json& value);
};

void to_json(Json& out, const JournalTape& tape);
void to_json(Json& out, const JournalContextDigest& digest);
void to_json(Json& out, const JournalEntry& entry);

/// A range of entries by `seq`. Both bounds are inclusive; unset means unbounded.
struct JournalRange {
    std::optional<std::int64_t> from;
    std::optional<std::int64_t> to;
};

/// Storage for a journal. The sink assigns `seq`, so a journal reopened after a restart
/// continues its numbering. Implementations must be safe to call from several threads.
class JournalSink {
public:
    virtual ~JournalSink() = default;
    /// Appends `record` with the next `seq` and returns the stored entry, or why it could not.
    virtual Expected<JournalEntry> append(JournalRecord record) = 0;
    /// The entries in `range`, in `seq` order.
    [[nodiscard]] virtual Expected<std::vector<JournalEntry>> read(JournalRange range = {}) = 0;
};

/// A journal held in memory, for tests and short-lived sessions. Thread-safe.
class MemoryJournalSink final : public JournalSink {
public:
    /// Starts from `initial` (sorted by `seq`), e.g. a journal read with `parse_journal`.
    explicit MemoryJournalSink(std::vector<JournalEntry> initial = {});
    Expected<JournalEntry> append(JournalRecord record) override;
    [[nodiscard]] Expected<std::vector<JournalEntry>> read(JournalRange range = {}) override;

private:
    std::mutex mutex_;
    std::vector<JournalEntry> entries_;
};

/// The entries of `entries` (in `seq` order) that fall in `range`.
std::vector<JournalEntry> select_journal_range(const std::vector<JournalEntry>& entries,
                                               JournalRange range = {});

/// `value` as an actor with only its four fields, or `std::nullopt` when it is not an actor.
std::optional<Actor> journal_actor(const Json& value);

/// The digest of `context`. The hash covers the actor, the surface, the trace ID and the sorted
/// names of the other members that are set: `activeContext`, `clock`, `random` and `timeoutMs`,
/// and each key of `extra`. Their values never enter the hash or the digest. The cancellation
/// token is not a key: an unset token cannot be told from a set one.
JournalContextDigest create_context_digest(const CommandContext& context);

/// Whether `value` has the shape of a journal entry (spec/journal.md).
bool is_journal_entry(const Json& value);

/// One JSON Lines line for `entry`, without the trailing newline. The entry's and the actor's
/// keys follow the order of the spec's table; other nested objects have sorted keys.
std::string serialize_journal_entry(const JournalEntry& entry);

/// A JSON Lines journal: one line per entry, each ending in `\n`.
std::string serialize_journal(const std::vector<JournalEntry>& entries);

/// The entries of a JSON Lines journal, in file order, or an error naming the first line that
/// is not JSON or not an entry. Blank lines are skipped and `\r\n` is accepted. Each line goes
/// through `parse_bounded` with `limits`.
Expected<std::vector<JournalEntry>> parse_journal(std::string_view text, ParseLimits limits = {});

// --- recording ----------------------------------------------------------------------------

struct JournalMiddlewareOptions {
    /// Also record calls that fail after validation: a failure from the handler or from
    /// middleware inside this one, and a handler that throws (recorded as the
    /// COMMAND_EXECUTION_ERROR result outside dev mode, without the exception text). Default:
    /// only successes.
    bool record_failures = false;
    /// Record only the commands this returns true for. Default: every command not named
    /// `auth-*`. A custom filter replaces the default.
    std::function<bool(std::string_view name)> filter;
    /// Last look at each record before it is stored: return it, changed or not, or
    /// `std::nullopt` to skip it. Drop secrets here, and drop the tape too when a secret is
    /// derived from `context.random`.
    std::function<std::optional<JournalRecord>(JournalRecord record)> redact;
    /// Most clock readings and most random values kept per call, each. Past it the tape is
    /// marked truncated.
    std::size_t max_tape_reads = 1000;
    /// Receives append failures. The command result is never affected.
    std::function<void(std::string_view message)> on_error;
};

/// A middleware that appends an entry to `sink` for each call that reaches it. Registry
/// middleware runs after lookup, exposure and validation, so rejected calls are never recorded.
///
/// The entry holds the validated input, the actor, the trace ID, the context digest, the result,
/// the duration and the tape: every value the handler, and the registry's own timing of it,
/// read from `context.clock` and `context.random`. Add it last, so the tape holds only those.
/// During `replay_journal` it records nothing and restarts the replay tape at its position.
CommandMiddleware create_journal_middleware(std::shared_ptr<JournalSink> sink,
                                            JournalMiddlewareOptions options = {});

// --- replay -------------------------------------------------------------------------------

struct ReplayJournalOptions {
    /// Adjusts each call's context after the trace ID, actor, surface, clock and random source
    /// are restored, e.g. to add a fresh database. What it sets wins.
    std::function<void(const JournalEntry& entry, CommandContext& context)> context;
    /// Exact result paths left out of the comparison, with everything under them, such as
    /// `metadata` or `data.items[0].updatedAt`. Unset: `{"metadata.executionTimeMs"}`.
    std::optional<std::vector<std::string>> ignore;
    /// Seed for random values an entry has no recording of; `:<seq>` is appended.
    std::string seed = "afd-replay";
    /// Stop after the first entry that is not `same`.
    bool stop_on_divergence = false;
    /// Most differences listed per entry.
    std::size_t max_differences = 100;
};

/// How a replayed entry compares with the recording.
enum class ReplayStatus { same, different, error };

/// `changed`: both have a value. `added`: only the replay. `removed`: only the recording.
enum class ReplayDifferenceKind { changed, added, removed };

/// One difference between the recorded and the replayed result.
struct ReplayDifference {
    /// Where, e.g. `data.title` or `data.items[2]`. Empty for the whole result.
    std::string path;
    ReplayDifferenceKind kind = ReplayDifferenceKind::changed;
    /// Unset for `added`.
    std::optional<Json> recorded;
    /// Unset for `removed`.
    std::optional<Json> replayed;
};

/// The outcome of replaying one entry.
struct ReplayEntryReport {
    std::int64_t seq = 0;
    std::string command;
    ReplayStatus status = ReplayStatus::same;
    CommandResult recorded;
    /// Unset when `status` is `error`.
    std::optional<CommandResult> replayed;
    /// Set when `status` is `different`.
    std::vector<ReplayDifference> differences;
    /// Why the entry could not be replayed. Set when `status` is `error`.
    std::optional<std::string> error;
    /// What replay could not restore, e.g. a tape that ran out.
    std::vector<std::string> notes;
};

/// The outcome of `replay_journal`.
struct ReplayReport {
    /// One report per replayed entry, in `seq` order.
    std::vector<ReplayEntryReport> entries;
    std::size_t same = 0;
    std::size_t different = 0;
    std::size_t errors = 0;
    /// Whether any entry was not `same`.
    bool diverged = false;
    /// Entries not replayed because `stop_on_divergence` stopped the run.
    std::size_t skipped = 0;
};

/// Re-executes `entries` in `seq` order through `execute` and compares each result with the
/// recorded one. Each call gets the entry's trace ID, actor and surface, and a clock and random
/// source that return the values on its tape (then hold the last reading, and continue from a
/// `SeededRandom` of `<seed>:<seq>`). An entry without a tape gets a clock fixed at its
/// `timestamp`. Replay against a fresh registry with the recording's middleware.
ReplayReport replay_journal(const CommandExecutor& execute,
                            const std::vector<JournalEntry>& entries,
                            const ReplayJournalOptions& options = {});

/// `replay_journal` through `registry.execute`.
ReplayReport replay_journal(const CommandRegistry& registry,
                            const std::vector<JournalEntry>& entries,
                            const ReplayJournalOptions& options = {});

/// The wire name of `status`: `same`, `different` or `error`.
std::string_view replay_status_name(ReplayStatus status) noexcept;

/// The wire name of `kind`: `changed`, `added` or `removed`.
std::string_view replay_difference_kind_name(ReplayDifferenceKind kind) noexcept;

} // namespace afd
