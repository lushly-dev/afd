//! `plugin-check`: validate a plugin directory without enabling it (specification section 10.3).
//!
//! The file checks (`manifest`, `grants`, `schemas`, `packs`, `skills`, `config`, `component`)
//! read the directory in place. `boot` seals a second, internal host over a temporary workspace
//! that holds only this plugin. It uses [`HostBuilder`] and not the `testkit` feature, which the
//! stock binary lacks; the only thing it shares with the test kit is [`single_plugin_config`],
//! the writer of that workspace's `umbel.toml`.
//!
//! Booting a mount runs the plugin's own program, so it happens only when the caller passes
//! `spawn=true`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};

use super::compiled::CompiledPlugin;
use super::error::PluginError;
use super::files::{DirFiles, PluginFiles};
use super::loader::{InstanceReport, Status, embedded_id};
use super::manifest::{Manifest, PluginKind, Transport};
use super::packs::check_pack;
use super::skills::check_skill;
use super::{GRANTS, RESERVED_GRANTS};
use crate::doctor::{Check, CheckStatus};
use crate::{HostBuilder, HostError};

/// What `boot` copies at most into its temporary workspace: a plugin directory larger than this
/// is not booted (the file checks have already run on it in place).
const COPY_LIMIT_BYTES: u64 = 256 * 1024 * 1024;
const COPY_LIMIT_FILES: usize = 20_000;

/// The report of one `plugin-check`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Checked {
    /// The manifest's `plugin.id`, when the manifest read.
    pub plugin: Option<String>,
    /// The manifest's `plugin.kind`, when the manifest read.
    pub kind: Option<PluginKind>,
    /// The checks, in the specification's order.
    pub checks: Vec<Check>,
}

impl Checked {
    /// Whether no check failed. A skipped check never makes a plugin unhealthy.
    pub(crate) fn healthy(&self) -> bool {
        self.checks
            .iter()
            .all(|check| check.status != CheckStatus::Fail)
    }

    /// The `data` object of `plugin-check`.
    pub(crate) fn data(&self) -> Value {
        json!({
            "plugin": self.plugin,
            "kind": self.kind.map(PluginKind::as_str),
            "healthy": self.healthy(),
            "checks": self.checks,
        })
    }
}

/// The `umbel.toml` of a workspace that enables only the plugin instance `id`, read from
/// `source` (`compiled:<id>` or `plugins/<id>`): the declared `spaces` (the first is the default
/// space, and the instance is enabled for all of them), the instance's `config`, and `keys`, more
/// keys of the instance's table. Shared by `plugin-check`'s `boot` and the test kit.
pub(crate) fn single_plugin_config(
    spaces: &[String],
    id: &str,
    source: &str,
    config: &toml::Table,
    keys: &toml::Table,
) -> toml::Table {
    let mut table = toml::Table::new();
    table.insert("config_version".into(), 2.into());
    if let Some(first) = spaces.first() {
        table.insert("default_space".into(), first.clone().into());
    }
    let mut declared = toml::Table::new();
    for space in spaces {
        declared.insert(space.clone(), toml::Table::new().into());
    }
    table.insert("spaces".into(), declared.into());
    let mut instance = toml::Table::new();
    instance.insert("source".into(), source.into());
    if !config.is_empty() {
        instance.insert("config".into(), config.clone().into());
    }
    instance.extend(keys.clone());
    let mut plugins = toml::Table::new();
    plugins.insert("enabled".into(), vec![id.to_owned()].into());
    plugins.insert(id.to_owned(), instance.into());
    table.insert("plugins".into(), plugins.into());
    table
}

