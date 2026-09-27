#include "afd/json.hpp"

#include <string>

#include <doctest.h>

namespace {

std::string nested_arrays(std::size_t depth) {
    return std::string(depth, '[') + std::string(depth, ']');
}

} // namespace

TEST_CASE("wire::number writes integral values as integers, as JSON.stringify does") {
    // The values the Phase 0 spike found nlohmann writing differently from JavaScript.
    CHECK(afd::wire::serialize(afd::wire::number(0.0)) == "0");
    CHECK(afd::wire::serialize(afd::wire::number(1.0)) == "1");
    CHECK(afd::wire::serialize(afd::wire::number(-0.0)) == "0");
    CHECK(afd::wire::serialize(afd::wire::number(123456789012.0)) == "123456789012");
    CHECK(afd::wire::serialize(afd::wire::number(9007199254740991.0)) == "9007199254740991");
    CHECK(afd::wire::serialize(afd::wire::number(0.75)) == "0.75");
    CHECK(afd::wire::serialize(afd::wire::number(0.1 + 0.2)) == "0.30000000000000004");
    // Beyond 2^53 - 1 a double is no longer an exact integer; keep it as a double.
    CHECK(afd::wire::number(9007199254740992.0).is_number_float());
}

TEST_CASE("wire::number writes non-finite values as null, as JSON.stringify does") {
    CHECK(afd::wire::number(std::numeric_limits<double>::quiet_NaN()).is_null());
    CHECK(afd::wire::number(std::numeric_limits<double>::infinity()).is_null());
}

TEST_CASE("wire::iso8601_utc matches Date.prototype.toISOString") {
    CHECK(afd::wire::iso8601_utc(0) == "1970-01-01T00:00:00.000Z");
    CHECK(afd::wire::iso8601_utc(1767225600000) == "2026-01-01T00:00:00.000Z");
    CHECK(afd::wire::iso8601_utc(1709210096789) == "2024-02-29T12:34:56.789Z");
    CHECK(afd::wire::iso8601_utc(951782400000) == "2000-02-29T00:00:00.000Z");
    CHECK(afd::wire::iso8601_utc(-1) == "1969-12-31T23:59:59.999Z");
    CHECK(afd::wire::iso8601_utc(253402300799999) == "9999-12-31T23:59:59.999Z");
}

TEST_CASE("parse_bounded accepts the depth limit and rejects one level more") {
    const afd::ParseLimits limits{.max_depth = 64};
    CHECK(afd::parse_bounded(nested_arrays(64), limits).has_value());
    const auto too_deep = afd::parse_bounded(nested_arrays(65), limits);
    REQUIRE_FALSE(too_deep.has_value());
    CHECK(too_deep.error().kind == afd::JsonParseError::Kind::too_deep);
    // Objects count the same as arrays.
    CHECK(afd::parse_bounded(R"({"a":{"b":1}})", afd::ParseLimits{.max_depth = 2}).has_value());
    CHECK_FALSE(
        afd::parse_bounded(R"({"a":{"b":{}}})", afd::ParseLimits{.max_depth = 2}).has_value());
    // Scalars have no depth.
    CHECK(afd::parse_bounded("42", afd::ParseLimits{.max_depth = 0}).has_value());
}

TEST_CASE("parse_bounded fails on the depth limit even though nlohmann reports success") {
    // A rejecting parser callback drops the subtree and still returns a value (Phase 0 spike).
    const auto result = afd::parse_bounded(R"({"ok":1,"deep":[[[1]]]})", {.max_depth = 2});
    REQUIRE_FALSE(result.has_value());
    CHECK(result.error().kind == afd::JsonParseError::Kind::too_deep);
}

TEST_CASE("parse_bounded rejects deep hostile input without overflowing the stack") {
    const auto result = afd::parse_bounded(nested_arrays(100000));
    REQUIRE_FALSE(result.has_value());
    CHECK(result.error().kind == afd::JsonParseError::Kind::too_deep);
    CHECK(result.error().message == "JSON input is nested deeper than 256 levels");
}

TEST_CASE("parse_bounded rejects oversized and malformed input") {
    const auto large = afd::parse_bounded("[1,2,3]", {.max_depth = 256, .max_bytes = 4});
    REQUIRE_FALSE(large.has_value());
    CHECK(large.error().kind == afd::JsonParseError::Kind::too_large);
    for (const char* text : {"", "{", "[1,]", "nul", "{\"a\":}", "\"\\uD800\"", "\"\xff\""}) {
        CAPTURE(text);
        const auto malformed = afd::parse_bounded(text);
        REQUIRE_FALSE(malformed.has_value());
        CHECK(malformed.error().kind == afd::JsonParseError::Kind::malformed);
    }
}

TEST_CASE("wire::serialize replaces invalid UTF-8 instead of aborting") {
    const afd::Json value = std::string("bad \xff byte");
    CHECK(afd::wire::serialize(value) == "\"bad \xEF\xBF\xBD byte\"");
}

TEST_CASE("Json equality is structural and ignores key order") {
    CHECK(afd::Json::parse(R"({"a":1,"b":[1,{"c":null}]})") ==
          afd::Json::parse(R"({"b":[1,{"c":null}],"a":1})"));
    CHECK(afd::Json(0) == afd::Json(0.0));
    CHECK(afd::Json::parse("[1,2]") != afd::Json::parse("[2,1]"));
}
