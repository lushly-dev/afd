// The language-neutral vectors in spec/vectors/journal-seams.json: the dispatch id
// (spec/dispatch.md, "The dispatch id") and the approval summary (spec/command-metadata.md, "The
// approval summary"). Every case runs but one: C++ has no `HumanRelay`, so the relay-evidence case
// is skipped by name. The elicitation cases run over the `afd::mcp_stdio` server, and are skipped,
// saying so, in a build without it. A language listed in the file's `gaps` would skip every case;
// C++ is not listed.
#include "afd/afd.hpp"
#if AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/sha256.hpp"
#include <doctest.h>

// Named, so a unity build does not merge these helpers with another test file's.
namespace journal_seams {

using afd::Json;

Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

/// The format's pattern, checked by hand: 21 base64url characters, then one of `AQgw`.
bool well_formed(const std::string& id) {
    if (id.size() != 22) {
        return false;
    }
    const auto base64url = [](char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
               c == '-' || c == '_';
    };
    return std::all_of(id.begin(), id.end() - 1, base64url) &&
           std::string_view("AQgw").find(id.back()) != std::string_view::npos;
}

/// Whether `value` has a member named for the dispatch id, or holds one of `ids`, at any depth.
bool holds_id(const Json& value, const std::set<std::string>& ids) {
    if (value.is_string()) {
        return ids.count(value.get<std::string>()) > 0;
    }
    if (value.is_array()) {
        return std::any_of(value.begin(), value.end(),
                           [&](const Json& item) { return holds_id(item, ids); });
    }
    if (value.is_object()) {
        for (auto it = value.begin(); it != value.end(); ++it) {
            if (it.key() == "dispatchId" || it.key() == "dispatch_id" || ids.count(it.key()) > 0 ||
                holds_id(it.value(), ids)) {
                return true;
            }
        }
    }
    return false;
}

std::vector<std::string> strings(const Json& list) {
    std::vector<std::string> out;
    for (const auto& item : list) {
        out.push_back(item.get<std::string>());
    }
    return out;
}

// --- dispatchId ---------------------------------------------------------------------------------

/// What the readers noted: each reader's dispatch id, the handler runs and the handler's draws.
struct Notes {
    std::mutex mutex;
    std::vector<std::pair<std::string, std::string>> ids;
    int handler_runs = 0;
    int flaky_runs = 0;
    std::vector<double> draws;

    void note(const std::string& reader, const afd::CommandContext& context) {
        const std::lock_guard lock(mutex);
        ids.emplace_back(reader, context.dispatch_id.value());
        if (reader == "handler") {
            ++handler_runs;
        }
    }
};

/// A random source that returns the case's values in order.
class ScriptedRandom final : public afd::RandomSource {
public:
    explicit ScriptedRandom(std::vector<double> values) : values_(std::move(values)) {}
    double next() override { return index_ < values_.size() ? values_[index_++] : 0.5; }

private:
    std::vector<double> values_;
    std::size_t index_ = 0;
};

afd::CommandMiddleware observer(std::shared_ptr<Notes> notes, std::string reader) {
    return [notes = std::move(notes), reader = std::move(reader)](
               std::string_view, const Json&, afd::CommandContext& context, const afd::Next& next) {
        notes->note(reader, context);
        return next();
    };
}

/// The outer layer: an observer, or the case's `overwrite` or `retry-once`.
afd::CommandMiddleware outer_layer(const std::shared_ptr<Notes>& notes, const Json& run) {
    const std::string kind = run.value("middleware", "");
    if (kind == "overwrite") {
        // A C++ middleware cannot set the id: there is no setter, and assigning one leaves it as
        // it was. The nearest it can come is the value in `extra` under the id's name, which no
        // reader takes for the id.
        return
            [](std::string_view, const Json&, afd::CommandContext& context, const afd::Next& next) {
                context.dispatch_id = afd::DispatchId{};
                context.extra["dispatch_id"] = "overwritten-by-mw1-0000";
                context.extra["dispatchId"] = "overwritten-by-mw1-0000";
                return next();
            };
    }
    if (kind == "retry-once") {
        return [notes](std::string_view, const Json&, afd::CommandContext& context,
                       const afd::Next& next) {
            notes->note("mw1", context);
            afd::CommandResult result = next();
            if (!result.success) {
                result = next();
            }
            return result;
        };
    }
    return observer(notes, "mw1");
}

/// A registry with the setup's commands and middleware, and the journal when the case asks.
struct DispatchHarness {
    std::shared_ptr<Notes> notes = std::make_shared<Notes>();
    std::shared_ptr<afd::MemoryJournalSink> journal;
    std::shared_ptr<afd::CommandRegistry> registry;

