//! `store-records-eval` (records host specification, sections 10 and 12.2; D167):
//! scores a deployer's labelled probes against one declared record kind by words alone and fused,
//! verifies every returned hit against `record_access` via `get_record` to count leaks, writes
//! `evals/records/<space>/<plugin>.<kind>.json` atomically, and returns the report.
//!
//! Exposed to the CLI only, for the operator only, in `UNPROJECTED_MUTATIONS`, and journaled as
//! a digest keeping `["space", "plugin", "kind", "probes"]`. No error message ever holds a
//! probe's text.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    ResultOptions, Warning, failure, success, success_with,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use umbel_store::lane::{
    LaneState, MAX_LANE_TEXT_BYTES, MAX_MATCH_K, MatchVectors, MeaningState, NORMALISATION_VERSION,
    OwnCollection, RecordDecl, RecordMatch, Standing, StandingView,
};
use umbel_store::{DocumentStore, Embedder, ReaderFilter, StoreError, check_identifier};

use super::store_common::{space_property, view};
use super::store_records::{declared_in, not_declared};
use super::{Builtin, blocking, returns_object};
use crate::access::{Caller, Narrowing, reader_filter};
use crate::meaning::{
    BoundedReadError, EvalHits, HitCounts, MAX_EVAL_PROBES, MeaningHub, RecordEvalReport,
    check_eval_report_path, is_under_state, read_file_bounded, rule_passes,
};
use crate::plugins::LoadedPlugins;
use crate::plugins::record_services::{embed_match_texts, person_identities};
use crate::store::{Hub, command_error, records};
use crate::versions::{RECORD_EVAL_REPORT_VERSION, RECORD_PROBES_VERSION};
use crate::workspace::{SpaceConfig, Workspace, parse_principal};

/// The command's name.
pub(crate) const EVAL: &str = "store-records-eval";
/// The inputs its journal digest keeps: none is content.
pub(crate) const EVAL_KEPT: &[&str] = &["space", "plugin", "kind", "probes"];

/// Largest probes file accepted (16 MiB, section 12.2).
const MAX_PROBES_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Most probes in one file (section 10).
const MAX_PROBES: usize = MAX_EVAL_PROBES as usize;
/// Most duplicate ids per probe.
const MAX_DUPLICATES: usize = 64;

const ALL_STANDINGS: [Standing; 3] = [Standing::Unverified, Standing::Attested, Standing::Affirmed];

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
    meaning: Arc<MeaningHub>,
}

/// One validated probe from a `record-probes.v1.json` file.
#[derive(Debug, Clone)]
pub(crate) struct Probe {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) duplicates: Vec<String>,
    pub(crate) self_id: Option<String>,
    pub(crate) reader: String,
}

fn probes_invalid(message: impl Into<String>) -> CommandError {
    CommandError::new(records::RECORD_PROBES_INVALID, message.into())
        .with_suggestion("Fix the file at the place the message names and run the command again.")
        .with_retryable(false)
}

fn model_unavailable(message: impl Into<String>) -> CommandError {
    CommandError::new(records::RECORD_MODEL_UNAVAILABLE, message.into())
        .with_suggestion("Run umbel workspace doctor and fix what records.meaning reports.")
        .with_retryable(false)
}

/// Resolve `rel` inside `workspace_root`, refusing absolute paths, `..`, backslashes, anything
/// missing, non-files, files over 16 MiB, or anything resolving outside the workspace or inside
/// `state/`.
fn read_probes_file(workspace_root: &Path, rel: &str) -> Result<(PathBuf, Vec<u8>), CommandError> {
    if rel.is_empty()
        || rel.contains('\\')
        || rel.chars().any(char::is_control)
        || Path::new(rel).is_absolute()
    {
        return Err(probes_invalid(
            "probes must be a relative path inside the workspace without backslashes or control characters",
        ));
    }
    for component in Path::new(rel).components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(probes_invalid(
                "probes must stay inside the workspace without `..` segments",
            ));
        }
    }
    let canonical_ws = fs::canonicalize(workspace_root)
        .map_err(|err| probes_invalid(format!("workspace root cannot be resolved: {err}")))?;
    let candidate = workspace_root.join(rel);
    let canonical_file = fs::canonicalize(&candidate)
        .map_err(|err| probes_invalid(format!("probes file `{rel}` cannot be read: {err}")))?;
    if !canonical_file.starts_with(&canonical_ws) {
        return Err(probes_invalid(format!(
            "probes file `{rel}` resolves outside the workspace"
        )));
    }
    if is_under_state(workspace_root, &canonical_ws, &canonical_file) {
        return Err(probes_invalid(format!(
            "probes file `{rel}` must not lie under state/"
        )));
    }
    let bytes =
        read_file_bounded(&canonical_file, MAX_PROBES_FILE_BYTES).map_err(|err| match err {
            BoundedReadError::NotFound => {
                probes_invalid(format!("probes file `{rel}` does not exist"))
            }
            BoundedReadError::NotRegularFile => {
                probes_invalid(format!("probes path `{rel}` is not a regular file"))
            }
            BoundedReadError::TooLarge(cap) => {
                probes_invalid(format!("probes file `{rel}` exceeds {cap} bytes"))
            }
            BoundedReadError::Io(io) => {
                probes_invalid(format!("probes file `{rel}` cannot be read: {io}"))
            }
        })?;
    Ok((canonical_file, bytes))
}

