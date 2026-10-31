// Declared context fields (spec/context-fields.md): declaration checks, validation on every
// in-process call, and what the journal keeps (spec/journal.md, "Declared context fields").
// Mirrors packages/server/src/context-fields.test.ts.
#include "afd/afd.hpp"

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

afd::Json project_schema() {
    return {{"type", "object"},
            {"properties", {{"project", {{"type", "string"}}}}},
            {"required", afd::Json::array({"project"})}};
}

afd::ContextField scope_field() {
    return {
        .name = "scope", .meta = "dev.example/scope", .schema = project_schema(), .journal = true};
}

afd::ContextField locale_field() {
    return {.name = "locale", .meta = "dev.example/locale", .schema = {{"type", "string"}}};
}

/// Returns the declared fields the call sees.
afd::CommandDefinition scope_echo() {
    return {.name = "scope-echo",
            .description = "Return the declared fields the call sees",
            .handler = [](const afd::Json&, afd::CommandContext& context) {
                afd::Json seen = afd::Json::object();
                for (const char* name : {"scope", "locale"}) {
                    const auto found = context.extra.find(name);
                    if (found != context.extra.end()) {
                        seen[name] = *found;
                    }
                }
                return afd::success(seen);
            }};
}

std::shared_ptr<afd::CommandRegistry> registry_with(std::vector<afd::ContextField> fields,
                                                    afd::CommandRegistryOptions options = {}) {
    options.context_fields = std::move(fields);
    auto created = afd::CommandRegistry::create(std::move(options));
    REQUIRE_MESSAGE(created.has_value(), created.error());
    const auto error = (*created)->register_command(scope_echo());
    REQUIRE_MESSAGE(!error, error.value_or(""));
    return *created;
}

/// The declaration error for `fields`, or "" when they are accepted.
std::string declaration_error(std::vector<afd::ContextField> fields) {
    auto created = afd::CommandRegistry::create({.context_fields = std::move(fields)});
    return created ? std::string() : created.error();
}

afd::CommandContext context_with(afd::Json extra) {
    afd::CommandContext context;
    context.extra = std::move(extra);
    return context;
}

} // namespace

// --- declarations -------------------------------------------------------------------------

TEST_CASE("context field declarations: refused, naming the field") {
    struct Case {
        afd::ContextField field;
        const char* message;
    };
    const auto with_name = [](std::string name) {
        afd::ContextField field = scope_field();
        field.name = std::move(name);
        return field;
    };
    const auto with_meta = [](std::string meta) {
        afd::ContextField field = scope_field();
        field.meta = std::move(meta);
        return field;
    };
    afd::ContextField no_schema = scope_field();
    no_schema.schema = nullptr;
    afd::ContextField bad_schema = scope_field();
    bad_schema.schema = {{"type", "string"}, {"pattern", "^p-"}};
    const std::vector<Case> cases = {
        {with_name(""), "A context field needs a non-empty name"},
        {with_name("actor"), "Context field 'actor' uses a name AFD sets itself"},
        {with_name("traceId"), "Context field 'traceId' uses a name AFD sets itself"},
        {with_name("trace_id"), "Context field 'trace_id' uses a name AFD sets itself"},
        {with_name("active_context"), "Context field 'active_context' uses a name AFD sets itself"},
        {with_name("journaled_fields"), "uses a name AFD sets itself"},
        {with_name("source"), "uses a name AFD sets itself"},
        {with_meta("scope"), "Context field 'scope' needs a meta key with a reverse-DNS prefix, "
                             "such as 'dev.example/scope'"},
        {with_meta("example/scope"), "reverse-DNS prefix"},
        {with_meta("dev.example/"), "reverse-DNS prefix"},
        {with_meta("dev.example/scope/x"), "reverse-DNS prefix"},
        {with_meta("dev.example/-scope"), "reverse-DNS prefix"},
        {with_meta("dev.example/scope."), "reverse-DNS prefix"},
        {with_meta("1dev.example/scope"), "reverse-DNS prefix"},
        {with_meta("dev-.example/scope"), "reverse-DNS prefix"},
        {with_meta("dev..example/scope"), "reverse-DNS prefix"},
        {with_meta(".dev.example/scope"), "reverse-DNS prefix"},
        {with_meta("dév.example/scope"), "reverse-DNS prefix"},
        {with_meta("dev.afd/scope"), "Context field 'scope' uses the reserved meta prefix of "
                                     "'dev.afd/scope'; use your own domain"},
        {with_meta("DEV.Afd/scope"), "reserved meta prefix"},
        {with_meta("io.modelcontextprotocol/scope"), "reserved meta prefix"},
        {with_meta("dev.mcp.tools/scope"), "reserved meta prefix"},
        {with_meta("dev.MCP/scope"), "reserved meta prefix"},
        {no_schema, "Context field 'scope' needs a JSON Schema"},
        {bad_schema, "Context field 'scope' has an unsupported schema"},
    };
    for (const auto& item : cases) {
        CAPTURE(item.field.name);
        CAPTURE(item.field.meta);
        const std::string error = declaration_error({item.field});
        CHECK_MESSAGE(error.find(item.message) != std::string::npos, error);
    }
}

