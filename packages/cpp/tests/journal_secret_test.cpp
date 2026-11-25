// Commands that declare `secret` in the journal (spec/journal.md, "Inputs and results are
// recorded as they are"; packages/server/src/journal.test.ts, search `secret`).
#include "afd/afd.hpp"

#include <concepts>
#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include <doctest.h>

namespace {

void add(afd::CommandRegistry& registry, afd::CommandDefinition command) {
    const auto error = registry.register_command(std::move(command));
    REQUIRE_MESSAGE(!error, error.value_or(""));
}

afd::CommandDefinition vault_unlock() {
    return {
        .name = "vault-unlock",
        .description = "Unlock the vault",
        .input_schema = {{"type", "object"},
                         {"properties", {{"passphrase", {{"type", "string"}}}}}},
        .handler = [](const afd::Json&,
                      afd::CommandContext&) { return afd::success({{"key", "SECRET-VAULT-KEY"}}); },
        .secret = true};
}

afd::CommandDefinition dice_roll() {
    return {
        .name = "dice-roll",
        .description = "Roll a die",
        .input_schema = {{"type", "object"}, {"properties", {{"sides", {{"type", "integer"}}}}}},
        .handler = [](const afd::Json& input, afd::CommandContext& context) {
            return afd::success(
                {{"sides", input.value("sides", 6)}, {"roll", context.random->next()}});
        }};
}

std::vector<afd::JournalEntry> read_all(afd::JournalSink& sink) {
    auto read = sink.read();
    REQUIRE(read.has_value());
    return *read;
}

std::vector<std::string> commands_of(const std::vector<afd::JournalEntry>& entries) {
    std::vector<std::string> out;
    for (const auto& entry : entries) {
        out.push_back(entry.command);
    }
    return out;
}

bool mentions_secret(const std::vector<afd::JournalEntry>& entries) {
    const std::string text = afd::serialize_journal(entries);
    return text.find("hunter2") != std::string::npos || text.find("SECRET") != std::string::npos;
}

/// Counts and returns 0.25 + 0.01 * n for the nth draw.
class CountingRandom final : public afd::RandomSource {
public:
    double next() override { return 0.25 + 0.01 * ++draws; }
    int draws = 0;
};

/// A registry whose `session-open` mints a token through the secret `token-mint`, called from its
/// handler with its context (or, with `fresh_context`, a new context carrying only its clock and
/// random source), and the journal middleware built with `options`.
struct NestedMint {
    std::shared_ptr<afd::MemoryJournalSink> sink = std::make_shared<afd::MemoryJournalSink>();
    std::shared_ptr<CountingRandom> random = std::make_shared<CountingRandom>();
    std::shared_ptr<afd::CommandRegistry> registry;

