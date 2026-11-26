//! The mounted loader (specification section 6.3, D22, D43, D50): an external MCP server whose
//! tools become commands under the mount's prefix.
//!
//! The host is the server's MCP client through rmcp's client role. The manifest says what the
//! server is; the deployer's instance configuration says where it runs and with what credential.

mod client;
mod naming;
mod result;
mod scan;
mod schema;
mod transport;

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use afd::{
    CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult, JsonSchema,
};
use async_trait::async_trait;
use serde_json::{Map, Value, json};

use self::client::{Endpoint, HttpSpec, Mount, MountSpec, Secret, StdioSpec};
pub use self::naming::mount_command_name;
pub use self::scan::{InjectionHit, scan_description, scan_schema_descriptions};
use super::loader::{
    GateEntry, MountReport, MountToolReport, ScanWarning, SkippedTool, check_name,
};
use super::manifest::{Effect, Manifest, MountDecl, MountTool, Transport};
use super::{ORIGIN_KEY, PluginError, codes};
use crate::workspace::{PluginInstance, Workspace};

/// `connect_timeout_ms` when the instance sets none.
const CONNECT_TIMEOUT_MS: u64 = 10_000;
/// `timeout_ms` when the instance sets none.
const CALL_TIMEOUT_MS: u64 = 30_000;
/// `max_result_bytes` when the instance sets none.
const RESULT_BYTES: u64 = 1024 * 1024;

/// What the loader hands over for one mounted instance.
pub(crate) struct Request<'a> {
    pub instance: &'a PluginInstance,
    pub manifest: &'a Manifest,
    /// The plugin directory, canonical.
    pub root: &'a Path,
    pub workspace: &'a Arc<Workspace>,
    /// The spaces the instance is enabled for.
    pub spaces: &'a [String],
    pub taken: &'a BTreeMap<String, String>,
    /// Extra trusted root certificates, PEM, for HTTPS mounts.
    pub roots: &'a [Vec<u8>],
}

/// What loading one mounted instance produced.
pub(crate) struct Built {
    /// Each command with its validation schema.
    pub commands: Vec<(CommandDefinition, Value)>,
    /// The schema a command advertises, where it differs from the one it validates with.
    pub advertised: BTreeMap<String, Value>,
    pub gate: Vec<(String, GateEntry)>,
    pub report: MountReport,
}

/// Steps 5 to 7 of the load sequence for a mounted instance: connect, list the tools, rename
/// them, and build the definitions, without touching the registry.
pub(crate) fn build(request: &Request<'_>) -> Result<Built, PluginError> {
    let instance = request.instance;
    let manifest = request.manifest;
    let Some(mount) = &manifest.mount else {
        return Err(PluginError::manifest_invalid(
            &manifest.file,
            "mount",
            "is required when plugin.kind = \"mounted\"",
        ));
    };
    let prefix = instance
        .prefix
        .clone()
        .unwrap_or_else(|| mount.prefix.clone());
    if let Some(problem) = super::domain_problem(&prefix) {
        return Err(PluginError::config_invalid(&instance.id, "prefix", problem));
    }
    let spec = spec(request, mount)?;
    let bearer_configured = matches!(&spec.endpoint, Endpoint::Http(http) if http.bearer.is_some());
    let (connection, tools) = Mount::connect(spec)?;

    let mut plan = Plan::new(request, mount, &prefix, bearer_configured, &connection);
    plan.read_tools(&tools)?;
    plan.check_spaces()?;
    Ok(plan.finish())
}

