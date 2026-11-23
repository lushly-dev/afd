// The language-neutral vectors in spec/vectors/app-calls.json: app-to-app calls and the `apps`
// exposure flag (spec/command-metadata.md, "App-to-app calls"; Loam phase 5, step 0b; #1513).
#include "afd/afd.hpp"

#include <algorithm>
#include <fstream>
#include <iterator>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

#include <doctest.h>

namespace app_calls {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

afd::Interface parse_interface(const std::string& name) {
    if (name == "palette") {
        return afd::Interface::palette;
    }
    if (name == "mcp") {
        return afd::Interface::mcp;
    }
    if (name == "agent") {
        return afd::Interface::agent;
    }
    if (name == "cli") {
        return afd::Interface::cli;
    }
    if (name == "apps") {
        return afd::Interface::apps;
    }
    FAIL("unknown interface: " << name);
    return afd::Interface::agent;
}

afd::ExposeOptions parse_expose(const afd::Json& value) {
    afd::ExposeOptions expose = afd::default_expose();
    if (value.is_null()) {
        return expose;
    }
    if (const auto it = value.find("palette"); it != value.end()) {
        expose.palette = it->get<bool>();
    }
    if (const auto it = value.find("mcp"); it != value.end()) {
        expose.mcp = it->get<bool>();
    }
    if (const auto it = value.find("agent"); it != value.end()) {
        expose.agent = it->get<bool>();
    }
    if (const auto it = value.find("cli"); it != value.end()) {
        expose.cli = it->get<bool>();
    }
    if (const auto it = value.find("apps"); it != value.end()) {
        expose.apps = it->get<bool>();
    }
    return expose;
}

std::shared_ptr<afd::CommandRegistry> build_registry(const afd::Json& vectors,
                                                     const std::string& grant_mode) {
    std::map<std::string, std::vector<std::string>> grants;
    for (const auto& [caller, names] : vectors.at("registry").at("grants").items()) {
        grants[caller] = names.get<std::vector<std::string>>();
    }
    afd::CommandRegistryOptions options;
    if (grant_mode == "grants") {
        options.call_grant = [grants = std::move(grants)](std::string_view command,
                                                          const afd::CommandContext& context) {
            if (!context.extra.is_object()) {
                return false;
            }
            const auto caller = context.extra.find("caller");
            if (caller == context.extra.end() || !caller->is_string()) {
                return false;
            }
            const auto found = grants.find(caller->get<std::string>());
            if (found == grants.end()) {
                return false;
            }
            return std::find(found->second.begin(), found->second.end(), std::string(command)) !=
                   found->second.end();
        };
    } else if (grant_mode == "throws") {
#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
        options.call_grant = [](std::string_view, const afd::CommandContext&) -> bool {
            throw std::runtime_error("the grant store is unreachable");
        };
#else
        options.call_grant = [](std::string_view, const afd::CommandContext&) -> bool {
            return false;
        };
#endif
    } else if (grant_mode != "none") {
        FAIL("unknown grant mode: " << grant_mode);
    }

    auto registry = std::make_shared<afd::CommandRegistry>(std::move(options));
    const auto& input_schema = vectors.at("registry").at("input");
    for (const auto& entry : vectors.at("registry").at("commands")) {
        const std::string name = entry.at("name").get<std::string>();
        afd::CommandDefinition def{
            .name = name,
            .description = "The fixture command " + name,
            .input_schema = input_schema,
            .handler =
                [name](const afd::Json& input, afd::CommandContext&) {
                    const afd::Json by =
                        input.is_object() && input.contains("by") ? input.at("by") : afd::Json(1);
                    return afd::success(afd::Json{{"command", name}, {"by", by}});
                },
            .expose = parse_expose(entry.at("expose")),
        };
        REQUIRE_FALSE(registry->register_command(std::move(def)).has_value());
    }
    return registry;
}

afd::CommandContext make_context(const afd::Json& holder) {
    afd::CommandContext context;
    if (const auto it = holder.find("interface"); it != holder.end() && it->is_string()) {
        context.surface = parse_interface(it->get<std::string>());
    }
    if (const auto it = holder.find("caller"); it != holder.end() && it->is_string()) {
        context.extra["caller"] = it->get<std::string>();
    }
    return context;
}

void check_result(const std::string& label, const afd::CommandResult& result,
                  const afd::Json& expected, const afd::Json& refusal) {
    const afd::Json actual(result);
    if (expected.value("refused", false)) {
        CHECK_MESSAGE(actual.at("success") == false, label);
        CHECK_MESSAGE(actual.at("error") == refusal, label);
        CHECK_MESSAGE(!actual.contains("data"), label);
    } else if (expected.contains("code")) {
        CHECK_MESSAGE(actual.at("success") == false, label);
        CHECK_MESSAGE(actual.at("error").at("code") == expected.at("code"), label);
    } else {
        CHECK_MESSAGE(actual.at("success") == true, label);
        CHECK_MESSAGE(actual.at("data") == expected.at("data"), label);
    }
}

} // namespace app_calls

