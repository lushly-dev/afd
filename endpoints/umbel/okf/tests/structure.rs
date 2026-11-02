//! Section 7.1: the heading tree and slugs, blocks, links, code spans and line numbers; link
//! resolution; and pathological markdown within limits.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::time::{Duration, Instant};

use umbel_okf::links::{Target, resolve};
use umbel_okf::structure::{BlockKind, MAX_BLOCKS, MAX_HEADINGS, MAX_LINKS, slugify, structure};

fn parse(text: &str) -> umbel_okf::Structure {
    structure(text, 0)
}

#[test]
fn headings_form_a_tree_with_section_line_ranges() {
    let text = "# Deploy\n\nIntro\n\n## Rolling back\n\nSteps\n\n### Canary\n\nMore\n\n## Scaling\n\nEnd\n";
    let s = parse(text);
    let headings: Vec<_> = s
        .headings
        .iter()
        .map(|h| {
            (
                h.level,
                h.text.as_str(),
                h.slug.as_str(),
                h.lines.start,
                h.lines.end,
                h.parent,
            )
        })
        .collect();
    assert_eq!(
        headings,
        [
            (1, "Deploy", "deploy", 1, 15, None),
            (2, "Rolling back", "rolling-back", 5, 12, Some(0)),
            (3, "Canary", "canary", 9, 12, Some(1)),
            (2, "Scaling", "scaling", 13, 15, Some(0)),
        ]
    );
    assert_eq!(
        s.heading_path(Some(2)),
        ["Deploy", "Rolling back", "Canary"]
    );
    assert_eq!(s.heading_by_slug("scaling").unwrap().line, 13);
    assert_eq!(s.total_lines, 15);
}

#[test]
fn setext_headings_and_inline_markup_in_headings_read_as_text() {
    let s = parse("Title\n=====\n\n## The `code` and *emphasis* **here**\n");
    assert_eq!(s.headings[0].text, "Title");
    assert_eq!(s.headings[0].line, 1);
    assert_eq!(s.headings[1].text, "The code and emphasis here");
    assert_eq!(s.headings[1].slug, "the-code-and-emphasis-here");
}

#[test]
fn slugs_are_lowercase_ascii_and_repeats_are_numbered() {
    assert_eq!(slugify("Rolling back!"), "rolling-back");
    assert_eq!(slugify("  --A  B__C--  "), "a-b-c");
    assert_eq!(slugify("Ünïcode ✓"), "n-code");
    assert_eq!(slugify("???"), "section");
    let s = parse("# A\n## B\n## B\n## B\n# A\n## b-2\n");
    let slugs: Vec<&str> = s.headings.iter().map(|h| h.slug.as_str()).collect();
    assert_eq!(slugs, ["a", "b", "b-2", "b-3", "a-2", "b-2-2"]);
    // The same text gives the same slugs.
    assert_eq!(
        parse("# A\n## B\n## B\n").headings,
        parse("# A\n## B\n## B\n").headings
    );
}

#[test]
fn blocks_are_the_top_level_constructs_with_line_and_byte_ranges() {
    let text = "Intro line\n\n```rust\nfn x() {}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n  nested\n\n> quote\n\n---\n\nTail\n";
    let s = parse(text);
    let kinds: Vec<(BlockKind, usize, usize)> = s
        .blocks
        .iter()
        .map(|b| (b.kind, b.lines.start, b.lines.end))
        .collect();
    assert_eq!(
        kinds,
        [
            (BlockKind::Paragraph, 1, 1),
            (BlockKind::Code, 3, 5),
            (BlockKind::Table, 7, 9),
            (BlockKind::ListItem, 11, 11),
            (BlockKind::ListItem, 12, 13),
            (BlockKind::BlockQuote, 15, 15),
            (BlockKind::Rule, 17, 17),
            (BlockKind::Paragraph, 19, 19),
        ]
    );
    let code = &s.blocks[1];
    assert_eq!(&text[code.bytes.clone()], code.text);
    assert!(code.text.starts_with("```rust"));
}

#[test]
fn a_block_knows_the_section_it_is_in() {
    let s = parse("Preamble\n\n# One\n\nA\n\n## Two\n\nB\n");
    let sections: Vec<Option<usize>> = s.blocks.iter().map(|b| b.section).collect();
    assert_eq!(sections, [None, Some(0), Some(1)]);
}