fn spec(request: &Request<'_>, mount: &MountDecl) -> Result<MountSpec, PluginError> {
    let instance = request.instance;
    let bad = |key: &str, problem: String| PluginError::config_invalid(&instance.id, key, problem);
    let endpoint = match mount.transport {
        Transport::Stdio => {
            let first = mount.command.first().ok_or_else(|| {
                PluginError::manifest_invalid(&request.manifest.file, "mount.command", "is empty")
            })?;
            // `PATH` (plus `SystemRoot` on Windows, which Node/OpenSSL need for the OS RNG),
            // then the manifest's defaults, overridden by the instance's: nothing else of the
            // host's environment reaches the child.
            let env = build_child_env(
                |name| std::env::var(name).ok(),
                cfg!(windows),
                &mount.env,
                &instance.env,
            );
            let stdio = StdioSpec {
                root: request.root.to_path_buf(),
                state_dir: request.workspace.state_dir(),
                command: first.clone(),
                args: mount.command.iter().skip(1).cloned().collect(),
                relative_cwd: mount.cwd.clone(),
                env,
            };
            // Validate once at seal so manifest/source problems surface with their exact codes;
            // `client::spawn` calls the same resolver before every spawn and respawn.
            resolve_stdio_launch(&stdio).map_err(|error| match error {
                LaunchError::Source(problem) => bad("source", problem),
                LaunchError::Cwd(problem) => {
                    PluginError::manifest_invalid(&request.manifest.file, "mount.cwd", problem)
                }
                LaunchError::Command(problem) => {
                    PluginError::manifest_invalid(&request.manifest.file, "mount.command", problem)
                }
            })?;
            Endpoint::Stdio(stdio)
        }
        Transport::Http => {
            let url = instance
                .url
                .clone()
                .ok_or_else(|| bad("url", "is required for an HTTP mount".to_owned()))?;
            let bearer = match &instance.bearer_env {
                None => None,
                Some(name) => match std::env::var(name) {
                    Ok(value) if !value.is_empty() && !value.chars().any(char::is_control) => {
                        Some(Secret::new(value))
                    }
                    _ => {
                        return Err(bad(
                            "bearer_env",
                            format!(
                                "names the environment variable `{name}`, which is unset, empty or not a valid token"
                            ),
                        ));
                    }
                },
            };
            Endpoint::Http(HttpSpec {
                url,
                bearer,
                roots: request.roots.to_vec(),
            })
        }
    };
    Ok(MountSpec {
        instance: instance.id.clone(),
        endpoint,
        connect_timeout: Duration::from_millis(
            instance.connect_timeout_ms.unwrap_or(CONNECT_TIMEOUT_MS),
        ),
        call_timeout: Duration::from_millis(instance.timeout_ms.unwrap_or(CALL_TIMEOUT_MS)),
        max_result_bytes: usize::try_from(instance.max_result_bytes.unwrap_or(RESULT_BYTES))
            .unwrap_or(usize::MAX),
    })
}

/// Maximum symbolic link hops followed when resolving a path with missing leaves.
const MAX_SYMLINK_HOPS: usize = 40;

/// Validated, concrete executable path and working directory handed to `Command::new`.
pub(crate) struct ResolvedLaunch {
    pub program: OsString,
    pub cwd: PathBuf,
}

/// Which field of a stdio mount failed launch validation.
#[derive(Debug)]
pub(crate) enum LaunchError {
    Source(String),
    Cwd(String),
    Command(String),
}

impl LaunchError {
    pub(crate) fn into_message(self) -> String {
        match self {
            Self::Source(problem) => format!("plugin source {problem}"),
            Self::Cwd(problem) => format!("mount.cwd: {problem}"),
            Self::Command(problem) => format!("mount.command: {problem}"),
        }
    }
}

/// Resolve and validate a stdio mount's working directory and executable against the plugin root
/// and workspace `state/` directory. Called both at seal and immediately before every spawn or
/// respawn so a path change between launches cannot redirect execution into `state/` or outside
/// the plugin directory.
pub(crate) fn resolve_stdio_launch(stdio: &StdioSpec) -> Result<ResolvedLaunch, LaunchError> {
    let state_dir = resolve_path(&stdio.state_dir)
        .map_err(|problem| LaunchError::Source(format!("cannot resolve state/: {problem}")))?;
    let cwd = match &stdio.relative_cwd {
        Some(relative) => {
            let resolved = confined(&stdio.root, relative).map_err(LaunchError::Cwd)?;
            if resolved.starts_with(&state_dir) {
                return Err(LaunchError::Cwd(format!(
                    "`{relative}` is under state/, which the host owns"
                )));
            }
            resolved
        }
        None => {
            let resolved = resolve_path(&stdio.root).map_err(LaunchError::Source)?;
            if resolved.starts_with(&state_dir) {
                return Err(LaunchError::Source(
                    "is under state/, which the host owns".to_owned(),
                ));
            }
            resolved
        }
    };
    let program = program(&stdio.root, &stdio.command, &stdio.env, &cwd, &state_dir)
        .map_err(LaunchError::Command)?;
    Ok(ResolvedLaunch { program, cwd })
}