/// Check the plugin directory `path`. Blocks: a component is compiled and a mount may be started,
/// so an async caller runs it on a blocking thread.
pub(crate) fn run(path: &Path, spawn: bool, compiled: &[Arc<dyn CompiledPlugin>]) -> Checked {
    let dir = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut checked = Checked {
        plugin: None,
        kind: None,
        checks: Vec::new(),
    };
    let (manifest, files) = match open(&dir) {
        Ok(opened) => opened,
        Err(error) => {
            checked.checks.push(fail("manifest", &error));
            skip_rest(
                &mut checked.checks,
                "Needs a valid manifest; manifest failed.",
            );
            return checked;
        }
    };
    let id = manifest.plugin.id.clone();
    checked.plugin = Some(id.clone());
    checked.kind = Some(manifest.plugin.kind);
    checked.checks.push(Check::pass(
        "manifest",
        format!(
            "{id} {} ({}): manifest version 1, protocol 1; {} command(s), {} pack(s), {} skill(s)",
            manifest.plugin.version,
            manifest.plugin.kind,
            manifest.commands.len(),
            manifest.packs.len(),
            manifest.skills.len(),
        ),
    ));
    checked.checks.push(grants(&manifest));
    checked.checks.push(schemas(&manifest, &files));
    checked.checks.push(packs(&dir, &manifest));
    checked.checks.push(skills(&dir, &manifest));
    checked.checks.push(config(&manifest, &files));
    checked.checks.push(component(&manifest, &files));
    checked
        .checks
        .push(boot(&dir, &manifest, &files, spawn, compiled));
    checked.checks.push(Check::skip_with(
        "surface",
        "AFD's surface validation is a TypeScript tool and does not run inside this binary.",
        "Run afd validate --surface against umbel serve --http with this plugin enabled.",
    ));
    checked
}

fn open(dir: &Path) -> Result<(Manifest, DirFiles), PluginError> {
    if !dir.is_dir() {
        return Err(PluginError::not_found(
            "plugin-check",
            format!("{} is not a directory", dir.display()),
        ));
    }
    let manifest = Manifest::load(dir)?;
    let files = DirFiles::new(dir).map_err(|error| {
        PluginError::not_found("plugin-check", format!("{}: {error}", dir.display()))
    })?;
    Ok((manifest, files))
}

fn fail(id: &str, error: &PluginError) -> Check {
    Check::fail(
        id,
        format!("{}: {}", error.code(), error.message()),
        error.suggestion(),
    )
}

fn skip_rest(checks: &mut Vec<Check>, message: &str) {
    for id in [
        "grants",
        "schemas",
        "packs",
        "skills",
        "config",
        "component",
        "boot",
    ] {
        checks.push(Check::skip(id, message));
    }
    checks.push(Check::skip_with(
        "surface",
        "AFD's surface validation is a TypeScript tool and does not run inside this binary.",
        "Run afd validate --surface against umbel serve --http with this plugin enabled.",
    ));
}

/// Every grant against the host's catalog (section 7.1); the manifest's own rules (a reason, no
/// grant on a mounted or pack plugin, no `allow`) were applied when it read.
fn grants(manifest: &Manifest) -> Check {
    let id = manifest.plugin.id.as_str();
    let mut problems = Vec::new();
    let mut warned = false;
    for grant in &manifest.grants {
        let name = grant.name.as_str();
        if GRANTS.contains(&name) {
            continue;
        }
        let why = RESERVED_GRANTS
            .iter()
            .find(|(reserved, _)| *reserved == name)
            .map_or_else(
                || "is not in this host's catalog".to_owned(),
                |(_, phase)| format!("arrives with {phase}"),
            );
        let error = PluginError::grant_unavailable(id, name, why);
        warned |= !grant.required;
        problems.push((grant.required, error));
    }
    if let Some((_, first)) = problems.iter().find(|(required, _)| *required) {
        return Check::fail("grants", join(&problems), first.suggestion());
    }
    if warned {
        return Check::warn(
            "grants",
            join(&problems),
            "An optional grant the host cannot provide is denied at load; the plugin must work without it.",
        );
    }
    Check::pass(
        "grants",
        format!(
            "{} declared grant(s) are in the catalog ({}), each with a reason",
            manifest.grants.len(),
            GRANTS.join(", ")
        ),
    )
}