TEST_CASE("context field declarations: a name or meta key declared twice") {
    afd::ContextField same_name = locale_field();
    same_name.name = "scope";
    CHECK(declaration_error({scope_field(), same_name}) ==
          "Context field 'scope' is declared twice");
    afd::ContextField same_meta = locale_field();
    same_meta.meta = "dev.example/scope";
    CHECK(declaration_error({scope_field(), same_meta}) ==
          "Meta key 'dev.example/scope' of context field 'locale' is declared twice");
}

TEST_CASE("context field declarations: accepted shapes") {
    for (const char* meta : {"dev.example/scope", "com.my-co.app/x_y.z-1", "a.b/c",
                             "Dev.Example/S1", "dev.afd.example/scope", "dev.mcpx/scope"}) {
        CAPTURE(meta);
        afd::ContextField field = scope_field();
        field.meta = meta;
        CHECK(declaration_error({field}).empty());
    }
    CHECK(declaration_error({scope_field(), locale_field()}).empty());
    CHECK(declaration_error({}).empty());
    afd::ContextField any = locale_field();
    any.schema = true;
    CHECK(declaration_error({any}).empty());
}

TEST_CASE("a registry constructed with an invalid declaration runs no call") {
    afd::ContextField bad = scope_field();
    bad.name = "clock";
    afd::CommandRegistry registry({.context_fields = {bad}});
    REQUIRE_FALSE(registry.register_command(scope_echo()).has_value());
    const afd::CommandResult result = registry.execute("scope-echo");
    REQUIRE_FALSE(result.success);
    CHECK(result.error->code == "INTERNAL_ERROR");
    CHECK(result.error->message.find("Context field 'clock' uses a name AFD sets itself") !=
          std::string::npos);
    CHECK(result.error->suggestion->find("CommandRegistry::create") != std::string::npos);
    CHECK(registry.context_fields().size() == 1);
}

// --- values in process --------------------------------------------------------------------

TEST_CASE("context field values reach the handler as their schema outputs them") {
    const auto registry = registry_with({scope_field(), locale_field()});
    const afd::CommandResult result = registry->execute(
        "scope-echo", afd::Json::object(),
        context_with({{"scope", {{"project", "p-1"}, {"undeclared", true}}}, {"locale", "en-GB"}}));
    REQUIRE(result.success);
    // The schema's output: undeclared members are removed, as Zod's object strips them.
    CHECK(result.data == afd::Json{{"scope", {{"project", "p-1"}}}, {"locale", "en-GB"}});
    CHECK(registry->context_fields().size() == 2);
}

TEST_CASE("an invalid context field value fails with VALIDATION_ERROR naming the field") {
    const auto registry = registry_with({scope_field(), locale_field()});
    const afd::CommandResult result = registry->execute(
        "scope-echo", afd::Json::object(), context_with({{"scope", {{"project", 42}}}}));
    REQUIRE_FALSE(result.success);
    const afd::CommandError& error = *result.error;
    CHECK(error.code == "VALIDATION_ERROR");
    CHECK(error.message == "Context field 'scope' is not valid");
    REQUIRE(error.details.has_value());
    CHECK((*error.details)["field"] == "scope");
    CHECK((*error.details)["meta"] == "dev.example/scope");
    REQUIRE((*error.details)["errors"].size() == 1);
    CHECK((*error.details)["errors"][0]["path"] == "project");
    CHECK((*error.details)["errors"][0]["message"].is_string());
    REQUIRE(error.suggestion.has_value());
    CHECK(error.suggestion->find("_meta[\"dev.example/scope\"]") != std::string::npos);
    CHECK(error.suggestion->find("or leave it out") != std::string::npos);

    // A value that is not an object at all fails at the root, whose path is empty.
    const afd::CommandResult root =
        registry->execute("scope-echo", afd::Json::object(), context_with({{"locale", 7}}));
    REQUIRE_FALSE(root.success);
    CHECK(root.error->message == "Context field 'locale' is not valid");
    CHECK((*root.error->details)["errors"][0]["path"] == "");
}