#[test]
fn lines_count_the_whole_file_when_the_body_starts_after_frontmatter() {
    let text = "---\ntitle: x\n---\n# Heading\n\nBody\n";
    let body_offset = text.find("# Heading").unwrap();
    let s = structure(text, body_offset);
    assert_eq!(s.headings[0].line, 4);
    assert_eq!(s.blocks[0].lines.start, 6);
    assert_eq!(s.total_lines, 6);
    assert_eq!(&text[s.blocks[0].bytes.clone()], "Body\n");
}

#[test]
fn links_are_collected_with_references_resolved_and_images_left_out() {
    let text = "See [the canary](canary.md#steps) and [ref][r] and <https://example.com/x> and ![img](a.png).\n\n[r]: ../other/page.md\n";
    let s = parse(text);
    let targets: Vec<(&str, usize)> = s
        .links
        .iter()
        .map(|l| (l.target.as_str(), l.line))
        .collect();
    assert_eq!(
        targets,
        [
            ("canary.md#steps", 1),
            ("../other/page.md", 1),
            ("https://example.com/x", 1)
        ]
    );
}

#[test]
fn inline_code_spans_are_collected_with_their_lines() {
    let s = parse("Use `read_file` here.\n\nAnd `Vec::new` there.\n\n```\n`not` a span\n```\n");
    let spans: Vec<(&str, usize)> = s
        .code_spans
        .iter()
        .map(|c| (c.text.as_str(), c.line))
        .collect();
    assert_eq!(spans, [("read_file", 1), ("Vec::new", 3)]);
}

#[test]
fn an_empty_file_and_a_file_without_a_final_newline_count_lines() {
    assert_eq!(parse("").total_lines, 0);
    assert_eq!(parse("one").total_lines, 1);
    assert_eq!(parse("one\n").total_lines, 1);
    assert_eq!(parse("one\n\n").total_lines, 2);
}

fn resolved(target: &str) -> Target {
    resolve(
        target,
        "handbook/deploy/rollback",
        &["handbook".into(), "runbooks".into()],
    )
}

#[test]
fn relative_and_rooted_links_resolve_to_document_ids() {
    let doc = |id: &str, fragment: Option<&str>| Target::Document {
        id: id.into(),
        fragment: fragment.map(Into::into),
    };
    assert_eq!(resolved("canary.md"), doc("handbook/deploy/canary", None));
    assert_eq!(resolved("canary"), doc("handbook/deploy/canary", None));
    assert_eq!(resolved("./canary.md"), doc("handbook/deploy/canary", None));
    assert_eq!(resolved("../index.md"), doc("handbook/index", None));
    assert_eq!(
        resolved("sub/page.md#intro"),
        doc("handbook/deploy/sub/page", Some("intro"))
    );
    assert_eq!(
        resolved("/overview.md"),
        doc("handbook/overview", None),
        "rooted at the collection"
    );
    assert_eq!(
        resolved("/runbooks/pager"),
        doc("runbooks/pager", None),
        "or at another collection of the space"
    );
    assert_eq!(
        resolved("/runbooks"),
        doc("handbook/runbooks", None),
        "a bare collection name is a path of this one"
    );
    assert_eq!(resolved("a%20b.md"), doc("handbook/deploy/a b", None));
    assert_eq!(resolved("page.md?x=1"), doc("handbook/deploy/page", None));
}

#[test]
fn fragments_urls_files_and_nonsense_resolve_as_they_should() {
    assert_eq!(resolved("#steps"), Target::Fragment("steps".into()));
    assert_eq!(
        resolved("https://example.com/a"),
        Target::External("https://example.com/a".into())
    );
    assert_eq!(
        resolved("mailto:a@b.c"),
        Target::External("mailto:a@b.c".into())
    );
    assert_eq!(
        resolved("//cdn.example.com/x"),
        Target::External("//cdn.example.com/x".into())
    );
    assert_eq!(
        resolved("diagram.png"),
        Target::File("handbook/deploy/diagram.png".into())
    );
    for nonsense in [
        "",
        "#",
        "../../../../etc/passwd",
        "../../../x.md",
        "a//b.md",
        "dir/",
        ".hidden.md",
        "a/.git/x.md",
    ] {
        assert_eq!(resolved(nonsense), Target::Unresolved, "{nonsense:?}");
    }
}

