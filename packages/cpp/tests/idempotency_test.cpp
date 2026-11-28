// The idempotency step and key delivery beyond the shared vectors (spec/idempotency.md): the
// proposal's exit criteria, R3 on every surface that owns a deadline, the store's reservations
// under concurrent calls, the step's surfaces (D3), and the rules the vectors leave to each
// language (S12, the store's interface).
#include "afd/afd.hpp"

#if AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#if AFD_ENABLE_THREADS
#include <chrono>
#include <thread>
#endif

#include <doctest.h>

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
#include <stdexcept>
#define IDEMPOTENCY_EXCEPTIONS 1
#else
#define IDEMPOTENCY_EXCEPTIONS 0
#endif

using afd::Json;

namespace {

const afd::Actor advisor{.kind = afd::ActorKind::agent, .id = "advisor"};

afd::CommandContext keyed_context(std::optional<std::string> key) {
    afd::CommandContext context;
    context.actor = advisor;
    context.idempotency_key = std::move(key);
    return context;
}

/// A command whose effect is a counter: it applies the effect, then lets the clock run past the
/// call's deadline when `outlive_ms` is set, and returns `result` (success by default).
struct Effect {
    std::shared_ptr<afd::ManualClock> clock = afd::fixed_clock(0);
    std::atomic<int> applied{0};
    double outlive_ms = 0;
    std::optional<afd::CommandResult> result;

    afd::CommandDefinition define(std::string name, bool mutation,
                                  std::optional<afd::IdempotencySupport> idempotency) {
        return {.name = std::move(name),
                .description = "Applies an effect",
                .handler =
                    [this](const Json&, afd::CommandContext&) {
                        const int count = ++applied;
                        if (outlive_ms > 0) {
                            clock->advance(outlive_ms);
                        }
                        return result ? *result : afd::success({{"applied", count}});
                    },
                .mutation = mutation,
                .idempotency = idempotency,
                .expose = {.mcp = true}};
    }
};

afd::CommandResult timeout_result() {
    return afd::failure(afd::create_error(afd::error_codes::TIMEOUT, "Downstream timed out",
                                          {.suggestion = "Retry", .retryable = true}));
}

} // namespace

