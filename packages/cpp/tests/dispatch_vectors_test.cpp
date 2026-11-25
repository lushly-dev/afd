// Single-command dispatch-order vectors (spec/dispatch.md, spec/vectors/dispatch.json).
#include "afd/afd.hpp"

#include "detail/exceptions.hpp"
#ifdef AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <doctest.h>

namespace dispatch_vectors {

afd::Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

afd::Interface interface_from(std::string_view name) {
    if (name == "palette") {
        return afd::Interface::palette;
    }
    if (name == "mcp") {
        return afd::Interface::mcp;
    }
    if (name == "cli") {
        return afd::Interface::cli;
    }
    return afd::Interface::agent;
}

afd::ActorKind actor_kind_from(std::string_view kind) {
    return afd::parse_actor_kind(kind).value_or(afd::ActorKind::agent);
}

struct Trace {
    std::vector<std::string> hooks;
    std::vector<std::pair<std::string, afd::Json>> on_command_calls;
    std::vector<std::string> on_error_messages;
};

struct BuiltRegistry {
    std::shared_ptr<afd::CommandRegistry> registry;
    std::shared_ptr<Trace> trace = std::make_shared<Trace>();
};

BuiltRegistry build_registry(const afd::Json& vectors, const afd::Json& test_case) {
    BuiltRegistry out;
    auto trace = out.trace;
    const auto& setup = vectors.at("setup");

    std::vector<afd::CommandDefinition> commands;
    for (const auto& spec : setup.at("commands")) {
        const std::string name = spec.at("name").get<std::string>();
        const std::string behavior = spec.at("behavior").get<std::string>();

        afd::CommandDefinition def{
            .name = name,
            .description = spec.at("description").get<std::string>(),
            .input_schema = spec.at("input"),
            .handler = [trace, behavior](const afd::Json& input,
                                         afd::CommandContext&) -> afd::CommandResult {
                trace->hooks.push_back("handler");
                if (behavior == "throw") {
#if AFD_HAS_EXCEPTIONS
                    throw std::runtime_error("secret handler failure");
#else
                    return afd::error(afd::error_codes::COMMAND_EXECUTION_ERROR,
                                      "An internal error occurred");
#endif
                }
                return afd::success(input);
            },
            .version = spec.at("version").get<std::string>(),
        };

        if (spec.contains("expose")) {
            const auto& ex = spec.at("expose");
            def.expose = afd::ExposeOptions{
                .palette = ex.value("palette", false),
                .mcp = ex.value("mcp", false),
                .agent = ex.value("agent", false),
                .cli = ex.value("cli", false),
            };
        }
        if (spec.contains("contexts")) {
            def.contexts = spec.at("contexts").get<std::vector<std::string>>();
        }
        if (spec.contains("confirmPrompt")) {
            def.confirm_prompt = spec.at("confirmPrompt").get<std::string>();
        }
        if (spec.value("approval", "") == "required") {
            def.approval = afd::ApprovalDecision::required;
        }
        commands.push_back(std::move(def));
    }

    afd::CommandRegistryOptions options;
    const bool middleware_throws = test_case.value("middleware", "") == "throw";
    const bool with_approval = test_case.value("withApprovalMiddleware", false);
    const bool on_command_throws = test_case.value("onCommandThrows", false);

    options.middleware.push_back(
        [trace, middleware_throws](std::string_view, const afd::Json&, afd::CommandContext&,
                                   const afd::Next& next) -> afd::CommandResult {
            trace->hooks.push_back("mw1:before");
            if (middleware_throws) {
#if AFD_HAS_EXCEPTIONS
                throw std::runtime_error("secret middleware failure");
#else
                return afd::error(afd::error_codes::COMMAND_EXECUTION_ERROR,
                                  "An internal error occurred");
#endif
            }
            auto result = next();
            trace->hooks.push_back("mw1:after");
            return result;
        });

    if (with_approval) {
        auto approval = afd::create_approval_middleware(
            {.secrets = {std::string(32, 'k')}, .commands = {commands.begin(), commands.end()}});
        REQUIRE(approval.has_value());
        options.middleware.push_back(std::move(*approval));
    }

    options.middleware.push_back([trace](std::string_view, const afd::Json&, afd::CommandContext&,
                                         const afd::Next& next) -> afd::CommandResult {
        trace->hooks.push_back("mw2:before");
        auto result = next();
        trace->hooks.push_back("mw2:after");
        return result;
    });

    options.on_command = [trace, on_command_throws](std::string_view name, const afd::Json& input,
                                                    const afd::CommandResult&) {
        trace->on_command_calls.emplace_back(std::string(name), input);
        if (on_command_throws) {
#if AFD_HAS_EXCEPTIONS
            throw std::runtime_error("onCommand boom");
#endif
        }
    };
    options.on_error = [trace](std::string_view message) {
        trace->on_error_messages.emplace_back(message);
    };

    if (test_case.value("withContextFields", false)) {
        for (const auto& field : setup.at("contextFields")) {
            afd::ContextField cf{
                .name = field.at("name").get<std::string>(),
                .schema = field.at("schema"),
                .required = field.value("required", false),
            };
            if (field.contains("meta")) {
                cf.meta = field.at("meta").get<std::string>();
            }
            options.context_fields.push_back(std::move(cf));
        }
    }

    auto created = afd::CommandRegistry::create(std::move(options));
    const std::string created_error = created.has_value() ? std::string{} : created.error();
    REQUIRE_MESSAGE(created.has_value(), created_error);
    out.registry = std::move(*created);

    for (auto& command : commands) {
        const auto reg_err = out.registry->register_command(std::move(command));
        REQUIRE_MESSAGE(!reg_err.has_value(), reg_err.value_or(""));
    }

    // setup.contextCommands "plain": the registry surface registers the context commands as plain
    // commands, with no tool surface and no bootstrap or help commands.
    if (test_case.at("surface") == "registry" && setup.value("contextCommands", "") == "plain") {
        std::vector<afd::ContextConfig> contexts;
        for (const auto& name : setup.at("contexts")) {
            contexts.push_back({.name = name.get<std::string>()});
        }
        const auto context_err = afd::register_context_commands(*out.registry, std::move(contexts));
        REQUIRE_MESSAGE(!context_err.has_value(), context_err.value_or(""));
    }

    return out;
}

// `expect.recovery`: the error's recovery as JSON, `null` for none (spec/recovery.md).
afd::Json recovery_json(const std::optional<afd::Recovery>& recovery) {
    return recovery ? afd::Json(*recovery) : afd::Json(nullptr);
}

std::optional<std::string> command_version_from(const afd::Json& vectors, std::string_view name) {
    for (const auto& spec : vectors.at("setup").at("commands")) {
        if (spec.at("name").get<std::string>() == name && spec.contains("version")) {
            return spec.at("version").get<std::string>();
        }
    }
    return std::nullopt;
}

} // namespace dispatch_vectors

