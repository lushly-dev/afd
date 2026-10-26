// The journal middleware and replay (packages/server/src/journal.ts and journal-replay.ts).
#include "afd/journal.hpp"
#include "afd/registry.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <set>
#include <utility>

#include "detail/exceptions.hpp"
#include "detail/journal_state.hpp"

namespace afd {
namespace {

// Runs a callback when the scope ends, normally or by an exception.
template <class F>
class ScopeExit {
public:
    explicit ScopeExit(F callback) : callback_(std::move(callback)) {}
    ScopeExit(const ScopeExit&) = delete;
    ScopeExit& operator=(const ScopeExit&) = delete;
    ~ScopeExit() { callback_(); }

private:
    F callback_;
};

std::int64_t to_wall_ms(double value) {
    constexpr double limit = 9.0e18; // inside the int64 range
    if (!std::isfinite(value)) {
        return 0;
    }
    return static_cast<std::int64_t>(std::llround(std::clamp(value, -limit, limit)));
}

// --- recording ----------------------------------------------------------------------------

/// The tape of one recorded call. Handlers may read from several threads, so it locks.
class TapeRecorder {
public:
    explicit TapeRecorder(std::size_t max_reads) : max_reads_(max_reads) {}

    void clock(double value) { keep(tape_.clock, value); }
    void random(double value) { keep(tape_.random, value); }

    [[nodiscard]] JournalTape tape() {
        const std::lock_guard lock(mutex_);
        return tape_;
    }

private:
    void keep(std::vector<double>& values, double value) {
        const std::lock_guard lock(mutex_);
        if (values.size() < max_reads_) {
            values.push_back(value);
        } else {
            tape_.truncated = true;
        }
    }

    std::mutex mutex_;
    JournalTape tape_;
    std::size_t max_reads_;
};

/// Passes readings through and writes each one, steady or wall, to the tape.
class RecordingClock final : public Clock {
public:
    RecordingClock(std::shared_ptr<const Clock> inner, std::shared_ptr<TapeRecorder> tape)
        : inner_(std::move(inner)), tape_(std::move(tape)) {}

    [[nodiscard]] double steady_ms() const override {
        const double value = inner_->steady_ms();
        tape_->clock(value);
        return value;
    }
    [[nodiscard]] std::int64_t wall_ms() const override {
        const std::int64_t value = inner_->wall_ms();
        tape_->clock(static_cast<double>(value));
        return value;
    }

private:
    std::shared_ptr<const Clock> inner_;
    std::shared_ptr<TapeRecorder> tape_;
};

class RecordingRandom final : public RandomSource {
public:
    RecordingRandom(std::shared_ptr<RandomSource> inner, std::shared_ptr<TapeRecorder> tape)
        : inner_(std::move(inner)), tape_(std::move(tape)) {}

    [[nodiscard]] double next() override {
        const double value = inner_->next();
        tape_->random(value);
        return value;
    }
    [[nodiscard]] std::optional<std::string> seed() const override { return inner_->seed(); }

private:
    std::shared_ptr<RandomSource> inner_;
    std::shared_ptr<TapeRecorder> tape_;
};

bool default_filter(std::string_view name) {
    // The auth commands take passwords and return sessions.
    return name.substr(0, 5) != "auth-";
}

// Builds and stores the entry for one call. Errors, including a throw while building it, go to
// `on_error`, never to the caller.
template <class Build>
void store(JournalSink& sink, const JournalMiddlewareOptions& options, const Build& build) {
    const auto report = [&](std::string_view message) {
        if (!options.on_error) {
            return;
        }
#if AFD_HAS_EXCEPTIONS
        try {
            options.on_error(message);
        } catch (...) { // a failing on_error has nowhere left to report
        }
#else
        options.on_error(message);
#endif
    };
#if AFD_HAS_EXCEPTIONS
    try {
#endif
        JournalRecord record = build();
        std::optional<JournalRecord> kept =
            options.redact ? options.redact(std::move(record)) : std::optional(std::move(record));
        if (kept) {
            auto appended = sink.append(std::move(*kept));
            if (!appended) {
                report(appended.error());
            }
        }
#if AFD_HAS_EXCEPTIONS
    } catch (const std::exception& error) {
        report(error.what());
    } catch (...) {
        report("unknown exception");
    }
#endif
}

// --- replay -------------------------------------------------------------------------------

/// Replays the recorded clock readings, for `steady_ms` and `wall_ms` alike, then holds the last.
class TapeClock final : public Clock {
public:
    TapeClock(std::vector<double> readings, double start)
        : readings_(std::move(readings)), start_(start), last_(start) {}

