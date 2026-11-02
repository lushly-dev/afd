//! `sources-sync` (specification sections 5.2 and 5.5).

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde_json::{Value, json};
use umbel_okf::frontmatter::{Declared, Problem};
use umbel_okf::{Ingest, Kind, analyze, document_id};
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{AccessSet, ContentHash, Expect, Flag, Origin, Sensitivity};

use crate::access::{self, Directories, INVALID_KEY, Inherit};
use crate::collection::{self, Collection, MAX_FILES};
use crate::document::{self, Schema};
use crate::fail;
use crate::report::{Changes, Flagged, Skips, is_person_at_cli, readable};
use crate::state::{Entry, State};

/// The most file bytes one call reads: the `content` grant's per-call cap.
pub(crate) const MAX_RUN_BYTES: u64 = 64 * 1024 * 1024;
/// The default for `limit`.
const DEFAULT_LIMIT: usize = 5000;

/// What one call has left to spend, across its collections.
pub(crate) struct Budget {
    pub(crate) bytes: u64,
    pub(crate) files: usize,
}

/// Everything one collection's sync reports.
#[derive(Default)]
pub(crate) struct Report {
    pub(crate) added: usize,
    pub(crate) updated: usize,
    pub(crate) deleted: usize,
    pub(crate) unchanged: usize,
    pub(crate) skips: Skips,
    pub(crate) changes: Changes,
    pub(crate) new_paths: Vec<String>,
    pub(crate) flagged: Flagged,
    pub(crate) revs: Vec<u64>,
    pub(crate) remaining: bool,
    pub(crate) stopped_after: Option<String>,
    pub(crate) limited: bool,
}

/// Parse the schema pack and load it.
pub(crate) fn schema(cx: &Cx) -> Result<Schema, Outcome> {
    let bytes = cx
        .pack_read("frontmatter", "data/schema.json")
        .map_err(|error| fail::host(&error))?;
    Schema::compile(bytes).map_err(|message| {
        failure(
            "SOURCES_PACK_INVALID",
            &format!("the frontmatter pack does not load: {message}"),
            "Fix data/schema.json in spaces/<space>/packs/sources-filesystem/frontmatter/, or remove the override to use the default.",
        )
    })
}

/// The collections to work on: all of the space's, or the one named.
pub(crate) fn collections(
    cx: &Cx,
    space: &str,
    wanted: Option<&str>,
) -> Result<Vec<Collection>, Outcome> {
    let declared = cx
        .content_collections(space)
        .map_err(|error| fail::host(&error))?;
    let mut chosen = Vec::new();
    for info in declared {
        if wanted.is_some_and(|name| name != info.id) {
            continue;
        }
        chosen.push(Collection::new(info).map_err(|message| {
            failure(
                "SOURCE_INVALID",
                &format!("a collection's settings do not load: {message}"),
                "Fix the collection's include, exclude or sensitivity in umbel.toml.",
            )
        })?);
    }
    if let Some(name) = wanted
        && chosen.is_empty()
    {
        return Err(failure(
            "COLLECTION_NOT_FOUND",
            &format!("the space `{space}` declares no collection `{name}`"),
            "Declare the collection under [spaces.<id>.collections] in umbel.toml, or call without `collection` to sync all of them.",
        ));
    }
    Ok(chosen)
}

/// A file of a collection that is a candidate for a document.
pub(crate) struct Candidate {
    pub(crate) path: String,
    pub(crate) id: String,
    pub(crate) size: u64,
    pub(crate) mtime_ms: i64,
}

