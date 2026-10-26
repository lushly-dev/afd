// Clock, random and actor on CommandContext (packages/core/src/clock.ts and actor.ts, #271, #274).
#include "afd/afd.hpp"

#include <memory>
#include <optional>
#include <string>
#include <type_traits>
#include <vector>

#include <doctest.h>

namespace {

void add(afd::CommandRegistry& registry, afd::CommandDefinition command) {
    const auto error = registry.register_command(std::move(command));
    REQUIRE_MESSAGE(!error, error.value_or(""));
}

std::vector<double> sequence(const std::string& seed, int count) {
    afd::SeededRandom random(seed);
    std::vector<double> values;
    for (int i = 0; i < count; ++i) {
        values.push_back(random.next());
    }
    return values;
}

} // namespace

TEST_CASE("SeededRandom matches TypeScript's seededRandom bit for bit") {
    // Golden values from packages/core/src/clock.test.ts.
    afd::SeededRandom random("abc");
    CHECK(random.seed() == "abc");
    CHECK(random.next() == 0.5166419988963753);
    CHECK(random.next() == 0.6596221292857081);
    CHECK(random.next() == 0.0018796597141772509);
    CHECK(afd::SeededRandom("").next() == 0.6112444521859288);
}

TEST_CASE("SeededRandom repeats for a seed, differs between seeds and stays in [0, 1)") {
    CHECK(sequence("replay-1", 20) == sequence("replay-1", 20));
    CHECK(sequence("replay-1", 20) != sequence("replay-2", 20));
    // The seed is hashed as UTF-8 bytes.
    CHECK(sequence("\xC3\xA9", 20) != sequence("e", 20));
    for (const double value : sequence("range", 10000)) {
        REQUIRE(value >= 0.0);
        REQUIRE(value < 1.0);
    }
}

TEST_CASE("SystemRandom is unseeded and in [0, 1)") {
    afd::SystemRandom random;
    CHECK_FALSE(random.seed().has_value());
    const double value = random.next();
    CHECK(value >= 0.0);
    CHECK(value < 1.0);
}

TEST_CASE("fixed_clock stops at an instant and moves only when told to") {
    const auto clock = afd::fixed_clock(1767225600000); // 2026-01-01T00:00:00Z
    CHECK(clock->wall_ms() == 1767225600000);
    clock->advance(1000);
    CHECK(clock->wall_ms() == 1767225601000);
    CHECK(clock->steady_ms() == 1000);
    clock->set(0);
    CHECK(clock->wall_ms() == 0);
    CHECK(clock->steady_ms() == 1000);
    CHECK(afd::fixed_clock()->wall_ms() == 0);
}

TEST_CASE("actor kinds and actors round-trip and validate as in TypeScript") {
    REQUIRE(afd::actor_kinds.size() == 5);
    for (const auto kind : afd::actor_kinds) {
        CHECK(afd::parse_actor_kind(afd::actor_kind_name(kind)) == kind);
        CHECK(afd::is_actor_kind(afd::Json(kind)));
    }
    CHECK(afd::Json(afd::ActorKind::test) == "test");
    CHECK_FALSE(afd::parse_actor_kind("robot").has_value());
    CHECK_FALSE(afd::is_actor_kind(afd::Json(1)));

    const afd::Actor actor{
        .kind = afd::ActorKind::agent, .label = "Assistant", .on_behalf_of = "user-1"};
    const afd::Json wire = actor;
    CHECK(wire == afd::Json{{"kind", "agent"}, {"label", "Assistant"}, {"onBehalfOf", "user-1"}});
    const auto parsed = afd::Actor::from_json(wire);
    REQUIRE(parsed.has_value());
    CHECK(parsed->kind == afd::ActorKind::agent);
    CHECK_FALSE(parsed->id.has_value());
    CHECK(parsed->on_behalf_of == "user-1");
    CHECK_FALSE(afd::Actor::from_json(afd::Json{{"kind", "robot"}}).has_value());

    CHECK(afd::is_actor(wire));
    CHECK(afd::is_actor(afd::Json{{"kind", "human"}, {"extra", 1}}));
    CHECK_FALSE(afd::is_actor(afd::Json{{"kind", "robot"}}));
    CHECK_FALSE(afd::is_actor(afd::Json{{"kind", "human"}, {"id", 7}}));
    CHECK_FALSE(afd::is_actor(afd::Json::object()));
    CHECK_FALSE(afd::is_actor(afd::Json::array()));
}

