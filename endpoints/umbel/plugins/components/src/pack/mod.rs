//! Reading a library: the listing, the files, the check, the typed library (specification,
//! section 3; Patterns Amendment A31.1).
//!
//! This is a second implementation of Specimen's `checkPack` in the exported form. Specimen's code,
//! `foundations/specimen/src/pack.ts`, is normative for each problem's code and pointer, and
//! `tests/fixtures_invalid.rs` holds the two readers equal on Specimen's invalid fixtures. A
//! library with a problem is never served in part (D152).

pub(crate) mod aggregate;
pub(crate) mod canonical;
pub(crate) mod digest;
mod identifiers;
pub(crate) mod patterns;
pub(crate) mod problem;
pub(crate) mod schema;
pub(crate) mod schema_pattern;
pub(crate) mod text;

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::de::DeserializeOwned;
use serde_json::Value;
use umbel_sdk::{Cx, HostError, Outcome};

use crate::fail;
use crate::scan;

use identifiers::{
    catalog_identifiers, copy_identifiers, pattern_identifiers, record_identifiers,
    rules_identifiers,
};

use problem::{
    CATALOG_MISMATCH, COPY_MISMATCH, COPY_UNKNOWN, DIGEST_MISMATCH, DUPLICATE_ID, FILE_TOO_LARGE,
    FORMAT_UNSUPPORTED, IDENTIFIER_INVALID, JSON_INVALID, LAYOUT_INVALID, LIBRARY_MISMATCH,
    NOT_CANONICAL, PATTERN_MISMATCH, PATTERN_UNKNOWN, PREFIX_MISMATCH, Problem, RULE_UNKNOWN,
    SCHEMA_INVALID, TAG_MISMATCH, TAG_UNKNOWN,
};
use schema::{Catalog, Record, Rules, Shape};
use schema_pattern::{CopyRecord, PatternRecord};

/// The plugin's one pack.
pub(crate) const PACK: &str = "library";
/// The host's file, skipped as a check skips it.
const PACK_TOML: &str = "pack.toml";
/// At most this many libraries in one pack (section 3.4).
const MAX_LIBRARIES: usize = 64;
/// At most this many bytes in one pack file (section 3.4).
const MAX_FILE_BYTES: usize = 1024 * 1024;

/// One library that passed every check.
#[derive(Debug, Clone)]
pub(crate) struct Library {
    pub(crate) id: String,
    #[allow(dead_code)]
    pub(crate) format: u8,
    pub(crate) catalog: Catalog,
    pub(crate) rules: Rules,
    /// In tag order.
    pub(crate) records: Vec<Record>,
    /// Format 2 pattern records, in pattern order.
    #[allow(dead_code)]
    pub(crate) patterns: Vec<PatternRecord>,
    /// Format 2 saved copy records, in `(pattern, name)` order.
    #[allow(dead_code)]
    pub(crate) copies: Vec<CopyRecord>,
}

/// One library's place in the listing.
#[derive(Debug, Default)]
struct Files {
    /// A catalog, rules file or record was placed for it, so the format's checks apply.
    placed: bool,
    rules: Option<String>,
    catalog: Option<String>,
    /// `(path, tag)` in path order.
    records: Vec<(String, String)>,
    /// `(path, pattern)` in path order (format 2).
    patterns: Vec<(String, String)>,
    /// `(path, pattern, name)` in path order (format 2).
    copies: Vec<(String, String, String)>,
    /// Paths under `components/` or `patterns/` the layout does not place; they still count in the pack digest.
    unplaced_data: Vec<String>,
    /// Layout problems.
    problems: Vec<Problem>,
}

/// What a path is, by the format's layout.
enum Located {
    Rules(String),
    Catalog(String),
    Record(String, String),
    Pattern(String, String),
    Copy(String, String, String),
}

fn split_data(path: &str) -> Option<(&str, &str)> {
    path.strip_prefix("data/")?.split_once('/')
}

fn locate(path: &str) -> Option<Located> {
    if let Some(name) = path
        .strip_prefix("rules/")
        .and_then(|rest| rest.strip_suffix(".json"))
        && !name.contains('/')
        && patterns::LIBRARY.matches(name)
    {
        return Some(Located::Rules(name.to_owned()));
    }
    let (library, rest) = split_data(path)?;
    if !patterns::LIBRARY.matches(library) {
        return None;
    }
    if rest == "library.json" {
        return Some(Located::Catalog(library.to_owned()));
    }
    if let Some(tag) = rest
        .strip_prefix("components/")
        .and_then(|tail| tail.strip_suffix(".json"))
    {
        return (!tag.contains('/') && patterns::TAG.accepts(tag))
            .then(|| Located::Record(library.to_owned(), tag.to_owned()));
    }
    if let Some(tail) = rest
        .strip_prefix("patterns/")
        .and_then(|tail| tail.strip_suffix(".json"))
    {
        if let Some((pattern, name)) = tail.split_once('/') {
            if !name.contains('/')
                && patterns::PATTERN.accepts(pattern)
                && patterns::COPY_NAME.accepts(name)
            {
                return Some(Located::Copy(
                    library.to_owned(),
                    pattern.to_owned(),
                    name.to_owned(),
                ));
            }
            return None;
        }
        return patterns::PATTERN
            .accepts(tail)
            .then(|| Located::Pattern(library.to_owned(), tail.to_owned()));
    }
    None
}

/// The library an unplaced path belongs to, when the layout gives it one (section 3.1).
fn library_of_unplaced(path: &str) -> Option<&str> {
    if let Some((library, _)) = split_data(path) {
        return patterns::LIBRARY.matches(library).then_some(library);
    }
    let name = path.strip_prefix("rules/")?;
    if name.contains('/') {
        return None;
    }
    let (library, _) = name.split_once('.')?;
    patterns::LIBRARY.matches(library).then_some(library)
}

fn plain_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 100
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

