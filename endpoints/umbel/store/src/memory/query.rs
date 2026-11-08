//! The memory query (phase 3 section 5.2): one syntax for every backend, parsed here, so query
//! text never reaches a backend's own parser.
//!
//! The forms are `knowledge-search`'s subset: `word`, `"a phrase"`, `word*` (at least two
//! characters before the star), `+word` (required), `-word` (excluded), and a field prefix
//! `subject:`, `tags:` or `body:` on any of them, in the order sign, field, term. Terms are OR by
//! default. There are no parentheses and no `AND`, `OR` or `NOT`: those words are plain terms.

use crate::error::{Result, StoreError};

/// The longest query text, in characters.
pub const MAX_MEMORY_QUERY_CHARS: usize = 1024;
/// The most terms one query holds.
pub const MAX_MEMORY_QUERY_TERMS: usize = 32;

/// Which column a term is limited to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TermField {
    /// `subject:`.
    Subject,
    /// `tags:`.
    Tags,
    /// `body:`, the record's `text`.
    Body,
}

impl TermField {
    /// The prefix as written in a query.
    #[must_use]
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Subject => "subject:",
            Self::Tags => "tags:",
            Self::Body => "body:",
        }
    }

    /// The embedded backend's FTS5 column (5.3): `subject`, `tags` or `text`.
    #[must_use]
    pub fn column(self) -> &'static str {
        match self {
            Self::Subject => "subject",
            Self::Tags => "tags",
            Self::Body => "text",
        }
    }
}

/// How a term takes part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Occur {
    /// A plain term: matches on its own when there is no required term, and only raises rank
    /// beside one.
    Should,
    /// `+term`: every hit has it.
    Must,
    /// `-term`: no hit has it.
    MustNot,
}

/// One parsed term.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QueryTerm {
    /// Plain, required or excluded.
    pub occur: Occur,
    /// The column it is limited to, if any.
    pub field: Option<TermField>,
    /// The term's text: a word, or a phrase's inner text, without quotes or star.
    pub text: String,
    /// Written as `"a phrase"`.
    pub phrase: bool,
    /// Written as `word*`: matches tokens that start with it.
    pub prefix: bool,
}

/// A parsed memory query. Build one with [`MemoryQuery::parse`] or [`MemoryQuery::any_of`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MemoryQuery {
    terms: Vec<QueryTerm>,
}

fn refuse<T>(message: &str, position: usize) -> Result<T> {
    Err(StoreError::invalid(format!(
        "memory query: {message} at position {position}"
    )))
}

const FIELDS: [TermField; 3] = [TermField::Subject, TermField::Tags, TermField::Body];

impl MemoryQuery {
    /// Parse query text. Positions in errors count characters from 0.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the rule and its position: more than
    /// [`MAX_MEMORY_QUERY_CHARS`] characters or [`MAX_MEMORY_QUERY_TERMS`] terms, no term that is
    /// not excluded, an unterminated or empty phrase, a sign or field with no term, a star that
    /// does not end a word of at least two characters, or a term with no letter or digit.
    pub fn parse(text: &str) -> Result<Self> {
        let chars: Vec<char> = text.chars().collect();
        if chars.len() > MAX_MEMORY_QUERY_CHARS {
            return refuse(
                "a query holds at most 1024 characters",
                MAX_MEMORY_QUERY_CHARS,
            );
        }
        let mut terms = Vec::new();
        let mut at = 0;
        loop {
            while at < chars.len() && chars[at].is_whitespace() {
                at += 1;
            }
            if at == chars.len() {
                break;
            }
            let start = at;
            if terms.len() == MAX_MEMORY_QUERY_TERMS {
                return refuse("a query holds at most 32 terms", start);
            }
            let (term, next) = parse_term(&chars, at)?;
            terms.push(term);
            at = next;
        }
        if terms.is_empty() {
            return refuse("a query needs a term", 0);
        }
        if terms.iter().all(|t| t.occur == Occur::MustNot) {
            return refuse("a query needs a term that is not excluded", 0);
        }
        Ok(Self { terms })
    }