fn sha256_prefixed(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::from("sha256:");
    for byte in &digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Validate a probes file's bytes against `schemas/record-probes.v1.json` and the target
/// `(space, plugin, kind)`. Names the first rule broken and the probe's id, never its text.
fn parse_probes(
    bytes: &[u8],
    space: &SpaceConfig,
    plugin: &str,
    kind: &str,
) -> Result<Vec<Probe>, CommandError> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|err| probes_invalid(format!("probes file is not valid JSON: {err}")))?;
    let obj = value
        .as_object()
        .ok_or_else(|| probes_invalid("probes file root must be a JSON object"))?;
    const TOP_KEYS: &[&str] = &["version", "space", "plugin", "kind", "probes"];
    for key in obj.keys() {
        if !TOP_KEYS.contains(&key.as_str()) {
            return Err(probes_invalid(format!(
                "probes file has unexpected top-level key `{key}`"
            )));
        }
    }
    if obj.get("version").and_then(Value::as_u64) != Some(u64::from(RECORD_PROBES_VERSION)) {
        return Err(probes_invalid(format!(
            "probes file version must be {RECORD_PROBES_VERSION}"
        )));
    }
    let file_space = obj
        .get("space")
        .and_then(Value::as_str)
        .ok_or_else(|| probes_invalid("probes file `space` must be a string"))?;
    if file_space != space.id.as_str() {
        return Err(probes_invalid(format!(
            "probes file names space `{file_space}`, not `{}`",
            space.id
        )));
    }
    let file_plugin = obj
        .get("plugin")
        .and_then(Value::as_str)
        .ok_or_else(|| probes_invalid("probes file `plugin` must be a string"))?;
    if file_plugin != plugin {
        return Err(probes_invalid(format!(
            "probes file names plugin `{file_plugin}`, not `{plugin}`"
        )));
    }
    let file_kind = obj
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| probes_invalid("probes file `kind` must be a string"))?;
    if file_kind != kind {
        return Err(probes_invalid(format!(
            "probes file names kind `{file_kind}`, not `{kind}`"
        )));
    }
    let list = obj
        .get("probes")
        .and_then(Value::as_array)
        .ok_or_else(|| probes_invalid("probes file `probes` must be an array"))?;
    if list.is_empty() || list.len() > MAX_PROBES {
        return Err(probes_invalid(format!(
            "probes must hold 1 to {MAX_PROBES} entries, got {}",
            list.len()
        )));
    }
    const PROBE_KEYS: &[&str] = &["id", "text", "duplicates", "self", "reader"];
    let mut parsed = Vec::with_capacity(list.len());
    for (index, item) in list.iter().enumerate() {
        let entry = item
            .as_object()
            .ok_or_else(|| probes_invalid(format!("probes[{index}] must be an object")))?;
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| (1..=128).contains(&s.chars().count()) && !s.chars().any(char::is_control))
            .ok_or_else(|| {
                probes_invalid(format!(
                    "probes[{index}].id must be 1 to 128 characters without control characters"
                ))
            })?;
        for key in entry.keys() {
            if !PROBE_KEYS.contains(&key.as_str()) {
                return Err(probes_invalid(format!(
                    "probe `{id}` has unexpected key `{key}`"
                )));
            }
        }
        let text = entry
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| probes_invalid(format!("probe `{id}`: `text` must be a string")))?;
        if !(1..=MAX_LANE_TEXT_BYTES).contains(&text.len()) {
            return Err(probes_invalid(format!(
                "probe `{id}`: `text` must be 1 to {MAX_LANE_TEXT_BYTES} bytes"
            )));
        }
        let dup_arr = entry
            .get("duplicates")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                probes_invalid(format!(
                    "probe `{id}`: `duplicates` must be an array of record ids"
                ))
            })?;
        if dup_arr.len() > MAX_DUPLICATES {
            return Err(probes_invalid(format!(
                "probe `{id}`: `duplicates` holds at most {MAX_DUPLICATES} ids"
            )));
        }
        let mut duplicates = Vec::with_capacity(dup_arr.len());
        let mut seen = BTreeSet::new();
        for dup in dup_arr {
            let dup_id = dup.as_str().ok_or_else(|| {
                probes_invalid(format!("probe `{id}`: each duplicate id must be a string"))
            })?;
            if check_identifier("a record id", dup_id).is_err() {
                return Err(probes_invalid(format!(
                    "probe `{id}`: each duplicate id must be 1 to 512 bytes without control characters"
                )));
            }
            if !seen.insert(dup_id.to_owned()) {
                return Err(probes_invalid(format!(
                    "probe `{id}`: `duplicates` contains a repeated record id"
                )));
            }
            duplicates.push(dup_id.to_owned());
        }
        let self_id = match entry.get("self") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => {
                if check_identifier("a record id", s).is_err() {
                    return Err(probes_invalid(format!(
                        "probe `{id}`: `self` must be a valid record id (1 to 512 bytes without control characters)"
                    )));
                }
                Some(s.clone())
            }
            Some(_) => {
                return Err(probes_invalid(format!(
                    "probe `{id}`: `self` must be a string or null"
                )));
            }
        };
        let reader = match entry.get("reader") {
            None | Some(Value::Null) => space.person.clone().ok_or_else(|| {
                probes_invalid(format!(
                    "probe `{id}` omits `reader` and space `{}` configures no `person`",
                    space.id
                ))
            })?,
            Some(Value::String(r)) => {
                if parse_principal(r).is_err() {
                    return Err(probes_invalid(format!(
                        "probe `{id}`: `reader` must be a principal string (<kind>:<id>)"
                    )));
                }
                r.clone()
            }
            Some(_) => {
                return Err(probes_invalid(format!(
                    "probe `{id}`: `reader` must be a principal string or null"
                )));
            }
        };
        parsed.push(Probe {
            id: id.to_owned(),
            text: text.to_owned(),
            duplicates,
            self_id,
            reader,
        });
    }
    Ok(parsed)
}

