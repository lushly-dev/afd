//! The workspace doctor (specification section 2): the checks that need no registry. The plugin
//! checks that need only files (phase 1 specification, section 9.2) are here too.
//!
//! [`run`] reports a workspace that cannot be opened, such as one whose `umbel.toml` does not
//! parse. A sealed host adds the two registry-dependent checks (`mcp.surface`, `cli.verbs`) to
//! the report [`run`] builds, where this module reports them as `skip`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use afd::{CommandError, CommandResult, ResultOptions, Warning};
use serde::Serialize;
use serde_json::{Value, json};

use crate::plugins::CompiledCatalog;
use crate::workspace::{
    ConfigFile, FoundBy, Layout, Located, RootProblem, SpaceId, WorkspaceError, codes,
    discover_from_process, read_key, read_token, resolve_root, take_lock,
};

/// The message of a check that needs a sealed host.
pub const NEEDS_SEALED_HOST: &str =
    "Needs a sealed host; run umbel workspace doctor on a workspace that opens.";

const DEFAULT_LOCK_TIMEOUT_MS: u64 = 10_000;
const SLOW_LOCK: Duration = Duration::from_secs(1);
const MUTATION_KEY: &str = "dev.umbel/mutation";
const SPACE_KEY: &str = "dev.umbel/space";

/// The outcome of one check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    /// The check passed.
    Pass,
    /// Something needs attention; the workspace still works.
    Warn,
    /// The workspace is unhealthy.
    Fail,
    /// The check could not run here; it never makes a workspace unhealthy.
    Skip,
}

/// One check of the doctor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct Check {
    /// The check id, such as `config.parse`.
    pub id: String,
    /// The outcome.
    pub status: CheckStatus,
    /// What was found.
    pub message: String,
    /// What to do about a `warn` or `fail`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

impl Check {
    fn new(
        id: &str,
        status: CheckStatus,
        message: impl Into<String>,
        suggestion: Option<&str>,
    ) -> Self {
        Self {
            id: id.to_owned(),
            status,
            message: message.into(),
            suggestion: suggestion.map(str::to_owned),
        }
    }

    /// A passing check.
    pub fn pass(id: &str, message: impl Into<String>) -> Self {
        Self::new(id, CheckStatus::Pass, message, None)
    }

    /// A warning with its suggestion.
    pub fn warn(id: &str, message: impl Into<String>, suggestion: &str) -> Self {
        Self::new(id, CheckStatus::Warn, message, Some(suggestion))
    }

    /// A failure with its suggestion.
    pub fn fail(id: &str, message: impl Into<String>, suggestion: &str) -> Self {
        Self::new(id, CheckStatus::Fail, message, Some(suggestion))
    }

    /// A check that needs a sealed host.
    pub fn skip_sealed(id: &str) -> Self {
        Self::new(id, CheckStatus::Skip, NEEDS_SEALED_HOST, None)
    }

    pub(crate) fn skip(id: &str, message: &str) -> Self {
        Self::new(id, CheckStatus::Skip, message, None)
    }

    /// A check that could not run here, with what to do to run it.
    pub(crate) fn skip_with(id: &str, message: &str, suggestion: &str) -> Self {
        Self::new(id, CheckStatus::Skip, message, Some(suggestion))
    }
}

/// The doctor's report. Build more checks into `checks` to extend it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// The workspace directory; `None` when none was found.
    pub workspace: Option<PathBuf>,
    /// The rule that found it.
    pub found_by: Option<FoundBy>,
    /// The checks, in the specification's order.
    pub checks: Vec<Check>,
}

impl Report {
    /// Whether no check failed. A skipped check never makes a workspace unhealthy.
    pub fn healthy(&self) -> bool {
        self.checks
            .iter()
            .all(|check| check.status != CheckStatus::Fail)
    }