// ═══════════════════════════════════════════════════════════════════════════════
// THE PROPOSAL'S EXIT CRITERIA
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("a handler that applies its effect and outlives the deadline is not applied again") {
    // C++'s engine waits for the handler and then answers TIMEOUT (S7): the handler's own
    // result is in the store by then, so a repeat with the same key gets it.
    Effect effect;
    effect.outlive_ms = 100;
    afd::CommandRegistry registry(
        {.clock = effect.clock, .idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command(
        effect.define("order-place", true, afd::IdempotencySupport::keyed)));

    auto first = keyed_context("k1");
    first.timeout_ms = 50;
    const auto timed_out = registry.execute("order-place", Json::object(), first);
    REQUIRE(timed_out.error);
    CHECK(timed_out.error->code == afd::error_codes::TIMEOUT);
    // R3: the step held the key, so a repeat with it is safe.
    REQUIRE(timed_out.error->recovery);
    CHECK(timed_out.error->recovery->kind == afd::RecoveryKind::retry);
    CHECK(timed_out.error->suggestion->find("same idempotency key") != std::string::npos);

    effect.outlive_ms = 0;
    const auto repeat = registry.execute("order-place", Json::object(), keyed_context("k1"));
    CHECK(repeat.success);
    CHECK(Json(repeat)["data"] == Json{{"applied", 1}});
    CHECK(Json(repeat)["metadata"]["idempotentReplay"] == true);
    CHECK(effect.applied == 1);
}

TEST_CASE("the key's scope binds the verified credentials as well as the actor (S3, M8)") {
    Effect effect;
    afd::CommandRegistry registry({.idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command(
        effect.define("order-place", true, afd::IdempotencySupport::keyed)));
    const auto with = [](std::optional<afd::PrincipalCredentials> credentials) {
        auto context = keyed_context("k1");
        context.credentials = std::move(credentials);
        return context;
    };
    const afd::PrincipalCredentials alice{
        .issuer = "https://idp.example", .subject = "alice", .client_id = "app"};
    const afd::PrincipalCredentials bob{
        .issuer = "https://idp.example", .subject = "bob", .client_id = "app"};

    auto first = with(alice);
    CHECK(registry.execute("order-place", Json::object(), first).success);
    // The same actor with other credentials is another principal: its key is its own.
    auto other = with(bob);
    const auto theirs = registry.execute("order-place", Json::object(), other);
    CHECK(theirs.success);
    CHECK_FALSE(Json(theirs)["metadata"].contains("idempotentReplay"));
    CHECK(effect.applied == 2);
    // The same credentials share it.
    auto again = with(alice);
    CHECK(Json(registry.execute("order-place", Json::object(),
                                again))["metadata"]["idempotentReplay"] == true);
    CHECK(effect.applied == 2);
    // Credentials M8 cannot bind fail the call before the handler runs.
    auto unbound = with(afd::PrincipalCredentials{.issuer = "https://idp.example"});
    const auto refused = registry.execute("order-place", Json::object(), unbound);
    REQUIRE(refused.error);
    CHECK(refused.error->code == afd::error_codes::INTERNAL_ERROR);
    CHECK(effect.applied == 2);
}

TEST_CASE("with the retry middleware, a TIMEOUT after the effect applies a keyed or undeclared "
          "mutation once, and repeats a natural one") {
    struct Case {
        std::optional<afd::IdempotencySupport> idempotency;
        bool with_key;
        bool with_step;
        int applied;
    };
    const std::vector<Case> cases{
        // keyed, with a key: the retry repeats it, and the step answers OUTCOME_UNKNOWN.
        {afd::IdempotencySupport::keyed, true, true, 1},
        // keyed, without a key: never repeated (R1), with the step or without.
        {afd::IdempotencySupport::keyed, false, true, 1},
        {afd::IdempotencySupport::keyed, false, false, 1},
        // undeclared: never repeated.
        {std::nullopt, true, true, 1},
        {std::nullopt, false, false, 1},
        // natural: repeated by design.
        {afd::IdempotencySupport::natural, false, false, 4},
        {afd::IdempotencySupport::natural, true, true, 4},
    };
    for (const auto& c : cases) {
        CAPTURE(c.with_key);
        CAPTURE(c.with_step);
        CAPTURE(c.idempotency.has_value());
        Effect effect;
        effect.result = timeout_result();
        auto retry = afd::create_retry_middleware({.retry_delay_ms = 0});
        REQUIRE(retry);
        afd::CommandRegistryOptions options{.middleware = {*retry}, .clock = effect.clock};
        if (c.with_step) {
            options.idempotency = afd::IdempotencyOptions{};
        }
        afd::CommandRegistry registry(std::move(options));
        REQUIRE_FALSE(registry.register_command(effect.define("order-place", true, c.idempotency)));
        const auto result = registry.execute(
            "order-place", Json::object(),
            keyed_context(c.with_key ? std::optional<std::string>("k1") : std::nullopt));
        CHECK_FALSE(result.success);
        CHECK(effect.applied == c.applied);
        if (c.idempotency == afd::IdempotencySupport::keyed && c.with_key && c.with_step) {
            REQUIRE(result.error);
            CHECK(result.error->code == afd::error_codes::OUTCOME_UNKNOWN);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// R3 ON THE SURFACES THAT OWN A DEADLINE
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("DirectClient's TIMEOUT carries the retry recovery only where the step held the key") {
    Effect effect;
    effect.outlive_ms = 100;
    auto registry = std::make_shared<afd::CommandRegistry>(afd::CommandRegistryOptions{
        .clock = effect.clock, .idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry->register_command(
        effect.define("order-place", true, afd::IdempotencySupport::keyed)));
    REQUIRE_FALSE(registry->register_command(effect.define("order-note", true, std::nullopt)));
    const afd::DirectClient client(registry, {.clock = effect.clock});

    const auto call = [&](const char* name, std::optional<std::string> key) {
        auto context = keyed_context(std::move(key));
        context.timeout_ms = 50;
        return client.call(name, Json::object(), context);
    };
    const auto keyed = call("order-place", "k1");
    REQUIRE(keyed.error);
    CHECK(keyed.error->code == afd::error_codes::TIMEOUT);
    REQUIRE(keyed.error->recovery);
    CHECK(keyed.error->recovery->kind == afd::RecoveryKind::retry);
    for (const auto& other : {call("order-place", std::nullopt), call("order-note", "k2")}) {
        REQUIRE(other.error);
        CHECK(other.error->code == afd::error_codes::TIMEOUT);
        CHECK_FALSE(other.error->recovery);
    }
    // The repeat through the client is answered from the store.
    effect.outlive_ms = 0;
    const auto repeat = client.call("order-place", Json::object(), keyed_context("k1"));
    CHECK(Json(repeat)["metadata"]["idempotentReplay"] == true);
    CHECK(effect.applied == 3);
}

#if AFD_HAS_MCP_STDIO
namespace {

Json modern_call(afd::mcp::StdioServer& server, const std::string& name, const Json& arguments,
                 const Json& meta = Json::object()) {
    Json request_meta{{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                      {"io.modelcontextprotocol/clientCapabilities", Json::object()}};
    request_meta.update(meta);
    const Json request{
        {"jsonrpc", "2.0"},
        {"id", 1},
        {"method", "tools/call"},
        {"params", {{"name", name}, {"arguments", arguments}, {"_meta", request_meta}}}};
    const auto out = server.handle_message(afd::wire::serialize(request));
    REQUIRE(out.has_value());
    const Json reply = Json::parse(*out);
    REQUIRE(reply.contains("result"));
    return Json::parse(reply["result"]["content"][0]["text"].get<std::string>());
}

const std::string key_meta(afd::afd_idempotency_key_meta_key);

} // namespace

TEST_CASE("the stdio server's TIMEOUT carries the retry recovery where the step held the key") {
    Effect effect;
    effect.outlive_ms = 100;
    afd::CommandRegistry registry(
        {.clock = effect.clock, .idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command(
        effect.define("order-place", true, afd::IdempotencySupport::keyed)));
    auto server = afd::mcp::StdioServer::create(
        registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                   .clock = effect.clock,
                   .default_timeout_ms = 50});
    REQUIRE(server);
    const Json keyed = modern_call(**server, "order-place", Json::object(), {{key_meta, "k1"}});
    CHECK(keyed["error"]["code"] == "TIMEOUT");
    CHECK(keyed["error"]["recovery"] == Json{{"kind", "retry"}});
    const Json unkeyed = modern_call(**server, "order-place", Json::object());
    CHECK(unkeyed["error"]["code"] == "TIMEOUT");
    CHECK_FALSE(unkeyed["error"].contains("recovery"));
    effect.outlive_ms = 0;
    const Json repeat = modern_call(**server, "order-place", Json::object(), {{key_meta, "k1"}});
    CHECK(repeat["metadata"]["idempotentReplay"] == true);
    CHECK(effect.applied == 2);
}

TEST_CASE("the stdio server checks the key's form before it asks for confirmation (K2)") {
    std::atomic<int> runs{0};
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command({.name = "note-clear",
                                             .description = "Clears the notes",
                                             .handler =
                                                 [&](const Json&, afd::CommandContext&) {
                                                     ++runs;
                                                     return afd::success({});
                                                 },
                                             .mutation = true,
                                             .confirm_prompt = "Clear every note?",
                                             .expose = {.mcp = true}}));
    auto server = afd::mcp::StdioServer::create(
        registry, {.confirmations = afd::mcp::ConfirmationMode::enforce,
                   .tool_strategy = afd::mcp::ToolStrategy::individual});
    REQUIRE(server);
    for (const Json& key : {Json("a:b"), Json(42), Json(""), Json::object()}) {
        CAPTURE(key.dump());
        const Json refused = modern_call(**server, "note-clear", Json::object(), {{key_meta, key}});
        CHECK(refused["error"]["code"] == "VALIDATION_ERROR");
        CHECK(refused["error"]["details"]["meta"] == key_meta);
    }
    // In afd-call's meta argument, and in an afd-batch whose items would derive keys from it.
    const Json argument = modern_call(
        **server, "afd-call",
        {{"command", "note-clear"}, {"input", Json::object()}, {"meta", {{key_meta, 7}}}});
    CHECK(argument["error"]["code"] == "VALIDATION_ERROR");
    CHECK(argument["error"]["details"]["meta"] == key_meta);
    const Json batch = modern_call(
        **server, "afd-batch",
        {{"commands", Json::array({{{"command", "note-clear"}, {"input", Json::object()}}})}},
        {{key_meta, "x y"}});
    CHECK(batch["error"]["code"] == "VALIDATION_ERROR");
    CHECK(batch["error"]["details"]["meta"] == key_meta);
    // The meta argument and _meta must agree.
    const Json disagree = modern_call(
        **server, "afd-call",
        {{"command", "note-clear"}, {"input", Json::object()}, {"meta", {{key_meta, "k1"}}}},
        {{key_meta, "k2"}});
    CHECK(disagree["error"]["code"] == "VALIDATION_ERROR");
    CHECK(runs == 0);
}

TEST_CASE("a context_hook's key wins over _meta, and a hook's actor scopes the key to it") {
    std::atomic<int> runs{0};
    std::vector<std::string> seen;
    afd::CommandRegistry registry({.idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command({.name = "order-place",
                                             .description = "Places an order",
                                             .handler =
                                                 [&](const Json&, afd::CommandContext& context) {
                                                     seen.push_back(
                                                         context.idempotency_key.value_or("-"));
                                                     return afd::success({{"placed", ++runs}});
                                                 },
                                             .mutation = true,
                                             .idempotency = afd::IdempotencySupport::keyed,
                                             .expose = {.mcp = true}}));
    const auto hooked = [&](std::optional<std::string> key) {
        auto server = afd::mcp::StdioServer::create(
            registry,
            {.tool_strategy = afd::mcp::ToolStrategy::individual,
             .context_hook = [key](afd::CommandContext& context, const afd::mcp::RequestInfo&) {
                 context.actor = advisor;
                 context.idempotency_key = key;
             }});
        REQUIRE(server);
        return std::move(*server);
    };
    auto first = hooked("host-key");
    CHECK(modern_call(*first, "order-place", Json::object(), {{key_meta, "k1"}})["data"] ==
          Json{{"placed", 1}});
    CHECK(seen.back() == "host-key");
    // Another connection whose hook names the same actor shares the key: the actor, not the
    // connection, is the principal.
    auto second = hooked(std::nullopt);
    const Json again =
        modern_call(*second, "order-place", Json::object(), {{key_meta, "host-key"}});
    CHECK(again["metadata"]["idempotentReplay"] == true);
    CHECK(runs == 1);
}

TEST_CASE("an actor an auth middleware sets scopes the key, not the stdio connection (S3, K5)") {
    std::atomic<int> runs{0};
    const afd::CommandMiddleware authenticate =
        [](std::string_view, const Json&, afd::CommandContext& context, const afd::Next& next) {
            context.actor = advisor;
            return next();
        };
    afd::CommandRegistry registry(
        {.middleware = {authenticate}, .idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command(
        {.name = "order-place",
         .description = "Places an order",
         .handler = [&](const Json&,
                        afd::CommandContext&) { return afd::success({{"placed", ++runs}}); },
         .mutation = true,
         .idempotency = afd::IdempotencySupport::keyed,
         .expose = {.mcp = true}}));
    const auto connect = [&] {
        auto server = afd::mcp::StdioServer::create(
            registry, {.tool_strategy = afd::mcp::ToolStrategy::individual});
        REQUIRE(server);
        return std::move(*server);
    };
    auto first = connect();
    CHECK(modern_call(*first, "order-place", Json::object(), {{key_meta, "k1"}})["data"] ==
          Json{{"placed", 1}});
    // Another connection: the middleware names the same actor, so the key is shared.
    auto second = connect();
    const Json again = modern_call(*second, "order-place", Json::object(), {{key_meta, "k1"}});
    CHECK(again["metadata"]["idempotentReplay"] == true);
    CHECK(runs == 1);
}

TEST_CASE("a hook's verified credentials, with the default actor, scope the key to them (S3)") {
    std::atomic<int> runs{0};
    afd::CommandRegistry registry({.idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command(
        {.name = "order-place",
         .description = "Places an order",
         .handler = [&](const Json&,
                        afd::CommandContext&) { return afd::success({{"placed", ++runs}}); },
         .mutation = true,
         .idempotency = afd::IdempotencySupport::keyed,
         .expose = {.mcp = true}}));
    const auto hooked = [&] {
        auto server = afd::mcp::StdioServer::create(
            registry,
            {.tool_strategy = afd::mcp::ToolStrategy::individual,
             .context_hook = [](afd::CommandContext& context, const afd::mcp::RequestInfo&) {
                 context.credentials = afd::PrincipalCredentials{
                     .issuer = "https://idp.example", .subject = "alice", .client_id = "app"};
             }});
        REQUIRE(server);
        return std::move(*server);
    };
    auto first = hooked();
    CHECK(modern_call(*first, "order-place", Json::object(), {{key_meta, "k1"}})["data"] ==
          Json{{"placed", 1}});
    // Another connection with the same credentials is the same principal, not a new connection.
    auto second = hooked();
    const Json again = modern_call(*second, "order-place", Json::object(), {{key_meta, "k1"}});
    CHECK(again["metadata"]["idempotentReplay"] == true);
    CHECK(runs == 1);
}
#endif

// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS UNDER CONCURRENT CALLS (S5, S12)
// ═══════════════════════════════════════════════════════════════════════════════

#if AFD_ENABLE_THREADS
TEST_CASE("of many concurrent calls with one key, exactly one runs the handler") {
    std::atomic<int> runs{0};
    std::atomic<bool> go{false};
    afd::CommandRegistry registry({.idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command({.name = "order-place",
                                             .description = "Places an order",
                                             .handler =
                                                 [&](const Json&, afd::CommandContext&) {
                                                     const int placed = ++runs;
                                                     // Hold the reservation long enough for the
                                                     // others to find it.
                                                     std::this_thread::sleep_for(
                                                         std::chrono::milliseconds(20));
                                                     return afd::success({{"placed", placed}});
                                                 },
                                             .mutation = true,
                                             .idempotency = afd::IdempotencySupport::keyed}));
    constexpr int callers = 16;
    std::vector<afd::CommandResult> results(callers);
    std::vector<std::thread> threads;
    for (int i = 0; i < callers; ++i) {
        threads.emplace_back([&, i]() {
            while (!go.load()) {
                std::this_thread::yield();
            }
            results[static_cast<std::size_t>(i)] =
                registry.execute("order-place", {{"sku", "a"}}, keyed_context("k1"));
        });
    }
    go = true;
    for (auto& thread : threads) {
        thread.join();
    }
    CHECK(runs == 1);
    int ran = 0;
    for (const auto& result : results) {
        const Json value(result);
        if (result.success) {
            CHECK(value["data"] == Json{{"placed", 1}});
            ran += value["metadata"].contains("idempotentReplay") ? 0 : 1;
        } else {
            CHECK(value["error"]["code"] == "IDEMPOTENCY_IN_PROGRESS");
        }
    }
    CHECK(ran == 1);
}
#endif

#if AFD_ENABLE_THREADS
TEST_CASE("a call with a deadline past any the engine enforces keeps its lease, without overflow") {
    // The lease counts from the deadline as the engine arms it, clamped, so a huge timeout (or
    // one standing for "none") still leaves a running call in progress, not of unknown outcome.
    std::atomic<bool> started{false};
    std::atomic<bool> release{false};
    afd::CommandRegistry registry({.idempotency = afd::IdempotencyOptions{}});
    REQUIRE_FALSE(registry.register_command({.name = "order-place",
                                             .description = "Places an order",
                                             .handler =
                                                 [&](const Json&, afd::CommandContext&) {
                                                     started = true;
                                                     while (!release.load()) {
                                                         std::this_thread::yield();
                                                     }
                                                     return afd::success({{"placed", 1}});
                                                 },
                                             .mutation = true,
                                             .idempotency = afd::IdempotencySupport::keyed}));
    for (const double timeout : {1e19, 1.7976931348623157e308}) {
        CAPTURE(timeout);
        started = false;
        release = false;
        const std::string key = timeout > 1e20 ? "k-max" : "k-huge";
        std::thread first([&]() {
            auto context = keyed_context(key);
            context.timeout_ms = timeout;
            (void)registry.execute("order-place", Json::object(), context);
        });
        while (!started.load()) {
            std::this_thread::yield();
        }
        const auto repeat = registry.execute("order-place", Json::object(), keyed_context(key));
        release = true;
        first.join();
        REQUIRE(repeat.error);
        CHECK(repeat.error->code == afd::error_codes::IDEMPOTENCY_IN_PROGRESS);
    }
}
#endif

TEST_CASE("DirectClient::pipe runs each step under the key derived from the request's") {
    std::vector<std::string> seen;
    auto registry = std::make_shared<afd::CommandRegistry>();
    REQUIRE_FALSE(
        registry->register_command({.name = "note-read",
                                    .description = "Reads a note",
                                    .handler = [&](const Json&, afd::CommandContext& context) {
                                        seen.push_back(context.idempotency_key.value_or("-"));
                                        return afd::success({});
                                    }}));
    const afd::DirectClient client(registry);
    afd::CommandContext context;
    context.idempotency_key = "p1";
    const Json steps = Json::array({{{"command", "note-read"}, {"input", Json::object()}},
                                    {{"command", "note-read"}, {"input", Json::object()}}});
    const auto result = client.pipe(Json{{"steps", steps}}, context);
    CHECK(result.metadata.completed_steps == 2);
    CHECK(seen == std::vector<std::string>{"p1:step:0", "p1:step:1"});
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE STORE (S12) AND THE OPTIONS (S8)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("the in-memory store settles only the reservation it was made for") {
    afd::InMemoryIdempotencyStore store;
    const afd::IdempotencyReservationRequest request{
        .digest = "d", .reserved_at = 0, .expires_at = 10, .lease_ends_at = 5};
    const auto first = store.reserve("s", request, 0);
    REQUIRE(first.reserved);
    // Held: a second reservation reports the record and changes nothing.
    const auto held = store.reserve("s", request, 1);
    CHECK_FALSE(held.reserved);
    REQUIRE(held.record);
    CHECK(held.record->state == afd::IdempotencyState::reserved);
    // Past its expiry the key is new, and the old reservation no longer settles it.
    const auto second = store.reserve(
        "s", {.digest = "d", .reserved_at = 11, .expires_at = 100, .lease_ends_at = 20}, 11);
    REQUIRE(second.reserved);
    CHECK(second.reservation != first.reservation);
    store.complete("s", first.reservation, {.result = afd::success({{"late", true}})});
    store.release("s", first.reservation);
    REQUIRE(store.get("s", 11));
    CHECK(store.get("s", 11)->state == afd::IdempotencyState::reserved);
    store.complete("s", second.reservation, {.result = afd::success({{"kept", true}})});
    const auto stored = store.get("s", 12);
    REQUIRE(stored);
    CHECK(stored->state == afd::IdempotencyState::stored);
    CHECK(Json(*stored->result)["data"] == Json{{"kept", true}});
    store.complete("s", second.reservation, {});
    CHECK(store.get("s", 12)->state == afd::IdempotencyState::unknown);
    store.release("s", second.reservation);
    CHECK_FALSE(store.get("s", 12));
}

TEST_CASE("the in-memory store sweeps expired records once it holds sweep_at of them") {
    afd::InMemoryIdempotencyStore store({.sweep_at = 2});
    const auto reserve = [&](const char* scope, std::int64_t at) {
        return store.reserve(
            scope, {.digest = "d", .reserved_at = at, .expires_at = at + 5, .lease_ends_at = at},
            at);
    };
    REQUIRE(reserve("a", 0).reserved);
    REQUIRE(reserve("b", 0).reserved);
    CHECK(store.size() == 2);
    REQUIRE(reserve("c", 10).reserved);
    CHECK(store.size() == 1);
}

TEST_CASE("a registry refuses idempotency options S8 refuses") {
    const auto refused =
        afd::CommandRegistry::create({.idempotency = afd::IdempotencyOptions{
                                          .store = nullptr, .ttl_ms = 1000, .lease_ms = 1000}});
    REQUIRE_FALSE(refused);
    CHECK(refused.error().find("ttl_ms") != std::string::npos);
    CHECK(afd::check_idempotency_options({.store = nullptr, .ttl_ms = 0, .lease_ms = 1}));
    CHECK(afd::check_idempotency_options({.store = nullptr, .ttl_ms = 10, .lease_ms = 0}));
    CHECK_FALSE(afd::check_idempotency_options({}, 30000));
    // A registry built anyway fails every call, before any handler.
    afd::CommandRegistry broken(
        {.idempotency = afd::IdempotencyOptions{.store = nullptr, .ttl_ms = 1, .lease_ms = 1}});
    REQUIRE_FALSE(broken.register_command(
        {.name = "thing-do",
         .description = "Does a thing",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success({}); }}));
    CHECK(broken.execute("thing-do").error->code == afd::error_codes::INTERNAL_ERROR);
}

#if IDEMPOTENCY_EXCEPTIONS
TEST_CASE("a store that fails to settle leaves the handler's result standing, and reports it") {
    class FailingStore final : public afd::IdempotencyStore {
    public:
        afd::InMemoryIdempotencyStore inner;
        afd::IdempotencyReserveOutcome reserve(const std::string& scope,
                                               const afd::IdempotencyReservationRequest& request,
                                               std::int64_t now) override {
            return inner.reserve(scope, request, now);
        }
        void complete(const std::string&, const std::string&,
                      const afd::IdempotencySettlement&) override {
            throw std::runtime_error("store down");
        }
        void release(const std::string&, const std::string&) override {
            throw std::runtime_error("store down");
        }
        std::optional<afd::IdempotencyRecord> get(const std::string& scope,
                                                  std::int64_t now) override {
            return inner.get(scope, now);
        }
    };
    std::vector<std::string> reported;
    afd::CommandRegistry registry(
        {.on_error = [&](std::string_view message) { reported.emplace_back(message); },
         .idempotency = afd::IdempotencyOptions{.store = std::make_shared<FailingStore>()}});
    REQUIRE_FALSE(registry.register_command(
        {.name = "order-place",
         .description = "Places an order",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success({{"ok", 1}}); },
         .idempotency = afd::IdempotencySupport::keyed}));
    const auto result = registry.execute("order-place", Json::object(), keyed_context("k1"));
    CHECK(result.success);
    CHECK(reported == std::vector<std::string>{"store down"});
    // The reservation was never settled: within its lease the repeat is told to wait.
    const auto repeat = registry.execute("order-place", Json::object(), keyed_context("k1"));
    CHECK(repeat.error->code == afd::error_codes::IDEMPOTENCY_IN_PROGRESS);
}
#endif

// ═══════════════════════════════════════════════════════════════════════════════
// THE KEY ON NESTED, BATCH AND PIPELINE CALLS (K2, K4, K6)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("a handler under a derived key runs a nested call without it, and K2 never refuses it") {
    std::vector<std::string> seen;
    auto registry = std::make_shared<afd::CommandRegistry>();
    REQUIRE_FALSE(registry->register_command(
        {.name = "note-read",
         .description = "Reads a note",
         .input_schema =
             Json::parse(R"({"type":"object","properties":{"nest":{"type":"boolean"}}})"),
         .handler = [&](const Json& input, afd::CommandContext& context) {
             seen.push_back(context.idempotency_key.value_or("-"));
             if (input.value("nest", false)) {
                 const auto nested = registry->execute("note-read", Json::object(), context);
                 CHECK(nested.success);
                 const auto batch = registry->execute_batch(
                     Json{{"commands",
                           Json::array({{{"command", "note-read"}, {"input", Json::object()}}})}},
                     context);
                 CHECK(batch.results.front().result.success);
             }
             return afd::success({});
         }}));
    afd::CommandContext context;
    context.idempotency_key = "p1";
    const auto pipeline = registry->execute_pipeline(
        Json{{"steps", Json::array({{{"command", "note-read"}, {"input", {{"nest", true}}}}})}},
        context);
    CHECK(pipeline.metadata.completed_steps == 1);
    CHECK(seen == std::vector<std::string>{"p1:step:0", "-", "-"});
}

TEST_CASE("a batch whose request carries a malformed key fails every item with K2's error") {
    int runs = 0;
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command({.name = "note-add",
                                             .description = "Adds a note",
                                             .handler = [&](const Json&, afd::CommandContext&) {
                                                 ++runs;
                                                 return afd::success({});
                                             }}));
    afd::CommandContext context;
    context.idempotency_key = "not valid";
    const auto batch = registry.execute_batch(
        Json{{"commands", Json::array({{{"command", "note-add"}, {"input", Json::object()}},
                                       {{"command", "note-add"}, {"input", Json::object()}}})}},
        context);
    REQUIRE(batch.results.size() == 2);
    for (const auto& item : batch.results) {
        REQUIRE(item.result.error);
        CHECK(item.result.error->code == afd::error_codes::VALIDATION_ERROR);
        CHECK((*item.result.error->details)["meta"] == "dev.afd/idempotencyKey");
    }
    CHECK(runs == 0);
}

TEST_CASE("a declared context field cannot take the key's name") {
    for (const char* name : {"idempotencyKey", "idempotency_key"}) {
        const auto created = afd::CommandRegistry::create(
            {.context_fields = {afd::ContextField{
                 .name = name, .meta = "dev.example/key", .schema = Json{{"type", "string"}}}}});
        CHECK_FALSE(created);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE DECLARATION'S SURFACES (D2, D3)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("idempotency is reported in afd-detail, afd-help (full) and grouped actions") {
    afd::CommandRegistry registry;
    REQUIRE_FALSE(registry.register_command(
        {.name = "todo-delete",
         .description = "Deletes a todo",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success({}); },
         .mutation = true,
         .idempotency = afd::IdempotencySupport::natural,
         .expose = {.mcp = true}}));
    REQUIRE_FALSE(registry.register_command(
        {.name = "todo-list",
         .description = "Lists todos",
         .handler = [](const Json&, afd::CommandContext&) { return afd::success({}); },
         .expose = {.mcp = true}}));
    REQUIRE_FALSE(afd::register_bootstrap_commands(registry));
    const Json detail = afd::to_json(registry.get("todo-delete")->definition);
    CHECK(detail["idempotency"] == "natural");
    CHECK_FALSE(afd::to_json(registry.get("todo-list")->definition).contains("idempotency"));
    // A command that is not a mutation can still be natural; the hint is all it reports.
    afd::CommandDefinition read_natural = registry.get("todo-list")->definition;
    read_natural.idempotency = afd::IdempotencySupport::natural;
    CHECK(afd::command_tool_annotations(read_natural) == Json{{"idempotentHint", true}});

    const Json help = Json(registry.execute("afd-help", {{"format", "full"}}));
    bool found = false;
    for (const auto& command : help["data"]["commands"]) {
        if (command["name"] == "todo-delete") {
            found = true;
            CHECK(command["idempotency"] == "natural");
        }
        if (command["name"] == "todo-list") {
            CHECK_FALSE(command.contains("idempotency"));
        }
    }
    CHECK(found);
    const Json brief = Json(registry.execute("afd-help"));
    for (const auto& command : brief["data"]["commands"]) {
        CHECK_FALSE(command.contains("idempotency"));
    }

#if AFD_HAS_MCP_STDIO
    auto server = afd::mcp::StdioServer::create(registry, {});
    REQUIRE(server);
    bool grouped = false;
    for (const auto& tool : (*server)->tools()) {
        if (!tool.contains("_meta") || !tool["_meta"].contains("actions")) {
            continue;
        }
        for (const auto& action : tool["_meta"]["actions"]) {
            if (action["command"] == "todo-delete") {
                grouped = true;
                CHECK(action["idempotency"] == "natural");
            }
        }
    }
    CHECK(grouped);
#endif
}

TEST_CASE("the journal reads and writes idempotencyKey after traceId") {
    afd::JournalEntry entry;
    entry.timestamp = "2026-11-27T00:00:00.000Z";
    entry.trace_id = "t1";
    entry.idempotency_key = "b1:0";
    entry.command = "note-add";
    entry.context_digest.hash = "sha256:00";
    entry.result = afd::success({});
    const std::string line = afd::serialize_journal_entry(entry);
    CHECK(line.find(R"("traceId":"t1","idempotencyKey":"b1:0","command")") != std::string::npos);
    const auto parsed = afd::JournalEntry::from_json(Json::parse(line));
    REQUIRE(parsed);
    CHECK(parsed->idempotency_key == "b1:0");
    Json wrong = Json::parse(line);
    wrong["idempotencyKey"] = 3;
    CHECK_FALSE(afd::JournalEntry::from_json(wrong));
}