    explicit DispatchHarness(const Json& run) {
        std::vector<afd::CommandMiddleware> middleware{outer_layer(notes, run),
                                                       observer(notes, "mw2")};
        if (run.value("journal", false)) {
            journal = std::make_shared<afd::MemoryJournalSink>();
            middleware.push_back(afd::create_journal_middleware(journal));
        }
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = std::move(middleware)});
        auto seen = notes;
        const std::weak_ptr<afd::CommandRegistry> self = registry;
        REQUIRE_FALSE(registry->register_command(
            {.name = "item-echo",
             .description = "Returns its input as data",
             .handler = [seen](const Json& input, afd::CommandContext& context) {
                 seen->note("handler", context);
                 return afd::success(input);
             }}));
        REQUIRE_FALSE(registry->register_command(
            {.name = "item-flaky",
             .description = "Fails the first time it runs",
             .handler = [seen](const Json& input, afd::CommandContext& context) {
                 seen->note("handler", context);
                 int runs = 0;
                 {
                     const std::lock_guard lock(seen->mutex);
                     runs = ++seen->flaky_runs;
                 }
                 if (runs == 1) {
                     return afd::error("TRANSIENT_ERROR", "Failed once",
                                       {.suggestion = "Retry", .retryable = true});
                 }
                 return afd::success(input);
             }}));
        REQUIRE_FALSE(registry->register_command(
            {.name = "item-outer",
             .description = "Runs item-echo through the registry",
             .handler = [seen, self](const Json&, afd::CommandContext& context) {
                 seen->note("handler", context);
                 const auto inner = self.lock()->execute("item-echo", Json::object(), context);
                 return inner.success ? afd::success(Json::object()) : inner;
             }}));
        REQUIRE_FALSE(registry->register_command(
            {.name = "item-draw",
             .description = "Reads one random value",
             .handler = [seen](const Json&, afd::CommandContext& context) {
                 seen->note("handler", context);
                 const double value = context.random->next();
                 {
                     const std::lock_guard lock(seen->mutex);
                     seen->draws.push_back(value);
                 }
                 return afd::success(value);
             }}));
    }
};

/// The context a case's call starts from: its trace id, its `context` values (in `extra`, the
/// only place a C++ caller can put a value under the id's name) and its random values.
afd::CommandContext case_context(const Json& run) {
    afd::CommandContext context;
    if (run.contains("traceId")) {
        context.trace_id = run.at("traceId").get<std::string>();
    }
    if (run.contains("context")) {
        for (auto it = run.at("context").begin(); it != run.at("context").end(); ++it) {
            context.extra[it.key() == "dispatchId" ? "dispatch_id" : it.key()] = it.value();
        }
    }
    if (run.contains("random")) {
        std::vector<double> values;
        for (const auto& value : run.at("random")) {
            values.push_back(value.get<double>());
        }
        context.random = std::make_shared<ScriptedRandom>(std::move(values));
    }
    return context;
}

/// The hash spec/journal.md gives the setup's call, with the id's name left out of `keys`: the
/// registry fills `clock` and `random`, and the call has no actor, surface or trace id.
std::string expected_digest_hash() {
    const Json hashed{{"actor", nullptr},
                      {"interface", nullptr},
                      {"keys", Json::array({"clock", "random"})},
                      {"traceId", nullptr}};
    return "sha256:" + afd::detail::sha256_hex(afd::wire::serialize(hashed));
}