    /// The `data` object of `workspace-doctor`.
    pub fn data(&self) -> Value {
        json!({
            "workspace": self.workspace.as_ref().map(|path| path.display().to_string()),
            "foundBy": self.found_by,
            "healthy": self.healthy(),
            "checks": self.checks,
        })
    }

    /// The result of `workspace-doctor`: a success with one warning per `warn` check (code
    /// `DOCTOR_<ID>`), or the failure `WORKSPACE_UNHEALTHY` carrying the same object as
    /// `details` and the first failing check's suggestion.
    pub fn into_result(self) -> CommandResult<Value> {
        let data = self.data();
        let first_failure = self
            .checks
            .iter()
            .find(|check| check.status == CheckStatus::Fail);
        if let Some(failed) = first_failure {
            let details: HashMap<String, Value> = match &data {
                Value::Object(map) => map.clone().into_iter().collect(),
                _ => HashMap::new(),
            };
            let error = CommandError::new(
                codes::WORKSPACE_UNHEALTHY,
                format!(
                    "The workspace is unhealthy: {} ({})",
                    failed.message, failed.id
                ),
            )
            .with_suggestion(failed.suggestion.clone().unwrap_or_default())
            .with_details(details);
            return afd::failure(error);
        }
        let warnings: Vec<Warning> = self
            .checks
            .iter()
            .filter(|check| check.status == CheckStatus::Warn)
            .map(|check| {
                let code = format!("DOCTOR_{}", check.id.replace('.', "_").to_uppercase());
                Warning::new(code, &check.message)
            })
            .collect();
        let mut options = ResultOptions::default();
        if !warnings.is_empty() {
            options.warnings = Some(warnings);
        }
        afd::success_with(data, options)
    }
}

/// Inspect the workspace at `path` as if `--workspace` named it. Needs no registry and no
/// sealed host, so it reports a workspace that cannot be opened.
pub fn run(path: impl AsRef<Path>) -> Report {
    run_with(path.as_ref(), None)
}

/// [`run`] with the compiled plugins of the host binary, so a `compiled:<id>` source resolves
/// instead of being skipped.
pub fn run_with_catalog(path: impl AsRef<Path>, catalog: &CompiledCatalog) -> Report {
    run_with(path.as_ref(), Some(catalog))
}

fn run_with(path: &Path, catalog: Option<&CompiledCatalog>) -> Report {
    let root = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let located = if Layout::new(&root).config_file().is_file() {
        Ok(Located {
            root,
            found_by: FoundBy::Flag,
        })
    } else {
        Err(WorkspaceError::not_found(format!(
            "{} holds no umbel.toml",
            root.display()
        )))
    };
    inspect_with_catalog(located, catalog)
}

/// Inspect the workspace the process finds: `flag`, else `UMBEL_WORKSPACE`, else a search upward
/// from the current directory.
pub fn run_discovered(flag: Option<&Path>) -> Report {
    inspect(discover_from_process(flag))
}

/// [`run_discovered`] with the compiled plugins of the host binary.
pub fn run_discovered_with_catalog(flag: Option<&Path>, catalog: &CompiledCatalog) -> Report {
    inspect_with_catalog(discover_from_process(flag), Some(catalog))
}

/// Inspect the outcome of workspace discovery.
pub fn inspect(located: Result<Located, WorkspaceError>) -> Report {
    inspect_with_catalog(located, None)
}