fn space_view(workspace: &Workspace, space: &SpaceConfig) -> StandingView {
    let config = workspace.config();
    StandingView {
        own: space
            .collections
            .iter()
            .filter(|c| c.own)
            .map(|c| OwnCollection {
                id: c.id.clone(),
                speaker: c.speaker.clone(),
            })
            .collect(),
        command_writable: space
            .collections
            .iter()
            .filter(|c| config.command_writable(space.id.as_str(), &c.id))
            .map(|c| c.id.clone())
            .collect(),
        person: person_identities(config, space.person.as_deref()),
        admit: ALL_STANDINGS.to_vec(),
        levels: Vec::new(),
    }
}

fn filter_for(workspace: &Workspace, space: &str, principal: &str) -> ReaderFilter {
    let config = workspace.config();
    let caller = Caller::new(
        config,
        Some(principal.to_owned()),
        Vec::new(),
        Narrowing::None,
        false,
    );
    reader_filter(config, space, &caller).unwrap_or_else(|_| {
        ReaderFilter::tokens(Vec::<String>::new()).unwrap_or_else(|_| unreachable!())
    })
}

fn bump_hits(
    counts: &mut HitCounts,
    nearest: &[umbel_store::lane::MatchHit],
    dups: &[String],
    k: usize,
) {
    let found_in = |cutoff: usize| {
        nearest
            .iter()
            .take(cutoff)
            .any(|hit| dups.iter().any(|dup| dup == &hit.id))
    };
    if found_in(1) {
        counts.at_1 += 1;
    }
    if found_in(3) {
        counts.at_3 += 1;
    }
    if found_in(5) {
        counts.at_5 += 1;
    }
    if found_in(10) {
        counts.at_10 += 1;
    }
    if found_in(20) {
        counts.at_20 += 1;
    }
    if found_in(k) {
        counts.k += 1;
    }
}

/// Core evaluation loop over a `DocumentStore` (testable directly with a leaking store wrapper).
#[cfg_attr(not(test), allow(dead_code))]
#[allow(clippy::too_many_arguments)]
pub(crate) fn evaluate_probes(
    store: &dyn DocumentStore,
    embedder: &dyn Embedder,
    workspace: &Workspace,
    space: &SpaceConfig,
    plugin: &str,
    decl: &RecordDecl,
    weight: f64,
    k: u64,
    probes: &[Probe],
    probes_digest: String,
    at: String,
) -> Result<RecordEvalReport, CommandError> {
    evaluate_probes_with_status(
        store,
        embedder,
        workspace,
        space,
        plugin,
        decl,
        weight,
        k,
        probes,
        probes_digest,
        at,
    )
    .map(|(report, _)| report)
}