TEST_CASE("a call without a required context field fails") {
    afd::ContextField required = scope_field();
    required.required = true;
    const auto registry = registry_with({required});
    const afd::CommandResult result = registry->execute("scope-echo");
    REQUIRE_FALSE(result.success);
    CHECK(result.error->code == "VALIDATION_ERROR");
    CHECK(result.error->message == "Context field 'scope' is required");
    CHECK(*result.error->details ==
          afd::Json{{"field", "scope"},
                    {"meta", "dev.example/scope"},
                    {"errors", afd::Json::array({{{"path", ""}, {"message", "Required"}}})}});
    CHECK(result.error->suggestion->find("it is required") != std::string::npos);

    CHECK(registry
              ->execute("scope-echo", afd::Json::object(),
                        context_with({{"scope", {{"project", "p-1"}}}}))
              .success);
}

TEST_CASE("a JSON null context field value counts as no value") {
    afd::ContextField required = scope_field();
    required.required = true;
    const auto strict = registry_with({required});
    const afd::CommandResult missing =
        strict->execute("scope-echo", afd::Json::object(), context_with({{"scope", nullptr}}));
    REQUIRE_FALSE(missing.success);
    CHECK(missing.error->message == "Context field 'scope' is required");

    // Not validated (the object schema would refuse null): the handler sees it as sent.
    const auto optional = registry_with({scope_field(), locale_field()});
    const afd::CommandResult skipped = optional->execute(
        "scope-echo", afd::Json::object(), context_with({{"scope", nullptr}, {"locale", nullptr}}));
    REQUIRE(skipped.success);
    CHECK(skipped.data == afd::Json{{"scope", nullptr}, {"locale", nullptr}});
}

TEST_CASE("required context fields are not enforced for AFD's own commands") {
    afd::ContextField required = scope_field();
    required.required = true;
    const auto registry = registry_with({required});
    afd::CommandDefinition help = scope_echo();
    help.name = "afd-help";
    REQUIRE_FALSE(registry->register_command(help).has_value());

    // A client can discover the fields before it has values for them.
    CHECK(registry->execute("afd-help").success);
    CHECK(registry->execute("afd-help", afd::Json::object(), context_with({{"scope", nullptr}}))
              .success);
    // A value that is present is still validated.
    const afd::CommandResult invalid =
        registry->execute("afd-help", afd::Json::object(), context_with({{"scope", "p-1"}}));
    REQUIRE_FALSE(invalid.success);
    CHECK(invalid.error->message == "Context field 'scope' is not valid");
    const afd::CommandResult valid = registry->execute(
        "afd-help", afd::Json::object(), context_with({{"scope", {{"project", "p-1"}}}}));
    REQUIRE(valid.success);
    CHECK(valid.data == afd::Json{{"scope", {{"project", "p-1"}}}});
    // Other commands still require it.
    CHECK(registry->execute("scope-echo").error->message == "Context field 'scope' is required");
}

TEST_CASE("context fields are validated after the input and before middleware") {
    int reached = 0;
    const auto registry = registry_with(
        {scope_field()}, {.middleware = {[&reached](std::string_view, const afd::Json&,
                                                    afd::CommandContext&, const afd::Next& next) {
                              ++reached;
                              return next();
                          }}});
    REQUIRE_FALSE(registry
                      ->register_command(
                          {.name = "scope-strict",
                           .description = "Takes a title",
                           .input_schema = {{"type", "object"},
                                            {"properties", {{"title", {{"type", "string"}}}}},
                                            {"required", {"title"}}},
                           .handler = [](const afd::Json&,
                                         afd::CommandContext&) { return afd::success(nullptr); }})
                      .has_value());
    const afd::Json bad_scope = {{"scope", "p-1"}};
    // The input is checked first.
    const afd::CommandResult input_first =
        registry->execute("scope-strict", afd::Json::object(), context_with(bad_scope));
    CHECK(input_first.error->message == "Input validation failed");
    const afd::CommandResult field_second =
        registry->execute("scope-strict", {{"title", "x"}}, context_with(bad_scope));
    CHECK(field_second.error->message == "Context field 'scope' is not valid");
    CHECK(reached == 0);
    CHECK(registry->execute("scope-strict", {{"title", "x"}}).success);
    CHECK(reached == 1);
}