/// The concrete program to pass to `Command::new`: the canonical file inside the plugin root when
/// the first element names one (or has a path separator / Windows prefix), or the resolved
/// absolute executable from the child's `PATH` (when found). Refuses any resolved target under
/// `state_dir`, any escape out of `root`, and trailing path separators.
fn program(
    root: &Path,
    first: &str,
    env: &[(String, String)],
    cwd: &Path,
    state_dir: &Path,
) -> Result<OsString, String> {
    if first.is_empty() {
        return Err("is empty".to_owned());
    }
    if matches!(first, "." | "..") || first.ends_with('/') || first.ends_with('\\') {
        return Err(format!("`{first}` must name a file, not a directory"));
    }
    let has_path_syntax = first.contains('/')
        || first.contains('\\')
        || Path::new(first)
            .components()
            .any(|part| matches!(part, Component::Prefix(_)));
    if has_path_syntax {
        return resolve_plugin_command(root, first, state_dir);
    }

    // Bare name: check inside the plugin root first (matching `CreateProcessW`'s `.exe` suffix on
    // Windows), refusing symlink escapes and targets under `state/`.
    for candidate_name in bare_candidates(first) {
        let inside = root.join(&candidate_name);
        let is_symlink = inside
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink());
        if is_symlink || inside.is_file() {
            let resolved = confined(root, &candidate_name)?;
            if resolved.starts_with(state_dir) {
                return Err(format!("`{first}` is under state/, which the host owns"));
            }
            if resolved.is_file() {
                return Ok(resolved.into_os_string());
            }
        }
    }

    // Otherwise resolve against the child's effective `PATH` and pass the selected absolute path
    // to `Command::new` so the OS executes the exact file that was checked.
    if let Some(found) = resolve_on_child_path(first, env, cwd, state_dir)? {
        return Ok(found.into_os_string());
    }

    // On Windows, `CreateProcessW` also searches `cwd` when `PATH` has no match.
    #[cfg(windows)]
    for candidate_name in bare_candidates(first) {
        let in_cwd = cwd.join(&candidate_name);
        if in_cwd.symlink_metadata().is_ok() {
            let resolved = resolve_path(&in_cwd)?;
            if resolved.starts_with(state_dir) {
                return Err(format!("`{first}` is under state/, which the host owns"));
            }
            if resolved.is_file() {
                return Ok(resolved.into_os_string());
            }
        }
    }

    Ok(OsString::from(first))
}

fn resolve_plugin_command(
    root: &Path,
    relative: &str,
    state_dir: &Path,
) -> Result<OsString, String> {
    let resolved = confined(root, relative)?;
    if resolved.starts_with(state_dir) {
        return Err(format!("`{relative}` is under state/, which the host owns"));
    }
    #[cfg(windows)]
    if !resolved.is_file() && !relative.to_ascii_lowercase().ends_with(".exe") {
        let with_exe = format!("{relative}.exe");
        let resolved_exe = confined(root, &with_exe)?;
        if resolved_exe.starts_with(state_dir) {
            return Err(format!("`{relative}` is under state/, which the host owns"));
        }
        if resolved_exe.is_file() {
            return Ok(resolved_exe.into_os_string());
        }
    }
    Ok(resolved.into_os_string())
}

fn bare_candidates(first: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        if Path::new(first).extension().is_some() {
            out.push(first.to_owned());
        }
        if !first.to_ascii_lowercase().ends_with(".exe") {
            out.push(format!("{first}.exe"));
        }
        if out.is_empty() {
            out.push(first.to_owned());
        }
        out
    }
    #[cfg(not(windows))]
    {
        vec![first.to_owned()]
    }
}

/// Resolve a bare program name on the child's effective `PATH`, mirroring the OS's search rules:
/// - Unix: empty entries mean `cwd`; skips files that are not regular files executable by the
///   current user (`access(X_OK)`), refusing any candidate under `state_dir` encountered at or
///   before the selected executable.
/// - Windows: skips empty entries (matching Rust's `std::sys::process::windows`), checks exact
///   extensioned names and `.exe` suffixes, refusing any match under `state_dir`.
fn resolve_on_child_path(
    first: &str,
    env: &[(String, String)],
    cwd: &Path,
    state_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(path_value) = env
        .iter()
        .find(|(key, _)| {
            if cfg!(windows) {
                key.eq_ignore_ascii_case("PATH")
            } else {
                key == "PATH"
            }
        })
        .map(|(_, value)| value.as_str())
    else {
        return Ok(None);
    };
    let candidates = bare_candidates(first);
    for entry in std::env::split_paths(path_value) {
        if cfg!(windows) && entry.as_os_str().is_empty() {
            continue;
        }
        let dir = if entry.as_os_str().is_empty() {
            cwd.to_path_buf()
        } else if entry.is_relative() {
            cwd.join(&entry)
        } else {
            entry
        };
        for candidate_name in &candidates {
            let candidate = dir.join(candidate_name);
            if candidate.symlink_metadata().is_err() {
                continue;
            }
            let resolved = resolve_path(&candidate)?;
            if resolved.starts_with(state_dir) {
                return Err(format!("`{first}` is under state/, which the host owns"));
            }
            if umbel_process::is_executable_by_current_user(&resolved) {
                return Ok(Some(resolved));
            }
        }
    }
    Ok(None)
}

