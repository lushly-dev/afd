"""Tests for the YAML 1.2 core frontmatter parser (``spec/mcp-resources.md``, S2)."""

from __future__ import annotations

import pytest

from afd.server.frontmatter import FrontmatterError, parse_frontmatter


def test_parses_yaml_12_core_scalars_and_nested_structures():
    doc = (
        "---\n"
        "name: hello-greeting\n"
        "description: Greet a person.\n"
        "updated: 2026-11-01\n"
        "yes_plain: yes\n"
        "no_plain: no\n"
        "on_plain: on\n"
        "off_plain: off\n"
        "bool_true: true\n"
        "bool_false: False\n"
        "null_tilde: ~\n"
        "null_word: null\n"
        "null_empty:\n"
        "int_dec: 42\n"
        "int_neg: -7\n"
        "int_leading_zero: 010\n"
        "int_oct: 0o10\n"
        "int_hex: 0x10\n"
        "float_val: 3.5\n"
        "float_exp: 1e3\n"
        "quoted_num: \"42\"\n"
        "quoted_bool: 'true'\n"
        "items:\n"
        "  - a\n"
        "  - 2\n"
        "  - { nested: true }\n"
        "---\n"
        "\n# Body\n"
    )
    parsed = parse_frontmatter(doc)
    assert parsed["name"] == "hello-greeting"
    assert parsed["updated"] == "2026-11-01"
    # YAML 1.2 core: yes/no/on/off are strings, not booleans.
    assert parsed["yes_plain"] == "yes"
    assert parsed["no_plain"] == "no"
    assert parsed["on_plain"] == "on"
    assert parsed["off_plain"] == "off"
    assert parsed["bool_true"] is True
    assert parsed["bool_false"] is False
    assert parsed["null_tilde"] is None
    assert parsed["null_word"] is None
    assert parsed["null_empty"] is None
    assert parsed["int_dec"] == 42
    assert parsed["int_neg"] == -7
    # YAML 1.2 core: 010 is decimal 10 (not YAML 1.1 octal 8); 0o10 is octal 8.
    assert parsed["int_leading_zero"] == 10
    assert parsed["int_oct"] == 8
    assert parsed["int_hex"] == 16
    assert parsed["float_val"] == 3.5
    assert parsed["float_exp"] == 1000.0
    assert parsed["quoted_num"] == "42"
    assert parsed["quoted_bool"] == "true"
    assert parsed["items"] == ["a", 2, {"nested": True}]


def test_accepts_crlf_and_eof_closing_delimiter():
    doc = "---\r\nname: hello\r\ndescription: Hi.\r\n---"
    assert parse_frontmatter(doc) == {"name": "hello", "description": "Hi."}


@pytest.mark.parametrize(
    ("label", "doc"),
    [
        ("missing opening delimiter", "# Just markdown\n"),
        ("missing closing delimiter", "---\nname: hello\n"),
        ("root sequence", "---\n- a\n- b\n---\n"),
        ("root scalar", "---\nhello\n---\n"),
        ("YAML anchor", "---\nname: &a hello\ndescription: hi\n---\n"),
        ("YAML alias", "---\nname: &a hello\ndescription: *a\n---\n"),
        ("explicit tag", "---\nname: !!str hello\ndescription: hi\n---\n"),
        ("custom tag", "---\nname: !custom hello\ndescription: hi\n---\n"),
        ("duplicate key", "---\nname: hello\nname: world\ndescription: hi\n---\n"),
        ("non-string key (int)", "---\n1: hello\ndescription: hi\n---\n"),
        ("non-string key (bool)", "---\ntrue: hello\ndescription: hi\n---\n"),
        ("non-finite .inf", "---\nname: hello\ndescription: hi\nlimit: .inf\n---\n"),
        ("non-finite -.inf", "---\nname: hello\ndescription: hi\nlimit: -.inf\n---\n"),
        ("non-finite .nan", "---\nname: hello\ndescription: hi\nlimit: .nan\n---\n"),
        ("merge key via alias", "---\nbase: &b\n  a: 1\n<<: *b\n---\n"),
    ],
)
def test_refuses_forbidden_yaml_constructs(label: str, doc: str):
    with pytest.raises(FrontmatterError):
        parse_frontmatter(doc)


def test_enforces_max_nesting_depth_64():
    # 64 levels of nesting (root mapping = depth 1, plus 63 nested mappings) succeeds.
    lines_ok = ["---"]
    for i in range(63):
        lines_ok.append(f"{'  ' * i}k{i}:")
    lines_ok.append(f"{'  ' * 63}leaf: ok")
    lines_ok.append("---")
    assert isinstance(parse_frontmatter("\n".join(lines_ok)), dict)

    # 65 levels of nesting is refused.
    lines_bad = ["---"]
    for i in range(64):
        lines_bad.append(f"{'  ' * i}k{i}:")
    lines_bad.append(f"{'  ' * 64}leaf: nope")
    lines_bad.append("---")
    with pytest.raises(FrontmatterError, match="64"):
        parse_frontmatter("\n".join(lines_bad))


def test_refuses_huge_non_finite_integers_and_non_lf_fences():
    huge_dec = "---\nname: hello\ndescription: hi\nbig: " + ("9" * 5000) + "\n---\n"
    huge_hex = "---\nname: hello\ndescription: hi\nbig: 0x" + ("f" * 5000) + "\n---\n"
    huge_oct = "---\nname: hello\ndescription: hi\nbig: 0o" + ("7" * 5000) + "\n---\n"
    for doc in (huge_dec, huge_hex, huge_oct):
        with pytest.raises(FrontmatterError, match="finite"):
            parse_frontmatter(doc)

    # U+2028 inside a quoted string must not prematurely close the frontmatter fence.
    doc_u2028 = '---\nname: hello\ndescription: "a\u2028---"\n---\n'
    parsed = parse_frontmatter(doc_u2028)
    assert parsed["description"] == "a\u2028---"

    # Bare CR line endings are not valid --- fences.
    with pytest.raises(FrontmatterError):
        parse_frontmatter("---\rname: hello\rdescription: hi\r---")
