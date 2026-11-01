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

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::{Component, Path};
use std::sync::Arc;
use std::time::Duration;

use afd::{
    ApprovalPolicy, CommandContext, CommandDefinition, CommandHandler, CommandRegistry,
    CommandResult, JsonSchema,
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
            let program = program(request.root, first).map_err(|problem| {
                PluginError::manifest_invalid(&request.manifest.file, "mount.command", problem)
            })?;
            let cwd = match &mount.cwd {
                Some(relative) => confined(request.root, relative).map_err(|problem| {
                    PluginError::manifest_invalid(&request.manifest.file, "mount.cwd", problem)
                })?,
                None => request.root.to_path_buf(),
            };
            // `PATH` plus the manifest's defaults, overridden by the instance's: nothing else
            // of the host's environment reaches the child.
            let mut env: BTreeMap<String, String> = BTreeMap::new();
            if let Ok(path) = std::env::var("PATH") {
                env.insert("PATH".to_owned(), path);
            }
            env.extend(mount.env.clone());
            env.extend(instance.env.clone());
            Endpoint::Stdio(StdioSpec {
                program,
                args: mount.command.iter().skip(1).cloned().collect(),
                cwd,
                env: env.into_iter().collect(),
            })
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

/// The program to start: the plugin's own file when the first element names one inside the plugin
/// root, else the name as given, which the operating system finds on `PATH`.
fn program(root: &Path, first: &str) -> Result<OsString, String> {
    let has_separator = first.contains('/') || first.contains('\\');
    if !has_separator {
        let inside = root.join(first);
        return Ok(if inside.is_file() {
            inside.into_os_string()
        } else {
            OsString::from(first)
        });
    }
    confined(root, first).map(std::path::PathBuf::into_os_string)
}

/// `relative` joined to `root`, which must stay inside it once symlinks are resolved.
fn confined(root: &Path, relative: &str) -> Result<std::path::PathBuf, String> {
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
    let joined = root.join(path);
    // A path that does not exist yet stays as written (the spawn reports it); one that does is
    // resolved, so a symbolic link cannot lead out of the plugin directory.
    let resolved = std::fs::canonicalize(&joined).unwrap_or(joined);
    if resolved.starts_with(root) {
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
        if over.is_some_and(|entry| entry.approval_required) {
            definition = definition.with_approval(ApprovalPolicy::Required);
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