    NestedMint(afd::JournalMiddlewareOptions options, int draws_per_mint,
               bool fresh_context = false) {
        registry = std::make_shared<afd::CommandRegistry>(afd::CommandRegistryOptions{
            .middleware = {afd::create_journal_middleware(sink, std::move(options))},
            .clock = afd::fixed_clock(1767225600000),
            .random = random});
        add(*registry, {.name = "token-mint",
                        .description = "Mint a token from random values",
                        .handler =
                            [draws_per_mint](const afd::Json&, afd::CommandContext& context) {
                                std::string token = "T";
                                for (int i = 0; i < draws_per_mint; ++i) {
                                    token += "-" + std::to_string(context.random->next());
                                }
                                return afd::success({{"token", token}});
                            },
                        .secret = true});
        const std::weak_ptr<afd::CommandRegistry> weak = registry;
        add(*registry,
            {.name = "session-open",
             .description = "Open a session, minting its token",
             .handler = [weak, fresh_context](const afd::Json&, afd::CommandContext& context) {
                 const auto self = weak.lock();
                 REQUIRE(self);
                 afd::CommandContext fresh;
                 fresh.clock = context.clock;
                 fresh.random = context.random;
                 CHECK(self->execute("token-mint", afd::Json::object(),
                                     fresh_context ? fresh : context)
                           .success);
                 return afd::success({{"opened", true}});
             }});
    }
};

// `secret` takes only a `bool`, in a designated initializer and in an assignment.
template <class T>
concept initializes_secret = requires(T value) { afd::CommandDefinition{.secret = value}; };
template <class T>
concept assigns_secret =
    requires(afd::CommandDefinition& command, T value) { command.secret = value; };
static_assert(initializes_secret<bool>);
static_assert(assigns_secret<bool>);
static_assert(!initializes_secret<int>);
static_assert(!assigns_secret<int>);
static_assert(!initializes_secret<const char*>);
static_assert(!assigns_secret<double>);
static_assert(!std::is_constructible_v<afd::StrictBool, int>);
static_assert(!std::is_assignable_v<afd::StrictBool&, int>);

// `JournalRedact` converts from exactly the functions it can call.
using OneArgument = std::function<std::optional<afd::JournalRecord>(afd::JournalRecord)>;
using TwoArguments = std::function<std::optional<afd::JournalRecord>(
    afd::JournalRecord, const afd::JournalRedactInfo&)>;
static_assert(std::is_convertible_v<OneArgument, afd::JournalRedact>);
static_assert(std::is_convertible_v<TwoArguments, afd::JournalRedact>);
static_assert(std::is_convertible_v<std::nullptr_t, afd::JournalRedact>);
static_assert(!std::is_convertible_v<int, afd::JournalRedact>);
static_assert(!std::is_convertible_v<std::function<int(int)>, afd::JournalRedact>);
static_assert(!std::is_convertible_v<std::function<bool(afd::JournalRecord)>, afd::JournalRedact>);

} // namespace

TEST_CASE("a command that declares secret is never recorded without redact, whatever its "
          "name or filter") {
    const auto run = [](afd::JournalMiddlewareOptions options) {
        auto sink = std::make_shared<afd::MemoryJournalSink>();
        afd::CommandRegistry registry(
            {.middleware = {afd::create_journal_middleware(sink, std::move(options))}});
        add(registry, vault_unlock());
        add(registry, dice_roll());
        CHECK(registry.execute("vault-unlock", {{"passphrase", "hunter2"}}).success);
        CHECK(registry.execute("dice-roll", {{"sides", 6}}).success);
        return read_all(*sink);
    };
    const auto all = [](std::string_view) { return true; };

    for (afd::JournalMiddlewareOptions options :
         {afd::JournalMiddlewareOptions{}, afd::JournalMiddlewareOptions{.filter = all},
          afd::JournalMiddlewareOptions{.record_failures = true, .filter = all}}) {
        const auto entries = run(std::move(options));
        CHECK(commands_of(entries) == std::vector<std::string>{"dice-roll"});
        CHECK_FALSE(mentions_secret(entries));
    }

    // With redact, the host removes the secret, and the call is recorded.
    const auto redacted =
        run({.filter = all,
             .redact = [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
                 record.input = afd::Json::object();
                 record.result = afd::success(afd::Json::object());
                 return record;
             }});
    CHECK(commands_of(redacted) == std::vector<std::string>{"vault-unlock", "dice-roll"});
    CHECK_FALSE(mentions_secret(redacted));

    // A batch runs each item through the same execution, so the same rule holds there.
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry(
        {.middleware = {afd::create_journal_middleware(sink, {.filter = all})}});
    add(registry, vault_unlock());
    const afd::BatchResult batch = registry.execute_batch(afd::Json::parse(
        R"({"commands": [{"command": "vault-unlock", "input": {"passphrase": "hunter2"}}]})"));
    CHECK(batch.success);
    CHECK(read_all(*sink).empty());
}

