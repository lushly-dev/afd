// The approval policy and approval middleware (packages/server/src/approval.test.ts and
// approval-metadata.test.ts, #272; spec/command-metadata.md "Approvals").
#include "afd/afd.hpp"

#include <atomic>
#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "detail/hmac.hpp"
#include <doctest.h>

namespace {

const std::string secret = "afd-approval-test-secret-0123456789abcdef";
constexpr std::int64_t start_ms = 1767225600000; // 2026-01-01T00:00:00.000Z

/// A registry with `todo-delete` (approval required unless overridden), `todo-list` (no policy)
/// and the approval middleware. Counts how often each handler ran.
struct Gate {
    std::shared_ptr<afd::ManualClock> clock = afd::fixed_clock(start_ms);
    std::shared_ptr<std::atomic<int>> runs = std::make_shared<std::atomic<int>>(0);
    std::unique_ptr<afd::CommandRegistry> registry;
    std::vector<afd::ApprovalRequest> requests;

    explicit Gate(afd::ApprovalMiddlewareOptions options = {},
                  std::optional<afd::ApprovalPolicy> policy = afd::ApprovalDecision::required) {
        auto counter = runs;
        afd::CommandDefinition remove{
            .name = "todo-delete",
            .description = "Delete a todo",
            .input_schema = {{"type", "object"},
                             {"properties",
                              {{"id", {{"type", "integer"}}},
                               {"hard", {{"type", "boolean"}, {"default", false}}}}},
                             {"required", {"id"}}},
            .handler =
                [counter](const afd::Json& input, afd::CommandContext&) {
                    ++*counter;
                    return afd::success(input);
                },
            .mutation = true,
            .destructive = true,
            .confirm_prompt = "Delete the todo",
            .approval = std::move(policy),
        };
        afd::CommandDefinition list{
            .name = "todo-list",
            .description = "List todos",
            .handler = [](const afd::Json&,
                          afd::CommandContext&) { return afd::success(afd::Json::array()); },
        };
        if (options.secrets.empty()) {
            options.secrets = {secret};
        }
        if (options.commands.empty()) {
            options.commands = {remove, list};
        }
        if (!options.clock) {
            options.clock = clock;
        }
        if (!options.on_approval_required) {
            options.on_approval_required = [this](const afd::ApprovalRequest& request) {
                requests.push_back(request);
            };
        }
        auto middleware = afd::create_approval_middleware(std::move(options));
        REQUIRE_MESSAGE(middleware.has_value(), (middleware ? "" : middleware.error()));
        registry = std::make_unique<afd::CommandRegistry>(
            afd::CommandRegistryOptions{.middleware = {*middleware}});
        REQUIRE(!registry->register_command(std::move(remove)));
        REQUIRE(!registry->register_command(std::move(list)));
    }

    afd::CommandResult call(const afd::Json& input, std::optional<std::string> approval = {},
                            std::optional<afd::Actor> actor = afd::Actor{
                                .kind = afd::ActorKind::agent, .id = "u1"}) const {
        afd::CommandContext context;
        context.actor = std::move(actor);
        context.approval = std::move(approval);
        return registry->execute("todo-delete", input, std::move(context));
    }
};

std::string token_of(const afd::CommandResult& result) {
    REQUIRE(!result.success);
    REQUIRE(result.error);
    REQUIRE(result.error->details);
    return result.error->details->at("approvalToken").get<std::string>();
}

std::string reason_of(const afd::CommandResult& result) {
    REQUIRE(!result.success);
    REQUIRE(result.error->code == "APPROVAL_REQUIRED");
    const auto& details = *result.error->details;
    return details.contains("reason") ? details["reason"].get<std::string>() : "";
}

/// The token's decoded payload JSON.
afd::Json payload_of(const std::string& token) {
    const auto first = token.find('.');
    const auto second = token.find('.', first + 1);
    const auto decoded = afd::detail::base64url_decode(token.substr(first + 1, second - first - 1));
    REQUIRE(decoded);
    return afd::Json::parse(*decoded);
}

/// `payload` re-signed with `key`, so only the payload decides the verdict.
std::string signed_token(const std::string& payload, const std::string& key = secret) {
    const std::string signing_input = "afdap1." + afd::detail::base64url_encode(payload);
    return signing_input + "." +
           afd::detail::base64url_encode(afd::detail::hmac_sha256(key, signing_input));
}

std::string hex(const afd::detail::Sha256Digest& digest) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string out;
    for (const auto byte : digest) {
        out.push_back(digits[byte >> 4]);
        out.push_back(digits[byte & 0xFU]);
    }
    return out;
}

