// The language-neutral vectors in spec/vectors/idempotency.json: idempotency keys
// (spec/idempotency.md). C++ implements none of it yet: the file lists C++ in its `gaps`, and
// every case is skipped here as that documented gap until C++ implements it and leaves the list
// (https://github.com/lushly-dev/afd/issues/2676).
#include "afd/afd.hpp"

#include <cstddef>
#include <fstream>
#include <iterator>
#include <string>

#include <doctest.h>

namespace idempotency_vectors {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

} // namespace idempotency_vectors

TEST_CASE("idempotency.json: C++ is a documented gap") {
    const auto vectors = idempotency_vectors::load("idempotency.json");
    REQUIRE(vectors.at("gaps").contains("cpp"));
    CHECK(vectors.at("gaps").at("cpp").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/2676");
    CHECK(vectors.at("metaKey").get<std::string>() == "dev.afd/idempotencyKey");
    const std::size_t sections[] = {
        vectors.at("declaration").at("cases").size(),
        vectors.at("key").at("form").size(),
        vectors.at("key").at("derived").size(),
        vectors.at("key").at("delivery").size(),
        vectors.at("step").at("cases").size(),
        vectors.at("step").at("options").size(),
        vectors.at("retry").at("cases").size(),
        vectors.at("timeoutRecovery").at("cases").size(),
        vectors.at("journal").at("cases").size(),
    };
    std::size_t total = 0;
    for (const auto size : sections) {
        CHECK(size > 0);
        total += size;
    }
    // When C++ implements them, it leaves `gaps` and this runs the cases instead.
    MESSAGE("skipped " << total << " idempotency cases: documented C++ gap, #2676");
}