TEST_CASE("redact is told which calls are secret, and the one the middleware was built with "
          "is the one applied") {
    std::vector<std::pair<std::string, std::optional<bool>>> seen;
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry(
        {.middleware = {afd::create_journal_middleware(
             sink, {.filter = [](std::string_view) { return true; },
                    .redact = [&seen](afd::JournalRecord record, const afd::JournalRedactInfo& info)
                        -> std::optional<afd::JournalRecord> {
                        seen.emplace_back(record.command, info.secret);
                        if (info.secret.value_or(true)) {
                            return std::nullopt;
                        }
                        return record;
                    }})}});
    add(registry, vault_unlock());
    add(registry, dice_roll());
    CHECK(registry.execute("vault-unlock", {{"passphrase", "hunter2"}}).success);
    CHECK(registry.execute("dice-roll", {{"sides", 6}}).success);
    CHECK(seen == std::vector<std::pair<std::string, std::optional<bool>>>{{"vault-unlock", true},
                                                                           {"dice-roll", false}});
    CHECK(commands_of(read_all(*sink)) == std::vector<std::string>{"dice-roll"});

    // A redact added to the options after the middleware was built is not the one it applies,
    // so it admits nothing either.
    afd::JournalMiddlewareOptions options{.filter = [](std::string_view) { return true; }};
    auto later = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry reused({.middleware = {afd::create_journal_middleware(later, options)}});
    add(reused, vault_unlock());
    options.redact = [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
        return record;
    };
    CHECK(reused.execute("vault-unlock", {{"passphrase", "hunter2"}}).success);
    CHECK(read_all(*later).empty());
}