std::string unhex(std::string_view text) {
    std::string out;
    for (std::size_t i = 0; i + 1 < text.size(); i += 2) {
        out.push_back(static_cast<char>(std::stoi(std::string(text.substr(i, 2)), nullptr, 16)));
    }
    return out;
}

} // namespace

TEST_CASE("HMAC-SHA256 matches the RFC 4231 test vectors") {
    struct Case {
        std::string key;
        std::string data;
        std::string mac;
    };
    const std::vector<Case> cases = {
        {std::string(20, '\x0b'), "Hi There",
         "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"},
        {"Jefe", "what do ya want for nothing?",
         "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"},
        {std::string(20, '\xaa'), std::string(50, '\xdd'),
         "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"},
        {unhex("0102030405060708090a0b0c0d0e0f10111213141516171819"), std::string(50, '\xcd'),
         "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"},
        {std::string(131, '\xaa'), "Test Using Larger Than Block-Size Key - Hash Key First",
         "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"},
        {std::string(131, '\xaa'),
         "This is a test using a larger than block-size key and a larger than block-size data. "
         "The key needs to be hashed before being used by the HMAC algorithm.",
         "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"},
    };
    for (const auto& c : cases) {
        CHECK(hex(afd::detail::hmac_sha256(c.key, c.data)) == c.mac);
    }
    // Test case 5 truncates the MAC to 128 bits.
    CHECK(hex(afd::detail::hmac_sha256(std::string(20, '\x0c'), "Test With Truncation"))
              .substr(0, 32) == "a3b6167473100ee06e0c796c2955552b");
}

TEST_CASE("base64url round-trips and decodes strictly") {
    for (const std::string bytes : {"", "f", "fo", "foo", "foob", "fooba", "foobar"}) {
        const auto encoded = afd::detail::base64url_encode(bytes);
        CHECK(encoded.find('=') == std::string::npos);
        CHECK(afd::detail::base64url_decode(encoded) == bytes);
    }
    CHECK(afd::detail::base64url_encode(std::string("\xfb\xff")) == "-_8");
    CHECK_FALSE(afd::detail::base64url_decode("Zm9v="));
    CHECK_FALSE(afd::detail::base64url_decode("Zm+v"));
    CHECK_FALSE(afd::detail::base64url_decode("Z"));
    CHECK_FALSE(afd::detail::base64url_decode("Zh")); // nonzero padding bits
    CHECK(afd::detail::constant_time_equal("abc", "abc"));
    CHECK_FALSE(afd::detail::constant_time_equal("abc", "abd"));
    CHECK_FALSE(afd::detail::constant_time_equal("abc", "ab"));
}

TEST_CASE("approval_mode reports policies, with conditional for a function") {
    CHECK_FALSE(afd::approval_mode(std::nullopt));
    CHECK(afd::approval_mode(afd::ApprovalDecision::required) == afd::ApprovalMode::required);
    CHECK(afd::approval_mode(afd::ApprovalDecision::not_required) ==
          afd::ApprovalMode::not_required);
    const afd::ApprovalPolicyFunction policy = [](const afd::Json&, const afd::CommandContext&) {
        return afd::ApprovalDecision::required;
    };
    CHECK(afd::approval_mode(policy) == afd::ApprovalMode::conditional);
    CHECK(afd::approval_mode_name(afd::ApprovalMode::not_required) == "not-required");
    CHECK(afd::approval_mode_name(afd::ApprovalMode::required) == "required");
    CHECK(afd::approval_mode_name(afd::ApprovalMode::conditional) == "conditional");
    CHECK(afd::approval_rejection_name(afd::ApprovalRejection::invalid_signature) ==
          "invalid-signature");
    CHECK(afd::approval_rejection_name(afd::ApprovalRejection::already_used) == "already-used");
}