void run_dispatch_case(const Json& item) {
    const Json& run = item.at("run");
    const Json& expect = item.at("expect");
    DispatchHarness harness(run);
    const std::string kind = run.at("kind").get<std::string>();
    std::vector<Json> results;
    if (kind == "call" || kind == "calls") {
        const int count = run.value("count", 1);
        for (int i = 0; i < count; ++i) {
            results.push_back(Json(harness.registry->execute(run.at("command").get<std::string>(),
                                                             run.at("input"), case_context(run))));
        }
    } else if (kind == "batch") {
        (void)harness.registry->execute_batch(Json{{"commands", run.at("commands")}},
                                              case_context(run));
    } else if (kind == "pipeline") {
        (void)harness.registry->execute_pipeline(Json{{"steps", run.at("steps")}},
                                                 case_context(run));
    } else {
        FAIL("unknown run kind " << kind);
    }

    std::vector<std::pair<std::string, std::string>> noted;
    {
        const std::lock_guard lock(harness.notes->mutex);
        noted = harness.notes->ids;
    }
    std::set<std::string> all_ids;
    for (const auto& [reader, id] : noted) {
        all_ids.insert(id);
    }
    std::set<std::string> ids;
    std::optional<std::vector<std::string>> readers;
    if (expect.contains("readers")) {
        readers = strings(expect.at("readers"));
    }
    for (const auto& [reader, id] : noted) {
        if (!readers || std::find(readers->begin(), readers->end(), reader) != readers->end()) {
            ids.insert(id);
        }
    }
    if (readers) {
        for (const auto& reader : *readers) {
            CHECK_MESSAGE(std::any_of(noted.begin(), noted.end(),
                                      [&](const auto& entry) { return entry.first == reader; }),
                          reader << " read no id");
        }
    }

    if (expect.contains("handlerRuns")) {
        CHECK(harness.notes->handler_runs == expect.at("handlerRuns").get<int>());
    }
    if (expect.contains("distinctIds")) {
        CHECK(ids.size() == expect.at("distinctIds").get<std::size_t>());
    }
    if (expect.value("wellFormed", false)) {
        for (const auto& id : ids) {
            CHECK_MESSAGE(well_formed(id), id << " is not well formed");
        }
    }
    if (expect.contains("never")) {
        for (const auto& never : strings(expect.at("never"))) {
            CHECK_MESSAGE(all_ids.count(never) == 0, "a reader noted " << never);
        }
    }
    if (expect.contains("success")) {
        for (const auto& result : results) {
            CHECK(result.at("success") == expect.at("success"));
        }
    }
    if (expect.contains("data")) {
        REQUIRE_FALSE(results.empty());
        CHECK(results.front().value("data", Json()) == expect.at("data"));
    }
    if (expect.contains("resultHasId") && expect.at("resultHasId") == false) {
        for (const auto& result : results) {
            CHECK_MESSAGE(!holds_id(result, all_ids), "the result carries the id: " << result);
        }
    }
    if (harness.journal) {
        const auto entries = harness.journal->read();
        REQUIRE(entries);
        if (expect.contains("entries")) {
            CHECK(entries->size() == expect.at("entries").get<std::size_t>());
        }
        for (const auto& entry : *entries) {
            const Json value = entry;
            if (expect.contains("entryHasId") && expect.at("entryHasId") == false) {
                CHECK_MESSAGE(!holds_id(value, all_ids), "the entry carries the id: " << value);
            }
            if (expect.value("digestHashOmitsId", false)) {
                CHECK(entry.context_digest.hash == expected_digest_hash());
            }
        }
    }
    if (expect.contains("handlerDraws")) {
        std::vector<double> expected;
        for (const auto& value : expect.at("handlerDraws")) {
            expected.push_back(value.get<double>());
        }
        CHECK(harness.notes->draws == expected);
    }
}

// --- approvalSummary ----------------------------------------------------------------------------