TEST_CASE("an empty std::function or null pointer given as redact counts as no redact") {
    const std::function<std::optional<afd::JournalRecord>(afd::JournalRecord)> empty;
    afd::JournalRedact from_empty = empty;
    CHECK_FALSE(from_empty);
    std::optional<afd::JournalRecord> (*null_pointer)(afd::JournalRecord) = nullptr;
    afd::JournalRedact from_null = null_pointer;
    CHECK_FALSE(from_null);
    afd::JournalRedact from_nullptr = nullptr;
    CHECK_FALSE(from_nullptr);

    const std::function<std::optional<afd::JournalRecord>(afd::JournalRecord)> keep =
        [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> { return record; };
    afd::JournalRedact from_keep = keep;
    REQUIRE(from_keep);
    CHECK(from_keep(afd::JournalRecord{.command = "dice-roll"})->command == "dice-roll");

    // With an empty redact, a secret call is still left unrecorded.
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry(
        {.middleware = {afd::create_journal_middleware(
             sink, {.filter = [](std::string_view) { return true; }, .redact = empty})}});
    add(registry, vault_unlock());
    CHECK(registry.execute("vault-unlock", {{"passphrase", "hunter2"}}).success);
    CHECK(read_all(*sink).empty());
}

TEST_CASE("records nothing without redact where the declaration cannot be read (a DirectClient)") {
    auto registry = std::make_shared<afd::CommandRegistry>();
    add(*registry, vault_unlock());
    add(*registry, dice_roll());
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    const afd::DirectClient client(registry,
                                   {.middleware = {afd::create_journal_middleware(
                                        sink, {.filter = [](std::string_view) { return true; }})}});
    CHECK(client.call("vault-unlock", {{"passphrase", "hunter2"}}).success);
    CHECK(client.call("dice-roll", {{"sides", 6}}).success);
    CHECK(read_all(*sink).empty());

    std::vector<std::optional<bool>> told;
    const auto telling = afd::create_journal_middleware(
        std::make_shared<afd::MemoryJournalSink>(),
        {.redact = [&told](afd::JournalRecord record, const afd::JournalRedactInfo& info)
             -> std::optional<afd::JournalRecord> {
            told.push_back(info.secret);
            return record;
        }});
    const afd::DirectClient redacting(registry, {.middleware = {telling}});
    CHECK(redacting.call("dice-roll", {{"sides", 6}}).success);

    // Nor from a context another call carries: a handler passing its own context to the client,
    // or calling the middleware itself under another command's name.
    add(*registry, {.name = "session-open",
                    .description = "Calls on through its own context",
                    .handler = [&](const afd::Json&, afd::CommandContext& context) {
                        CHECK(redacting.call("dice-roll", {{"sides", 6}}, context).success);
                        const afd::Next next = [] { return afd::success(afd::Json::object()); };
                        CHECK(telling("dice-roll", afd::Json::object(), context, next).success);
                        return afd::success({{"opened", true}});
                    }});
    CHECK(registry->execute("session-open").success);
    CHECK(told == std::vector<std::optional<bool>>{std::nullopt, std::nullopt, std::nullopt});
}

TEST_CASE("a recorder a handler runs itself on its own context reads no declaration") {
    // The registry's journal records `dice-roll` as before. The handler's own recorder, run on
    // the handler's context under the same name, is not the registry's: the command's
    // declaration (not secret) is not its to read, so without redact it records nothing.
    auto engine = std::make_shared<afd::MemoryJournalSink>();
    auto own = std::make_shared<afd::MemoryJournalSink>();
    const auto own_chain =
        afd::create_journal_middleware(own, {.filter = [](std::string_view) { return true; }});
    std::vector<std::optional<bool>> told;
    const auto telling = afd::create_journal_middleware(
        std::make_shared<afd::MemoryJournalSink>(),
        {.redact = [&told](afd::JournalRecord record, const afd::JournalRedactInfo& info)
             -> std::optional<afd::JournalRecord> {
            told.push_back(info.secret);
            return record;
        }});
    afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(engine), telling},
                                   .clock = afd::fixed_clock(1767225600000)});
    add(registry,
        {.name = "dice-roll",
         .description = "Roll a die through a chain of its own",
         .handler = [&](const afd::Json&, afd::CommandContext& context) {
             const afd::Next next = [] { return afd::success({{"key", "SECRET-VAULT-KEY"}}); };
             CHECK(own_chain("dice-roll", {{"passphrase", "hunter2"}}, context, next).success);
             CHECK(telling("dice-roll", afd::Json::object(), context, next).success);
             return afd::success({{"roll", 4}});
         }});
    CHECK(registry.execute("dice-roll").success);
    // After the first call: the handler's own recorder recorded nothing and read unknown. The
    // registry's reads the declaration on entry, before `next`, and is told it (`false`) by
    // redact after the handler returns, so it is second in `told`.
    CHECK(read_all(*own).empty());
    CHECK(told == std::vector<std::optional<bool>>{std::nullopt, false});
    CHECK(commands_of(read_all(*engine)) == std::vector<std::string>{"dice-roll"});
    // A second call reads the same way.
    told.clear();
    CHECK(registry.execute("dice-roll").success);
    CHECK(read_all(*own).empty());
    CHECK(told == std::vector<std::optional<bool>>{std::nullopt, false});
    CHECK(commands_of(read_all(*engine)) == std::vector<std::string>{"dice-roll", "dice-roll"});
}

namespace {

/// A journal middleware that records nothing itself and tells `told` what `redact` was told.
afd::CommandMiddleware telling_journal(std::vector<std::optional<bool>>& told) {
    return afd::create_journal_middleware(
        std::make_shared<afd::MemoryJournalSink>(),
        {.redact = [&told](afd::JournalRecord record, const afd::JournalRedactInfo& info)
             -> std::optional<afd::JournalRecord> {
            told.push_back(info.secret);
            return record;
        }});
}

} // namespace