/// The files of a collection the patterns select, in path order, each with its document id.
/// Files whose path cannot be a document are counted as skipped.
pub(crate) fn candidates(
    entries: &[umbel_sdk::ContentEntry],
    collection: &Collection,
    skips: &mut Skips,
) -> (Vec<Candidate>, usize) {
    let mut found = Vec::new();
    let mut selected = 0usize;
    let mut ids = HashSet::new();
    for entry in entries {
        let name = entry.path.rsplit('/').next().unwrap_or(&entry.path);
        if name == access::FILE_NAME || !collection.selects(&entry.path) {
            continue;
        }
        selected += 1;
        match document_id(&collection.info.id, &entry.path, collection.kind) {
            Ok(id) if ids.insert(id.clone()) => found.push(Candidate {
                path: entry.path.clone(),
                id,
                size: entry.size,
                mtime_ms: entry.mtime_ms,
            }),
            // Two files that would be one document (`a.md` and `a`): the first keeps the id.
            Ok(_) | Err(_) => skips.add("SOURCE_PATH_INVALID", &entry.path),
        }
    }
    (found, selected)
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return failure(
            "SPACE_NOT_FOUND",
            "the call resolved no space",
            "Pass `space`, or set default_space in umbel.toml.",
        );
    };
    let dry_run = input
        .get("dry_run")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_LIMIT, |limit| {
            usize::try_from(limit).unwrap_or(DEFAULT_LIMIT)
        });
    let wanted = input.get("collection").and_then(Value::as_str);
    let chosen = match collections(cx, &space, wanted) {
        Ok(chosen) => chosen,
        Err(outcome) => return outcome,
    };
    let schema = match schema(cx) {
        Ok(schema) => schema,
        Err(outcome) => return outcome,
    };
    let all_ids: Vec<String> = match cx.content_collections(&space) {
        Ok(declared) => declared.into_iter().map(|info| info.id).collect(),
        Err(error) => return fail::host(&error),
    };
    let mut budget = Budget {
        bytes: 0,
        files: limit,
    };
    let mut reports: Vec<(String, Result<Report, HostError>)> = Vec::new();
    for collection in &chosen {
        let report = sync_collection(
            cx,
            &space,
            collection,
            &schema,
            &all_ids,
            dry_run,
            &mut budget,
        );
        reports.push((collection.info.id.clone(), report));
    }
    // One collection failing must not hide the others' totals; all failing is a failure.
    if !reports.is_empty() && reports.iter().all(|(_, report)| report.is_err()) {
        if let Some((_, Err(error))) = reports.into_iter().next() {
            return fail::host(&error);
        }
        return failure(
            "SOURCE_FAILED",
            "every collection failed",
            "Run store-check.",
        );
    }
    render(cx, &space, wanted, dry_run, limit, &reports)
}

/// One collection's sync: the shared settings of its steps.
struct Sync<'a> {
    cx: &'a Cx,
    space: &'a str,
    collection: &'a Collection,
    schema: &'a Schema,
    /// Every collection id of the space, for resolving links.
    all_ids: &'a [String],
    /// The ids of this collection's candidates.
    ids: HashSet<String>,
    digest: String,
    dry_run: bool,
}

/// What a collection's sync builds up.
struct Work {
    report: Report,
    state: State,
}