/// [`inspect`] with the compiled plugins of the host binary, when there is a binary to ask.
pub fn inspect_with_catalog(
    located: Result<Located, WorkspaceError>,
    catalog: Option<&CompiledCatalog>,
) -> Report {
    let located = match located {
        Ok(located) => located,
        Err(error) => {
            return Report {
                workspace: None,
                found_by: None,
                checks: vec![Check::fail(
                    "workspace.found",
                    error.message(),
                    error.suggestion(),
                )],
            };
        }
    };
    let layout = Layout::new(&located.root);
    let mut checks = vec![Check::pass(
        "workspace.found",
        format!(
            "Found {} (by {})",
            located.root.display(),
            located.found_by.as_str()
        ),
    )];

    let (file, parse_check) = config_parse(&layout, &located.root);
    checks.push(parse_check);
    let scan = file.as_ref().map(ConfigFile::scan_keys);
    checks.push(config_keys(scan.as_ref()));
    let spaces = file.as_ref().map(ConfigFile::spaces);
    checks.push(spaces_valid(spaces.as_ref()));
    checks.push(collections_roots(file.as_ref(), &located.root));
    let space_ids: Vec<SpaceId> = match &spaces {
        Some(Ok((spaces, _))) => spaces.iter().map(|space| space.id.clone()).collect(),
        _ => Vec::new(),
    };
    let lock_timeout_ms = file
        .as_ref()
        .and_then(|file| file.clone().into_config(&located.root).ok())
        .map_or(DEFAULT_LOCK_TIMEOUT_MS, |config| {
            config.journal.lock_timeout_ms
        });

    checks.push(state_writable(&layout, &space_ids));
    checks.push(state_lock(&layout, lock_timeout_ms));
    checks.push(keys_present(&layout));
    let journal = read_journal(&layout.journal_file());
    checks.push(journal_readable(&journal));
    checks.push(events_consistent(&layout, spaces.as_ref(), &journal));
    checks.push(http_config(file.as_ref()));
    checks.push(Check::skip_sealed("mcp.surface"));
    checks.push(Check::skip_sealed("cli.verbs"));
    checks.extend(crate::plugins::doctor_checks(
        file.as_ref(),
        &located.root,
        catalog,
    ));
    Report {
        workspace: Some(located.root),
        found_by: Some(located.found_by),
        checks,
    }
}

pub(crate) const NEEDS_CONFIG: &str = "Needs a readable umbel.toml; config.parse failed.";

fn config_parse(layout: &Layout, root: &Path) -> (Option<ConfigFile>, Check) {
    let text = match fs::read_to_string(layout.config_file()) {
        Ok(text) => text,
        Err(error) => {
            return (
                None,
                Check::fail(
                    "config.parse",
                    format!("umbel.toml cannot be read: {error}"),
                    "Make umbel.toml readable by this user.",
                ),
            );
        }
    };
    let file = match ConfigFile::parse(&text) {
        Ok(file) => file,
        Err(error) => {
            return (
                None,
                Check::fail("config.parse", error.message(), error.suggestion()),
            );
        }
    };
    let check = match file.validate_rest(root) {
        Ok(()) => Check::pass(
            "config.parse",
            format!("umbel.toml is configuration version {}", file.version()),
        ),
        Err(error) => Check::fail("config.parse", error.message(), error.suggestion()),
    };
    (Some(file), check)
}

fn config_keys(scan: Option<&crate::workspace::KeyScan>) -> Check {
    let Some(scan) = scan else {
        return Check::skip("config.keys", NEEDS_CONFIG);
    };
    if !scan.unknown.is_empty() {
        return Check::fail(
            "config.keys",
            format!("Unknown keys: {}", scan.unknown.join(", ")),
            "Remove or correct the unknown keys in umbel.toml; this version reads configuration versions 1, 2 and 3.",
        );
    }
    if !scan.reserved.is_empty() {
        return Check::warn(
            "config.keys",
            format!(
                "Reserved keys are set and unused: {}",
                scan.reserved.join(", ")
            ),
            "Remove the reserved keys until the phase that defines them.",
        );
    }
    Check::pass("config.keys", "Every key is known and unreserved")
}

type SpaceRules = Result<(Vec<crate::workspace::SpaceConfig>, SpaceId), WorkspaceError>;