TEST_CASE("a recorder a handler keeps and runs later, inside the call, reads no declaration") {
    // The handler keeps a recorder with a `next` of its own; an outer middleware runs it after
    // its `next` returned, while the call is still under way.
    auto own = std::make_shared<afd::MemoryJournalSink>();
    const auto own_chain =
        afd::create_journal_middleware(own, {.filter = [](std::string_view) { return true; }});
    std::vector<std::optional<bool>> told;
    const auto telling = telling_journal(told);
    std::function<void(afd::CommandContext&)> kept;
    const afd::CommandMiddleware runs_kept = [&kept](std::string_view, const afd::Json&,
                                                     afd::CommandContext& context,
                                                     const afd::Next& next) {
        afd::CommandResult result = next();
        REQUIRE(kept);
        kept(context);
        return result;
    };
    afd::CommandRegistry registry({.middleware = {runs_kept}});
    add(registry,
        {.name = "dice-roll",
         .description = "Roll a die, keeping a recorder for later",
         .handler = [&](const afd::Json&, afd::CommandContext&) {
             kept = [&](afd::CommandContext& context) {
                 const afd::Next next = [] { return afd::success({{"key", "SECRET-VAULT-KEY"}}); };
                 CHECK(own_chain("dice-roll", {{"passphrase", "hunter2"}}, context, next).success);
                 CHECK(telling("dice-roll", afd::Json::object(), context, next).success);
             };
             return afd::success({{"roll", 4}});
         }});
    CHECK(registry.execute("dice-roll").success);
    CHECK(read_all(*own).empty());
    CHECK(told == std::vector<std::optional<bool>>{std::nullopt});
}

TEST_CASE("a recorder with redact that reads no declaration stays off its parent's tape") {
    // The registry records `session-open`; its handler runs a recorder of its own, with redact,
    // which reads unknown. Its call's draw goes on its own entry, never the parent's.
    auto engine = std::make_shared<afd::MemoryJournalSink>();
    auto own = std::make_shared<afd::MemoryJournalSink>();
    const auto own_chain = afd::create_journal_middleware(
        own, {.redact = [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
            return record;
        }});
    auto random = std::make_shared<CountingRandom>();
    afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(engine)},
                                   .clock = afd::fixed_clock(1767225600000),
                                   .random = random});
    add(registry, {.name = "session-open",
                   .description = "Open a session through a recorder of its own",
                   .handler = [&](const afd::Json&, afd::CommandContext& context) {
                       const afd::Next next = [&context] {
                           return afd::success({{"draw", context.random->next()}});
                       };
                       CHECK(own_chain("session-open", afd::Json::object(), context, next).success);
                       return afd::success({{"opened", true}});
                   }});
    CHECK(registry.execute("session-open").success);
    const auto parent = read_all(*engine);
    REQUIRE(commands_of(parent) == std::vector<std::string>{"session-open"});
    REQUIRE(parent[0].tape.has_value());
    CHECK(parent[0].tape->random.empty());
    CHECK(parent[0].tape->truncated);
    const auto nested = read_all(*own);
    REQUIRE(commands_of(nested) == std::vector<std::string>{"session-open"});
    REQUIRE(nested[0].tape.has_value());
    CHECK(nested[0].tape->random == std::vector<double>{0.25 + 0.01 * 1});
    CHECK(random->draws == 1);
}

TEST_CASE("the registry's journal reads the declaration when a middleware re-enters next "
          "during the handler") {
    // An outer middleware keeps its `next`; the handler's first run calls it again, so the
    // registry's journal runs a second time while a handler run is under way.
    std::vector<std::optional<bool>> told;
    const afd::Next* outer_next = nullptr;
    const afd::CommandMiddleware keeps_next = [&outer_next](std::string_view, const afd::Json&,
                                                            afd::CommandContext&,
                                                            const afd::Next& next) {
        outer_next = &next;
        return next();
    };
    afd::CommandRegistry registry({.middleware = {keeps_next, telling_journal(told)}});
    int runs = 0;
    afd::CommandDefinition unlock = vault_unlock();
    unlock.handler = [&](const afd::Json&, afd::CommandContext&) {
        if (++runs == 1) {
            REQUIRE(outer_next != nullptr);
            CHECK((*outer_next)().success);
        }
        return afd::success({{"key", "SECRET-VAULT-KEY"}});
    };
    add(registry, std::move(unlock));
    CHECK(registry.execute("vault-unlock").success);
    CHECK(runs == 2);
    CHECK(told == std::vector<std::optional<bool>>{true, true});
}

