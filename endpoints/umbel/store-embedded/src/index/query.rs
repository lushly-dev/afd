//! The query builder (specification section 8.1). tantivy's own `QueryParser` cannot serve the
//! promised syntax (it refuses a bare `term*` and has no limits), so the text is parsed with
//! `tantivy-query-grammar` and the resulting AST is walked here to build the tantivy query. The
//! reader filter and the structured filters are added as mandatory clauses of the outer query,
//! never through the text, and score nothing, so a score never depends on who is asking.

use std::collections::BTreeSet;
use std::ops::Bound;

use tantivy::DateTime;
use tantivy::Index;
use tantivy::Term;
use tantivy::query::{
    AllQuery, BooleanQuery, BoostQuery, ConstScoreQuery, EmptyQuery, Occur, PhrasePrefixQuery,
    PhraseQuery, Query, RangeQuery, TermQuery,
};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::tokenizer::TextAnalyzer;
use tantivy_query_grammar::{
    Delimiter, Occur as GrammarOccur, UserInputAst, UserInputBound, UserInputLeaf, UserInputLiteral,
    parse_query, parse_query_lenient,
};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use umbel_store::{IndexFilters, MAX_QUERY_CHARS, ReaderFilter, StoreError};

use super::schema::{Fields, PLAIN, STEMMED};

/// Leaf clauses a query may hold, counted as written (a default-field expansion is one).
pub(crate) const MAX_LEAVES: usize = 64;
/// Distinct named fields a query may use.
pub(crate) const MAX_FIELDS: usize = 8;
/// How deep clauses may nest.
pub(crate) const MAX_DEPTH: usize = 16;
/// The widest phrase slop.
pub(crate) const MAX_SLOP: u32 = 8;
/// The most terms a prefix expands to.
pub(crate) const MAX_EXPANSIONS: u32 = 256;
/// The shortest prefix, in characters.
pub(crate) const MIN_PREFIX_CHARS: usize = 2;
/// The largest boost.
pub(crate) const MAX_BOOST: f64 = 100.0;

/// The fields a bare term searches, with their boosts.
fn default_fields(f: &Fields) -> [(Field, f32); 6] {
    [
        (f.title, 3.0),
        (f.aliases, 2.5),
        (f.description, 2.0),
        (f.headings, 2.0),
        (f.body, 1.0),
        (f.code, 1.5),
    ]
}

/// The syntax names a query may use.
const VALID_FIELDS: &str = "title, aliases, description, headings, body, code, tags, owners, type, collection, status, verified, sensitivity, lang, path, updated, stale_after, meta.<key>";

/// What a named field is, to the builder.
#[derive(Clone, Copy)]
enum Kind {
    /// Prose, searched with `en_stem`; the boost is the field's.
    Stemmed(Field, f32),
    /// Text searched with the plain tokenizer.
    Plain(Field, f32),
    /// One raw term.
    Raw(Field),
    /// `path`: tokenised and raw.
    Path,
    /// A date, for ranges and exact matches.
    Date(Field),
    /// A key of the JSON field.
    Meta,
}

/// Build the full query: `text` as the user wrote it, `filters`, and the reader clause.
pub(crate) fn build(
    index: &Index,
    fields: &Fields,
    text: &str,
    filters: &IndexFilters,
    reader: &ReaderFilter,
) -> Result<Box<dyn Query>, StoreError> {
    if text.trim().is_empty() {
        return Err(StoreError::invalid(
            "the query is empty; give at least one term",
        ));
    }
    if text.chars().count() > MAX_QUERY_CHARS {
        return Err(StoreError::invalid(format!(
            "a query is at most {MAX_QUERY_CHARS} characters"
        )));
    }
    let ast = parse(text)?;
    let mut walker = Walker {
        index,
        f: fields,
        leaves: 0,
        names: BTreeSet::new(),
    };
    let matching = walker.walk(&ast, 1)?;
    let mut outer: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, matching)];
    if let Some(clauses) = filter_clauses(fields, filters)? {
        outer.push((Occur::Must, constant(clauses)));
    }
    if let Some(clause) = reader_clause(fields, reader) {
        outer.push((Occur::Must, constant(clause)));
    }
    Ok(Box::new(BooleanQuery::new(outer)))
}

