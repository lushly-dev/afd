//! The doctor's plugin checks that need only files (specification section 9.2).
//!
//! `plugins.config`, `plugins.sources`, `plugins.grants`, `plugins.packs` and `plugins.skills`
//! read `umbel.toml` and the plugin directories; they compile nothing, spawn nothing and need
//! no sealed host. `plugins.loaded`, `plugins.first_class`, `plugins.pipelines`,
//! `plugins.pack_checks` and `plugins.config_checks` need the loader, so they are `skip` until a
//! sealed host fills them in.
//!
//! A `compiled:<id>` source resolves only against the binary's catalog. A doctor run with no
//! catalog reports such an instance as `skip`, never as `fail`.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;
use tokio::time::{Instant, timeout_at};

use super::error::PluginError;
use super::files::DirFiles;
use super::loader::{LoadedPlugins, Status, TRUST_NOTE};
use super::manifest::{Bearer, Manifest, PluginKind, Transport};
use super::packs::{PackOrigin, check_pack};
use super::pipelines::PipelineState;
use super::skills::check_skill;
use super::source::{CompiledCatalog, ResolvedSource, resolve_source};
use crate::doctor::{Check, NEEDS_CONFIG};
use crate::surfaces::FirstClassPlan;
use crate::workspace::{ConfigFile, PluginInstance, SpaceId};
use afd::server::MAX_FIRST_CLASS_TOOLS;

const NEEDS_PLUGIN_CONFIG: &str = "Needs a valid plugin configuration; plugins.config failed.";

/// What reading one instance's source found.
enum Found {
    Manifest {
        manifest: Box<Manifest>,
        /// The plugin directory, for a directory source; a compiled plugin's files are assets.
        dir: Option<DirFiles>,
    },
    /// A compiled source with no catalog to check.
    Unresolved,
    Failed {
        error: PluginError,
        /// Whether the manifest read, and is an HTTP mount: such an instance is optional by
        /// default even when it fails.
        http_mount: bool,
    },
}

struct Loaded<'a> {
    instance: &'a PluginInstance,
    found: Found,
}

impl Loaded<'_> {
    fn manifest(&self) -> Option<&Manifest> {
        match &self.found {
            Found::Manifest { manifest, .. } => Some(manifest),
            _ => None,
        }
    }

    /// `required` defaults to true, and to false for an HTTP mount (section 6.3).
    fn required(&self) -> bool {
        let http = match &self.found {
            Found::Manifest { manifest, .. } => manifest.is_http_mount(),
            Found::Failed { http_mount, .. } => *http_mount,
            Found::Unresolved => false,
        };
        self.instance.required.unwrap_or(!http)
    }
}

/// A problem found in one instance, and whether it stops the host.
struct Issue {
    fatal: bool,
    message: String,
    suggestion: String,
}

impl Issue {
    fn new(instance: &str, fatal: bool, error: &PluginError) -> Self {
        Self {
            fatal,
            message: format!("{instance}: {}: {}", error.code(), error.message()),
            suggestion: error.suggestion().to_owned(),
        }
    }
}

/// `plugins.loaded` on a sealed host (section 9.2): every instance loaded, with its kind and
/// counts; `warn` when an optional instance failed. A required failure never gets here: it stops
/// the host from opening.
pub(crate) fn loaded_check(loaded: &LoadedPlugins) -> Check {
    if loaded.instances.is_empty() {
        return Check::pass("plugins.loaded", "No plugins are enabled");
    }
    let mut parts = Vec::new();
    let mut failures = Vec::new();
    let mut trusted = Vec::new();
    let mut notes = Vec::new();
    for instance in &loaded.instances {
        match &instance.status {
            Status::Loaded => {
                let kind = instance
                    .kind()
                    .map_or_else(String::new, |kind| kind.to_string());
                parts.push(format!(
                    "{} ({kind}, {} command(s))",
                    instance.id,
                    instance.commands.len()
                ));
                if instance.kind() == Some(PluginKind::Compiled) {
                    trusted.push(instance.id.clone());
                }
                if let Some(mount) = &instance.mount {
                    for skipped in &mount.skipped {
                        notes.push(format!(
                            "{}: the tool `{}` was skipped ({}: {})",
                            instance.id, skipped.tool, skipped.code, skipped.message
                        ));
                    }
                    for warning in &mount.warnings {
                        notes.push(format!(
                            "{}: the tool `{}` has a {} match (`description-injection`, {})",
                            instance.id, warning.tool, warning.pattern, warning.location
                        ));
                    }
                }
            }
            Status::Failed(error) => failures.push(format!(
                "{} failed to load: {}: {}",
                instance.id,
                error.code(),
                error.message()
            )),
        }
    }
    let mut message = format!("{} instance(s) loaded: {}", parts.len(), parts.join(", "));
    if !trusted.is_empty() {
        message.push_str(&format!(
            "; compiled instance(s) {} are {TRUST_NOTE}: grants are a declaration, not a sandbox",
            trusted.join(", ")
        ));
    }
    failures.extend(notes);
    if failures.is_empty() {
        Check::pass("plugins.loaded", message)
    } else {
        Check::warn(
            "plugins.loaded",
            format!("{message}; {}", failures.join("; ")),
            "Fix the failing optional instance, or run umbel plugin show plugin=<id>.",
        )
    }
}