    [[nodiscard]] double steady_ms() const override { return read(); }
    [[nodiscard]] std::int64_t wall_ms() const override { return to_wall_ms(read()); }

    void rewind() {
        const std::lock_guard lock(mutex_);
        index_ = 0;
        last_ = start_;
        overran_ = false;
        ended_ = false;
    }
    void end() {
        const std::lock_guard lock(mutex_);
        ended_ = true;
    }
    [[nodiscard]] std::size_t used() const {
        const std::lock_guard lock(mutex_);
        return index_;
    }
    [[nodiscard]] bool overran() const {
        const std::lock_guard lock(mutex_);
        return overran_;
    }

private:
    double read() const {
        const std::lock_guard lock(mutex_);
        if (ended_) {
            return last_;
        }
        if (index_ < readings_.size()) {
            last_ = readings_[index_++];
        } else {
            overran_ = true;
        }
        return last_;
    }

    std::vector<double> readings_;
    double start_;
    mutable std::mutex mutex_;
    mutable std::size_t index_ = 0;
    mutable double last_;
    mutable bool overran_ = false;
    mutable bool ended_ = false;
};

/// Replays the recorded random values, then continues with a `SeededRandom` of `seed`.
class TapeRandom final : public RandomSource {
public:
    TapeRandom(std::vector<double> values, std::string seed)
        : values_(std::move(values)), seed_(std::move(seed)) {
        fallback_.emplace(seed_);
    }

    [[nodiscard]] double next() override {
        const std::lock_guard lock(mutex_);
        if (ended_) {
            return fallback_->next();
        }
        if (index_ < values_.size()) {
            return values_[index_++];
        }
        overran_ = true;
        return fallback_->next();
    }
    [[nodiscard]] std::optional<std::string> seed() const override { return seed_; }

    void rewind() {
        const std::lock_guard lock(mutex_);
        index_ = 0;
        overran_ = false;
        ended_ = false;
        fallback_.emplace(seed_);
    }
    void end() {
        const std::lock_guard lock(mutex_);
        ended_ = true;
    }
    [[nodiscard]] std::size_t used() {
        const std::lock_guard lock(mutex_);
        return index_;
    }
    [[nodiscard]] bool overran() {
        const std::lock_guard lock(mutex_);
        return overran_;
    }

private:
    std::vector<double> values_;
    std::string seed_;
    std::mutex mutex_;
    std::optional<SeededRandom> fallback_;
    std::size_t index_ = 0;
    bool overran_ = false;
    bool ended_ = false;
};

// Howard Hinnant's days_from_civil: a proleptic Gregorian date to days since 1970-01-01.
std::int64_t days_from_civil(std::int64_t year, unsigned month, unsigned day) {
    year -= month <= 2 ? 1 : 0;
    const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
    const auto year_of_era = static_cast<unsigned>(year - era * 400);
    const unsigned day_of_year = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
    const unsigned day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    return era * 146097 + static_cast<std::int64_t>(day_of_era) - 719468;
}

// `YYYY-MM-DD[THH:MM[:SS[.fff…]]][Z|±HH:MM]` as epoch milliseconds. A time without an offset
// is read as UTC. TypeScript's `Date.parse` accepts more; journals hold `toISOString` output.
std::optional<std::int64_t> parse_iso8601_ms(std::string_view text) {
    std::size_t at = 0;
    const auto digits = [&](std::size_t count, int& out) {
        if (at + count > text.size()) {
            return false;
        }
        out = 0;
        for (std::size_t i = 0; i < count; ++i) {
            const char c = text[at + i];
            if (c < '0' || c > '9') {
                return false;
            }
            out = out * 10 + (c - '0');
        }
        at += count;
        return true;
    };
    const auto literal = [&](char c) {
        if (at < text.size() && text[at] == c) {
            ++at;
            return true;
        }
        return false;
    };
    int year = 0;
    int month = 0;
    int day = 0;
    int hour = 0;
    int minute = 0;
    int second = 0;
    int millisecond = 0;
    if (!digits(4, year) || !literal('-') || !digits(2, month) || !literal('-') ||
        !digits(2, day) || month < 1 || month > 12 || day < 1 || day > 31) {
        return std::nullopt;
    }
    std::int64_t offset_minutes = 0;
    if (literal('T')) {
        if (!digits(2, hour) || !literal(':') || !digits(2, minute) || hour > 23 || minute > 59) {
            return std::nullopt;
        }
        if (literal(':')) {
            if (!digits(2, second) || second > 59) {
                return std::nullopt;
            }
            if (literal('.')) {
                const std::size_t first = at;
                int scale = 100;
                while (at < text.size() && text[at] >= '0' && text[at] <= '9') {
                    millisecond += (text[at] - '0') * scale;
                    scale /= 10;
                    ++at;
                }
                if (at == first) {
                    return std::nullopt;
                }
            }
        }
        const bool positive = literal('+');
        const bool negative = !positive && literal('-');
        if (positive || negative) {
            int offset_hours = 0;
            int offset_mins = 0;
            if (!digits(2, offset_hours) || !literal(':') || !digits(2, offset_mins) ||
                offset_hours > 23 || offset_mins > 59) {
                return std::nullopt;
            }
            offset_minutes = (negative ? -1 : 1) * (offset_hours * 60 + offset_mins);
        } else {
            (void)literal('Z');
        }
    }
    if (at != text.size()) {
        return std::nullopt;
    }
    const std::int64_t days =
        days_from_civil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
    return ((days * 24 + hour) * 60 + minute - offset_minutes) * 60000 +
           static_cast<std::int64_t>(second) * 1000 + millisecond;
}

std::string format_count(std::size_t count) {
    return std::to_string(count);
}

std::vector<std::string> tape_notes(const JournalEntry& entry, const TapeClock* clock,
                                    TapeRandom& random) {
    std::vector<std::string> notes;
    if (!entry.tape) {
        return notes;
    }
    const JournalTape& tape = *entry.tape;
    if (tape.truncated) {
        notes.emplace_back("the recorded tape was truncated; values past it are not restored");
    }
    if (clock != nullptr && clock->overran()) {
        notes.push_back("clock: the tape holds " + format_count(tape.clock.size()) +
                        " readings and the replay read more; later readings repeat the last one");
    } else if (clock != nullptr && clock->used() < tape.clock.size()) {
        notes.push_back("clock: the replay read " + format_count(clock->used()) + " of " +
                        format_count(tape.clock.size()) + " recorded readings");
    }
    if (random.overran()) {
        notes.push_back("random: the tape holds " + format_count(tape.random.size()) +
                        " values and the replay read more; later values come from seed '" +
                        random.seed().value_or("") + "'");
    } else if (random.used() < tape.random.size()) {
        notes.push_back("random: the replay read " + format_count(random.used()) + " of " +
                        format_count(tape.random.size()) + " recorded values");
    }
    return notes;
}

std::string diff_child_path(const std::string& path, const std::string& key) {
    return path.empty() ? key : path + "." + key;
}

struct DiffState {
    const std::set<std::string, std::less<>>& ignore;
    std::vector<ReplayDifference>& out;
    std::size_t max;