TEST_CASE("single-command dispatch order matches spec/vectors/dispatch.json") {
    const afd::Json vectors = dispatch_vectors::load_vectors("dispatch.json");
    CHECK_FALSE(vectors.at("gaps").contains("cpp"));

    std::size_t executed = 0;
    for (const auto& test_case : vectors.at("cases")) {
        if (test_case.at("surface") != "registry") {
            continue;
        }
        const std::string id = test_case.at("id").get<std::string>();
        CAPTURE(id);

#if !AFD_HAS_EXCEPTIONS
        if (test_case.value("middleware", "") == "throw" ||
            test_case.at("call").at("command") == "item-throw" ||
            test_case.value("onCommandThrows", false)) {
            continue;
        }
#endif

        auto built = dispatch_vectors::build_registry(vectors, test_case);
        const auto& call = test_case.at("call");

        afd::CommandContext ctx;
        if (call.contains("interface")) {
            ctx.surface = dispatch_vectors::interface_from(call.at("interface").get<std::string>());
        }
        if (call.contains("activeContext")) {
            ctx.active_context = call.at("activeContext").get<std::string>();
        }
        if (call.contains("traceId")) {
            ctx.trace_id = call.at("traceId").get<std::string>();
        }
        if (call.contains("actorKind")) {
            ctx.actor = afd::Actor{
                .kind = dispatch_vectors::actor_kind_from(call.at("actorKind").get<std::string>())};
        }
        if (call.contains("contextFields")) {
            for (const auto& [k, v] : call.at("contextFields").items()) {
                ctx.extra[k] = v;
            }
        }

        const auto result =
            built.registry->execute(call.at("command").get<std::string>(), call.at("input"), ctx);
        const auto& expected = test_case.at("expect");

        CHECK(result.success == expected.at("success").get<bool>());
        if (expected.contains("code")) {
            REQUIRE(result.error.has_value());
            CHECK(result.error->code == expected.at("code").get<std::string>());
        }
        if (expected.contains("retryable")) {
            REQUIRE(result.error.has_value());
            CHECK(result.error->retryable == expected.at("retryable").get<bool>());
        }
        if (expected.contains("recovery")) {
            REQUIRE(result.error.has_value());
            CHECK(dispatch_vectors::recovery_json(result.error->recovery) ==
                  expected.at("recovery"));
        }
        if (expected.contains("message")) {
            REQUIRE(result.error.has_value());
            CHECK(result.error->message == expected.at("message").get<std::string>());
        }
        if (expected.contains("data")) {
            CHECK(result.data == expected.at("data"));
        }

        const auto expected_hooks = expected.at("hooks").get<std::vector<std::string>>();
        CHECK(built.trace->hooks == expected_hooks);
        CHECK((!built.trace->on_command_calls.empty()) == expected.at("onCommand").get<bool>());
        if (expected.value("onCommandSeesRawInput", false)) {
            REQUIRE(!built.trace->on_command_calls.empty());
            CHECK(built.trace->on_command_calls.front().second == call.at("input"));
        }
        CHECK((!built.trace->on_error_messages.empty()) == expected.at("onError").get<bool>());

        if (expected.contains("stamped")) {
            REQUIRE(result.metadata.has_value());
            for (const auto& field : expected.at("stamped")) {
                const std::string name = field.get<std::string>();
                if (name == "executionTimeMs") {
                    CHECK(result.metadata->execution_time_ms.has_value());
                    CHECK(*result.metadata->execution_time_ms >= 0.0);
                } else if (name == "commandVersion") {
                    CHECK(result.metadata->command_version ==
                          dispatch_vectors::command_version_from(
                              vectors, call.at("command").get<std::string>()));
                } else if (name == "traceId") {
                    CHECK(result.metadata->trace_id ==
                          std::optional<std::string>(call.at("traceId").get<std::string>()));
                } else if (name == "actorKind") {
                    CHECK(
                        result.metadata->actor_kind ==
                        dispatch_vectors::actor_kind_from(call.at("actorKind").get<std::string>()));
                }
            }
        }
        ++executed;
    }

#if AFD_HAS_EXCEPTIONS
    CHECK(executed >= 16);
#else
    CHECK(executed >= 13);
#endif
}