/// A path the layout does not place, shown only as far as its segments are plain names, as
/// `checkPack`'s `shownPath` shows it. A shown path the scan hits is cut to its first segment, or
/// to nothing when the hit is in that segment (section 3.3).
fn shown_path(path: &str) -> String {
    let segments: Vec<&str> = path.split('/').collect();
    let kept: Vec<&str> = segments
        .iter()
        .take_while(|segment| plain_segment(segment))
        .copied()
        .collect();
    let shown = if kept.len() == segments.len() {
        path.to_owned()
    } else {
        let mut parts = kept.clone();
        parts.push("…");
        parts.join("/")
    };
    if !scan::path_hit(&shown) {
        return shown;
    }
    match kept.first() {
        Some(first) if !scan::path_hit(first) => format!("{first}/…"),
        _ => "…".to_owned(),
    }
}

/// Sanitizes a JSON Pointer so pack-supplied map keys (`facets`, `setups`, `targets`, `gates`)
/// holding free text or instruction-like words never leak into refusal details (D153).
fn shown_pointer(at: &str) -> String {
    let Some(rest) = at.strip_prefix('/') else {
        return at.to_owned();
    };
    let segments: Vec<&str> = rest.split('/').collect();
    let kept: Vec<&str> = segments
        .iter()
        .take_while(|segment| plain_segment(segment) && !scan::identifier_hit(segment))
        .copied()
        .collect();
    let shown = if kept.len() == segments.len() {
        at.to_owned()
    } else {
        let mut parts = kept.clone();
        parts.push("…");
        format!("/{}", parts.join("/"))
    };
    if !scan::path_hit(&shown) {
        return shown;
    }
    match kept.first() {
        Some(first) if !scan::path_hit(first) => format!("/{first}/…"),
        _ => "/…".to_owned(),
    }
}

/// The listing placed: each library's files, and the problems of the pack itself.
#[derive(Debug, Default)]
struct Layout {
    libraries: BTreeMap<String, Files>,
    pack_problems: Vec<Problem>,
}

fn place(paths: Vec<String>) -> Layout {
    let mut layout = Layout::default();
    let mut paths = paths;
    paths.sort_by(|a, b| digest::utf16_cmp(a, b));
    for path in paths {
        if path == PACK_TOML {
            continue;
        }
        match locate(&path) {
            Some(Located::Rules(library)) => {
                let files = layout.libraries.entry(library).or_default();
                files.placed = true;
                files.rules = Some(path);
            }
            Some(Located::Catalog(library)) => {
                let files = layout.libraries.entry(library).or_default();
                files.placed = true;
                files.catalog = Some(path);
            }
            Some(Located::Record(library, tag)) => {
                let files = layout.libraries.entry(library).or_default();
                files.placed = true;
                files.records.push((path, tag));
            }
            Some(Located::Pattern(library, pattern)) => {
                let files = layout.libraries.entry(library).or_default();
                files.placed = true;
                files.patterns.push((path, pattern));
            }
            Some(Located::Copy(library, pattern, name)) => {
                let files = layout.libraries.entry(library).or_default();
                files.placed = true;
                files.copies.push((path, pattern, name));
            }
            None => {
                let problem = Problem::new(LAYOUT_INVALID, shown_path(&path), None);
                match library_of_unplaced(&path).map(str::to_owned) {
                    Some(library) => {
                        let files = layout.libraries.entry(library.clone()).or_default();
                        if path.starts_with(&format!("data/{library}/components/"))
                            || path.starts_with(&format!("data/{library}/patterns/"))
                        {
                            files.unplaced_data.push(path);
                        }
                        files.problems.push(problem);
                    }
                    None => layout.pack_problems.push(problem),
                }
            }
        }
    }
    if layout.libraries.len() > MAX_LIBRARIES {
        layout
            .pack_problems
            .push(Problem::new(LAYOUT_INVALID, "data", None));
    }
    // A library's own id, read as words, cannot then be shown (sections 3.2 and 9.1).
    let hit: Vec<String> = layout
        .libraries
        .keys()
        .filter(|id| scan::identifier_hit(id))
        .cloned()
        .collect();
    for id in hit {
        layout.libraries.remove(&id);
        for top in ["data/…", "rules/…"] {
            layout
                .pack_problems
                .push(Problem::new(IDENTIFIER_INVALID, top, None));
        }
    }
    layout.pack_problems.sort();
    layout.pack_problems.dedup();
    layout
}

fn peek_format(bytes: &[u8]) -> Option<u8> {
    let text = std::str::from_utf8(bytes).ok()?;
    let prepared = canonical::prepare(text);
    let raw: Value = serde_json::from_str(&prepared.text).ok()?;
    let fmt = raw.get("format")?.as_f64()?;
    if fmt == 1.0 {
        Some(1)
    } else if fmt == 2.0 {
        Some(2)
    } else {
        None
    }
}

/// Majority-wins library format detection, matching `foundations/specimen/src/pack.ts`.
fn detect_library_format(
    bytes: &HashMap<String, Vec<u8>>,
    paths: &[&str],
    rules_path: Option<&str>,
) -> u8 {
    let mut v1 = 0usize;
    let mut v2 = 0usize;
    for path in paths {
        if let Some(content) = bytes.get(*path) {
            match peek_format(content) {
                Some(1) => v1 += 1,
                Some(2) => v2 += 1,
                _ => {}
            }
        }
    }
    if v1 > v2 {
        return 1;
    }
    if v2 > v1 {
        return 2;
    }
    if let Some(rp) = rules_path
        && let Some(content) = bytes.get(rp)
        && let Some(v) = peek_format(content)
    {
        return v;
    }
    2
}

/// One file read and checked against its schema.
struct Parsed<T> {
    path: String,
    value: T,
}

/// The problems of one library.
struct Checker {
    problems: Vec<Problem>,
}

impl Checker {
    fn add(&mut self, code: &'static str, path: &str, at: Option<String>) {
        self.problems.push(Problem::new(code, path, at));
    }