#[allow(clippy::too_many_lines)]
fn sync_collection(
    cx: &Cx,
    space: &str,
    collection: &Collection,
    schema: &Schema,
    all_ids: &[String],
    dry_run: bool,
    budget: &mut Budget,
) -> Result<Report, HostError> {
    let mut report = Report::default();
    let id = collection.info.id.as_str();
    let Some(entries) = collection::list(cx, space, id)? else {
        report.limited = true;
        return Ok(report);
    };
    let (candidates, selected) = candidates(&entries, collection, &mut report.skips);
    if selected > MAX_FILES {
        // Section 5.2: more than 100 000 files is SOURCE_LIMIT, and nothing is written.
        report.limited = true;
        report.skips = Skips::default();
        return Ok(report);
    }
    let state = State::load(cx, space, id)?;
    let directories = Directories::load(cx, space, id, &entries, &mut budget.bytes);
    let run = Sync {
        cx,
        space,
        collection,
        schema,
        all_ids,
        ids: candidates.iter().map(|c| c.id.clone()).collect(),
        digest: collection.digest(&schema.bytes),
        dry_run,
    };
    let mut work = Work { report, state };
    let mut previous: Option<&str> = None;
    let mut walked = true;

    for candidate in &candidates {
        let inherit = directories.inherit(&candidate.path, collection);
        let key = inherit
            .as_ref()
            .map_or(INVALID_KEY, |inherit| inherit.key.as_str());
        let seen = work.state.get(&candidate.path).cloned();
        if let Some(seen) = &seen
            && seen.size == candidate.size
            && seen.mtime_ms == candidate.mtime_ms
            && seen.cfg == run.digest
            && seen.inherit == key
        {
            match &seen.skip {
                Some(code) => work.report.skips.add(code, &candidate.path),
                None => work.report.unchanged += 1,
            }
            previous = Some(&candidate.path);
            continue;
        }
        if budget.files == 0 || budget.bytes + candidate.size > MAX_RUN_BYTES {
            walked = false;
            break;
        }
        budget.files -= 1;
        if run.process(
            candidate,
            seen.as_ref(),
            inherit.as_ref(),
            key,
            budget,
            &mut work,
        )? == Step::Stop
        {
            walked = false;
            break;
        }
        previous = Some(&candidate.path);
    }

    if walked {
        // Only a walk that finished knows which files are gone.
        let live: HashSet<&str> = candidates.iter().map(|c| c.path.as_str()).collect();
        let gone: Vec<(String, Entry)> = work
            .state
            .entries()
            .filter(|(path, _)| !live.contains(path.as_str()))
            .map(|(path, entry)| (path.clone(), entry.clone()))
            .collect();
        for (path, entry) in gone {
            run.remove(&path, &entry, &mut work)?;
        }
    } else {
        work.report.remaining = true;
        work.report.stopped_after = previous.map(str::to_owned);
    }
    if !dry_run {
        let revs = work.state.save(
            cx,
            space,
            id,
            &json!({
                "version": 1,
                "cfg": run.digest,
                "files": candidates.len(),
                "complete": walked,
            }),
        )?;
        work.report.revs.extend(revs);
    }
    Ok(work.report)
}

#[derive(PartialEq, Eq)]
enum Step {
    Go,
    Stop,
}