#ifdef AFD_HAS_MCP_STDIO
TEST_CASE("MCP dispatch-order cases match spec/vectors/dispatch.json") {
    const afd::Json vectors = dispatch_vectors::load_vectors("dispatch.json");
    std::size_t executed = 0;

    for (const auto& test_case : vectors.at("cases")) {
        if (test_case.at("surface") != "mcp") {
            continue;
        }
        const std::string id = test_case.at("id").get<std::string>();
        CAPTURE(id);

        auto built = dispatch_vectors::build_registry(vectors, test_case);
        auto server = afd::mcp::StdioServer::create(
            *built.registry, {.name = "dispatch-vectors",
                              .version = "1.0.0",
                              .confirmations = afd::mcp::ConfirmationMode::enforce});
        REQUIRE(server.has_value());

        const auto& call = test_case.at("call");
        afd::Json args{{"command", call.at("command")}, {"input", call.at("input")}};
        if (call.contains("confirm")) {
            args["confirm"] = call.at("confirm");
        }
        const afd::Json request{
            {"jsonrpc", "2.0"},
            {"id", 1},
            {"method", "tools/call"},
            {"params",
             {{"name", "afd-call"},
              {"arguments", std::move(args)},
              {"_meta",
               {{"io.modelcontextprotocol/protocolVersion", "2026-07-28"},
                {"io.modelcontextprotocol/clientCapabilities", afd::Json::object()}}}}}};

        const auto raw = (*server)->handle_message(afd::wire::serialize(request));
        REQUIRE(raw.has_value());
        const auto response = afd::Json::parse(*raw);
        const auto text = response.at("result").at("content").at(0).at("text").get<std::string>();
        const auto result = afd::Json::parse(text);

        const auto& expected = test_case.at("expect");
        CHECK(result.at("success") == expected.at("success"));
        if (expected.contains("code")) {
            CHECK(result.at("error").at("code") == expected.at("code"));
        }
        if (expected.contains("retryable")) {
            CHECK(result.at("error").at("retryable") == expected.at("retryable"));
        }
        if (expected.contains("recovery")) {
            // On the wire, no recovery is an absent member, never `null`.
            const auto& error = result.at("error");
            CHECK(error.value("recovery", afd::Json(nullptr)) == expected.at("recovery"));
            if (expected.at("recovery").is_null()) {
                CHECK_FALSE(error.contains("recovery"));
            }
        }
        if (expected.contains("data")) {
            CHECK(result.at("data") == expected.at("data"));
        }
        const auto expected_hooks = expected.at("hooks").get<std::vector<std::string>>();
        CHECK(built.trace->hooks == expected_hooks);
        ++executed;
    }

    CHECK(executed >= 3);
}
#endif
