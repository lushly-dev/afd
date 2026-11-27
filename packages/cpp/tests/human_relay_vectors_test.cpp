// The language-neutral vectors in spec/vectors/human-relay.json: the relay's pending list
// (spec/command-metadata.md, "The pending list"). Rust implements it. C++ has no HumanRelay
// (afd::mcp_stdio confirms nothing through a host), so the file lists C++ in its `gaps` as not
// applicable, and the cases are skipped here.
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>

#include <doctest.h>

namespace human_relay_vectors {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

} // namespace human_relay_vectors

TEST_CASE("human-relay.json: C++ has no relay") {
    const auto vectors = human_relay_vectors::load("human-relay.json");
    REQUIRE(vectors.at("gaps").contains("cpp"));
    CHECK(vectors.at("gaps").at("cpp").get<std::string>() ==
          "not applicable: afd::mcp_stdio has no HumanRelay");
    const auto pending = vectors.at("pending").size();
    const auto invalid = vectors.at("invalid").size();
    CHECK(pending > 0);
    CHECK(invalid > 0);
    MESSAGE("skipped " << pending << " pending and " << invalid
                       << " invalid cases: C++ has no HumanRelay");
}