TEST_CASE("with_context_defaults fills what the context lacks and keeps what it has") {
    const auto filled = afd::with_context_defaults({});
    CHECK(filled.clock != nullptr);
    CHECK(filled.random != nullptr);
    CHECK_FALSE(filled.actor.has_value());

    const auto clock = afd::fixed_clock(5);
    const auto random = std::make_shared<afd::SeededRandom>("abc");
    const auto defaulted = afd::with_context_defaults(
        {}, {.clock = clock, .random = random, .actor = afd::Actor{.kind = afd::ActorKind::test}});
    CHECK(defaulted.clock == clock);
    CHECK(defaulted.random == random);
    CHECK(defaulted.actor->kind == afd::ActorKind::test);

    afd::CommandContext own;
    own.actor = afd::Actor{.kind = afd::ActorKind::script};
    own.clock = afd::fixed_clock(9);
    const auto kept = afd::with_context_defaults(
        own, {.clock = clock, .actor = afd::Actor{.kind = afd::ActorKind::test}});
    CHECK(kept.clock == own.clock);
    CHECK(kept.actor->kind == afd::ActorKind::script);
}

TEST_CASE("the registry gives handlers its clock and random, and stamps the actor kind") {
    const auto clock = afd::fixed_clock(1767225600000);
    const auto random = std::make_shared<afd::SeededRandom>("abc");
    afd::CommandRegistry registry({.clock = clock, .random = random});
    add(registry, {.name = "time-read",
                   .description = "Read the clock and a random number",
                   .handler = [](const afd::Json&, afd::CommandContext& context) {
                       return afd::success(afd::Json{{"now", context.clock->wall_ms()},
                                                     {"random", context.random->next()}});
                   }});

    const auto anonymous = registry.execute("time-read", afd::Json::object());
    REQUIRE(anonymous.success);
    CHECK(anonymous.data->at("now") == 1767225600000);
    CHECK(anonymous.data->at("random") == 0.5166419988963753);
    CHECK_FALSE(anonymous.metadata->actor_kind.has_value());
    CHECK_FALSE(afd::Json(anonymous).at("metadata").contains("actorKind"));

    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "secret-id"};
    context.clock = afd::fixed_clock(42);
    const auto called = registry.execute("time-read", afd::Json::object(), context);
    CHECK(called.data->at("now") == 42); // the caller's clock wins
    CHECK(called.metadata->actor_kind == afd::ActorKind::agent);
    const afd::Json metadata = afd::Json(called).at("metadata");
    CHECK(metadata.at("actorKind") == "agent");
    // Only the kind is reported, never the id.
    CHECK(metadata.dump().find("secret-id") == std::string::npos);
}

TEST_CASE("the registry times the handler with the context clock") {
    const auto clock = afd::fixed_clock();
    afd::CommandContext context;
    context.clock = clock;
    afd::CommandRegistry timed;
    add(timed, {.name = "time-wait",
                .description = "Advance a manual clock",
                .handler = [clock](const afd::Json&, afd::CommandContext&) {
                    clock->advance(25);
                    return afd::success(nullptr);
                }});
    CHECK(timed.execute("time-wait", afd::Json::object(), context).metadata->execution_time_ms ==
          25);
}

TEST_CASE("middleware can refine the actor before the kind is stamped") {
    afd::CommandRegistry registry;
    registry.use([](std::string_view, const afd::Json&, afd::CommandContext& context,
                    const afd::Next& next) {
        context.actor = afd::Actor{.kind = afd::ActorKind::service, .on_behalf_of = "user-1"};
        return next();
    });
    add(registry, {.name = "actor-read",
                   .description = "Read the actor",
                   .handler = [](const afd::Json&, afd::CommandContext& context) {
                       return afd::success(afd::Json(*context.actor));
                   }});
    const auto result = registry.execute("actor-read", afd::Json::object());
    CHECK(result.data->at("onBehalfOf") == "user-1");
    CHECK(result.metadata->actor_kind == afd::ActorKind::service);
}

TEST_CASE("DirectClient calls as a human unless the context or its options say otherwise") {
    auto registry = std::make_shared<afd::CommandRegistry>();
    add(*registry, {.name = "actor-read",
                    .description = "Read the actor",
                    .handler = [](const afd::Json&, afd::CommandContext& context) {
                        return afd::success(afd::Json(*context.actor));
                    }});
    const afd::DirectClient human(registry);
    const auto result = human.call("actor-read");
    CHECK(result.data == afd::Json{{"kind", "human"}});
    CHECK(result.metadata->actor_kind == afd::ActorKind::human);

    const afd::DirectClient agent(registry, {.actor = {.kind = afd::ActorKind::agent}});
    CHECK(agent.call("actor-read").metadata->actor_kind == afd::ActorKind::agent);

    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::test};
    CHECK(agent.call("actor-read", afd::Json::object(), context).metadata->actor_kind ==
          afd::ActorKind::test);
}

TEST_CASE("an unknown actorKind on the wire stays in extra") {
    const auto metadata = afd::ResultMetadata::from_json(afd::Json{{"actorKind", "robot"}});
    REQUIRE(metadata.has_value());
    CHECK_FALSE(metadata->actor_kind.has_value());
    CHECK(metadata->extra == afd::Json{{"actorKind", "robot"}});
    CHECK(afd::Json(*metadata) == afd::Json{{"actorKind", "robot"}});
}