TEST_CASE("canonical_json matches TypeScript's canonicalJson") {
    // Expected strings are TypeScript's output for the same values.
    const afd::Json input = afd::Json::parse(
        R"({"id":42,"b":[1.5,"x\u00e9\n\u0001\"\\"],"\ud83d\ude42":true,"\ue000":null,)"
        R"("a":{"z":-0.0,"y":1e21,"x":1.5e-7}})");
    CHECK(afd::canonical_json(input).value() ==
          "{\"a\":{\"x\":1.5e-7,\"y\":1e+21,\"z\":0},\"b\":[1.5,\"x\xc3\xa9\\n\\u0001\\\"\\\\\"],"
          "\"id\":42,\"\xf0\x9f\x99\x82\":true,\"\xee\x80\x80\":null}");
    const std::vector<std::pair<double, std::string>> numbers = {
        {0.1, "0.1"},
        {123.456, "123.456"},
        {1e21, "1e+21"},
        {1e20, "100000000000000000000"},
        {1.5e-7, "1.5e-7"},
        {1e-6, "0.000001"},
        {1e-7, "1e-7"},
        {5e-324, "5e-324"},
        {1.7976931348623157e308, "1.7976931348623157e+308"},
        {-2.5e-10, "-2.5e-10"},
        {123456789012345680000.0, "123456789012345680000"},
        {0.000001234, "0.000001234"},
        {4.35, "4.35"},
        {1.0 / 3.0, "0.3333333333333333"},
        {-0.0, "0"},
        {3.0, "3"},
        // Where a Grisu2 formatter is not shortest; JavaScript always is.
        {0.0029104717, "0.0029104717"},
        {-34077362267111670.0, "-34077362267111670"},
        {9.918674300000001e-16, "9.918674300000001e-16"},
        {77734751.57149825, "77734751.57149825"},
    };
    for (const auto& [number, text] : numbers) {
        CHECK(afd::canonical_json(afd::Json(number)).value() == text);
    }
}

TEST_CASE("canonical_json fails closed on values that could collide") {
    CHECK_FALSE(afd::canonical_json(afd::Json(std::int64_t{9007199254740992})));
    CHECK_FALSE(afd::canonical_json(afd::Json(std::uint64_t{18446744073709551615ULL})));
    CHECK(afd::canonical_json(afd::Json(std::int64_t{-9007199254740991})).value() ==
          "-9007199254740991");
    CHECK_FALSE(afd::canonical_json(afd::Json(std::numeric_limits<double>::infinity())));
    CHECK_FALSE(afd::canonical_json(afd::Json(std::numeric_limits<double>::quiet_NaN())));
    CHECK_FALSE(afd::canonical_json(afd::Json(std::string("\xff"))));
    CHECK_FALSE(afd::canonical_json(afd::Json{{std::string("\xc3"), 1}}));
    CHECK_FALSE(afd::canonical_json(afd::Json::binary({1, 2, 3})));
    afd::Json deep = afd::Json::array();
    for (int i = 0; i < 300; ++i) {
        deep = afd::Json::array({deep});
    }
    CHECK_FALSE(afd::canonical_json(deep));
}

