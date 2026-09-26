#include "afd/afd.hpp"

#include <doctest.h>

TEST_CASE("header and library versions agree") {
    CHECK(afd::header_version == afd::library_version());
    CHECK(afd::header_version == AFD_VERSION_STRING);
}

TEST_CASE("malformed JSON is reported as a value, never thrown") {
    for (const char* text : {"{", "[1,]", "nul", "{\"a\":}"}) {
        const afd::Json parsed = afd::Json::parse(text, nullptr, /*allow_exceptions=*/false);
        CHECK(parsed.is_discarded());
    }
}

TEST_CASE("object equality ignores key order") {
    const afd::Json a = afd::Json::parse(R"({"a":1,"b":[true,null]})", nullptr, false);
    const afd::Json b = afd::Json::parse(R"({"b":[true,null],"a":1})", nullptr, false);
    CHECK(a == b);
}