fn spaces_valid(spaces: Option<&SpaceRules>) -> Check {
    match spaces {
        None => Check::skip("spaces.valid", NEEDS_CONFIG),
        Some(Err(error)) => Check::fail("spaces.valid", error.message(), error.suggestion()),
        Some(Ok((spaces, default))) => Check::pass(
            "spaces.valid",
            format!("{} space(s); default space {default}", spaces.len()),
        ),
    }
}

/// `collections.roots` (phase 2 specification, section 3.5): each declared collection root
/// exists, is a directory and is inside the workspace.
fn collections_roots(file: Option<&ConfigFile>, workspace: &Path) -> Check {
    let Some(file) = file else {
        return Check::skip("collections.roots", NEEDS_CONFIG);
    };
    let collections = match file.collections() {
        Ok(collections) => collections,
        Err(error) => {
            return Check::skip(
                "collections.roots",
                &format!("The collections cannot be read: {}", error.message()),
            );
        }
    };
    if collections.is_empty() {
        return Check::pass("collections.roots", "No collections are declared");
    }
    for (space, collection) in &collections {
        let problem = match resolve_root(workspace, &collection.root) {
            Ok(_) => continue,
            Err(RootProblem::Missing) => "does not exist",
            Err(RootProblem::NotADirectory) => "is not a directory",
            Err(RootProblem::Outside) => "resolves outside the workspace",
        };
        return Check::fail(
            "collections.roots",
            format!(
                "The root `{}` of collection `{}` in space `{space}` {problem}",
                collection.root, collection.id
            ),
            &format!(
                "Create the directory, or fix spaces.{space}.collections.{}.root in umbel.toml: a root is a directory inside the workspace.",
                collection.id
            ),
        );
    }
    Check::pass(
        "collections.roots",
        format!(
            "{} collection root(s) exist inside the workspace",
            collections.len()
        ),
    )
}

/// Whether a file could be created at `path` (or, when its directories are missing, at the
/// first ancestor that exists), by creating and removing a probe file.
fn writable(path: &Path) -> Result<(), String> {
    let dir = path.ancestors().find(|dir| dir.is_dir()).unwrap_or(path);
    if !path.is_dir() && path.exists() {
        return Err(format!("{} exists and is not a directory", path.display()));
    }
    let probe = dir.join(format!(".umbel-probe-{}", std::process::id()));
    match fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            Ok(())
        }
        Err(error) => Err(format!("{} is not writable: {error}", dir.display())),
    }
}

fn state_writable(layout: &Layout, spaces: &[SpaceId]) -> Check {
    let mut targets = vec![layout.state_dir()];
    targets.extend(spaces.iter().map(|space| layout.space_state_dir(space)));
    for target in &targets {
        if let Err(problem) = writable(target) {
            return Check::fail(
                "state.writable",
                problem,
                &format!(
                    "Make {} writable by this user, or point --workspace at a workspace you can write.",
                    layout.state_dir().display()
                ),
            );
        }
    }
    Check::pass(
        "state.writable",
        "state/ and each space's state directory are writable or can be created",
    )
}

fn state_lock(layout: &Layout, timeout_ms: u64) -> Check {
    if !layout.state_dir().is_dir() {
        return Check::pass(
            "state.lock",
            "state/ does not exist yet; the lock is created when the workspace opens",
        );
    }
    let started = Instant::now();
    match take_lock(layout, timeout_ms) {
        Ok(lock) => {
            drop(lock);
            let waited = started.elapsed();
            if waited > SLOW_LOCK {
                Check::warn(
                    "state.lock",
                    format!(
                        "Taking the workspace lock waited {} ms; another process held it",
                        waited.as_millis()
                    ),
                    "Another umbel process is running a long operation; retry, or run umbel workspace doctor again when it finishes.",
                )
            } else {
                Check::pass("state.lock", "The workspace lock was taken and released")
            }
        }
        Err(error) => Check::fail("state.lock", error.message(), error.suggestion()),
    }
}

fn permissions_wider_than_owner(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|meta| meta.permissions().mode() & 0o077 != 0)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

