// The language-neutral vectors in spec/vectors/approver-client.json: approval evidence from an
// approver client and the approval display rules (spec/command-metadata.md; Loam phase 5, step
// 0c). TypeScript and Rust implement them. C++ has neither yet: the file lists C++ in its `gaps`,
// and every case is skipped here as that documented gap until C++ implements them and leaves the
// list (https://github.com/lushly-dev/afd/issues/1466).
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>

#include <doctest.h>

namespace {

afd::Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

}  // namespace

TEST_CASE("approver-client.json: C++ is a documented gap") {
    const auto vectors = load_vectors("approver-client.json");
    REQUIRE(vectors.at("gaps").contains("cpp"));
    CHECK(vectors.at("gaps").at("cpp").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1466");
    const auto display = vectors.at("display").at("cases").size();
    const auto carrier = vectors.at("carrier").at("cases").size();
    CHECK(display > 0);
    CHECK(carrier > 0);
    // When C++ implements them, it leaves `gaps` and this runs the cases instead.
    MESSAGE("skipped " << display << " display and " << carrier
                       << " carrier cases: documented C++ gap, #1466");
}
