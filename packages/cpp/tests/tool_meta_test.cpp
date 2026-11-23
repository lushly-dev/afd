// Extra tool _meta (T1-T3) and advertised input schemas (V1-V2) in afd::afd
// (spec/mcp-resources.md, spec/vectors/mcp-resources.json).
#include "afd/afd.hpp"

#include <cmath>
#include <fstream>
#include <iterator>
#include <limits>
#include <memory>
#include <string>
#include <utility>

#include "detail/meta_keys.hpp"
#include <doctest.h>

// Named, not anonymous: unity builds combine test translation units.
namespace tool_meta_test {

using afd::Json;

afd::CommandResult ok_handler(const Json& input, afd::CommandContext&) {
    return afd::success(input);
}

Json load_vectors(const char* name) {
    const std::string path = std::string(AFD_VECTORS_DIR) + "/" + name;
    std::ifstream in(path, std::ios::binary);
    REQUIRE_MESSAGE(in.good(), "could not open " << path);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error().message);
    return std::move(*parsed);
}

const Json& spec_cases() {
    static const Json data = load_vectors("mcp-resources.json");
    return data;
}

TEST_CASE("tool_meta enforces every toolMetaKeys case in spec/vectors/mcp-resources.json") {
    const Json& cases = spec_cases().at("toolMetaKeys");
    REQUIRE(cases.is_array());
    REQUIRE_FALSE(cases.empty());

    for (const auto& entry : cases) {
        const std::string key = entry.at("key").get<std::string>();
        const Json& value = entry.at("value");
        const bool allowed = entry.at("allowed").get<bool>();

        afd::CommandRegistry registry;
        afd::CommandDefinition def;
        def.name = "demo-action";
        def.description = "Demo command";
        def.handler = ok_handler;
        def.expose.mcp = true;
        def.tool_meta = Json{{key, value}};

        const auto problem = registry.register_command(def);
        if (allowed) {
            CHECK_MESSAGE(!problem.has_value(), "expected key '" << key << "' to be allowed, got: "
                                                                 << problem.value_or(""));
            const auto registered = registry.get("demo-action");
            REQUIRE(registered != nullptr);
            const Json tool = afd::command_to_mcp_tool(registered->definition);
            REQUIRE(tool.contains("_meta"));
            CHECK(tool["_meta"][key] == value);
            const Json detail = afd::to_json(registered->definition);
            REQUIRE(detail.contains("toolMeta"));
            CHECK(detail["toolMeta"][key] == value);
        } else {
            REQUIRE_MESSAGE(problem.has_value(),
                            "expected key '" << key << "' to be refused at registration");
            CHECK_MESSAGE(problem->find(key) != std::string::npos,
                          "error must name key '" << key << "', got: " << *problem);
            CHECK_MESSAGE(problem->find("demo-action") != std::string::npos,
                          "error must name command 'demo-action', got: " << *problem);
        }
    }
}

TEST_CASE("tool_meta rejects non-object, non-finite numbers, binary nodes and invalid UTF-8") {
    afd::CommandRegistry registry;
    afd::CommandDefinition non_obj;
    non_obj.name = "bad-meta";
    non_obj.description = "Bad";
    non_obj.handler = ok_handler;
    non_obj.tool_meta = Json::array({"x"});
    const auto err_arr = registry.register_command(non_obj);
    REQUIRE(err_arr.has_value());
    CHECK(err_arr->find("bad-meta") != std::string::npos);

    afd::CommandDefinition non_finite;
    non_finite.name = "bad-nan";
    non_finite.description = "Bad";
    non_finite.handler = ok_handler;
    non_finite.tool_meta = Json{{"com.example/v", std::numeric_limits<double>::quiet_NaN()}};
    const auto err_nan = registry.register_command(non_finite);
    REQUIRE(err_nan.has_value());
    CHECK(err_nan->find("com.example/v") != std::string::npos);

    // Case-insensitive reserved prefix checks (T2).
    for (const char* key : {"DEV.AFD/custom", "IO.ModelContextProtocol/x", "org.MCP/y"}) {
        const auto reason = afd::detail::validate_meta_entry(key, Json(1), true);
        CHECK_MESSAGE(reason.has_value(), "expected " << key << " to be refused");
    }

    // Empty tool_meta is omitted from _meta and toolMeta (T1).
    afd::CommandDefinition empty_meta;
    empty_meta.name = "plain-cmd";
    empty_meta.description = "Plain";
    empty_meta.handler = ok_handler;
    empty_meta.tool_meta = Json::object();
    REQUIRE_FALSE(registry.register_command(empty_meta).has_value());
    const Json tool = afd::command_to_mcp_tool(registry.get("plain-cmd")->definition);
    CHECK_FALSE(tool.contains("_meta"));
    const Json detail = afd::to_json(registry.get("plain-cmd")->definition);
    CHECK_FALSE(detail.contains("toolMeta"));

    // Non-JSON binary nodes and invalid UTF-8 strings/keys are rejected (T2).
    afd::CommandDefinition bad_bin;
    bad_bin.name = "bad-bin";
    bad_bin.description = "Binary";
    bad_bin.handler = ok_handler;
    bad_bin.tool_meta = Json{{"com.example/bin", Json::binary({1, 2, 3})}};
    CHECK(registry.register_command(bad_bin).has_value());

    afd::CommandDefinition bad_utf8;
    bad_utf8.name = "bad-utf8";
    bad_utf8.description = "Bad UTF-8";
    bad_utf8.handler = ok_handler;
    bad_utf8.tool_meta = Json{{"com.example/str", std::string("\xFF\xFE", 2)}};
    CHECK(registry.register_command(bad_utf8).has_value());

    // Context tools never emit tool_meta (T1).
    afd::CommandDefinition ctx_tool;
    ctx_tool.name = "afd-context-list";
    ctx_tool.description = "Context list";
    ctx_tool.handler = ok_handler;
    ctx_tool.tool_meta = Json{{"com.example/x", 1}};
    CHECK_FALSE(afd::command_tool_meta(ctx_tool).has_value());
    CHECK_FALSE(afd::to_json(ctx_tool).contains("toolMeta"));

    // V2 does not impose S2's 64-level depth limit on advertised_input_schema.
    Json deep = Json{{"type", "string"}};
    for (int i = 0; i < 70; ++i) {
        deep = Json{{"type", "object"}, {"properties", {{"next", std::move(deep)}}}};
    }
    afd::CommandDefinition deep_cmd;
    deep_cmd.name = "deep-adv";
    deep_cmd.description = "Deep advertised schema";
    deep_cmd.handler = ok_handler;
    deep_cmd.advertised_input_schema = std::move(deep);
    CHECK_FALSE(registry.register_command(deep_cmd).has_value());
}

