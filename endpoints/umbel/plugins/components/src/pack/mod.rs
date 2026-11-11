//! Reading a library: the listing, the files, the check, the typed library (specification,
//! section 3).
//!
//! This is a second implementation of Specimen's `checkPack` in the exported form. Specimen's code,
//! `foundations/specimen/src/pack.ts`, is normative for each problem's code and pointer, and
//! `tests/fixtures_invalid.rs` holds the two readers equal on Specimen's invalid fixtures. A
//! library with a problem is never served in part (D152).

pub(crate) mod canonical;
pub(crate) mod digest;
pub(crate) mod patterns;
pub(crate) mod problem;
pub(crate) mod schema;
pub(crate) mod text;

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::de::DeserializeOwned;
use serde_json::Value;
use umbel_sdk::{Cx, HostError, Outcome};

use crate::fail;
use crate::scan;

use problem::{
    CATALOG_MISMATCH, DIGEST_MISMATCH, DUPLICATE_ID, FILE_TOO_LARGE, FORMAT_UNSUPPORTED,
    IDENTIFIER_INVALID, JSON_INVALID, LAYOUT_INVALID, LIBRARY_MISMATCH, NOT_CANONICAL,
    PREFIX_MISMATCH, Problem, RULE_UNKNOWN, SCHEMA_INVALID, TAG_MISMATCH, TAG_UNKNOWN,
};
use schema::{Catalog, Record, Rules, Shape};

/// The plugin's one pack.
const PACK: &str = "library";
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
    pub(crate) catalog: Catalog,
    pub(crate) rules: Rules,
    /// In tag order.
    pub(crate) records: Vec<Record>,
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
    /// Paths under `components/` the layout does not place; they still count in the pack digest.
    unplaced_components: Vec<String>,
    /// Layout problems.
    problems: Vec<Problem>,
}