    /// Reads one file against its schema; reports and returns nothing when it does not hold.
    fn parse<T: DeserializeOwned>(
        &mut self,
        path: &str,
        bytes: &[u8],
        expected_format: u8,
        check: impl FnOnce(&mut Shape, &Value),
    ) -> Option<Parsed<T>> {
        if bytes.len() > MAX_FILE_BYTES {
            self.add(FILE_TOO_LARGE, path, None);
            return None;
        }
        let Ok(text) = std::str::from_utf8(bytes) else {
            self.add(JSON_INVALID, path, None);
            return None;
        };
        let prepared = canonical::prepare(text);
        let Ok(raw) = serde_json::from_str::<Value>(&prepared.text) else {
            self.add(JSON_INVALID, path, None);
            return None;
        };
        let version = raw.get("format").and_then(Value::as_f64);
        if version != Some(f64::from(expected_format)) {
            self.add(FORMAT_UNSUPPORTED, path, Some("/format".to_owned()));
            return None;
        }
        let mut shape = Shape::new(prepared.marker);
        check(&mut shape, &raw);
        let issues = shape.finish();
        if !issues.is_empty() {
            for (code, at) in issues {
                self.add(code, path, at);
            }
            return None;
        }
        // The schema has refused every string with a lone surrogate, so `raw` is what the file says.
        if canonical::canonical_json(&raw) != text {
            self.add(NOT_CANONICAL, path, None);
        }
        match serde_json::from_value(raw) {
            Ok(value) => Some(Parsed {
                path: path.to_owned(),
                value,
            }),
            Err(_) => {
                self.add(SCHEMA_INVALID, path, None);
                None
            }
        }
    }

    /// Names in a list must rise strictly: a repeat is a duplicate, a fall is out of order.
    fn ascending(&mut self, path: &str, at: &str, names: &[&str]) {
        for (index, pair) in names.windows(2).enumerate() {
            let at = Some(format!("{at}/{}", index + 1));
            if pair[0] == pair[1] {
                self.add(DUPLICATE_ID, path, at);
            } else if pair[0] > pair[1] {
                self.add(NOT_CANONICAL, path, at);
            }
        }
    }

    /// Pairs of names in a list must rise strictly lexicographically.
    fn ascending_pairs(&mut self, path: &str, at: &str, pairs: &[(&str, &str)]) {
        for (index, window) in pairs.windows(2).enumerate() {
            let at = Some(format!("{at}/{}", index + 1));
            if window[0] == window[1] {
                self.add(DUPLICATE_ID, path, at);
            } else if window[0] > window[1] {
                self.add(NOT_CANONICAL, path, at);
            }
        }
    }

    /// Identifiers in a list whose order is author-defined must still be unique.
    fn unique_ids(&mut self, path: &str, at: &str, ids: &[&str]) {
        let mut seen = HashSet::new();
        for (index, id) in ids.iter().enumerate() {
            if !seen.insert(*id) {
                self.add(DUPLICATE_ID, path, Some(format!("{at}/{index}/id")));
            }
        }
    }

    /// `checkComponent`.
    fn component(&mut self, parsed: &Parsed<Record>, tag: &str, format: u8) {
        let path = parsed.path.as_str();
        let record = &parsed.value;
        if record.tag != tag {
            self.add(TAG_MISMATCH, path, Some("/tag".to_owned()));
        }
        let api = &record.api;
        let names: Vec<&str> = api.attributes.iter().map(|m| m.name.as_str()).collect();
        self.ascending(path, "/api/attributes", &names);
        let names: Vec<&str> = api.slots.iter().map(|m| m.name.as_str()).collect();
        self.ascending(path, "/api/slots", &names);
        let names: Vec<&str> = api.events.iter().map(|m| m.name.as_str()).collect();
        self.ascending(path, "/api/events", &names);
        let names: Vec<&str> = api.commands.iter().map(|m| m.name.as_str()).collect();
        self.ascending(path, "/api/commands", &names);
        let names: Vec<&str> = api.css_properties.iter().map(|m| m.name.as_str()).collect();
        self.ascending(path, "/api/cssProperties", &names);
        for (index, attribute) in api.attributes.iter().enumerate() {
            self.ascending(
                path,
                &format!("/api/attributes/{index}/rules"),
                &strs(attribute.rules.as_deref()),
            );
        }
        for (index, slot) in api.slots.iter().enumerate() {
            self.ascending(
                path,
                &format!("/api/slots/{index}/accepts"),
                &strs(slot.accepts.as_deref()),
            );
        }
        let names: Vec<&str> = record.a11y.role.iter().map(|r| r.state.as_str()).collect();
        self.ascending(path, "/a11y/role", &names);
        if let Some(axe) = &record.a11y.axe {
            self.ascending(path, "/a11y/axe/exceptions", &strs(Some(&axe.exceptions)));
        }
        self.ascending(path, "/rules", &strs(Some(&record.rules)));
        if let Some(themes) = &record.themes {
            self.ascending(path, "/themes/supported", &strs(Some(&themes.supported)));
        }
        if format >= 2 && !record.patterns.is_empty() {
            let pairs: Vec<(&str, &str)> = record
                .patterns
                .iter()
                .map(|p| (p.library.as_str(), p.pattern.as_str()))
                .collect();
            self.ascending_pairs(path, "/patterns", &pairs);
            for (index, entry) in record.patterns.iter().enumerate() {
                if let Some(contexts) = &entry.contexts
                    && let Some(themes) = &contexts.themes
                {
                    self.ascending(
                        path,
                        &format!("/patterns/{index}/contexts/themes"),
                        &strs(Some(themes)),
                    );
                }
                let keep_ids: Vec<&str> = entry.keep.iter().map(|k| k.id.as_str()).collect();
                self.unique_ids(path, &format!("/patterns/{index}/keep"), &keep_ids);
            }
        }
    }