/// A nonce store that notes every key it is asked to consume.
class NotingNonceStore final : public afd::ApprovalNonceStore {
public:
    bool consume(std::string_view nonce, std::int64_t /*expires_at_ms*/) override {
        const std::lock_guard lock(mutex_);
        asked_.emplace_back(nonce);
        return used_.emplace(nonce).second;
    }
    std::vector<std::string> asked() {
        const std::lock_guard lock(mutex_);
        return asked_;
    }

private:
    std::mutex mutex_;
    std::set<std::string, std::less<>> used_;
    std::vector<std::string> asked_;
};

/// What the hook, the handlers and the hold noted.
struct SummaryNotes {
    std::mutex mutex;
    std::vector<std::string> order;
    std::vector<Json> summaries;
    std::vector<std::string> hook_dispatch_ids;
    std::vector<std::string> handler_dispatch_ids;
    int handler_runs = 0;
    /// The approval ids of `on_approval_required`'s requests and their tokens.
    std::vector<std::string> held_approval_ids;
    std::vector<std::string> issued_tokens;
    /// The approval ids of DirectClient's `on_approval_needed` requests.
    std::vector<std::string> direct_approval_ids;
};

/// The approval setup of a case: approval-tokens.json's commands, each `approval: required`, and
/// item-echo with no policy, behind one approval middleware whose hook notes what it is given.
struct SummaryHarness {
    std::shared_ptr<SummaryNotes> notes = std::make_shared<SummaryNotes>();
    std::shared_ptr<NotingNonceStore> store = std::make_shared<NotingNonceStore>();
    std::shared_ptr<afd::CommandRegistry> registry;

    SummaryHarness(const Json& tokens, const Json& run) {
        const std::string via = run.value("via", "");
        auto seen = notes;
        const bool refuse = run.value("hook", "") == "fail";
        auto approval = afd::create_approval_middleware(
            {.secrets = {tokens.at("secrets").at("current").get<std::string>()},
             .ttl_ms = tokens.at("ttlMs").get<std::int64_t>(),
             .replay = run.value("replay", "") == "within-ttl" ? afd::ApprovalReplay::within_ttl
                                                               : afd::ApprovalReplay::single_use,
             .nonce_store = store,
             .on_approval_required =
                 [seen](const afd::ApprovalRequest& request) {
                     const std::lock_guard lock(seen->mutex);
                     seen->held_approval_ids.push_back(request.approval_id);
                     seen->issued_tokens.push_back(request.approval_token);
                 },
             .clock = afd::fixed_clock(tokens.at("now").get<std::int64_t>()),
             .relay = via == "elicitation" ? afd::ApprovalRelay::mcp_elicitation
                                           : afd::ApprovalRelay::none,
             .on_approval_accepted =
                 [seen, refuse](const afd::ApprovalSummary& summary,
                                std::string_view dispatch_id) -> std::optional<std::string> {
                 const std::lock_guard lock(seen->mutex);
                 seen->order.emplace_back("hook");
                 seen->summaries.emplace_back(summary);
                 seen->hook_dispatch_ids.emplace_back(dispatch_id);
                 if (refuse) {
                     return std::string("the harness refuses");
                 }
                 return std::nullopt;
             }});
        REQUIRE_MESSAGE(approval.has_value(), (approval ? "" : approval.error()));
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {*approval}});
        const auto handler = [seen](const Json& input, afd::CommandContext& context) {
            const std::lock_guard lock(seen->mutex);
            seen->order.emplace_back("handler");
            seen->handler_dispatch_ids.push_back(context.dispatch_id.value());
            ++seen->handler_runs;
            return afd::success(input);
        };
        for (const auto& name : tokens.at("commands")) {
            REQUIRE_FALSE(
                registry->register_command({.name = name.get<std::string>(),
                                            .description = "A gated command",
                                            .handler = handler,
                                            .expose = {.mcp = true},
                                            .approval = afd::ApprovalDecision::required}));
        }
        REQUIRE_FALSE(registry->register_command({.name = "item-echo",
                                                  .description = "Returns its input as data",
                                                  .handler = handler,
                                                  .expose = {.mcp = true}}));
        REQUIRE_FALSE(afd::register_bootstrap_commands(*registry));
    }
};

const Json* binding_named(const Json& tokens, const std::string& description) {
    for (const auto& binding : tokens.at("bindings")) {
        if (binding.at("description") == description) {
            return &binding;
        }
    }
    return nullptr;
}