TEST_CASE("a token issued by TypeScript verifies, and C++ tokens have TypeScript's layout") {
    // Issued by TypeScript's createApprovalMiddleware with the same secret, at start_ms, for
    // this command, input and actor.
    const std::string typescript_token =
        "afdap1.eyJjIjoidG9kby1kZWxldGUiLCJpIjoiSjBVNUVQTHpQNU50RVdrbFJxaUtWekN1cVJVaUZsanhjQUFw"
        "ZWdsdk9JOCIsImEiOiJfTDRydmM3YXZybkYwaGhQQjd4aTRWbUhvekl1NHFUVTVNbzdCTEJmRXZNIiwiaWF0Ijox"
        "NzY3MjI1NjAwMDAwLCJleHAiOjE3NjcyMjU5MDAwMDAsIm4iOiJLZS1kNkdlVXdHdDI5TktBdTRxVVB3In0."
        "hmuceFGy2XuSvd2dllrbSsu2AOw2oQz68s3BsEdj4hw";
    const afd::Json input = afd::Json::parse(
        R"({"id":42,"b":[1.5,"x\u00e9\n\u0001\"\\"],"\ud83d\ude42":true,"\ue000":null,)"
        R"("a":{"z":-0.0,"y":1e21,"x":1.5e-7}})");
    const afd::Actor actor{
        .kind = afd::ActorKind::agent, .id = "u1", .label = "Claude", .on_behalf_of = "h1"};

    auto clock = afd::fixed_clock(start_ms);
    afd::ApprovalMiddlewareOptions options{
        .secrets = {secret},
        .commands = {afd::ApprovalCommand("todo-delete", afd::ApprovalDecision::required)},
        .clock = clock,
        .random_bytes =
            [](std::uint8_t* out, std::size_t size) {
                for (std::size_t i = 0; i < size; ++i) {
                    out[i] = static_cast<std::uint8_t>(i);
                }
            },
    };
    auto middleware = afd::create_approval_middleware(std::move(options));
    REQUIRE(middleware);
    int runs = 0;
    const afd::Next next = [&runs] {
        ++runs;
        return afd::success(nullptr);
    };
    afd::CommandContext context;
    context.actor = actor;
    context.approval = typescript_token;
    CHECK((*middleware)("todo-delete", input, context, next).success);
    CHECK(runs == 1);

    // A fresh C++ token for the same call carries the same keyed digests TypeScript computed.
    context.approval.reset();
    const auto held = (*middleware)("todo-delete", input, context, next);
    const std::string token = token_of(held);
    const auto first = token.find('.');
    const auto decoded = afd::detail::base64url_decode(
        token.substr(first + 1, token.find('.', first + 1) - first - 1));
    REQUIRE(decoded);
    CHECK(*decoded ==
          "{\"c\":\"todo-delete\",\"i\":\"J0U5EPLzP5NtEWklRqiKVzCuqRUiFljxcAApeglvOI8\","
          "\"a\":\"_L4rvc7avrnF0hhPB7xi4VmHozIu4qTU5Mo7BLBfEvM\",\"iat\":1767225600000,"
          "\"exp\":1767225900000,\"n\":\"AAECAwQFBgcICQoLDA0ODw\"}");
    CHECK(held.error->details->at("expiresAt") == "2026-01-01T00:05:00.000Z");
}

TEST_CASE("the approval middleware") {
    SUBCASE("runs commands with no policy or a not-required policy") {
        Gate gate({}, afd::ApprovalDecision::not_required);
        CHECK(gate.call({{"id", 1}}).success);
        CHECK(gate.registry->execute("todo-list", afd::Json::object()).success);
        CHECK(*gate.runs == 1);
        CHECK(gate.requests.empty());
    }

    SUBCASE("holds a required command before the handler with a resumable APPROVAL_REQUIRED") {
        Gate gate;
        const auto result = gate.call({{"id", 42}});
        CHECK(*gate.runs == 0);
        REQUIRE(result.error);
        CHECK(result.error->code == "APPROVAL_REQUIRED");
        CHECK(result.error->message == "todo-delete needs approval before it runs");
        CHECK(result.error->retryable == false);
        const auto& details = *result.error->details;
        CHECK(details["approvalToken"].get<std::string>().rfind("afdap1.", 0) == 0);
        CHECK(details["expiresAt"] == "2026-01-01T00:05:00.000Z");
        CHECK(details["summary"] == "Delete the todo");
        CHECK_FALSE(details.contains("reason"));
        CHECK(*result.error->suggestion ==
              "Ask the user to approve \"Delete the todo\"; once they approve, the application "
              "retries the same call with the same input and details.approvalToken as its "
              "approval evidence (tool arguments cannot carry it). The token expires at "
              "2026-01-01T00:05:00.000Z and works once.");
        const auto payload = payload_of(details["approvalToken"].get<std::string>());
        CHECK(payload["c"] == "todo-delete");
        CHECK(payload["iat"] == start_ms);
        CHECK(payload["exp"] == start_ms + 300000);
        CHECK(payload["n"].get<std::string>().size() == 22);
        REQUIRE(gate.requests.size() == 1);
        CHECK(gate.requests[0].command == "todo-delete");
        CHECK(gate.requests[0].input == afd::Json{{"id", 42}, {"hard", false}});
        CHECK(gate.requests[0].approval_token == details["approvalToken"].get<std::string>());
        CHECK_FALSE(gate.requests[0].rejected);
    }

    SUBCASE("runs the command when retried with the token") {
        Gate gate;
        const auto token = token_of(gate.call({{"id", 42}}));
        const auto result = gate.call({{"id", 42}}, token);
        CHECK(result.success);
        CHECK(*gate.runs == 1);
    }

    SUBCASE("binds the validated input, so defaults and key order do not matter") {
        Gate gate;
        const auto token = token_of(gate.call({{"id", 42}}));
        CHECK(gate.call({{"hard", false}, {"id", 42}}, token).success);
    }

    SUBCASE("ignores the actor label, which is display text") {
        Gate gate;
        const auto token = token_of(
            gate.call({{"id", 1}}, {},
                      afd::Actor{.kind = afd::ActorKind::agent, .id = "u1", .label = "first"}));
        CHECK(gate.call({{"id", 1}}, token,
                        afd::Actor{.kind = afd::ActorKind::agent, .id = "u1", .label = "second"})
                  .success);
    }
}

