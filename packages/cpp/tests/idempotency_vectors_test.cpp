// The language-neutral vectors in spec/vectors/idempotency.json: idempotency keys
// (spec/idempotency.md), every section, against the C++ registry and, where a case sends `_meta`,
// the MCP stdio server.
//
// - `declaration`: the command's tool `_meta.idempotency` and its `idempotentHint` annotation.
// - `key.form` and `key.derived`: K2's form and K4's derived keys.
// - `key.delivery`: a key sent each way K1 names (in `_meta` and in `afd-call`'s `meta` argument
//   on the stdio server; on the context in process) reaching the handler.
// - `step`: the engine's step on one registry with one store and the harness's clock. Calls are
//   in process unless the case names a surface. C++'s engine waits for the handler and then
//   replaces its result with TIMEOUT (S7), so the `waits` case runs and the `continues`, `cancels`
//   and `drops` cases are another engine's. C++ has no HTTP server and no MCP tasks, so the cases
//   on those surfaces are skipped, and `order-throw` runs only in builds with exceptions.
// - `step.options`, `retry`, `timeoutRecovery` and `journal`.
#include "afd/afd.hpp"

#if AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <cstddef>
#include <cstdint>
#include <fstream>
#include <initializer_list>
#include <iterator>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#if AFD_ENABLE_THREADS
#include <condition_variable>
#include <thread>
#endif

#include "detail/approval_admission.hpp"
#include "detail/idempotency.hpp"
#include "detail/sha256.hpp"
#include <doctest.h>

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
#define IDEMPOTENCY_TEST_EXCEPTIONS 1
#include <stdexcept>
#else
#define IDEMPOTENCY_TEST_EXCEPTIONS 0
#endif

using afd::Json;

