// The journal middleware and replay (packages/server/src/journal.ts and journal-replay.ts).
#include "afd/journal.hpp"
#include "afd/registry.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <set>
#include <utility>

#include "detail/approval_admission.hpp"
#include "detail/context_fields.hpp"
#include "detail/exceptions.hpp"
#include "detail/iso8601.hpp"
#include "detail/journal_state.hpp"
#include "detail/random_unit.hpp"

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
class TapeRecorder final : public detail::TapeMark {
public:
    explicit TapeRecorder(std::size_t max_reads) : max_reads_(max_reads) {}

    void clock(double value) { keep(tape_.clock, value); }
    void random(double value) { keep(tape_.random, value); }
    void truncate() override {
        const std::lock_guard lock(mutex_);
        tape_.truncated = true;
    }

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
        : inner_(std::move(inner)), tape_(std::move(tape)), taped_{inner_, tape_} {}

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
    [[nodiscard]] const detail::TapedClock* journal_tape() const noexcept override {
        return &taped_;
    }

private:
    std::shared_ptr<const Clock> inner_;
    std::shared_ptr<TapeRecorder> tape_;
    detail::TapedClock taped_;
};

class RecordingRandom final : public RandomSource {
public:
    RecordingRandom(std::shared_ptr<RandomSource> inner, std::shared_ptr<TapeRecorder> tape)
        : inner_(std::move(inner)), tape_(std::move(tape)), taped_{inner_, tape_} {}

    [[nodiscard]] double next() override {
        const double value = detail::clamp_unit_random(inner_->next());
        tape_->random(value);
        return value;
    }
    [[nodiscard]] std::optional<std::string> seed() const override { return inner_->seed(); }
    [[nodiscard]] const detail::TapedRandom* journal_tape() const noexcept override {
        return &taped_;
    }

private:
    std::shared_ptr<RandomSource> inner_;
    std::shared_ptr<TapeRecorder> tape_;
    detail::TapedRandom taped_;
};

bool default_filter(std::string_view name) {
    // The auth commands take passwords and return sessions.
    return name.substr(0, 5) != "auth-";
}

// The `secret` declaration of the command the registry runs for this call, read from the record
// it put on the context before any middleware ran, never from the name. Unset outside the
// registry's execution (a DirectClient's own middleware, or a direct call), for a record of a
// call that has returned (a kept copy of its context), for one naming another command, and for a
// recorder whose `next` the registry did not build: one a handler runs itself on its own context,
// or keeps and runs later, is not the registry's, so the command's declaration is not its to read.
std::optional<bool> live_secret(const CommandContext& context, std::string_view name,
                                const Next& next) {
    const detail::ApprovalAdmission* record = context.approval_admission.get();
    if (record == nullptr || !record->running.load() || !record->command ||
        record->command->name != name || !detail::is_registry_next(context, next)) {
        return std::nullopt;
    }
    return static_cast<bool>(record->command->secret);
}

// The source under every recording wrapper on `source`, marking each wrapper's tape truncated.
template <class Source>
Source untape(Source source, bool& moved) {
    while (source) {
        const auto* taped = source->journal_tape();
        if (taped == nullptr || !taped->inner) {
            break;
        }
        if (taped->tape) {
            taped->tape->truncate();
        }
        source = taped->inner;
        moved = true;
    }
    return source;
}

// Runs `run` off every tape: a call the journal leaves unrecorded because it may carry a secret
// would otherwise read the clock and random source a recording parent wrapped, putting the values
// that built the secret on the parent's tape. Each recording source names its tape, wherever the
// context that carries it came from, and that tape is marked truncated instead, so its replay
// says it cannot restore every value.
template <class Run>
CommandResult off_tape(CommandContext& context, const Run& run) {
    bool moved = false;
    std::shared_ptr<const Clock> clock = untape(context.clock, moved);
    std::shared_ptr<RandomSource> random = untape(context.random, moved);
    if (!moved) {
        return run();
    }
    std::swap(clock, context.clock);
    std::swap(random, context.random);
    const ScopeExit restore([&]() {
        context.clock = clock;
        context.random = random;
    });
    return run();
}

