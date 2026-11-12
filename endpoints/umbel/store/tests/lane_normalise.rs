//! The identical digest's normalisation (records host specification, section 8.1): its five
//! steps, each alone and together, the worked example's digest, and the Unicode versions the two
//! pinned crates carry, which a stored digest depends on.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::fmt::Write as _;

use umbel_store::lane::{NORMALISATION_VERSION, match_digest, normalise};

fn hex(digest: [u8; 32]) -> String {
    let mut out = String::new();
    for byte in digest {
        write!(out, "{byte:02x}").unwrap();
    }
    out
}

/// Section 8.1's worked example: one statement, as typed, with odd spacing and case, and with a
/// full-width first letter.
const WORKED: [&str; 3] = [
    "Prune roses in late winter, before the buds swell.",
    "  PRUNE roses in late\twinter,\u{a0}before the buds swell. ",
    "\u{ff30}rune roses in late winter, before the buds swell.",
];
const WORKED_DIGEST: &str = "c714bd413a290f5b1724d67dd0b26ea3e76a93b1904daaa487f16cea4e1aec8b";

#[test]
fn step_1_composes_and_takes_compatibility_forms() {
    // Lower-case inputs with single spaces, so only NFKC acts.
    for (text, normal) in [
        ("\u{fb01}g", "fig"),
        ("\u{ff46}\u{ff49}\u{ff47}", "fig"),
        ("pe\u{301}tale", "p\u{e9}tale"),
        ("bed \u{2460}", "bed 1"),
        ("10\u{b2} seeds", "102 seeds"),
    ] {
        assert_eq!(normalise(text), normal, "{text}");
    }
}

#[test]
fn step_2_folds_case_by_the_default_full_folding() {
    for (text, normal) in [
        ("Fig", "fig"),
        ("FIG", "fig"),
        ("Stra\u{df}e", "strasse"),
        ("STRASSE", "strasse"),
        ("\u{3a3}\u{391}\u{3a3}", "\u{3c3}\u{3b1}\u{3c3}"),
        ("\u{3c3}\u{3b1}\u{3c2}", "\u{3c3}\u{3b1}\u{3c3}"),
    ] {
        assert_eq!(normalise(text), normal, "{text}");
    }
}

#[test]
fn step_3_normalises_again_what_folding_decomposed() {
    // U+01F0 folds to `j` and a combining caron, which NFKC composes back.
    assert_eq!(caseless::default_case_fold_str("\u{1f0}"), "j\u{30c}");
    assert_eq!(normalise("\u{1f0}"), "\u{1f0}");
    assert_eq!(normalise("J\u{30c}"), "\u{1f0}");
    assert_eq!(normalise("j\u{30c}"), "\u{1f0}");
}

#[test]
fn step_4_makes_each_run_of_whitespace_one_space() {
    for text in [
        "sow  peas",
        "sow\tpeas",
        "sow\npeas",
        "sow \t\r\n peas",
        "sow\u{a0}peas",
        "sow\u{2003}peas",
        "sow\u{2028}peas",
        "sow\u{85}\u{3000}peas",
    ] {
        assert_eq!(normalise(text), "sow peas", "{text:?}");
    }
    // A zero-width space is not whitespace: it stays, and the two texts differ.
    assert_eq!(normalise("sow\u{200b}peas"), "sow\u{200b}peas");
}

#[test]
fn step_5_removes_leading_and_trailing_spaces() {
    for text in [" sow peas", "sow peas ", "\t\n sow peas \u{a0}\u{2003}"] {
        assert_eq!(normalise(text), "sow peas", "{text:?}");
    }
    for empty in ["", " ", "\t\n", "\u{a0}\u{2003}\u{3000}"] {
        assert_eq!(normalise(empty), "", "{empty:?}");
    }
}

#[test]
fn the_steps_together_give_the_worked_examples_one_digest() {
    for text in WORKED {
        assert_eq!(
            normalise(text),
            "prune roses in late winter, before the buds swell.",
            "{text:?}"
        );
        assert_eq!(hex(match_digest(text).unwrap()), WORKED_DIGEST, "{text:?}");
    }
    // Punctuation and words are not normalised away: these are other texts.
    for other in [
        "Prune roses in late winter before the buds swell.",
        "Prune roses in late winter, before the bud swells.",
        "Prune the roses in late winter, before the buds swell.",
    ] {
        assert_ne!(hex(match_digest(other).unwrap()), WORKED_DIGEST, "{other}");
    }
}

#[test]
fn normalising_twice_changes_nothing() {
    for text in WORKED.iter().copied().chain([
        "\u{1f0}",
        "Stra\u{df}e \u{fb01}g\u{2003}\u{2460}",
        "\u{3a3}\u{391}\u{3a3}  \u{130}",
        "\u{390} \u{1fd3} \u{1e9e}",
    ]) {
        let once = normalise(text);
        assert_eq!(normalise(&once), once, "{text:?}");
    }
}

#[test]
fn a_value_whose_normal_form_is_empty_has_no_digest() {
    for empty in ["", "   ", "\t\u{a0}\n"] {
        assert_eq!(match_digest(empty), None, "{empty:?}");
    }
    assert!(match_digest(".").is_some());
}

#[test]
fn the_unicode_tables_are_the_pinned_ones() {
    // A stored digest depends on both tables. A change of either is a new normalisation version
    // and a rebuild of every lane (section 8.1), so each is pinned exactly and named here.
    assert_eq!(NORMALISATION_VERSION, 1);
    assert_eq!(unicode_normalization::UNICODE_VERSION, (18, 0, 0));
    assert_eq!(caseless::UNICODE_VERSION, (16, 0, 0));
    let manifest =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    for pin in [
        "caseless = \"=0.2.2\"",
        "unicode-normalization = \"=0.1.26\"",
    ] {
        assert!(manifest.contains(pin), "Cargo.toml does not pin {pin}");
    }
}
