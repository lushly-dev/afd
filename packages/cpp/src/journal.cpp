// Journal entries, the memory sink, the context digest and JSON Lines
// (packages/core/src/journal.ts). Recording and replay are in journal_replay.cpp.
#include "afd/journal.hpp"

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <utility>

#include "detail/journal_state.hpp"
#include "detail/json_io.hpp"
#include "detail/sha256.hpp"

namespace afd {
namespace {

constexpr double max_safe_integer = 9007199254740991.0; // 2^53 - 1

const Json* find_member(const Json& object, std::string_view key) {
    const auto it = object.find(key);
    return it == object.end() ? nullptr : &*it;
}

bool is_finite_number(const Json& value) {
    return value.is_number() && std::isfinite(value.get<double>());
}

// Reads the members of an entry. Unlike `detail::ObjectReader`, a `null` optional member is an
// error, as in TypeScript's `isJournalEntry`: unset fields are omitted, never `null`.
class EntryReader {
public:
    EntryReader(const Json& value, std::string path, std::string& error)
        : object_(value.is_object() ? &value : nullptr), path_(std::move(path)), error_(error) {
        if (object_ == nullptr) {
            detail::record(error_, path_, "expected an object");
        }
    }

    [[nodiscard]] bool ok() const noexcept { return object_ != nullptr && error_.empty(); }

    // The member `key`, or nullptr (recording an error) when a required one is missing.
    const Json* get(std::string_view key, bool required) {
        if (object_ == nullptr) {
            return nullptr;
        }
        const Json* member = find_member(*object_, key);
        if (member == nullptr && required) {
            fail(key, "is required");
        }
        return member;
    }

    void string(std::string_view key, std::string& out) {
        if (const Json* member = get(key, true)) {
            detail::read_value(*member, at(key), out, error_);
        }
    }

    void optional_string(std::string_view key, std::optional<std::string>& out) {
        if (const Json* member = get(key, false)) {
            std::string value;
            if (detail::read_value(*member, at(key), value, error_)) {
                out = std::move(value);
            }
        }
    }

    void finite_number(std::string_view key, double& out) {
        if (const Json* member = get(key, true)) {
            if (is_finite_number(*member)) {
                out = member->get<double>();
            } else {
                fail(key, "expected a finite number");
            }
        }
    }

    void fail(std::string_view key, std::string_view problem) {
        detail::record(error_, at(key), problem);
    }

