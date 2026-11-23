// Dedicated YAML 1.2 Core frontmatter parser tests (spec/mcp-resources.md, S2).
#include <string>

#include "mcp_stdio/frontmatter.hpp"
#include <doctest.h>

// Named, not anonymous: unity builds combine test translation units.
namespace frontmatter_test {

using afd::Json;
using afd::mcp::surface::parse_skill_frontmatter;

TEST_CASE("YAML 1.2 Core scalar resolution keeps dates and YAML 1.1 booleans as strings") {
    const std::string doc = "---\n"
                            "name: demo-skill\n"
                            "description: Tests YAML 1.2 Core scalars.\n"
                            "date: 2026-11-01\n"
                            "yes_str: yes\n"
                            "no_str: no\n"
                            "on_str: on\n"
                            "off_str: off\n"
                            "bool_t: true\n"
                            "bool_T: True\n"
                            "bool_f: FALSE\n"
                            "null_tilde: ~\n"
                            "null_word: Null\n"
                            "null_empty:\n"
                            "int_dec: -42\n"
                            "int_leading_zero: 010\n"
                            "int_oct: 0o755\n"
                            "int_hex: 0x1f\n"
                            "float_std: 3.14\n"
                            "float_dot: .5\n"
                            "float_exp: 1e3\n"
                            "quoted_num: \"42\"\n"
                            "single_quote: 'it''s fine'\n"
                            "---\n"
                            "# Body\n";

    const auto parsed = parse_skill_frontmatter(doc);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
    CHECK((*parsed)["date"] == "2026-11-01");
    CHECK((*parsed)["yes_str"] == "yes");
    CHECK((*parsed)["no_str"] == "no");
    CHECK((*parsed)["on_str"] == "on");
    CHECK((*parsed)["off_str"] == "off");
    CHECK((*parsed)["bool_t"] == true);
    CHECK((*parsed)["bool_T"] == true);
    CHECK((*parsed)["bool_f"] == false);
    CHECK((*parsed)["null_tilde"].is_null());
    CHECK((*parsed)["null_word"].is_null());
    CHECK((*parsed)["null_empty"].is_null());
    CHECK((*parsed)["int_dec"] == -42);
    CHECK((*parsed)["int_leading_zero"] == 10);
    CHECK((*parsed)["int_oct"] == 493);
    CHECK((*parsed)["int_hex"] == 31);
    CHECK((*parsed)["float_std"] == doctest::Approx(3.14));
    CHECK((*parsed)["float_dot"] == doctest::Approx(0.5));
    CHECK((*parsed)["float_exp"] == doctest::Approx(1000.0));
    CHECK((*parsed)["quoted_num"] == "42");
    CHECK((*parsed)["single_quote"] == "it's fine");
}

TEST_CASE("block mappings, sequences, flow collections, block scalars and CRLF fences") {
    const std::string doc = "---\r\n"
                            "name: complex-skill\r\n"
                            "description: >-\r\n"
                            "  First line\r\n"
                            "  second line.\r\n"
                            "literal: |\r\n"
                            "  a\r\n"
                            "  b\r\n"
                            "tags:\r\n"
                            "- alpha\r\n"
                            "- beta\r\n"
                            "items:\r\n"
                            "  - key: one\r\n"
                            "    count: 1\r\n"
                            "  - key: two\r\n"
                            "    count: 2\r\n"
                            "flow: {list: [1, \"a\\nb\", '\\u0041'], nested: {ok: true}}\r\n"
                            "escaped: \"line1\\nline2\\u0041\"\r\n"
                            "---\r\n"
                            "Body\r\n";

    const auto parsed = parse_skill_frontmatter(doc);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
    CHECK((*parsed)["description"] == "First line second line.");
    CHECK((*parsed)["literal"] == "a\nb\n");
    CHECK((*parsed)["tags"] == Json::array({"alpha", "beta"}));
    CHECK((*parsed)["items"] ==
          Json::array({Json{{"key", "one"}, {"count", 1}}, Json{{"key", "two"}, {"count", 2}}}));
    CHECK((*parsed)["flow"] ==
          Json{{"list", Json::array({1, "a\nb", "\\u0041"})}, {"nested", {{"ok", true}}}});
    CHECK((*parsed)["escaped"] == "line1\nline2A");
}

TEST_CASE("frontmatter refuses S2 violations: fences, tags, anchors, aliases, duplicates, "
          "non-string keys, non-finite numbers, depth > 64 and bad UTF-8") {
    // Missing opening / closing fences and bare CR.
    CHECK_FALSE(parse_skill_frontmatter("# No frontmatter\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nname: a\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nname: a\n...\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nname: a\rb\n---\n").has_value());
    // Not a mapping.
    CHECK_FALSE(parse_skill_frontmatter("---\n- a\n- b\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\n---\n").has_value());
    // Tags, anchors, aliases, directives.
    CHECK_FALSE(parse_skill_frontmatter("---\nname: !!str hello\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nname: &n hello\ndescription: *n\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\n%YAML 1.2\nname: hello\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: [!custom x]\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: {k: &anc 1}\n---\n").has_value());
    // Duplicate keys (block and flow).
    CHECK_FALSE(parse_skill_frontmatter("---\nname: a\nname: b\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: {x: 1, x: 2}\n---\n").has_value());
    // Non-string mapping keys.
    CHECK_FALSE(parse_skill_frontmatter("---\n123: value\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\ntrue: value\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nnull: value\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: {1: x}\n---\n").has_value());
    // Non-finite numbers and huge integer overflow (> double max).
    CHECK_FALSE(parse_skill_frontmatter("---\nx: .inf\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nx: -.Inf\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nx: .NaN\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nx: 1e400\n---\n").has_value());
    CHECK_FALSE(
        parse_skill_frontmatter("---\nx: " + std::string(500, '9') + "\n---\n").has_value());
    // Invalid UTF-8 and surrogate escape.
    CHECK_FALSE(parse_skill_frontmatter("---\nname: \xFF\xFE\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\nname: \"\\uD800\"\n---\n").has_value());

    // Depth 64 allowed (1 root mapping + 63 nested arrays = 64 levels), depth 65 rejected.
    const std::string depth_64 =
        "---\na: " + std::string(63, '[') + "1" + std::string(63, ']') + "\n---\n";
    CHECK(parse_skill_frontmatter(depth_64).has_value());
    const std::string depth_65 =
        "---\na: " + std::string(64, '[') + "1" + std::string(64, ']') + "\n---\n";
    CHECK_FALSE(parse_skill_frontmatter(depth_65).has_value());

    // YAML 1.2 differential cases: unquoted `: ` in plain scalar is invalid; `#` stops
    // continuation; block scalar `#` requires whitespace; flow-seq single-pair mappings and
    // explicit string keys are valid (while non-string explicit keys are refused).
    CHECK_FALSE(parse_skill_frontmatter("---\ndescription: greet: everyone\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: b: c\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: b:\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: |# bad\n  hi\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\n? [1, 2]\n: bad\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\n? 123\n: bad\n---\n").has_value());
    CHECK_FALSE(parse_skill_frontmatter("---\na: hello # comment\n  world\n---\n").has_value());

    const auto ok_comment = parse_skill_frontmatter("---\na: b # ok: note\n---\n");
    REQUIRE_MESSAGE(ok_comment.has_value(), ok_comment.error());
    CHECK((*ok_comment)["a"] == "b");

    const auto ok_blk_comment = parse_skill_frontmatter("---\na: | # ok\n  hi\n---\n");
    REQUIRE_MESSAGE(ok_blk_comment.has_value(), ok_blk_comment.error());
    CHECK((*ok_blk_comment)["a"] == "hi\n");

    const auto ok_flow_pair =
        parse_skill_frontmatter("---\nmetadata: [role: editor, level: 2]\n---\n");
    REQUIRE_MESSAGE(ok_flow_pair.has_value(), ok_flow_pair.error());
    CHECK((*ok_flow_pair)["metadata"] ==
          Json::array({Json{{"role", "editor"}}, Json{{"level", 2}}}));

    const auto ok_explicit =
        parse_skill_frontmatter("---\nname: demo\n? description\n: hello\n---\n");
    REQUIRE_MESSAGE(ok_explicit.has_value(), ok_explicit.error());
    CHECK((*ok_explicit)["description"] == "hello");
}

} // namespace frontmatter_test
