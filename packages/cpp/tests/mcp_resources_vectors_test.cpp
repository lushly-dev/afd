// MCP resources (R1-R6), Skills extension (S1-S7), extra tool _meta (T1-T3), and advertised
// input schemas (V1-V2) over afd::mcp::StdioServer in both MCP eras (2026-07-28 and 2025-11-25),
// loading every case of spec/vectors/mcp-resources.json.
#include "afd/afd.hpp"
#include "afd/mcp_stdio.hpp"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/base64.hpp"
#include "detail/sha256.hpp"
#include <doctest.h>

// Named, not anonymous: unity builds combine test translation units.
namespace resources_test {

using afd::Json;
using afd::mcp::ConfirmationMode;
using afd::mcp::ResourceContents;
using afd::mcp::ResourceEntry;
using afd::mcp::ResourceProvider;
using afd::mcp::Skill;
using afd::mcp::SkillCatalog;
using afd::mcp::SkillFile;
using afd::mcp::StaticResource;
using afd::mcp::StdioServer;
using afd::mcp::StdioServerOptions;
using afd::mcp::ToolStrategy;

constexpr const char* modern_ver = "2026-07-28";
constexpr const char* legacy_ver = "2025-11-25";

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

Json send_rpc(StdioServer& server, std::string_view method, Json params, bool modern, int id = 1) {
    if (modern) {
        if (!params.is_object()) {
            params = Json::object();
        }
        Json meta = params.contains("_meta") && params["_meta"].is_object() ? params["_meta"]
                                                                            : Json::object();
        meta["io.modelcontextprotocol/protocolVersion"] = modern_ver;
        meta["io.modelcontextprotocol/clientCapabilities"] = Json::object();
        params["_meta"] = std::move(meta);
    }
    const Json req{{"jsonrpc", "2.0"},
                   {"id", id},
                   {"method", std::string(method)},
                   {"params", std::move(params)}};
    const auto reply = server.handle_message(afd::wire::serialize(req));
    REQUIRE(reply.has_value());
    const auto parsed = afd::parse_bounded(*reply);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error().message);
    return *parsed;
}

void init_legacy(StdioServer& server) {
    const Json resp = send_rpc(server, "initialize",
                               {{"protocolVersion", legacy_ver},
                                {"capabilities", Json::object()},
                                {"clientInfo", {{"name", "test"}, {"version", "0.1"}}}},
                               false, 0);
    REQUIRE(resp.contains("result"));
}

SkillCatalog catalog_from_json(const Json& skills_json, bool directory_read = false) {
    SkillCatalog catalog;
    catalog.directory_read = directory_read;
    for (const auto& s : skills_json) {
        Skill skill;
        skill.path = s.at("path").get<std::string>();
        for (const auto& f : s.at("files")) {
            SkillFile file;
            file.path = f.at("path").get<std::string>();
            if (f.contains("text")) {
                file.bytes = f.at("text").get<std::string>();
            } else {
                const auto decoded = afd::detail::base64_decode(f.at("base64").get<std::string>());
                REQUIRE(decoded.has_value());
                file.bytes = *decoded;
            }
            skill.files.push_back(std::move(file));
        }
        catalog.skills.push_back(std::move(skill));
    }
    return catalog;
}

TEST_CASE("R1 opt-in: default server declares neither resources nor skills nor prompts") {
    afd::CommandRegistry registry;
    auto server = StdioServer::create(registry);
    REQUIRE_MESSAGE(server.has_value(), server.error());

    const Json disc = send_rpc(**server, "server/discover", Json::object(), true, 1);
    const Json& disc_caps = disc["result"]["capabilities"];
    CHECK(disc_caps.contains("tools"));
    CHECK_FALSE(disc_caps.contains("resources"));
    CHECK_FALSE(disc_caps.contains("extensions"));
    CHECK_FALSE(disc_caps.contains("prompts"));

    const Json init =
        send_rpc(**server, "initialize",
                 {{"protocolVersion", legacy_ver}, {"capabilities", Json::object()}}, false, 2);
    const Json& init_caps = init["result"]["capabilities"];
    CHECK(init_caps.contains("tools"));
    CHECK_FALSE(init_caps.contains("resources"));
    CHECK_FALSE(init_caps.contains("extensions"));
    CHECK_FALSE(init_caps.contains("prompts"));

    for (const bool modern : {true, false}) {
        for (const char* method :
             {"resources/list", "resources/read", "resources/templates/list", "resources/subscribe",
              "skills/list", "skills/get", "resources/directory/read"}) {
            const Json err = send_rpc(**server, method, Json::object(), modern, 3);
            REQUIRE_MESSAGE(err.contains("error"), method);
            CHECK(err["error"]["code"] == -32601);
        }
    }
}