afd::Actor actor_named(const Json& tokens, const std::string& name) {
    auto actor = afd::Actor::from_json(tokens.at("actors").at(name));
    REQUIRE(actor);
    return *actor;
}

#if AFD_HAS_MCP_STDIO
/// A 2025 client that declares form elicitation and approves every question, in band.
struct ApprovingClient {
    std::unique_ptr<afd::mcp::StdioServer> server;

    explicit ApprovingClient(const afd::CommandRegistry& registry) {
        auto created = afd::mcp::StdioServer::create(
            registry, {.tool_strategy = afd::mcp::ToolStrategy::individual});
        REQUIRE(created);
        server = std::move(*created);
        send(Json{{"jsonrpc", "2.0"},
                  {"id", 0},
                  {"method", "initialize"},
                  {"params",
                   {{"protocolVersion", "2025-11-25"},
                    {"capabilities", {{"elicitation", {{"form", Json::object()}}}}}}}});
    }

    Json send(const Json& message) {
        const afd::mcp::ClientRequester approve = [](const Json&) -> std::optional<Json> {
            return Json{{"action", "accept"}, {"content", {{"approve", true}}}};
        };
        const auto out = server->handle_message(afd::wire::serialize(message), approve);
        REQUIRE(out.has_value());
        return Json::parse(*out);
    }

    /// The CommandResult (or BatchResult) a `tools/call` returns.
    Json call(const std::string& tool, const Json& arguments) {
        const Json reply = send(Json{{"jsonrpc", "2.0"},
                                     {"id", 1},
                                     {"method", "tools/call"},
                                     {"params", {{"name", tool}, {"arguments", arguments}}}});
        return Json::parse(reply.at("result").at("content").at(0).at("text").get<std::string>());
    }
};
#endif

/// Cases whose surface C++ lacks, by description, with the reason.
const std::map<std::string, std::string>& skipped_summary_cases() {
    static const std::map<std::string, std::string> skipped{
        {"relay evidence gives an id from relay:<decisionId>, no times and no decision id",
         "C++ has no HumanRelay, so no call is admitted on relay evidence"}};
    return skipped;
}