/// Canonicalize `path`, or resolve its symlinks (including dangling targets, up to
/// [`MAX_SYMLINK_HOPS`]) and normalize any missing leaf components on the canonical ancestor.
/// Preserves non-`NotFound` errors (such as `NotADirectory` for a regular file followed by `/`).
fn resolve_path(path: &Path) -> Result<PathBuf, String> {
    match std::fs::canonicalize(path) {
        Ok(resolved) => return Ok(resolved),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("`{}` cannot be resolved: {error}", path.display())),
    }

    let mut queue: VecDeque<OsString> = VecDeque::new();
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => current.push(prefix.as_os_str()),
            Component::RootDir => current.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => queue.push_back(OsString::from("..")),
            Component::Normal(segment) => queue.push_back(segment.to_os_string()),
        }
    }

    let mut hops = 0usize;
    while let Some(segment) = queue.pop_front() {
        if segment == OsStr::new(".") {
            continue;
        }
        if segment == OsStr::new("..") {
            current.pop();
            continue;
        }
        current.push(&segment);
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                hops += 1;
                if hops > MAX_SYMLINK_HOPS {
                    return Err(format!(
                        "`{}` exceeds the symbolic link hop limit",
                        path.display()
                    ));
                }
                let target = std::fs::read_link(&current)
                    .map_err(|error| format!("`{}` cannot be read: {error}", current.display()))?;
                if target.is_absolute() {
                    current.clear();
                } else {
                    current.pop();
                }
                let mut prefix_items: Vec<OsString> = Vec::new();
                for part in target.components() {
                    match part {
                        Component::Prefix(prefix) => current.push(prefix.as_os_str()),
                        Component::RootDir => current.push(part.as_os_str()),
                        Component::CurDir => {}
                        Component::ParentDir => prefix_items.push(OsString::from("..")),
                        Component::Normal(seg) => prefix_items.push(seg.to_os_string()),
                    }
                }
                for item in prefix_items.into_iter().rev() {
                    queue.push_front(item);
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "`{}` cannot be resolved: {error}",
                    current.display()
                ));
            }
        }
    }

    // Re-base onto the canonical form of the deepest existing ancestor so platform aliases
    // (such as `/var` -> `/private/var` on macOS or `\\?\` on Windows) match `canonicalize`.
    let components: Vec<Component<'_>> = current.components().collect();
    for split in (1..=components.len()).rev() {
        let mut prefix = PathBuf::new();
        for part in &components[..split] {
            prefix.push(part.as_os_str());
        }
        if let Ok(mut resolved) = std::fs::canonicalize(&prefix) {
            for part in &components[split..] {
                if let Component::Normal(segment) = part {
                    resolved.push(segment);
                }
            }
            return Ok(resolved);
        }
    }
    Ok(current)
}

/// `relative` joined to `root`, which must stay inside it once symlinks are resolved.
fn confined(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(format!(
            "`{relative}` must be a relative path inside the plugin directory"
        ));
    }
    let canonical_root = resolve_path(root)?;
    let resolved = resolve_path(&canonical_root.join(path))?;
    if resolved.starts_with(&canonical_root) {
        Ok(resolved)
    } else {
        Err(format!("`{relative}` leaves the plugin directory"))
    }
}

/// The tools of one server, settled into commands and diagnostics.
struct Plan<'a> {
    request: &'a Request<'a>,
    mount: &'a MountDecl,
    prefix: &'a str,
    bearer_configured: bool,
    connection: &'a Arc<Mount>,
    commands: Vec<(CommandDefinition, Value)>,
    advertised: BTreeMap<String, Value>,
    tools: Vec<MountToolReport>,
    skipped: Vec<SkippedTool>,
    warnings: Vec<ScanWarning>,
}