TEST_CASE("a batch's context field values apply to every command") {
    const auto registry = registry_with({scope_field()});
    const afd::BatchResult batch = registry->execute_batch(
        afd::Json{{"commands",
                   {{{"command", "scope-echo"}, {"input", afd::Json::object()}},
                    {{"command", "scope-echo"}, {"input", afd::Json::object()}}}}},
        context_with({{"scope", {{"project", "p-2"}}}}));
    REQUIRE(batch.results.size() == 2);
    for (const auto& item : batch.results) {
        REQUIRE(item.result.success);
        CHECK(item.result.data == afd::Json{{"scope", {{"project", "p-2"}}}});
    }
    const afd::BatchResult invalid = registry->execute_batch(
        afd::Json{{"commands", {{{"command", "scope-echo"}, {"input", afd::Json::object()}}}}},
        context_with({{"scope", 1}}));
    REQUIRE(invalid.results.size() == 1);
    CHECK(invalid.results[0].result.error->code == "VALIDATION_ERROR");
}

// --- the journal --------------------------------------------------------------------------

namespace {

struct FieldJournal {
    std::shared_ptr<afd::MemoryJournalSink> sink = std::make_shared<afd::MemoryJournalSink>();
    std::shared_ptr<afd::CommandRegistry> registry;

    FieldJournal()
        : registry(registry_with({scope_field(), locale_field()},
                                 {.middleware = {afd::create_journal_middleware(sink)},
                                  .clock = afd::fixed_clock(0),
                                  .random = std::make_shared<afd::SeededRandom>("fields")})) {}

    afd::JournalEntry record(afd::Json extra) {
        afd::CommandContext context = context_with(std::move(extra));
        context.trace_id = "t";
        REQUIRE(registry->execute("scope-echo", afd::Json::object(), context).success);
        auto entries = sink->read();
        REQUIRE(entries.has_value());
        REQUIRE_FALSE(entries->empty());
        return entries->back();
    }
};

/// The context the journal middleware saw: the registry's clock and random source filled in.
afd::CommandContext recorded_context(afd::Json extra) {
    afd::CommandContext context = context_with(std::move(extra));
    context.trace_id = "t";
    context.clock = afd::fixed_clock(0);
    context.random = std::make_shared<afd::SeededRandom>("fields");
    return context;
}

} // namespace

TEST_CASE("the journal keeps journaled values in context and the others as key names") {
    FieldJournal journal;
    const afd::JournalEntry entry =
        journal.record({{"scope", {{"project", "p-1"}}}, {"locale", "en"}});
    REQUIRE(entry.context.has_value());
    CHECK(*entry.context == afd::Json{{"scope", {{"project", "p-1"}}}});
    CHECK_FALSE(entry.context_omitted.has_value());
    // The hash covers `context`, and `scope` leaves the key list: clock, locale and random stay.
    const afd::CommandContext seen =
        recorded_context({{"scope", {{"project", "p-1"}}}, {"locale", "en"}});
    CHECK(entry.context_digest.hash ==
          afd::create_context_digest(seen, afd::Json{{"scope", {{"project", "p-1"}}}}).hash);
    CHECK(entry.context_digest.hash != afd::create_context_digest(seen).hash);
    // A differing value changes the hash.
    CHECK(entry.context_digest.hash !=
          afd::create_context_digest(seen, afd::Json{{"scope", {{"project", "p-2"}}}}).hash);
}

TEST_CASE("the journal hashes an entry without journaled values exactly as before") {
    FieldJournal journal;
    const afd::JournalEntry entry = journal.record({{"locale", "en"}});
    CHECK_FALSE(entry.context.has_value());
    CHECK_FALSE(entry.context_omitted.has_value());
    const afd::JournalContextDigest expected =
        afd::create_context_digest(recorded_context({{"locale", "en"}}));
    CHECK(entry.context_digest.hash == expected.hash);
    CHECK(entry.context_digest.surface == expected.surface);
}