/// The reader filter as a clause: any of the reader's tokens. `None` for a derivation read.
pub(crate) fn reader_clause(f: &Fields, reader: &ReaderFilter) -> Option<Box<dyn Query>> {
    let tokens = reader.token_list()?;
    if tokens.is_empty() {
        return Some(Box::new(EmptyQuery));
    }
    let clauses = tokens
        .iter()
        .map(|t| {
            let q: Box<dyn Query> = Box::new(TermQuery::new(
                Term::from_field_text(f.access, t),
                IndexRecordOption::Basic,
            ));
            (Occur::Should, q)
        })
        .collect();
    Some(Box::new(BooleanQuery::new(clauses)))
}

/// A query that filters and scores nothing.
pub(crate) fn constant(query: Box<dyn Query>) -> Box<dyn Query> {
    Box::new(ConstScoreQuery::new(query, 0.0))
}

fn raw_term(field: Field, text: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, text),
        IndexRecordOption::Basic,
    ))
}

/// The structured filters as mandatory clauses.
fn filter_clauses(f: &Fields, filters: &IndexFilters) -> Result<Option<Box<dyn Query>>, StoreError> {
    let mut must: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    let mut one = |field: Field, value: &Option<String>| {
        if let Some(value) = value {
            must.push((Occur::Must, raw_term(field, value)));
        }
    };
    one(f.collection, &filters.collection);
    one(f.doc_type, &filters.doc_type);
    one(f.status, &filters.status);
    one(f.sensitivity, &filters.sensitivity);
    for tag in &filters.tags {
        must.push((Occur::Must, raw_term(f.tags, tag)));
    }
    if !filters.verified.is_empty() {
        let any = filters
            .verified
            .iter()
            .map(|tier| (Occur::Should, raw_term(f.verified, tier)))
            .collect();
        must.push((Occur::Must, Box::new(BooleanQuery::new(any))));
    }
    if let Some(after) = &filters.updated_after {
        let at = parse_date(after)?;
        must.push((
            Occur::Must,
            Box::new(RangeQuery::new(
                Bound::Included(Term::from_field_date_for_search(f.updated, at)),
                Bound::Unbounded,
            )),
        ));
    }
    if must.is_empty() {
        Ok(None)
    } else {
        Ok(Some(Box::new(BooleanQuery::new(must))))
    }
}

fn parse_date(text: &str) -> Result<DateTime, StoreError> {
    OffsetDateTime::parse(text, &Rfc3339)
        .map(DateTime::from_utc)
        .map_err(|_| {
            StoreError::invalid(format!(
                "`{text}` is not an RFC 3339 date-time such as 2026-01-01T00:00:00Z"
            ))
        })
}

fn parse(text: &str) -> Result<UserInputAst, StoreError> {
    match parse_query(text) {
        Ok(ast) => Ok(ast),
        Err(_) => {
            let (_, errors) = parse_query_lenient(text);
            let detail = errors.first().map_or_else(
                || "the query does not parse".to_owned(),
                |e| format!("syntax error at position {}: {}", e.pos, e.message),
            );
            Err(StoreError::invalid(format!(
                "{detail}; valid fields are {VALID_FIELDS}"
            )))
        }
    }
}

struct Walker<'a> {
    index: &'a Index,
    f: &'a Fields,
    leaves: usize,
    names: BTreeSet<String>,
}

fn occur(grammar: Option<GrammarOccur>) -> Occur {
    match grammar {
        Some(GrammarOccur::Must) => Occur::Must,
        Some(GrammarOccur::MustNot) => Occur::MustNot,
        Some(GrammarOccur::Should) | None => Occur::Should,
    }
}