TEST_CASE("advertised_input_schema validates V2 and surfaces on tools, afd-detail, afd-schema and "
          "afd-docs while runtime validates input_schema") {
    afd::CommandRegistry registry;

    // V2 rejections: non-object, wrong type, missing type, non-finite float.
    for (const Json& bad :
         {Json("not-object"), Json::array(), Json{{"type", "string"}},
          Json{{"properties", Json::object()}},
          Json{{"type", "object"}, {"x", std::numeric_limits<double>::infinity()}}}) {
        afd::CommandDefinition invalid;
        invalid.name = "bad-adv";
        invalid.description = "Invalid advertised";
        invalid.handler = ok_handler;
        invalid.advertised_input_schema = bad;
        const auto err = registry.register_command(invalid);
        REQUIRE(err.has_value());
        CHECK(err->find("bad-adv") != std::string::npos);
    }

    // Advertised schema uses keywords CompiledSchema refuses (pattern, oneOf, format).
    const Json advertised = {
        {"type", "object"},
        {"properties",
         {{"name", {{"type", "string"}, {"pattern", "^[A-Z]"}, {"description", "User name"}}},
          {"mode", {{"oneOf", Json::array({Json{{"const", "fast"}}, Json{{"const", "safe"}}})}}}}},
        {"required", Json::array({"name"})},
    };
    const Json validation = {
        {"type", "object"},
        {"properties", {{"name", {{"type", "string"}, {"minLength", 2}}}}},
        {"required", Json::array({"name"})},
    };

    afd::CommandDefinition cmd;
    cmd.name = "wrap-greet";
    cmd.description = "Greet a user";
    cmd.category = "wrap";
    cmd.input_schema = validation;
    cmd.advertised_input_schema = advertised;
    cmd.tool_meta = Json{{"dev.umbel/origin", {{"plugin", "greeter"}}}};
    cmd.handler = [](const Json& input, afd::CommandContext&) {
        return afd::success(Json{{"greeted", input["name"]}});
    };
    cmd.expose.mcp = true;
    REQUIRE_FALSE(registry.register_command(cmd).has_value());
    REQUIRE_FALSE(afd::register_bootstrap_commands(registry).has_value());

    const auto registered = registry.get("wrap-greet");
    REQUIRE(registered != nullptr);

    // MCP tool & afd-detail show advertised_input_schema and tool_meta.
    const Json tool = afd::command_to_mcp_tool(registered->definition);
    CHECK(tool["inputSchema"] == advertised);
    CHECK(tool["_meta"]["dev.umbel/origin"] == Json{{"plugin", "greeter"}});
    CHECK(tool["_meta"]["category"] == "wrap");

    const Json detail = afd::to_json(registered->definition);
    CHECK(detail["inputSchema"] == advertised);
    CHECK(detail["toolMeta"] == Json{{"dev.umbel/origin", {{"plugin", "greeter"}}}});

    // afd-schema surfaces advertised_input_schema (both json and typescript formats).
    const afd::CommandResult schema_res =
        registry.execute("afd-schema", {{"format", "typescript"}});
    REQUIRE(schema_res.success);
    REQUIRE(schema_res.data.has_value());
    bool found_wrap = false;
    for (const auto& item : (*schema_res.data)["schemas"]) {
        if (item["name"] == "wrap-greet") {
            CHECK(item["inputSchema"] == advertised);
            found_wrap = true;
        }
    }
    CHECK(found_wrap);
    const std::string ts = (*schema_res.data)["typescript"].get<std::string>();
    CHECK(ts.find("\"fast\" | \"safe\"") != std::string::npos);

    // afd-docs parameter table reads advertised_input_schema.
    const afd::CommandResult docs_res = registry.execute("afd-docs", {{"command", "wrap-greet"}});
    REQUIRE(docs_res.success);
    const std::string md = (*docs_res.data)["markdown"].get<std::string>();
    CHECK(md.find("| mode |") != std::string::npos);
    CHECK(md.find("User name") != std::string::npos);

    // Runtime execution validates against validation schema (`minLength: 2`), NOT `pattern`.
    const afd::CommandResult too_short = registry.execute("wrap-greet", {{"name", "x"}});
    CHECK_FALSE(too_short.success);
    REQUIRE(too_short.error.has_value());
    CHECK(too_short.error->code == afd::error_codes::VALIDATION_ERROR);

    const afd::CommandResult lowercase_ok = registry.execute("wrap-greet", {{"name", "ada"}});
    CHECK(lowercase_ok.success);
    CHECK(lowercase_ok.data == Json{{"greeted", "ada"}});
}

} // namespace tool_meta_test