impl<'a> Plan<'a> {
    fn new(
        request: &'a Request<'a>,
        mount: &'a MountDecl,
        prefix: &'a str,
        bearer_configured: bool,
        connection: &'a Arc<Mount>,
    ) -> Self {
        Self {
            request,
            mount,
            prefix,
            bearer_configured,
            connection,
            commands: Vec::new(),
            advertised: BTreeMap::new(),
            tools: Vec::new(),
            skipped: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn read_tools(&mut self, tools: &[Value]) -> Result<(), PluginError> {
        let instance = &self.request.instance.id;
        let listed: BTreeSet<&str> = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect();
        // The deployer asked for these by name: a typo must not quietly serve fewer tools.
        let named = self
            .mount
            .only
            .iter()
            .flatten()
            .map(String::as_str)
            .chain(self.mount.tools.iter().map(|tool| tool.tool.as_str()));
        for name in named {
            if !listed.contains(name) {
                return Err(PluginError::load_failed(
                    instance,
                    format!("the manifest names the tool `{name}`, which the server does not list"),
                ));
            }
        }
        let mut taken_here: BTreeMap<String, String> = BTreeMap::new();
        for tool in tools {
            let Some(original) = tool.get("name").and_then(Value::as_str) else {
                continue;
            };
            if let Some(only) = &self.mount.only
                && !only.iter().any(|name| name == original)
            {
                continue;
            }
            // The meta-tools of an AFD server (`afd-call`, `afd-batch`, `afd-pipe`) are its
            // tool surface, not its commands, and `afd-call` would reach every remote command
            // past the `only` list, the effects and `bind_space`.
            if afd::is_afd_builtin_name(original) {
                continue;
            }
            let over = self.mount.tools.iter().find(|entry| entry.tool == original);
            // `only` or an override naming the tool means the deployer asked for it.
            let asked = over.is_some() || self.mount.only.is_some();
            let name = match mount_command_name(
                &self.mount.prefix,
                self.prefix,
                original,
                over.and_then(|entry| entry.name.as_deref()),
            ) {
                Ok(name) => name,
                Err(problem) => {
                    self.skip(original, codes::PLUGIN_TOOL_UNNAMEABLE, problem, asked)?;
                    continue;
                }
            };
            if let Some(other) = taken_here.insert(name.clone(), original.to_owned()) {
                return Err(PluginError::conflict(format!(
                    "plugin instance `{instance}`: the tools `{other}` and `{original}` both map to the command `{name}`"
                )));
            }
            check_name(&name, instance, self.request.taken)?;
            self.add_tool(tool, original, name, over, asked)?;
        }
        Ok(())
    }

    fn skip(
        &mut self,
        tool: &str,
        code: &'static str,
        message: String,
        asked: bool,
    ) -> Result<(), PluginError> {
        if asked {
            return Err(PluginError::load_failed(
                &self.request.instance.id,
                format!("the tool `{tool}` cannot be mounted: {message}"),
            ));
        }
        self.skipped.push(SkippedTool {
            tool: tool.to_owned(),
            code,
            message,
        });
        Ok(())
    }

    fn add_tool(
        &mut self,
        tool: &Value,
        original: &str,
        name: String,
        over: Option<&MountTool>,
        asked: bool,
    ) -> Result<(), PluginError> {
        let instance = &self.request.instance.id;
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .map_or_else(
                || format!("The `{original}` tool of the `{instance}` mounted server"),
                str::to_owned,
            );
        let advertised = tool
            .get("inputSchema")
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object" }));
        let (validation, stripped) = schema::strip_unsupported(&advertised);
        if let Err(problem) = trial(&name, &validation, &advertised) {
            return self.skip(
                original,
                codes::PLUGIN_TOOL_SCHEMA_UNSUPPORTED,
                problem,
                asked,
            );
        }

        // Untrusted text, served either way; a match is a warning.
        for hit in scan_description(&description) {
            self.warnings.push(ScanWarning {
                tool: original.to_owned(),
                location: "description".to_owned(),
                pattern: hit.pattern.to_owned(),
            });
        }
        for key in ["inputSchema", "outputSchema"] {
            if let Some(schema) = tool.get(key) {
                for (pointer, hit) in scan_schema_descriptions(schema) {
                    self.warnings.push(ScanWarning {
                        tool: original.to_owned(),
                        location: format!("{key}{pointer}"),
                        pattern: hit.pattern.to_owned(),
                    });
                }
            }
        }

        let effects: Vec<Effect> = over
            .and_then(|entry| entry.effects.clone())
            .unwrap_or_else(|| vec![Effect::External]);
        let mutation = effects.iter().any(|effect| effect.mutation());
        let bind_space = over.is_some_and(|entry| entry.bind_space);
        if bind_space && !schema::has_space(&advertised) {
            return Err(PluginError::manifest_invalid(
                &self.request.manifest.file,
                "mount.tools.bind_space",
                format!("is true for `{original}`, but the tool has no `space` argument to bind"),
            ));
        }
        let first_class = over.is_some_and(|entry| entry.first_class);
        let returns = tool
            .get("outputSchema")
            .and_then(|output| serde_json::from_value::<JsonSchema>(output.clone()).ok());
        let mut origin = json!({
            "plugin": instance,
            "kind": "mounted",
            "version": self.request.manifest.plugin.version,
            "effects": effects.iter().map(|effect| effect.as_str()).collect::<Vec<_>>(),
            "tool": original,
        });
        if stripped && let Some(object) = origin.as_object_mut() {
            object.insert("inputSchema".to_owned(), advertised.clone());
        }
        let mut definition = CommandDefinition::new(
            &name,
            &description,
            vec![],
            MountedHandler {
                mount: Arc::clone(self.connection),
                tool: original.to_owned(),
                workspace: bind_space.then(|| Arc::clone(self.request.workspace)),
            },
        )
        .with_expose(
            afd::ExposeOptions::new()
                .with_palette(false)
                .with_mcp(true)
                .with_agent(true)
                .with_cli(true),
        )
        .with_tool_meta(ORIGIN_KEY, origin);
        if let Some(prompt) = over.and_then(|entry| entry.confirm_prompt.as_ref()) {
            definition = definition.with_confirm_prompt(prompt);
        }
        if over.is_some_and(|entry| entry.destructive) {
            definition = definition.with_destructive(true);
        }
        if let Some(policy) = over.and_then(|entry| entry.approval.policy()) {
            definition = definition.with_approval(policy);
        }
        if let Some(returns) = returns {
            definition = definition.with_returns(returns);
        }
        if mutation {
            definition = definition.as_mutation();
        }
        if stripped {
            self.advertised.insert(name.clone(), advertised);
        }
        self.commands.push((definition, validation));
        self.tools.push(MountToolReport {
            tool: original.to_owned(),
            command: name,
            description,
            effects,
            mutation,
            bind_space,
            first_class,
        });
        Ok(())
    }

    /// Step 5 for a mount: a command that is not bound to a space needs the default space.
    fn check_spaces(&self) -> Result<(), PluginError> {
        let default = self.request.workspace.default_space().to_string();
        if let Some(tool) = self.tools.iter().find(|tool| !tool.bind_space)
            && !self.request.spaces.contains(&default)
        {
            return Err(PluginError::config_invalid(
                &self.request.instance.id,
                "spaces",
                format!(
                    "must include the default space `{default}`: the mounted command `{}` has no bound space (bind_space = false)",
                    tool.command
                ),
            ));
        }
        Ok(())
    }

    fn finish(self) -> Built {
        let gate = self
            .tools
            .iter()
            .map(|tool| {
                (
                    tool.command.clone(),
                    GateEntry {
                        instance: self.request.instance.id.clone(),
                        kind: super::manifest::PluginKind::Mounted,
                        spaces: self.request.spaces.to_vec(),
                        space_command: tool.bind_space,
                        spaces_command: false,
                        require_human: false,
                        person: None,
                        preview: None,
                        shown: Vec::new(),
                        pipeline: false,
                        memory_writer: false,
                        lane_writer: false,
                        digest: None,
                        authority_prompt: None,
                        steps: Vec::new(),
                    },
                )
            })
            .collect();
        Built {
            commands: self.commands,
            advertised: self.advertised,
            gate,
            report: MountReport {
                prefix: self.prefix.to_owned(),
                transport: self.mount.transport,
                bearer_configured: self.bearer_configured,
                tools: self.tools,
                skipped: self.skipped,
                warnings: self.warnings,
            },
        }
    }
}

struct Unused;

#[async_trait]
impl CommandHandler for Unused {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        afd::success(Value::Null)
    }
}

fn placeholder(name: &str) -> CommandDefinition {
    CommandDefinition::new(name, "placeholder", vec![], Unused)
}

/// Whether the registry takes the command with these schemas, and the checker's message if not.
/// Nothing is registered anywhere real: a failing instance never leaves part of itself behind.
fn trial(name: &str, validation: &Value, advertised: &Value) -> Result<(), String> {
    CommandRegistry::new()
        .register_with_schemas(placeholder(name), validation.clone(), advertised.clone())
        .map_err(|message| format!("the input schema is not supported ({message})"))
}

/// A mounted tool as a command: the call goes to the server by its original name with the input
/// as arguments, and nothing else crosses (D43).
struct MountedHandler {
    mount: Arc<Mount>,
    tool: String,
    /// Set when `bind_space = true`: the `space` argument is Umbel's, resolved and forwarded as
    /// the resolved space id.
    workspace: Option<Arc<Workspace>>,
}

#[async_trait]
impl CommandHandler for MountedHandler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let mut arguments = match input {
            Value::Object(map) => map,
            Value::Null => Map::new(),
            other => {
                return afd::failure(
                    afd::CommandError::new(
                        afd::error_codes::VALIDATION_ERROR,
                        format!("the input must be an object, not {other}"),
                    )
                    .with_suggestion("Pass the tool's arguments as a JSON object."),
                );
            }
        };
        if let Some(workspace) = &self.workspace {
            match workspace.resolve_space(&Value::Object(arguments.clone()), &context) {
                Ok(space) => {
                    arguments.insert("space".to_owned(), Value::String(space.to_string()));
                }
                Err(error) => return afd::failure(error),
            }
        }
        self.mount.call(&self.tool, arguments).await
    }
}