// Builds and stores the entry for one call. Errors, including a throw while building it, go to
// `on_error`, never to the caller.
template <class Build>
void store(JournalSink& sink, const JournalMiddlewareOptions& options,
           const JournalRedactInfo& info, const Build& build) {
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
        std::optional<JournalRecord> kept = options.redact ? options.redact(std::move(record), info)
                                                           : std::optional(std::move(record));
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
            return detail::clamp_unit_random(values_[index_++]);
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
                               const std::set<std::string, std::less<>>& ignore,
                               bool target_checks_app_calls) {
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
    auto start = detail::parse_iso8601_ms(entry.timestamp);
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

    const bool recorded_apps =
        entry.context_digest.surface && *entry.context_digest.surface == "apps";
    // An app's call (`spec/app-calls.md`) replays only on a target
    // that checks call grants (`CommandRegistry`); an arbitrary `CommandExecutor` might ignore
    // `context.surface`, so it is refused rather than run unchecked.
    if (recorded_apps && !target_checks_app_calls) {
        outcome.error = "the entry is an app's call (interface 'apps'), which this replay target "
                        "cannot check against a grant; not replayed";
        return outcome;
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
    // The recorded context field values, which the target validates again. One it no longer
    // declares, or one too large to have been kept, is replayed without its value.
    if (entry.context && entry.context->is_object()) {
        for (auto it = entry.context->begin(); it != entry.context->end(); ++it) {
            const auto& declared = options.context_fields;
            if (declared &&
                std::find(declared->begin(), declared->end(), it.key()) == declared->end()) {
                outcome.notes.push_back("context field '" + it.key() +
                                        "' is no longer declared; replayed without it");
            } else {
                context.extra[it.key()] = it.value();
            }
        }
    }
    for (const auto& name : entry.context_omitted.value_or(std::vector<std::string>{})) {
        outcome.notes.push_back("context field '" + name +
                                "' was too large to journal; replayed without it");
    }
    if (entry.output_budget) {
        context.output_budget_ask = *entry.output_budget;
    }
    context.clock = clock ? std::shared_ptr<const Clock>(clock) : fixed_clock(*start);
    context.random = random;

    const auto run = [&]() {
        if (options.context) {
            options.context(entry, context);
        }
        if (recorded_apps) {
            // Keep `Interface::apps` even if `options.context` tried to override it.
            context.surface = Interface::apps;
        }
        if (!target_checks_app_calls && context.surface == Interface::apps) {
            outcome.error = "the entry is an app's call (interface 'apps'), which this replay "
                            "target cannot check against a grant; not replayed";
            return;
        }
        // A journal middleware in the replayed chain rewinds the tape where it sits, so
        // middleware outside it does not shift the handler's readings.
        auto state = std::make_shared<detail::JournalCallState>();
        state->replaying = true;
        // A budgeted command that succeeded without a B6 report ran via buffered `execute_stream`
        // (B7); preserve that unchecked mode on replay so it does not falsely diverge.
        const bool has_budget_report =
            entry.result.metadata && entry.result.metadata->extra.is_object() &&
            entry.result.metadata->extra.contains(std::string(output_budget_meta_key));
        state->skip_output_budget_check =
            entry.output_budget.has_value() && entry.result.success && !has_budget_report;
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

ReplayReport replay_journal_impl(const CommandExecutor& execute,
                                 const std::vector<JournalEntry>& entries,
                                 const ReplayJournalOptions& options,
                                 bool target_checks_app_calls) {
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
        ReplayEntryReport outcome =
            replay_entry(execute, *ordered[index], options, ignore, target_checks_app_calls);
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

// Records one call that reached the journal and may be recorded: `info` is what `redact` is told.
CommandResult record_call(JournalSink& sink, const JournalMiddlewareOptions& options,
                          const JournalRedactInfo& info, std::string_view name, const Json& input,
                          CommandContext& context, const Next& next) {
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

    const std::optional<std::uint64_t> output_budget = context.output_budget;
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
            context.output_budget = output_budget;
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
        store(sink, options, info, [&]() {
            JournalTape recorded = tape->tape();
            const bool has_tape =
                !recorded.clock.empty() || !recorded.random.empty() || recorded.truncated;
            detail::JournaledContextValues fields = detail::journaled_context_values(context);
            JournalContextDigest digest =
                create_context_digest(context, fields.context, fields.omitted);
            return JournalRecord{.timestamp = wire::iso8601_utc(started_at),
                                 .trace_id = context.trace_id,
                                 .command = std::string(name),
                                 .input = input,
                                 .actor = context.actor,
                                 .context_digest = std::move(digest),
                                 .context = std::move(fields.context),
                                 .context_omitted = std::move(fields.omitted),
                                 .result = result,
                                 .duration_ms = duration_ms,
                                 .tape =
                                     has_tape ? std::optional(std::move(recorded)) : std::nullopt,
                                 .output_budget = output_budget};
        });
    }
#if AFD_HAS_EXCEPTIONS
    if (thrown) {
        std::rethrow_exception(thrown);
    }
#endif
    return result;
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
        // A command declaring `secret` is recorded only when a `redact` can remove the secret: a
        // filter alone never admits it (spec/journal.md). Where the declaration cannot be read,
        // no call is recorded without `redact`.
        const std::optional<bool> secret = live_secret(context, name, next);
        const JournalRedactInfo info{.secret = secret};
        if (secret.value_or(true) && !options.redact) {
            return off_tape(context, next);
        }
        // A secret call, or one whose declaration cannot be read, recorded or skipped by `filter`,
        // reads off its parent's tape too: its own recording, if any, keeps its reads on its own
        // entry, for `redact` to drop.
        if (secret.value_or(true)) {
            return off_tape(context, [&]() {
                return record_call(*sink, options, info, name, input, context, next);
            });
        }
        return record_call(*sink, options, info, name, input, context, next);
    };
}

ReplayReport replay_journal(const CommandExecutor& execute,
                            const std::vector<JournalEntry>& entries,
                            const ReplayJournalOptions& options) {
    return replay_journal_impl(execute, entries, options, false);
}

ReplayReport replay_journal(const CommandRegistry& registry,
                            const std::vector<JournalEntry>& entries,
                            const ReplayJournalOptions& options) {
    const CommandExecutor execute = [&registry](std::string_view name, const Json& input,
                                                CommandContext& context) {
        const bool check_budget = !(context.journal && context.journal->skip_output_budget_check);
        return registry.execute_impl(name, input, context, check_budget);
    };
    if (options.context_fields) {
        return replay_journal_impl(execute, entries, options, true);
    }
    ReplayJournalOptions declared = options;
    declared.context_fields.emplace();
    for (const auto& field : registry.context_fields()) {
        declared.context_fields->push_back(field.name);
    }
    return replay_journal_impl(execute, entries, declared, true);
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