    /// An OR of plain terms, such as a bundle's task terms (phase 3 section 9.3).
    ///
    /// # Errors
    /// [`StoreError::Invalid`] for no term, more than [`MAX_MEMORY_QUERY_TERMS`], or a term that
    /// is empty, holds whitespace or has no letter or digit.
    pub fn any_of<I, S>(terms: I) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut out = Vec::new();
        for (n, term) in terms.into_iter().enumerate() {
            let text: String = term.into();
            if n == MAX_MEMORY_QUERY_TERMS {
                return Err(StoreError::invalid("memory query: at most 32 terms"));
            }
            if text.chars().any(char::is_whitespace) || !text.chars().any(char::is_alphanumeric) {
                return Err(StoreError::invalid(format!(
                    "memory query: term {n} must be one word with a letter or digit"
                )));
            }
            out.push(QueryTerm {
                occur: Occur::Should,
                field: None,
                text,
                phrase: false,
                prefix: false,
            });
        }
        if out.is_empty() {
            return Err(StoreError::invalid("memory query: a query needs a term"));
        }
        Ok(Self { terms: out })
    }

    /// The terms, in the order written.
    #[must_use]
    pub fn terms(&self) -> &[QueryTerm] {
        &self.terms
    }

    /// The FTS5 expression the embedded backend runs (section 5.2). Every term is double-quoted,
    /// with `"` doubled inside, so nothing in the text is FTS5 syntax. With required terms R1, R2
    /// and plain terms P1, P2 it is `"R1" AND "R2" AND ("R1" OR "P1" OR "P2")`; with no plain
    /// term `"R1" AND "R2"`; with no required term `"P1" OR "P2"`. Excluded terms follow the
    /// whole expression, parenthesised, as `NOT "X"`.
    #[must_use]
    pub fn fts5(&self) -> String {
        let of = |occur: Occur| -> Vec<String> {
            self.terms
                .iter()
                .filter(|t| t.occur == occur)
                .map(quote)
                .collect()
        };
        let (required, plain, excluded) = (of(Occur::Must), of(Occur::Should), of(Occur::MustNot));
        let core = match (required.first(), plain.is_empty()) {
            (Some(first), false) => {
                let mut any = vec![first.clone()];
                any.extend(plain);
                format!("{} AND ({})", required.join(" AND "), any.join(" OR "))
            }
            (Some(_), true) => required.join(" AND "),
            (None, _) => plain.join(" OR "),
        };
        if excluded.is_empty() {
            core
        } else {
            let mut out = format!("({core})");
            for x in excluded {
                out.push_str(" NOT ");
                out.push_str(&x);
            }
            out
        }
    }
}

impl QueryTerm {
    /// The term alone as FTS5 text: `column:"text"`, with a star after a prefix term.
    #[must_use]
    pub fn fts5(&self) -> String {
        quote(self)
    }
}

impl MemoryQuery {
    /// The phrases of [`MemoryQuery::fts5`]'s expression, in the order FTS5 numbers them: the
    /// required terms; the first required term again when there are plain terms; the plain
    /// terms; then the excluded ones. Recall's BM25 scores each (phase 5 section 9.2), as FTS5's
    /// `bm25()` scored the expression's phrases.
    #[must_use]
    pub fn phrases(&self) -> Vec<&QueryTerm> {
        let of = |occur: Occur| self.terms.iter().filter(move |t| t.occur == occur);
        let mut out: Vec<&QueryTerm> = of(Occur::Must).collect();
        let first = out.first().copied();
        let plain: Vec<&QueryTerm> = of(Occur::Should).collect();
        if let (Some(first), false) = (first, plain.is_empty()) {
            out.push(first);
        }
        out.extend(plain);
        out.extend(of(Occur::MustNot));
        out
    }
}

/// One term as FTS5 text: `column:"text"`, with a star after a prefix term.
fn quote(term: &QueryTerm) -> String {
    let mut out = String::new();
    if let Some(field) = term.field {
        out.push_str(field.column());
        out.push(':');
    }
    out.push('"');
    out.push_str(&term.text.replace('"', "\"\""));
    out.push('"');
    if term.prefix {
        out.push('*');
    }
    out
}

/// Parse one term starting at `at` (not whitespace); returns it and the position after it.
fn parse_term(chars: &[char], mut at: usize) -> Result<(QueryTerm, usize)> {
    let start = at;
    let ends = |i: usize| i >= chars.len() || chars[i].is_whitespace();
    let occur = match chars[at] {
        '+' => Occur::Must,
        '-' => Occur::MustNot,
        _ => Occur::Should,
    };
    if occur != Occur::Should {
        at += 1;
        if ends(at) {
            return refuse("a sign needs a term after it", start);
        }
    }
    let field = FIELDS.into_iter().find(|f| {
        let prefix: Vec<char> = f.prefix().chars().collect();
        chars[at..].starts_with(&prefix)
    });
    if let Some(field) = field {
        let field_at = at;
        at += field.prefix().chars().count();
        if ends(at) {
            return refuse("a field needs a term after it", field_at);
        }
    }
    if chars[at] == '"' {
        let open = at;
        let Some(len) = chars[open + 1..].iter().position(|c| *c == '"') else {
            return refuse("a phrase is not closed", open);
        };
        let close = open + 1 + len;
        let text: String = chars[open + 1..close].iter().collect();
        let text = text.trim().to_owned();
        if !text.chars().any(char::is_alphanumeric) {
            return refuse("a phrase needs a letter or digit", open);
        }
        let after = close + 1;
        if !ends(after) {
            let why = if chars[after] == '*' {
                "a phrase takes no star"
            } else {
                "a phrase must be followed by a space"
            };
            return refuse(why, after);
        }
        let term = QueryTerm {
            occur,
            field,
            text,
            phrase: true,
            prefix: false,
        };
        return Ok((term, after));
    }
    let word_at = at;
    while !ends(at) {
        at += 1;
    }
    let word: Vec<char> = chars[word_at..at].to_vec();
    let stars = word.iter().filter(|c| **c == '*').count();
    let prefix = word.last() == Some(&'*');
    if stars > 1 || (stars == 1 && !prefix) {
        return refuse("a star may only end a word", word_at);
    }
    let text: String = word[..word.len() - usize::from(prefix)].iter().collect();
    if prefix && text.chars().count() < 2 {
        return refuse("a star needs at least two characters before it", word_at);
    }
    if !text.chars().any(char::is_alphanumeric) {
        return refuse("a term needs a letter or digit", word_at);
    }
    let term = QueryTerm {
        occur,
        field,
        text,
        phrase: false,
        prefix,
    };
    Ok((term, at))
}