TEST_CASE("app-calls.json: refusal code and no language gaps") {
    const auto vectors = app_calls::load("app-calls.json");
    CHECK(vectors.at("gaps").empty());
    CHECK(vectors.at("refusal").at("code").get<std::string>() ==
          afd::error_codes::CALL_NOT_GRANTED);
    CHECK(afd::Json(afd::call_not_granted()) == vectors.at("refusal"));
    CHECK_FALSE(afd::default_expose().apps);
    CHECK_FALSE(afd::is_exposed_to(afd::default_expose(), afd::Interface::apps));
}

TEST_CASE("app-calls.json: exposure cases") {
    const auto vectors = app_calls::load("app-calls.json");
    for (const auto& item : vectors.at("exposure")) {
        const std::string label = item.at("description").get<std::string>();
        const afd::ExposeOptions expose = app_calls::parse_expose(item.at("expose"));
        for (const auto& [surface, expected] : item.at("exposed").items()) {
            CHECK_MESSAGE(afd::is_exposed_to(expose, app_calls::parse_interface(surface)) ==
                              expected.get<bool>(),
                          label << ": " << surface);
        }
    }
}

TEST_CASE("app-calls.json: call cases") {
    const auto vectors = app_calls::load("app-calls.json");
    std::size_t checked = 0;
    for (const auto& item : vectors.at("calls")) {
        const std::string label = item.at("description").get<std::string>();
        const auto& call = item.at("call");
        auto registry = app_calls::build_registry(vectors, item.at("grant").get<std::string>());
        const afd::CommandResult result = registry->execute(
            call.at("name").get<std::string>(), call.at("input"), app_calls::make_context(call));
        app_calls::check_result(label, result, item.at("expect"), vectors.at("refusal"));
        ++checked;
    }
    CHECK(checked > 0);
}

TEST_CASE("app-calls.json: batch cases") {
    const auto vectors = app_calls::load("app-calls.json");
    for (const auto& item : vectors.at("batches")) {
        const std::string label = item.at("description").get<std::string>();
        auto registry = app_calls::build_registry(vectors, item.at("grant").get<std::string>());
        afd::Json request = {{"commands", afd::Json::array()}};
        for (const auto& entry : item.at("items")) {
            request["commands"].push_back(
                {{"command", entry.at("command")}, {"input", entry.at("input")}});
        }
        if (item.contains("requestContext")) {
            request["context"] = item.at("requestContext");
        }
        const afd::BatchResult batch =
            registry->execute_batch(request, app_calls::make_context(item));
        const auto& expected = item.at("expect");
        REQUIRE_MESSAGE(batch.results.size() == expected.size(), label);
        for (std::size_t i = 0; i < expected.size(); ++i) {
            app_calls::check_result(label + "[" + std::to_string(i) + "]", batch.results[i].result,
                                    expected[i], vectors.at("refusal"));
        }
    }
}

