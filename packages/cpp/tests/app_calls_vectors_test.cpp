// The language-neutral vectors in spec/vectors/app-calls.json: app-to-app calls and the `apps`
// exposure flag (spec/command-metadata.md, "App-to-app calls"; Loam phase 5, step 0b). TypeScript
// and Rust implement them. C++ has neither yet: the file lists C++ in its `gaps`, and every case
// is skipped here as that documented gap until C++ implements them and leaves the list
// (https://github.com/lushly-dev/afd/issues/1513). Meanwhile no `afd::Interface` names apps.
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>

#include <doctest.h>

namespace app_calls {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

} // namespace app_calls

TEST_CASE("app-calls.json: C++ is a documented gap") {
    const auto vectors = app_calls::load("app-calls.json");
    REQUIRE(vectors.at("gaps").contains("cpp"));
    CHECK(vectors.at("gaps").at("cpp").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1513");
    CHECK(vectors.at("refusal").at("code").get<std::string>() ==
          afd::error_codes::CALL_NOT_GRANTED);
    const auto exposure = vectors.at("exposure").size();
    const auto calls = vectors.at("calls").size() + vectors.at("batches").size();
    CHECK(exposure > 0);
    CHECK(calls > 0);
    // When C++ implements them, it leaves `gaps` and this runs the cases instead.
    MESSAGE("skipped " << exposure << " exposure and " << calls
                       << " call cases: documented C++ gap, #1513");
}