    [[nodiscard]] bool full() const { return out.size() >= max; }
    void add(const std::string& path, ReplayDifferenceKind kind, std::optional<Json> recorded,
             std::optional<Json> replayed) {
        if (ignore.count(path) == 0 && !full()) {
            out.push_back({path, kind, std::move(recorded), std::move(replayed)});
        }
    }
};

// Structural differences between two JSON values, skipping ignored paths.
void diff_json(const Json& recorded, const Json& replayed, const std::string& path,
               DiffState& state) {
    if (state.full() || state.ignore.count(path) != 0) {
        return;
    }
    if (recorded.is_array() && replayed.is_array()) {
        for (std::size_t i = 0; i < (std::max)(recorded.size(), replayed.size()); ++i) {
            const std::string at = path + "[" + std::to_string(i) + "]";
            if (i >= replayed.size()) {
                state.add(at, ReplayDifferenceKind::removed, recorded[i], std::nullopt);
            } else if (i >= recorded.size()) {
                state.add(at, ReplayDifferenceKind::added, std::nullopt, replayed[i]);
            } else {
                diff_json(recorded[i], replayed[i], at, state);
            }
        }
        return;
    }
    if (recorded.is_object() && replayed.is_object()) {
        std::set<std::string> keys;
        for (auto it = recorded.begin(); it != recorded.end(); ++it) {
            keys.insert(it.key());
        }
        for (auto it = replayed.begin(); it != replayed.end(); ++it) {
            keys.insert(it.key());
        }
        for (const auto& key : keys) {
            const std::string at = diff_child_path(path, key);
            const auto in_recorded = recorded.find(key);
            const auto in_replayed = replayed.find(key);
            if (in_replayed == replayed.end()) {
                state.add(at, ReplayDifferenceKind::removed, *in_recorded, std::nullopt);
            } else if (in_recorded == recorded.end()) {
                state.add(at, ReplayDifferenceKind::added, std::nullopt, *in_replayed);
            } else {
                diff_json(*in_recorded, *in_replayed, at, state);
            }
        }
        return;
    }
    if (recorded != replayed) {
        state.out.push_back({path, ReplayDifferenceKind::changed, recorded, replayed});
    }
}

ReplayEntryReport replay_entry(const CommandExecutor& execute, const JournalEntry& entry,
                               const ReplayJournalOptions& options,
                               const std::set<std::string, std::less<>>& ignore) {
    ReplayEntryReport outcome{.seq = entry.seq,
                              .command = entry.command,
                              .status = ReplayStatus::error,
                              .recorded = entry.result};
    const auto random =
        std::make_shared<TapeRandom>(entry.tape ? entry.tape->random : std::vector<double>{},
                                     options.seed + ":" + std::to_string(entry.seq));
    std::shared_ptr<TapeClock> clock;

    // With a tape the timestamp only seeds the clock until the first reading, as in TypeScript;
    // without one, the clock is fixed at it, so it must parse.
    auto start = parse_iso8601_ms(entry.timestamp);
    if (!start && entry.tape) {
        outcome.notes.push_back("the timestamp '" + entry.timestamp +
                                "' is not an ISO 8601 date; the clock starts at 0");
        start = 0;
    }
    if (!start) {
        outcome.error = "the timestamp '" + entry.timestamp + "' is not an ISO 8601 date";
        return outcome;
    }
    if (entry.tape) {
        clock = std::make_shared<TapeClock>(entry.tape->clock, static_cast<double>(*start));
    }

    CommandContext context;
    context.trace_id = entry.trace_id;
    context.actor = entry.actor;
    if (entry.context_digest.surface) {
        context.surface = detail::parse_surface(*entry.context_digest.surface);
        if (!context.surface) {
            outcome.notes.push_back("the recorded interface '" + *entry.context_digest.surface +
                                    "' is not one this version knows; replayed without one");
        }
    }
    context.clock = clock ? std::shared_ptr<const Clock>(clock) : fixed_clock(*start);
    context.random = random;

    const auto run = [&]() {
        if (options.context) {
            options.context(entry, context);
        }
        // A journal middleware in the replayed chain rewinds the tape where it sits, so
        // middleware outside it does not shift the handler's readings.
        auto state = std::make_shared<detail::JournalCallState>();
        state->replaying = true;
        state->rewind = [clock, random]() {
            if (clock) {
                clock->rewind();
            }
            random->rewind();
        };
        state->end = [clock, random]() {
            if (clock) {
                clock->end();
            }
            random->end();
        };
        context.journal = std::move(state);

        CommandResult replayed = execute(entry.command, entry.input, context);
        std::vector<ReplayDifference> differences;
        DiffState diff{ignore, differences, options.max_differences};
        diff_json(Json(entry.result), Json(replayed), std::string(), diff);
        outcome.status = differences.empty() ? ReplayStatus::same : ReplayStatus::different;
        outcome.replayed = std::move(replayed);
        outcome.differences = std::move(differences);
    };
#if AFD_HAS_EXCEPTIONS
    try {
        run();
    } catch (const std::exception& error) {
        outcome.error = error.what();
    } catch (...) {
        outcome.error = "unknown exception";
    }
#else
    run();
#endif

    auto notes = tape_notes(entry, clock.get(), *random);
    outcome.notes.insert(outcome.notes.end(), notes.begin(), notes.end());
    return outcome;
}

} // namespace

CommandMiddleware create_journal_middleware(std::shared_ptr<JournalSink> sink,
                                            JournalMiddlewareOptions options) {
    if (!options.filter) {
        options.filter = default_filter;
    }
    return [sink = std::move(sink), options = std::move(options)](
               std::string_view name, const Json& input, CommandContext& context,
               const Next& next) -> CommandResult {
        if (context.journal && context.journal->replaying) {
            // The first journal middleware rewinds and spends the marker; inner ones pass through.
            const auto state = context.journal;
            if (!state->rewind) {
                return next();
            }
            const std::function<void()> rewind = std::exchange(state->rewind, nullptr);
            const std::function<void()> end = std::exchange(state->end, nullptr);
            rewind();
            const ScopeExit ended([&end]() {
                if (end) {
                    end();
                }
            });
            return next();
        }
        if (!options.filter(name)) {
            return next();
        }

        // Contexts from a registry always have both; a bare executor's may not.
        const std::shared_ptr<const Clock> clock =
            context.clock ? context.clock : std::make_shared<SystemClock>();
        const std::shared_ptr<RandomSource> random =
            context.random ? context.random : std::make_shared<SystemRandom>();
        const std::shared_ptr<detail::JournalCallState> outer = context.journal;
        // This journal's own timing reads the clock under any outer journal's recorder.
        const std::shared_ptr<const Clock> timing =
            outer && outer->untaped && outer->recording == clock ? outer->untaped : clock;

        // The same context reaches the handler, so swapping its sources records what it reads.
        const auto tape = std::make_shared<TapeRecorder>(options.max_tape_reads);
        auto state = std::make_shared<detail::JournalCallState>();
        state->untaped = timing;
        state->recording = std::make_shared<RecordingClock>(clock, tape);
        auto recording_random = std::make_shared<RecordingRandom>(random, tape);

        const std::int64_t started_at = timing->wall_ms();
        const double start = timing->steady_ms();
        CommandResult result;
#if AFD_HAS_EXCEPTIONS
        std::exception_ptr thrown;
#endif
        {
            const ScopeExit restore([&]() {
                context.clock = clock;
                context.random = random;
                context.journal = outer;
            });
            context.clock = state->recording;
            context.random = std::move(recording_random);
            context.journal = std::move(state);
#if AFD_HAS_EXCEPTIONS
            try {
                result = next();
            } catch (...) {
                thrown = std::current_exception();
                // What the registry returns for a throw outside dev mode, never the message.
                result = execution_failure("", false);
            }
#else
            result = next();
#endif
        }
        const double duration_ms = (std::max)(0.0, timing->steady_ms() - start);

        if (result.success || options.record_failures) {
            store(*sink, options, [&]() {
                JournalTape recorded = tape->tape();
                const bool has_tape =
                    !recorded.clock.empty() || !recorded.random.empty() || recorded.truncated;
                return JournalRecord{.timestamp = wire::iso8601_utc(started_at),
                                     .trace_id = context.trace_id,
                                     .command = std::string(name),
                                     .input = input,
                                     .actor = context.actor,
                                     .context_digest = create_context_digest(context),
                                     .result = result,
                                     .duration_ms = duration_ms,
                                     .tape = has_tape ? std::optional(std::move(recorded))
                                                      : std::nullopt};
            });
        }
#if AFD_HAS_EXCEPTIONS
        if (thrown) {
            std::rethrow_exception(thrown);
        }
#endif
        return result;
    };
}

ReplayReport replay_journal(const CommandExecutor& execute,
                            const std::vector<JournalEntry>& entries,
                            const ReplayJournalOptions& options) {
    const std::vector<std::string> default_ignore = {"metadata.executionTimeMs"};
    const auto& paths = options.ignore ? *options.ignore : default_ignore;
    const std::set<std::string, std::less<>> ignore(paths.begin(), paths.end());
    std::vector<const JournalEntry*> ordered;
    ordered.reserve(entries.size());
    for (const auto& entry : entries) {
        ordered.push_back(&entry);
    }
    std::stable_sort(ordered.begin(), ordered.end(),
                     [](const JournalEntry* a, const JournalEntry* b) { return a->seq < b->seq; });

    ReplayReport report;
    for (std::size_t index = 0; index < ordered.size(); ++index) {
        ReplayEntryReport outcome = replay_entry(execute, *ordered[index], options, ignore);
        const ReplayStatus status = outcome.status;
        report.entries.push_back(std::move(outcome));
        if (status == ReplayStatus::same) {
            ++report.same;
            continue;
        }
        (status == ReplayStatus::different ? report.different : report.errors) += 1;
        report.diverged = true;
        if (options.stop_on_divergence) {
            report.skipped = ordered.size() - index - 1;
            break;
        }
    }
    return report;
}

ReplayReport replay_journal(const CommandRegistry& registry,
                            const std::vector<JournalEntry>& entries,
                            const ReplayJournalOptions& options) {
    return replay_journal(
        [&registry](std::string_view name, const Json& input, CommandContext& context) {
            return registry.execute(name, input, context);
        },
        entries, options);
}

std::string_view replay_status_name(ReplayStatus status) noexcept {
    switch (status) {
    case ReplayStatus::same:
        return "same";
    case ReplayStatus::different:
        return "different";
    case ReplayStatus::error:
        return "error";
    }
    return "error";
}

std::string_view replay_difference_kind_name(ReplayDifferenceKind kind) noexcept {
    switch (kind) {
    case ReplayDifferenceKind::changed:
        return "changed";
    case ReplayDifferenceKind::added:
        return "added";
    case ReplayDifferenceKind::removed:
        return "removed";
    }
    return "changed";
}

} // namespace afd