    /// `checkPatternRecord`.
    fn pattern_record(&mut self, parsed: &Parsed<PatternRecord>, pattern: &str) {
        let path = parsed.path.as_str();
        let record = &parsed.value;
        if record.pattern != pattern {
            self.add(PATTERN_MISMATCH, path, Some("/pattern".to_owned()));
        }
        for (key, values) in &record.facets {
            self.ascending(path, &format!("/facets/{key}"), &strs(Some(values)));
        }
        let impl_pairs: Vec<(&str, &str)> = record
            .implementations
            .iter()
            .map(|item| (item.kind.as_str(), item.sort_name()))
            .collect();
        self.ascending_pairs(path, "/implementations", &impl_pairs);
        let waived_ids: Vec<&str> = record.waived_keep.iter().map(|w| w.id.as_str()).collect();
        self.unique_ids(path, "/waivedKeep", &waived_ids);
    }

    /// `checkCopyRecord`.
    fn copy_record(&mut self, parsed: &Parsed<CopyRecord>, pattern: &str, name: &str) {
        let path = parsed.path.as_str();
        let record = &parsed.value;
        if record.pattern != pattern {
            self.add(PATTERN_MISMATCH, path, Some("/pattern".to_owned()));
        }
        if record.name != name {
            self.add(COPY_MISMATCH, path, Some("/name".to_owned()));
        }
        self.ascending(path, "/dependencies", &strs(Some(&record.dependencies)));
        self.ascending(path, "/tokens", &strs(Some(&record.tokens)));
        if let Some(contexts) = &record.contexts
            && let Some(themes) = &contexts.themes
        {
            self.ascending(path, "/contexts/themes", &strs(Some(themes)));
        }
        let keep_ids: Vec<&str> = record.keep.iter().map(|k| k.id.as_str()).collect();
        self.unique_ids(path, "/keep", &keep_ids);
    }

    /// `checkLibrary`'s checks across the rules, components, patterns and copies.
    #[allow(clippy::too_many_arguments)]
    fn across(
        &mut self,
        library: &str,
        format: u8,
        tags: &HashSet<String>,
        pattern_ids: &HashSet<String>,
        copies_by_pattern: &HashMap<String, HashSet<String>>,
        components: &[Parsed<Record>],
        patterns: &[Parsed<PatternRecord>],
        copies: &[Parsed<CopyRecord>],
        rules: Option<&Parsed<Rules>>,
    ) {
        let rule_ids: Option<HashSet<&str>> =
            rules.map(|rules| rules.value.rules.iter().map(|r| r.id.as_str()).collect());
        let mut seen: HashMap<String, ()> = HashMap::new();
        let mut claim = |checker: &mut Self, id: &str, path: &str, at: String| {
            if seen.insert(id.to_owned(), ()).is_some() {
                checker.add(DUPLICATE_ID, path, Some(at));
            }
        };
        if let Some(rules) = rules {
            let path = rules.path.as_str();
            let value = &rules.value;
            if value.library != library {
                self.add(LIBRARY_MISMATCH, path, Some("/library".to_owned()));
            }
            let ids: Vec<&str> = value.rules.iter().map(|r| r.id.as_str()).collect();
            self.ascending(path, "/rules", &ids);
            for (index, rule) in value.rules.iter().enumerate() {
                claim(self, &rule.id, path, format!("/rules/{index}/id"));
                self.ascending(
                    path,
                    &format!("/rules/{index}/appliesTo/tags"),
                    &strs(rule.applies_to.tags.as_deref()),
                );
                self.ascending(
                    path,
                    &format!("/rules/{index}/appliesTo/attributes"),
                    &strs(rule.applies_to.attributes.as_deref()),
                );
                for (at, tag) in rule.applies_to.tags.iter().flatten().enumerate() {
                    if !tags.contains(tag) {
                        self.add(
                            TAG_UNKNOWN,
                            path,
                            Some(format!("/rules/{index}/appliesTo/tags/{at}")),
                        );
                    }
                }
            }
        }
        for component in components {
            let path = component.path.as_str();
            let record = &component.value;
            for (index, statement) in record.usage.iter().enumerate() {
                claim(self, &statement.id, path, format!("/usage/{index}/id"));
            }
            for (index, statement) in record.a11y.statements.iter().enumerate() {
                claim(
                    self,
                    &statement.id,
                    path,
                    format!("/a11y/statements/{index}/id"),
                );
            }
            if let Some(rule_ids) = &rule_ids {
                for (index, id) in record.rules.iter().enumerate() {
                    if !rule_ids.contains(id.as_str()) {
                        self.add(RULE_UNKNOWN, path, Some(format!("/rules/{index}")));
                    }
                }
                for (index, attribute) in record.api.attributes.iter().enumerate() {
                    for (at, id) in attribute.rules.iter().flatten().enumerate() {
                        if !rule_ids.contains(id.as_str()) {
                            self.add(
                                RULE_UNKNOWN,
                                path,
                                Some(format!("/api/attributes/{index}/rules/{at}")),
                            );
                        }
                    }
                }
            }
            if let Some(replacement) = &record.replaced_by
                && !tags.contains(replacement)
            {
                self.add(TAG_UNKNOWN, path, Some("/replacedBy".to_owned()));
            }
            if format >= 2 {
                for (index, entry) in record.patterns.iter().enumerate() {
                    if entry.library == library && !pattern_ids.contains(&entry.pattern) {
                        self.add(
                            PATTERN_UNKNOWN,
                            path,
                            Some(format!("/patterns/{index}/pattern")),
                        );
                    }
                }
            }
        }
        for pat in patterns {
            let path = pat.path.as_str();
            let record = &pat.value;
            for (index, st) in record.use_when.iter().enumerate() {
                claim(self, &st.id, path, format!("/useWhen/{index}/id"));
            }
            for (index, st) in record.avoid_when.iter().enumerate() {
                claim(self, &st.id, path, format!("/avoidWhen/{index}/id"));
            }
            for (index, st) in record.keep.iter().enumerate() {
                claim(self, &st.id, path, format!("/keep/{index}/id"));
            }
            for (index, st) in record.customize.iter().enumerate() {
                claim(self, &st.id, path, format!("/customize/{index}/id"));
            }
            for (index, item) in record.implementations.iter().enumerate() {
                if item.kind == "component" {
                    if let Some(tag) = &item.tag
                        && !tags.contains(tag)
                    {
                        self.add(
                            TAG_UNKNOWN,
                            path,
                            Some(format!("/implementations/{index}/tag")),
                        );
                    }
                } else if let Some(name) = &item.name
                    && !copies_by_pattern
                        .get(&record.pattern)
                        .is_some_and(|set| set.contains(name))
                {
                    self.add(
                        COPY_UNKNOWN,
                        path,
                        Some(format!("/implementations/{index}/name")),
                    );
                }
            }
            if let Some(replacement) = &record.replaced_by {
                if let Some((ref_lib, ref_pat)) = replacement.split_once('/') {
                    if ref_lib == library && !pattern_ids.contains(ref_pat) {
                        self.add(PATTERN_UNKNOWN, path, Some("/replacedBy".to_owned()));
                    }
                } else if !pattern_ids.contains(replacement) {
                    self.add(PATTERN_UNKNOWN, path, Some("/replacedBy".to_owned()));
                }
            }
        }
        for copy in copies {
            let path = copy.path.as_str();
            let record = &copy.value;
            let parent_pattern = match locate(path) {
                Some(Located::Copy(_, p, _)) => p,
                _ => record.pattern.clone(),
            };
            if !pattern_ids.contains(&parent_pattern) {
                self.add(PATTERN_UNKNOWN, path, Some("/pattern".to_owned()));
            }
            if let Some(replacement) = &record.replaced_by
                && !copies_by_pattern
                    .get(&parent_pattern)
                    .is_some_and(|set| set.contains(replacement))
            {
                self.add(COPY_UNKNOWN, path, Some("/replacedBy".to_owned()));
            }
        }
    }