/// `plugins.first_class` on a sealed host (section 9.2): the plugins' suggestions fit the cap.
pub(crate) fn first_class_check(plan: &FirstClassPlan) -> Check {
    if plan.explicit {
        let message = if plan.suggested.is_empty() {
            "mcp.first_class_tools is set; no plugin suggests a first-class tool".to_owned()
        } else {
            format!(
                "mcp.first_class_tools is set and wins; the plugins' suggestions ({}) are not used",
                plan.suggested.join(", ")
            )
        };
        return Check::pass("plugins.first_class", message);
    }
    if plan.dropped.is_empty() {
        return Check::pass(
            "plugins.first_class",
            format!(
                "{} plugin suggestion(s) fit the first-class set ({})",
                plan.suggested.len(),
                plan.tools.join(", ")
            ),
        );
    }
    Check::warn(
        "plugins.first_class",
        format!(
            "the cap of {} first-class tools dropped {} suggestion(s): {}",
            MAX_FIRST_CLASS_TOOLS,
            plan.dropped.len(),
            plan.dropped.join(", ")
        ),
        "Set mcp.first_class_tools to choose the set, or ask the plugin to suggest fewer.",
    )
}

/// `plugins.pipelines` on a sealed host (section 9.2): every pipeline is registered.
pub(crate) fn pipelines_check(loaded: &LoadedPlugins) -> Check {
    let mut registered = 0;
    let mut skipped = Vec::new();
    for instance in &loaded.instances {
        for plan in &instance.pipelines {
            match &plan.state {
                PipelineState::Registered => registered += 1,
                PipelineState::Skipped(reason) => skipped.push(format!(
                    "{}: `{}` is not registered: {reason}",
                    instance.id, plan.name
                )),
            }
        }
    }
    if skipped.is_empty() {
        return Check::pass(
            "plugins.pipelines",
            format!("{registered} pipeline(s) registered"),
        );
    }
    Check::warn(
        "plugins.pipelines",
        skipped.join("; "),
        "Enable the plugin that provides the missing command, or fix the pipeline's steps.",
    )
}

/// How many of a failure's problems `plugins.pack_checks` and `plugins.config_checks` show.
const SHOWN_PROBLEMS: usize = 3;

/// `plugins.pack_checks` on a sealed host (D172, D223): every space override of a compiled
/// instance's pack, handed to the plugin's own check, the same reader its commands use, so the
/// codes match a call's exactly. A failure is `fail` for a required instance, `warn` for an
/// optional one or a retryable failure. An override whose plugin offers no check is counted, and
/// checked for its layout only (`plugins.packs`); space overrides of loaded component instances
/// are likewise counted and named in the check's message (whether it passes, warns or fails on a
/// compiled instance) as checked for layout only (components have no `check-pack` export until
/// WIT world 1.2.0, #1381). A check that panics is `fail` whatever its instance; one that gets
/// no turn of D204's bound, or does not finish, by `deadline` is `warn` (`run_plugin_check`).
pub(crate) async fn pack_checks_check(
    loaded: &LoadedPlugins,
    turns: &Arc<Semaphore>,
    deadline: Instant,
) -> Check {
    let checks = loaded
        .pack_checks
        .iter()
        .cloned()
        .map(|target| (Arc::clone(&target.in_flight), move || target.run()));
    let results = run_plugin_checks(checks, turns, deadline).await;
    let mut issues = Vec::new();
    let mut checked = 0;
    let mut unchecked = 0;
    for (target, result) in loaded.pack_checks.iter().zip(results) {
        let result = match result {
            Ok(result) => result,
            Err(failure) => {
                issues.push(failure.issue(format!(
                    "{}: the check of pack `{}` in space `{}`",
                    target.instance, target.pack, target.space
                )));
                continue;
            }
        };
        let Some(result) = result else {
            unchecked += 1;
            continue;
        };
        checked += 1;
        let subject = format!(
            "{}: the override of pack `{}` in space `{}` fails the plugin's check",
            target.instance, target.pack, target.space
        );
        issues.extend(plugin_issue(&result, target.required, subject, || {
            "Run a command of the plugin in that space for its own suggestion.".to_owned()
        }));
    }
    let mut component_overrides = 0usize;
    let mut component_instances = Vec::new();
    for instance in &loaded.instances {
        if instance.status != Status::Loaded || instance.kind() != Some(PluginKind::Component) {
            continue;
        }
        let overrides = instance
            .packs
            .iter()
            .flat_map(|(_, states)| states.iter())
            .filter(|state| state.origin == PackOrigin::Override)
            .count();
        if overrides > 0 {
            component_overrides += overrides;
            component_instances.push(instance.id.as_str());
        }
    }
    let mut pass = format!("{checked} override(s) pass their plugin's own check");
    if unchecked > 0 {
        pass.push_str(&format!(
            "; {unchecked} override(s) of plugins that offer no check are checked for layout only"
        ));
    }
    let mut check = verdict("plugins.pack_checks", pass, &issues, &[]);
    if component_overrides > 0 {
        check.message.push_str(&format!(
            "; {component_overrides} override(s) of component plugin(s) ({}) are checked for layout only (components have no check-pack export)",
            component_instances.join(", ")
        ));
    }
    check
}