#[allow(clippy::too_many_arguments)]
fn evaluate_probes_with_status(
    store: &dyn DocumentStore,
    embedder: &dyn Embedder,
    workspace: &Workspace,
    space: &SpaceConfig,
    plugin: &str,
    decl: &RecordDecl,
    weight: f64,
    k: u64,
    probes: &[Probe],
    probes_digest: String,
    at: String,
) -> Result<(RecordEvalReport, Option<MeaningState>), CommandError> {
    let status = store
        .lane_status(plugin, decl)
        .map_err(|e| command_error(&e))?;
    if status.state == LaneState::Stale {
        return Err(command_error(&StoreError::LaneStale));
    }
    let texts: Vec<String> = probes.iter().map(|p| p.text.clone()).collect();
    let probe_vectors = embed_match_texts(embedder, &texts)
        .map_err(|reason| model_unavailable(format!("embedding probes failed: {reason}")))?;
    let view = space_view(workspace, space);
    let mut words_hits = HitCounts {
        at_1: 0,
        at_3: 0,
        at_5: 0,
        at_10: 0,
        at_20: 0,
        k: 0,
    };
    let mut fused_hits = words_hits.clone();
    let mut n = 0u64;
    let mut leaks = 0u64;
    let mut degraded_meaning: Option<MeaningState> = None;
    let k_usize = usize::try_from(k).unwrap_or(5);

    for (probe, vector) in probes.iter().zip(probe_vectors) {
        let reader = filter_for(workspace, space.id.as_str(), &probe.reader);
        let query = RecordMatch {
            kind: decl.kind.clone(),
            texts: vec![probe.text.clone()],
            k: MAX_MATCH_K,
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            exclude: probe.self_id.iter().cloned().collect(),
        };
        let words_page = store
            .match_records(plugin, decl, &query, None, &view, &reader)
            .map_err(|e| match e {
                StoreError::Invalid(msg) => probes_invalid(format!("probe `{}`: {msg}", probe.id)),
                other => command_error(&other),
            })?;
        let mv = MatchVectors {
            model: embedder.model().clone(),
            weight,
            vectors: vec![vector],
        };
        let fused_page = store
            .match_records(plugin, decl, &query, Some(&mv), &view, &reader)
            .map_err(|e| command_error(&e))?;

        if words_page.results.len() != 1 || fused_page.results.len() != 1 {
            return Err(CommandError::new(
                afd::error_codes::INTERNAL_ERROR,
                format!(
                    "store returned {} words result(s) and {} fused result(s) for probe `{}` (expected 1 each)",
                    words_page.results.len(),
                    fused_page.results.len(),
                    probe.id
                ),
            )
            .with_suggestion(
                "Run umbel store check space=<id> and retry umbel store records-eval.",
            )
            .with_retryable(false));
        }
        if matches!(
            fused_page.meaning,
            MeaningState::Incomplete | MeaningState::Failed
        ) && degraded_meaning.is_none()
        {
            degraded_meaning = Some(fused_page.meaning.clone());
        }

        let words_res = &words_page.results[0];
        let fused_res = &fused_page.results[0];

        // Check every returned id against `record_access` by a separate statement (`get_record`).
        let mut returned_ids: BTreeSet<&str> = BTreeSet::new();
        for res in [words_res, fused_res] {
            for hit in res.identical.iter().chain(&res.nearest) {
                returned_ids.insert(hit.id.as_str());
            }
        }
        for hit_id in returned_ids {
            let readable = store
                .get_record(plugin, &decl.kind, hit_id, &reader)
                .map_err(|e| command_error(&e))?
                .is_some();
            if !readable {
                leaks += 1;
            }
        }

        if !probe.duplicates.is_empty() {
            n += 1;
            bump_hits(
                &mut words_hits,
                &words_res.nearest,
                &probe.duplicates,
                k_usize,
            );
            bump_hits(
                &mut fused_hits,
                &fused_res.nearest,
                &probe.duplicates,
                k_usize,
            );
        }
    }

    let passed = rule_passes(n, words_hits.k, fused_hits.k, leaks);
    Ok((
        RecordEvalReport {
            version: RECORD_EVAL_REPORT_VERSION,
            space: space.id.to_string(),
            plugin: plugin.to_owned(),
            kind: decl.kind.clone(),
            decl_hash: decl.hash().as_str().to_owned(),
            normalisation: NORMALISATION_VERSION,
            model: embedder.model().as_str().to_owned(),
            weight,
            k,
            probes: probes.len() as u64,
            n,
            hits: EvalHits {
                words: words_hits,
                fused: fused_hits,
            },
            leaks,
            records: status.records,
            probes_digest,
            host_version: env!("CARGO_PKG_VERSION").to_owned(),
            at,
            passed,
        },
        degraded_meaning,
    ))
}