    /// `checkCatalog`.
    #[allow(clippy::too_many_arguments)]
    fn catalog(
        &mut self,
        library: &str,
        format: u8,
        parsed: &Parsed<Catalog>,
        bytes: &HashMap<String, Vec<u8>>,
        components: &[Parsed<Record>],
        patterns: &[Parsed<PatternRecord>],
        copies: &[Parsed<CopyRecord>],
        tags: &HashSet<String>,
        pattern_ids: &HashSet<String>,
        copies_by_pattern: &HashMap<String, HashSet<String>>,
        rules_path: &str,
    ) {
        let path = parsed.path.as_str();
        let catalog = &parsed.value;
        if catalog.library != library {
            self.add(LIBRARY_MISMATCH, path, Some("/library".to_owned()));
        }
        let names: Vec<&str> = catalog.components.iter().map(|e| e.tag.as_str()).collect();
        self.ascending(path, "/components", &names);
        let records: HashMap<&str, &Record> = components
            .iter()
            .map(|record| (record.value.tag.as_str(), &record.value))
            .collect();
        for (index, entry) in catalog.components.iter().enumerate() {
            let at = format!("/components/{index}");
            if !entry.tag.starts_with(&catalog.prefix) {
                self.add(PREFIX_MISMATCH, path, Some(format!("{at}/tag")));
            }
            let file = format!("data/{library}/components/{}.json", entry.tag);
            let Some(content) = bytes.get(&file) else {
                self.add(CATALOG_MISMATCH, path, Some(format!("{at}/tag")));
                continue;
            };
            if digest::file_digest(content) != entry.digest {
                self.add(DIGEST_MISMATCH, path, Some(format!("{at}/digest")));
            }
            if let Some(record) = records.get(entry.tag.as_str())
                && (record.summary != entry.summary || record.status != entry.status)
            {
                self.add(CATALOG_MISMATCH, path, Some(at));
            }
        }
        let listed: HashSet<&str> = catalog.components.iter().map(|e| e.tag.as_str()).collect();
        for tag in tags {
            if !listed.contains(tag.as_str()) {
                self.add(CATALOG_MISMATCH, path, Some("/components".to_owned()));
            }
        }
        if format >= 2 {
            let pat_names: Vec<&str> = catalog
                .patterns
                .iter()
                .map(|e| e.pattern.as_str())
                .collect();
            self.ascending(path, "/patterns", &pat_names);
            let pat_records: HashMap<&str, &PatternRecord> = patterns
                .iter()
                .map(|record| (record.value.pattern.as_str(), &record.value))
                .collect();
            for (index, entry) in catalog.patterns.iter().enumerate() {
                let at = format!("/patterns/{index}");
                for (key, values) in &entry.facets {
                    self.ascending(path, &format!("{at}/facets/{key}"), &strs(Some(values)));
                }
                let file = format!("data/{library}/patterns/{}.json", entry.pattern);
                let Some(content) = bytes.get(&file) else {
                    self.add(CATALOG_MISMATCH, path, Some(format!("{at}/pattern")));
                    continue;
                };
                if digest::file_digest(content) != entry.digest {
                    self.add(DIGEST_MISMATCH, path, Some(format!("{at}/digest")));
                }
                if let Some(record) = pat_records.get(entry.pattern.as_str())
                    && (record.summary != entry.summary
                        || record.status != entry.status
                        || record.approval_status != entry.approval_status
                        || record.replaced_by != entry.replaced_by
                        || record.scope != entry.scope
                        || record.facets != entry.facets)
                {
                    self.add(CATALOG_MISMATCH, path, Some(at));
                }
            }
            let listed_patterns: HashSet<&str> = catalog
                .patterns
                .iter()
                .map(|e| e.pattern.as_str())
                .collect();
            for pat in pattern_ids {
                if !listed_patterns.contains(pat.as_str()) {
                    self.add(CATALOG_MISMATCH, path, Some("/patterns".to_owned()));
                }
            }

            let copy_pairs: Vec<(&str, &str)> = catalog
                .copies
                .iter()
                .map(|e| (e.pattern.as_str(), e.name.as_str()))
                .collect();
            self.ascending_pairs(path, "/copies", &copy_pairs);
            let copy_records: HashMap<(&str, &str), &CopyRecord> = copies
                .iter()
                .map(|record| {
                    (
                        (record.value.pattern.as_str(), record.value.name.as_str()),
                        &record.value,
                    )
                })
                .collect();
            for (index, entry) in catalog.copies.iter().enumerate() {
                let at = format!("/copies/{index}");
                let file = format!(
                    "data/{library}/patterns/{}/{}.json",
                    entry.pattern, entry.name
                );
                let Some(content) = bytes.get(&file) else {
                    self.add(CATALOG_MISMATCH, path, Some(format!("{at}/name")));
                    continue;
                };
                if digest::file_digest(content) != entry.digest {
                    self.add(DIGEST_MISMATCH, path, Some(format!("{at}/digest")));
                }
                if let Some(record) =
                    copy_records.get(&(entry.pattern.as_str(), entry.name.as_str()))
                    && (record.status != entry.status
                        || record.approval_status != entry.approval_status
                        || record.replaced_by != entry.replaced_by
                        || record.revision != entry.revision
                        || record.fingerprint != entry.fingerprint)
                {
                    self.add(CATALOG_MISMATCH, path, Some(at));
                }
            }
            let listed_copies: HashSet<(&str, &str)> = catalog
                .copies
                .iter()
                .map(|e| (e.pattern.as_str(), e.name.as_str()))
                .collect();
            for (pat, names) in copies_by_pattern {
                for name in names {
                    if !listed_copies.contains(&(pat.as_str(), name.as_str())) {
                        self.add(CATALOG_MISMATCH, path, Some("/copies".to_owned()));
                    }
                }
            }
        }
        if let Some(content) = bytes.get(rules_path)
            && digest::file_digest(content) != catalog.rules
        {
            self.add(DIGEST_MISMATCH, path, Some("/rules".to_owned()));
        }
        let comp_prefix = format!("data/{library}/components/");
        let pat_prefix = format!("data/{library}/patterns/");
        let digested = bytes
            .iter()
            .filter(|(file, _)| {
                *file == rules_path
                    || file.starts_with(&comp_prefix)
                    || file.starts_with(&pat_prefix)
            })
            .map(|(file, content)| (file.as_str(), content.as_slice()));
        if digest::pack_digest(digested) != catalog.digest {
            self.add(DIGEST_MISMATCH, path, Some("/digest".to_owned()));
        }
    }