    [[nodiscard]] std::string at(std::string_view key) const {
        return detail::child_path(path_, key);
    }
    [[nodiscard]] std::string& error() noexcept { return error_; }

private:
    const Json* object_;
    std::string path_;
    std::string& error_;
};

bool read_numbers(const Json& value, const std::string& path, std::vector<double>& out,
                  std::string& error) {
    if (!value.is_array()) {
        detail::record(error, path, "expected an array of finite numbers");
        return false;
    }
    out.clear();
    for (const auto& item : value) {
        if (!is_finite_number(item)) {
            detail::record(error, path, "expected an array of finite numbers");
            return false;
        }
        out.push_back(item.get<double>());
    }
    return true;
}

bool read_tape(const Json& value, const std::string& path, JournalTape& out, std::string& error) {
    EntryReader reader(value, path, error);
    if (const Json* clock = reader.get("clock", true)) {
        read_numbers(*clock, reader.at("clock"), out.clock, error);
    }
    if (const Json* random = reader.get("random", true)) {
        read_numbers(*random, reader.at("random"), out.random, error);
    }
    if (const Json* truncated = reader.get("truncated", false)) {
        detail::read_value(*truncated, reader.at("truncated"), out.truncated, error);
    }
    return reader.ok();
}

bool read_digest(const Json& value, const std::string& path, JournalContextDigest& out,
                 std::string& error) {
    EntryReader reader(value, path, error);
    reader.string("hash", out.hash);
    reader.optional_string("interface", out.surface);
    return reader.ok();
}

bool read_strings(const Json& value, const std::string& path, std::vector<std::string>& out,
                  std::string& error) {
    if (!value.is_array() || !std::all_of(value.begin(), value.end(),
                                          [](const Json& item) { return item.is_string(); })) {
        detail::record(error, path, "expected an array of strings");
        return false;
    }
    out.clear();
    for (const auto& item : value) {
        out.push_back(item.get<std::string>());
    }
    return true;
}

bool read_entry(const Json& value, JournalEntry& out, std::string& error) {
    EntryReader reader(value, std::string(), error);
    if (const Json* seq = reader.get("seq", true)) {
        const bool integral =
            is_finite_number(*seq) && std::trunc(seq->get<double>()) == seq->get<double>();
        if (integral && seq->get<double>() >= 1 && seq->get<double>() <= max_safe_integer) {
            out.seq = static_cast<std::int64_t>(seq->get<double>());
        } else {
            reader.fail("seq", "expected an integer from 1 to 2^53 - 1");
        }
    }
    reader.string("timestamp", out.timestamp);
    reader.optional_string("traceId", out.trace_id);
    reader.string("command", out.command);
    if (const Json* input = reader.get("input", true)) {
        out.input = *input;
    }
    if (const Json* actor = reader.get("actor", false)) {
        out.actor = journal_actor(*actor);
        if (!out.actor) {
            reader.fail("actor", "expected an actor");
        }
    }
    if (const Json* digest = reader.get("contextDigest", true)) {
        read_digest(*digest, reader.at("contextDigest"), out.context_digest, error);
    }
    if (const Json* context = reader.get("context", false)) {
        if (context->is_object()) {
            out.context = *context;
        } else {
            reader.fail("context", "expected an object");
        }
    }
    if (const Json* omitted = reader.get("contextOmitted", false)) {
        std::vector<std::string> names;
        if (read_strings(*omitted, reader.at("contextOmitted"), names, error)) {
            out.context_omitted = std::move(names);
        }
    }
    if (const Json* result = reader.get("result", true)) {
        detail::read_value(*result, reader.at("result"), out.result, error);
    }
    reader.finite_number("durationMs", out.duration_ms);
    if (const Json* tape = reader.get("tape", false)) {
        JournalTape read;
        if (read_tape(*tape, reader.at("tape"), read, error)) {
            out.tape = std::move(read);
        }
    }
    return reader.ok();
}

Json numbers(const std::vector<double>& values) {
    Json out = Json::array();
    for (const double value : values) {
        out.push_back(wire::number(value));
    }
    return out;
}

// `object`'s members named in `keys`, in that order, as JSON object text.
std::string ordered_object(const Json& object, std::initializer_list<const char*> keys) {
    std::string text = "{";
    for (const char* key : keys) {
        const Json* member = find_member(object, key);
        if (member == nullptr) {
            continue;
        }
        text += text.size() > 1 ? ",\"" : "\"";
        text += key;
        text += "\":";
        text += std::string_view(key) == "actor"
                    ? ordered_object(*member, {"kind", "id", "label", "onBehalfOf"})
                    : wire::serialize(*member);
    }
    return text + "}";
}

bool is_blank(std::string_view line) {
    return std::all_of(line.begin(), line.end(), [](char c) {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v';
    });
}

} // namespace

// --- entries ------------------------------------------------------------------------------

Expected<JournalEntry> JournalEntry::from_json(const Json& value) {
    std::string error;
    JournalEntry entry;
    if (!read_entry(value, entry, error) || !error.empty()) {
        return unexpected(error.empty() ? std::string("(root): invalid value") : error);
    }
    return entry;
}

bool is_journal_entry(const Json& value) {
    return JournalEntry::from_json(value).has_value();
}

void to_json(Json& out, const JournalTape& tape) {
    out = Json::object();
    out["clock"] = numbers(tape.clock);
    out["random"] = numbers(tape.random);
    if (tape.truncated) {
        out["truncated"] = true;
    }
}

void to_json(Json& out, const JournalContextDigest& digest) {
    out = Json::object();
    out["hash"] = digest.hash;
    detail::put(out, "interface", digest.surface);
}

void to_json(Json& out, const JournalEntry& entry) {
    out = Json::object();
    out["seq"] = entry.seq;
    out["timestamp"] = entry.timestamp;
    detail::put(out, "traceId", entry.trace_id);
    out["command"] = entry.command;
    out["input"] = entry.input;
    detail::put(out, "actor", entry.actor);
    out["contextDigest"] = entry.context_digest;
    detail::put(out, "context", entry.context);
    detail::put(out, "contextOmitted", entry.context_omitted);
    out["result"] = entry.result;
    out["durationMs"] = wire::number(entry.duration_ms);
    detail::put(out, "tape", entry.tape);
}

std::optional<Actor> journal_actor(const Json& value) {
    if (!is_actor(value)) {
        return std::nullopt;
    }
    auto actor = Actor::from_json(value);
    return actor ? std::optional<Actor>(std::move(*actor)) : std::nullopt;
}

// --- sinks --------------------------------------------------------------------------------

std::vector<JournalEntry> select_journal_range(const std::vector<JournalEntry>& entries,
                                               JournalRange range) {
    std::vector<JournalEntry> out;
    for (const auto& entry : entries) {
        if ((!range.from || entry.seq >= *range.from) && (!range.to || entry.seq <= *range.to)) {
            out.push_back(entry);
        }
    }
    return out;
}

MemoryJournalSink::MemoryJournalSink(std::vector<JournalEntry> initial)
    : entries_(std::move(initial)) {
    std::stable_sort(entries_.begin(), entries_.end(),
                     [](const JournalEntry& a, const JournalEntry& b) { return a.seq < b.seq; });
}

Expected<JournalEntry> MemoryJournalSink::append(JournalRecord record) {
    const std::lock_guard lock(mutex_);
    JournalEntry entry;
    static_cast<JournalRecord&>(entry) = std::move(record);
    entry.seq = (entries_.empty() ? 0 : entries_.back().seq) + 1;
    entries_.push_back(entry);
    return entry;
}

Expected<std::vector<JournalEntry>> MemoryJournalSink::read(JournalRange range) {
    const std::lock_guard lock(mutex_);
    return select_journal_range(entries_, range);
}

// --- context digest -----------------------------------------------------------------------

JournalContextDigest create_context_digest(const CommandContext& context,
                                           const std::optional<Json>& journaled,
                                           const std::optional<std::vector<std::string>>& omitted) {
    // The names of the context fields the entry keeps (or lists as too large) leave `keys`.
    std::vector<std::string> recorded = omitted.value_or(std::vector<std::string>{});
    if (journaled && journaled->is_object()) {
        for (auto it = journaled->begin(); it != journaled->end(); ++it) {
            recorded.push_back(it.key());
        }
    }
    const auto is_recorded = [&recorded](const std::string& key) {
        return std::find(recorded.begin(), recorded.end(), key) != recorded.end();
    };

    std::optional<std::string> surface;
    if (context.surface) {
        surface = std::string(detail::surface_wire_name(*context.surface));
    }
    // The other members that are set, by their TypeScript names. Names only, never values.
    std::vector<std::string> keys;
    if (context.active_context) {
        keys.emplace_back("activeContext");
    }
    if (context.approval) {
        keys.emplace_back("approval");
    }
    if (context.clock) {
        keys.emplace_back("clock");
    }
    if (context.random) {
        keys.emplace_back("random");
    }
    if (context.timeout_ms) {
        keys.emplace_back("timeoutMs");
    }
    if (context.extra.is_object()) {
        for (auto it = context.extra.begin(); it != context.extra.end(); ++it) {
            if (it.key() != "actor" && it.key() != "interface" && it.key() != "traceId") {
                keys.push_back(it.key());
            }
        }
    }
    keys.erase(std::remove_if(keys.begin(), keys.end(), is_recorded), keys.end());
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());