fn write_report_atomic(
    workspace: &Workspace,
    path: &Path,
    report: &RecordEvalReport,
) -> Result<(), CommandError> {
    check_eval_report_path(workspace, path).map_err(|why| {
        CommandError::new(
            crate::store::codes::STORE_IO,
            format!("refusing to write eval report: {why}"),
        )
        .with_suggestion(
            "Ensure evals/records/ stays inside the workspace without symlinks or command-writable collection overlap.",
        )
        .with_retryable(false)
    })?;
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(
            crate::store::codes::STORE_IO,
            "eval report path has no parent directory",
        )
        .with_suggestion("Check the workspace path and run umbel workspace doctor.")
        .with_retryable(false)
    })?;
    fs::create_dir_all(parent).map_err(|err| {
        CommandError::new(
            crate::store::codes::STORE_IO,
            format!("cannot create evals directory: {err}"),
        )
        .with_suggestion("Check permissions on the workspace directory and retry.")
        .with_retryable(false)
    })?;
    check_eval_report_path(workspace, path).map_err(|why| {
        CommandError::new(
            crate::store::codes::STORE_IO,
            format!("refusing to write eval report: {why}"),
        )
        .with_suggestion(
            "Ensure evals/records/ stays inside the workspace without symlinks or command-writable collection overlap.",
        )
        .with_retryable(false)
    })?;
    let json = serde_json::to_string_pretty(report).map_err(|err| {
        CommandError::new(
            afd::error_codes::INTERNAL_ERROR,
            format!("cannot serialize eval report: {err}"),
        )
        .with_suggestion("Retry the command or report an internal serialization bug.")
        .with_retryable(false)
    })?;
    let tmp = parent.join(format!(
        ".eval-report-{}-{}.tmp",
        std::process::id(),
        crate::host::new_trace_id()
    ));
    fs::write(&tmp, format!("{json}\n")).map_err(|err| {
        CommandError::new(
            crate::store::codes::STORE_IO,
            format!("cannot write eval report: {err}"),
        )
        .with_suggestion("Check disk space and write permissions on evals/records/ and retry.")
        .with_retryable(false)
    })?;
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(CommandError::new(
            crate::store::codes::STORE_IO,
            format!("cannot rename eval report into place: {err}"),
        )
        .with_suggestion("Check write permissions on evals/records/ and retry.")
        .with_retryable(false));
    }
    Ok(())
}

struct EvalOutcome {
    data: Value,
    degraded_meaning: Option<MeaningState>,
}