    /// Identifiers are checked against words too (section 3.2): a hit is `IDENTIFIER_INVALID`.
    fn scan_identifiers(&mut self, path: &str, identifiers: Vec<(String, &str)>) {
        for (at, value) in identifiers {
            if scan::identifier_hit(value) {
                self.add(IDENTIFIER_INVALID, path, Some(at));
            }
        }
    }
}

fn strs(items: Option<&[String]>) -> Vec<&str> {
    items
        .unwrap_or_default()
        .iter()
        .map(String::as_str)
        .collect()
}

/// Reads every file of a library and checks it. `Err` is the library's problems.
fn check_library(
    cx: &Cx,
    library: &str,
    files: &Files,
    touched: &[String],
) -> Result<Result<Library, Vec<Problem>>, Outcome> {
    let mut bytes: HashMap<String, Vec<u8>> = HashMap::new();
    let mut read = |path: &str| -> Result<(), Outcome> {
        let content = cx
            .pack_read(PACK, path)
            .map_err(|error| read_failure(&error, Some(library), touched))?;
        bytes.insert(path.to_owned(), content);
        Ok(())
    };
    if let Some(path) = &files.catalog {
        read(path)?;
    }
    if let Some(path) = &files.rules {
        read(path)?;
    }
    for (path, _) in &files.records {
        read(path)?;
    }
    for (path, _) in &files.patterns {
        read(path)?;
    }
    for (path, _, _) in &files.copies {
        read(path)?;
    }
    for path in &files.unplaced_data {
        read(path)?;
    }

    let mut checker = Checker {
        problems: files.problems.clone(),
    };
    if !files.placed {
        return Ok(Err(checker.problems));
    }
    let mut all_paths: Vec<&str> = Vec::new();
    if let Some(path) = &files.rules {
        all_paths.push(path);
    }
    if let Some(path) = &files.catalog {
        all_paths.push(path);
    }
    for (path, _) in &files.records {
        all_paths.push(path);
    }
    for (path, _) in &files.patterns {
        all_paths.push(path);
    }
    for (path, _, _) in &files.copies {
        all_paths.push(path);
    }
    let version = detect_library_format(&bytes, &all_paths, files.rules.as_deref());

    let rules_path = format!("rules/{library}.json");
    if files.rules.is_none() {
        checker.add(LAYOUT_INVALID, &rules_path, None);
    }
    let rules: Option<Parsed<Rules>> = files.rules.as_ref().and_then(|path| {
        checker.parse(path, bytes_of(&bytes, path), version, |shape, raw| {
            shape.rules(raw)
        })
    });
    let mut components: Vec<Parsed<Record>> = Vec::new();
    for (path, tag) in &files.records {
        if let Some(parsed) = checker.parse(path, bytes_of(&bytes, path), version, |shape, raw| {
            shape.component(raw, version);
        }) {
            checker.component(&parsed, tag, version);
            components.push(parsed);
        }
    }
    let mut patterns: Vec<Parsed<PatternRecord>> = Vec::new();
    for (path, pattern) in &files.patterns {
        if version == 1 {
            checker.add(FORMAT_UNSUPPORTED, path, Some("/format".to_owned()));
            continue;
        }
        if let Some(parsed) = checker.parse(path, bytes_of(&bytes, path), 2, |shape, raw| {
            shape.pattern(raw);
        }) {
            checker.pattern_record(&parsed, pattern);
            patterns.push(parsed);
        }
    }
    let mut copies: Vec<Parsed<CopyRecord>> = Vec::new();
    for (path, pattern, name) in &files.copies {
        if version == 1 {
            checker.add(FORMAT_UNSUPPORTED, path, Some("/format".to_owned()));
            continue;
        }
        if let Some(parsed) = checker.parse(path, bytes_of(&bytes, path), 2, |shape, raw| {
            shape.copy(raw);
        }) {
            checker.copy_record(&parsed, pattern, name);
            copies.push(parsed);
        }
    }
    let tags: HashSet<String> = files.records.iter().map(|(_, tag)| tag.clone()).collect();
    let pattern_ids: HashSet<String> = files.patterns.iter().map(|(_, pat)| pat.clone()).collect();
    let mut copies_by_pattern: HashMap<String, HashSet<String>> = HashMap::new();
    for (_, pat, name) in &files.copies {
        copies_by_pattern
            .entry(pat.clone())
            .or_default()
            .insert(name.clone());
    }
    checker.across(
        library,
        version,
        &tags,
        &pattern_ids,
        &copies_by_pattern,
        &components,
        &patterns,
        &copies,
        rules.as_ref(),
    );
    let catalog_path = format!("data/{library}/library.json");
    let catalog: Option<Parsed<Catalog>> = match &files.catalog {
        Some(path) => checker
            .parse(path, bytes_of(&bytes, path), version, |shape, raw| {
                shape.library(raw, version)
            })
            .inspect(|parsed| {
                checker.catalog(
                    library,
                    version,
                    parsed,
                    &bytes,
                    &components,
                    &patterns,
                    &copies,
                    &tags,
                    &pattern_ids,
                    &copies_by_pattern,
                    &rules_path,
                );
            }),
        None => {
            checker.add(LAYOUT_INVALID, &catalog_path, None);
            None
        }
    };
    if let Some(rules) = &rules {
        checker.scan_identifiers(&rules.path, rules_identifiers(&rules.value));
    }
    for component in &components {
        checker.scan_identifiers(&component.path, record_identifiers(&component.value));
    }
    for pat in &patterns {
        checker.scan_identifiers(&pat.path, pattern_identifiers(&pat.value));
    }
    for copy in &copies {
        checker.scan_identifiers(&copy.path, copy_identifiers(&copy.value));
    }
    if let Some(catalog) = &catalog {
        checker.scan_identifiers(&catalog.path, catalog_identifiers(&catalog.value));
    }

    if !checker.problems.is_empty() {
        return Ok(Err(checker.problems));
    }
    let (Some(rules), Some(catalog)) = (rules, catalog) else {
        // Unreachable with no problems: a missing or failed file is one.
        checker.add(LAYOUT_INVALID, &catalog_path, None);
        return Ok(Err(checker.problems));
    };
    let mut records: Vec<Record> = components.into_iter().map(|parsed| parsed.value).collect();
    records.sort_by(|a, b| a.tag.cmp(&b.tag));
    let mut pattern_records: Vec<PatternRecord> =
        patterns.into_iter().map(|parsed| parsed.value).collect();
    pattern_records.sort_by(|a, b| a.pattern.cmp(&b.pattern));
    let mut copy_records: Vec<CopyRecord> = copies.into_iter().map(|parsed| parsed.value).collect();
    copy_records.sort_by(|a, b| {
        (a.pattern.as_str(), a.name.as_str()).cmp(&(b.pattern.as_str(), b.name.as_str()))
    });
    Ok(Ok(Library {
        id: library.to_owned(),
        format: version,
        catalog: catalog.value,
        rules: rules.value,
        records,
        patterns: pattern_records,
        copies: copy_records,
    }))
}

