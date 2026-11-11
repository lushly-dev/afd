//! The format's identifier patterns, as Specimen's `PACK_PATTERNS` exports them
//! (`foundations/specimen/src/pack-schema.ts`). Each is ASCII-only and means the same in
//! ECMAScript and in the `regex` crate; `tests/patterns.rs` holds each string and longest length
//! equal to Specimen's generated JSON Schema files.

use std::sync::OnceLock;

use regex::Regex;

/// One pattern and the format's longest length for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Pattern {
    index: usize,
    pub(crate) source: &'static str,
    pub(crate) max: usize,
}

macro_rules! patterns {
    ($($name:ident = $index:literal, $source:literal, $max:literal;)*) => {
        $(pub(crate) const $name: Pattern =
            Pattern { index: $index, source: $source, max: $max };)*
        /// Every pattern, in index order.
        pub(crate) const ALL: &[Pattern] = &[$($name),*];
    };
}

patterns! {
    LIBRARY = 0, r"^[a-z][a-z0-9-]{0,63}$", 64;
    TAG = 1, r"^[a-z][a-z0-9._]*-[a-z0-9._-]*$", 100;
    PREFIX = 2, r"^[a-z][a-z0-9._]*-$", 32;
    ELEMENT = 3, r"^[a-z][a-z0-9._-]*$", 100;
    ID = 4, r"^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$", 128;
    VERSION = 5, r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$", 64;
    DIGEST = 6, r"^sha256:[0-9a-f]{64}$", 71;
    REVISION = 7, r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$", 64;
    PACKAGE = 8, r"^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$", 214;
    SPECIFIER = 9, r"^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:\/[A-Za-z0-9._~-]+)*$", 256;
    STORY = 10, r"^[a-z0-9][a-z0-9._-]*$", 200;
    ATTRIBUTE = 11, r"^[a-z][a-z0-9_.:-]*$", 100;
    PROPERTY = 12, r"^[A-Za-z_$][A-Za-z0-9_$]*$", 100;
    SLOT = 13, r"^(?:|[A-Za-z][A-Za-z0-9_.:-]*)$", 100;
    EVENT = 14, r"^[A-Za-z][A-Za-z0-9_.:-]*$", 100;
    COMMAND = 15, r"^(?:--)?[a-z][a-z0-9-]*$", 100;
    CSS_PROPERTY = 16, r"^--[A-Za-z0-9_-]+$", 100;
    STATE = 17, r"^[a-z][a-z0-9-]*$", 64;
    ROLE = 18, r"^[a-z]+$", 32;
    AXE_RULE = 19, r"^[a-z0-9-]+$", 64;
    GAP_NAME = 20, r"^(?:|(?:--)?[A-Za-z][A-Za-z0-9_.:-]*)$", 100;
}

fn compiled() -> &'static [Option<Regex>] {
    static REGEXES: OnceLock<Vec<Option<Regex>>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        ALL.iter()
            // `/` is escaped in the JavaScript sources; a class of one literal slash needs none.
            .map(|pattern| Regex::new(&pattern.source.replace(r"\/", "/")).ok())
            .collect()
    })
}

impl Pattern {
    /// Whether `value` matches the pattern. Its length is checked apart from this, as the format
    /// does, so a value too long and of the wrong shape is two problems there too.
    pub(crate) fn matches(self, value: &str) -> bool {
        compiled()
            .get(self.index)
            .and_then(Option::as_ref)
            .is_some_and(|regex| regex.is_match(value))
    }

    /// Whether `value` is at most the pattern's longest length and matches it. Every pattern is
    /// ASCII-only, so a value that matches counts the same in bytes as in any other unit.
    pub(crate) fn accepts(self, value: &str) -> bool {
        value.len() <= self.max && self.matches(value)
    }
}
