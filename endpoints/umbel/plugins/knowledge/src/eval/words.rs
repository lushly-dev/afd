//! The pseudo-word generator: syllables from fixed lists, combined by a [`Pcg32`] stream.
//!
//! No real word is generated. Every generated word is built from a letter set the fixture's
//! *unanswerable* queries never use, so an unanswerable word cannot stem to a token the corpus
//! holds (`en_stem` only strips suffixes; a word that keeps a letter the corpus lacks keeps its
//! stem distinct).

use std::collections::BTreeSet;

use super::rng::Pcg32;

/// Onsets of the words the corpus emits.
const ONSETS: [&str; 16] = [
    "b", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z",
];
const VOWELS: [&str; 5] = ["a", "e", "i", "o", "u"];
/// Final syllables, none of which an English stemmer strips or maps (no `s`, `d`, `y`, `e`, `l`,
/// `t`, `g`, `ion`, `er`, `ent`).
const ENDINGS: [&str; 9] = ["ar", "or", "um", "an", "in", "ik", "ek", "ok", "ur"];

/// Onsets of the words that are never emitted: letters the corpus does not use.
const NEVER_ONSETS: [&str; 5] = ["q", "w", "x", "c", "y"];

/// Hands out pseudo-words, each at most once.
#[derive(Debug)]
pub struct Words {
    rng: Pcg32,
    used: BTreeSet<String>,
}

impl Words {
    /// A generator on its own PCG32 stream.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self {
            rng: Pcg32::new(seed, 0x57_4f_52_44),
            used: BTreeSet::new(),
        }
    }

    fn syllable(&mut self) -> String {
        format!("{}{}", self.rng.pick(&ONSETS), self.rng.pick(&VOWELS))
    }

    fn build(&mut self) -> String {
        let syllables = self.rng.between(1, 2);
        let mut word = String::new();
        for _ in 0..syllables {
            word.push_str(&self.syllable());
        }
        // The ending follows an onset, so a word always alternates consonant and vowel.
        word.push_str(self.rng.pick(&ONSETS));
        word.push_str(self.rng.pick(&ENDINGS));
        word
    }

    /// A word nobody has been given yet.
    pub fn fresh(&mut self) -> String {
        loop {
            let word = self.build();
            if self.used.insert(word.clone()) {
                return word;
            }
        }
    }

    /// `count` fresh words.
    pub fn fresh_many(&mut self, count: usize) -> Vec<String> {
        (0..count).map(|_| self.fresh()).collect()
    }

    /// Every word handed out so far.
    #[must_use]
    pub fn issued(&self) -> &BTreeSet<String> {
        &self.used
    }

    /// Draw an index in `0..len`; the generator's stream is shared with the documents' prose.
    pub fn draw(&mut self, len: usize) -> usize {
        self.rng.index(len)
    }

    /// The underlying stream.
    pub fn rng(&mut self) -> &mut Pcg32 {
        &mut self.rng
    }
}

/// `count` distinct words the corpus never emits: every syllable starts with a letter the
/// generator does not use (`q`, `w`, `x`, `c` or `y`).
#[must_use]
pub fn never_emitted(seed: u64, count: usize) -> Vec<String> {
    let mut rng = Pcg32::new(seed, 0x4e_45_56_45);
    let mut seen = BTreeSet::new();
    let mut words = Vec::new();
    while words.len() < count {
        let mut word = String::new();
        for _ in 0..rng.between(2, 3) {
            word.push_str(rng.pick(&NEVER_ONSETS));
            word.push_str(rng.pick(&VOWELS));
        }
        word.push_str(rng.pick(&NEVER_ONSETS));
        word.push_str(rng.pick(&ENDINGS));
        if seen.insert(word.clone()) {
            words.push(word);
        }
    }
    words
}

/// Whether `word` could have come from [`Words`]: only the emitted letters.
#[must_use]
pub fn is_emittable(word: &str) -> bool {
    word.chars().all(|c| {
        let one = c.to_string();
        ONSETS.contains(&one.as_str()) || VOWELS.contains(&one.as_str()) || c == 'r'
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_are_unique_deterministic_and_never_use_the_unemitted_letters() {
        let mut a = Words::new(1);
        let mut b = Words::new(1);
        let first = a.fresh_many(500);
        assert_eq!(first, b.fresh_many(500));
        let set: BTreeSet<&String> = first.iter().collect();
        assert_eq!(set.len(), 500);
        assert!(first.iter().all(|word| is_emittable(word)));
        for word in never_emitted(1, 40) {
            assert!(!is_emittable(&word), "{word}");
            assert!(word.chars().any(|c| "qwxcy".contains(c)));
        }
    }
}