fn join(problems: &[(bool, PluginError)]) -> String {
    problems
        .iter()
        .map(|(_, error)| format!("{}: {}", error.code(), error.message()))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Input schemas passed the `afd` checker when the manifest read. Here: a command with no
/// `returns` schema is AFD's surface rule `missing-output-schema` (a `warn`), and a description
/// that matches the `description-injection` rule is a `warn`.
fn schemas(manifest: &Manifest, files: &DirFiles) -> Check {
    if manifest.plugin.kind == PluginKind::Mounted {
        return Check::skip(
            "schemas",
            "A mounted plugin's tool schemas come from its server; boot with spawn=true lists them and scans their descriptions.",
        );
    }
    let mut notes = Vec::new();
    for command in &manifest.commands {
        if command.returns.is_none() {
            notes.push(format!(
                "{} has no returns schema (missing-output-schema)",
                command.name
            ));
        }
        #[cfg(feature = "mounted")]
        {
            use super::mounted::{scan_description, scan_schema_descriptions};
            for hit in scan_description(&command.description) {
                notes.push(format!(
                    "{}: the description matches the description-injection rule ({})",
                    command.name, hit.pattern
                ));
            }
            if let Ok(schema) = command.input_schema.load(files) {
                for (pointer, hit) in scan_schema_descriptions(&schema) {
                    notes.push(format!(
                        "{}: {pointer} matches the description-injection rule ({})",
                        command.name, hit.pattern
                    ));
                }
            }
        }
        #[cfg(not(feature = "mounted"))]
        let _ = files;
    }
    if notes.is_empty() {
        return Check::pass(
            "schemas",
            format!(
                "{} command schema(s) pass the afd checker, declare returns and carry no injection pattern",
                manifest.commands.len()
            ),
        );
    }
    Check::warn(
        "schemas",
        notes.join("; "),
        "Declare returns for every command, and write descriptions that say what a command does and nothing about the caller's behaviour.",
    )
}

fn packs(dir: &Path, manifest: &Manifest) -> Check {
    let plugin = manifest.plugin.id.as_str();
    let mut errors = Vec::new();
    for pack in &manifest.packs {
        if let Err(error) = check_pack(&dir.join(&pack.path), &pack.id, plugin) {
            errors.push((true, error));
        }
    }
    if let Some((_, first)) = errors.first() {
        return Check::fail("packs", join(&errors), first.suggestion());
    }
    Check::pass(
        "packs",
        format!("{} pack(s) validate", manifest.packs.len()),
    )
}

fn skills(dir: &Path, manifest: &Manifest) -> Check {
    let mut errors = Vec::new();
    for skill in &manifest.skills {
        if let Err(error) = check_skill(&dir.join(&skill.path)) {
            errors.push((true, error));
        }
    }
    if let Some((_, first)) = errors.first() {
        return Check::fail("skills", join(&errors), first.suggestion());
    }
    Check::pass(
        "skills",
        format!("{} skill(s) validate", manifest.skills.len()),
    )
}

/// The configuration schema's defaults must validate against the schema, so an instance with an
/// empty `config` table loads.
fn config(manifest: &Manifest, files: &DirFiles) -> Check {
    let Some(_) = &manifest.config else {
        return Check::pass(
            "config",
            "The plugin declares no configuration schema; an instance's config table must be empty",
        );
    };
    match super::config::resolve(&manifest.plugin.id, manifest, files, &json!({})) {
        Ok(_) => Check::pass(
            "config",
            "The configuration schema is valid and its defaults validate against it",
        ),
        Err(error) => fail("config", &error),
    }
}

#[cfg(feature = "component")]
fn component(manifest: &Manifest, files: &DirFiles) -> Check {
    if manifest.plugin.kind != PluginKind::Component {
        return Check::skip("component", "Applies only to a component plugin.");
    }
    match super::component::check(&manifest.plugin.id, manifest, files) {
        Ok(()) => Check::pass(
            "component",
            "The component compiles, targets umbel:plugin@1.x and imports only what its grants allow",
        ),
        Err(error) => fail("component", &error),
    }
}

#[cfg(not(feature = "component"))]
fn component(manifest: &Manifest, _files: &DirFiles) -> Check {
    if manifest.plugin.kind != PluginKind::Component {
        return Check::skip("component", "Applies only to a component plugin.");
    }
    fail(
        "component",
        &PluginError::kind_unavailable(&manifest.plugin.id, manifest.plugin.kind),
    )
}

/// `boot`: seal an internal host with only this plugin.
fn boot(
    dir: &Path,
    manifest: &Manifest,
    files: &DirFiles,
    spawn: bool,
    compiled: &[Arc<dyn CompiledPlugin>],
) -> Check {
    let id = manifest.plugin.id.as_str();
    let mut linked: Option<Arc<dyn CompiledPlugin>> = None;
    match manifest.plugin.kind {
        PluginKind::Compiled => {
            linked = compiled
                .iter()
                .find(|plugin| embedded_id(plugin.manifest()).as_deref() == Ok(id))
                .map(Arc::clone);
            if linked.is_none() {
                return Check::skip_with(
                    "boot",
                    &format!(
                        "A compiled plugin boots only in a binary that links it, and this binary has no compiled:{id}."
                    ),
                    "Link the plugin into a binary through umbel::cli::run's configure hook, or call it from tests/plugin.rs with TestHost::compiled.",
                );
            }
        }
        PluginKind::Mounted => {
            if manifest.mount.as_ref().map(|mount| mount.transport) == Some(Transport::Http) {
                return Check::skip_with(
                    "boot",
                    "An HTTP mount's url and credential are the deployer's, so there is nothing to connect to here.",
                    "Enable the plugin in a workspace with plugins.<id>.url set and run umbel workspace doctor.",
                );
            }
            if !spawn {
                return Check::skip_with(
                    "boot",
                    "Booting a mount starts the plugin's own program, so it is off unless you ask for it.",
                    "Run umbel plugin check path=<dir> spawn=true to start the server and list its tools.",
                );
            }
        }
        PluginKind::Component | PluginKind::Pack => {}
    }
    match boot_host(dir, manifest, files, linked) {
        Ok(report) => boot_report(manifest, &report),
        Err(BootError::Host(error)) => Check::fail(
            "boot",
            format!("{}: {}", error.code(), error.message()),
            error.suggestion(),
        ),
        Err(BootError::TooLarge(message)) => Check::skip_with(
            "boot",
            &message,
            "Move build output out of the plugin directory (target/ and .git/ are already left out), or enable the plugin in a workspace and run umbel workspace doctor.",
        ),
        Err(BootError::Setup(message)) => Check::fail(
            "boot",
            message,
            "Check that the temporary directory is writable and has room.",
        ),
    }
}

/// An error of the internal host, with its temporary paths replaced by the plugin directory the
/// caller named, so the message points at something they have.
fn name_the_directory(
    error: HostError,
    workspace: &TempWorkspace,
    id: &str,
    dir: &Path,
) -> HostError {
    let mut message = error.message().to_owned();
    let mut roots = vec![workspace.path().to_path_buf()];
    if let Ok(canonical) = fs::canonicalize(workspace.path()) {
        roots.push(canonical);
    }
    for root in roots {
        let plugin_dir = root.join("plugins").join(id);
        message = message.replace(
            &plugin_dir.display().to_string(),
            &dir.display().to_string(),
        );
        message = message.replace(&root.display().to_string(), "<temporary workspace>");
    }
    HostError::new(error.code(), message, error.suggestion().to_owned())
}

enum BootError {
    Host(HostError),
    TooLarge(String),
    Setup(String),
}

/// The booted instance as `plugin-list` would report it.
struct BootReport {
    instance: InstanceReport,
    kind_note: Option<&'static str>,
}

fn boot_host(
    dir: &Path,
    manifest: &Manifest,
    files: &DirFiles,
    linked: Option<Arc<dyn CompiledPlugin>>,
) -> Result<BootReport, BootError> {
    let id = manifest.plugin.id.as_str();
    let workspace = TempWorkspace::create().map_err(|error| {
        BootError::Setup(format!("cannot create a temporary workspace: {error}"))
    })?;
    let source = if linked.is_some() {
        format!("compiled:{id}")
    } else {
        let target = workspace.path().join("plugins").join(id);
        let extra: Vec<&str> = manifest
            .component
            .iter()
            .map(|component| component.path.as_str())
            .collect();
        copy_plugin(
            dir,
            &target,
            manifest.plugin.kind != PluginKind::Mounted,
            &extra,
            files,
        )?;
        format!("plugins/{id}")
    };
    let table = single_plugin_config(
        &["main".to_owned()],
        id,
        &source,
        &toml::Table::new(),
        &toml::Table::new(),
    );
    let text = toml::to_string(&table)
        .map_err(|error| BootError::Setup(format!("cannot write umbel.toml: {error}")))?;
    fs::write(workspace.path().join("umbel.toml"), text)
        .map_err(|error| BootError::Setup(format!("cannot write umbel.toml: {error}")))?;
    let mut builder = HostBuilder::open(workspace.path()).map_err(BootError::Host)?;
    let used_catalog = linked.is_some();
    if let Some(plugin) = linked {
        builder = builder.with_compiled(plugin);
    }
    let host = builder
        .seal()
        .map_err(|error| BootError::Host(name_the_directory(error, &workspace, id, dir)))?;
    let instance =
        host.loaded().instance(id).cloned().ok_or_else(|| {
            BootError::Setup(format!("the booted host reports no instance `{id}`"))
        })?;
    // The host drops, and with it a mount's child (`kill_on_drop`), before the workspace goes.
    drop(host);
    if let Status::Failed(error) = &instance.status {
        return Err(BootError::Host(HostError::from(error.clone())));
    }
    Ok(BootReport {
        instance,
        kind_note: used_catalog.then_some(
            "the manifest is the binary's embedded copy, not umbel-plugin.toml in the directory",
        ),
    })
}

fn boot_report(manifest: &Manifest, report: &BootReport) -> Check {
    let instance = &report.instance;
    let mut message = format!(
        "An internal host with only {} seals; commands: {}",
        manifest.plugin.id,
        if instance.commands.is_empty() {
            "none".to_owned()
        } else {
            instance.commands.join(", ")
        }
    );
    if let Some(note) = report.kind_note {
        message.push_str(&format!(" ({note})"));
    }
    let Some(mount) = &instance.mount else {
        return Check::pass("boot", message);
    };
    let mut notes = Vec::new();
    for skipped in &mount.skipped {
        notes.push(format!(
            "the tool `{}` was skipped ({}: {})",
            skipped.tool, skipped.code, skipped.message
        ));
    }
    for warning in &mount.warnings {
        notes.push(format!(
            "the tool `{}` has a {} match (description-injection, {})",
            warning.tool, warning.pattern, warning.location
        ));
    }
    if notes.is_empty() {
        return Check::pass("boot", message);
    }
    Check::warn(
        "boot",
        format!("{message}; {}", notes.join("; ")),
        "Give every tool a name and a schema the host can mount, and describe tools without addressing the caller.",
    )
}

/// A temporary directory that goes when it drops.
struct TempWorkspace(PathBuf);

impl TempWorkspace {
    fn create() -> io::Result<Self> {
        let base = std::env::temp_dir();
        let mut attempts = 0;
        loop {
            let mut bytes = [0u8; 8];
            getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
            let suffix: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            let path = base.join(format!("umbel-plugin-check-{suffix}"));
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists && attempts < 8 => {
                    attempts += 1;
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Copy the plugin directory `from` to `to`, leaving out `.git` and `target` (and
/// `node_modules` unless the plugin is a mount, whose program may need it), symbolic links and
/// anything past the copy limits. `extra` files, such as a component built under `target/`, are
/// copied even if the walk left them out.
fn copy_plugin(
    from: &Path,
    to: &Path,
    skip_node_modules: bool,
    extra: &[&str],
    files: &DirFiles,
) -> Result<(), BootError> {
    let io = |path: &Path, error: io::Error| {
        BootError::Setup(format!("cannot copy {}: {error}", path.display()))
    };
    let mut bytes = 0u64;
    let mut count = 0usize;
    let mut stack = vec![(from.to_path_buf(), to.to_path_buf())];
    while let Some((source, target)) = stack.pop() {
        fs::create_dir_all(&target).map_err(|error| io(&target, error))?;
        for entry in fs::read_dir(&source).map_err(|error| io(&source, error))? {
            let entry = entry.map_err(|error| io(&source, error))?;
            let name = entry.file_name();
            let name_text = name.to_string_lossy();
            let kind = entry
                .file_type()
                .map_err(|error| io(&entry.path(), error))?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                let skipped = matches!(name_text.as_ref(), ".git" | "target")
                    || (skip_node_modules && name_text == "node_modules");
                if !skipped {
                    stack.push((entry.path(), target.join(&name)));
                }
                continue;
            }
            let length = entry
                .metadata()
                .map_err(|error| io(&entry.path(), error))?
                .len();
            bytes += length;
            count += 1;
            if bytes > COPY_LIMIT_BYTES || count > COPY_LIMIT_FILES {
                return Err(BootError::TooLarge(format!(
                    "The plugin directory is larger than the {} MiB / {COPY_LIMIT_FILES} file limit boot copies into its temporary workspace.",
                    COPY_LIMIT_BYTES / (1024 * 1024)
                )));
            }
            fs::copy(entry.path(), target.join(&name)).map_err(|error| io(&entry.path(), error))?;
        }
    }
    for relative in extra {
        let destination = to.join(relative);
        if destination.exists() {
            continue;
        }
        let content = files.read(relative).map_err(BootError::Setup)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| io(parent, error))?;
        }
        fs::write(&destination, content).map_err(|error| io(&destination, error))?;
    }
    Ok(())
}
