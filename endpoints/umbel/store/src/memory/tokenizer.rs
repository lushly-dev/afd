//! The memory tokenizer (phase 5 section 9.2): the tokens FTS5's
//! `porter unicode61 remove_diacritics 2` tokenizer gives the index, so that BM25 computed over
//! them in Rust sees the terms and column sizes FTS5 does.
//!
//! A port of SQLite 3.54.1's public domain FTS5 source (the amalgamation `rusqlite`'s `bundled`
//! feature builds): `fts5UnicodeTokenize` with `fts5UnicodeCreate`'s defaults
//! (`categories 'L* N* Co'`, no `tokenchars` or `separators`), the porter stemmer `fts5PorterCb`
//! and its steps, and the 32768-byte cap `fts5StorageInsertCallback` puts on every indexed token.
//! `tests/memory_tokenizer.rs` holds it to FTS5's own tokens.
//!
//! Behaviours of that source that shape the output:
//!
//! - unicode61 reads U+FFFE and U+FFFF as U+FFFD, a separator. Unassigned code points are token
//!   characters, and so is every code point of plane 16. A combining mark that
//!   `sqlite3Fts5UnicodeIsdiacritic` names continues a token but never starts one, and folds to
//!   nothing.
//! - No token is empty: every character that starts a token folds to at least one byte (a unit
//!   test checks every code point), so the tokens here are all FTS5 counts in a column's size.
//! - The stemmer only stems tokens of 3 to 64 bytes, counted after folding.
//! - FTS5 indexes bytes, and two of its rules can end a token inside a character: step 1b's
//!   "double consonant" rule compares bytes, so a stem ending in a 3- or 4-byte character whose
//!   last two bytes are equal (`"a丸ing"`) loses its last byte, and the 32768-byte cap cuts
//!   wherever it falls. Since a [`String`] cannot hold those bytes, each byte that is not part of
//!   valid UTF-8 becomes U+FFFD followed by the byte in two lower-case hex digits. U+FFFD is a
//!   separator, so it never occurs in a token otherwise and distinct FTS5 terms stay distinct.

mod unicode;

use std::fmt::Write as _;

/// The longest token, in bytes, the stemmer stems (`FTS5_PORTER_MAX_TOKEN`).
const PORTER_MAX_TOKEN: usize = 64;

/// The longest token, in bytes, FTS5 indexes (`FTS5_MAX_TOKEN_SIZE`); a longer one is cut.
const MAX_TOKEN_SIZE: usize = 32768;

/// The tokens of `text` as FTS5's `porter unicode61 remove_diacritics 2` indexes them, in order.
///
/// Each is lower-cased, folded, stemmed and capped as the module documentation describes; their
/// number is the column size FTS5 records for `text`.
pub fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    let mut token = Vec::new();
    loop {
        // Skip separators; a token starts at the first token character.
        let first = loop {
            match chars.next() {
                None => return out,
                Some(c) if starts_token(c) => break c,
                Some(_) => {}
            }
        };
        token.clear();
        push_folded(&mut token, first);
        while let Some(&c) = chars.peek() {
            if c.is_ascii() {
                if !unicode::is_ascii_token(c as u8) {
                    break;
                }
            } else {
                let code = code_point(c);
                if !unicode::is_alnum(code) && !unicode::is_diacritic(code) {
                    break;
                }
            }
            push_folded(&mut token, c);
            chars.next();
        }
        out.push(indexed(&stem(&token)));
    }
}

/// The code point unicode61's `FTS5_READ_UTF8` reads for `c`: U+FFFE and U+FFFF become U+FFFD.
fn code_point(c: char) -> u32 {
    let code = u32::from(c);
    if code & 0xFFFF_FFFE == 0xFFFE {
        0xFFFD
    } else {
        code
    }
}

/// Whether `c` starts a token (a separator otherwise).
fn starts_token(c: char) -> bool {
    if c.is_ascii() {
        unicode::is_ascii_token(c as u8)
    } else {
        unicode::is_alnum(code_point(c))
    }
}