void run_summary_case(const Json& tokens, const Json& item) {
    const Json& run = item.at("run");
    const Json& expect = item.at("expect");
    const std::string via = run.at("via").get<std::string>();
    SummaryHarness harness(tokens, run);
    const Json* binding = run.contains("binding")
                              ? binding_named(tokens, run.at("binding").get<std::string>())
                              : nullptr;
    REQUIRE((binding != nullptr) == run.contains("binding"));
    const std::string command =
        binding ? binding->at("command").get<std::string>() : run.value("command", std::string());
    const Json input = binding ? binding->at("input") : run.value("input", Json::object());
    const afd::Actor actor =
        actor_named(tokens, binding ? binding->at("actor").get<std::string>() : "agent");

    std::vector<Json> results;
    std::optional<Json> retried;
    if (via == "token" || via == "none") {
        afd::CommandContext context;
        context.actor = actor;
        if (binding) {
            std::string token = binding->at("token").get<std::string>();
            if (run.value("tamper", "") == "signature") {
                token.back() = token.back() == 'A' ? 'B' : 'A';
            }
            context.approval = token;
        }
        if (run.value("holdFirst", false)) {
            results.push_back(Json(harness.registry->execute(command, input, context)));
            REQUIRE(results.back().at("error").at("code") == "APPROVAL_REQUIRED");
            const std::lock_guard lock(harness.notes->mutex);
            REQUIRE(harness.notes->issued_tokens.size() == 1);
            context.approval = harness.notes->issued_tokens.front();
            results.clear();
        }
        const int count = run.value("count", 1);
        for (int i = 0; i < count; ++i) {
            results.push_back(Json(harness.registry->execute(command, input, context)));
        }
        if (run.value("thenRetry", false)) {
            retried = Json(harness.registry->execute(command, input, context));
        }
    } else if (via == "direct") {
        auto seen = harness.notes;
        const afd::DirectClient client(
            harness.registry,
            {.actor = actor,
             .on_approval_needed = [seen](const afd::DirectApprovalRequest& request) {
                 const std::lock_guard lock(seen->mutex);
                 seen->direct_approval_ids.push_back(request.approval_id);
                 return true;
             }});
        results.push_back(Json(client.call(command, input)));
    } else if (via == "elicitation") {
#if AFD_HAS_MCP_STDIO
        ApprovingClient client(*harness.registry);
        if (run.value("kind", "") == "batch") {
            results.push_back(client.call("afd-batch", Json{{"commands", run.at("commands")}}));
        } else {
            results.push_back(client.call(command, input));
        }
#else
        MESSAGE("skipped: the elicitation cases need afd::mcp_stdio (AFD_BUILD_MCP_STDIO)");
        return;
#endif
    } else {
        FAIL("unknown via " << via);
    }

    SummaryNotes& notes = *harness.notes;
    const std::lock_guard lock(notes.mutex);
    if (expect.contains("success")) {
        for (const auto& result : results) {
            CHECK_MESSAGE(result.at("success") == expect.at("success"), result);
        }
    }
    if (expect.contains("code")) {
        CHECK(results.front().at("error").at("code") == expect.at("code"));
    }
    if (expect.contains("hookCalls")) {
        CHECK(notes.summaries.size() == expect.at("hookCalls").get<std::size_t>());
    }
    if (expect.contains("handlerRuns")) {
        CHECK(notes.handler_runs == expect.at("handlerRuns").get<int>());
    }
    if (expect.contains("order")) {
        CHECK(notes.order == strings(expect.at("order")));
    }
    if (expect.contains("members")) {
        for (const auto& summary : notes.summaries) {
            std::vector<std::string> members;
            for (auto it = summary.begin(); it != summary.end(); ++it) {
                members.push_back(it.key());
            }
            std::sort(members.begin(), members.end());
            CHECK(members == strings(expect.at("members")));
        }
    }
    if (expect.contains("via")) {
        for (const auto& summary : notes.summaries) {
            CHECK(summary.at("via") == expect.at("via"));
        }
    }
    if (expect.value("dispatchIdIsHandlers", false)) {
        REQUIRE(notes.hook_dispatch_ids.size() == notes.handler_dispatch_ids.size());
        CHECK(notes.hook_dispatch_ids == notes.handler_dispatch_ids);
        for (const auto& id : notes.hook_dispatch_ids) {
            CHECK(well_formed(id));
        }
    }
    if (expect.contains("fromBinding")) {
        REQUIRE(binding);
        REQUIRE_FALSE(notes.summaries.empty());
        for (const auto& member : strings(expect.at("fromBinding"))) {
            CHECK(notes.summaries.front().at(member) == binding->at(member));
        }
    }
    const auto time_of = [&](const std::string& spelled) {
        const auto now = tokens.at("now").get<std::int64_t>();
        return spelled == "now + ttlMs" ? now + tokens.at("ttlMs").get<std::int64_t>() : now;
    };
    for (const char* member : {"issuedAt", "expiresAt"}) {
        if (expect.contains(member)) {
            REQUIRE_FALSE(notes.summaries.empty());
            CHECK(notes.summaries.front().at(member).get<std::int64_t>() ==
                  time_of(expect.at(member).get<std::string>()));
        }
    }
    if (expect.contains("summaryNeverHolds")) {
        for (const auto& name : strings(expect.at("summaryNeverHolds"))) {
            const std::string value =
                binding && binding->contains(name) ? binding->at(name).get<std::string>() : name;
            for (const auto& summary : notes.summaries) {
                CHECK_MESSAGE(summary.dump().find(value) == std::string::npos,
                              "the summary holds the " << name);
            }
        }
    }
    if (expect.contains("retry")) {
        REQUIRE(retried);
        const Json& want = expect.at("retry");
        CHECK(retried->at("error").at("code") == want.at("code"));
        CHECK(retried->at("error").at("details").at("reason") == want.at("reason"));
        CHECK(notes.handler_runs == want.at("handlerRuns").get<int>());
    }
    const auto distinct = [&](const char* member) {
        std::set<std::string> values;
        for (const auto& summary : notes.summaries) {
            values.insert(summary.at(member).get<std::string>());
        }
        return values.size();
    };
    if (expect.contains("distinctApprovalIds")) {
        CHECK(distinct("approvalId") == expect.at("distinctApprovalIds").get<std::size_t>());
    }
    if (expect.contains("distinctDispatchIds")) {
        const std::set<std::string> ids(notes.hook_dispatch_ids.begin(),
                                        notes.hook_dispatch_ids.end());
        CHECK(ids.size() == expect.at("distinctDispatchIds").get<std::size_t>());
    }
    if (expect.value("approvalIdFromSpentKey", false)) {
        std::set<std::string> spent;
        for (const auto& key : harness.store->asked()) {
            spent.insert(afd::approval_id(key));
        }
        REQUIRE_FALSE(notes.summaries.empty());
        for (const auto& summary : notes.summaries) {
            CHECK(spent.count(summary.at("approvalId").get<std::string>()) == 1);
        }
    }
    if (expect.value("requestApprovalIdIsSummarys", false)) {
        const auto& requests =
            via == "direct" ? notes.direct_approval_ids : notes.held_approval_ids;
        REQUIRE(requests.size() == 1);
        REQUIRE(notes.summaries.size() == 1);
        CHECK(requests.front() == notes.summaries.front().at("approvalId").get<std::string>());
    }
}

} // namespace journal_seams