TEST_CASE("the journal names a value over 4096 bytes in contextOmitted instead") {
    FieldJournal journal;
    // `{"project":"..."}` is 14 bytes around the string; "é" is two bytes of UTF-8, so 2,100 of
    // them are 4,200 bytes though only 2,100 characters.
    std::string accents;
    for (int i = 0; i < 2100; ++i) {
        accents += "\xC3\xA9";
    }
    const afd::JournalEntry wide = journal.record({{"scope", {{"project", accents}}}});
    CHECK_FALSE(wide.context.has_value());
    CHECK(wide.context_omitted == std::vector<std::string>{"scope"});
    CHECK(wide.context_digest.hash ==
          afd::create_context_digest(recorded_context({{"scope", nullptr}}), std::nullopt,
                                     std::vector<std::string>{"scope"})
              .hash);

    const afd::JournalEntry at_cap =
        journal.record({{"scope", {{"project", std::string(4096 - 14, 'x')}}}});
    REQUIRE(at_cap.context.has_value());
    CHECK((*at_cap.context)["scope"]["project"].get<std::string>().size() == 4096 - 14);
    const afd::JournalEntry over_cap =
        journal.record({{"scope", {{"project", std::string(4096 - 13, 'x')}}}});
    CHECK_FALSE(over_cap.context.has_value());
    CHECK(over_cap.context_omitted == std::vector<std::string>{"scope"});
}

TEST_CASE("the journal keeps nothing for a JSON null journaled value") {
    FieldJournal journal;
    const afd::JournalEntry entry = journal.record({{"scope", nullptr}, {"locale", "en"}});
    CHECK_FALSE(entry.context.has_value());
    CHECK_FALSE(entry.context_omitted.has_value());
    // Hashed as an entry without journaled values: `scope` is only a key name.
    CHECK(
        entry.context_digest.hash ==
        afd::create_context_digest(recorded_context({{"scope", nullptr}, {"locale", "en"}})).hash);
}

TEST_CASE("an entry's context and contextOmitted round-trip, after contextDigest") {
    FieldJournal journal;
    (void)journal.record({{"scope", {{"project", "p-1"}}}});
    (void)journal.record({{"scope", {{"project", std::string(5000, 'x')}}}});
    const auto entries = *journal.sink->read();
    const std::string text = afd::serialize_journal(entries);
    auto parsed = afd::parse_journal(text);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
    REQUIRE(parsed->size() == 2);
    CHECK((*parsed)[0].context == entries[0].context);
    CHECK((*parsed)[1].context_omitted == entries[1].context_omitted);
    CHECK(afd::serialize_journal(*parsed) == text);
    const std::string first = afd::serialize_journal_entry(entries[0]);
    CHECK(first.find("\"contextDigest\":") < first.find("\"context\":{\"scope\""));
    CHECK(first.find("\"context\":{\"scope\"") < first.find("\"result\":"));
    const std::string second = afd::serialize_journal_entry(entries[1]);
    CHECK(second.find("},\"contextOmitted\":[\"scope\"],\"result\":") != std::string::npos);
}

TEST_CASE("an entry's context must be an object and contextOmitted an array of strings") {
    afd::Json entry = {{"seq", 1},
                       {"timestamp", "2026-01-01T00:00:00.000Z"},
                       {"command", "todo-list"},
                       {"input", afd::Json::object()},
                       {"contextDigest", {{"hash", "sha256:00"}}},
                       {"result", {{"success", true}}},
                       {"durationMs", 0}};
    CHECK(afd::is_journal_entry(entry));
    for (const afd::Json& bad : {afd::Json(nullptr), afd::Json::array(), afd::Json("scope")}) {
        afd::Json with = entry;
        with["context"] = bad;
        CHECK_FALSE(afd::is_journal_entry(with));
    }
    for (const afd::Json& bad :
         {afd::Json(nullptr), afd::Json("scope"), afd::Json::array({1}), afd::Json::object()}) {
        afd::Json with = entry;
        with["contextOmitted"] = bad;
        CHECK_FALSE(afd::is_journal_entry(with));
    }
    entry["context"] = {{"scope", {{"project", "p-1"}}}};
    entry["contextOmitted"] = afd::Json::array({"space"});
    auto parsed = afd::JournalEntry::from_json(entry);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
    CHECK(parsed->context == entry["context"]);
    CHECK(parsed->context_omitted == std::vector<std::string>{"space"});
}