/// `plugins.config_checks` on a sealed host (D206): each loaded compiled instance's configuration,
/// handed to the plugin's own check, which reads it as its commands do. A failure is `fail` for a
/// required instance, `warn` for an optional one or a retryable failure. An instance whose plugin
/// offers no check is counted, and its configuration was checked against its schema at open. A
/// check that panics is `fail` whatever its instance; one that gets no turn of D204's bound, or
/// does not finish, by `deadline` is `warn` (`run_plugin_check`).
pub(crate) async fn config_checks_check(
    loaded: &LoadedPlugins,
    turns: &Arc<Semaphore>,
    deadline: Instant,
) -> Check {
    let checks = loaded
        .config_checks
        .iter()
        .cloned()
        .map(|target| (Arc::clone(&target.in_flight), move || target.run()));
    let results = run_plugin_checks(checks, turns, deadline).await;
    let mut issues = Vec::new();
    let mut checked = 0;
    let mut unchecked = 0;
    for (target, result) in loaded.config_checks.iter().zip(results) {
        let result = match result {
            Ok(result) => result,
            Err(failure) => {
                issues.push(failure.issue(format!("{}: the configuration check", target.instance)));
                continue;
            }
        };
        let Some(result) = result else {
            unchecked += 1;
            continue;
        };
        checked += 1;
        let subject = format!(
            "{}: its configuration fails the plugin's check",
            target.instance
        );
        issues.extend(plugin_issue(&result, target.required, subject, || {
            format!(
                "Fix [plugins.{}.config] in umbel.toml, then run workspace-doctor again.",
                target.instance
            )
        }));
    }
    let mut pass = format!("{checked} instance(s) pass their plugin's configuration check");
    if unchecked > 0 {
        pass.push_str(&format!(
            "; {unchecked} instance(s) of plugins that offer no check are checked against their schema only"
        ));
    }
    verdict("plugins.config_checks", pass, &issues, &[])
}

/// The issue a plugin's own check answered, or `None` for a success: `subject`, then the
/// failure's code (`PLUGIN_RESULT_INVALID` when it names none), message and first problems, with
/// its suggestion or `fallback`'s. Fatal only for a required instance and a failure that is not
/// retryable.
fn plugin_issue(
    result: &serde_json::Value,
    required: bool,
    subject: String,
    fallback: impl FnOnce() -> String,
) -> Option<Issue> {
    if result.get("success").and_then(serde_json::Value::as_bool) == Some(true) {
        return None;
    }
    let error = result.get("error").cloned().unwrap_or_default();
    let text = |key: &str| {
        error
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let retryable = error
        .get("retryable")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let code = match text("code") {
        empty if empty.is_empty() => "PLUGIN_RESULT_INVALID".to_owned(),
        code => code,
    };
    let mut message = format!("{subject}: {code}: {}", text("message"));
    let problems = shown_problems(&error);
    if !problems.is_empty() {
        message.push_str(&format!(" ({problems})"));
    }
    let suggestion = match text("suggestion") {
        empty if empty.is_empty() => fallback(),
        given => given,
    };
    Some(Issue {
        fatal: required && !retryable,
        message,
        suggestion,
    })
}

// All targets share a report deadline. Keep results in loader order even when workers
// finish out of order, and cancel any pending work when the report is dropped.
async fn run_plugin_checks<T: Send + 'static>(
    checks: impl Iterator<Item = (Arc<Mutex<()>>, impl FnOnce() -> T + Send + 'static)>,
    turns: &Arc<Semaphore>,
    deadline: Instant,
) -> Vec<Result<T, PluginCheckFailure>> {
    let mut tasks = JoinSet::new();
    for (index, (in_flight, run)) in checks.enumerate() {
        let turns = Arc::clone(turns);
        tasks.spawn(async move {
            (
                index,
                run_plugin_check(turns, in_flight, deadline, run).await,
            )
        });
    }
    let mut results = tasks.join_all().await;
    results.sort_unstable_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, result)| result).collect()
}

/// Why a plugin's own check gave the doctor no result.
#[derive(Debug)]
enum PluginCheckFailure {
    /// No turn of D204's bound came free before the deadline: the check never ran.
    Busy,
    /// It ran and had not finished before the deadline, or finished at or after it.
    TimedOut,
    /// It panicked.
    Panicked,
    /// The host could not start its thread.
    Unavailable,
    /// An earlier report's run of the same check was still going at the deadline.
    AlreadyRunning,
}

impl PluginCheckFailure {
    /// The issue for `subject`, logged: fatal for a panic whatever the instance, else a warning.
    fn issue(&self, subject: String) -> Issue {
        let message = format!("{subject} {}", self.message());
        tracing::warn!(check = %message, "a plugin's own doctor check gave no result");
        Issue {
            fatal: matches!(self, Self::Panicked),
            message,
            suggestion: self.suggestion().to_owned(),
        }
    }

