//! Every rule of specification section 7.2 (decision D59), on generated documents with exact
//! expected boundaries and on one committed fixture.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use umbel_okf::frontmatter::split;
use umbel_okf::structure;
use umbel_plugin_knowledge::chunk::{
    self, Chunk, Chunked, MAX_CHUNK_BYTES, MAX_CHUNKS, MAX_WORDS, PLAIN_LINES, TAIL_WORDS, words,
};

fn chunk_markdown(text: &str) -> Chunked {
    let parts = split(text.as_bytes()).unwrap();
    let body = structure(parts.text, parts.body_offset);
    chunk::markdown(parts.text, &body)
}

/// `count` words, `w<tag><n>`, on one line.
fn line_of(tag: &str, count: usize) -> String {
    (0..count)
        .map(|n| format!("{tag}{n}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Paragraphs of the given word counts, separated by blank lines.
fn paragraphs(counts: &[usize]) -> String {
    counts
        .iter()
        .enumerate()
        .map(|(index, count)| line_of(&format!("p{index}x"), *count))
        .collect::<Vec<_>>()
        .join("\n\n")
        + "\n"
}

fn word_counts(chunked: &Chunked) -> Vec<usize> {
    chunked.chunks.iter().map(|c| words(&c.text)).collect()
}

fn invariants(text: &str, chunked: &Chunked) {
    let mut last_end = 0usize;
    for (index, chunk) in chunked.chunks.iter().enumerate() {
        assert_eq!(chunk.ordinal as usize, index);
        assert!(chunk.bytes.start >= last_end, "chunks overlap: {chunked:?}");
        last_end = chunk.bytes.end;
        assert_eq!(&text[chunk.bytes.clone()], chunk.text);
        assert!(chunk.line_start <= chunk.line_end);
        assert!(chunk.text.len() <= MAX_CHUNK_BYTES);
        assert!(
            words(&chunk.text) <= MAX_WORDS,
            "{} words",
            words(&chunk.text)
        );
    }
}

#[test]
fn a_chunk_closes_at_the_next_block_boundary_once_it_holds_240_words() {
    // 100 + 100 + 100: closes after the third (300 >= 240).
    let text = paragraphs(&[100, 100, 100]);
    let chunked = chunk_markdown(&text);
    assert_eq!(word_counts(&chunked), [300]);
    // 150 x 4: two chunks of 300.
    let text = paragraphs(&[150, 150, 150, 150]);
    let chunked = chunk_markdown(&text);
    assert_eq!(word_counts(&chunked), [300, 300]);
    invariants(&text, &chunked);
}

#[test]
fn a_chunk_closes_before_a_block_that_would_pass_400_words() {
    // 200 is under 240, and 200 + 250 would be 450: the first closes alone.
    let text = paragraphs(&[200, 250]);
    let chunked = chunk_markdown(&text);
    assert_eq!(word_counts(&chunked), [200, 250]);
    // 239 + 160 = 399 fits.
    let text = paragraphs(&[239, 160]);
    assert_eq!(word_counts(&chunk_markdown(&text)), [399]);
    // 239 + 162 = 401 does not.
    let text = paragraphs(&[239, 162]);
    assert_eq!(word_counts(&chunk_markdown(&text)), [239, 162]);
}

#[test]
fn a_block_over_400_words_is_split_at_line_boundaries() {
    // A code fence of 1000 words, 10 per line: pieces of at most 400 words.
    let body: Vec<String> = (0..100).map(|n| line_of(&format!("c{n}x"), 10)).collect();
    let text = format!("```\n{}\n```\n", body.join("\n"));
    let chunked = chunk_markdown(&text);
    invariants(&text, &chunked);
    assert!(chunked.chunks.len() >= 3, "{:?}", word_counts(&chunked));
    let total: usize = word_counts(&chunked).iter().sum();
    assert_eq!(
        total,
        1000 + 2,
        "every word of the fence, and its two fence lines, is in a chunk"
    );
    // Consecutive pieces continue where the last one ended.
    for pair in chunked.chunks.windows(2) {
        assert!(pair[1].line_start > pair[0].line_end, "{pair:?}");
    }
}

#[test]
fn a_short_tail_merges_into_the_previous_chunk_of_its_section_when_it_fits() {
    // 300 closes a chunk; a 30-word tail (under 40) merges: 330 <= 400.
    let text = paragraphs(&[300, 30]);
    assert_eq!(word_counts(&chunk_markdown(&text)), [330]);
    // 390 + 30 = 420 > 400: the tail stands.
    let text = paragraphs(&[390, 30]);
    assert_eq!(word_counts(&chunk_markdown(&text)), [390, 30]);
    // A tail of exactly 40 words is not a short tail.
    let text = paragraphs(&[300, TAIL_WORDS]);
    assert_eq!(word_counts(&chunk_markdown(&text)), [300, 40]);
}

#[test]
fn chunks_never_cross_a_section_boundary_and_tails_do_not_merge_across_one() {
    let text = format!(
        "# One\n\n{}\n\n## Two\n\n{}\n",
        line_of("a", 300),
        line_of("b", 10)
    );
    let chunked = chunk_markdown(&text);
    assert_eq!(word_counts(&chunked), [300, 10]);
    assert_eq!(chunked.chunks[0].heading_path, ["One"]);
    assert_eq!(chunked.chunks[1].heading_path, ["One", "Two"]);
    invariants(&text, &chunked);
}

#[test]
fn a_preamble_before_the_first_heading_is_its_own_section() {
    let text = format!(
        "{}\n\n# Title\n\n{}\n",
        line_of("pre", 20),
        line_of("body", 20)
    );
    let chunked = chunk_markdown(&text);
    assert_eq!(word_counts(&chunked), [20, 20]);
    assert!(chunked.chunks[0].heading_path.is_empty());
    assert_eq!(chunked.chunks[1].heading_path, ["Title"]);
}

#[test]
fn lines_are_the_files_including_the_frontmatter() {
    let text = "---\ntitle: T\n---\n# Head\n\nfirst paragraph here\n\nsecond paragraph here\n";
    let chunked = chunk_markdown(text);
    assert_eq!(chunked.chunks.len(), 1);
    let only = &chunked.chunks[0];
    // The paragraphs are on lines 6 and 8 of the file.
    assert_eq!((only.line_start, only.line_end), (6, 8), "{only:?}");
    assert_eq!(only.heading_path, ["Head"]);
    assert!(
        !only.text.contains("title: T"),
        "the frontmatter is never a chunk"
    );
}

#[test]
fn atomic_blocks_stay_whole_when_they_fit() {
    let table = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";
    let quote = "> quoted line one\n> quoted line two";
    let list = "- item one\n  continued\n- item two";
    let text = format!("{}\n\n{table}\n\n{quote}\n\n{list}\n", line_of("intro", 30));
    let chunked = chunk_markdown(&text);
    // All of it is one section well under 240 words: one chunk holding every block whole.
    assert_eq!(chunked.chunks.len(), 1);
    let body = &chunked.chunks[0].text;
    for part in [table, quote, list] {
        assert!(body.contains(part), "{body}");
    }
}

#[test]
fn no_overlap_and_ordinals_run_from_zero() {
    let mut text = String::new();
    for section in 0..40 {
        text += &format!(
            "## Section {section}\n\n{}\n\n{}\n\n",
            line_of("s", 130),
            line_of("t", 130)
        );
    }
    let chunked = chunk_markdown(&text);
    invariants(&text, &chunked);
    assert!(chunked.chunks.len() >= 40);
    assert!(!chunked.limited);
}

#[test]
fn a_document_has_at_most_2000_chunks_and_says_so() {
    let mut text = String::new();
    for section in 0..(MAX_CHUNKS + 100) {
        text += &format!("## s{section}\n\nword\n\n");
    }
    let chunked = chunk_markdown(&text);
    assert_eq!(chunked.chunks.len(), MAX_CHUNKS);
    assert!(chunked.limited);
}

#[test]
fn an_empty_document_gets_one_empty_chunk_so_its_title_still_finds_it() {
    for text in ["", "---\ntitle: Only a title\n---\n", "# Just a heading\n"] {
        let chunked = chunk_markdown(text);
        assert_eq!(chunked.chunks.len(), 1, "{text:?}");
        assert_eq!(chunked.chunks[0].text, "");
        assert!(!chunked.limited);
    }
}

#[test]
fn words_are_maximal_runs_of_non_whitespace() {
    assert_eq!(words("one-two  three\tfour\nfive"), 4);
    assert_eq!(words("  "), 0);
    assert_eq!(words("naïve café 日本語"), 3);
}

#[test]
fn a_line_longer_than_the_byte_cap_is_cut_and_nothing_is_lost() {
    // One 200 KiB word, then more text.
    let long = "x".repeat(200 * 1024);
    let text = format!("{long}\n\nafter the long word\n");
    let chunked = chunk_markdown(&text);
    invariants(&text, &chunked);
    assert!(
        chunked
            .chunks
            .iter()
            .all(|c| c.text.len() <= MAX_CHUNK_BYTES)
    );
    let rebuilt: usize = chunked.chunks.iter().map(|c| c.text.len()).sum();
    assert!(rebuilt >= long.len() + "after the long word".len());
    // And a long run of words on one line splits at word boundaries within 400 words.
    let line = line_of("w", 5000);
    let text = format!("{line}\n");
    let chunked = chunk_markdown(&text);
    invariants(&text, &chunked);
    assert!(chunked.chunks.len() >= 12);
    assert_eq!(word_counts(&chunked).iter().sum::<usize>(), 5000);
}

#[test]
fn chunking_is_deterministic() {
    let text = paragraphs(&[120, 80, 400, 30, 260, 10, 300]);
    assert_eq!(chunk_markdown(&text), chunk_markdown(&text));
}

#[test]
fn code_is_plain_text_in_60_line_chunks() {
    let source: String = (1..=130).map(|n| format!("let x{n} = {n};\n")).collect();
    let chunked = chunk::plain(&source);
    let lines: Vec<(u32, u32)> = chunked
        .chunks
        .iter()
        .map(|c: &Chunk| (c.line_start, c.line_end))
        .collect();
    assert_eq!(lines, [(1, 60), (61, 120), (121, 130)]);
    assert_eq!(PLAIN_LINES, 60);
    let joined: String = chunked.chunks.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(joined, source, "nothing is lost or repeated");
    // An empty file is one empty chunk; a file without a final newline keeps its last line.
    assert_eq!(chunk::plain("").chunks.len(), 1);
    let chunked = chunk::plain("a\nb");
    assert_eq!(chunked.chunks.len(), 1);
    assert_eq!(
        (chunked.chunks[0].line_start, chunked.chunks[0].line_end),
        (1, 2)
    );
}

#[test]
fn a_committed_fixture_has_the_expected_boundaries() {
    let text = include_str!("fixtures/chunking/runbook.md");
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/chunking/runbook.expected.json")).unwrap();
    let chunked = chunk_markdown(text);
    invariants(text, &chunked);
    let actual: Vec<serde_json::Value> = chunked
        .chunks
        .iter()
        .map(|c| {
            serde_json::json!({
                "lines": [c.line_start, c.line_end],
                "words": words(&c.text),
                "headingPath": c.heading_path,
            })
        })
        .collect();
    assert_eq!(serde_json::Value::Array(actual), expected);
}