TEST_CASE("the approval middleware rejects") {
    Gate gate;
    const auto token = token_of(gate.call({{"id", 42}}));
    const auto first = token.find('.');
    const auto second = token.find('.', first + 1);
    const std::string payload =
        *afd::detail::base64url_decode(token.substr(first + 1, second - first - 1));

    SUBCASE("a token whose payload was changed") {
        auto changed = payload;
        changed.replace(changed.find("todo-delete"), 11, "todo-delexe");
        const std::string forged =
            "afdap1." + afd::detail::base64url_encode(changed) + "." + token.substr(second + 1);
        CHECK(reason_of(gate.call({{"id", 42}}, forged)) == "invalid-signature");
    }

    SUBCASE("a token whose signature was changed") {
        auto forged = token;
        forged.back() = forged.back() == 'A' ? 'B' : 'A';
        CHECK(reason_of(gate.call({{"id", 42}}, forged)) == "invalid-signature");
    }

    SUBCASE("another spelling of a valid signature") {
        // Padding is not part of the one accepted spelling.
        CHECK(reason_of(gate.call({{"id", 42}}, token + "=")) == "invalid-signature");
    }

    SUBCASE("a token signed with another secret") {
        Gate other({.secrets = {std::string(40, 'z')}});
        const auto foreign = token_of(other.call({{"id", 42}}));
        CHECK(reason_of(gate.call({{"id", 42}}, foreign)) == "invalid-signature");
    }

    SUBCASE("an expired token, by the middleware's clock") {
        gate.clock->set(start_ms + 300000);
        const auto result = gate.call({{"id", 42}}, token);
        CHECK(reason_of(result) == "expired");
        CHECK(*gate.runs == 0);
        // The result carries a fresh token, which works.
        CHECK(gate.call({{"id", 42}}, token_of(result)).success);
    }

    SUBCASE("a token for another command") {
        auto other = payload;
        other.replace(other.find("todo-delete"), 11, "todo-archive");
        CHECK(reason_of(gate.call({{"id", 42}}, signed_token(other))) == "command-mismatch");
    }

    SUBCASE("a token for another input") {
        CHECK(reason_of(gate.call({{"id", 43}}, token)) == "input-mismatch");
        CHECK(reason_of(gate.call({{"id", 42}, {"hard", true}}, token)) == "input-mismatch");
    }

    SUBCASE("a token for another actor") {
        CHECK(reason_of(gate.call({{"id", 42}}, token,
                                  afd::Actor{.kind = afd::ActorKind::agent, .id = "u2"})) ==
              "actor-mismatch");
        CHECK(reason_of(gate.call({{"id", 42}}, token,
                                  afd::Actor{.kind = afd::ActorKind::human, .id = "u1"})) ==
              "actor-mismatch");
        CHECK(reason_of(gate.call(
                  {{"id", 42}}, token,
                  afd::Actor{.kind = afd::ActorKind::agent, .id = "u1", .on_behalf_of = "h1"})) ==
              "actor-mismatch");
    }

    SUBCASE("a token issued with no actor, presented by one") {
        const auto anonymous = token_of(gate.call({{"id", 42}}, {}, std::nullopt));
        CHECK(reason_of(gate.call({{"id", 42}}, anonymous)) == "actor-mismatch");
        CHECK(gate.call({{"id", 42}}, anonymous, std::nullopt).success);
    }

    SUBCASE("a reused single-use token") {
        CHECK(gate.call({{"id", 42}}, token).success);
        const auto again = gate.call({{"id", 42}}, token);
        CHECK(reason_of(again) == "already-used");
        CHECK(*gate.runs == 1);
        CHECK(gate.requests.back().rejected == afd::ApprovalRejection::already_used);
        CHECK(again.error->suggestion->rfind(
                  "The approval token was not accepted (already-used). Ask the user", 0) == 0);
    }

    SUBCASE("malformed evidence") {
        for (const std::string& evidence : std::vector<std::string>{
                 std::string(), std::string("afdap1"), std::string("afdap1.x"),
                 "afdap2" + token.substr(first), token + ".extra", std::string(2000, 'a'),
                 "afdap1.." + token.substr(second + 1)}) {
            CHECK(reason_of(gate.call({{"id", 42}}, evidence)) ==
                  (evidence.rfind("afdap1..", 0) == 0 ? "invalid-signature" : "malformed"));
        }
        CHECK(*gate.runs == 0);
    }

    SUBCASE("a validly signed payload that is not a token") {
        for (const std::string& bad : std::vector<std::string>{
                 std::string("[]"), std::string("not json"), std::string("{\"c\":\"todo-delete\"}"),
                 std::string("{\"c\":1,\"i\":\"\",\"a\":\"\",\"iat\":0,\"exp\":0,\"n\":\"\"}"),
                 std::string("{\"c\":\"todo-delete\",\"i\":\"\",\"a\":\"\",\"iat\":\"0\",\"exp\":9,"
                             "\"n\":\"\"}")}) {
            CHECK(reason_of(gate.call({{"id", 42}}, signed_token(bad))) == "malformed");
        }
        // Payload bytes that are not base64url, under a valid MAC.
        const std::string signing_input = "afdap1.!!!!";
        const std::string mac =
            afd::detail::base64url_encode(afd::detail::hmac_sha256(secret, signing_input));
        CHECK(reason_of(gate.call({{"id", 42}}, signing_input + "." + mac)) == "malformed");
    }
}