TEST_CASE("a middleware that calls next twice has both attempts recorded") {
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    const afd::CommandMiddleware twice = [](std::string_view, const afd::Json&,
                                            afd::CommandContext&, const afd::Next& next) {
        CHECK(next().success);
        return next();
    };
    afd::CommandRegistry registry({.middleware = {twice, afd::create_journal_middleware(sink)},
                                   .clock = afd::fixed_clock(1767225600000),
                                   .random = std::make_shared<CountingRandom>()});
    add(registry, dice_roll());
    CHECK(registry.execute("dice-roll", {{"sides", 6}}).success);
    CHECK(commands_of(read_all(*sink)) == std::vector<std::string>{"dice-roll", "dice-roll"});
}

TEST_CASE("a journal the registry reaches through compose_middleware reads the declaration") {
    std::vector<std::optional<bool>> told;
    const afd::CommandMiddleware pass = [](std::string_view, const afd::Json&, afd::CommandContext&,
                                           const afd::Next& next) { return next(); };
    afd::CommandRegistry registry(
        {.middleware = {afd::compose_middleware({pass, telling_journal(told)})}});
    add(registry, vault_unlock());
    add(registry, dice_roll());
    CHECK(registry.execute("vault-unlock", {{"passphrase", "hunter2"}}).success);
    CHECK(registry.execute("dice-roll", {{"sides", 6}}).success);
    CHECK(told == std::vector<std::optional<bool>>{true, false});
}

TEST_CASE("a secret nested call stays off its recorded parent's tape, and marks that tape") {
    NestedMint mint({}, 2);
    CHECK(mint.registry->execute("session-open").success);
    const auto entries = read_all(*mint.sink);
    REQUIRE(commands_of(entries) == std::vector<std::string>{"session-open"});
    REQUIRE(entries[0].tape.has_value());
    CHECK(entries[0].tape->random.empty());
    CHECK(entries[0].tape->truncated);
    // The registry's timing of the parent's handler only; the nested call's timing is off it.
    CHECK(entries[0].tape->clock.size() == 2);
    CHECK(mint.random->draws == 2);
    CHECK_FALSE(mentions_secret(entries));
}

TEST_CASE("a recorded secret nested call keeps its reads on its own entry, never its parent's") {
    // A redact that keeps every record: the secret call is recorded, its secret left to redact.
    NestedMint mint({.redact = [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
                        return record;
                    }},
                    1);
    CHECK(mint.registry->execute("session-open").success);
    const auto entries = read_all(*mint.sink);
    REQUIRE(commands_of(entries) == std::vector<std::string>{"token-mint", "session-open"});
    REQUIRE(entries[0].tape.has_value());
    CHECK(entries[0].tape->random == std::vector<double>{0.25 + 0.01 * 1});
    CHECK_FALSE(entries[0].tape->truncated);
    REQUIRE(entries[1].tape.has_value());
    CHECK(entries[1].tape->random.empty());
    CHECK(entries[1].tape->truncated);
    CHECK(entries[1].tape->clock.size() == 2);
}

TEST_CASE("an unrecorded secret call marks every recording tape it would have read") {
    // Two journals on one registry: the inner one's sources wrap the outer one's.
    NestedMint mint({}, 1);
    auto inner = std::make_shared<afd::MemoryJournalSink>();
    mint.registry->use(afd::create_journal_middleware(inner));
    CHECK(mint.registry->execute("session-open").success);
    const auto outer_entries = read_all(*mint.sink);
    const auto inner_entries = read_all(*inner);
    REQUIRE(commands_of(outer_entries) == std::vector<std::string>{"session-open"});
    REQUIRE(commands_of(inner_entries) == std::vector<std::string>{"session-open"});
    CHECK(outer_entries[0].tape->truncated);
    CHECK(inner_entries[0].tape->truncated);
    CHECK(outer_entries[0].tape->random.empty());
    CHECK(inner_entries[0].tape->random.empty());
    CHECK(mint.random->draws == 1);
}