impl Walker<'_> {
    /// `depth` counts the clauses and boosts around `ast`, the outermost clause being 1.
    fn walk(&mut self, ast: &UserInputAst, depth: usize) -> Result<Box<dyn Query>, StoreError> {
        if depth > MAX_DEPTH && !matches!(ast, UserInputAst::Leaf(_)) {
            return Err(StoreError::invalid(format!(
                "a query nests at most {MAX_DEPTH} levels"
            )));
        }
        match ast {
            UserInputAst::Clause(parts) => {
                let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(parts.len());
                for (grammar_occur, part) in parts {
                    clauses.push((occur(*grammar_occur), self.walk(part, depth + 1)?));
                }
                if clauses.is_empty() {
                    return Ok(Box::new(EmptyQuery));
                }
                if clauses.iter().all(|(o, _)| *o == Occur::MustNot) {
                    // Only exclusions: everything but those, as tantivy's own parser reads it.
                    clauses.push((Occur::Should, Box::new(AllQuery)));
                }
                if clauses.len() == 1 && clauses[0].0 == Occur::Should {
                    return Ok(clauses.remove(0).1);
                }
                Ok(Box::new(BooleanQuery::new(clauses)))
            }
            UserInputAst::Boost(inner, boost) => {
                let boost = boost.into_inner();
                if !boost.is_finite() || boost <= 0.0 || boost > MAX_BOOST {
                    return Err(StoreError::invalid(format!(
                        "a boost is above 0 and at most {MAX_BOOST}"
                    )));
                }
                let inner = self.walk(inner, depth + 1)?;
                #[allow(clippy::cast_possible_truncation)]
                Ok(Box::new(BoostQuery::new(inner, boost as f32)))
            }
            UserInputAst::Leaf(leaf) => self.leaf(leaf),
        }
    }

    fn count_leaf(&mut self) -> Result<(), StoreError> {
        self.leaves += 1;
        if self.leaves > MAX_LEAVES {
            return Err(StoreError::invalid(format!(
                "a query holds at most {MAX_LEAVES} clauses"
            )));
        }
        Ok(())
    }

    fn name_field(&mut self, name: &str) -> Result<(), StoreError> {
        self.names.insert(name.to_owned());
        if self.names.len() > MAX_FIELDS {
            return Err(StoreError::invalid(format!(
                "a query names at most {MAX_FIELDS} different fields"
            )));
        }
        Ok(())
    }

    fn leaf(&mut self, leaf: &UserInputLeaf) -> Result<Box<dyn Query>, StoreError> {
        match leaf {
            UserInputLeaf::Literal(literal) => {
                self.count_leaf()?;
                self.literal(literal)
            }
            UserInputLeaf::Range {
                field,
                lower,
                upper,
            } => {
                self.count_leaf()?;
                self.range(field.as_deref(), lower, upper)
            }
            UserInputLeaf::Regex { .. } => Err(StoreError::invalid(
                "regular expressions are not supported; a single trailing `*` makes a prefix (`roll*`) and nothing else does",
            )),
            UserInputLeaf::All | UserInputLeaf::Exists { .. } => Err(StoreError::invalid(
                "`*` and `field:*` are not supported; a trailing `*` makes a prefix (`roll*`)",
            )),
            UserInputLeaf::Set { .. } => Err(StoreError::invalid(
                "`field: IN [...]` is not supported; write the terms with OR",
            )),
        }
    }

    /// The kind of a named field, or why it cannot be queried.
    fn resolve(&mut self, name: &str) -> Result<Kind, StoreError> {
        let f = self.f;
        let kind = match name {
            "title" => Kind::Stemmed(f.title, 3.0),
            "aliases" => Kind::Stemmed(f.aliases, 2.5),
            "description" => Kind::Stemmed(f.description, 2.0),
            "headings" => Kind::Stemmed(f.headings, 2.0),
            "body" => Kind::Stemmed(f.body, 1.0),
            "code" => Kind::Plain(f.code, 1.5),
            "tags" => Kind::Raw(f.tags),
            "owners" => Kind::Raw(f.owners),
            "type" => Kind::Raw(f.doc_type),
            "collection" => Kind::Raw(f.collection),
            "status" => Kind::Raw(f.status),
            "verified" => Kind::Raw(f.verified),
            "sensitivity" => Kind::Raw(f.sensitivity),
            "lang" => Kind::Raw(f.lang),
            "path" => Kind::Path,
            "updated" => Kind::Date(f.updated),
            "stale_after" => Kind::Date(f.stale_after),
            "access" => {
                return Err(StoreError::invalid(
                    "the `access` field cannot be queried; access is enforced by the reader filter",
                ));
            }
            other if other.strip_prefix("meta.").is_some_and(valid_meta_key) => Kind::Meta,
            other => {
                return Err(StoreError::invalid(format!(
                    "`{other}` is not a field you can query; valid fields are {VALID_FIELDS}"
                )));
            }
        };
        self.name_field(name)?;
        Ok(kind)
    }

    fn analyzer(&self, name: &str) -> Result<TextAnalyzer, StoreError> {
        self.index
            .tokenizers()
            .get(name)
            .ok_or_else(|| StoreError::Corrupt(format!("the tokenizer `{name}` is not registered")))
    }

    fn tokens(&self, tokenizer: &str, text: &str) -> Result<Vec<String>, StoreError> {
        let mut analyzer = self.analyzer(tokenizer)?;
        let mut stream = analyzer.token_stream(text);
        let mut out = Vec::new();
        while stream.advance() {
            out.push(stream.token().text.clone());
        }
        Ok(out)
    }

    fn literal(&mut self, written: &UserInputLiteral) -> Result<Box<dyn Query>, StoreError> {
        let literal = &Literal::of(written)?;
        if literal.slop > MAX_SLOP {
            return Err(StoreError::invalid(format!(
                "a phrase slop is at most {MAX_SLOP}"
            )));
        }
        match written.field_name.as_deref() {
            None => {
                let mut should: Vec<(Occur, Box<dyn Query>)> = Vec::new();
                for (field, boost) in default_fields(self.f) {
                    let tokenizer = if field == self.f.code { PLAIN } else { STEMMED };
                    let query = self.text_query(field, tokenizer, literal)?;
                    should.push((Occur::Should, Box::new(BoostQuery::new(query, boost))));
                }
                Ok(Box::new(BooleanQuery::new(should)))
            }
            Some(name) => match self.resolve(name)? {
                Kind::Stemmed(field, boost) => {
                    let query = self.text_query(field, STEMMED, literal)?;
                    Ok(Box::new(BoostQuery::new(query, boost)))
                }
                Kind::Plain(field, boost) => {
                    let query = self.text_query(field, PLAIN, literal)?;
                    Ok(Box::new(BoostQuery::new(query, boost)))
                }
                Kind::Raw(field) => {
                    plain_only(literal)?;
                    Ok(raw_term(field, &literal.phrase))
                }
                Kind::Path => {
                    let tokenised = self.text_query(self.f.path, PLAIN, literal)?;
                    if literal.slop > 0 || literal.prefix {
                        return Ok(tokenised);
                    }
                    Ok(Box::new(BooleanQuery::new(vec![
                        (Occur::Should, tokenised),
                        (Occur::Should, raw_term(self.f.path_raw, &literal.phrase)),
                    ])))
                }
                Kind::Date(field) => {
                    plain_only(literal)?;
                    let at = Term::from_field_date_for_search(field, parse_date(&literal.phrase)?);
                    Ok(Box::new(RangeQuery::new(
                        Bound::Included(at.clone()),
                        Bound::Included(at),
                    )))
                }
                Kind::Meta => {
                    plain_only(literal)?;
                    Ok(self.meta_query(name, &literal.phrase))
                }
            },
        }
    }

    /// One text field's query for a literal: a term, a phrase (with its slop), or a prefix.
    fn text_query(
        &self,
        field: Field,
        tokenizer: &str,
        literal: &Literal,
    ) -> Result<Box<dyn Query>, StoreError> {
        if literal.prefix {
            return self.prefix_query(field, tokenizer, &literal.phrase);
        }
        let terms: Vec<Term> = self
            .tokens(tokenizer, &literal.phrase)?
            .iter()
            .map(|t| Term::from_field_text(field, t))
            .collect();
        match terms.len() {
            0 => Ok(Box::new(EmptyQuery)),
            1 => Ok(Box::new(TermQuery::new(
                terms.into_iter().next().unwrap_or_else(|| unreachable!()),
                IndexRecordOption::WithFreqsAndPositions,
            ))),
            _ => {
                let offsets = terms.into_iter().enumerate().collect();
                Ok(Box::new(PhraseQuery::new_with_offset_and_slop(
                    offsets,
                    literal.slop,
                )))
            }
        }
    }

    /// `roll*` as a phrase prefix of one term, bounded at [`MAX_EXPANSIONS`]. The prefix is
    /// lower-cased and not stemmed; the words before it, in a phrase, are stemmed as indexed.
    /// Constant score, like every expansion, so a common prefix cannot outrank a real match.
    fn prefix_query(
        &self,
        field: Field,
        tokenizer: &str,
        text: &str,
    ) -> Result<Box<dyn Query>, StoreError> {
        let mut words = self.tokens(PLAIN, text)?;
        let Some(prefix) = words.pop() else {
            return Err(StoreError::invalid("a prefix needs at least one letter"));
        };
        if prefix.chars().count() < MIN_PREFIX_CHARS {
            return Err(StoreError::invalid(format!(
                "a prefix is at least {MIN_PREFIX_CHARS} characters"
            )));
        }
        let mut terms: Vec<(usize, Term)> = Vec::with_capacity(words.len() + 1);
        for word in &words {
            let stemmed = if tokenizer == STEMMED {
                self.tokens(STEMMED, word)?
                    .into_iter()
                    .next()
                    .unwrap_or_else(|| word.clone())
            } else {
                word.clone()
            };
            terms.push((terms.len(), Term::from_field_text(field, &stemmed)));
        }
        terms.push((terms.len(), Term::from_field_text(field, &prefix)));
        let mut query = PhrasePrefixQuery::new_with_offset(terms);
        query.set_max_expansions(MAX_EXPANSIONS);
        Ok(Box::new(ConstScoreQuery::new(Box::new(query), 1.0)))
    }

    /// `meta.<key>:value`: the string, and the number or boolean it also reads as.
    fn meta_query(&self, name: &str, value: &str) -> Box<dyn Query> {
        let key = name.strip_prefix("meta.").unwrap_or(name);
        let term = |append: &dyn Fn(&mut Term)| {
            let mut term = Term::from_field_json_path(self.f.meta, key, true);
            append(&mut term);
            term
        };
        let mut alternatives = vec![term(&|t| t.append_type_and_str(value))];
        if let Ok(n) = value.parse::<i64>() {
            alternatives.push(term(&|t| t.append_type_and_fast_value(n)));
        }
        if let Ok(b) = value.parse::<bool>() {
            alternatives.push(term(&|t| t.append_type_and_fast_value(b)));
        }
        let clauses = alternatives
            .into_iter()
            .map(|t| {
                let q: Box<dyn Query> = Box::new(TermQuery::new(t, IndexRecordOption::Basic));
                (Occur::Should, q)
            })
            .collect();
        Box::new(BooleanQuery::new(clauses))
    }

    fn range(
        &mut self,
        field: Option<&str>,
        lower: &UserInputBound,
        upper: &UserInputBound,
    ) -> Result<Box<dyn Query>, StoreError> {
        let Some(name) = field else {
            return Err(StoreError::invalid(
                "a range names its field: `updated:[2026-01-01T00:00:00Z TO *]`",
            ));
        };
        let Kind::Date(field) = self.resolve(name)? else {
            return Err(StoreError::invalid(format!(
                "ranges are for the date fields `updated` and `stale_after`, not `{name}`"
            )));
        };
        let bound = |b: &UserInputBound| -> Result<Bound<Term>, StoreError> {
            let term = |text: &str| -> Result<Term, StoreError> {
                Ok(Term::from_field_date_for_search(field, parse_date(text)?))
            };
            Ok(match b {
                UserInputBound::Unbounded => Bound::Unbounded,
                UserInputBound::Inclusive(t) if t == "*" => Bound::Unbounded,
                UserInputBound::Exclusive(t) if t == "*" => Bound::Unbounded,
                UserInputBound::Inclusive(t) => Bound::Included(term(t)?),
                UserInputBound::Exclusive(t) => Bound::Excluded(term(t)?),
            })
        };
        let (lower, upper) = (bound(lower)?, bound(upper)?);
        if matches!((&lower, &upper), (Bound::Unbounded, Bound::Unbounded)) {
            return Err(StoreError::invalid(
                "a range needs at least one bound; `[* TO *]` matches everything",
            ));
        }
        Ok(Box::new(RangeQuery::new(lower, upper)))
    }
}