fn keys_present(layout: &Layout) -> Check {
    const SUGGESTION_DELETE: &str = "Delete the file; the next open creates a new key.";
    let keys_creatable = writable(&layout.keys_dir());
    let mut wide = Vec::new();
    let mut notes = Vec::new();
    for (name, path) in [
        ("approval.key", layout.approval_key()),
        ("confirmation.key", layout.confirmation_key()),
    ] {
        if path.exists() {
            if let Err(error) = read_key(&path) {
                return Check::fail("keys.present", error.message(), SUGGESTION_DELETE);
            }
            if permissions_wider_than_owner(&path) {
                wide.push(name);
            }
        } else if let Err(problem) = &keys_creatable {
            return Check::fail(
                "keys.present",
                format!("{name} is missing and cannot be created: {problem}"),
                "Make state/keys writable by this user.",
            );
        } else {
            notes.push(format!("{name} will be created at open"));
        }
    }
    let token = layout.http_token();
    if token.exists() {
        if let Err(error) = read_token(&token) {
            return Check::fail("keys.present", error.message(), SUGGESTION_DELETE);
        }
        if permissions_wider_than_owner(&token) {
            wide.push("http.token");
        }
    }
    if !wide.is_empty() {
        return Check::warn(
            "keys.present",
            format!("Wider permissions than 0600: {}", wide.join(", ")),
            "Run chmod 600 on the key files.",
        );
    }
    let detail = if notes.is_empty() {
        String::new()
    } else {
        format!(" ({})", notes.join("; "))
    };
    Check::pass(
        "keys.present",
        format!("The approval and confirmation keys are in order{detail}"),
    )
}

/// What the journal file holds.
struct JournalRead {
    entries: Vec<afd::JournalEntry>,
    bytes: usize,
    torn: bool,
    error: Option<String>,
}

fn read_journal(path: &Path) -> JournalRead {
    let mut read = JournalRead {
        entries: Vec::new(),
        bytes: 0,
        torn: false,
        error: None,
    };
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return read,
        Err(error) => {
            read.error = Some(format!("{} cannot be read: {error}", path.display()));
            return read;
        }
    };
    read.bytes = text.len();
    match afd::parse_journal(&text) {
        Ok(entries) => read.entries = entries,
        Err(error) => {
            // An append in flight, or a crash mid-append, leaves a last line with no newline.
            let complete = text.rfind('\n').map_or("", |end| &text[..=end]);
            match (text.ends_with('\n'), afd::parse_journal(complete)) {
                (false, Ok(entries)) => {
                    read.entries = entries;
                    read.torn = true;
                }
                _ => read.error = Some(error),
            }
        }
    }
    read
}

fn journal_readable(journal: &JournalRead) -> Check {
    if let Some(error) = &journal.error {
        return Check::fail(
            "journal.readable",
            error.clone(),
            "Repair or remove the unparsable line in state/journal.jsonl; AFD journals are JSON Lines.",
        );
    }
    let last = journal.entries.last().map_or(0, |entry| entry.seq);
    let summary = format!(
        "{} entries, last seq {last}, {} bytes",
        journal.entries.len(),
        journal.bytes
    );
    if journal.torn {
        return Check::warn(
            "journal.readable",
            format!("{summary}; the last line is torn"),
            "The next append repairs a torn last line; no action is needed unless no process is running.",
        );
    }
    Check::pass("journal.readable", summary)
}

fn stream_dirs(layout: &Layout, spaces: Option<&SpaceRules>) -> Vec<SpaceId> {
    if let Some(Ok((spaces, _))) = spaces {
        return spaces.iter().map(|space| space.id.clone()).collect();
    }
    let Ok(read) = fs::read_dir(layout.space_states_dir()) else {
        return Vec::new();
    };
    let mut ids: Vec<SpaceId> = read
        .flatten()
        .filter_map(|entry| SpaceId::parse(&entry.file_name().to_string_lossy()).ok())
        .collect();
    ids.sort();
    ids
}