    fn message(&self) -> &'static str {
        match self {
            Self::Busy => "got no turn before its deadline (limits.compiled_calls)",
            Self::TimedOut => "did not finish before its deadline (limits.compiled_timeout_ms)",
            Self::Panicked => "panicked",
            Self::Unavailable => "could not start a thread",
            Self::AlreadyRunning => "is still running from an earlier doctor report",
        }
    }

    fn suggestion(&self) -> &'static str {
        match self {
            Self::Busy => {
                "Run workspace-doctor again once the plugin calls under way finish, or raise limits.compiled_calls."
            }
            Self::TimedOut => {
                "Run workspace-doctor again; if it repeats, raise limits.compiled_timeout_ms or report the slow check to the plugin's author."
            }
            Self::Panicked => {
                "Run the plugin's commands to see whether they fail too, and report the panic to the plugin's author."
            }
            Self::Unavailable => "Free system resources, then run workspace-doctor again.",
            Self::AlreadyRunning => {
                "Run workspace-doctor again once the earlier report's check finishes; if it never does, restart the host and report the hang to the plugin's author."
            }
        }
    }
}

/// Run one plugin check under D204's bound (`turns`) by `deadline`. An earlier report's run of the
/// same check (`in_flight`) is waited for within the deadline, so two reports never run it at once
/// and a report beside another still gets its result.
async fn run_plugin_check<T: Send + 'static>(
    turns: Arc<Semaphore>,
    in_flight: Arc<Mutex<()>>,
    deadline: Instant,
    run: impl FnOnce() -> T + Send + 'static,
) -> Result<T, PluginCheckFailure> {
    let running = timeout_at(deadline, in_flight.lock_owned())
        .await
        .map_err(|_| PluginCheckFailure::AlreadyRunning)?;
    let turn = timeout_at(deadline, turns.acquire_owned())
        .await
        .map_err(|_| PluginCheckFailure::Busy)?
        .map_err(|_| PluginCheckFailure::Unavailable)?;
    // A turn that came at the deadline came too late: the check does not start.
    if Instant::now() >= deadline {
        return Err(PluginCheckFailure::Busy);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let runtime = tokio::runtime::Handle::current();
    // A synchronous plugin hook cannot be stopped and can keep running after the report returns.
    // Its thread keeps the turn and the in-flight lock until the hook exits, and stays outside
    // Tokio's shutdown wait.
    std::thread::Builder::new()
        .name("umbel-doctor-check".into())
        .spawn(move || {
            let _runtime = runtime.enter();
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(run)).map_err(|_| ());
            let finished = Instant::now();
            drop(running);
            drop(turn);
            if send.send((result, finished)).is_err() {
                tracing::warn!(
                    "a plugin's own doctor check finished after its report; its result was dropped"
                );
            }
        })
        .map_err(|_| PluginCheckFailure::Unavailable)?;
    match timeout_at(deadline, receive).await {
        Ok(Ok((result, finished))) => settled(result, finished, deadline),
        // The thread ended without answering: it died unwinding.
        Ok(Err(_)) => Err(PluginCheckFailure::Panicked),
        Err(_) => Err(PluginCheckFailure::TimedOut),
    }
}

/// A finished check's result: a panic is one whenever it came, and a result finished at or after
/// the deadline is late even when the report sees it before its timer (as D204's calls are).
fn settled<T>(
    result: Result<T, ()>,
    finished: Instant,
    deadline: Instant,
) -> Result<T, PluginCheckFailure> {
    let result = result.map_err(|()| PluginCheckFailure::Panicked)?;
    if finished >= deadline {
        return Err(PluginCheckFailure::TimedOut);
    }
    Ok(result)
}