TEST_CASE("approval replay") {
    SUBCASE("within_ttl lets a token run the same call again until it expires") {
        Gate gate({.replay = afd::ApprovalReplay::within_ttl});
        const auto held = gate.call({{"id", 7}});
        CHECK(held.error->suggestion->find("and works once") == std::string::npos);
        const auto token = token_of(held);
        CHECK(gate.call({{"id", 7}}, token).success);
        CHECK(gate.call({{"id", 7}}, token).success);
        gate.clock->advance(300000);
        CHECK(reason_of(gate.call({{"id", 7}}, token)) == "expired");
        CHECK(*gate.runs == 2);
    }

    SUBCASE("records nonces in a supplied store, and treats only true as unused") {
        struct Store final : afd::ApprovalNonceStore {
            std::vector<std::pair<std::string, std::int64_t>> seen;
            bool answer = true;
            bool consume(std::string_view nonce, std::int64_t expires_at_ms) override {
                seen.emplace_back(std::string(nonce), expires_at_ms);
                return answer;
            }
        };
        auto store = std::make_shared<Store>();
        Gate gate({.nonce_store = store});
        const auto token = token_of(gate.call({{"id", 7}}));
        CHECK(gate.call({{"id", 7}}, token).success);
        REQUIRE(store->seen.size() == 1);
        CHECK(store->seen[0].first == payload_of(token)["n"].get<std::string>());
        CHECK(store->seen[0].second == start_ms + 300000);
        store->answer = false;
        CHECK(reason_of(gate.call({{"id", 7}}, token)) == "already-used");
    }

    SUBCASE("forgets spent nonces once their token has expired, without reviving them") {
        Gate gate;
        const auto token = token_of(gate.call({{"id", 7}}));
        CHECK(gate.call({{"id", 7}}, token).success);
        gate.clock->advance(300000);
        CHECK(reason_of(gate.call({{"id", 7}}, token)) == "expired");
    }
}