TEST_CASE("a kept copy of a finished call's context reads as no call") {
    // A non-secret call's context, kept after it returned, carries that call's record: given to
    // the recorder directly under the same name, it must not read as `secret: false`.
    afd::CommandRegistry registry;
    std::optional<afd::CommandContext> kept;
    add(registry, {.name = "dice-roll",
                   .description = "Roll a die and keep the context",
                   .handler = [&kept](const afd::Json&, afd::CommandContext& context) {
                       kept = context;
                       return afd::success({{"roll", 4}});
                   }});
    CHECK(registry.execute("dice-roll").success);
    REQUIRE(kept.has_value());

    auto sink = std::make_shared<afd::MemoryJournalSink>();
    const auto journal = afd::create_journal_middleware(sink);
    const afd::Next next = [] { return afd::success({{"key", "SECRET-VAULT-KEY"}}); };
    CHECK(journal("dice-roll", afd::Json::object(), *kept, next).success);
    CHECK(read_all(*sink).empty());

    std::vector<std::optional<bool>> told;
    const auto telling = afd::create_journal_middleware(
        std::make_shared<afd::MemoryJournalSink>(),
        {.redact = [&told](afd::JournalRecord record, const afd::JournalRedactInfo& info)
             -> std::optional<afd::JournalRecord> {
            told.push_back(info.secret);
            return record;
        }});
    CHECK(telling("dice-roll", afd::Json::object(), *kept, next).success);
    CHECK(told == std::vector<std::optional<bool>>{std::nullopt});
}

TEST_CASE("a secret call given a fresh context with its parent's sources stays off the tape") {
    NestedMint mint({}, 2, true);
    CHECK(mint.registry->execute("session-open").success);
    const auto entries = read_all(*mint.sink);
    REQUIRE(commands_of(entries) == std::vector<std::string>{"session-open"});
    REQUIRE(entries[0].tape.has_value());
    CHECK(entries[0].tape->random.empty());
    CHECK(entries[0].tape->truncated);
    CHECK(entries[0].tape->clock.size() == 2);
    CHECK(mint.random->draws == 2);
}

TEST_CASE("a secret call that filter skips is not recorded, even with redact, and stays off "
          "its parent's tape") {
    std::vector<std::string> redacted;
    const auto options = [&redacted]() {
        return afd::JournalMiddlewareOptions{
            .filter = [](std::string_view name) { return name != "token-mint"; },
            .redact = [&redacted](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
                redacted.push_back(record.command);
                return record;
            }};
    };
    NestedMint mint(options(), 1);
    CHECK(mint.registry->execute("token-mint").success);
    CHECK(read_all(*mint.sink).empty());
    CHECK(mint.registry->execute("session-open").success);
    const auto entries = read_all(*mint.sink);
    REQUIRE(commands_of(entries) == std::vector<std::string>{"session-open"});
    CHECK(redacted == std::vector<std::string>{"session-open"});
    REQUIRE(entries[0].tape.has_value());
    CHECK(entries[0].tape->random.empty());
    CHECK(entries[0].tape->truncated);
}

TEST_CASE("a secret pipeline step is not recorded without redact") {
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(
                                       sink, {.filter = [](std::string_view) { return true; }})}});
    add(registry, vault_unlock());
    add(registry, dice_roll());
    const afd::PipelineResult pipeline = registry.execute_pipeline(afd::Json::parse(R"({"steps": [
        {"command": "dice-roll", "input": {"sides": 6}},
        {"command": "vault-unlock", "input": {"passphrase": "hunter2"}}]})"));
    REQUIRE(pipeline.steps.size() == 2);
    const auto entries = read_all(*sink);
    CHECK(commands_of(entries) == std::vector<std::string>{"dice-roll"});
    CHECK_FALSE(mentions_secret(entries));
}

TEST_CASE("redact compares with nullptr") {
    afd::JournalMiddlewareOptions options;
    CHECK(options.redact == nullptr);
    CHECK_FALSE(options.redact != nullptr);
    options.redact = [](afd::JournalRecord record) -> std::optional<afd::JournalRecord> {
        return record;
    };
    CHECK(options.redact != nullptr);
    CHECK(static_cast<bool>(options.redact));
}