#[allow(clippy::too_many_arguments)]
fn run(
    workspace: &Workspace,
    stores: &Hub,
    meaning: &MeaningHub,
    space_id: &str,
    plugin: &str,
    decl: &RecordDecl,
    probes_path: &str,
    at: String,
) -> Result<EvalOutcome, CommandError> {
    let space = workspace
        .spaces()
        .iter()
        .find(|s| s.id.as_str() == space_id)
        .ok_or_else(|| {
            CommandError::new(
                crate::host::SPACE_NOT_FOUND,
                format!("space `{space_id}` is not declared"),
            )
            .with_suggestion("Pass a declared space id from umbel workspace show.")
            .with_retryable(false)
        })?;
    let meaning_cfg = space.meaning.as_ref().ok_or_else(|| {
        model_unavailable(format!(
            "no embedding model is configured for space `{space_id}`"
        ))
    })?;
    let embedder = meaning.space_embedder(space_id).ok_or_else(|| {
        let reason = match meaning.space_model_failed(space_id) {
            Some(problem) => format!(
                "the embedding model configured for space `{space_id}` did not load: {problem}"
            ),
            None => format!("no embedding model is configured for space `{space_id}`"),
        };
        model_unavailable(reason)
    })?;

    let (_, bytes) = read_probes_file(workspace.root(), probes_path)?;
    let probes_digest = sha256_prefixed(&bytes);
    let probes = parse_probes(&bytes, space, plugin, &decl.kind)?;

    let opened = stores.space(space_id).map_err(|e| command_error(&e))?;
    let (report, degraded_meaning) = evaluate_probes_with_status(
        opened.documents.as_ref(),
        embedder.as_ref(),
        workspace,
        space,
        plugin,
        decl,
        meaning_cfg.weight,
        meaning_cfg.k,
        &probes,
        probes_digest,
        at,
    )?;

    let report_path = workspace
        .layout()
        .record_eval_report(space_id, plugin, &decl.kind);
    write_report_atomic(workspace, &report_path, &report)?;
    let data = serde_json::to_value(&report).map_err(|err| {
        CommandError::new(
            afd::error_codes::INTERNAL_ERROR,
            format!("cannot serialize eval report: {err}"),
        )
        .with_suggestion("Retry the command or report an internal serialization bug.")
        .with_retryable(false)
    })?;
    Ok(EvalOutcome {
        data,
        degraded_meaning,
    })
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if let Some(refused) = super::operator_only(&self.workspace, &context, EVAL) {
            return failure(refused);
        }
        let (space, _filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let space = space.to_string();
        let str_arg = |key: &str| {
            input
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let (plugin, kind, probes) = (str_arg("plugin"), str_arg("kind"), str_arg("probes"));
        let decl = self.loaded.get().and_then(|loaded| {
            declared_in(loaded, &space)
                .into_iter()
                .find(|(inst, d)| inst == &plugin && d.kind == kind)
                .map(|(_, d)| d)
        });
        let Some(decl) = decl else {
            return failure(not_declared(
                format!(
                    "the kind {kind} is not a declared record kind of {plugin} loaded for the space `{space}`"
                ),
                Some(&plugin),
            ));
        };
        if decl.matched.is_none() {
            return failure(not_declared(
                format!("the kind {kind} of {plugin} declares no match field"),
                Some(&plugin),
            ));
        }
        let at = crate::person::iso(context.clock().now());
        let workspace = Arc::clone(&self.workspace);
        let stores = Arc::clone(&self.stores);
        let meaning = Arc::clone(&self.meaning);
        match blocking(move || {
            run(
                &workspace, &stores, &meaning, &space, &plugin, &decl, &probes, at,
            )
        })
        .await
        {
            Ok(outcome) => match outcome.degraded_meaning {
                Some(MeaningState::Incomplete) => {
                    let options = ResultOptions {
                        warnings: Some(vec![Warning::new(
                            records::RECORD_MODEL_UNAVAILABLE,
                            "One or more probes ran with incomplete vectors so fused scores fell back to words alone; run `umbel store records-reindex` and re-run `umbel store records-eval`.",
                        )]),
                        ..ResultOptions::default()
                    };
                    success_with(outcome.data, options)
                }
                Some(MeaningState::Failed) => {
                    let options = ResultOptions {
                        warnings: Some(vec![Warning::new(
                            records::RECORD_MODEL_UNAVAILABLE,
                            "One or more probes failed meaning scoring and fell back to words alone; run `umbel workspace doctor` and re-run `umbel store records-eval`.",
                        )]),
                        ..ResultOptions::default()
                    };
                    success_with(outcome.data, options)
                }
                _ => success(outcome.data),
            },
            Err(error) => failure(error),
        }
    }
}

/// `store-records-eval`.
pub(crate) fn store_records_eval(
    workspace: Arc<Workspace>,
    stores: Hub,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
    meaning: Arc<MeaningHub>,
) -> Builtin {
    let definition = CommandDefinition::new(
        EVAL,
        "Score labelled probes against a declared record kind by words alone and fused, count access leaks, and write evals/records/<space>/<plugin>.<kind>.json",
        vec![],
        Handler {
            workspace,
            stores,
            loaded,
            meaning,
        },
    )
    .with_category("store")
    .with_returns(returns_object(
        "The record eval report written to evals/records/<space>/<plugin>.<kind>.json (counts only, no record text)",
    ))
    .as_mutation()
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "space": space_property(),
                "plugin": {
                    "type": "string",
                    "minLength": 1,
                    "description": "The plugin instance declaring the kind"
                },
                "kind": {
                    "type": "string",
                    "minLength": 1,
                    "description": "The declared record kind with a match field"
                },
                "probes": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Path relative to the workspace (not under state/) of a record-probes.v1.json file, at most 16 MiB"
                },
            },
            "required": ["plugin", "kind", "probes"],
            "additionalProperties": false,
        }),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use umbel_store::lane::{
        Decided, DeclaredPut, FindPage, LaneRecord, LaneStatus, LaneWrite, Marked, MatchHit,
        MatchPage, OwnInfo, OwnMark, Pointer, RecordDecision, RecordFind, ReindexReport,
    };
    use umbel_store::{
        Change, ContentHash, DocMeta, Document, DocumentWrite, EmbedError, Envelope, Expect,
        ListQuery, MemoryFlag, ModelId, Page, Record, RecordMeta, Rev,
    };

    /// Wrapper around `SqliteStore` that injects one unreadable record id into every `match_records`
    /// result so `evaluate_probes`'s separate `get_record` leak check must catch it.
    struct LeakingStore {
        inner: umbel_store_embedded::SqliteStore,
        leaked_id: String,
    }

    impl DocumentStore for LeakingStore {
        fn put_document(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta, StoreError> {
            self.inner.put_document(doc, expect)
        }
        fn put_document_held(
            &self,
            doc: DocumentWrite,
            expect: Expect,
        ) -> Result<DocMeta, StoreError> {
            self.inner.put_document_held(doc, expect)
        }
        fn hold_document(&self, doc: &str, hash: &ContentHash) -> Result<bool, StoreError> {
            self.inner.hold_document(doc, hash)
        }
        fn unheld_documents(&self, collection: &str) -> Result<u64, StoreError> {
            self.inner.unheld_documents(collection)
        }
        fn delete_document(
            &self,
            id: &str,
            expect: Expect,
            envelope: Envelope,
        ) -> Result<Rev, StoreError> {
            self.inner.delete_document(id, expect, envelope)
        }
        fn get_document(
            &self,
            id: &str,
            reader: &ReaderFilter,
        ) -> Result<Option<Document>, StoreError> {
            self.inner.get_document(id, reader)
        }
        fn list_documents(
            &self,
            query: &ListQuery,
            reader: &ReaderFilter,
        ) -> Result<Page<DocMeta>, StoreError> {
            self.inner.list_documents(query, reader)
        }
        fn changes(
            &self,
            after: Rev,
            limit: u32,
            reader: &ReaderFilter,
            trace: Option<&str>,
        ) -> Result<Vec<Change>, StoreError> {
            self.inner.changes(after, limit, reader, trace)
        }
        fn head(&self) -> Result<Rev, StoreError> {
            self.inner.head()
        }
        fn put_record(
            &self,
            ns: &str,
            kind: &str,
            id: &str,
            body: Value,
            envelope: Envelope,
            expect: Expect,
        ) -> Result<RecordMeta, StoreError> {
            self.inner.put_record(ns, kind, id, body, envelope, expect)
        }
        fn get_record(
            &self,
            ns: &str,
            kind: &str,
            id: &str,
            reader: &ReaderFilter,
        ) -> Result<Option<Record>, StoreError> {
            self.inner.get_record(ns, kind, id, reader)
        }
        fn list_records(
            &self,
            ns: &str,
            kind: &str,
            after: Option<&str>,
            limit: u32,
            reader: &ReaderFilter,
        ) -> Result<Page<Record>, StoreError> {
            self.inner.list_records(ns, kind, after, limit, reader)
        }
        fn forget_record_history(&self, ns: &str, kind: &str, id: &str) -> Result<u64, StoreError> {
            self.inner.forget_record_history(ns, kind, id)
        }
        fn put_declared_record(
            &self,
            ns: &str,
            decl: &RecordDecl,
            id: &str,
            body: Value,
            envelope: Envelope,
            expect: Expect,
            lane: LaneWrite,
            writer: &ReaderFilter,
        ) -> Result<DeclaredPut, StoreError> {
            self.inner
                .put_declared_record(ns, decl, id, body, envelope, expect, lane, writer)
        }
        fn put_record_vector(
            &self,
            ns: &str,
            decl: &RecordDecl,
            id: &str,
            digest: &[u8; 32],
            model: &ModelId,
            vector: Vec<f32>,
        ) -> Result<bool, StoreError> {
            self.inner
                .put_record_vector(ns, decl, id, digest, model, vector)
        }
        fn read_record(
            &self,
            ns: &str,
            decl: &RecordDecl,
            id: &str,
            view: &StandingView,
            reader: &ReaderFilter,
        ) -> Result<Option<LaneRecord>, StoreError> {
            self.inner.read_record(ns, decl, id, view, reader)
        }
        fn find_records(
            &self,
            ns: &str,
            decl: &RecordDecl,
            query: &RecordFind,
            view: &StandingView,
            reader: &ReaderFilter,
        ) -> Result<FindPage, StoreError> {
            self.inner.find_records(ns, decl, query, view, reader)
        }
        fn match_records(
            &self,
            ns: &str,
            decl: &RecordDecl,
            query: &RecordMatch,
            vectors: Option<&MatchVectors>,
            view: &StandingView,
            reader: &ReaderFilter,
        ) -> Result<MatchPage, StoreError> {
            let mut page = self
                .inner
                .match_records(ns, decl, query, vectors, view, reader)?;
            if let Some(res) = page.results.first_mut() {
                res.nearest.push(MatchHit {
                    id: self.leaked_id.clone(),
                    rev: 1,
                    text: "secret".to_owned(),
                    flags: Vec::new(),
                    label: None,
                    words: Some(0.5),
                    meaning: vectors.map(|_| 0.5),
                    fused: Some(0.5),
                });
            }
            Ok(page)
        }
        fn decide_record(
            &self,
            ns: &str,
            decl: &RecordDecl,
            id: &str,
            decision: RecordDecision,
            view: &StandingView,
            reader: &ReaderFilter,
        ) -> Result<Decided, StoreError> {
            self.inner
                .decide_record(ns, decl, id, decision, view, reader)
        }
        fn mark_document_own(
            &self,
            mark: OwnMark,
            reader: &ReaderFilter,
        ) -> Result<Marked, StoreError> {
            self.inner.mark_document_own(mark, reader)
        }
        fn unmark_document_own(
            &self,
            doc: &str,
            at: &str,
            trace_id: Option<&str>,
            reader: &ReaderFilter,
        ) -> Result<Rev, StoreError> {
            self.inner.unmark_document_own(doc, at, trace_id, reader)
        }
        fn document_own(
            &self,
            doc: &str,
            view: &StandingView,
            reader: &ReaderFilter,
        ) -> Result<Option<OwnInfo>, StoreError> {
            self.inner.document_own(doc, view, reader)
        }
        fn reindex_records(
            &self,
            ns: &str,
            decl: &RecordDecl,
            scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
            embedder: Option<&dyn Embedder>,
            vectors_only: bool,
        ) -> Result<ReindexReport, StoreError> {
            self.inner
                .reindex_records(ns, decl, scan, embedder, vectors_only)
        }
        fn lane_status(&self, ns: &str, decl: &RecordDecl) -> Result<LaneStatus, StoreError> {
            self.inner.lane_status(ns, decl)
        }
    }

    struct StubEmbedder(ModelId);
    impl Embedder for StubEmbedder {
        fn model(&self) -> &ModelId {
            &self.0
        }
        fn dimensions(&self) -> usize {
            4
        }
        fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
            Ok(texts.iter().map(|_| vec![1.0, 0.0, 0.0, 0.0]).collect())
        }
    }

    #[test]
    fn evaluate_probes_counts_a_leaked_unreadable_hit_and_fails_the_gate() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("umbel.toml"),
            r#"