#[test]
fn a_link_never_resolves_across_spaces_or_out_of_the_root() {
    // `..` past the collection root is nothing, not a path in another collection.
    assert_eq!(resolved("../../runbooks/pager.md"), Target::Unresolved);
    assert_eq!(resolved("../../../beta/handbook/x.md"), Target::Unresolved);
}

// Pathological markdown. Each case must finish quickly with bounded output and without a panic or
// stack overflow, on the default 2 MiB test-thread stack.

fn bounded(text: &str, limit: Duration) -> umbel_okf::Structure {
    let started = Instant::now();
    let s = structure(text, 0);
    assert!(
        started.elapsed() < limit,
        "{} bytes took {:?}",
        text.len(),
        started.elapsed()
    );
    s
}

#[test]
fn deep_block_quote_nesting_is_read_without_overflow() {
    let text = format!("{} deep\n", ">".repeat(100_000));
    let s = bounded(&text, Duration::from_secs(20));
    assert!(s.blocks.len() <= MAX_BLOCKS);
}

#[test]
fn deep_list_nesting_is_read_without_overflow() {
    let mut text = String::new();
    for depth in 0..5_000 {
        text.push_str(&" ".repeat(depth));
        text.push_str("- item\n");
    }
    let s = bounded(&text, Duration::from_secs(20));
    assert!(s.blocks.len() <= MAX_BLOCKS);
    let flat = "- ".repeat(50_000) + "x\n";
    bounded(&flat, Duration::from_secs(20));
}

#[test]
fn deeply_nested_emphasis_and_brackets_are_read_in_time() {
    for text in [
        "*a ".repeat(200_000),
        "[".repeat(200_000),
        "](".repeat(100_000),
        "`".repeat(200_000),
        "**_".repeat(100_000),
        "<".repeat(200_000),
        format!("{}x{}", "[".repeat(50_000), "](u)".repeat(50_000)),
    ] {
        bounded(&text, Duration::from_secs(30));
    }
}

#[test]
fn a_huge_single_line_is_one_paragraph() {
    let text = "word ".repeat(2_000_000);
    let s = bounded(&text, Duration::from_secs(20));
    assert_eq!(s.blocks.len(), 1);
    assert_eq!(s.blocks[0].lines.start, 1);
    assert_eq!(s.blocks[0].lines.end, 1);
    assert_eq!(s.total_lines, 1);
}

#[test]
fn a_huge_heading_is_cut() {
    let text = format!("# {}\n", "h".repeat(1_000_000));
    let s = bounded(&text, Duration::from_secs(20));
    assert_eq!(s.headings[0].text.chars().count(), 512);
}

#[test]
fn counts_are_capped_and_the_structure_says_so() {
    let headings = "# h\n".repeat(MAX_HEADINGS + 10);
    let s = bounded(&headings, Duration::from_secs(30));
    assert_eq!(s.headings.len(), MAX_HEADINGS);
    assert!(s.limited);

    let links = "[a](b.md)\n\n".repeat(MAX_LINKS + 10);
    let s = bounded(&links, Duration::from_secs(30));
    assert!(s.links.len() <= MAX_LINKS);
    assert!(s.limited);

    let blocks = "x\n\n".repeat(MAX_BLOCKS + 10);
    let s = bounded(&blocks, Duration::from_secs(30));
    assert_eq!(s.blocks.len(), MAX_BLOCKS);
    assert!(s.limited);
}

#[test]
fn many_repeated_headings_keep_slugs_unique_in_linear_time() {
    let text = "## same\n".repeat(MAX_HEADINGS);
    let s = bounded(&text, Duration::from_secs(10));
    let mut slugs: Vec<&str> = s.headings.iter().map(|h| h.slug.as_str()).collect();
    slugs.sort_unstable();
    slugs.dedup();
    assert_eq!(slugs.len(), MAX_HEADINGS);
}

#[test]
fn a_file_of_nothing_but_newlines_and_one_of_nothing_but_nulls_are_read() {
    let newlines = "\n".repeat(2_000_000);
    let s = bounded(&newlines, Duration::from_secs(20));
    assert_eq!(s.total_lines, 2_000_000);
    bounded(&"\0".repeat(1_000_000), Duration::from_secs(20));
}