TEST_CASE("app-calls: list_by_exposure, middleware ordering, DirectClient refusal and replay") {
    const auto vectors = app_calls::load("app-calls.json");
    auto registry = app_calls::build_registry(vectors, "grants");

    const auto exposed = registry->list_by_exposure(afd::Interface::apps);
    REQUIRE(exposed.size() == 1);
    CHECK(exposed[0]->definition.name == "tally-get");

    // Middleware sees only granted app calls, with Interface::apps.
    std::vector<std::string> seen;
    registry->use([&seen](std::string_view name, const afd::Json&, afd::CommandContext& context,
                          const afd::Next& next) {
        seen.push_back(std::string(name) + ":" +
                       (context.surface == afd::Interface::apps ? "apps" : "other"));
        return next();
    });
    afd::CommandContext ok_ctx;
    ok_ctx.surface = afd::Interface::apps;
    ok_ctx.extra["caller"] = "checklist";
    CHECK(registry->execute("tally-get", afd::Json::object(), ok_ctx).success);

    afd::CommandContext denied_ctx;
    denied_ctx.surface = afd::Interface::apps;
    denied_ctx.extra["caller"] = "hello";
    app_calls::check_result("middleware skipped on refusal",
                            registry->execute("tally-get", afd::Json::object(), denied_ctx),
                            afd::Json{{"refused", true}}, vectors.at("refusal"));
    CHECK(seen == std::vector<std::string>{"tally-get:apps"});

    // DirectClient refuses Interface::apps without leaking UNKNOWN_TOOL or COMMAND_NOT_ALLOWED.
    afd::DirectClient app_client(registry, {.surface = afd::Interface::apps,
                                            .allow = [](std::string_view) { return false; }});
    CHECK(app_client.list_command_names().empty());
    CHECK_FALSE(app_client.has_command("tally-get"));
    app_calls::check_result("DirectClient refuses apps surface",
                            app_client.call("tally-get", afd::Json::object(), ok_ctx),
                            afd::Json{{"refused", true}}, vectors.at("refusal"));

    // Journal replay re-checks call_grant and cannot be downgraded via ReplayJournalOptions.
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    bool granted = true;
    int runs = 0;
    auto make_replay_registry = [&](bool record) {
        afd::CommandRegistryOptions opts;
        opts.context_fields = {{.name = "caller",
                                .meta = "dev.example/caller",
                                .schema = afd::Json{{"type", "string"}},
                                .journal = true}};
        opts.call_grant = [&granted](std::string_view name, const afd::CommandContext& ctx) {
            return granted && name == "tally-get" && ctx.extra.is_object() &&
                   ctx.extra.value("caller", std::string{}) == "checklist";
        };
        if (record) {
            opts.middleware.push_back(afd::create_journal_middleware(sink));
        }
        auto reg = afd::CommandRegistry::create(std::move(opts));
        REQUIRE(reg.has_value());
        REQUIRE_FALSE((*reg)
                          ->register_command({.name = "tally-get",
                                              .description = "Read",
                                              .handler =
                                                  [&runs](const afd::Json&, afd::CommandContext&) {
                                                      ++runs;
                                                      return afd::success(afd::Json{{"by", 1}});
                                                  },
                                              .expose = {.apps = true}})
                          .has_value());
        return *reg;
    };

    auto recorder = make_replay_registry(true);
    CHECK(recorder->execute("tally-get", afd::Json::object(), ok_ctx).success);
    const auto read_entries = sink->read();
    REQUIRE(read_entries.has_value());
    const auto& entries = *read_entries;
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].context_digest.surface == std::optional<std::string>{"apps"});
    CHECK(runs == 1);

    // Granted replay succeeds.
    auto replay_ok = afd::replay_journal(*make_replay_registry(false), entries);
    CHECK(replay_ok.same == 1);
    CHECK_FALSE(replay_ok.diverged);
    CHECK(runs == 2);

    // Revoked grant refuses on replay without running the handler.
    granted = false;
    auto replay_revoked = afd::replay_journal(*make_replay_registry(false), entries);
    CHECK(replay_revoked.different == 1);
    REQUIRE(replay_revoked.entries[0].replayed.has_value());
    app_calls::check_result("revoked grant on replay", *replay_revoked.entries[0].replayed,
                            afd::Json{{"refused", true}}, vectors.at("refusal"));
    CHECK(runs == 2);

    // Host replay context callback cannot downgrade Interface::apps to Interface::agent.
    auto replay_downgrade =
        afd::replay_journal(*make_replay_registry(false), entries,
                            {.context = [](const afd::JournalEntry&, afd::CommandContext& ctx) {
                                ctx.surface = afd::Interface::agent;
                            }});
    CHECK(replay_downgrade.different == 1);
    REQUIRE(replay_downgrade.entries[0].replayed.has_value());
    app_calls::check_result("cannot downgrade apps on replay",
                            *replay_downgrade.entries[0].replayed, afd::Json{{"refused", true}},
                            vectors.at("refusal"));
    CHECK(runs == 2);

    // Bare CommandExecutor overload still refuses apps entries before calling the executor.
    int bare_runs = 0;
    const afd::CommandExecutor bare = [&bare_runs](std::string_view, const afd::Json&,
                                                   afd::CommandContext&) {
        ++bare_runs;
        return afd::success(afd::Json{{"by", 1}});
    };
    auto replay_bare = afd::replay_journal(bare, entries);
    CHECK(replay_bare.errors == 1);
    CHECK(bare_runs == 0);
}