fn events_consistent(layout: &Layout, spaces: Option<&SpaceRules>, journal: &JournalRead) -> Check {
    const REBUILD: &str = "Run umbel event rebuild to rebuild the streams from the journal.";
    let mut held: BTreeMap<SpaceId, BTreeSet<u64>> = BTreeMap::new();
    let mut torn = Vec::new();
    let mut total = 0usize;
    for space in stream_dirs(layout, spaces) {
        let path = layout.events_file(&space);
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                held.insert(space, BTreeSet::new());
                continue;
            }
            Err(error) => {
                return Check::fail(
                    "events.consistent",
                    format!("{} cannot be read: {error}", path.display()),
                    REBUILD,
                );
            }
        };
        let lines: Vec<&str> = text.split('\n').collect();
        let last_index = lines.len() - 1;
        let mut seen = BTreeSet::new();
        let (mut expect_seq, mut last_journal) = (1u64, 0u64);
        for (index, line) in lines.iter().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let parsed: Option<(u64, u64)> =
                serde_json::from_str::<Value>(line).ok().and_then(|value| {
                    Some((
                        value.get("seq")?.as_u64()?,
                        value.get("journalSeq")?.as_u64()?,
                    ))
                });
            let Some((seq, journal_seq)) = parsed else {
                // The final segment has no newline after it: an append in flight.
                if index == last_index {
                    torn.push(space.to_string());
                    continue;
                }
                return Check::fail(
                    "events.consistent",
                    format!("{} line {} is not an event", path.display(), index + 1),
                    REBUILD,
                );
            };
            if seq != expect_seq || journal_seq <= last_journal {
                return Check::fail(
                    "events.consistent",
                    format!(
                        "{} line {}: seq {seq} (expected {expect_seq}) and journalSeq {journal_seq} (after {last_journal}) are out of order",
                        path.display(),
                        index + 1
                    ),
                    REBUILD,
                );
            }
            expect_seq += 1;
            last_journal = journal_seq;
            total += 1;
            seen.insert(journal_seq);
        }
        held.insert(space, seen);
    }

    let mut behind = 0usize;
    if journal.error.is_none() {
        for entry in &journal.entries {
            let Some(metadata) = entry
                .result
                .metadata
                .as_ref()
                .filter(|_| entry.result.success)
            else {
                continue;
            };
            if metadata.extra.get(MUTATION_KEY) != Some(&Value::Bool(true)) {
                continue;
            }
            let Some(space) = metadata.extra.get(SPACE_KEY).and_then(Value::as_str) else {
                continue;
            };
            if let Some(seen) = SpaceId::parse(space).ok().and_then(|id| held.get(&id))
                && !seen.contains(&entry.seq)
            {
                behind += 1;
            }
        }
    }
    let marker = layout.pending_marker().exists();
    if marker || behind > 0 || !torn.is_empty() {
        let mut why = Vec::new();
        if marker {
            why.push("projection.pending is present".to_owned());
        }
        if behind > 0 {
            why.push(format!("{behind} journal mutation(s) have no event"));
        }
        if !torn.is_empty() {
            why.push(format!("the last line of {} is torn", torn.join(", ")));
        }
        return Check::warn("events.consistent", why.join("; "), REBUILD);
    }
    Check::pass(
        "events.consistent",
        format!(
            "{total} event(s) in {} stream(s), caught up with the journal",
            held.len()
        ),
    )
}

fn http_config(file: Option<&ConfigFile>) -> Check {
    match file.map(ConfigFile::http) {
        None => Check::skip("http.config", NEEDS_CONFIG),
        Some(Err(error)) => Check::fail("http.config", error.message(), error.suggestion()),
        Some(Ok(http)) => Check::pass(
            "http.config",
            format!("Binds {} at {}", http.bind, http.path),
        ),
    }
}