/// Build the cleared child environment: `PATH` (plus `SystemRoot` on Windows), then `manifest_env`,
/// then `instance_env`. On Windows, later layers replace earlier ones case-insensitively so an
/// override like `SYSTEMROOT` never collides with the host baseline `SystemRoot`.
fn build_child_env(
    host_var: impl Fn(&str) -> Option<String>,
    windows: bool,
    manifest_env: &BTreeMap<String, String>,
    instance_env: &BTreeMap<String, String>,
) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    let mut insert = |name: String, value: String| {
        if let Some(existing) = env.iter_mut().find(|(key, _)| {
            if windows {
                key.eq_ignore_ascii_case(&name)
            } else {
                *key == name
            }
        }) {
            *existing = (name, value);
        } else {
            env.push((name, value));
        }
    };
    if let Some(path) = host_var("PATH") {
        insert("PATH".to_owned(), path);
    }
    if windows && let Some(system_root) = host_var("SystemRoot") {
        insert("SystemRoot".to_owned(), system_root);
    }
    for (name, value) in manifest_env {
        insert(name.clone(), value.clone());
    }
    for (name, value) in instance_env {
        insert(name.clone(), value.clone());
    }
    env
}

#[cfg(test)]
mod tests {
    use super::{build_child_env, confined, program, resolve_on_child_path, resolve_path};
    use std::collections::BTreeMap;
    use std::fs;