fn bytes_of<'a>(bytes: &'a HashMap<String, Vec<u8>>, path: &str) -> &'a [u8] {
    bytes.get(path).map_or(&[], Vec::as_slice)
}

fn read_failure(error: &HostError, library: Option<&str>, touched: &[String]) -> Outcome {
    match error {
        HostError::TooLarge(_) => fail::pack_too_large(touched),
        HostError::NotGranted(_) => fail::not_granted(),
        _ => fail::pack_unreadable(library),
    }
}

/// Every library a call touches, whole and checked (section 3.1). A library with a problem refuses
/// the call, and every touched library is checked first, so the refusal says which were fine.
pub(crate) fn read(cx: &Cx, library: Option<&str>) -> Result<Vec<Library>, Outcome> {
    let paths = cx
        .pack_list(PACK)
        .map_err(|error| read_failure(&error, None, &[]))?;
    let mut layout = place(paths);
    if !layout.pack_problems.is_empty() {
        return Err(fail::pack_refused(&layout.pack_problems));
    }
    if layout.libraries.is_empty() {
        return Err(fail::pack_empty());
    }
    let names: Vec<String> = layout.libraries.keys().cloned().collect();
    let touched: Vec<String> = match library {
        Some(id) if layout.libraries.contains_key(id) => vec![id.to_owned()],
        Some(id) => return Err(fail::library_not_found(id, &names)),
        None => names,
    };

    let mut served = Vec::new();
    let mut refused: Vec<(String, Vec<Problem>)> = Vec::new();
    for id in &touched {
        let Some(files) = layout.libraries.remove(id) else {
            continue;
        };
        match check_library(cx, id, &files, &touched)? {
            Ok(checked) => served.push(checked),
            Err(mut problems) => {
                // A path or pointer holding free text or an identifier the scan hit is cut.
                for problem in &mut problems {
                    problem.path = shown_path(&problem.path);
                    problem.at = problem.at.take().map(|at| shown_pointer(&at));
                }
                problems.sort();
                refused.push((id.clone(), problems));
            }
        }
    }
    if refused.is_empty() {
        return Ok(served);
    }
    let servable: Vec<String> = served.iter().map(|lib| lib.id.clone()).collect();
    Err(fail::library_refused(
        &refused,
        &servable,
        library.is_some(),
    ))
}