TEST_CASE("create_context_digest: recorded names leave keys, and the hash covers them") {
    afd::CommandContext context = context_with({{"scope", {{"project", "p-1"}}}, {"locale", "en"}});
    context.trace_id = "t";
    const afd::Json journaled = {{"scope", {{"project", "p-1"}}}};
    // The SHA-256 of the canonical JSON the spec hashes, computed independently:
    // {"actor":null,"context":{"scope":{"project":"p-1"}},"interface":null,"keys":["locale"],
    //  "traceId":"t"}
    CHECK(afd::create_context_digest(context, journaled).hash ==
          "sha256:cc149e4d159f66817f48904c9a3e6e97ab67eeab3f19f07362d8e3da3d626176");
    // {"actor":null,"contextOmitted":["scope"],"interface":null,"keys":["locale"],"traceId":"t"}
    CHECK(
        afd::create_context_digest(context, std::nullopt, std::vector<std::string>{"scope"}).hash ==
        "sha256:a58d12a41a61283f54e25a3c13820c9f657044302861fef6f7e94e25a0caf255");
    // Without either, as before: {"actor":null,"interface":null,"keys":["locale","scope"],
    // "traceId":"t"}
    CHECK(afd::create_context_digest(context).hash ==
          "sha256:98192653c6dd62e5787c643880e858675fa72aee17fb7994962c481a1ddf25c5");
    // The marker the registry sets never enters the digest.
    FieldJournal journal;
    const afd::JournalEntry entry = journal.record({{"locale", "en"}});
    CHECK(entry.context_digest.hash ==
          afd::create_context_digest(recorded_context({{"locale", "en"}})).hash);
}

TEST_CASE("replay restores journaled values, and notes a field the target no longer declares") {
    FieldJournal journal;
    const afd::JournalEntry entry = journal.record({{"scope", {{"project", "p-1"}}}});

    // A registry that declares no fields: the value is dropped, with a note.
    afd::CommandRegistry bare;
    REQUIRE_FALSE(bare.register_command(scope_echo()).has_value());
    const afd::ReplayReport dropped = afd::replay_journal(bare, {entry});
    REQUIRE(dropped.entries.size() == 1);
    CHECK(dropped.entries[0].status == afd::ReplayStatus::different);
    CHECK(dropped.entries[0].notes ==
          std::vector<std::string>{
              "context field 'scope' is no longer declared; replayed without it"});

    // The same declarations: restored and validated again, so the result is the same.
    const auto declared = registry_with({scope_field(), locale_field()});
    const afd::ReplayReport restored = afd::replay_journal(*declared, {entry});
    REQUIRE(restored.entries.size() == 1);
    CHECK(restored.entries[0].status == afd::ReplayStatus::same);
    CHECK(restored.entries[0].notes.empty());

    // Through a bare executor, every recorded value is restored unless the option says otherwise.
    const afd::CommandExecutor execute = [&bare](std::string_view name, const afd::Json& input,
                                                 afd::CommandContext& context) {
        return bare.execute(name, input, context);
    };
    CHECK(afd::replay_journal(execute, {entry}).entries[0].status == afd::ReplayStatus::same);
    const afd::ReplayReport limited =
        afd::replay_journal(execute, {entry}, {.context_fields = std::vector<std::string>{}});
    CHECK(limited.entries[0].status == afd::ReplayStatus::different);
    CHECK(limited.entries[0].notes.size() == 1);
}

TEST_CASE("replay validates a restored value again") {
    afd::JournalEntry entry;
    entry.seq = 1;
    entry.timestamp = "2026-01-01T00:00:00.000Z";
    entry.command = "scope-echo";
    entry.context = afd::Json{{"scope", {{"project", 7}}}};
    entry.context_omitted = std::vector<std::string>{"locale"};
    entry.result = afd::success({{"scope", {{"project", 7}}}});
    const auto registry = registry_with({scope_field(), locale_field()});
    const afd::ReplayReport report = afd::replay_journal(*registry, {entry});
    REQUIRE(report.entries.size() == 1);
    CHECK(report.entries[0].status == afd::ReplayStatus::different);
    REQUIRE(report.entries[0].replayed.has_value());
    CHECK(report.entries[0].replayed->error->message == "Context field 'scope' is not valid");
    CHECK(report.entries[0].notes ==
          std::vector<std::string>{
              "context field 'locale' was too large to journal; replayed without it"});
}