    fn map(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    fn host<'a>(entries: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            entries
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn non_windows_child_env_keeps_only_path_and_configured_vars() {
        let host_vars = [
            ("PATH", "/usr/bin"),
            ("SystemRoot", "C:\\Windows"),
            ("SECRET_TOKEN", "do-not-leak"),
        ];
        let manifest = map(&[("A", "from-manifest"), ("B", "from-manifest")]);
        let instance = map(&[("B", "from-instance"), ("C", "from-instance")]);

        let env = build_child_env(host(&host_vars), false, &manifest, &instance);
        assert_eq!(
            env,
            vec![
                ("PATH".to_owned(), "/usr/bin".to_owned()),
                ("A".to_owned(), "from-manifest".to_owned()),
                ("B".to_owned(), "from-instance".to_owned()),
                ("C".to_owned(), "from-instance".to_owned()),
            ]
        );
    }

    #[test]
    fn windows_child_env_keeps_path_and_system_root_only_from_host() {
        let host_vars = [
            ("PATH", "C:\\Windows\\System32"),
            ("SystemRoot", "C:\\Windows"),
            ("TEMP", "C:\\Users\\alice\\AppData\\Local\\Temp"),
            ("SECRET_TOKEN", "do-not-leak"),
        ];
        let manifest = map(&[("APP_MODE", "prod")]);
        let instance = map(&[("APP_PORT", "8080")]);

        let env = build_child_env(host(&host_vars), true, &manifest, &instance);
        assert_eq!(
            env,
            vec![
                ("PATH".to_owned(), "C:\\Windows\\System32".to_owned()),
                ("SystemRoot".to_owned(), "C:\\Windows".to_owned()),
                ("APP_MODE".to_owned(), "prod".to_owned()),
                ("APP_PORT".to_owned(), "8080".to_owned()),
            ]
        );
    }

    #[test]
    fn windows_child_env_overrides_baseline_case_insensitively_without_duplicates() {
        let host_vars = [
            ("PATH", "C:\\Windows\\System32"),
            ("SystemRoot", "C:\\Windows"),
        ];
        let manifest = map(&[("SYSTEMROOT", "D:\\ManifestRoot")]);
        let instance = map(&[("systemroot", "E:\\InstanceRoot"), ("Path", "E:\\Bin")]);

        let env = build_child_env(host(&host_vars), true, &manifest, &instance);
        assert_eq!(
            env,
            vec![
                ("Path".to_owned(), "E:\\Bin".to_owned()),
                ("systemroot".to_owned(), "E:\\InstanceRoot".to_owned()),
            ]
        );
    }

    #[test]
    fn resolve_path_canonicalizes_ancestor_for_missing_leaves() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let missing = dir.path().join("state").join("missing").join("sub");
        assert_eq!(
            resolve_path(&missing).unwrap(),
            root.join("state").join("missing").join("sub")
        );
    }