TEST_CASE("approval policies") {
    SUBCASE("a function policy decides from the input and context") {
        const afd::ApprovalPolicyFunction policy = [](const afd::Json& input,
                                                      const afd::CommandContext& context) {
            const bool agent = context.actor && context.actor->kind == afd::ActorKind::agent;
            return agent || input.value("hard", false) ? afd::ApprovalDecision::required
                                                       : afd::ApprovalDecision::not_required;
        };
        Gate gate({}, policy);
        CHECK(gate.call({{"id", 1}}, {}, afd::Actor{.kind = afd::ActorKind::human}).success);
        CHECK(reason_of(gate.call({{"id", 1}, {"hard", true}}, {},
                                  afd::Actor{.kind = afd::ActorKind::human})) == "");
        CHECK(reason_of(gate.call({{"id", 1}})) == "");
        CHECK(*gate.runs == 1);
    }

    SUBCASE("fails closed when a policy returns anything but not_required") {
        const afd::ApprovalPolicyFunction policy = [](const afd::Json&,
                                                      const afd::CommandContext&) {
            return static_cast<afd::ApprovalDecision>(7);
        };
        Gate gate({}, policy);
        CHECK(reason_of(gate.call({{"id", 1}})) == "");
        CHECK(*gate.runs == 0);
    }

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
    SUBCASE("fails the call when a policy throws: the handler does not run") {
        const afd::ApprovalPolicyFunction policy =
            [](const afd::Json&, const afd::CommandContext&) -> afd::ApprovalDecision {
            throw std::runtime_error("policy store offline");
        };
        Gate gate({}, policy);
        const auto result = gate.call({{"id", 1}});
        REQUIRE(result.error);
        CHECK(result.error->code == "COMMAND_EXECUTION_ERROR");
        CHECK(*gate.runs == 0);
    }
#endif

    SUBCASE("an input that cannot be bound fails without running the handler") {
        afd::CommandDefinition big{
            .name = "big-run",
            .description = "Takes any number",
            .input_schema = {{"type", "object"}},
            .handler = [](const afd::Json&, afd::CommandContext&) { return afd::success(nullptr); },
            .approval = afd::ApprovalDecision::required,
        };
        auto middleware = afd::create_approval_middleware({.secrets = {secret}, .commands = {big}});
        REQUIRE(middleware);
        afd::CommandRegistry registry({.middleware = {*middleware}});
        REQUIRE(!registry.register_command(big));
        const auto result =
            registry.execute("big-run", {{"n", std::uint64_t{18446744073709551615ULL}}});
        REQUIRE(result.error);
        CHECK(result.error->code == "COMMAND_EXECUTION_ERROR");
        CHECK(result.error->suggestion);
    }
}