TEST_CASE("spec/vectors/mcp-resources.json catalog conformance over stdio in both MCP eras") {
    const Json& catalog_spec = spec_cases().at("catalog");
    afd::CommandRegistry registry;

    for (const bool modern : {true, false}) {
        StdioServerOptions opts;
        opts.skills = catalog_from_json(catalog_spec.at("skills"));
        auto server = StdioServer::create(registry, std::move(opts));
        REQUIRE_MESSAGE(server.has_value(), server.error());

        if (!modern) {
            init_legacy(**server);
        }

        // S1 / R1 capabilities on both eras.
        const Json cap_resp =
            modern ? send_rpc(**server, "server/discover", Json::object(), true, 1)
                   : send_rpc(**server, "initialize",
                              {{"protocolVersion", legacy_ver}, {"capabilities", Json::object()}},
                              false, 1);
        const Json& caps = cap_resp["result"]["capabilities"];
        REQUIRE(caps.contains("resources"));
        CHECK_FALSE(caps["resources"].contains("subscribe"));
        CHECK_FALSE(caps["resources"].contains("listChanged"));
        CHECK_FALSE(caps.contains("prompts"));
        REQUIRE(caps.contains("extensions"));
        CHECK(caps["extensions"]["io.modelcontextprotocol/skills"] == Json::object());

        // S3: skills/list exact match + modern cache hints.
        const Json sl = send_rpc(**server, "skills/list", Json::object(), modern, 2);
        REQUIRE(sl.contains("result"));
        CHECK(sl["result"]["skills"] == catalog_spec.at("skillsList").at("skills"));
        CHECK_FALSE(sl["result"].contains("nextCursor"));
        if (modern) {
            CHECK(sl["result"]["resultType"] == "complete");
            CHECK(sl["result"]["ttlMs"] == 300000);
            CHECK(sl["result"]["cacheScope"] == "public");
        }

        // R3 / S5: resources/list exact match + modern cache hints.
        const Json rl = send_rpc(**server, "resources/list", Json::object(), modern, 3);
        REQUIRE(rl.contains("result"));
        CHECK(rl["result"]["resources"] == catalog_spec.at("resourcesList").at("resources"));
        CHECK_FALSE(rl["result"].contains("nextCursor"));
        if (modern) {
            CHECK(rl["result"]["ttlMs"] == 300000);
            CHECK(rl["result"]["cacheScope"] == "public");
        }

        // R4: every read case in spec/vectors/mcp-resources.json.
        int rpc_id = 10;
        for (const auto& read_case : catalog_spec.at("reads")) {
            const std::string uri = read_case.at("uri").get<std::string>();
            const Json rr = send_rpc(**server, "resources/read", {{"uri", uri}}, modern, rpc_id++);
            REQUIRE_MESSAGE(rr.contains("result"), "read failed for " << uri);
            CHECK(rr["result"]["contents"] == read_case.at("contents"));
            if (modern) {
                CHECK(rr["result"]["ttlMs"] == 300000);
                CHECK(rr["result"]["cacheScope"] == "public");
            }
        }

        // S4: every skillsGet case in spec/vectors/mcp-resources.json.
        for (const auto& get_case : catalog_spec.at("skillsGet")) {
            const std::string uri = get_case.at("uri").get<std::string>();
            const std::size_t idx = get_case.at("skillsListIndex").get<std::size_t>();
            const Json sg = send_rpc(**server, "skills/get", {{"uri", uri}}, modern, rpc_id++);
            REQUIRE(sg.contains("result"));
            CHECK(sg["result"]["skill"] == catalog_spec.at("skillsList").at("skills")[idx]);
            if (modern) {
                CHECK(sg["result"]["ttlMs"] == 300000);
                CHECK(sg["result"]["cacheScope"] == "public");
            }
        }

        // R4 / S4: every error case in spec/vectors/mcp-resources.json.
        for (const auto& err_case : catalog_spec.at("errors")) {
            const std::string method = err_case.at("method").get<std::string>();
            const std::string uri = err_case.at("uri").get<std::string>();
            const int expected_code = err_case.at("code").get<int>();
            const Json resp = send_rpc(**server, method, {{"uri", uri}}, modern, rpc_id++);
            REQUIRE_MESSAGE(resp.contains("error"), method << " " << uri);
            CHECK(resp["error"]["code"] == expected_code);
            if (!err_case.value("dataOptional", false) || resp["error"].contains("data")) {
                REQUIRE(resp["error"].contains("data"));
                CHECK(resp["error"]["data"]["uri"] == uri);
            }
        }

        // R5: resources/templates/list is empty; resources/subscribe is -32601.
        const Json tmpl =
            send_rpc(**server, "resources/templates/list", Json::object(), modern, 90);
        REQUIRE(tmpl.contains("result"));
        CHECK(tmpl["result"]["resourceTemplates"] == Json::array());
        if (modern) {
            CHECK(tmpl["result"]["ttlMs"] == 300000);
            CHECK(tmpl["result"]["cacheScope"] == "public");
        }
        const Json sub = send_rpc(**server, "resources/subscribe",
                                  {{"uri", "skill://hello-greeting/SKILL.md"}}, modern, 91);
        REQUIRE(sub.contains("error"));
        CHECK(sub["error"]["code"] == -32601);

        // S6 off by default: resources/directory/read answers -32601.
        const Json dir = send_rpc(**server, "resources/directory/read",
                                  {{"uri", "skill://hello-greeting"}}, modern, 92);
        REQUIRE(dir.contains("error"));
        CHECK(dir["error"]["code"] == -32601);

        // R3 / S3 cursor rejection (including explicit null).
        for (const char* list_method :
             {"resources/list", "resources/templates/list", "skills/list"}) {
            for (const Json& cursor_val : {Json("abc"), Json(nullptr)}) {
                const Json bad =
                    send_rpc(**server, list_method, {{"cursor", cursor_val}}, modern, rpc_id++);
                REQUIRE(bad.contains("error"));
                CHECK(bad["error"]["code"] == -32602);
            }
        }
    }
}

