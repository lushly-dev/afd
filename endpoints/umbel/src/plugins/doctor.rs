//! The doctor's plugin checks that need only files (specification section 9.2).
//!
//! `plugins.config`, `plugins.sources`, `plugins.grants`, `plugins.packs` and `plugins.skills`
//! read `umbel.toml` and the plugin directories; they compile nothing, spawn nothing and need
//! no sealed host. `plugins.loaded`, `plugins.first_class` and `plugins.pipelines` need the
//! loader, so they are `skip` until a sealed host fills them in.
//!
//! A `compiled:<id>` source resolves only against the binary's catalog. A doctor run with no
//! catalog reports such an instance as `skip`, never as `fail`.

use std::collections::BTreeMap;
use std::path::Path;

use super::error::PluginError;
use super::files::DirFiles;
use super::loader::{LoadedPlugins, Status, TRUST_NOTE};
use super::manifest::{Bearer, Manifest, PluginKind, Transport};
use super::packs::check_pack;
use super::pipelines::PipelineState;
use super::skills::check_skill;
use super::source::{CompiledCatalog, ResolvedSource, resolve_source};
use super::{GRANTS, RESERVED_GRANTS};
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

/// The eight plugin checks, in order.
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
            } else if GRANTS.contains(&name) {
                None
            } else {
                let phase = RESERVED_GRANTS
                    .iter()
                    .find(|(reserved, _)| *reserved == name)
                    .map_or_else(
                        || "is not in this host's catalog".to_owned(),
                        |(_, phase)| format!("arrives with {phase}"),
                    );
                Some(PluginError::grant_unavailable(id, name, phase))
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