TEST_CASE("actor, clock and random reach batch, pipeline and stream sub-contexts") {
    struct Seen {
        std::optional<afd::ActorKind> kind;
        std::shared_ptr<const afd::Clock> clock;
        std::shared_ptr<afd::RandomSource> random;
    };
    std::vector<Seen> seen;
    afd::CommandRegistry registry;
    add(registry,
        {.name = "context-read",
         .description = "Record the context",
         .handler = [&seen](const afd::Json&, afd::CommandContext& context) {
             seen.push_back({context.actor ? std::optional(context.actor->kind) : std::nullopt,
                             context.clock, context.random});
             return afd::success(nullptr);
         }});
    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::script};
    context.clock = afd::fixed_clock(7);
    context.random = std::make_shared<afd::SeededRandom>("abc");

    (void)registry.execute_batch(
        afd::create_batch_request({{.command = "context-read", .input = afd::Json::object()},
                                   {.command = "context-read", .input = afd::Json::object()}}),
        context);
    (void)registry.execute_pipeline(
        afd::create_pipeline({{.command = "context-read"}, {.command = "context-read"}}), context);
    (void)registry.execute_stream("context-read", afd::Json::object(), context);
    REQUIRE(seen.size() == 5);
    for (const auto& entry : seen) {
        CHECK(entry.kind == afd::ActorKind::script);
        CHECK(entry.clock == context.clock);
        CHECK(entry.random == context.random);
    }
}

TEST_CASE("DirectClient passes a configured clock and random, and its actor to pipe steps") {
    auto registry = std::make_shared<afd::CommandRegistry>(
        afd::CommandRegistryOptions{.clock = afd::fixed_clock(1)});
    std::vector<afd::Json> seen;
    add(*registry, {.name = "context-read",
                    .description = "Record the context",
                    .handler = [&seen](const afd::Json&, afd::CommandContext& context) {
                        seen.push_back({{"now", context.clock->wall_ms()},
                                        {"actor", *context.actor},
                                        {"seed", context.random->seed().value_or("")}});
                        return afd::success(nullptr);
                    }});

    // Unconfigured: the registry's clock applies.
    (void)afd::DirectClient(registry).call("context-read");
    REQUIRE(seen.size() == 1);
    CHECK(seen[0]["now"] == 1);

    const afd::DirectClient client(registry,
                                   {.actor = {.kind = afd::ActorKind::agent, .label = "Assistant"},
                                    .clock = afd::fixed_clock(99),
                                    .random = std::make_shared<afd::SeededRandom>("abc")});
    (void)client.pipe(
        afd::create_pipeline({{.command = "context-read"}, {.command = "context-read"}}));
    REQUIRE(seen.size() == 3);
    for (std::size_t i = 1; i < seen.size(); ++i) {
        CHECK(seen[i]["now"] == 99);
        CHECK(seen[i]["seed"] == "abc");
        CHECK(seen[i]["actor"] == afd::Json{{"kind", "agent"}, {"label", "Assistant"}});
    }
}

TEST_CASE("CommandRegistryOptions::actor is the default actor") {
    afd::CommandRegistry registry({.actor = afd::Actor{.kind = afd::ActorKind::agent}});
    add(registry,
        {.name = "actor-read",
         .description = "Read the actor",
         .handler = [](const afd::Json&, afd::CommandContext&) { return afd::success(nullptr); }});
    CHECK(registry.execute("actor-read", afd::Json::object()).metadata->actor_kind ==
          afd::ActorKind::agent);
    afd::CommandContext context;
    context.actor = afd::Actor{.kind = afd::ActorKind::human};
    CHECK(registry.execute("actor-read", afd::Json::object(), context).metadata->actor_kind ==
          afd::ActorKind::human);
}

TEST_CASE("a clock moved backward does not report a negative execution time") {
    const auto clock = afd::fixed_clock(1000);
    afd::CommandRegistry registry({.clock = clock});
    add(registry, {.name = "time-rewind",
                   .description = "Move the clock backward",
                   .handler = [clock](const afd::Json&, afd::CommandContext&) {
                       clock->advance(-50);
                       return afd::success(nullptr);
                   }});
    CHECK(registry.execute("time-rewind", afd::Json::object()).metadata->execution_time_ms == 0);
}

TEST_CASE("a non-string actorKind stays in extra, and SeededRandom takes no numeric seed") {
    const auto metadata = afd::ResultMetadata::from_json(afd::Json{{"actorKind", 3}});
    REQUIRE(metadata.has_value());
    CHECK_FALSE(metadata->actor_kind.has_value());
    CHECK(metadata->extra == afd::Json{{"actorKind", 3}});
    static_assert(!std::is_constructible_v<afd::SeededRandom, int>);
    static_assert(std::is_constructible_v<afd::SeededRandom, const char*>);
}