TEST_CASE("approval middleware options") {
    SUBCASE("uses summarize, then the confirm_prompt, then Run <command>") {
        Gate summarized({.summarize = [](std::string_view command, const afd::Json& input,
                                         const afd::CommandContext&) -> std::optional<std::string> {
            return std::string(command) + " #" + input["id"].dump();
        }});
        CHECK(summarized.call({{"id", 42}}).error->details->at("summary") == "todo-delete #42");

        Gate empty({.summarize = [](std::string_view, const afd::Json&, const afd::CommandContext&)
                        -> std::optional<std::string> { return std::string(); }});
        CHECK(empty.call({{"id", 42}}).error->details->at("summary") == "Delete the todo");

        Gate plain(
            {.commands = {afd::ApprovalCommand("todo-delete", afd::ApprovalDecision::required)}});
        CHECK(plain.call({{"id", 42}}).error->details->at("summary") == "Run todo-delete");
    }

    SUBCASE("can leave the token out of the result and hand it to on_approval_required") {
        Gate gate({.include_token = false});
        const auto result = gate.call({{"id", 42}});
        CHECK_FALSE(result.error->details->contains("approvalToken"));
        CHECK(result.error->suggestion->find("recorded the approval") != std::string::npos);
        REQUIRE(gate.requests.size() == 1);
        CHECK(gate.call({{"id", 42}}, gate.requests[0].approval_token).success);
    }

    SUBCASE("passes the rejection to on_approval_required") {
        Gate gate;
        (void)gate.call({{"id", 42}}, std::string("afdap1.bad.token"));
        REQUIRE(gate.requests.size() == 1);
        CHECK(gate.requests[0].rejected == afd::ApprovalRejection::invalid_signature);
        CHECK(gate.requests[0].actor->id == "u1");
    }

    SUBCASE("verifies tokens signed with any rotated key and signs with the first") {
        const std::string old_key(32, 'o');
        const std::string new_key(32, 'n');
        Gate old_gate({.secrets = {old_key}});
        const auto old_token = token_of(old_gate.call({{"id", 42}}));
        Gate rotated({.secrets = {new_key, old_key}});
        CHECK(rotated.call({{"id", 42}}, old_token).success);
        const auto new_token = token_of(rotated.call({{"id", 42}}));
        Gate new_only({.secrets = {new_key}});
        CHECK(new_only.call({{"id", 42}}, new_token).success);
        CHECK(reason_of(old_gate.call({{"id", 42}}, new_token)) == "invalid-signature");
    }

    SUBCASE("never takes security time from the context clock") {
        Gate gate;
        const auto token = token_of(gate.call({{"id", 42}}));
        gate.clock->set(start_ms + 600000);
        afd::CommandContext context;
        context.actor = afd::Actor{.kind = afd::ActorKind::agent, .id = "u1"};
        context.approval = token;
        context.clock = afd::fixed_clock(start_ms);
        CHECK(reason_of(gate.registry->execute("todo-delete", {{"id", 42}}, context)) == "expired");
    }

    SUBCASE("a ttl_ms sets the expiry") {
        Gate gate({.ttl_ms = 1000});
        const auto token = token_of(gate.call({{"id", 42}}));
        CHECK(payload_of(token)["exp"] == start_ms + 1000);
        gate.clock->advance(999);
        CHECK(gate.call({{"id", 42}}, token).success);
    }

    SUBCASE("never holds a command that is not in its list") {
        Gate gate({.commands = {afd::ApprovalCommand("todo-list", std::nullopt)}});
        CHECK(gate.call({{"id", 42}}).success);
    }
}

TEST_CASE("approval middleware configuration errors") {
    const afd::ApprovalCommand command("todo-delete", afd::ApprovalDecision::required);
    SUBCASE("requires a secret, with no default") {
        const auto middleware = afd::create_approval_middleware({.commands = {command}});
        REQUIRE_FALSE(middleware);
        CHECK(middleware.error() == "Approval secret is required");
    }
    SUBCASE("rejects secrets shorter than 32 bytes") {
        CHECK_FALSE(afd::create_approval_middleware({.secrets = {std::string(31, 'k')}}));
        CHECK_FALSE(afd::create_approval_middleware(
            {.secrets = {std::string(32, 'k'), std::string("short")}}));
        CHECK(afd::create_approval_middleware({.secrets = {std::string(32, 'k')}}));
    }
    SUBCASE("rejects a ttl_ms that is not positive or exceeds 24 hours") {
        for (const std::int64_t ttl : {std::int64_t{0}, std::int64_t{-1}, std::int64_t{86400001}}) {
            CHECK_FALSE(afd::create_approval_middleware({.secrets = {secret}, .ttl_ms = ttl}));
        }
        CHECK(afd::create_approval_middleware({.secrets = {secret}, .ttl_ms = 86400000}));
    }
    SUBCASE("rejects an empty policy function") {
        const auto middleware = afd::create_approval_middleware(
            {.secrets = {secret},
             .commands = {afd::ApprovalCommand("todo-delete", afd::ApprovalPolicyFunction{})}});
        REQUIRE_FALSE(middleware);
        CHECK(middleware.error().find("todo-delete") != std::string::npos);
    }
}

TEST_CASE("the journal names approval evidence in the context digest, never its value") {
    afd::CommandContext context;
    context.approval = "afdap1.secret.token";
    const auto digest = afd::create_context_digest(context);
    afd::CommandContext without;
    CHECK(digest.hash != afd::create_context_digest(without).hash);
    afd::CommandContext other;
    other.approval = "afdap1.another.token";
    CHECK(digest.hash == afd::create_context_digest(other).hash);
}