impl Sync<'_> {
    fn entry(&self, candidate: &Candidate, key: &str) -> Entry {
        Entry {
            size: candidate.size,
            mtime_ms: candidate.mtime_ms,
            hash: None,
            skip: None,
            stored: None,
            inherit: key.to_owned(),
            cfg: self.digest.clone(),
        }
    }

    /// A file that produces no document, and why.
    fn skip(
        &self,
        candidate: &Candidate,
        seen: Option<&Entry>,
        code: &str,
        hash: Option<String>,
        key: &str,
        work: &mut Work,
    ) -> Result<Step, HostError> {
        work.report.skips.add(code, &candidate.path);
        // A file that stopped being a document takes its document with it.
        if let Some(seen) = seen
            && seen.stored.is_some()
        {
            self.remove(&candidate.path, seen, work)?;
        }
        if !self.dry_run {
            work.state.set(
                &candidate.path,
                Entry {
                    hash,
                    skip: Some(code.to_owned()),
                    ..self.entry(candidate, key)
                },
            );
        }
        Ok(Step::Go)
    }

    /// Delete the document of a file that is gone (or is no longer a document).
    fn remove(&self, path: &str, entry: &Entry, work: &mut Work) -> Result<(), HostError> {
        if entry.stored.is_some() {
            let Ok(id) = document_id(&self.collection.info.id, path, self.collection.kind) else {
                work.state.remove(path);
                return Ok(());
            };
            // Whether the caller may read it is decided before it is gone.
            let visible = readable(self.cx, self.space, &self.collection.info.id, &id)?;
            if !self.dry_run {
                let hash = entry
                    .hash
                    .as_deref()
                    .and_then(|text| ContentHash::parse(text).ok());
                let expect = hash.map_or(Expect::Any, Expect::Hash);
                let envelope = tombstone_envelope();
                let rev = match self
                    .cx
                    .doc_delete(self.space, &id, expect, envelope.clone())
                {
                    Ok(rev) => Some(rev),
                    // Gone already, or changed by another process since: the file is gone either way.
                    Err(HostError::NotFound(_)) => None,
                    Err(HostError::Conflict { .. }) => self
                        .cx
                        .doc_delete(self.space, &id, Expect::Any, envelope)
                        .ok(),
                    Err(error) => return Err(error),
                };
                work.report.revs.extend(rev);
            }
            work.report.deleted += 1;
            if visible {
                work.report.changes.add(&id, "deleted");
            }
        }
        if !self.dry_run {
            work.state.remove(path);
        }
        Ok(())
    }

    #[allow(clippy::too_many_lines)]
    fn process(
        &self,
        candidate: &Candidate,
        seen: Option<&Entry>,
        inherit: Option<&Inherit>,
        key: &str,
        budget: &mut Budget,
        work: &mut Work,
    ) -> Result<Step, HostError> {
        let (cx, space, collection) = (self.cx, self.space, self.collection);
        if candidate.size > collection.info.max_file_bytes {
            return self.skip(candidate, seen, "SOURCE_TOO_LARGE", None, key, work);
        }
        let bytes = match cx.content_read(space, &collection.info.id, &candidate.path) {
            Ok(bytes) => bytes,
            // The file vanished between the listing and the read: the next run sees it gone.
            Err(HostError::NotFound(_)) => return Ok(Step::Go),
            // The size passed the collection's cap, so this is the per-call cap: stop here.
            Err(HostError::TooLarge(_)) => return Ok(Step::Stop),
            Err(HostError::Io(_) | HostError::Invalid(_)) => {
                return self.skip(candidate, seen, "SOURCE_UNREADABLE", None, key, work);
            }
            Err(error) => return Err(error),
        };
        budget.bytes += bytes.len() as u64;
        let hash = ContentHash::of(&bytes);
        let hash_text = hash.to_string();

        if let Some(seen) = seen
            && seen.skip.is_none()
            && seen.hash.as_deref() == Some(hash_text.as_str())
            && seen.cfg == self.digest
            && seen.inherit == key
        {
            // Touched but not changed: remember the new stat and move on.
            work.report.unchanged += 1;
            if !self.dry_run {
                work.state.set(
                    &candidate.path,
                    Entry {
                        size: candidate.size,
                        mtime_ms: candidate.mtime_ms,
                        ..seen.clone()
                    },
                );
            }
            return Ok(Step::Go);
        }

        let analysis = match analyze(&Ingest::new(
            &bytes,
            &candidate.path,
            collection.kind,
            &collection.info.default_type,
        )) {
            Ok(analysis) => analysis,
            Err(Problem::NotUtf8) => {
                return self.skip(
                    candidate,
                    seen,
                    "SOURCE_UNREADABLE",
                    Some(hash_text),
                    key,
                    work,
                );
            }
            Err(_) => {
                return self.skip(
                    candidate,
                    seen,
                    "FRONTMATTER_INVALID",
                    Some(hash_text),
                    key,
                    work,
                );
            }
        };
        let (tokens, sensitivity) = match (&analysis.access, inherit) {
            (Declared::Set(tokens), inherited) => (
                tokens.clone(),
                analysis
                    .sensitivity
                    .or_else(|| inherited.map(|inherit| inherit.sensitivity))
                    .unwrap_or(collection.sensitivity),
            ),
            (Declared::Absent, Some(inherited)) => (
                inherited.access.clone(),
                analysis.sensitivity.unwrap_or(inherited.sensitivity),
            ),
            // An access key that does not read, a rule that does not read, or a variant this
            // code does not know: never more readable than the file asked to be.
            _ => {
                return self.skip(
                    candidate,
                    seen,
                    "ACCESS_INVALID",
                    Some(hash_text),
                    key,
                    work,
                );
            }
        };
        let Ok(access) = AccessSet::new(tokens) else {
            return self.skip(
                candidate,
                seen,
                "ACCESS_INVALID",
                Some(hash_text),
                key,
                work,
            );
        };

        // The inherited rule changed but this file's own keys decide the same access: the document
        // is as it was.
        if let Some(seen) = seen
            && seen.skip.is_none()
            && seen.cfg == self.digest
            && seen.hash.as_deref() == Some(hash_text.as_str())
            && seen.stored.as_ref() == Some(&(access.tokens().to_vec(), sensitivity))
        {
            work.report.unchanged += 1;
            if !self.dry_run {
                work.state.set(
                    &candidate.path,
                    Entry {
                        size: candidate.size,
                        mtime_ms: candidate.mtime_ms,
                        inherit: key.to_owned(),
                        ..seen.clone()
                    },
                );
            }
            return Ok(Step::Go);
        }

        let mut flags: BTreeSet<Flag> = analysis.flags.clone();
        if document::checks_frontmatter(collection.kind)
            && !self.schema.accepts(&analysis.frontmatter)
        {
            if collection.info.strict {
                return self.skip(
                    candidate,
                    seen,
                    "FRONTMATTER_SCHEMA",
                    Some(hash_text),
                    key,
                    work,
                );
            }
            flags.insert(Flag::SchemaInvalid);
        }
        if collection.kind == Kind::Markdown
            && document::has_broken_links(&analysis, &candidate.id, &self.ids, self.all_ids)
        {
            flags.insert(Flag::BrokenLinks);
        }
        for flag in &flags {
            work.report.flagged.count(flag_name(*flag));
        }

        let document = document::build(document::Parts {
            space,
            collection,
            id: &candidate.id,
            path: &candidate.path,
            bytes,
            hash: hash.clone(),
            analysis: &analysis,
            flags: &flags,
            access: &access,
            sensitivity,
        });
        let stored_before = seen.is_some_and(|seen| seen.stored.is_some());
        let change = if stored_before { "updated" } else { "added" };
        let remember = |work: &mut Work| {
            work.state.set(
                &candidate.path,
                Entry {
                    hash: Some(hash_text.clone()),
                    stored: Some((access.tokens().to_vec(), sensitivity)),
                    ..self.entry(candidate, key)
                },
            );
        };

        if !self.dry_run {
            let expect = match seen
                .filter(|seen| seen.stored.is_some())
                .and_then(|seen| seen.hash.as_deref())
            {
                Some(text) => ContentHash::parse(text).map_or(Expect::Any, Expect::Hash),
                None => Expect::Absent,
            };
            let written = match cx.doc_put(space, document.clone(), expect) {
                Err(HostError::Conflict { current }) => {
                    // Another process wrote this document since the state was read: retry once
                    // against what is stored now.
                    let retry = match current.as_deref().map(ContentHash::parse) {
                        Some(Ok(current)) if current == hash => {
                            work.report.unchanged += 1;
                            remember(work);
                            return Ok(Step::Go);
                        }
                        Some(Ok(current)) => Expect::Hash(current),
                        _ => Expect::Absent,
                    };
                    cx.doc_put(space, document, retry)
                }
                other => other,
            };
            match written {
                Ok(meta) => work.report.revs.push(meta.rev),
                Err(HostError::Conflict { .. }) => {
                    // Lost the race twice: leave it for the next run, and say so.
                    work.report.skips.add("SOURCE_CONFLICT", &candidate.path);
                    return Ok(Step::Go);
                }
                Err(error) => return Err(error),
            }
            remember(work);
        }

        if change == "added" {
            work.report.added += 1;
        } else {
            work.report.updated += 1;
        }
        // Ids are listed only when the caller may read the document. A file not stored yet (a
        // dry run's new file) has no document to ask about, so its path is for a person at the
        // command line.
        if self.dry_run && !stored_before {
            if is_person_at_cli(cx) && work.report.new_paths.len() < crate::report::LISTED_PATHS {
                work.report.new_paths.push(candidate.path.clone());
            }
        } else if readable(cx, space, &collection.info.id, &candidate.id)? {
            work.report.changes.add(&candidate.id, change);
            for (flag, code) in [
                (Flag::FieldsLimited, "FIELDS_LIMITED"),
                (Flag::SchemaInvalid, "FRONTMATTER_SCHEMA"),
                (Flag::InstructionLike, "CONTENT_FLAGGED"),
                (Flag::HiddenText, "CONTENT_FLAGGED"),
            ] {
                if flags.contains(&flag) {
                    work.report.flagged.note_readable(code, &candidate.id);
                }
            }
            if analysis.okf_version_unknown {
                work.report
                    .flagged
                    .note_readable("OKF_VERSION_UNKNOWN", &candidate.id);
            }
        }
        Ok(Step::Go)
    }
}

