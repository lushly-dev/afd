// The language-neutral vectors in spec/vectors/journal-context-cap.json. The generator pads each
// value to a set number of bytes from the journal's 4096-byte cap, measured as UTF-8 canonical
// JSON with numbers as JavaScript writes them, and records what TypeScript keeps
// (spec/journal.md, "Declared context fields").
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <vector>

#include "detail/canonical_json.hpp"
#include "detail/context_fields.hpp"
#include <doctest.h>

namespace {

afd::Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

} // namespace

TEST_CASE("journal context cap vectors measure and keep values as TypeScript does") {
    const afd::Json vectors = load_vectors("journal-context-cap.json");
    CHECK(vectors.at("maxBytes").get<std::size_t>() == afd::detail::max_journal_context_bytes);
    const auto field = vectors.at("field").get<std::string>();
    REQUIRE_FALSE(vectors.at("cases").empty());
    for (const auto& vector : vectors.at("cases")) {
        const auto description = vector.at("description").get<std::string>();
        CAPTURE(description);
        // Parsed as a value from a caller would be.
        auto value = afd::parse_bounded(vector.at("json").get<std::string>());
        REQUIRE(value.has_value());
        const auto canonical = afd::detail::canonical_json_as_read(*value);
        REQUIRE(canonical.has_value());
        CHECK(canonical->size() == vector.at("bytes").get<std::size_t>());

        afd::CommandContext context;
        context.extra[field] = *value;
        context.journaled_fields = std::make_shared<const afd::detail::JournaledContextFields>(
            afd::detail::JournaledContextFields{.names = {field}});
        const afd::detail::JournaledContextValues journaled =
            afd::detail::journaled_context_values(context);
        if (vector.at("expected") == "kept") {
            REQUIRE(journaled.context.has_value());
            CHECK(*journaled.context == afd::Json{{field, *value}});
            CHECK_FALSE(journaled.omitted.has_value());
        } else {
            CHECK_FALSE(journaled.context.has_value());
            CHECK(journaled.omitted == std::vector<std::string>{field});
        }
    }
}