config_version = 6
default_space = "garden"
[spaces.garden]
person = "human:ada"
"#,
        )
        .unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let store_dir = dir.path().join("store");
        let sqlite = umbel_store_embedded::SqliteStore::open(
            &store_dir,
            "garden",
            umbel_store_embedded::StoreOptions::default(),
        )
        .unwrap();
        let decl = RecordDecl {
            kind: "note".to_owned(),
            standing: false,
            text: vec![Pointer::parse("/statement").unwrap()],
            keys: vec![],
            matched: Some(0),
        };
        let model = ModelId::parse("potion@0123456789abcdef").unwrap();
        let writer = ReaderFilter::tokens(["space", "principal:human:bo"]).unwrap();
        let mut env = umbel_store::conformance::samples::envelope(
            &["principal:human:bo"],
            "notes",
            "2026-11-22T00:00:00.000Z",
        );
        env.space = "garden".to_owned();
        sqlite
            .put_declared_record(
                "notes",
                &decl,
                "secret-bo",
                json!({ "statement": "Private note of bo." }),
                env,
                Expect::Absent,
                LaneWrite {
                    evidence: None,
                    flags: Vec::new(),
                    model: None,
                },
                &writer,
            )
            .unwrap();
        let leaking = LeakingStore {
            inner: sqlite,
            leaked_id: "secret-bo".to_owned(),
        };
        let probe = Probe {
            id: "p-01".to_owned(),
            text: "Private note of bo.".to_owned(),
            duplicates: vec!["secret-bo".to_owned()],
            self_id: None,
            reader: "human:ada".to_owned(),
        };
        let report = evaluate_probes(
            &leaking,
            &StubEmbedder(model),
            &workspace,
            &workspace.spaces()[0],
            "notes",
            &decl,
            0.5,
            5,
            &[probe],
            format!("sha256:{}", "a".repeat(64)),
            "2026-11-22T12:00:00.000Z".to_owned(),
        )
        .unwrap();
        assert_eq!(report.leaks, 1);
        assert!(!report.passed);
    }
}