/// A literal as the builder reads it. tantivy-query-grammar 0.27 marks `prefix` only on a quoted
/// phrase (`"a b"*`); an unquoted `roll*` arrives as the word `roll*`, so a single trailing `*`
/// is read here, and any other unescaped `*` (`*b`, `b*b`) is refused rather than silently
/// dropped by the tokenizer.
struct Literal {
    phrase: String,
    slop: u32,
    prefix: bool,
}

impl Literal {
    fn of(written: &UserInputLiteral) -> Result<Self, StoreError> {
        let mut phrase = written.phrase.clone();
        let mut prefix = written.prefix;
        if written.delimiter == Delimiter::None {
            let mut stars = Vec::new();
            let mut chars = phrase.char_indices();
            while let Some((at, c)) = chars.next() {
                match c {
                    '\\' => {
                        chars.next();
                    }
                    '*' => stars.push(at),
                    _ => {}
                }
            }
            match stars.as_slice() {
                [] => {}
                [at] if *at + 1 == phrase.len() && *at > 0 => {
                    phrase.truncate(*at);
                    prefix = true;
                }
                _ => {
                    return Err(StoreError::invalid(
                        "wildcards are not supported; a single trailing `*` makes a prefix (`roll*`) and nothing else does",
                    ));
                }
            }
        }
        Ok(Self {
            phrase,
            slop: written.slop,
            prefix,
        })
    }
}

/// A raw, date or meta field takes the literal as one value: no slop, no prefix.
fn plain_only(literal: &Literal) -> Result<(), StoreError> {
    if literal.slop > 0 || literal.prefix {
        return Err(StoreError::invalid(
            "slop and prefixes apply to text fields (title, aliases, description, headings, body, code, path)",
        ));
    }
    Ok(())
}

fn valid_meta_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 128 && !key.chars().any(char::is_control)
}