#[cfg(test)]
mod tests {
    use super::Library;
    use super::aggregate::aggregate_implementations;
    use super::schema::{A11y, Api, Catalog, Package, Record, Rules};
    use super::schema_pattern::{
        ComponentPattern, CopyOrigin, CopyRecord, KeepBasis, PatternRecord,
    };
    use std::collections::BTreeMap;

    fn empty_library(id: &str) -> Library {
        Library {
            id: id.to_owned(),
            format: 2,
            catalog: Catalog {
                library: id.to_owned(),
                title: id.to_owned(),
                package: Package {
                    name: format!("{id}-ui"),
                    version: "1.0.0".to_owned(),
                },
                prefix: format!("{id}-"),
                revision: None,
                digest: format!("sha256:{}", "0".repeat(64)),
                rules: format!("sha256:{}", "0".repeat(64)),
                components: vec![],
                patterns: vec![],
                copies: vec![],
                pattern_bindings: BTreeMap::new(),
            },
            rules: Rules {
                library: id.to_owned(),
                rules: vec![],
            },
            records: vec![],
            patterns: vec![],
            copies: vec![],
        }
    }

    fn record_with_claim(tag: &str, lib: &str, pat: &str) -> Record {
        Record {
            tag: tag.to_owned(),
            summary: None,
            status: "stable".to_owned(),
            replaced_by: None,
            import: None,
            api: Api {
                attributes: vec![],
                slots: vec![],
                events: vec![],
                commands: vec![],
                css_properties: vec![],
                form: None,
            },
            a11y: A11y {
                role: vec![],
                statements: vec![],
                axe: None,
            },
            usage: vec![],
            rules: vec![],
            examples: vec![],
            detail: None,
            gaps: vec![],
            themes: None,
            patterns: vec![ComponentPattern {
                library: lib.to_owned(),
                pattern: pat.to_owned(),
                contexts: None,
                keep: vec![KeepBasis {
                    id: "pattern.select.named".to_owned(),
                    basis: "verified".to_owned(),
                    reason: None,
                }],
            }],
        }
    }

    #[test]
    fn cross_library_aggregation_orders_owning_library_first() {
        let mut example = empty_library("example");
        example.patterns.push(PatternRecord {
            pattern: "select".to_owned(),
            summary: Some("Select".to_owned()),
            status: "stable".to_owned(),
            approval_status: None,
            derived_from: None,
            waived_keep: vec![],
            replaced_by: None,
            scope: "control".to_owned(),
            facets: BTreeMap::new(),
            use_when: vec![],
            avoid_when: vec![],
            keep: vec![],
            customize: vec![],
            setups: BTreeMap::new(),
            gates: BTreeMap::new(),
            implementations: vec![],
        });
        example
            .records
            .push(record_with_claim("example-select", "example", "select"));
        example.copies.push(CopyRecord {
            pattern: "select".to_owned(),
            name: "inline-copy".to_owned(),
            status: "stable".to_owned(),
            approval_status: None,
            replaced_by: None,
            html: "<div></div>".to_owned(),
            css: String::new(),
            dependencies: vec![],
            tokens: vec![],
            theme_stylesheet: None,
            setup: None,
            contexts: None,
            revision: format!("sha256:{}", "1".repeat(64)),
            fingerprint: format!("sha256:{}", "2".repeat(64)),
            change_note: None,
            origin: CopyOrigin {
                id: "select--default".to_owned(),
                checkpoint: None,
            },
            keep: vec![],
        });

        let mut desktop = empty_library("desktop");
        desktop
            .records
            .push(record_with_claim("desk-select", "example", "select"));

        // Pass `desktop` before `example` to verify sort puts owning library (`example`) first
        // even though "desktop" < "example" alphabetically!
        let index = aggregate_implementations(&[desktop, example]);
        let impls = &index[&("example".to_owned(), "select".to_owned())];
        let summary: Vec<(&str, &str, &str)> = impls
            .iter()
            .map(|i| (i.library.as_str(), i.kind, i.item_name()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("example", "component", "example-select"),
                ("example", "copy", "inline-copy"),
                ("desktop", "component", "desk-select"),
            ]
        );
        assert_eq!(impls[0].status, "stable");
        assert_eq!(impls[0].replaced_by, None);
    }

    #[test]
    fn cross_library_aggregation_handles_zero_impl_and_unloaded_owner_patterns() {
        let mut example = empty_library("example");
        example.patterns.push(PatternRecord {
            pattern: "empty-pat".to_owned(),
            summary: Some("No implementations yet.".to_owned()),
            status: "preview".to_owned(),
            approval_status: None,
            derived_from: None,
            waived_keep: vec![],
            replaced_by: None,
            scope: "composition".to_owned(),
            facets: BTreeMap::new(),
            use_when: vec![],
            avoid_when: vec![],
            keep: vec![],
            customize: vec![],
            setups: BTreeMap::new(),
            gates: BTreeMap::new(),
            implementations: vec![],
        });
        let mut foreign = empty_library("foreign");
        let mut deprecated = record_with_claim("foreign-dialog", "unloaded", "dialog.modal");
        deprecated.status = "deprecated".to_owned();
        deprecated.replaced_by = Some("foreign-sheet".to_owned());
        foreign.records.push(deprecated);

        let index = aggregate_implementations(&[example, foreign]);
        assert_eq!(
            index[&("example".to_owned(), "empty-pat".to_owned())],
            vec![]
        );
        let foreign_only = &index[&("unloaded".to_owned(), "dialog.modal".to_owned())];
        assert_eq!(foreign_only.len(), 1);
        assert_eq!(foreign_only[0].library, "foreign");
        assert_eq!(foreign_only[0].status, "deprecated");
        assert_eq!(
            foreign_only[0].replaced_by.as_deref(),
            Some("foreign-sheet")
        );
    }
}