TEST_CASE(
    "spec/vectors/mcp-resources.json catalogFailures all fail at server startup naming entry") {
    const Json& failures = spec_cases().at("catalogFailures");
    REQUIRE(failures.is_array());
    REQUIRE_FALSE(failures.empty());
    afd::CommandRegistry registry;

    for (const auto& fail_case : failures) {
        const std::string name = fail_case.at("name").get<std::string>();
        const std::string entry = fail_case.at("entry").get<std::string>();

        StdioServerOptions opts;
        opts.skills = catalog_from_json(fail_case.at("skills"));
        auto server = StdioServer::create(registry, std::move(opts));
        REQUIRE_MESSAGE(!server.has_value(), "expected catalog failure '" << name << "' to fail");
        CHECK_MESSAGE(server.error().find(entry) != std::string::npos,
                      "case '" << name << "' expected error containing '" << entry
                               << "', got: " << server.error());
    }
}

TEST_CASE("R2-R6 provider resources, ui:// apps, dynamic validation, contexts TTL invariance "
          "and no context_hook execution") {
    afd::CommandRegistry registry;
    const std::vector<afd::ContextConfig> contexts{{.name = "editing"}};
    REQUIRE_FALSE(afd::register_context_commands(registry, contexts).has_value());

    // R2 startup rejections: skill:// scheme, ui:// wrong mime, ui in entry _meta, duplicate URI,
    // size mismatch, bad RFC 3986 URI char, malformed icons/annotations.
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {
                {.entry = {.uri = "mem://host/a|b", .name = "pipe"}, .bytes = "x"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {
                {.entry = {.uri = "mem://host/ok", .name = "bad-icon", .icons = Json::array({42})},
                 .bytes = "x"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources =
            ResourceProvider{.static_resources = {{.entry = {.uri = "mem://host/ok",
                                                             .name = "bad-ann",
                                                             .annotations = Json{{"priority", 2}}},
                                                   .bytes = "x"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {
                {.entry = {.uri = "skill://a/SKILL.md", .name = "bad"}, .bytes = "x"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {
                {.entry = {.uri = "ui://view/app.html", .name = "app", .mime_type = "text/html"},
                 .bytes = "<div/>"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {{.entry = {.uri = "file:///a.txt",
                                            .name = "a",
                                            .meta = Json{{"ui", {{"resourceUri", "ui://x"}}}}},
                                  .bytes = "hi"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {
                {.entry = {.uri = "file:///a.txt", .name = "a", .size = 99}, .bytes = "hi"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }
    {
        StdioServerOptions opts;
        opts.resources = ResourceProvider{
            .static_resources = {{.entry = {.uri = "file:///a.txt", .name = "a"}, .bytes = "1"},
                                 {.entry = {.uri = "file:///a.txt", .name = "b"}, .bytes = "2"}}};
        CHECK_FALSE(StdioServer::create(registry, std::move(opts)).has_value());
    }

    // Valid static ui:// resource + dynamic resource + skill catalog + contexts.
    auto hook_calls = std::make_shared<std::atomic<int>>(0);
    auto dyn_read_calls = std::make_shared<std::atomic<int>>(0);
    auto return_bad_size = std::make_shared<std::atomic<bool>>(false);
    auto return_bad_list = std::make_shared<std::atomic<bool>>(false);

    StdioServerOptions opts;
    opts.contexts = contexts;
    opts.context_hook = [hook_calls](afd::CommandContext&, const afd::mcp::RequestInfo&) {
        ++*hook_calls;
    };
    opts.resources = ResourceProvider{
        .static_resources =
            {{.entry = {.uri = "ui://hello/view.html",
                        .name = "Hello view",
                        .mime_type = "text/html;profile=mcp-app",
                        .icons = Json::array({Json{{"src", "https://example.com/icon.svg"}}}),
                        .annotations = Json{{"audience", Json::array({"user"})}, {"priority", 0.5}},
                        .meta = Json{{"dev.umbel/origin", "compiled"}}},
              .bytes = "<h1>Hello</h1>",
              .content_meta = Json{{"ui", {{"prefersBorder", true}}}}}},
        .list = [return_bad_list]() -> afd::Expected<std::vector<ResourceEntry>> {
            if (return_bad_list->load()) {
                return std::vector<ResourceEntry>{{.uri = "not a uri", .name = "broken"}};
            }
            return std::vector<ResourceEntry>{
                {.uri = "mem://dyn/item", .name = "Dyn", .mime_type = "text/plain", .size = 5}};
        },
        .read = [return_bad_size, dyn_read_calls](
                    std::string_view uri) -> afd::Expected<std::optional<ResourceContents>> {
            ++*dyn_read_calls;
            if (uri == "mem://dyn/item") {
                return std::optional<ResourceContents>(
                    ResourceContents{.bytes = return_bad_size->load() ? "too-long" : "hello",
                                     .mime_type = "application/octet-stream"});
            }
            return std::optional<ResourceContents>{};
        },
    };
    opts.skills = SkillCatalog{
        .skills = {{.path = "demo",
                    .files = {{.path = "SKILL.md",
                               .bytes =
                                   "---\nname: demo\ndescription: Demo skill.\n---\nBody\n"}}}},
        .directory_read = false,
    };

    auto server = StdioServer::create(registry, std::move(opts));
    REQUIRE_MESSAGE(server.has_value(), server.error());

    // R3: contexts lower tools/list ttlMs to 0, but NEVER lower resources/list or skills/list!
    const Json tl = send_rpc(**server, "tools/list", Json::object(), true, 1);
    CHECK(tl["result"]["ttlMs"] == 0);

    const Json rl = send_rpc(**server, "resources/list",
                             {{"_meta", {{"dev.afd/context", "editing"}}}}, true, 2);
    REQUIRE(rl.contains("result"));
    CHECK(rl["result"]["ttlMs"] == 300000);
    CHECK(rl["result"]["cacheScope"] == "public");
    REQUIRE(rl["result"]["resources"].size() == 3U);
    CHECK(rl["result"]["resources"][0]["uri"] == "ui://hello/view.html");
    CHECK(rl["result"]["resources"][0]["size"] == 14);
    CHECK(rl["result"]["resources"][0]["_meta"]["dev.afd/digest"] ==
          "sha256:" + afd::detail::sha256_hex("<h1>Hello</h1>"));
    CHECK(rl["result"]["resources"][0]["_meta"]["dev.umbel/origin"] == "compiled");
    CHECK(rl["result"]["resources"][1]["uri"] == "mem://dyn/item");
    CHECK(rl["result"]["resources"][2]["uri"] == "skill://demo/SKILL.md");

    // R4: read ui:// returns _meta.ui on content item; context_hook never runs.
    const Json rr_ui =
        send_rpc(**server, "resources/read", {{"uri", "ui://hello/view.html"}}, true, 3);
    REQUIRE(rr_ui.contains("result"));
    CHECK(rr_ui["result"]["contents"][0]["text"] == "<h1>Hello</h1>");
    CHECK(rr_ui["result"]["contents"][0]["_meta"]["ui"]["prefersBorder"] == true);
    CHECK(rr_ui["result"]["ttlMs"] == 300000);
    CHECK(rr_ui["result"]["cacheScope"] == "public");

    const Json rr_dyn = send_rpc(**server, "resources/read", {{"uri", "mem://dyn/item"}}, true, 4);
    REQUIRE(rr_dyn.contains("result"));
    CHECK(rr_dyn["result"]["contents"][0]["text"] == "hello");
    // R4: listed entry's mimeType wins over callback's fallback mime_type.
    CHECK(rr_dyn["result"]["contents"][0]["mimeType"] == "text/plain");
    CHECK(hook_calls->load() == 0);

    // R2 & R4: unknown skill:// URIs must NEVER fall through to dynamic_read_.
    const int calls_before = dyn_read_calls->load();
    const Json missing_skill =
        send_rpc(**server, "resources/read", {{"uri", "SKILL://demo/missing.md"}}, true, 40);
    REQUIRE(missing_skill.contains("error"));
    CHECK(missing_skill["error"]["code"] == -32602);
    CHECK(missing_skill["error"]["data"]["uri"] == "SKILL://demo/missing.md");
    CHECK(dyn_read_calls->load() == calls_before);

    // R4: dynamic read returning wrong byte length answers -32603.
    return_bad_size->store(true);
    const Json bad_sz = send_rpc(**server, "resources/read", {{"uri", "mem://dyn/item"}}, true, 5);
    REQUIRE(bad_sz.contains("error"));
    CHECK(bad_sz["error"]["code"] == -32603);
    return_bad_size->store(false);

    // R2: dynamic list breaking a rule at runtime answers -32603.
    return_bad_list->store(true);
    const Json bad_list = send_rpc(**server, "resources/list", Json::object(), true, 6);
    REQUIRE(bad_list.contains("error"));
    CHECK(bad_list["error"]["code"] == -32603);
}

TEST_CASE("S6 directory reads and S5 MIME table") {
    afd::CommandRegistry registry;
    StdioServerOptions opts;
    opts.skills = SkillCatalog{
        .skills = {{.path = "acme/hello",
                    .files = {{.path = "SKILL.md",
                               .bytes = "---\nname: hello\ndescription: Hello skill.\n---\n"},
                              {.path = "refs/a.yaml", .bytes = "k: v\n"},
                              {.path = "refs/sub/pic.PNG", .bytes = std::string("\x89PNG\r\n", 6)},
                              {.path = "assets/script.ts", .bytes = "export {};\n"}}}},
        .directory_read = true,
    };
    auto server = StdioServer::create(registry, std::move(opts));
    REQUIRE_MESSAGE(server.has_value(), server.error());

    // Capability advertises directoryRead: true on both eras.
    const Json disc = send_rpc(**server, "server/discover", Json::object(), true, 1);
    CHECK(disc["result"]["capabilities"]["extensions"]["io.modelcontextprotocol/skills"] ==
          Json{{"directoryRead", true}});
    const Json init =
        send_rpc(**server, "initialize",
                 {{"protocolVersion", legacy_ver}, {"capabilities", Json::object()}}, false, 2);
    CHECK(init["result"]["capabilities"]["extensions"]["io.modelcontextprotocol/skills"] ==
          Json{{"directoryRead", true}});

    // Root directory children sorted by last segment: SKILL.md, assets, refs.
    const Json root =
        send_rpc(**server, "resources/directory/read", {{"uri", "skill://acme/hello"}}, true, 3);
    REQUIRE(root.contains("result"));
    CHECK(root["result"]["ttlMs"] == 300000);
    CHECK(root["result"]["cacheScope"] == "public");
    const Json& items = root["result"]["resources"];
    REQUIRE(items.size() == 3U);
    CHECK(items[0]["uri"] == "skill://acme/hello/SKILL.md");
    CHECK(items[0]["name"] == "hello"); // S5 name for SKILL.md is frontmatter name
    CHECK(items[1] == Json{{"uri", "skill://acme/hello/assets"},
                           {"name", "assets"},
                           {"mimeType", "inode/directory"}});
    CHECK(items[2] == Json{{"uri", "skill://acme/hello/refs"},
                           {"name", "refs"},
                           {"mimeType", "inode/directory"}});

    // Subdirectory lists both files and nested subdirs with S5 MIME types.
    const Json refs = send_rpc(**server, "resources/directory/read",
                               {{"uri", "skill://acme/hello/refs"}}, false, 4);
    REQUIRE(refs.contains("result"));
    REQUIRE(refs["result"]["resources"].size() == 2U);
    CHECK(refs["result"]["resources"][0]["uri"] == "skill://acme/hello/refs/a.yaml");
    CHECK(refs["result"]["resources"][0]["mimeType"] == "application/yaml");
    CHECK(refs["result"]["resources"][1] == Json{{"uri", "skill://acme/hello/refs/sub"},
                                                 {"name", "sub"},
                                                 {"mimeType", "inode/directory"}});

    // Case-insensitive suffix check (.PNG -> image/png).
    const Json sub = send_rpc(**server, "resources/directory/read",
                              {{"uri", "skill://acme/hello/refs/sub"}}, true, 5);
    REQUIRE(sub.contains("result"));
    CHECK(sub["result"]["resources"][0]["mimeType"] == "image/png");

    // Directory URIs are NOT listed by resources/list.
    const Json rl = send_rpc(**server, "resources/list", Json::object(), true, 6);
    for (const auto& entry : rl["result"]["resources"]) {
        CHECK(entry["mimeType"] != "inode/directory");
    }

    // Unknown directory URI answers -32602.
    const Json missing = send_rpc(**server, "resources/directory/read",
                                  {{"uri", "skill://acme/hello/missing"}}, true, 7);
    REQUIRE(missing.contains("error"));
    CHECK(missing["error"]["code"] == -32602);

    // S2 / S6 collisions: file-vs-directory and cross-skill directory collisions fail startup
    // regardless of directory_read.
    for (const bool dir_read : {false, true}) {
        StdioServerOptions file_dir_conflict;
        file_dir_conflict.skills = SkillCatalog{
            .skills = {{.path = "conflict",
                        .files = {{.path = "SKILL.md",
                                   .bytes = "---\nname: conflict\ndescription: Test.\n---\n"},
                                  {.path = "refs", .bytes = "file"},
                                  {.path = "refs/notes.md", .bytes = "nested"}}}},
            .directory_read = dir_read,
        };
        CHECK_FALSE(StdioServer::create(registry, std::move(file_dir_conflict)).has_value());

        StdioServerOptions cross_dir_conflict;
        cross_dir_conflict.skills = SkillCatalog{
            .skills = {{.path = "a",
                        .files = {{.path = "SKILL.md",
                                   .bytes = "---\nname: a\ndescription: First.\n---\n"},
                                  {.path = "b/foo.txt", .bytes = "x"}}},
                       {.path = "a/b",
                        .files = {{.path = "SKILL.md",
                                   .bytes = "---\nname: b\ndescription: Second.\n---\n"}}}},
            .directory_read = dir_read,
        };
        CHECK_FALSE(StdioServer::create(registry, std::move(cross_dir_conflict)).has_value());
    }

    // S2 RFC 3986 normalization: literal `%` like `50%-off.md` is accepted; UTF-8 vs percent-
    // encoded UTF-8 (`café.md` vs `caf%C3%A9.md`) collides.
    {
        StdioServerOptions pct_ok;
        pct_ok.skills = SkillCatalog{
            .skills = {{.path = "pct",
                        .files = {{.path = "SKILL.md",
                                   .bytes = "---\nname: pct\ndescription: Pct.\n---\n"},
                                  {.path = "50%-off.md", .bytes = "ok"}}}},
        };
        CHECK(StdioServer::create(registry, std::move(pct_ok)).has_value());

        StdioServerOptions utf8_dup;
        utf8_dup.skills = SkillCatalog{
            .skills = {{.path = "utf8dup",
                        .files = {{.path = "SKILL.md",
                                   .bytes = "---\nname: utf8dup\ndescription: Dup.\n---\n"},
                                  {.path = "caf\xC3\xA9.md", .bytes = "1"},
                                  {.path = "caf%C3%A9.md", .bytes = "2"}}}},
        };
        CHECK_FALSE(StdioServer::create(registry, std::move(utf8_dup)).has_value());
    }
}

TEST_CASE("skill_from_directory loads disk skills and enforces limits") {
    std::error_code ec;
    const auto temp_root = std::filesystem::temp_directory_path(ec);
    REQUIRE_FALSE(ec);
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const std::filesystem::path base = temp_root / ("afd_cpp_skill_test_" + std::to_string(stamp));
    std::filesystem::create_directories(base / "refs", ec);
    REQUIRE_FALSE(ec);
    const std::filesystem::path outside =
        temp_root / ("afd_cpp_skill_outside_" + std::to_string(stamp));
    std::filesystem::create_directories(outside, ec);
    REQUIRE_FALSE(ec);
    struct Cleanup {
        std::filesystem::path dir1;
        std::filesystem::path dir2;
        ~Cleanup() {
            std::error_code ignore;
            std::filesystem::remove_all(dir1, ignore);
            std::filesystem::remove_all(dir2, ignore);
        }
    } const cleanup{base, outside};

    // Invalid UTF-8 and missing directory fail cleanly without aborting.
    CHECK_FALSE(afd::mcp::skill_from_directory("bad", std::string("\xFF\xFE", 2)).has_value());
    CHECK_FALSE(
        afd::mcp::skill_from_directory("missing", (base / "no-such-dir").string()).has_value());

    {
        std::ofstream f(base / "SKILL.md", std::ios::binary);
        f << "---\nname: disk-skill\ndescription: Loaded from disk.\n---\n# Body\n";
    }
    {
        std::ofstream f(base / "refs" / "notes.txt", std::ios::binary);
        f << "hello\n";
    }
    {
        std::ofstream f(outside / "secret.txt", std::ios::binary);
        f << "secret\n";
    }

    const auto u8 = base.generic_u8string();
    const std::string dir_str(reinterpret_cast<const char*>(u8.data()), u8.size());
    auto loaded = afd::mcp::skill_from_directory("disk-skill", dir_str);
    REQUIRE_MESSAGE(loaded.has_value(), loaded.error());
    CHECK(loaded->path == "disk-skill");
    CHECK(loaded->files.size() == 2U);

    // Escaping file symlink and directory symlink are refused when the OS allows creating symlinks.
    std::error_code sym_ec;
    std::filesystem::create_symlink(outside / "secret.txt", base / "escape.txt", sym_ec);
    if (!sym_ec) {
        CHECK_FALSE(afd::mcp::skill_from_directory("disk-skill", dir_str).has_value());
        std::filesystem::remove(base / "escape.txt", sym_ec);
    }
    std::filesystem::create_directory_symlink(base / "refs", base / "refs-link", sym_ec);
    if (!sym_ec) {
        CHECK_FALSE(afd::mcp::skill_from_directory("disk-skill", dir_str).has_value());
        std::filesystem::remove(base / "refs-link", sym_ec);
    }

    afd::CommandRegistry registry;
    StdioServerOptions opts;
    opts.skills = SkillCatalog{.skills = {std::move(*loaded)}};
    auto server = StdioServer::create(registry, std::move(opts));
    REQUIRE_MESSAGE(server.has_value(), server.error());
    const Json sl = send_rpc(**server, "skills/list", Json::object(), true, 1);
    REQUIRE(sl["result"]["skills"].size() == 1U);
    CHECK(sl["result"]["skills"][0]["uri"] == "skill://disk-skill/SKILL.md");

    // Limits: > 512 files refused by SkillCatalog validation and by skill_from_directory.
    Skill too_many{.path = "many"};
    too_many.files.push_back(
        {.path = "SKILL.md", .bytes = "---\nname: many\ndescription: Many.\n---\n"});
    for (int i = 0; i < 512; ++i) {
        too_many.files.push_back({.path = "f" + std::to_string(i) + ".txt", .bytes = "x"});
    }
    StdioServerOptions bad_count;
    bad_count.skills = SkillCatalog{.skills = {std::move(too_many)}};
    CHECK_FALSE(StdioServer::create(registry, std::move(bad_count)).has_value());

    const std::filesystem::path many_dir = outside / "many_files";
    std::filesystem::create_directories(many_dir, ec);
    REQUIRE_FALSE(ec);
    for (int i = 0; i < 513; ++i) {
        std::ofstream f(many_dir / ("f" + std::to_string(i) + ".txt"), std::ios::binary);
        f << "x";
    }
    const auto many_u8 = many_dir.generic_u8string();
    const std::string many_str(reinterpret_cast<const char*>(many_u8.data()), many_u8.size());
    CHECK_FALSE(afd::mcp::skill_from_directory("many-disk", many_str).has_value());
}

TEST_CASE("tool_meta and advertised_input_schema work across strategies, afd-detail and "
          "confirmations on StdioServer") {
    afd::CommandRegistry registry;
    const Json validation{
        {"type", "object"},
        {"properties", {{"name", {{"type", "string"}, {"minLength", 2}}}}},
        {"required", Json::array({"name"})},
    };
    const Json advertised{
        {"type", "object"},
        {"properties", {{"name", {{"type", "string"}, {"pattern", "^[a-z]+$"}}}}},
        {"required", Json::array({"name"})},
    };
    afd::CommandDefinition cmd;
    cmd.name = "wrap-delete";
    cmd.description = "Delete a wrapped item";
    cmd.category = "wrap";
    cmd.input_schema = validation;
    cmd.advertised_input_schema = advertised;
    cmd.tool_meta =
        Json{{"dev.umbel/origin", "wrapped"}, {"ui", {{"resourceUri", "ui://wrap/view.html"}}}};
    cmd.confirm_prompt = "Really delete?";
    cmd.expose.mcp = true;
    cmd.handler = [](const Json& input, afd::CommandContext&) {
        return afd::success(Json{{"deleted", input["name"]}});
    };
    REQUIRE_FALSE(registry.register_command(cmd).has_value());

    // 1. Individual strategy: tool carries _meta + advertised schema + injected confirm.
    {
        StdioServerOptions opts;
        opts.tool_strategy = ToolStrategy::individual;
        opts.confirmations = ConfirmationMode::enforce;
        auto server = StdioServer::create(registry, std::move(opts));
        REQUIRE_MESSAGE(server.has_value(), server.error());

        const Json tl = send_rpc(**server, "tools/list", Json::object(), true, 1);
        Json found;
        for (const auto& t : tl["result"]["tools"]) {
            if (t["name"] == "wrap-delete") {
                found = t;
            }
            // Meta-tools never emit tool_meta.
            if (t["name"] == "afd-call") {
                CHECK_FALSE(t.contains("_meta"));
            }
        }
        REQUIRE(found.is_object());
        CHECK(found["inputSchema"]["properties"]["name"]["pattern"] == "^[a-z]+$");
        CHECK(found["inputSchema"]["properties"].contains("confirm"));
        CHECK(found["_meta"]["dev.umbel/origin"] == "wrapped");
        CHECK(found["_meta"]["ui"]["resourceUri"] == "ui://wrap/view.html");

        // Confirm acknowledgement is stripped before validation schema runs, and validation checks
        // minLength (not pattern).
        const Json call = send_rpc(
            **server, "tools/call",
            {{"name", "wrap-delete"}, {"arguments", {{"name", "UPPER"}, {"confirm", true}}}}, true,
            2);
        REQUIRE(call.contains("result"));
        CHECK(call["result"]["isError"] == false);
        CHECK(call["result"]["structuredContent"]["data"]["deleted"] == "UPPER");
    }

    // 2. Grouped strategy: _meta.actions carries extra tool_meta and advertised schema; grouped
    // tool itself never carries top-level tool_meta keys.
    {
        StdioServerOptions opts;
        opts.tool_strategy = ToolStrategy::grouped;
        auto server = StdioServer::create(registry, std::move(opts));
        REQUIRE_MESSAGE(server.has_value(), server.error());

        const Json tl = send_rpc(**server, "tools/list", Json::object(), true, 1);
        Json grp;
        for (const auto& t : tl["result"]["tools"]) {
            if (t["name"] == "wrap") {
                grp = t;
            }
        }
        REQUIRE(grp.is_object());
        CHECK_FALSE(grp["_meta"].contains("dev.umbel/origin"));
        CHECK_FALSE(grp["_meta"].contains("ui"));
        REQUIRE(grp["_meta"]["actions"].size() == 1U);
        const Json& act = grp["_meta"]["actions"][0];
        CHECK(act["dev.umbel/origin"] == "wrapped");
        CHECK(act["ui"]["resourceUri"] == "ui://wrap/view.html");
        CHECK(act["inputSchema"] == advertised);
    }

    // 3. Hybrid strategy: first-class tool equals individual tool (T3), and afd-detail exposes
    // toolMeta and advertised inputSchema.
    {
        StdioServerOptions opts;
        opts.tool_strategy = ToolStrategy::hybrid;
        opts.first_class_tools = std::vector<std::string>{"wrap-delete"};
        auto server = StdioServer::create(registry, std::move(opts));
        REQUIRE_MESSAGE(server.has_value(), server.error());

        const Json tl = send_rpc(**server, "tools/list", Json::object(), true, 1);
        Json fc;
        for (const auto& t : tl["result"]["tools"]) {
            if (t["name"] == "wrap-delete") {
                fc = t;
            }
        }
        REQUIRE(fc.is_object());
        CHECK(fc == afd::command_to_mcp_tool(registry.get("wrap-delete")->definition));

        const Json det = send_rpc(
            **server, "tools/call",
            {{"name", "afd-detail"}, {"arguments", {{"command", "wrap-delete"}}}}, true, 2);
        REQUIRE(det.contains("result"));
        const Json& entry = det["result"]["structuredContent"]["data"][0];
        CHECK(entry["inputSchema"] == advertised);
        CHECK(entry["toolMeta"]["dev.umbel/origin"] == "wrapped");
        CHECK(entry["toolMeta"]["ui"]["resourceUri"] == "ui://wrap/view.html");
    }

    // 4. V2 non-object `properties` in advertised_input_schema does not abort under enforce.
    {
        afd::CommandRegistry r2;
        afd::CommandDefinition odd;
        odd.name = "odd-confirm";
        odd.description = "Odd advertised schema";
        odd.advertised_input_schema = Json{{"type", "object"}, {"properties", Json::array()}};
        odd.confirm_prompt = "Proceed?";
        odd.expose.mcp = true;
        odd.handler = [](const Json&, afd::CommandContext&) { return afd::success(true); };
        REQUIRE_FALSE(r2.register_command(odd).has_value());

        StdioServerOptions opts;
        opts.tool_strategy = ToolStrategy::individual;
        opts.confirmations = ConfirmationMode::enforce;
        auto server = StdioServer::create(r2, std::move(opts));
        REQUIRE_MESSAGE(server.has_value(), server.error());
        const Json tl = send_rpc(**server, "tools/list", Json::object(), true, 1);
        bool saw = false;
        for (const auto& t : tl["result"]["tools"]) {
            if (t["name"] == "odd-confirm") {
                CHECK(t["inputSchema"]["properties"].is_object());
                CHECK(t["inputSchema"]["properties"].contains("confirm"));
                saw = true;
            }
        }
        CHECK(saw);
    }
}

} // namespace resources_test