    #[test]
    fn confined_and_bare_program_refuse_symlink_escapes_and_trailing_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside");
        let plugin = dir.path().join("plugin");
        let state = resolve_path(&dir.path().join("state")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(&plugin).unwrap();
        fs::create_dir_all(plugin.join("node")).unwrap();
        fs::write(outside.join("tool"), "x").unwrap();
        fs::write(plugin.join("regular"), "x").unwrap();

        // A subdirectory sharing a bare command name does not shadow PATH resolution.
        assert_eq!(
            program(&plugin, "node", &[], &plugin, &state).unwrap(),
            std::ffi::OsString::from("node")
        );

        // Trailing separators on commands are refused rather than stripped.
        assert!(program(&plugin, "regular/", &[], &plugin, &state).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("tool"), plugin.join("tool")).unwrap();
            std::os::unix::fs::symlink(&outside, plugin.join("linkdir")).unwrap();
            std::os::unix::fs::symlink(
                dir.path().join("state").join("missing"),
                plugin.join("dangling"),
            )
            .unwrap();

            assert!(confined(&plugin, "linkdir/missing").is_err());
            assert!(confined(&plugin, "dangling").is_err());
            assert!(program(&plugin, "tool", &[], &plugin, &state).is_err());
            assert!(program(&plugin, "dangling", &[], &plugin, &state).is_err());
        }
    }

    #[test]
    fn resolve_on_child_path_refuses_state_and_returns_absolute_executable() {
        let dir = tempfile::tempdir().unwrap();
        let decoy_dir = dir.path().join("decoy");
        let bin_dir = dir.path().join("state").join("bin");
        let good_dir = dir.path().join("good");
        fs::create_dir_all(&decoy_dir).unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&good_dir).unwrap();
        let binary_name = if cfg!(windows) { "tool.exe" } else { "tool" };
        // Non-executable decoy ahead of state/bin on Unix must not hide the state/bin match.
        #[cfg(unix)]
        fs::write(decoy_dir.join(binary_name), "x").unwrap();
        fs::write(bin_dir.join(binary_name), "x").unwrap();

        let state = resolve_path(&dir.path().join("state")).unwrap();
        let path_env = std::env::join_paths([&decoy_dir, &bin_dir])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let env = vec![("PATH".to_owned(), path_env)];
        assert!(resolve_on_child_path("tool", &env, dir.path(), &state).is_err());

        // An executable outside `state/` resolves to its canonical absolute path.
        let good_bin = good_dir.join(binary_name);
        fs::write(&good_bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&good_bin, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let ok_path = std::env::join_paths([&good_dir, &bin_dir])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let ok_env = vec![("PATH".to_owned(), ok_path)];
        let resolved = resolve_on_child_path("tool", &ok_env, dir.path(), &state)
            .unwrap()
            .unwrap();
        assert_eq!(resolved, fs::canonicalize(&good_bin).unwrap());
    }
}