TEST_CASE("app-calls: default DirectClient refuses incoming Interface::apps without downgrade") {
    const auto vectors = app_calls::load("app-calls.json");
    int runs = 0;
    auto registry = afd::CommandRegistry::create(
        {.call_grant = [](std::string_view, const afd::CommandContext&) { return true; }});
    REQUIRE(registry.has_value());
    REQUIRE_FALSE((*registry)
                      ->register_command({.name = "agent-only",
                                          .description = "Exposed to agent only",
                                          .handler =
                                              [&runs](const afd::Json&, afd::CommandContext&) {
                                                  ++runs;
                                                  return afd::success(afd::Json{{"ok", true}});
                                              },
                                          .expose = {.agent = true, .apps = false}})
                      .has_value());

    bool allow_called = false;
    afd::DirectClient default_client(*registry, {.allow = [&allow_called](std::string_view) {
        allow_called = true;
        return false;
    }});
    afd::CommandContext apps_ctx;
    apps_ctx.surface = afd::Interface::apps;

    app_calls::check_result("default DirectClient refuses apps on agent-only command",
                            default_client.call("agent-only", afd::Json::object(), apps_ctx),
                            afd::Json{{"refused", true}}, vectors.at("refusal"));
    app_calls::check_result("default DirectClient refuses apps on missing command",
                            default_client.call("no-such-cmd", afd::Json::object(), apps_ctx),
                            afd::Json{{"refused", true}}, vectors.at("refusal"));
    CHECK_FALSE(allow_called);
    CHECK(runs == 0);
}

