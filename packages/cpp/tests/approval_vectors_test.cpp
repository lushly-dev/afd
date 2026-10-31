// The language-neutral vectors in spec/vectors/approval-tokens.json. The generator builds them from
// the documented token format, with canonical JSON from the TypeScript reference, so a C++ token
// verifies in every other language and theirs verify here (spec/command-metadata.md, "Approvals").
#include "afd/afd.hpp"

#include <cstdint>
#include <fstream>
#include <iterator>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "detail/hmac.hpp"
#include <doctest.h>

namespace {

afd::Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

/// One middleware, as a case configures it: `secrets` (the first signs), `now`, `replay`, and
/// `nonce` as the random source when given.
afd::CommandMiddleware gate(const afd::Json& vectors, const afd::Json& config,
                            std::optional<std::string> nonce = std::nullopt) {
    afd::ApprovalMiddlewareOptions options;
    if (config.contains("secrets")) {
        for (const auto& name : config.at("secrets")) {
            options.secrets.push_back(vectors.at("secrets").at(name.get<std::string>()));
        }
    } else {
        options.secrets.push_back(vectors.at("secrets").at("current"));
    }
    for (const auto& name : vectors.at("commands")) {
        options.commands.emplace_back(name.get<std::string>(), afd::ApprovalDecision::required);
    }
    options.clock =
        afd::fixed_clock(config.contains("now") ? config.at("now").get<std::int64_t>()
                                                : vectors.at("now").get<std::int64_t>());
    if (config.contains("replay") && config.at("replay") == "within-ttl") {
        options.replay = afd::ApprovalReplay::within_ttl;
    }
    if (nonce) {
        options.random_bytes = [bytes = *nonce](std::uint8_t* out, std::size_t size) {
            REQUIRE(size == bytes.size());
            for (std::size_t i = 0; i < size; ++i) {
                out[i] = static_cast<std::uint8_t>(bytes[i]);
            }
        };
    }
    auto middleware = afd::create_approval_middleware(std::move(options));
    REQUIRE_MESSAGE(middleware.has_value(), (middleware ? "" : middleware.error()));
    return *middleware;
}

afd::CommandResult call(const afd::Json& vectors, const afd::CommandMiddleware& middleware,
                        const afd::Json& vector, std::optional<std::string> token) {
    afd::CommandContext context;
    if (!vector.at("actor").is_null()) {
        auto actor =
            afd::Actor::from_json(vectors.at("actors").at(vector.at("actor").get<std::string>()));
        REQUIRE(actor);
        context.actor = *actor;
    }
    context.approval = std::move(token);
    const afd::Next next = [] { return afd::success("ran"); };
    return middleware(vector.at("command").get<std::string>(), vector.at("input"), context, next);
}

std::string outcome(const afd::CommandResult& result) {
    if (result.success) {
        return "accepted";
    }
    REQUIRE(result.error);
    REQUIRE(result.error->code == "APPROVAL_REQUIRED");
    const auto& details = result.error->details;
    return details && details->contains("reason") ? details->at("reason").get<std::string>()
                                                  : "held";
}

} // namespace

TEST_CASE("approval token bindings canonicalize, issue and verify as the vectors do") {
    const auto vectors = load_vectors("approval-tokens.json");
    for (const auto& binding : vectors.at("bindings")) {
        CAPTURE(binding.at("description").get<std::string>());
        const auto canonical = afd::canonical_json(binding.at("input"));
        REQUIRE(canonical);
        CHECK(*canonical == binding.at("canonicalInput").get<std::string>());

        // With the vector's nonce as the random source, C++ issues the vector token exactly.
        const auto nonce = afd::detail::base64url_decode(binding.at("nonce").get<std::string>());
        REQUIRE(nonce);
        const auto issuing = gate(vectors, afd::Json::object(), *nonce);
        const auto held = call(vectors, issuing, binding, std::nullopt);
        REQUIRE(held.error);
        REQUIRE(held.error->details);
        CHECK(held.error->details->at("approvalToken") == binding.at("token"));

        const auto verifying = gate(vectors, afd::Json::object());
        CHECK(outcome(call(vectors, verifying, binding, binding.at("token").get<std::string>())) ==
              "accepted");
    }
}

TEST_CASE("approval tokens verify as the vectors expect") {
    const auto vectors = load_vectors("approval-tokens.json");
    for (const auto& vector : vectors.at("verify")) {
        CAPTURE(vector.at("description").get<std::string>());
        const auto middleware = gate(vectors, vector);
        std::vector<std::string> outcomes;
        std::vector<std::string> expected;
        for (const auto& want : vector.at("expected")) {
            expected.push_back(want.get<std::string>());
            outcomes.push_back(
                outcome(call(vectors, middleware, vector, vector.at("token").get<std::string>())));
        }
        CHECK(outcomes == expected);
    }
}
