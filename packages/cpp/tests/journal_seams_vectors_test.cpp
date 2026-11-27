// The language-neutral vectors in spec/vectors/journal-seams.json: the dispatch id
// (spec/dispatch.md, "The dispatch id") and the approval summary (spec/command-metadata.md, "The
// approval summary"). C++ implements neither yet: the file lists C++ in its `gaps`, and every
// case is skipped here as that documented gap until C++ implements them and leaves the list
// (https://github.com/lushly-dev/afd/issues/2682).
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>

#include <doctest.h>

namespace journal_seams {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

} // namespace journal_seams

TEST_CASE("journal-seams.json: C++ is a documented gap") {
    const auto vectors = journal_seams::load("journal-seams.json");
    REQUIRE(vectors.at("gaps").contains("cpp"));
    CHECK(vectors.at("gaps").at("cpp").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/2682");
    CHECK(vectors.at("dispatchId").at("format").at("length").get<int>() == 22);
    const auto dispatch_id = vectors.at("dispatchId").at("cases").size();
    const auto approval_summary = vectors.at("approvalSummary").at("cases").size();
    CHECK(dispatch_id > 0);
    CHECK(approval_summary > 0);
    // When C++ implements them, it leaves `gaps` and this runs the cases instead.
    MESSAGE("skipped " << dispatch_id << " dispatch id and " << approval_summary
                       << " approval summary cases: documented C++ gap, #2682");
}