/// What a path is, by the format's layout.
enum Located {
    Rules(String),
    Catalog(String),
    Record(String, String),
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
    let tag = rest.strip_prefix("components/")?.strip_suffix(".json")?;
    (!tag.contains('/') && patterns::TAG.accepts(tag))
        .then(|| Located::Record(library.to_owned(), tag.to_owned()))
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
            None => {
                let problem = Problem::new(LAYOUT_INVALID, shown_path(&path), None);
                match library_of_unplaced(&path).map(str::to_owned) {
                    Some(library) => {
                        let files = layout.libraries.entry(library.clone()).or_default();
                        if path.starts_with(&format!("data/{library}/components/")) {
                            files.unplaced_components.push(path);
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
        if version != Some(0.0) {
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

    /// `checkComponent`.
    fn component(&mut self, parsed: &Parsed<Record>, tag: &str) {
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
    }

    /// `checkLibrary`'s checks across the rules and the records.
    fn across(
        &mut self,
        library: &str,
        tags: &HashSet<String>,
        components: &[Parsed<Record>],
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
        }
    }

    /// `checkCatalog`.
    fn catalog(
        &mut self,
        library: &str,
        parsed: &Parsed<Catalog>,
        bytes: &HashMap<String, Vec<u8>>,
        components: &[Parsed<Record>],
        tags: &HashSet<String>,
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
        if let Some(content) = bytes.get(rules_path)
            && digest::file_digest(content) != catalog.rules
        {
            self.add(DIGEST_MISMATCH, path, Some("/rules".to_owned()));
        }
        let prefix = format!("data/{library}/components/");
        let digested = bytes
            .iter()
            .filter(|(file, _)| *file == rules_path || file.starts_with(&prefix))
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

/// A record's identifiers and where they are.
fn record_identifiers(record: &Record) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![("/tag".to_owned(), record.tag.as_str())];
    if let Some(value) = &record.replaced_by {
        out.push(("/replacedBy".to_owned(), value));
    }
    if let Some(value) = &record.import {
        out.push(("/import".to_owned(), value));
    }
    for (index, attribute) in record.api.attributes.iter().enumerate() {
        out.push((format!("/api/attributes/{index}/name"), &attribute.name));
        if let Some(property) = &attribute.property {
            out.push((format!("/api/attributes/{index}/property"), property));
        }
        for (at, id) in attribute.rules.iter().flatten().enumerate() {
            out.push((format!("/api/attributes/{index}/rules/{at}"), id));
        }
    }
    for (index, slot) in record.api.slots.iter().enumerate() {
        out.push((format!("/api/slots/{index}/name"), &slot.name));
        for (at, element) in slot.accepts.iter().flatten().enumerate() {
            out.push((format!("/api/slots/{index}/accepts/{at}"), element));
        }
    }
    for (index, event) in record.api.events.iter().enumerate() {
        out.push((format!("/api/events/{index}/name"), &event.name));
    }
    for (index, command) in record.api.commands.iter().enumerate() {
        out.push((format!("/api/commands/{index}/name"), &command.name));
    }
    for (index, property) in record.api.css_properties.iter().enumerate() {
        out.push((format!("/api/cssProperties/{index}/name"), &property.name));
    }
    for (index, role) in record.a11y.role.iter().enumerate() {
        out.push((format!("/a11y/role/{index}/state"), &role.state));
        out.push((format!("/a11y/role/{index}/role"), &role.role));
    }
    for (index, statement) in record.a11y.statements.iter().enumerate() {
        out.push((format!("/a11y/statements/{index}/id"), &statement.id));
    }
    if let Some(axe) = &record.a11y.axe {
        for (index, rule) in axe.exceptions.iter().enumerate() {
            out.push((format!("/a11y/axe/exceptions/{index}"), rule));
        }
    }
    for (index, statement) in record.usage.iter().enumerate() {
        out.push((format!("/usage/{index}/id"), &statement.id));
    }
    for (index, id) in record.rules.iter().enumerate() {
        out.push((format!("/rules/{index}"), id));
    }
    for (index, example) in record.examples.iter().enumerate() {
        out.push((format!("/examples/{index}/from"), &example.from));
    }
    for (index, gap) in record.gaps.iter().enumerate() {
        if let Some(name) = gap.get("name").and_then(Value::as_str) {
            out.push((format!("/gaps/{index}/name"), name));
        }
    }
    out
}

fn rules_identifiers(rules: &Rules) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![("/library".to_owned(), rules.library.as_str())];
    for (index, rule) in rules.rules.iter().enumerate() {
        out.push((format!("/rules/{index}/id"), &rule.id));
        for (at, tag) in rule.applies_to.tags.iter().flatten().enumerate() {
            out.push((format!("/rules/{index}/appliesTo/tags/{at}"), tag));
        }
        for (at, attribute) in rule.applies_to.attributes.iter().flatten().enumerate() {
            out.push((
                format!("/rules/{index}/appliesTo/attributes/{at}"),
                attribute,
            ));
        }
    }
    out
}

fn catalog_identifiers(catalog: &Catalog) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![
        ("/library".to_owned(), catalog.library.as_str()),
        ("/package/name".to_owned(), catalog.package.name.as_str()),
        (
            "/package/version".to_owned(),
            catalog.package.version.as_str(),
        ),
        ("/prefix".to_owned(), catalog.prefix.as_str()),
        ("/digest".to_owned(), catalog.digest.as_str()),
        ("/rules".to_owned(), catalog.rules.as_str()),
    ];
    if let Some(revision) = &catalog.revision {
        out.push(("/revision".to_owned(), revision));
    }
    for (index, entry) in catalog.components.iter().enumerate() {
        out.push((format!("/components/{index}/tag"), &entry.tag));
        out.push((format!("/components/{index}/digest"), &entry.digest));
    }
    out
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
    for path in &files.unplaced_components {
        read(path)?;
    }

    let mut checker = Checker {
        problems: files.problems.clone(),
    };
    if !files.placed {
        return Ok(Err(checker.problems));
    }
    let rules_path = format!("rules/{library}.json");
    if files.rules.is_none() {
        checker.add(LAYOUT_INVALID, &rules_path, None);
    }
    let rules: Option<Parsed<Rules>> = files.rules.as_ref().and_then(|path| {
        checker.parse(path, bytes_of(&bytes, path), |shape, raw| shape.rules(raw))
    });
    let mut components: Vec<Parsed<Record>> = Vec::new();
    for (path, tag) in &files.records {
        if let Some(parsed) = checker.parse(path, bytes_of(&bytes, path), |shape, raw| {
            shape.component(raw);
        }) {
            checker.component(&parsed, tag);
            components.push(parsed);
        }
    }
    let tags: HashSet<String> = files.records.iter().map(|(_, tag)| tag.clone()).collect();
    checker.across(library, &tags, &components, rules.as_ref());
    let catalog_path = format!("data/{library}/library.json");
    let catalog: Option<Parsed<Catalog>> = match &files.catalog {
        Some(path) => checker
            .parse(path, bytes_of(&bytes, path), |shape, raw| {
                shape.library(raw)
            })
            .inspect(|parsed| {
                checker.catalog(library, parsed, &bytes, &components, &tags, &rules_path);
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
    Ok(Ok(Library {
        id: library.to_owned(),
        catalog: catalog.value,
        rules: rules.value,
        records,
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
                // A path holding an identifier the scan hit is cut as an unplaced path is.
                for problem in &mut problems {
                    problem.path = shown_path(&problem.path);
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