/// Appends token character `c` folded, as `FTS5_WRITE_UTF8` writes it; a fold to 0 writes nothing.
fn push_folded(token: &mut Vec<u8>, c: char) {
    if c.is_ascii() {
        token.push((c as u8).to_ascii_lowercase());
        return;
    }
    let code = unicode::fold(code_point(c));
    if code == 0 {
        return;
    }
    // FTS5_WRITE_UTF8, which encodes any value below 2^21 without checking it.
    if code < 0x80 {
        token.push(code as u8);
    } else if code < 0x800 {
        token.push(0xC0 + ((code >> 6) & 0x1F) as u8);
        token.push(0x80 + (code & 0x3F) as u8);
    } else if code < 0x10000 {
        token.push(0xE0 + ((code >> 12) & 0x0F) as u8);
        token.push(0x80 + ((code >> 6) & 0x3F) as u8);
        token.push(0x80 + (code & 0x3F) as u8);
    } else {
        token.push(0xF0 + ((code >> 18) & 0x07) as u8);
        token.push(0x80 + ((code >> 12) & 0x3F) as u8);
        token.push(0x80 + ((code >> 6) & 0x3F) as u8);
        token.push(0x80 + (code & 0x3F) as u8);
    }
}

/// The token as the index stores it: capped at [`MAX_TOKEN_SIZE`] bytes, as a [`String`] with
/// each byte outside valid UTF-8 written as U+FFFD and two hex digits.
fn indexed(token: &[u8]) -> String {
    let token = &token[..token.len().min(MAX_TOKEN_SIZE)];
    if let Ok(text) = std::str::from_utf8(token) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(token.len() + 8);
    for chunk in token.utf8_chunks() {
        out.push_str(chunk.valid());
        for byte in chunk.invalid() {
            out.push('\u{FFFD}');
            // Writing to a String cannot fail.
            let _ = write!(out, "{byte:02x}");
        }
    }
    out
}

// The porter stemmer (`fts5PorterCb`), on bytes as the C code works.

/// `fts5PorterIsVowel`.
fn is_vowel(c: u8, y_is_vowel: bool) -> bool {
    matches!(c, b'a' | b'e' | b'i' | b'o' | b'u') || (y_is_vowel && c == b'y')
}

/// `fts5PorterGobbleVC`: the length of the stem's first vowel run and the consonant after it,
/// or 0 if there is none.
fn gobble_vc(stem: &[u8], prev_cons: bool) -> usize {
    let mut cons = prev_cons;
    let mut i = 0;
    while i < stem.len() {
        cons = !is_vowel(stem[i], cons);
        if !cons {
            break;
        }
        i += 1;
    }
    i += 1;
    while i < stem.len() {
        cons = !is_vowel(stem[i], cons);
        if cons {
            return i + 1;
        }
        i += 1;
    }
    0
}

/// `fts5Porter_MGt0`: m > 0.
fn m_gt0(stem: &[u8]) -> bool {
    gobble_vc(stem, false) != 0
}

/// `fts5Porter_MGt1`: m > 1.
fn m_gt1(stem: &[u8]) -> bool {
    let n = gobble_vc(stem, false);
    n != 0 && gobble_vc(&stem[n..], true) != 0
}

/// `fts5Porter_MEq1`: m = 1.
fn m_eq1(stem: &[u8]) -> bool {
    let n = gobble_vc(stem, false);
    n != 0 && gobble_vc(&stem[n..], true) == 0
}

/// `fts5Porter_Ostar`: the stem ends consonant, vowel, consonant, the last not w, x or y.
fn o_star(stem: &[u8]) -> bool {
    if matches!(stem.last(), Some(b'w' | b'x' | b'y')) {
        return false;
    }
    let mut mask = 0u8;
    let mut cons = false;
    for &c in stem {
        cons = !is_vowel(c, cons);
        mask = ((mask << 1) + u8::from(cons)) & 0x07;
    }
    mask == 0x05
}

/// `fts5Porter_MGt1_and_S_or_T`: m > 1 and the stem ends in s or t.
fn m_gt1_s_or_t(stem: &[u8]) -> bool {
    matches!(stem.last(), Some(b's' | b't')) && m_gt1(stem)
}

/// `fts5Porter_Vowel`: the stem holds a vowel (y counts after the first byte).
fn has_vowel(stem: &[u8]) -> bool {
    stem.iter().enumerate().any(|(i, &c)| is_vowel(c, i > 0))
}

/// A rule of steps 2 to 4: a suffix, the condition on the stem before it, and its replacement.
type Rule = (&'static [u8], fn(&[u8]) -> bool, &'static [u8]);

