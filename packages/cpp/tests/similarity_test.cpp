#include "afd/similarity.hpp"

#include <string>
#include <vector>

#include <doctest.h>

TEST_CASE("calculate_similarity is 1 - distance / max length, case-insensitive") {
    CHECK(afd::calculate_similarity("todo-create", "todo-create") == 1.0);
    CHECK(afd::calculate_similarity("TODO-Create", "todo-create") == 1.0);
    CHECK(afd::calculate_similarity("todo-creat", "todo-create") ==
          doctest::Approx(1.0 - 1.0 / 11.0));
    CHECK(afd::calculate_similarity("abc", "xyz") == 0.0);
    CHECK(afd::calculate_similarity("", "") == 1.0);
}

TEST_CASE("find_similar_tools keeps matches >= 0.4, best first, ties in registration order") {
    const std::vector<std::string> tools{"todo-list", "todo-get", "todo-create", "user-get",
                                         "todo-set"};
    const auto typo = afd::find_similar_tools("todo-crate", tools);
    REQUIRE_FALSE(typo.empty());
    CHECK(typo.front() == "todo-create");
    CHECK(typo.size() <= 3);
    // todo-get and todo-set tie with "todo-bet"; registration order breaks the tie.
    const auto tied = afd::find_similar_tools("todo-bet", tools);
    REQUIRE(tied.size() == 3);
    CHECK(tied[0] == "todo-get");
    CHECK(tied[1] == "todo-set");
    CHECK(afd::find_similar_tools("zzzzzzzzzzzzzzzz", tools).empty());
    CHECK(afd::find_similar_tools("todo-bet", tools, 1) == std::vector<std::string>{"todo-get"});
}

TEST_CASE("find_similar_tools ignores names longer than 128 UTF-16 code units") {
    const std::vector<std::string> tools{"todo-list"};
    CHECK(afd::find_similar_tools(std::string(129, 'a'), tools).empty());
    // 64 emoji are 128 UTF-16 code units (each is a surrogate pair): still matched against.
    std::string emoji;
    for (int i = 0; i < 64; ++i) {
        emoji += "\xF0\x9F\x98\x80"; // U+1F600
    }
    CHECK(afd::find_similar_tools(emoji, {emoji}) == std::vector<std::string>{emoji});
    CHECK(afd::find_similar_tools(emoji + "a", {emoji}).empty());
}

TEST_CASE("truncate_name cuts at 128 UTF-16 code units and adds an ellipsis") {
    CHECK(afd::truncate_name("todo-create") == "todo-create");
    CHECK(afd::truncate_name(std::string(128, 'a')) == std::string(128, 'a'));
    CHECK(afd::truncate_name(std::string(200, 'a')) == std::string(128, 'a') + "…");
    CHECK(afd::truncate_name("abcdef", 3) == "abc…");
}

TEST_CASE("truncate_name never splits a surrogate pair") {
    // 127 ASCII characters, then an emoji whose two code units straddle the 128 cut.
    const std::string name = std::string(127, 'a') + "\xF0\x9F\x98\x80" + "tail";
    CHECK(afd::truncate_name(name) == std::string(127, 'a') + "…");
    // A BMP character (é, one code unit) at the cut is kept.
    const std::string accented = std::string(127, 'a') + "\xC3\xA9" + "tail";
    CHECK(afd::truncate_name(accented) == std::string(127, 'a') + "\xC3\xA9" + "…");
}