TEST_CASE("app-calls: CallGrant requires strict bool, shares state, and avoids lock re-entrancy") {
    const auto vectors = app_calls::load("app-calls.json");

    auto returns_int = [](std::string_view, const afd::CommandContext&) -> int { return 1; };
    auto returns_cstr = [](std::string_view, const afd::CommandContext&) -> const char* {
        return "yes";
    };
    auto returns_bool = [](std::string_view, const afd::CommandContext&) -> bool { return true; };
    static_assert(!std::is_constructible_v<afd::CallGrant, decltype(returns_int)>);
    static_assert(!std::is_constructible_v<afd::CallGrant, decltype(returns_cstr)>);
    static_assert(std::is_constructible_v<afd::CallGrant, decltype(returns_bool)>);

    // A stateful one-use predicate is shared, not copied per call, so the second call is refused.
    int copies = 0;
    struct OneShotGrant {
        int remaining = 1;
        int* copy_count = nullptr;
        OneShotGrant(int r, int* c) : remaining(r), copy_count(c) {}
        OneShotGrant(const OneShotGrant& other)
            : remaining(other.remaining), copy_count(other.copy_count) {
            if (copy_count) {
                ++(*copy_count);
            }
        }
        OneShotGrant(OneShotGrant&&) noexcept = default;
        bool operator()(std::string_view, const afd::CommandContext&) { return remaining-- > 0; }
    };

    auto registry = afd::CommandRegistry::create({.call_grant = OneShotGrant{1, &copies}});
    REQUIRE(registry.has_value());
    REQUIRE_FALSE((*registry)
                      ->register_command({.name = "tally-get",
                                          .description = "Read",
                                          .handler =
                                              [](const afd::Json&, afd::CommandContext&) {
                                                  return afd::success(afd::Json{{"by", 1}});
                                              },
                                          .expose = {.apps = true}})
                      .has_value());

    const int copies_after_install = copies;
    afd::CommandContext apps_ctx;
    apps_ctx.surface = afd::Interface::apps;
    CHECK((*registry)->execute("tally-get", afd::Json::object(), apps_ctx).success);
    app_calls::check_result("second call refused by one-shot grant",
                            (*registry)->execute("tally-get", afd::Json::object(), apps_ctx),
                            afd::Json{{"refused", true}}, vectors.at("refusal"));
    CHECK(copies == copies_after_install);

    // Replacing a grant destroys the previous instance outside the registry lock (so its
    // destructor can safely read the registry without deadlocking).
    bool destroyed_unlocked = false;
    struct ReentrantDtor {
        std::shared_ptr<afd::CommandRegistry> reg;
        bool* flag = nullptr;
        ReentrantDtor(std::shared_ptr<afd::CommandRegistry> r, bool* f)
            : reg(std::move(r)), flag(f) {}
        ReentrantDtor(const ReentrantDtor&) = delete;
        ReentrantDtor(ReentrantDtor&&) noexcept = default;
        ~ReentrantDtor() {
            if (reg && flag) {
                *flag = reg->has("tally-get");
            }
        }
        bool operator()(std::string_view, const afd::CommandContext&) const { return false; }
    };
    (*registry)->set_call_grant(ReentrantDtor{*registry, &destroyed_unlocked});
    CHECK_FALSE(destroyed_unlocked);
    (*registry)->set_call_grant(nullptr);
    CHECK(destroyed_unlocked);
}

TEST_CASE("app-calls: ungranted refusal precedes registry configuration diagnostics") {
    const auto vectors = app_calls::load("app-calls.json");
    // Construct directly with an invalid context_fields declaration (empty name).
    afd::CommandRegistry bad_registry(
        {.context_fields = {{.name = "", .meta = "dev.example/x", .schema = {{"type", "string"}}}},
         .call_grant = [](std::string_view, const afd::CommandContext& ctx) {
             return ctx.extra.is_object() &&
                    ctx.extra.value("caller", std::string{}) == "checklist";
         }});
    REQUIRE_FALSE(bad_registry
                      .register_command({.name = "tally-get",
                                         .description = "Read",
                                         .handler =
                                             [](const afd::Json&, afd::CommandContext&) {
                                                 return afd::success(afd::Json{{"by", 1}});
                                             },
                                         .expose = {.apps = true}})
                      .has_value());

    afd::CommandContext denied_ctx;
    denied_ctx.surface = afd::Interface::apps;
    denied_ctx.extra["caller"] = "hello";
    app_calls::check_result("ungranted apps call hides configuration diagnostic",
                            bad_registry.execute("tally-get", afd::Json::object(), denied_ctx),
                            afd::Json{{"refused", true}}, vectors.at("refusal"));

    // Host and granted calls still receive the misconfiguration INTERNAL_ERROR.
    const auto host_res = bad_registry.execute("tally-get", afd::Json::object());
    CHECK_FALSE(host_res.success);
    REQUIRE(host_res.error.has_value());
    CHECK(host_res.error->code == afd::error_codes::INTERNAL_ERROR);

    afd::CommandContext granted_ctx;
    granted_ctx.surface = afd::Interface::apps;
    granted_ctx.extra["caller"] = "checklist";
    const auto granted_res = bad_registry.execute("tally-get", afd::Json::object(), granted_ctx);
    CHECK_FALSE(granted_res.success);
    REQUIRE(granted_res.error.has_value());
    CHECK(granted_res.error->code == afd::error_codes::INTERNAL_ERROR);
}