/// `fts5PorterStep2`, its cases in the generated switch's order.
const STEP2: &[Rule] = &[
    (b"ational", m_gt0, b"ate"),
    (b"tional", m_gt0, b"tion"),
    (b"enci", m_gt0, b"ence"),
    (b"anci", m_gt0, b"ance"),
    (b"izer", m_gt0, b"ize"),
    (b"logi", m_gt0, b"log"),
    (b"bli", m_gt0, b"ble"),
    (b"alli", m_gt0, b"al"),
    (b"entli", m_gt0, b"ent"),
    (b"eli", m_gt0, b"e"),
    (b"ousli", m_gt0, b"ous"),
    (b"ization", m_gt0, b"ize"),
    (b"ation", m_gt0, b"ate"),
    (b"ator", m_gt0, b"ate"),
    (b"alism", m_gt0, b"al"),
    (b"iveness", m_gt0, b"ive"),
    (b"fulness", m_gt0, b"ful"),
    (b"ousness", m_gt0, b"ous"),
    (b"aliti", m_gt0, b"al"),
    (b"iviti", m_gt0, b"ive"),
    (b"biliti", m_gt0, b"ble"),
];

/// `fts5PorterStep3`.
const STEP3: &[Rule] = &[
    (b"ical", m_gt0, b"ic"),
    (b"ness", m_gt0, b""),
    (b"icate", m_gt0, b"ic"),
    (b"iciti", m_gt0, b"ic"),
    (b"ful", m_gt0, b""),
    (b"ative", m_gt0, b""),
    (b"alize", m_gt0, b"al"),
];

/// `fts5PorterStep4`.
const STEP4: &[Rule] = &[
    (b"al", m_gt1, b""),
    (b"ance", m_gt1, b""),
    (b"ence", m_gt1, b""),
    (b"er", m_gt1, b""),
    (b"ic", m_gt1, b""),
    (b"able", m_gt1, b""),
    (b"ible", m_gt1, b""),
    (b"ant", m_gt1, b""),
    (b"ement", m_gt1, b""),
    (b"ment", m_gt1, b""),
    (b"ent", m_gt1, b""),
    (b"ion", m_gt1_s_or_t, b""),
    (b"ou", m_gt1, b""),
    (b"ism", m_gt1, b""),
    (b"ate", m_gt1, b""),
    (b"iti", m_gt1, b""),
    (b"ous", m_gt1, b""),
    (b"ive", m_gt1, b""),
    (b"ize", m_gt1, b""),
];

/// Whether `buf` ends in `suffix` with at least one byte before it (the generated code's
/// `nBuf>n && 0==memcmp(...)`).
fn ends_in(buf: &[u8], suffix: &[u8]) -> bool {
    buf.len() > suffix.len() && buf.ends_with(suffix)
}

/// Applies the first rule whose suffix `buf` ends in, if its condition holds; later rules are not
/// tried either way. Grouping by the generated switch's `aBuf[nBuf-2]` changes nothing: every
/// suffix in a case has that byte second to last, so only one case can match.
fn apply(buf: &mut Vec<u8>, rules: &[Rule]) {
    if let Some(&(suffix, condition, output)) = rules.iter().find(|r| ends_in(buf, r.0)) {
        let stem = buf.len() - suffix.len();
        if condition(&buf[..stem]) {
            buf.truncate(stem);
            buf.extend_from_slice(output);
        }
    }
}

/// `fts5PorterStep1A`.
fn step1a(buf: &mut Vec<u8>) {
    let n = buf.len();
    if buf[n - 1] == b's' {
        if buf[n - 2] == b'e' {
            if (n > 4 && buf[n - 4] == b's' && buf[n - 3] == b's') || (n > 3 && buf[n - 3] == b'i')
            {
                buf.truncate(n - 2);
            } else {
                buf.truncate(n - 1);
            }
        } else if buf[n - 2] != b's' {
            buf.truncate(n - 1);
        }
    }
}

/// `fts5PorterStep1B`: true when it removed `ed` or `ing`.
fn step1b(buf: &mut Vec<u8>) -> bool {
    let n = buf.len();
    if ends_in(buf, b"eed") {
        if m_gt0(&buf[..n - 3]) {
            buf.truncate(n - 1);
        }
        false
    } else if ends_in(buf, b"ed") {
        if has_vowel(&buf[..n - 2]) {
            buf.truncate(n - 2);
            return true;
        }
        false
    } else if ends_in(buf, b"ing") {
        if has_vowel(&buf[..n - 3]) {
            buf.truncate(n - 3);
            return true;
        }
        false
    } else {
        false
    }
}

/// `fts5PorterStep1B2`: true when it replaced `at`, `bl` or `iz`.
fn step1b2(buf: &mut Vec<u8>) -> bool {
    for suffix in [b"at", b"bl", b"iz"] {
        if ends_in(buf, suffix) {
            buf.push(b'e');
            return true;
        }
    }
    false
}