fn tombstone_envelope() -> umbel_store::Envelope {
    umbel_store::Envelope {
        version: 1,
        origin: Origin::DocumentDerived,
        space: String::new(),
        plugin: None,
        agent: None,
        principal: None,
        session: None,
        trace_id: None,
        observed_at: "1970-01-01T00:00:00.000Z".to_owned(),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: None,
        generated: None,
        content_hash: None,
        derived_from: None,
        access: vec!["space".to_owned()],
        sensitivity: Some(Sensitivity::Internal),
    }
}

pub(crate) fn flag_name(flag: Flag) -> &'static str {
    match flag {
        Flag::BrokenLinks => "broken-links",
        Flag::FieldsLimited => "fields-limited",
        Flag::HiddenText => "hidden-text",
        Flag::InstructionLike => "instruction-like",
        Flag::SchemaInvalid => "schema-invalid",
        Flag::TypeDefaulted => "type-defaulted",
    }
}

/// The skip codes that are warnings on the result, with their messages.
const SKIP_MESSAGES: &[(&str, &str)] = &[
    (
        "SOURCE_TOO_LARGE",
        "files over the collection's max_file_bytes were skipped",
    ),
    (
        "SOURCE_UNREADABLE",
        "files the host could not read, or that are not UTF-8 text, were skipped",
    ),
    (
        "SOURCE_PATH_INVALID",
        "files whose paths cannot be document ids were skipped",
    ),
    (
        "FRONTMATTER_INVALID",
        "files whose frontmatter is malformed were skipped",
    ),
    (
        "FRONTMATTER_SCHEMA",
        "files whose frontmatter fails the schema were skipped in a strict collection",
    ),
    (
        "ACCESS_INVALID",
        "files whose access rule does not read were skipped, rather than made more readable than they asked to be",
    ),
    (
        "SOURCE_CONFLICT",
        "files another process changed while they were being written were left for the next run",
    ),
];