namespace idempotency_vectors {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

const Json& vectors() {
    static const Json loaded = idempotency_vectors::load("idempotency.json");
    return loaded;
}

/// The engine C++ is (S7): it waits for the handler, then replaces its result with TIMEOUT.
constexpr const char* engine = "waits";

std::string meta_key() {
    return vectors().at("metaKey").get<std::string>();
}

afd::Json to_json(const afd::CommandResult& result) {
    return Json(result);
}

/// The member of `value` at `path`, or `null` when there is none.
Json member(const Json& value, std::initializer_list<const char*> path) {
    const Json* at = &value;
    for (const char* name : path) {
        if (!at->is_object() || !at->contains(name)) {
            return nullptr;
        }
        at = &at->at(name);
    }
    return *at;
}

std::optional<afd::IdempotencySupport> support(const Json& command) {
    if (!command.contains("idempotency")) {
        return std::nullopt;
    }
    return command.at("idempotency").get<std::string>() == "natural"
               ? afd::IdempotencySupport::natural
               : afd::IdempotencySupport::keyed;
}

afd::Actor actor_of(const Json& actor) {
    return afd::Actor{.kind = afd::ActorKind::agent,
                      .id = actor.at("id").get<std::string>(),
                      .label = std::nullopt,
                      .on_behalf_of = std::nullopt};
}

#if AFD_HAS_MCP_STDIO
Json modern_meta() {
    return Json{{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                {"io.modelcontextprotocol/clientCapabilities", Json::object()}};
}

/// The CommandResult of one modern `tools/call` on `server`, with `meta` merged into `_meta`.
Json tool_call(afd::mcp::StdioServer& server, const std::string& name, const Json& arguments,
               const Json& meta = Json::object()) {
    Json request_meta = modern_meta();
    if (meta.is_object()) {
        request_meta.update(meta);
    }
    const Json request{
        {"jsonrpc", "2.0"},
        {"id", 1},
        {"method", "tools/call"},
        {"params", {{"name", name}, {"arguments", arguments}, {"_meta", request_meta}}}};
    const auto out = server.handle_message(afd::wire::serialize(request));
    REQUIRE(out.has_value());
    const Json reply = Json::parse(*out);
    REQUIRE_MESSAGE(reply.contains("result"), reply.dump());
    const Json& result = reply.at("result");
    if (result.contains("structuredContent")) {
        return result.at("structuredContent");
    }
    return Json::parse(result.at("content").at(0).at("text").get<std::string>());
}
#endif

} // namespace idempotency_vectors

using namespace idempotency_vectors;

TEST_CASE("idempotency.json no longer lists C++ as a documented gap") {
    CHECK_FALSE(vectors().at("gaps").contains("cpp"));
    CHECK(meta_key() == "dev.afd/idempotencyKey");
    CHECK(meta_key() == afd::afd_idempotency_key_meta_key);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECLARATION (D1, D2)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("idempotency.json: declaration") {
    for (const auto& c : vectors().at("declaration").at("cases")) {
        CAPTURE(c.at("description").get<std::string>());
        const Json& command = c.at("command");
        afd::CommandDefinition definition{
            .name = "thing-do",
            .description = "Does a thing",
            .handler = [](const Json&, afd::CommandContext&) { return afd::success({}); },
            .mutation = command.value("mutation", false),
            .idempotency = support(command),
            .expose = {.mcp = true}};
        const Json tool = afd::command_to_mcp_tool(definition);
        const Json& expect = c.at("expect");
        const Json meta = tool.contains("_meta") && tool.at("_meta").contains("idempotency")
                              ? tool.at("_meta").at("idempotency")
                              : Json(nullptr);
        CHECK(meta == expect.at("metaIdempotency"));
        const Json hint =
            tool.contains("annotations") && tool.at("annotations").contains("idempotentHint")
                ? tool.at("annotations").at("idempotentHint")
                : Json(nullptr);
        CHECK(hint == expect.at("idempotentHint"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE KEY (K1 to K6)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("idempotency.json: key.form") {
    for (const auto& c : vectors().at("key").at("form")) {
        CAPTURE(c.at("description").get<std::string>());
        Json key = c.contains("key") ? c.at("key") : Json(nullptr);
        if (c.contains("repeat")) {
            std::string repeated;
            for (std::size_t i = 0; i < c.at("times").get<std::size_t>(); ++i) {
                repeated += c.at("repeat").get<std::string>();
            }
            key = repeated;
        }
        const bool valid = key.is_string() && afd::is_idempotency_key(key.get<std::string>());
        CHECK(valid == c.at("valid").get<bool>());
    }
}

TEST_CASE("idempotency.json: key.derived") {
    for (const auto& c : vectors().at("key").at("derived")) {
        const auto kind = c.at("kind").get<std::string>() == "batch"
                              ? afd::IdempotencyRequestKind::batch
                              : afd::IdempotencyRequestKind::pipeline;
        CHECK(afd::derive_idempotency_key(c.at("base").get<std::string>(), kind,
                                          c.at("index").get<std::size_t>()) ==
              c.at("expected").get<std::string>());
    }
}

namespace {

/// A registry whose `note-read` notes the key its handler reads, and can nest once.
struct DeliveryServer {
    std::shared_ptr<afd::CommandRegistry> registry = std::make_shared<afd::CommandRegistry>();
    std::vector<Json> seen;
    std::vector<Json> nested_seen;

    DeliveryServer() {
        auto* self = this;
        REQUIRE_FALSE(registry->register_command(afd::CommandDefinition{
            .name = "note-read",
            .description = "Reads a note",
            .input_schema = Json::parse(R"({"type":"object","properties":{
                "nest":{"type":"boolean"},"idempotencyKey":{"type":"string"}}})"),
            .handler =
                [self](const Json& input, afd::CommandContext& context) {
                    const Json key =
                        context.idempotency_key ? Json(*context.idempotency_key) : Json(nullptr);
                    if (input.contains("nest") && input.at("nest") == false) {
                        self->nested_seen.push_back(key);
                        return afd::success({{"nested", true}});
                    }
                    self->seen.push_back(key);
                    // K6: the same command once more through the registry, on this very context.
                    if (input.contains("nest") && input.at("nest") == true) {
                        (void)self->registry->execute("note-read", {{"nest", false}}, context);
                    }
                    return afd::success({{"key", key}});
                },
            .expose = {.mcp = true}}));
    }
};

} // namespace

TEST_CASE("idempotency.json: key.delivery") {
    for (const auto& c : vectors().at("key").at("delivery")) {
        CAPTURE(c.at("description").get<std::string>());
        DeliveryServer server;
        const bool has_key = c.contains("key");
        const Json meta = has_key ? Json{{meta_key(), c.at("key")}} : Json::object();
        const Json input = c.value("nested", false) ? Json{{"nest", true}} : Json::object();
        const std::string via = c.at("via").get<std::string>();
        Json value;
        const bool over_mcp = c.contains("kind") || via == "meta" || via == "meta-argument";
        if (over_mcp) {
#if AFD_HAS_MCP_STDIO
            auto made = afd::mcp::StdioServer::create(
                *server.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                   .default_timeout_ms = std::nullopt});
            REQUIRE(made);
            auto& stdio = **made;
            if (c.contains("kind")) {
                Json steps = Json::array();
                for (std::size_t i = 0; i < c.at("items").get<std::size_t>(); ++i) {
                    steps.push_back(Json{{"command", "note-read"}, {"input", Json::object()}});
                }
                value = c.at("kind") == "batch"
                            ? tool_call(stdio, "afd-batch", {{"commands", steps}}, meta)
                            : tool_call(stdio, "afd-pipe", {{"steps", steps}}, meta);
            } else if (via == "meta") {
                value = tool_call(stdio, "note-read", input, meta);
            } else {
                value = tool_call(stdio, "afd-call",
                                  {{"command", "note-read"}, {"input", input}, {"meta", meta}});
            }
#else
            MESSAGE("skipped: the case sends _meta, and this build has no MCP stdio server");
            continue;
#endif
        } else if (via == "context") {
            afd::CommandContext context;
            context.idempotency_key = c.at("key").get<std::string>();
            value = to_json(server.registry->execute("note-read", input, std::move(context)));
        } else {
            // `input`: a member named like the key is input, never the key.
            value = to_json(
                server.registry->execute("note-read", {{"idempotencyKey", c.at("key")}}, {}));
        }
        const Json& e = c.at("expect");
        if (e.contains("success")) {
            CHECK(member(value, {"success"}) == e.at("success"));
        }
        if (e.contains("code")) {
            CHECK(member(value, {"error", "code"}) == e.at("code"));
        }
        if (e.contains("handlerRuns")) {
            CHECK(server.seen.size() == e.at("handlerRuns").get<std::size_t>());
        }
        if (e.contains("detailsMeta")) {
            CHECK(member(value, {"error", "details", "meta"}) == e.at("detailsMeta"));
        }
        if (e.contains("handlerSeesKey")) {
            CHECK(Json(server.seen) == Json::array({e.at("handlerSeesKey")}));
        }
        if (e.contains("handlerSeesKeys")) {
            CHECK(Json(server.seen) == e.at("handlerSeesKeys"));
        }
        if (e.contains("nestedHandlerSeesKey")) {
            CHECK(Json(server.nested_seen) == Json::array({e.at("nestedHandlerSeesKey")}));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE ENGINE'S STEP (S1 to S13)
// ═══════════════════════════════════════════════════════════════════════════════

namespace {

/// The harness's store: the default one, with hooks to cancel a call while its key is reserved.
class HarnessStore final : public afd::IdempotencyStore {
public:
    afd::InMemoryIdempotencyStore inner;
    /// Fired by the next `reserve`, before it reserves (`cancelledDuringReserve`).
    afd::CancellationSource* cancel_on_reserve = nullptr;

    afd::IdempotencyReserveOutcome reserve(const std::string& scope,
                                           const afd::IdempotencyReservationRequest& request,
                                           std::int64_t now) override {
        if (cancel_on_reserve != nullptr) {
            cancel_on_reserve->cancel();
            cancel_on_reserve = nullptr;
        }
        return inner.reserve(scope, request, now);
    }
    void complete(const std::string& scope, const std::string& reservation,
                  const afd::IdempotencySettlement& settlement) override {
        inner.complete(scope, reservation, settlement);
    }
    void release(const std::string& scope, const std::string& reservation) override {
        inner.release(scope, reservation);
    }
    std::optional<afd::IdempotencyRecord> get(const std::string& scope, std::int64_t now) override {
        return inner.get(scope, now);
    }
};

/// One case's state: the clock, the handlers' count, the approval flag and the held handler.
struct Harness {
    std::shared_ptr<afd::ManualClock> clock = afd::fixed_clock(0);
    std::shared_ptr<HarnessStore> store = std::make_shared<HarnessStore>();
    std::mutex mutex;
    int starts = 0;
    bool approved = false;
    bool flaky_failed = false;
    /// Moves the clock past the call's deadline from inside the handler (`outlivesDeadline`).
    std::optional<std::int64_t> outlive_to;
#if AFD_ENABLE_THREADS
    /// A handler waits here while `hold` is set, until `released`.
    bool hold = false;
    bool held_started = false;
    bool released = false;
    std::condition_variable changed;
#endif
    std::shared_ptr<afd::CommandRegistry> registry;
};

int start(Harness& h) {
    const std::lock_guard lock(h.mutex);
    return ++h.starts;
}

/// order-place: `{ placed: n }`, n counted when the handler starts.
afd::CommandResult place(Harness& h) {
    const int placed = start(h);
#if AFD_ENABLE_THREADS
    {
        std::unique_lock lock(h.mutex);
        if (h.hold) {
            h.hold = false;
            h.held_started = true;
            h.changed.notify_all();
            h.changed.wait(lock, [&] { return h.released; });
        }
    }
#endif
    if (h.outlive_to) {
        h.clock->advance(static_cast<double>(*h.outlive_to - h.clock->wall_ms()));
        h.outlive_to.reset();
    }
    return afd::success({{"placed", placed}});
}

afd::CommandResult fail_with(const char* code, bool retryable) {
    return afd::failure(
        afd::create_error(code, "Failed", {.suggestion = "Do not", .retryable = retryable}));
}

afd::CommandHandler handler_for(Harness& h, const std::string& name) {
    Harness* harness = &h;
    if (name == "order-refuse") {
        return [harness](const Json&, afd::CommandContext&) {
            start(*harness);
            return fail_with("CONFLICT", false);
        };
    }
    if (name == "order-flaky") {
        return [harness](const Json&, afd::CommandContext&) {
            bool fail = false;
            {
                const std::lock_guard lock(harness->mutex);
                fail = !harness->flaky_failed;
                harness->flaky_failed = true;
                if (fail) {
                    ++harness->starts;
                }
            }
            return fail ? fail_with("TRANSIENT_ERROR", true) : place(*harness);
        };
    }
    if (name == "order-timeout") {
        return [harness](const Json&, afd::CommandContext&) {
            start(*harness);
            return fail_with("TIMEOUT", true);
        };
    }
    if (name == "order-throw") {
        return [harness](const Json&, afd::CommandContext&) -> afd::CommandResult {
            start(*harness);
#if IDEMPOTENCY_TEST_EXCEPTIONS
            throw std::runtime_error("boom");
#else
            return fail_with("UNREACHABLE", false);
#endif
        };
    }
    if (name == "order-claims-replay") {
        return [harness](const Json&, afd::CommandContext&) {
            afd::CommandResult result = place(*harness);
            afd::ResultMetadata metadata;
            metadata.extra = Json{{"idempotentReplay", true}, {"note", "kept"}};
            result.metadata = std::move(metadata);
            return result;
        };
    }
    // order-place, order-approve, order-set, order-note and order-task.
    return [harness](const Json&, afd::CommandContext&) { return place(*harness); };
}

/// The harness's approval step: admits `order-approve` when the case says it is approved.
afd::CommandMiddleware approval_step(Harness& h) {
    static const int tag = 0;
    Harness* harness = &h;
    return [harness](std::string_view name, const Json& input, afd::CommandContext& context,
                     const afd::Next& next) {
        if (name != "order-approve") {
            return next();
        }
        if (!harness->approved) {
            return afd::failure(
                afd::create_error("APPROVAL_REQUIRED", "Needs approval",
                                  {.suggestion = "Ask a person", .retryable = false}));
        }
        afd::detail::admit_approval(context, &tag, name, input, false);
        return next();
    };
}

const Json& step_setup() {
    return vectors().at("step").at("setup");
}

void build_registry(Harness& h) {
    const Json& setup = step_setup();
    afd::CommandRegistryOptions options{
        .middleware = {approval_step(h)},
        .clock = h.clock,
        .context_fields = {afd::ContextField{
            .name = "project", .meta = "dev.example/project", .schema = Json{{"type", "string"}}}},
        .idempotency = afd::IdempotencyOptions{
            .store = h.store,
            .ttl_ms = setup.at("options").at("ttlMs").get<std::int64_t>(),
            .lease_ms = setup.at("options").at("leaseMs").get<std::int64_t>()}};
    auto created = afd::CommandRegistry::create(std::move(options));
    REQUIRE(created);
    h.registry = std::move(*created);
    for (const auto& spec : setup.at("commands")) {
        const auto name = spec.at("name").get<std::string>();
        afd::CommandDefinition definition{.name = name,
                                          .description = spec.at("handler").get<std::string>(),
                                          .input_schema =
                                              Json::parse(R"({"type":"object","properties":{
                "sku":{"type":"string"},"count":{"type":"integer"}},"required":["sku"]})"),
                                          .handler = handler_for(h, name),
                                          .mutation = spec.value("mutation", false),
                                          .idempotency = support(spec),
                                          .expose = {.mcp = true}};
        if (spec.contains("approval")) {
            definition.approval = afd::ApprovalDecision::required;
        }
        REQUIRE_FALSE(h.registry->register_command(std::move(definition)));
    }
}

/// Put the case's seeded reservation in the store, as the step would have made it.
void seed(Harness& h, const Json& reservation) {
    const Json& setup = step_setup();
    afd::CommandContext context;
    context.actor = actor_of(setup.at("actors").at(reservation.at("actor").get<std::string>()));
    const auto principal = afd::detail::idempotency_principal(context);
    REQUIRE(principal);
    const auto scope =
        afd::detail::idempotency_scope(*principal, reservation.at("command").get<std::string>(),
                                       reservation.at("key").get<std::string>());
    REQUIRE(scope);
    const auto digest = afd::detail::idempotency_digest(Json::object(), reservation.at("input"));
    REQUIRE(digest);
    const auto made_at = reservation.at("madeAt").get<std::int64_t>();
    const auto outcome = h.store->reserve(
        *scope,
        {.digest = *digest,
         .reserved_at = made_at,
         .expires_at = made_at + setup.at("options").at("ttlMs").get<std::int64_t>(),
         .lease_ends_at = made_at + setup.at("options").at("leaseMs").get<std::int64_t>()},
        made_at);
    REQUIRE(outcome.reserved);
}

/// Check one call's result against its `expect`.
void check_call(const Json& value, const Json& e, const std::string& where) {
    CAPTURE(where);
    CAPTURE(value.dump());
    if (e.contains("items")) {
        const Json& items = e.at("items");
        REQUIRE(value.at("results").size() == items.size());
        for (std::size_t i = 0; i < items.size(); ++i) {
            const Json& result = value.at("results").at(i).at("result");
            CHECK(result.at("success") == items.at(i).at("success"));
            const bool replay = result.contains("metadata") &&
                                result.at("metadata").value("idempotentReplay", false);
            CHECK(replay == items.at(i).at("replay").get<bool>());
        }
        return;
    }
    if (e.contains("success")) {
        CHECK(member(value, {"success"}) == e.at("success"));
    }
    if (e.contains("data")) {
        CHECK(member(value, {"data"}) == e.at("data"));
    }
    if (e.contains("code")) {
        CHECK(member(value, {"error", "code"}) == e.at("code"));
    }
    if (e.contains("retryable")) {
        CHECK(member(value, {"error", "retryable"}) == e.at("retryable"));
    }
    if (e.contains("recovery")) {
        CHECK(member(value, {"error", "recovery"}) == e.at("recovery"));
    }
    if (e.contains("replay")) {
        const bool has_marker =
            value.contains("metadata") && value.at("metadata").contains("idempotentReplay");
        const bool replay = has_marker && value.at("metadata").at("idempotentReplay") == true;
        CHECK(replay == e.at("replay").get<bool>());
        if (!e.at("replay").get<bool>()) {
            CHECK_FALSE(has_marker);
        }
    }
    if (e.contains("metadata")) {
        for (const auto& [name, expected] : e.at("metadata").items()) {
            CHECK(member(value, {"metadata", name.c_str()}) == expected);
        }
    }
    if (e.contains("detailsMeta")) {
        CHECK(member(value, {"error", "details", "meta"}) == e.at("detailsMeta"));
    }
    if (e.contains("detailsReason")) {
        CHECK(member(value, {"error", "details", "reason"}) == e.at("detailsReason"));
    }
}

/// Why C++ skips `c`, or nothing when it runs it.
std::optional<std::string> skip_reason(const Json& c) {
    if (c.contains("engine") && c.at("engine") != engine) {
        return "the " + c.at("engine").get<std::string>() +
               " engine's (S7); C++'s engine waits for the handler";
    }
    if (c.contains("surface") && c.at("surface") != "two-stdio-connections") {
        return std::string("C++ has no HTTP server");
    }
    bool held = false;
    for (const auto& call : c.at("calls")) {
        if (call.value("asTask", false)) {
            return std::string("C++ has no MCP tasks");
        }
        if (call.contains("command") && call.at("command") == "order-throw" &&
            !IDEMPOTENCY_TEST_EXCEPTIONS) {
            return std::string("this build cannot throw");
        }
        held = held || call.value("heldInHandler", false);
    }
#if !AFD_ENABLE_THREADS
    if (held) {
        return std::string("holding a handler needs threads");
    }
#endif
#if !AFD_HAS_MCP_STDIO
    if (c.contains("surface")) {
        return std::string("this build has no MCP stdio server");
    }
#endif
    (void)held;
    return std::nullopt;
}

/// One in-process call of a case.
Json call_in_process(Harness& h, const Json& spec, afd::CancellationSource* cancellation) {
    const Json& actors = step_setup().at("actors");
    afd::CommandContext context;
    if (!spec.contains("actor")) {
        context.actor = actor_of(actors.at("agent"));
    } else if (!spec.at("actor").is_null()) {
        context.actor = actor_of(actors.at(spec.at("actor").get<std::string>()));
    }
    if (spec.contains("key")) {
        context.idempotency_key = spec.at("key").get<std::string>();
    }
    if (spec.contains("context")) {
        for (const auto& [name, value] : spec.at("context").items()) {
            context.extra[name] = value;
        }
    }
    if (spec.contains("timeoutMs")) {
        context.timeout_ms = spec.at("timeoutMs").get<double>();
    }
    if (cancellation != nullptr) {
        context.cancellation = cancellation->token();
    }
    if (spec.value("kind", "") == "batch") {
        return Json(h.registry->execute_batch(Json{{"commands", spec.at("commands")}}, context));
    }
    // An input the canonical JSON refuses: an integer JavaScript cannot hold exactly.
    const Json input = spec.value("inputNotCanonical", false)
                           ? Json{{"sku", "a"}, {"count", std::uint64_t{9007199254740993ULL}}}
                           : spec.at("input");
    return to_json(
        h.registry->execute(spec.at("command").get<std::string>(), input, std::move(context)));
}

} // namespace

TEST_CASE("idempotency.json: step") {
    for (const auto& c : vectors().at("step").at("cases")) {
        const std::string description = c.at("description").get<std::string>();
        CAPTURE(description);
        if (const auto reason = skip_reason(c)) {
            MESSAGE("skipped '" << description << "': " << *reason);
            continue;
        }
        Harness h;
        build_registry(h);
        if (c.contains("seed") && c.at("seed").contains("reservation")) {
            seed(h, c.at("seed").at("reservation"));
        }

#if AFD_HAS_MCP_STDIO
        std::vector<std::unique_ptr<afd::mcp::StdioServer>> connections;
        if (c.contains("surface")) {
            for (int i = 0; i < 2; ++i) {
                auto made = afd::mcp::StdioServer::create(
                    *h.registry, {.tool_strategy = afd::mcp::ToolStrategy::individual,
                                  .clock = h.clock,
                                  .default_timeout_ms = std::nullopt});
                REQUIRE(made);
                connections.push_back(std::move(*made));
            }
        }
#endif
        const auto call = [&](const Json& spec, afd::CancellationSource* cancellation) -> Json {
#if AFD_HAS_MCP_STDIO
            if (!connections.empty()) {
                const Json meta =
                    spec.contains("key") ? Json{{meta_key(), spec.at("key")}} : Json::object();
                return tool_call(*connections.at(spec.at("connection").get<std::size_t>() - 1),
                                 spec.at("command").get<std::string>(), spec.at("input"), meta);
            }
#endif
            return call_in_process(h, spec, cancellation);
        };

#if AFD_ENABLE_THREADS
        std::thread held;
        Json held_value;
        const Json* held_expect = nullptr;
        const auto release_held = [&]() {
            {
                const std::lock_guard lock(h.mutex);
                h.released = true;
            }
            h.changed.notify_all();
            held.join();
            check_call(held_value, *held_expect, "the held call");
            held_expect = nullptr;
        };
#endif
        std::size_t index = 0;
        for (const auto& spec : c.at("calls")) {
            const std::string where = "call " + std::to_string(++index);
            if (spec.contains("at")) {
                h.clock->set(spec.at("at").get<std::int64_t>());
            }
            h.approved = spec.value("approved", false);
#if AFD_ENABLE_THREADS
            if (held.joinable() && !spec.value("whileFirstIsHeld", false)) {
                // Every call made while the first was held has returned: let it go and settle.
                release_held();
            }
            if (spec.value("heldInHandler", false)) {
                {
                    const std::lock_guard lock(h.mutex);
                    h.hold = true;
                    h.held_started = false;
                    h.released = false;
                }
                held_expect = &spec.at("expect");
                held = std::thread([&, spec]() { held_value = call(spec, nullptr); });
                std::unique_lock lock(h.mutex);
                h.changed.wait(lock, [&] { return h.held_started; });
                continue;
            }
#endif
            if (spec.value("outlivesDeadline", false)) {
                // The handler returns just past the call's deadline (spec/vectors/README.md).
                h.outlive_to = h.clock->wall_ms() + spec.at("timeoutMs").get<std::int64_t>() + 1;
            }
            if (spec.value("cancelledDuringReserve", false)) {
                afd::CancellationSource cancellation;
                h.store->cancel_on_reserve = &cancellation;
                check_call(call(spec, &cancellation), spec.at("expect"), where);
                continue;
            }
            check_call(call(spec, nullptr), spec.at("expect"), where);
        }
#if AFD_ENABLE_THREADS
        if (held.joinable()) {
            release_held();
        }
#endif
        CHECK(h.starts == c.at("handlerRuns").get<int>());
    }
}

TEST_CASE("idempotency.json: step.options") {
    for (const auto& c : vectors().at("step").at("options")) {
        CAPTURE(c.at("description").get<std::string>());
        const afd::IdempotencyOptions options{.store = nullptr,
                                              .ttl_ms = c.at("ttlMs").get<std::int64_t>(),
                                              .lease_ms = c.at("leaseMs").get<std::int64_t>()};
        const auto problem =
            afd::check_idempotency_options(options, c.at("defaultTimeoutMs").get<double>());
        CHECK(problem.has_value() != c.at("valid").get<bool>());
        if (problem) {
            CHECK(problem->find("ttl_ms") != std::string::npos);
        }
#if AFD_HAS_MCP_STDIO
        // The server with that default deadline, over a registry with the step.
        auto registry = afd::CommandRegistry::create({.idempotency = options});
        if (!registry) {
            // A registry alone has no default deadline, so it refuses only a ttl within the lease.
            CHECK_FALSE(c.at("valid").get<bool>());
            continue;
        }
        const auto server = afd::mcp::StdioServer::create(
            **registry, {.default_timeout_ms = c.at("defaultTimeoutMs").get<double>()});
        CHECK(server.has_value() == c.at("valid").get<bool>());
        if (!server) {
            CHECK(server.error().find("ttl_ms") != std::string::npos);
        }
#endif
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRYING (R1, R2, S6, S11)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("idempotency.json: retry") {
    for (const auto& c : vectors().at("retry").at("cases")) {
        const std::string description = c.at("description").get<std::string>();
        CAPTURE(description);
        if (c.value("asTask", false)) {
            MESSAGE("skipped '" << description << "': C++ has no MCP tasks");
            continue;
        }
        int runs = 0;
        const std::string first_failure = c.value("handlerFailsWith", "TRANSIENT_ERROR");
        const afd::CommandHandler handler = [&](const Json&, afd::CommandContext&) {
            ++runs;
            if (runs == 1) {
                return afd::failure(afd::create_error(first_failure, "Failed once",
                                                      {.suggestion = "Retry", .retryable = true}));
            }
            return afd::success({{"runs", runs}});
        };
        // The middleware's defaults decide; only its waits are shortened.
        auto retry = afd::create_retry_middleware(
            {.retry_delay_ms = 0, .retry_mutations = c.value("retryMutations", false)});
        REQUIRE(retry);
        afd::CommandContext context;
        context.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "advisor"};
        if (c.at("key").get<bool>()) {
            context.idempotency_key = "k1";
        }
        afd::CommandResult result;
        if (c.value("declarationUnreadable", false)) {
            // Outside the registry, the middleware cannot read the declaration.
            const afd::Next next = [&]() { return handler(Json::object(), context); };
            result = (*retry)("thing-do", Json::object(), context, next);
        } else {
            afd::CommandRegistryOptions options{.middleware = {*retry}};
            if (c.value("withStep", false)) {
                options.idempotency = afd::IdempotencyOptions{};
            }
            afd::CommandRegistry registry(std::move(options));
            const Json& command = c.at("command");
            REQUIRE_FALSE(registry.register_command({.name = "thing-do",
                                                     .description = "Does a thing",
                                                     .handler = handler,
                                                     .mutation = command.value("mutation", false),
                                                     .idempotency = support(command)}));
            result = registry.execute("thing-do", Json::object(), context);
        }
        const Json& e = c.at("expect");
        CHECK(result.success == e.at("success").get<bool>());
        if (e.contains("code")) {
            REQUIRE(result.error);
            CHECK(result.error->code == e.at("code").get<std::string>());
        }
        CHECK(runs == e.at("handlerRuns").get<int>());
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE TIMEOUT RECOVERY (R3)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("idempotency.json: timeoutRecovery") {
    for (const auto& c : vectors().at("timeoutRecovery").at("cases")) {
        CAPTURE(c.at("description").get<std::string>());
        auto clock = afd::fixed_clock(0);
        afd::CommandRegistryOptions options{.clock = clock};
        if (c.value("withStep", true)) {
            options.idempotency = afd::IdempotencyOptions{};
        }
        afd::CommandRegistry registry(std::move(options));
        const Json& command = c.at("command");
        REQUIRE_FALSE(registry.register_command(
            {.name = "thing-do",
             .description = "Does a thing",
             // Outlives the deadline: returns only once the clock is past it.
             .handler =
                 [clock](const Json&, afd::CommandContext&) {
                     clock->advance(21);
                     return afd::success({});
                 },
             .mutation = command.value("mutation", false),
             .idempotency = support(command)}));
        afd::CommandContext context;
        context.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "advisor"};
        context.timeout_ms = 20;
        if (c.at("key").get<bool>()) {
            context.idempotency_key = "k1";
        }
        const Json result = to_json(registry.execute("thing-do", Json::object(), context));
        const Json& e = c.at("expect");
        CHECK(result.at("error").at("code") == e.at("code"));
        CHECK(result.at("error").at("retryable") == e.at("retryable"));
        const Json recovery = result.at("error").contains("recovery")
                                  ? result.at("error").at("recovery")
                                  : Json(nullptr);
        CHECK(recovery == e.at("recovery"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE JOURNAL
// ═══════════════════════════════════════════════════════════════════════════════

namespace {

struct Journaled {
    std::shared_ptr<afd::MemoryJournalSink> sink = std::make_shared<afd::MemoryJournalSink>();
    std::vector<Json> seen;
    std::shared_ptr<afd::CommandRegistry> registry;

    Journaled() {
        registry = std::make_shared<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {afd::create_journal_middleware(sink)}});
        auto* self = this;
        REQUIRE_FALSE(registry->register_command(
            {.name = "note-add",
             .description = "Adds a note",
             .handler = [self](const Json&, afd::CommandContext& context) {
                 self->seen.push_back(context.idempotency_key ? Json(*context.idempotency_key)
                                                              : Json(nullptr));
                 return afd::success({{"added", true}});
             }}));
    }
};

} // namespace

TEST_CASE("idempotency.json: journal") {
    for (const auto& c : vectors().at("journal").at("cases")) {
        CAPTURE(c.at("description").get<std::string>());
        Journaled journaled;
        afd::CommandContext context;
        if (c.contains("key")) {
            context.idempotency_key = c.at("key").get<std::string>();
        }
        if (c.value("kind", "") == "batch") {
            Json commands = Json::array();
            for (std::size_t i = 0; i < c.at("items").get<std::size_t>(); ++i) {
                commands.push_back(Json{{"command", "note-add"}, {"input", Json::object()}});
            }
            (void)journaled.registry->execute_batch(Json{{"commands", commands}}, context);
        } else {
            (void)journaled.registry->execute("note-add", Json::object(), context);
        }
        auto read = journaled.sink->read();
        REQUIRE(read);
        const std::vector<afd::JournalEntry> entries = *read;
        const Json& e = c.at("expect");
        if (e.contains("entryIdempotencyKey")) {
            REQUIRE(entries.size() == 1);
            const Json recorded = entries.front().idempotency_key
                                      ? Json(*entries.front().idempotency_key)
                                      : Json(nullptr);
            CHECK(recorded == e.at("entryIdempotencyKey"));
            CHECK(Json(entries.front()).contains("idempotencyKey") ==
                  !e.at("entryIdempotencyKey").is_null());
        }
        if (e.contains("entryIdempotencyKeys")) {
            Json keys = Json::array();
            for (const auto& entry : entries) {
                keys.push_back(entry.idempotency_key ? Json(*entry.idempotency_key)
                                                     : Json(nullptr));
            }
            CHECK(keys == e.at("entryIdempotencyKeys"));
        }
        if (e.value("digestHashHasMember", false)) {
            // spec/journal.md's formula, on a context whose other members are known: the journal
            // called directly with `redact`, so it records outside a registry.
            auto alone = std::make_shared<afd::MemoryJournalSink>();
            const auto middleware = afd::create_journal_middleware(
                alone, {.redact = [](afd::JournalRecord record) { return record; }});
            afd::CommandContext direct;
            direct.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "advisor"};
            direct.surface = afd::Interface::mcp;
            direct.trace_id = "t1";
            direct.idempotency_key = c.at("key").get<std::string>();
            const afd::Next next = []() { return afd::success({}); };
            (void)middleware("note-add", Json::object(), direct, next);
            auto recorded = alone->read();
            REQUIRE(recorded);
            REQUIRE(recorded->size() == 1);
            // The journal sets its recording clock and random source on the context.
            const Json hashed{{"actor", {{"kind", "agent"}, {"id", "advisor"}}},
                              {"idempotencyKey", c.at("key")},
                              {"interface", "mcp"},
                              {"keys", Json::array({"clock", "random"})},
                              {"traceId", "t1"}};
            CHECK(recorded->front().idempotency_key == c.at("key").get<std::string>());
            CHECK(recorded->front().context_digest.hash ==
                  "sha256:" + afd::detail::sha256_hex(afd::wire::serialize(hashed)));
        }
        if (c.value("replay", false)) {
            Journaled target;
            const auto report = afd::replay_journal(*target.registry, entries);
            if (e.contains("handlerSeesKey")) {
                CHECK(Json(target.seen) == Json::array({e.at("handlerSeesKey")}));
            }
            if (e.contains("handlerSeesKeys")) {
                CHECK(Json(target.seen) == e.at("handlerSeesKeys"));
            }
            if (e.contains("status")) {
                REQUIRE(report.entries.size() == 1);
                CHECK(afd::replay_status_name(report.entries.front().status) ==
                      e.at("status").get<std::string>());
            }
        }
    }
}