/// The first problems of a failure's `details.problems`, each `CODE path#at` (`CODE at` with no
/// path), and how many more.
fn shown_problems(error: &serde_json::Value) -> String {
    let Some(problems) = error
        .get("details")
        .and_then(|details| details.get("problems"))
        .and_then(serde_json::Value::as_array)
    else {
        return String::new();
    };
    let field = |problem: &serde_json::Value, key: &str| {
        problem
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    };
    let mut shown: Vec<String> = problems
        .iter()
        .take(SHOWN_PROBLEMS)
        .map(|problem| {
            let code = field(problem, "code").unwrap_or_default();
            match (field(problem, "path"), field(problem, "at")) {
                (Some(path), Some(at)) => format!("{code} {path}#{at}"),
                (Some(path), None) => format!("{code} {path}"),
                // A configuration problem has a pointer into the configuration and no file.
                (None, Some(at)) => format!("{code} {at}"),
                (None, None) => code,
            }
        })
        .collect();
    let count = error
        .get("details")
        .and_then(|details| details.get("count"))
        .and_then(serde_json::Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .unwrap_or(problems.len())
        .max(problems.len());
    if count > shown.len() {
        shown.push(format!("and {} more", count - shown.len()));
    }
    shown.join(", ")
}

/// The ten plugin checks, in order.
pub(crate) fn checks(
    file: Option<&ConfigFile>,
    root: &Path,
    catalog: Option<&CompiledCatalog>,
) -> Vec<Check> {
    let sealed = || {
        [
            Check::skip_sealed("plugins.loaded"),
            Check::skip_sealed("plugins.first_class"),
            Check::skip_sealed("plugins.pipelines"),
            Check::skip_sealed("plugins.pack_checks"),
            Check::skip_sealed("plugins.config_checks"),
        ]
    };
    let dependent = |message: &str| {
        [
            "plugins.sources",
            "plugins.grants",
            "plugins.packs",
            "plugins.skills",
        ]
        .map(|id| Check::skip(id, message))
    };
    let Some(file) = file else {
        let mut all = vec![Check::skip("plugins.config", NEEDS_CONFIG)];
        all.extend(dependent(NEEDS_CONFIG));
        all.extend(sealed());
        return all;
    };
    let config = match file.plugins() {
        Ok(config) => config,
        Err(error) => {
            let mut all = vec![Check::fail(
                "plugins.config",
                error.message(),
                error.suggestion(),
            )];
            all.extend(dependent(NEEDS_PLUGIN_CONFIG));
            all.extend(sealed());
            return all;
        }
    };
    let declared: Vec<SpaceId> = file
        .spaces()
        .map(|(spaces, _)| spaces.into_iter().map(|space| space.id).collect())
        .unwrap_or_default();
    let loaded: Vec<Loaded<'_>> = config
        .instances
        .iter()
        .map(|instance| Loaded {
            instance,
            found: load(root, instance, catalog),
        })
        .collect();

    let summary = if loaded.is_empty() {
        "No plugins are enabled".to_owned()
    } else {
        format!(
            "{} plugin instance(s): {}",
            loaded.len(),
            config.enabled.join(", ")
        )
    };
    let mut all = vec![
        Check::pass("plugins.config", summary),
        sources(&loaded),
        grants(&loaded),
        packs(root, &loaded, &declared),
        skills(&loaded),
    ];
    all.extend(sealed());
    all
}

fn failed(error: PluginError) -> Found {
    Found::Failed {
        error,
        http_mount: false,
    }
}

fn load(root: &Path, instance: &PluginInstance, catalog: Option<&CompiledCatalog>) -> Found {
    let resolved = match resolve_source(root, &instance.id, instance.source.as_deref(), catalog) {
        Ok(resolved) => resolved,
        Err(error) => return failed(error),
    };
    let (manifest, dir) = match resolved {
        ResolvedSource::Unresolved { .. } => return Found::Unresolved,
        ResolvedSource::Compiled { id, manifest } => {
            match Manifest::parse(&manifest, &format!("compiled:{id}")) {
                Ok(manifest) => (manifest, None),
                Err(error) => return failed(error),
            }
        }
        ResolvedSource::Directory { dir } => {
            let manifest = match Manifest::load(&dir) {
                Ok(manifest) => manifest,
                Err(error) => return failed(error),
            };
            match DirFiles::new(&dir) {
                Ok(files) => (manifest, Some(files)),
                Err(error) => return failed(PluginError::not_found(&instance.id, error)),
            }
        }
    };
    let compiled_source = dir.is_none();
    if let Err(error) = fits(instance, &manifest, compiled_source) {
        return Found::Failed {
            error,
            http_mount: manifest.is_http_mount(),
        };
    }
    Found::Manifest {
        manifest: Box::new(manifest),
        dir,
    }
}

/// The instance's keys against the plugin's kind, which only the manifest knows
/// (`PLUGIN_CONFIG_INVALID`, section 9.1).
pub(crate) fn fits(
    instance: &PluginInstance,
    manifest: &Manifest,
    compiled_source: bool,
) -> Result<(), PluginError> {
    let bad = |key: &str, problem: &str| PluginError::config_invalid(&instance.id, key, problem);
    let kind = manifest.plugin.kind;
    if compiled_source != (kind == PluginKind::Compiled) {
        return Err(bad(
            "source",
            &if compiled_source {
                format!("names a compiled plugin, but the manifest says the plugin is {kind}")
            } else {
                "is a directory, and a compiled plugin is linked into the binary: use compiled:<id>"
                    .to_owned()
            },
        ));
    }
    let limits = &instance.limits;
    if kind != PluginKind::Component
        && (limits.fuel.is_some()
            || limits.timeout_ms.is_some()
            || limits.memory_bytes.is_some()
            || limits.table_elements.is_some())
    {
        return Err(bad("limits", "applies only to a component plugin"));
    }
    if let Some(journal) = &instance.journal {
        if kind != PluginKind::Component {
            return Err(bad(
                "journal",
                "applies only to a component plugin: a compiled plugin's manifest declares its journal modes, and a mounted tool's are not configurable",
            ));
        }
        if let Some(name) = journal.commands.keys().find(|name| {
            !manifest
                .commands
                .iter()
                .any(|command| &command.name == *name)
        }) {
            return Err(bad(
                &format!("journal.commands.{name}"),
                &format!("names `{name}`, which is not a command of the plugin"),
            ));
        }
    }
    let Some(mount) = &manifest.mount else {
        for (key, set) in [
            ("prefix", instance.prefix.is_some()),
            ("url", instance.url.is_some()),
            ("bearer_env", instance.bearer_env.is_some()),
            ("connect_timeout_ms", instance.connect_timeout_ms.is_some()),
            ("timeout_ms", instance.timeout_ms.is_some()),
            ("max_result_bytes", instance.max_result_bytes.is_some()),
            ("env", !instance.env.is_empty()),
        ] {
            if set {
                return Err(bad(key, "applies only to a mounted plugin"));
            }
        }
        return Ok(());
    };
    match mount.transport {
        Transport::Stdio => {
            for (key, set) in [
                ("url", instance.url.is_some()),
                ("bearer_env", instance.bearer_env.is_some()),
            ] {
                if set {
                    return Err(bad(key, "applies only to an HTTP mount"));
                }
            }
        }
        Transport::Http => {
            if !instance.env.is_empty() {
                return Err(bad("env", "applies only to a stdio mount"));
            }
            if instance.url.is_none() {
                return Err(bad("url", "is required for an HTTP mount"));
            }
            if mount.bearer == Bearer::Required && instance.bearer_env.is_none() {
                return Err(bad(
                    "bearer_env",
                    "is required: the plugin's manifest says its server needs a bearer token",
                ));
            }
        }
    }
    Ok(())
}

/// Write the deployer's `[plugins.<id>.journal]` into a component instance's manifest commands
/// (the component journal specification, section 2, D197), after [`fits`] passed. A component
/// manifest declares no `journal` (D191), so nothing is overridden. An explicit `plain` stays a
/// declaration, so `plugin-show` can tell it from nothing set.
pub(crate) fn apply_journal(instance: &PluginInstance, manifest: &mut Manifest) {
    let Some(journal) = &instance.journal else {
        return;
    };
    if manifest.plugin.kind != PluginKind::Component {
        return;
    }
    for command in &mut manifest.commands {
        command.journal = journal.for_command(&command.name);
    }
}

/// `fail` for a problem in a required instance, else `warn`; `skip` when only the catalog was
/// missing; else `pass`.
fn verdict(id: &str, pass: String, issues: &[Issue], skipped: &[String]) -> Check {
    if let Some(first) = issues.iter().find(|issue| issue.fatal) {
        return Check::fail(id, join(issues), &first.suggestion);
    }
    if let Some(first) = issues.first() {
        return Check::warn(id, join(issues), &first.suggestion);
    }
    if !skipped.is_empty() {
        return Check::skip(
            id,
            &format!(
                "Needs the binary's compiled-plugin catalog to resolve: {}.",
                skipped.join(", ")
            ),
        );
    }
    Check::pass(id, pass)
}

fn join(issues: &[Issue]) -> String {
    issues
        .iter()
        .map(|issue| issue.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

fn sources(loaded: &[Loaded<'_>]) -> Check {
    let mut issues = Vec::new();
    let mut skipped = Vec::new();
    let mut resolved = 0;
    for entry in loaded {
        match &entry.found {
            Found::Manifest { .. } => resolved += 1,
            Found::Unresolved => skipped.push(entry.instance.id.clone()),
            Found::Failed { error, .. } => {
                issues.push(Issue::new(&entry.instance.id, entry.required(), error));
            }
        }
    }
    verdict(
        "plugins.sources",
        format!("{resolved} source(s) resolve and their manifests validate (protocol 1)"),
        &issues,
        &skipped,
    )
}

fn grants(loaded: &[Loaded<'_>]) -> Check {
    let mut issues = Vec::new();
    let mut counted = 0;
    for entry in loaded {
        let Some(manifest) = entry.manifest() else {
            continue;
        };
        let id = &entry.instance.id;
        for grant in &manifest.grants {
            counted += 1;
            // A required grant that is missing fails the load of a required instance only.
            let fatal = grant.required && entry.required();
            let name = grant.name.as_str();
            let problem = if entry.instance.deny.iter().any(|denied| denied == name) {
                Some(PluginError::grant_denied(id, name))
            } else if let Some(why) = super::unavailable_grant(name) {
                Some(PluginError::grant_unavailable(id, name, why))
            } else if crate::store::STORE_GRANTS.contains(&name)
                && manifest.plugin.kind != super::manifest::PluginKind::Compiled
            {
                Some(PluginError::grant_unavailable(
                    id,
                    name,
                    "is held by compiled plugins only in protocol 1 (no WIT world yet gives a component store imports; a later minor version of world 1 may)",
                ))
            } else if super::needs_allow_list(name)
                && entry.instance.allow.get(name).is_none_or(Vec::is_empty)
            {
                Some(PluginError::grant_denied_because(
                    id,
                    name,
                    "the instance gives it no allow list",
                ))
            } else {
                None
            };
            if let Some(error) = problem {
                issues.push(Issue::new(id, fatal, &error));
            }
        }
    }
    verdict(
        "plugins.grants",
        format!("{counted} declared grant(s) are in the catalog and allowed for their kind"),
        &issues,
        &[],
    )
}

fn packs(root: &Path, loaded: &[Loaded<'_>], declared: &[SpaceId]) -> Check {
    let mut issues = Vec::new();
    let mut checked: BTreeMap<String, ()> = BTreeMap::new();
    for entry in loaded {
        let (Found::Manifest { manifest, dir }, id) = (&entry.found, &entry.instance.id) else {
            continue;
        };
        let plugin = manifest.plugin.id.as_str();
        for pack in &manifest.packs {
            let mut dirs = Vec::new();
            if let Some(files) = dir {
                dirs.push(files.root().join(&pack.path));
            }
            for space in entry.instance.enabled_spaces(declared) {
                let over = root
                    .join("spaces")
                    .join(space.as_str())
                    .join("packs")
                    .join(plugin)
                    .join(&pack.id);
                if over.is_dir() {
                    dirs.push(over);
                }
            }
            for dir in dirs {
                // A mounted plugin's packs are served once per plugin, however many instances.
                if checked.insert(dir.display().to_string(), ()).is_some() {
                    continue;
                }
                if let Err(error) = check_pack(&dir, &pack.id, plugin) {
                    issues.push(Issue::new(id, entry.required(), &error));
                }
            }
        }
    }
    verdict(
        "plugins.packs",
        format!(
            "{} pack directory(ies) and override(s) validate",
            checked.len()
        ),
        &issues,
        &[],
    )
}

fn skills(loaded: &[Loaded<'_>]) -> Check {
    let mut issues = Vec::new();
    let mut owners: BTreeMap<String, String> = BTreeMap::new();
    let mut count = 0;
    for entry in loaded {
        let Found::Manifest { manifest, dir } = &entry.found else {
            continue;
        };
        let id = &entry.instance.id;
        for skill in &manifest.skills {
            count += 1;
            let plugin = manifest.plugin.id.clone();
            match owners.get(&skill.name) {
                Some(owner) if *owner != plugin => {
                    issues.push(Issue::new(
                        id,
                        entry.required(),
                        &PluginError::skill_invalid(
                            &skill.name,
                            format!(
                                "is also shipped by plugin `{owner}`; skill names must be unique"
                            ),
                        ),
                    ));
                    continue;
                }
                Some(_) => continue,
                None => {
                    owners.insert(skill.name.clone(), plugin);
                }
            }
            if let Some(files) = dir
                && let Err(error) = check_skill(&files.root().join(&skill.path))
            {
                issues.push(Issue::new(id, entry.required(), &error));
            }
        }
    }
    verdict(
        "plugins.skills",
        format!("{count} skill(s) validate and no name is shared"),
        &issues,
        &[],
    )
}

#[cfg(test)]
mod plugin_check_tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test(start_paused = true)]
    async fn a_timed_out_hook_keeps_its_turn_until_it_exits() {
        let turns = Arc::new(Semaphore::new(1));
        let in_flight = Arc::new(Mutex::new(()));
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let (entered, in_runtime) = std::sync::mpsc::channel::<bool>();
        let deadline = Instant::now() + Duration::from_secs(1);
        let result = run_plugin_check(
            Arc::clone(&turns),
            Arc::clone(&in_flight),
            deadline,
            move || {
                let _ = entered.send(tokio::runtime::Handle::try_current().is_ok());
                wait.recv()
            },
        )
        .await;
        assert!(matches!(result, Err(PluginCheckFailure::TimedOut)));
        // The hook ran inside the runtime, so it can use the host's async services.
        assert_eq!(in_runtime.recv(), Ok(true));
        assert_eq!(turns.available_permits(), 0);
        let retry = run_plugin_check(
            Arc::clone(&turns),
            in_flight,
            Instant::now() + Duration::from_secs(1),
            || (),
        )
        .await;
        assert!(matches!(retry, Err(PluginCheckFailure::AlreadyRunning)));
        assert!(release.send(()).is_ok());
        assert!(turns.acquire().await.is_ok());
    }

    #[tokio::test]
    async fn a_second_report_waits_for_a_check_still_queued_in_the_first() {
        let turns = Arc::new(Semaphore::new(1));
        let held = Arc::clone(&turns).acquire_owned().await.unwrap();
        let in_flight = Arc::new(Mutex::new(()));
        let deadline = Instant::now() + Duration::from_secs(60);
        let first = tokio::spawn(run_plugin_check(
            Arc::clone(&turns),
            Arc::clone(&in_flight),
            deadline,
            || 1,
        ));
        // The first report holds the check while it waits for a turn.
        while in_flight.try_lock().is_ok() {
            tokio::task::yield_now().await;
        }
        let second = tokio::spawn(run_plugin_check(
            Arc::clone(&turns),
            Arc::clone(&in_flight),
            deadline,
            || 2,
        ));
        tokio::task::yield_now().await;
        drop(held);
        assert!(matches!(first.await.unwrap(), Ok(1)));
        assert!(matches!(second.await.unwrap(), Ok(2)));
    }

    #[tokio::test]
    async fn a_turn_that_never_comes_is_busy_and_never_runs() {
        let turns = Arc::new(Semaphore::new(1));
        let _held = Arc::clone(&turns).acquire_owned().await.unwrap();
        let ran = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = Arc::clone(&ran);
        let result = run_plugin_check(
            turns,
            Arc::new(Mutex::new(())),
            Instant::now() + Duration::from_millis(50),
            move || flag.store(true, std::sync::atomic::Ordering::SeqCst),
        )
        .await;
        assert!(matches!(result, Err(PluginCheckFailure::Busy)));
        assert!(!ran.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn a_result_finished_at_the_deadline_is_late_and_a_panic_is_a_panic() {
        let deadline = Instant::from_std(std::time::Instant::now());
        let before = deadline - Duration::from_millis(1);
        assert!(matches!(settled(Ok(1), before, deadline), Ok(1)));
        assert!(matches!(
            settled(Ok(1), deadline, deadline),
            Err(PluginCheckFailure::TimedOut)
        ));
        assert!(matches!(
            settled::<()>(Err(()), deadline, deadline),
            Err(PluginCheckFailure::Panicked)
        ));
    }

    fn test_instance(
        id: &str,
        manifest_toml: &str,
        status: Status,
        packs: Vec<(String, Vec<crate::plugins::packs::PackState>)>,
    ) -> crate::plugins::loader::InstanceReport {
        let manifest = Manifest::parse(manifest_toml, "test").unwrap();
        crate::plugins::loader::InstanceReport {
            id: id.to_owned(),
            required: true,
            source: format!("plugins/{id}"),
            spaces: vec!["main".to_owned(), "beta".to_owned()],
            manifest: Some(manifest),
            grants: Vec::new(),
            commands: Vec::new(),
            packs,
            contexts: Vec::new(),
            pipelines: Vec::new(),
            mount: None,
            status,
        }
    }

    fn component_instance(
        id: &str,
        status: Status,
        packs: Vec<(String, Vec<crate::plugins::packs::PackState>)>,
    ) -> crate::plugins::loader::InstanceReport {
        test_instance(
            id,
            &format!(
                "manifest_version = 1\nprotocol = 1\n[plugin]\nid = \"{id}\"\ntitle = \"{id}\"\nversion = \"1.0.0\"\ndescription = \"d\"\nkind = \"component\"\ndomains = [\"{id}\"]\n[component]\npath = \"{id}.wasm\"\n"
            ),
            status,
            packs,
        )
    }

    fn pack_state(space: &str, origin: PackOrigin) -> crate::plugins::packs::PackState {
        crate::plugins::packs::PackState {
            space: space.to_owned(),
            origin,
            version: "1.0.0".to_owned(),
            files: 1,
        }
    }

    #[tokio::test]
    async fn pack_checks_counts_component_overrides_and_names_each_instance_once() {
        let loaded = LoadedPlugins {
            instances: vec![
                // Two spaces on `library` plus one override on `consumers`: counted as 3, named once.
                component_instance(
                    "components",
                    Status::Loaded,
                    vec![
                        (
                            "library".to_owned(),
                            vec![
                                pack_state("main", PackOrigin::Override),
                                pack_state("beta", PackOrigin::Override),
                            ],
                        ),
                        (
                            "consumers".to_owned(),
                            vec![pack_state("main", PackOrigin::Override)],
                        ),
                    ],
                ),
                // Default pack only: not counted.
                component_instance(
                    "defaults",
                    Status::Loaded,
                    vec![(
                        "guide".to_owned(),
                        vec![pack_state("main", PackOrigin::Default)],
                    )],
                ),
                // Non-component kinds (pack, mounted) with overrides: not counted under components.
                test_instance(
                    "style",
                    "manifest_version = 1\nprotocol = 1\n[plugin]\nid = \"style\"\ntitle = \"style\"\nversion = \"1.0.0\"\ndescription = \"d\"\nkind = \"pack\"\n",
                    Status::Loaded,
                    vec![(
                        "voice".to_owned(),
                        vec![pack_state("main", PackOrigin::Override)],
                    )],
                ),
                test_instance(
                    "tickets",
                    "manifest_version = 1\nprotocol = 1\n[plugin]\nid = \"tickets\"\ntitle = \"tickets\"\nversion = \"1.0.0\"\ndescription = \"d\"\nkind = \"mounted\"\ndomains = [\"tickets\"]\n[mount]\nprefix = \"tickets\"\ntransport = \"stdio\"\ncommand = [\"bin/server\"]\n",
                    Status::Loaded,
                    vec![(
                        "rules".to_owned(),
                        vec![pack_state("main", PackOrigin::Override)],
                    )],
                ),
                // Second loaded component with an override: counted and named in order.
                component_instance(
                    "other",
                    Status::Loaded,
                    vec![(
                        "voice".to_owned(),
                        vec![pack_state("main", PackOrigin::Override)],
                    )],
                ),
                // Failed optional component: not counted.
                component_instance(
                    "failed",
                    Status::Failed(PluginError::not_found("failed", "missing")),
                    vec![(
                        "voice".to_owned(),
                        vec![pack_state("main", PackOrigin::Override)],
                    )],
                ),
            ],
            ..LoadedPlugins::default()
        };
        let turns = Arc::new(Semaphore::new(1));
        let check =
            pack_checks_check(&loaded, &turns, Instant::now() + Duration::from_secs(5)).await;
        assert_eq!(check.status, crate::doctor::CheckStatus::Pass);
        assert_eq!(
            check.message,
            "0 override(s) pass their plugin's own check; 4 override(s) of component plugin(s) \
             (components, other) are checked for layout only (components have no check-pack export)"
        );
    }
}