/// For a warning: each collection's name, its count and the ids or paths it may name.
type PerCollection = Vec<(String, usize, Vec<String>)>;

fn render(
    cx: &Cx,
    space: &str,
    wanted: Option<&str>,
    dry_run: bool,
    limit: usize,
    reports: &[(String, Result<Report, HostError>)],
) -> Outcome {
    let person = is_person_at_cli(cx);
    let mut collections = Vec::new();
    let mut totals: BTreeMap<&str, usize> = BTreeMap::new();
    let mut warn_skips: BTreeMap<String, PerCollection> = BTreeMap::new();
    let mut warn_flags: BTreeMap<&str, PerCollection> = BTreeMap::new();
    let mut warn_limit = Vec::new();
    let mut warn_failed = Vec::new();
    let mut revs: Vec<u64> = Vec::new();
    let mut any_remaining = false;
    for (name, report) in reports {
        let report = match report {
            Ok(report) => report,
            Err(error) => {
                warn_failed.push((name.clone(), error.to_string()));
                collections.push(json!({ "collection": name, "failed": true }));
                continue;
            }
        };
        for (key, value) in [
            ("added", report.added),
            ("updated", report.updated),
            ("deleted", report.deleted),
            ("unchanged", report.unchanged),
            ("skipped", report.skips.total()),
        ] {
            *totals.entry(key).or_default() += value;
        }
        revs.extend(&report.revs);
        any_remaining |= report.remaining;
        if report.limited {
            warn_limit.push(name.clone());
        }
        for (code, count) in report.skips.reasons() {
            let paths = if person {
                report.skips.paths().to_vec()
            } else {
                Vec::new()
            };
            warn_skips
                .entry(code.clone())
                .or_default()
                .push((name.clone(), *count, paths));
        }
        for (code, ids) in &report.flagged.ids {
            warn_flags
                .entry(code)
                .or_default()
                .push((name.clone(), ids.len(), ids.clone()));
        }
        let (changed, more) = report.changes.json();
        let mut entry = json!({
            "collection": name,
            "added": report.added,
            "updated": report.updated,
            "deleted": report.deleted,
            "unchanged": report.unchanged,
            "skipped": { "total": report.skips.total(), "reasons": report.skips.reasons() },
            "flagged": report.flagged.counts,
            "fromRev": report.revs.iter().min(),
            "toRev": report.revs.iter().max(),
            "remaining": report.remaining,
            "stoppedAfter": report.stopped_after,
            "changed": changed,
            "changedMore": more,
        });
        if report.limited
            && let Some(map) = entry.as_object_mut()
        {
            map.insert("limited".to_owned(), Value::Bool(true));
        }
        if person && let Some(map) = entry.as_object_mut() {
            map.insert("skippedPaths".to_owned(), json!(report.skips.paths()));
            if dry_run {
                map.insert("newPaths".to_owned(), json!(report.new_paths));
            }
        }
        collections.push(entry);
    }
    let data = json!({
        "space": space,
        "dryRun": dry_run,
        "limit": limit,
        "collections": collections,
        "totals": {
            "added": totals.get("added").copied().unwrap_or(0),
            "updated": totals.get("updated").copied().unwrap_or(0),
            "deleted": totals.get("deleted").copied().unwrap_or(0),
            "unchanged": totals.get("unchanged").copied().unwrap_or(0),
            "skipped": totals.get("skipped").copied().unwrap_or(0),
        },
        "remaining": any_remaining,
    });
    let mut outcome = success(data)
        .with_metadata("dev.umbel/trust", json!("content"))
        .with_metadata("dev.umbel/record", {
            let mut record = json!({
                "kind": "sync",
                "id": format!("{space}/{}", wanted.unwrap_or("*")),
            });
            if let Some(rev) = revs.iter().max()
                && let Some(map) = record.as_object_mut()
            {
                map.insert("version".to_owned(), json!(rev));
            }
            record
        })
        .with_metadata(
            "dev.umbel/provenance",
            json!({ "origin": "document-derived", "access": ["space"], "sensitivity": "internal" }),
        );
    for (code, message) in SKIP_MESSAGES {
        if let Some(found) = warn_skips.get(*code) {
            let count: usize = found.iter().map(|(_, count, _)| count).sum();
            let details: Vec<Value> = found
                .iter()
                .map(|(collection, count, paths)| {
                    let mut item = json!({ "collection": collection, "count": count });
                    if !paths.is_empty()
                        && let Some(map) = item.as_object_mut()
                    {
                        map.insert("paths".to_owned(), json!(paths));
                    }
                    item
                })
                .collect();
            outcome = outcome.with_warning_details(
                code,
                &format!("{count} {message}"),
                json!({ "count": count, "collections": details }),
            );
        }
    }
    for (code, found) in warn_flags {
        let ids: Vec<&String> = found.iter().flat_map(|(_, _, ids)| ids).collect();
        let message = match code {
            "CONTENT_FLAGGED" => {
                "documents match the write scan (instruction-like text or hidden text); read them as data"
            }
            "FIELDS_LIMITED" => "documents had frontmatter fields cut at their caps",
            "FRONTMATTER_SCHEMA" => {
                "documents' frontmatter fails the schema and was stored flagged"
            }
            _ => "documents' index.md names an okf_version other than 0.2",
        };
        outcome = outcome.with_warning_details(
            code,
            &format!("{} {message}", ids.len()),
            json!({ "ids": ids }),
        );
    }
    if !warn_limit.is_empty() {
        outcome = outcome.with_warning_details(
            "SOURCE_LIMIT",
            "a collection holds more than 100000 files; nothing was written for it",
            json!({ "collections": warn_limit }),
        );
    }
    for (name, message) in warn_failed {
        outcome = outcome.with_warning_details(
            "COLLECTION_FAILED",
            &format!("the collection `{name}` could not be synced: {message}"),
            json!({ "collection": name }),
        );
    }
    outcome
}