TEST_CASE("journal-seams.json: C++ is not a documented gap") {
    const auto vectors = journal_seams::load("journal-seams.json");
    CHECK_FALSE(vectors.at("gaps").contains("cpp"));
    const auto& format = vectors.at("dispatchId").at("format");
    CHECK(format.at("length").get<int>() == 22);
    CHECK(format.at("pattern").get<std::string>() == "^[A-Za-z0-9_-]{21}[AQgw]$");
}

TEST_CASE("journal-seams.json: the dispatch id cases") {
    const auto vectors = journal_seams::load("journal-seams.json");
    const auto& cases = vectors.at("dispatchId").at("cases");
    REQUIRE_FALSE(cases.empty());
    for (const auto& item : cases) {
        CAPTURE(item.at("description").get<std::string>());
        journal_seams::run_dispatch_case(item);
    }
}

TEST_CASE(
    "journal-seams.json: the overwrite case, journaled, keeps the id's names out of the digest") {
    // A middleware can put a value under either spelling of the id's name after the registry
    // removed the caller's; the journal's digest still leaves both names out of `keys` (I4).
    const auto vectors = journal_seams::load("journal-seams.json");
    const auto& cases = vectors.at("dispatchId").at("cases");
    const auto found = std::find_if(cases.begin(), cases.end(), [](const afd::Json& item) {
        return item.at("run").value("middleware", "") == "overwrite";
    });
    REQUIRE(found != cases.end());
    afd::Json item = *found;
    item["run"]["journal"] = true;
    item["expect"]["entries"] = 1;
    item["expect"]["entryHasId"] = false;
    item["expect"]["digestHashOmitsId"] = true;
    journal_seams::run_dispatch_case(item);
}

TEST_CASE("journal-seams.json: the approval summary cases") {
    const auto vectors = journal_seams::load("journal-seams.json");
    const auto tokens = journal_seams::load("approval-tokens.json");
    const auto& cases = vectors.at("approvalSummary").at("cases");
    REQUIRE_FALSE(cases.empty());
    std::size_t skipped = 0;
    for (const auto& item : cases) {
        const auto description = item.at("description").get<std::string>();
        CAPTURE(description);
        const auto& skip = journal_seams::skipped_summary_cases();
        if (const auto it = skip.find(description); it != skip.end()) {
            MESSAGE("skipped \"" << description << "\": " << it->second);
            ++skipped;
            continue;
        }
        journal_seams::run_summary_case(tokens, item);
    }
    // Every case skipped by name is still in the file.
    CHECK(skipped == journal_seams::skipped_summary_cases().size());
}