    // `Json` objects keep their keys sorted, so `serialize` writes canonical JSON.
    Json canonical = Json::object();
    canonical["actor"] = context.actor ? Json(*context.actor) : Json(nullptr);
    if (journaled) {
        canonical["context"] = *journaled;
    }
    if (omitted) {
        canonical["contextOmitted"] = *omitted;
    }
    canonical["interface"] = surface ? Json(*surface) : Json(nullptr);
    canonical["keys"] = keys;
    canonical["traceId"] = context.trace_id ? Json(*context.trace_id) : Json(nullptr);
    return {.hash = "sha256:" + detail::sha256_hex(wire::serialize(canonical)),
            .surface = std::move(surface)};
}

// --- JSON Lines ---------------------------------------------------------------------------

std::string serialize_journal_entry(const JournalEntry& entry) {
    // The spec's key order for the entry and its actor, so lines read the same across
    // implementations up to the result.
    return ordered_object(Json(entry), {"seq", "timestamp", "traceId", "command", "input", "actor",
                                        "contextDigest", "context", "contextOmitted", "result",
                                        "durationMs", "tape"});
}

std::string serialize_journal(const std::vector<JournalEntry>& entries) {
    std::string text;
    for (const auto& entry : entries) {
        text += serialize_journal_entry(entry);
        text += '\n';
    }
    return text;
}

Expected<std::vector<JournalEntry>> parse_journal(std::string_view text, ParseLimits limits) {
    std::vector<JournalEntry> entries;
    std::size_t start = 0;
    for (std::size_t number = 1; start <= text.size(); ++number) {
        const std::size_t newline = text.find('\n', start);
        std::string_view line = text.substr(
            start, newline == std::string_view::npos ? text.size() - start : newline - start);
        start = newline == std::string_view::npos ? text.size() + 1 : newline + 1;
        if (!line.empty() && line.back() == '\r') {
            line.remove_suffix(1);
        }
        if (is_blank(line)) {
            continue;
        }
        auto value = parse_bounded(line, limits);
        if (!value) {
            return unexpected("Journal line " + std::to_string(number) +
                              " is not valid JSON: " + value.error().message);
        }
        auto entry = JournalEntry::from_json(*value);
        if (!entry) {
            return unexpected("Journal line " + std::to_string(number) +
                              " is not a journal entry: " + entry.error());
        }
        entries.push_back(std::move(*entry));
    }
    return entries;
}

} // namespace afd