/// `fts5PorterCb`: the token stemmed, or unchanged if it is under 3 or over 64 bytes.
fn stem(token: &[u8]) -> Vec<u8> {
    let mut buf = token.to_vec();
    if !(3..=PORTER_MAX_TOKEN).contains(&buf.len()) {
        return buf;
    }

    // Step 1. Step 1a leaves at least 2 bytes, step 1b at least 1.
    step1a(&mut buf);
    if step1b(&mut buf) && !step1b2(&mut buf) {
        let n = buf.len();
        let c = buf[n - 1];
        // With 1 byte left, that byte is a vowel (step 1b found one), so the C code's read of
        // aBuf[-1] is never reached.
        if !is_vowel(c, false) && c != b'l' && c != b's' && c != b'z' && n >= 2 && c == buf[n - 2] {
            buf.truncate(n - 1);
        } else if m_eq1(&buf) && o_star(&buf) {
            buf.push(b'e');
        }
    }

    // Step 1c.
    let n = buf.len();
    if buf[n - 1] == b'y' && has_vowel(&buf[..n - 1]) {
        buf[n - 1] = b'i';
    }

    // Steps 2 to 4.
    apply(&mut buf, STEP2);
    apply(&mut buf, STEP3);
    apply(&mut buf, STEP4);

    // Step 5a.
    let n = buf.len();
    if buf[n - 1] == b'e' {
        let stem = &buf[..n - 1];
        if m_gt1(stem) || (m_eq1(stem) && !o_star(stem)) {
            buf.truncate(n - 1);
        }
    }

    // Step 5b.
    let n = buf.len();
    if n > 1 && buf[n - 1] == b'l' && buf[n - 2] == b'l' && m_gt1(&buf[..n - 1]) {
        buf.truncate(n - 1);
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems_porter_examples() {
        for (word, stemmed) in [
            ("caresses", "caress"),
            ("ponies", "poni"),
            ("cats", "cat"),
            ("agreed", "agre"),
            ("plastered", "plaster"),
            ("motoring", "motor"),
            ("conflated", "conflat"),
            ("hopping", "hop"),
            ("falling", "fall"),
            ("filing", "file"),
            ("happy", "happi"),
            ("relational", "relat"),
            ("generalization", "gener"),
            ("controll", "control"),
            ("abc", "abc"),
        ] {
            assert_eq!(tokens(word), [stemmed], "{word}");
        }
    }

    #[test]
    fn folds_case_and_diacritics() {
        assert_eq!(
            tokens("Héllo WORLD e\u{301}t\u{e9}"),
            ["hello", "world", "et"]
        );
    }

    #[test]
    fn leaves_short_and_long_tokens_unstemmed() {
        let long = "a".repeat(62) + "ing";
        assert_eq!(tokens(&long), std::slice::from_ref(&long));
        assert_eq!(tokens(&("a".repeat(61) + "ing")), ["a".repeat(61)]);
        assert_eq!(tokens("is as"), ["is", "as"]);
    }

    #[test]
    fn writes_split_bytes_as_hex() {
        // 丸 is E4 B8 B8: the double-consonant rule drops the last B8.
        assert_eq!(tokens("a丸ing"), ["a\u{fffd}e4\u{fffd}b8"]);
    }

    #[test]
    fn no_token_character_folds_to_nothing() {
        // So no token is ever empty: the first character of every token writes a byte.
        for c in (0..=0x10_FFFFu32).filter_map(char::from_u32) {
            if !c.is_ascii() && unicode::is_alnum(code_point(c)) {
                let folded = unicode::fold(code_point(c));
                assert_ne!(folded, 0, "U+{:04X}", u32::from(c));
            }
        }
    }

    #[test]
    fn folds_only_to_scalar_values_that_are_not_u_fffd() {
        for c in (0x80..=0x10_FFFFu32).filter_map(char::from_u32) {
            let folded = unicode::fold(code_point(c));
            assert!(
                folded == 0 || char::from_u32(folded).is_some(),
                "U+{:04X}",
                u32::from(c)
            );
            if unicode::is_alnum(code_point(c)) || unicode::is_diacritic(code_point(c)) {
                assert_ne!(folded, 0xFFFD, "U+{:04X}", u32::from(c));
            }
        }
        assert!(!unicode::is_alnum(0xFFFD));
    }
}
