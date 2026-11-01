//! `umbel-plugin.toml`, manifest version 1 (specification section 2, D37).
//!
//! [`Manifest::parse`] reads and validates the text; [`Manifest::validate_files`] checks what it
//! names on disk; [`Manifest::load`] does both for a plugin directory. Every failure is a
//! `PLUGIN_MANIFEST_INVALID` naming the file and the key, except a `manifest_version` or
//! `protocol` this host does not serve, which is `PLUGIN_PROTOCOL_UNSUPPORTED`.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;

use afd::{CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult};
use async_trait::async_trait;
use serde_json::Value;
use toml::{Table, Value as Toml};

use super::error::PluginError;
use super::files::{DirFiles, PluginFiles, lexical_problem};
use super::{
    HOST_DOMAINS, MANIFEST_FILE, MANIFEST_VERSION, PLUGIN_PROTOCOL_VERSION, domain_problem,
    is_kebab_id, is_plugin_id, is_semver,
};

/// The largest `component.path` file the host compiles.
pub const MAX_COMPONENT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

const TOP_KEYS: &[&str] = &[
    "manifest_version",
    "protocol",
    "plugin",
    "component",
    "mount",
    "grants",
    "commands",
    "contexts",
    "pipelines",
    "packs",
    "skills",
    "config",
];
/// Keys manifest version 1 names and refuses, with what each waits for (D36's rule).
const TOP_RESERVED: &[(&str, &str)] = &[
    (
        "ui",
        "Loam's UI contributions: surfaces, layout preset, document types; a later manifest version defines it",
    ),
    (
        "connectors",
        "federation's connector contract, after open decision O1",
    ),
    ("backends", "store backends contributed by plugins, phase 6"),
    (
        "dependencies",
        "never: plugins do not depend on each other (D3)",
    ),
    ("signature", "signed plugins, after watch row W9"),
    ("scopes", "per-command scopes, phase 5"),
    ("on_conflict", "version 1 fixes it to `error`"),
];
const PLUGIN_KEYS: &[&str] = &[
    "id",
    "title",
    "version",
    "description",
    "kind",
    "domains",
    "homepage",
    "license",
];
const COMPONENT_KEYS: &[&str] = &["path"];
const GRANT_KEYS: &[&str] = &["name", "required", "reason"];
const GRANT_RESERVED: &[(&str, &str)] = &[(
    "allow",
    "the per-instance allow-list of the future http, secrets and write grants; allow-lists live in umbel.toml",
)];
const COMMAND_KEYS: &[&str] = &[
    "name",
    "description",
    "effects",
    "input_schema",
    "returns",
    "category",
    "tags",
    "version",
    "contexts",
    "first_class",
    "confirm_prompt",
    "destructive",
    "approval",
    "execution_time",
    "expose",
    "examples",
];
const COMMAND_RESERVED: &[(&str, &str)] = &[("scopes", "per-command scopes, phase 5")];
const EXPOSE_KEYS: &[&str] = &["mcp", "agent", "cli", "palette"];
const CONTEXT_KEYS: &[&str] = &["name", "description", "triggers", "priority"];
const PIPELINE_KEYS: &[&str] = &["name", "description", "effects", "input_schema", "steps"];
const STEP_KEYS: &[&str] = &["command", "input", "as"];
const PACK_KEYS: &[&str] = &["id", "path"];
const SKILL_KEYS: &[&str] = &["name", "path"];
const CONFIG_KEYS: &[&str] = &["schema"];
const MOUNT_KEYS: &[&str] = &[
    "prefix",
    "transport",
    "command",
    "cwd",
    "env",
    "bearer",
    "only",
    "tools",
];
const MOUNT_TOOL_KEYS: &[&str] = &[
    "tool",
    "name",
    "effects",
    "bind_space",
    "confirm_prompt",
    "approval",
    "first_class",
];
/// A mount's `url` and `bearer_env` are the deployer's: they live in `umbel.toml`.
const MOUNT_DEPLOYER_KEYS: &[(&str, &str)] = &[
    (
        "url",
        "where a mount runs is the deployer's; set plugins.<id>.url in umbel.toml",
    ),
    (
        "bearer_env",
        "a mount's credential is the deployer's; set plugins.<id>.bearer_env in umbel.toml",
    ),
];

/// How a plugin's code runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginKind {
    /// A Rust crate linked into the host binary.
    Compiled,
    /// A WebAssembly component.
    Component,
    /// An external MCP server.
    Mounted,
    /// No code: packs and skills only.
    Pack,
}

impl PluginKind {
    /// The manifest's spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Compiled => "compiled",
            Self::Component => "component",
            Self::Mounted => "mounted",
            Self::Pack => "pack",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "compiled" => Self::Compiled,
            "component" => Self::Component,
            "mounted" => Self::Mounted,
            "pack" => Self::Pack,
            _ => return None,
        })
    }
}

impl fmt::Display for PluginKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What a command may change (specification section 7.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Effect {
    /// Changes nothing anywhere.
    Inspect,
    /// Changes state the plugin keeps itself.
    PluginState,
    /// Acts on a system outside the host.
    External,
}

impl Effect {
    /// The manifest's spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inspect => "inspect",
            Self::PluginState => "plugin-state",
            Self::External => "external",
        }
    }

    /// Whether a command with this effect is a mutation.
    pub fn mutation(self) -> bool {
        self != Self::Inspect
    }
}

/// `[plugin]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PluginInfo {
    /// The plugin id; the default instance id.
    pub id: String,
    /// The display title.
    pub title: String,
    /// The plugin's semantic version.
    pub version: String,
    /// One or two sentences.
    pub description: String,
    /// How the code runs.
    pub kind: PluginKind,
    /// The first name segments the plugin's commands use; empty for a pack plugin.
    pub domains: Vec<String>,
    /// An https URL.
    pub homepage: Option<String>,
    /// An SPDX expression.
    pub license: Option<String>,
}

/// `[component]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ComponentDecl {
    /// The component file, relative to the plugin root.
    pub path: String,
}

/// A JSON Schema as the manifest gives it: inline, or the path of a JSON file.
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaRef {
    /// A table in the manifest.
    Inline(Value),
    /// A path relative to the plugin root.
    File(String),
}

impl SchemaRef {
    /// The schema itself, reading the file when it is one.
    ///
    /// # Errors
    /// A sentence saying why the file cannot be read or is not a JSON object.
    pub fn load(&self, files: &dyn PluginFiles) -> Result<Value, String> {
        match self {
            Self::Inline(value) => Ok(value.clone()),
            Self::File(path) => {
                let bytes = files.read(path)?;
                let value: Value = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("`{path}` is not valid JSON: {error}"))?;
                if value.is_object() {
                    Ok(value)
                } else {
                    Err(format!("`{path}` must hold a JSON object"))
                }
            }
        }
    }
}

/// `[[grants]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct GrantDecl {
    /// The grant's name.
    pub name: String,
    /// Whether a denial fails the load.
    pub required: bool,
    /// Why the plugin needs it; shown to the deployer.
    pub reason: String,
}

/// One entry of `expose`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct Expose {
    /// Over MCP.
    pub mcp: bool,
    /// To in-process agents.
    pub agent: bool,
    /// In the CLI.
    pub cli: bool,
    /// In the command palette.
    pub palette: bool,
}

impl Default for Expose {
    fn default() -> Self {
        Self {
            mcp: true,
            agent: true,
            cli: true,
            palette: false,
        }
    }
}

/// `[[commands]]`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct CommandDecl {
    /// The command name, `domain-action`.
    pub name: String,
    /// What it does.
    pub description: String,
    /// What it may change.
    pub effects: Vec<Effect>,
    /// The input schema.
    pub input_schema: SchemaRef,
    /// The result's `data` schema.
    pub returns: Option<SchemaRef>,
    /// The command category.
    pub category: Option<String>,
    /// Tags.
    pub tags: Vec<String>,
    /// The command's own version.
    pub version: Option<String>,
    /// AFD contexts the command belongs to.
    pub contexts: Vec<String>,
    /// A suggestion for the first-class tool set.
    pub first_class: bool,
    /// The confirmation prompt; none means no confirmation.
    pub confirm_prompt: Option<String>,
    /// Whether the command destroys data.
    pub destructive: bool,
    /// Whether an approval is required.
    pub approval_required: bool,
    /// `instant`, `fast`, `slow` or `long-running`.
    pub execution_time: Option<String>,
    /// The plugin's default exposure.
    pub expose: Expose,
    /// `(title, input)` examples.
    pub examples: Vec<(String, Value)>,
}

impl CommandDecl {
    /// Whether the command is a mutation, derived from its effects.
    pub fn mutation(&self) -> bool {
        self.effects.iter().any(|effect| effect.mutation())
    }
}

/// `[[contexts]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ContextDecl {
    /// The context name; starts with one of the plugin's domains.
    pub name: String,
    /// What the context scopes.
    pub description: String,
    /// Words that suggest the context.
    pub triggers: Vec<String>,
    /// Ordering among contexts.
    pub priority: i64,
}

/// One step of a pipeline.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct PipelineStep {
    /// The command to run.
    pub command: String,
    /// Its input; strings may be `$input.*` and `$steps.*` references.
    pub input: Option<Value>,
    /// The alias later steps reference.
    pub alias: Option<String>,
}

/// `[[pipelines]]`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct PipelineDecl {
    /// The pipeline's command name.
    pub name: String,
    /// What it does.
    pub description: String,
    /// What it may change; must cover its steps'.
    pub effects: Vec<Effect>,
    /// The input schema.
    pub input_schema: SchemaRef,
    /// The steps, in order.
    pub steps: Vec<PipelineStep>,
}

/// `[[packs]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PackDecl {
    /// The pack id.
    pub id: String,
    /// The pack directory, relative to the plugin root.
    pub path: String,
}

/// `[[skills]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct SkillDecl {
    /// The skill name; equals its directory's last segment.
    pub name: String,
    /// The skill directory, relative to the plugin root.
    pub path: String,
}

/// `[config]`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ConfigDecl {
    /// The instance configuration schema.
    pub schema: SchemaRef,
}

/// How a mounted server is reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// A child process speaking MCP over stdio.
    Stdio,
    /// Streamable HTTP.
    Http,
}

/// Whether an HTTP mount needs a bearer token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bearer {
    /// The server needs none.
    None,
    /// The server accepts one.
    Optional,
    /// The server needs one.
    Required,
}

/// `[[mount.tools]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct MountTool {
    /// The server's tool name.
    pub tool: String,
    /// The command name, relative to the prefix.
    pub name: Option<String>,
    /// Overrides the default `["external"]`.
    pub effects: Option<Vec<Effect>>,
    /// Whether the tool's `space` argument is Umbel's space.
    pub bind_space: bool,
    /// The confirmation prompt.
    pub confirm_prompt: Option<String>,
    /// Whether an approval is required.
    pub approval_required: bool,
    /// A suggestion for the first-class tool set.
    pub first_class: bool,
}

/// `[mount]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct MountDecl {
    /// The prefix the tools are renamed under; one of the plugin's domains.
    pub prefix: String,
    /// How the server is reached.
    pub transport: Transport,
    /// The child's command line (stdio).
    pub command: Vec<String>,
    /// The child's working directory, inside the plugin root (stdio).
    pub cwd: Option<String>,
    /// Defaults for the child's environment (stdio); no secrets.
    pub env: BTreeMap<String, String>,
    /// Whether the server needs a bearer token (http).
    pub bearer: Bearer,
    /// An allow-list of original tool names.
    pub only: Option<Vec<String>>,
    /// Per-tool overrides.
    pub tools: Vec<MountTool>,
}

/// A validated manifest, version 1.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Manifest {
    /// Where the text came from, for messages.
    pub file: String,
    /// `[plugin]`.
    pub plugin: PluginInfo,
    /// `[component]`.
    pub component: Option<ComponentDecl>,
    /// `[mount]`.
    pub mount: Option<MountDecl>,
    /// `[[grants]]`.
    pub grants: Vec<GrantDecl>,
    /// `[[commands]]`.
    pub commands: Vec<CommandDecl>,
    /// `[[contexts]]`.
    pub contexts: Vec<ContextDecl>,
    /// `[[pipelines]]`.
    pub pipelines: Vec<PipelineDecl>,
    /// `[[packs]]`.
    pub packs: Vec<PackDecl>,
    /// `[[skills]]`.
    pub skills: Vec<SkillDecl>,
    /// `[config]`.
    pub config: Option<ConfigDecl>,
}

impl Manifest {
    /// Read and validate the manifest of the plugin directory `dir`, and the files it names.
    ///
    /// # Errors
    /// `PLUGIN_MANIFEST_INVALID` or `PLUGIN_PROTOCOL_UNSUPPORTED`.
    pub fn load(dir: impl AsRef<Path>) -> Result<Self, PluginError> {
        let dir = dir.as_ref();
        let file = dir.join(MANIFEST_FILE).display().to_string();
        let files = DirFiles::new(dir)
            .map_err(|error| PluginError::manifest_invalid(&file, MANIFEST_FILE, error))?;
        let size = files
            .len(MANIFEST_FILE)
            .map_err(|problem| PluginError::manifest_invalid(&file, MANIFEST_FILE, problem))?;
        if size > MAX_MANIFEST_BYTES {
            return Err(PluginError::manifest_invalid(
                &file,
                MANIFEST_FILE,
                format!("is {size} bytes; the limit is {MAX_MANIFEST_BYTES}"),
            ));
        }
        let bytes = files
            .read(MANIFEST_FILE)
            .map_err(|problem| PluginError::manifest_invalid(&file, MANIFEST_FILE, problem))?;
        let text = String::from_utf8(bytes).map_err(|_| {
            PluginError::manifest_invalid(&file, MANIFEST_FILE, "is not valid UTF-8")
        })?;
        let manifest = Self::parse(&text, &file)?;
        manifest.validate_files(&files)?;
        Ok(manifest)
    }

    /// Validate the manifest `text`; `file` names it in messages. Reads no file: see
    /// [`validate_files`](Self::validate_files).
    ///
    /// # Errors
    /// `PLUGIN_MANIFEST_INVALID` or `PLUGIN_PROTOCOL_UNSUPPORTED`.
    pub fn parse(text: &str, file: &str) -> Result<Self, PluginError> {
        let table: Table = text.parse().map_err(|error: toml::de::Error| {
            let line = error.span().map(|span| {
                format!(
                    " (line {})",
                    text[..span.start.min(text.len())].matches('\n').count() + 1
                )
            });
            PluginError::manifest_invalid(
                file,
                MANIFEST_FILE,
                format!(
                    "is not valid TOML: {}{}",
                    error.message(),
                    line.unwrap_or_default()
                ),
            )
        })?;
        let root = Tbl::root(&table, file);
        root.version("manifest_version", MANIFEST_VERSION)?;
        root.version("protocol", PLUGIN_PROTOCOL_VERSION)?;
        root.check_keys(TOP_KEYS, TOP_RESERVED)?;

        let plugin = plugin_info(&root)?;
        let manifest = Self {
            file: file.to_owned(),
            component: component(&root, plugin.kind)?,
            mount: mount(&root, &plugin)?,
            grants: grants(&root, plugin.kind)?,
            commands: commands(&root, &plugin)?,
            contexts: contexts(&root, &plugin)?,
            pipelines: pipelines(&root, &plugin)?,
            packs: packs(&root)?,
            skills: skills(&root, &plugin)?,
            config: config(&root)?,
            plugin,
        };
        manifest.check_names()?;
        Ok(manifest)
    }

    /// Check the files the manifest names: schemas parse and pass their checks, the component
    /// exists within its size cap, every pack and skill directory exists.
    ///
    /// # Errors
    /// `PLUGIN_MANIFEST_INVALID` naming the key.
    pub fn validate_files(&self, files: &dyn PluginFiles) -> Result<(), PluginError> {
        let bad =
            |key: String, problem: String| PluginError::manifest_invalid(&self.file, &key, problem);
        for (index, command) in self.commands.iter().enumerate() {
            let key = format!("commands[{index}]");
            if let SchemaRef::File(_) = command.input_schema {
                let schema = command
                    .input_schema
                    .load(files)
                    .map_err(|problem| bad(format!("{key}.input_schema"), problem))?;
                check_input_schema(&schema)
                    .map_err(|problem| bad(format!("{key}.input_schema"), problem))?;
            }
            if let Some(returns) = &command.returns {
                returns
                    .load(files)
                    .map_err(|problem| bad(format!("{key}.returns"), problem))?;
            }
        }
        for (index, pipeline) in self.pipelines.iter().enumerate() {
            if let SchemaRef::File(_) = pipeline.input_schema {
                let schema = pipeline
                    .input_schema
                    .load(files)
                    .map_err(|problem| bad(format!("pipelines[{index}].input_schema"), problem))?;
                check_input_schema(&schema)
                    .map_err(|problem| bad(format!("pipelines[{index}].input_schema"), problem))?;
            }
        }
        if let Some(config) = &self.config {
            let schema = config
                .schema
                .load(files)
                .map_err(|problem| bad("config.schema".to_owned(), problem))?;
            check_config_schema(&schema)
                .map_err(|problem| bad("config.schema".to_owned(), problem))?;
        }
        if let Some(component) = &self.component {
            let size = files
                .len(&component.path)
                .map_err(|problem| bad("component.path".to_owned(), problem))?;
            if size > MAX_COMPONENT_BYTES {
                return Err(bad(
                    "component.path".to_owned(),
                    format!("is {size} bytes; the limit is {MAX_COMPONENT_BYTES}"),
                ));
            }
        }
        for (index, pack) in self.packs.iter().enumerate() {
            if !files.is_dir(&pack.path) {
                return Err(bad(
                    format!("packs[{index}].path"),
                    format!("`{}` is not a directory inside the plugin root", pack.path),
                ));
            }
        }
        for (index, skill) in self.skills.iter().enumerate() {
            let manifest_file = format!("{}/SKILL.md", skill.path.trim_end_matches('/'));
            if !files.is_dir(&skill.path) || !files.is_file(&manifest_file) {
                return Err(bad(
                    format!("skills[{index}].path"),
                    format!("`{}` is not a skill directory holding SKILL.md", skill.path),
                ));
            }
        }
        Ok(())
    }

    /// Whether the plugin's mount reaches its server over HTTP.
    pub fn is_http_mount(&self) -> bool {
        self.mount
            .as_ref()
            .is_some_and(|mount| mount.transport == Transport::Http)
    }

    /// Names that must be unique inside one manifest.
    fn check_names(&self) -> Result<(), PluginError> {
        let bad =
            |key: &str, problem: String| PluginError::manifest_invalid(&self.file, key, problem);
        let mut seen = BTreeSet::new();
        for (index, name) in self.commands.iter().map(|c| &c.name).enumerate() {
            if !seen.insert(name) {
                return Err(bad(
                    &format!("commands[{index}].name"),
                    format!("`{name}` is declared twice"),
                ));
            }
        }
        for (index, name) in self.pipelines.iter().map(|p| &p.name).enumerate() {
            if !seen.insert(name) {
                return Err(bad(
                    &format!("pipelines[{index}].name"),
                    format!("`{name}` is declared twice"),
                ));
            }
        }
        for (index, context) in self.contexts.iter().enumerate() {
            if self.contexts[..index]
                .iter()
                .any(|c| c.name == context.name)
            {
                return Err(bad(
                    &format!("contexts[{index}].name"),
                    format!("`{}` is declared twice", context.name),
                ));
            }
        }
        for (index, pack) in self.packs.iter().enumerate() {
            if self.packs[..index].iter().any(|p| p.id == pack.id) {
                return Err(bad(
                    &format!("packs[{index}].id"),
                    format!("`{}` is declared twice", pack.id),
                ));
            }
        }
        for (index, skill) in self.skills.iter().enumerate() {
            if self.skills[..index].iter().any(|s| s.name == skill.name) {
                return Err(bad(
                    &format!("skills[{index}].name"),
                    format!("`{}` is declared twice", skill.name),
                ));
            }
        }
        for (index, grant) in self.grants.iter().enumerate() {
            if self.grants[..index].iter().any(|g| g.name == grant.name) {
                return Err(bad(
                    &format!("grants[{index}].name"),
                    format!("`{}` is declared twice", grant.name),
                ));
            }
        }
        Ok(())
    }
}

// ── Reading the TOML ───────────────────────────────────────────────────────────────────────────

/// One table of the manifest, naming its dotted path in every error.
struct Tbl<'a> {
    table: &'a Table,
    path: String,
    file: &'a str,
}

impl<'a> Tbl<'a> {
    fn root(table: &'a Table, file: &'a str) -> Self {
        Self {
            table,
            path: String::new(),
            file,
        }
    }

    fn key(&self, key: &str) -> String {
        if self.path.is_empty() {
            key.to_owned()
        } else {
            format!("{}.{key}", self.path)
        }
    }

    fn bad(&self, key: &str, problem: impl fmt::Display) -> PluginError {
        PluginError::manifest_invalid(self.file, &self.key(key), problem)
    }

    /// Refuse every key that is neither known nor reserved, and every reserved one.
    fn check_keys(&self, known: &[&str], reserved: &[(&str, &str)]) -> Result<(), PluginError> {
        for key in self.table.keys() {
            if let Some((_, why)) = reserved.iter().find(|(name, _)| name == key) {
                return Err(self.bad(
                    key,
                    format!("is reserved ({why}); manifest version 1 does not define it"),
                ));
            }
            if !known.contains(&key.as_str()) {
                return Err(self.bad(key, "is not a known key"));
            }
        }
        Ok(())
    }

    /// `manifest_version` and `protocol`: required, and exactly `served`.
    fn version(&self, key: &str, served: u32) -> Result<(), PluginError> {
        match self.table.get(key) {
            None => Err(self.bad(key, format!("is required; set {key} = {served}"))),
            Some(Toml::Integer(value)) if *value == i64::from(served) => Ok(()),
            Some(Toml::Integer(value)) => {
                Err(PluginError::protocol_unsupported(self.file, key, value))
            }
            Some(_) => Err(self.bad(key, format!("must be the integer {served}"))),
        }
    }

    fn value(&self, key: &str) -> Option<&'a Toml> {
        self.table.get(key)
    }

    fn string(&self, key: &str) -> Result<Option<String>, PluginError> {
        match self.value(key) {
            None => Ok(None),
            Some(Toml::String(value)) => Ok(Some(value.clone())),
            Some(_) => Err(self.bad(key, "must be a string")),
        }
    }

    fn required_string(&self, key: &str) -> Result<String, PluginError> {
        self.string(key)?
            .ok_or_else(|| self.bad(key, "is required"))
    }

    /// A required string of `min..=max` characters without control characters.
    fn text(&self, key: &str, min: usize, max: usize) -> Result<String, PluginError> {
        let value = self.required_string(key)?;
        self.check_text(key, &value, min, max)?;
        Ok(value)
    }

    fn optional_text(&self, key: &str, max: usize) -> Result<Option<String>, PluginError> {
        let value = self.string(key)?;
        if let Some(value) = &value {
            self.check_text(key, value, 1, max)?;
        }
        Ok(value)
    }

    fn check_text(
        &self,
        key: &str,
        value: &str,
        min: usize,
        max: usize,
    ) -> Result<(), PluginError> {
        let length = value.chars().count();
        if !(min..=max).contains(&length) || value.chars().any(char::is_control) {
            return Err(self.bad(
                key,
                format!("must be {min} to {max} characters without control characters"),
            ));
        }
        Ok(())
    }

    fn boolean(&self, key: &str) -> Result<Option<bool>, PluginError> {
        match self.value(key) {
            None => Ok(None),
            Some(Toml::Boolean(value)) => Ok(Some(*value)),
            Some(_) => Err(self.bad(key, "must be true or false")),
        }
    }

    fn string_array(&self, key: &str) -> Result<Option<Vec<String>>, PluginError> {
        match self.value(key) {
            None => Ok(None),
            Some(Toml::Array(items)) => items
                .iter()
                .map(|item| match item {
                    Toml::String(value) if !value.is_empty() => Ok(value.clone()),
                    _ => Err(self.bad(key, "must hold only non-empty strings")),
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some),
            Some(_) => Err(self.bad(key, "must be an array of strings")),
        }
    }

    fn table(&self, key: &str) -> Result<Option<Tbl<'a>>, PluginError> {
        match self.value(key) {
            None => Ok(None),
            Some(Toml::Table(table)) => Ok(Some(Tbl {
                table,
                path: self.key(key),
                file: self.file,
            })),
            Some(_) => Err(self.bad(key, "must be a table")),
        }
    }

    fn tables(&self, key: &str) -> Result<Vec<Tbl<'a>>, PluginError> {
        match self.value(key) {
            None => Ok(Vec::new()),
            Some(Toml::Array(items)) => items
                .iter()
                .enumerate()
                .map(|(index, item)| match item {
                    Toml::Table(table) => Ok(Tbl {
                        table,
                        path: format!("{}[{index}]", self.key(key)),
                        file: self.file,
                    }),
                    _ => Err(self.bad(key, "must be an array of tables")),
                })
                .collect(),
            Some(_) => Err(self.bad(key, "must be an array of tables")),
        }
    }

    /// A relative path that stays inside the plugin root and, when `suffix` is set, ends in it.
    fn rel_path(&self, key: &str, suffix: Option<&str>) -> Result<String, PluginError> {
        let path = self.required_string(key)?;
        self.check_rel_path(key, &path, suffix)?;
        Ok(path)
    }

    fn check_rel_path(
        &self,
        key: &str,
        path: &str,
        suffix: Option<&str>,
    ) -> Result<(), PluginError> {
        if let Some(problem) = lexical_problem(path) {
            return Err(self.bad(key, format!("`{path}` {problem}")));
        }
        if let Some(suffix) = suffix
            && !path.ends_with(suffix)
        {
            return Err(self.bad(key, format!("`{path}` must name a {suffix} file")));
        }
        Ok(())
    }

    /// An inline table or the path of a JSON file.
    fn schema(&self, key: &str) -> Result<Option<SchemaRef>, PluginError> {
        match self.value(key) {
            None => Ok(None),
            Some(Toml::String(_)) => Ok(Some(SchemaRef::File(self.rel_path(key, Some(".json"))?))),
            Some(value @ Toml::Table(_)) => Ok(Some(SchemaRef::Inline(to_json(value)))),
            Some(_) => Err(self.bad(key, "must be a table or the path of a JSON file")),
        }
    }

    fn effects(&self, key: &str) -> Result<Option<Vec<Effect>>, PluginError> {
        let Some(names) = self.string_array(key)? else {
            return Ok(None);
        };
        if names.is_empty() {
            return Err(self.bad(key, "must name at least one effect"));
        }
        let mut effects: Vec<Effect> = Vec::new();
        for name in &names {
            let effect = match name.as_str() {
                "inspect" => Effect::Inspect,
                "plugin-state" => Effect::PluginState,
                "external" => Effect::External,
                "store-write" => {
                    return Err(self.bad(
                        key,
                        "`store-write` is reserved for phase 2, which adds the store grants",
                    ));
                }
                "workspace-write" => {
                    return Err(self.bad(
                        key,
                        "`workspace-write` is reserved for the host's own commands",
                    ));
                }
                other => {
                    return Err(self.bad(
                        key,
                        format!(
                            "`{other}` is not an effect; use inspect, plugin-state or external"
                        ),
                    ));
                }
            };
            if effects.contains(&effect) {
                return Err(self.bad(key, format!("names `{name}` twice")));
            }
            effects.push(effect);
        }
        if effects.contains(&Effect::Inspect) && effects.len() > 1 {
            return Err(self.bad(
                key,
                "`inspect` must appear alone: it means the command changes nothing",
            ));
        }
        Ok(Some(effects))
    }
}

pub(crate) fn to_json(value: &Toml) -> Value {
    match value {
        Toml::String(text) => Value::String(text.clone()),
        Toml::Integer(number) => Value::from(*number),
        Toml::Float(number) => {
            serde_json::Number::from_f64(*number).map_or(Value::Null, Value::Number)
        }
        Toml::Boolean(flag) => Value::Bool(*flag),
        Toml::Datetime(date) => Value::String(date.to_string()),
        Toml::Array(items) => Value::Array(items.iter().map(to_json).collect()),
        Toml::Table(table) => Value::Object(
            table
                .iter()
                .map(|(key, value)| (key.clone(), to_json(value)))
                .collect(),
        ),
    }
}

// ── The sections ───────────────────────────────────────────────────────────────────────────────

fn plugin_info(root: &Tbl<'_>) -> Result<PluginInfo, PluginError> {
    let table = root
        .table("plugin")?
        .ok_or_else(|| root.bad("plugin", "is required"))?;
    table.check_keys(PLUGIN_KEYS, &[])?;
    let id = table.required_string("id")?;
    if !is_plugin_id(&id) {
        return Err(table.bad("id", "must match ^[a-z][a-z0-9]{0,31}$"));
    }
    let version = table.required_string("version")?;
    if !is_semver(&version) {
        return Err(table.bad("version", "must be a semantic version such as 0.1.0"));
    }
    let kind = table.required_string("kind")?;
    let kind = PluginKind::parse(&kind)
        .ok_or_else(|| table.bad("kind", "must be compiled, component, mounted or pack"))?;
    let domains = table.string_array("domains")?;
    let domains = match (kind, domains) {
        (PluginKind::Pack, None) => Vec::new(),
        (PluginKind::Pack, Some(_)) => {
            return Err(table.bad(
                "domains",
                "is refused for a pack plugin: it has no commands",
            ));
        }
        (_, None) => return Err(table.bad("domains", "is required for every kind but pack")),
        (_, Some(domains)) if domains.is_empty() => {
            return Err(table.bad("domains", "must name at least one domain"));
        }
        (_, Some(domains)) => domains,
    };
    for (index, domain) in domains.iter().enumerate() {
        if let Some(problem) = domain_problem(domain) {
            return Err(table.bad("domains", format!("`{domain}` {problem}")));
        }
        if domains[..index].contains(domain) {
            return Err(table.bad("domains", format!("names `{domain}` twice")));
        }
    }
    let homepage = table.optional_text("homepage", 2048)?;
    if let Some(url) = &homepage
        && !(url.starts_with("https://") && url.len() > 8 && !url.contains(char::is_whitespace))
    {
        return Err(table.bad("homepage", "must be an https URL"));
    }
    let license = table.optional_text("license", 128)?;
    if let Some(license) = &license
        && !license
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " .+()-".contains(c))
    {
        return Err(table.bad(
            "license",
            "must be an SPDX expression such as MIT or Apache-2.0 OR MIT",
        ));
    }
    Ok(PluginInfo {
        id,
        title: table.text("title", 1, 80)?,
        version,
        description: table.text("description", 1, 500)?,
        kind,
        domains,
        homepage,
        license,
    })
}

fn component(root: &Tbl<'_>, kind: PluginKind) -> Result<Option<ComponentDecl>, PluginError> {
    let table = root.table("component")?;
    match (kind, table) {
        (PluginKind::Component, None) => {
            Err(root.bad("component", "is required when plugin.kind = \"component\""))
        }
        (PluginKind::Component, Some(table)) => {
            // A `world` key would let a manifest disagree with the binary, so it is not a key.
            table.check_keys(COMPONENT_KEYS, &[])?;
            Ok(Some(ComponentDecl {
                path: table.rel_path("path", Some(".wasm"))?,
            }))
        }
        (_, Some(_)) => Err(root.bad("component", format!("is refused for a {kind} plugin"))),
        (_, None) => Ok(None),
    }
}

fn grants(root: &Tbl<'_>, kind: PluginKind) -> Result<Vec<GrantDecl>, PluginError> {
    let tables = root.tables("grants")?;
    if !tables.is_empty() && matches!(kind, PluginKind::Mounted | PluginKind::Pack) {
        return Err(root.bad(
            "grants",
            format!(
                "is refused for a {kind} plugin: {}",
                if kind == PluginKind::Mounted {
                    "the server runs outside the host and reaches no host service"
                } else {
                    "a pack plugin has no code"
                }
            ),
        ));
    }
    tables
        .iter()
        .map(|table| {
            table.check_keys(GRANT_KEYS, GRANT_RESERVED)?;
            Ok(GrantDecl {
                name: table.required_string("name")?,
                required: table.boolean("required")?.unwrap_or(true),
                reason: table.text("reason", 1, 500)?,
            })
        })
        .collect()
}

/// A command or pipeline name: AFD's rule, one of the plugin's domains first, nothing AFD owns.
fn command_name(table: &Tbl<'_>, plugin: &PluginInfo) -> Result<String, PluginError> {
    let name = table.required_string("name")?;
    afd::validate_command_name(&name).map_err(|problem| table.bad("name", problem))?;
    let domain = name.split('-').next().unwrap_or_default();
    if !plugin.domains.iter().any(|d| d == domain) {
        return Err(table.bad(
            "name",
            format!(
                "`{name}` must start with one of the plugin's domains ({})",
                plugin.domains.join(", ")
            ),
        ));
    }
    if HOST_DOMAINS.contains(&domain) || afd::is_afd_builtin_name(&name) {
        return Err(table.bad("name", format!("`{name}` is a name the host or AFD owns")));
    }
    Ok(name)
}

fn commands(root: &Tbl<'_>, plugin: &PluginInfo) -> Result<Vec<CommandDecl>, PluginError> {
    let tables = root.tables("commands")?;
    if !tables.is_empty() && !matches!(plugin.kind, PluginKind::Compiled | PluginKind::Component) {
        return Err(root.bad(
            "commands",
            format!(
                "is refused for a {} plugin: {}",
                plugin.kind,
                if plugin.kind == PluginKind::Mounted {
                    "mounted commands come from the server's tools/list, renamed under [[mount.tools]]"
                } else {
                    "a pack plugin has no commands"
                }
            ),
        ));
    }
    tables.iter().map(|table| command(table, plugin)).collect()
}

fn command(table: &Tbl<'_>, plugin: &PluginInfo) -> Result<CommandDecl, PluginError> {
    table.check_keys(COMMAND_KEYS, COMMAND_RESERVED)?;
    let input_schema = table
        .schema("input_schema")?
        .ok_or_else(|| table.bad("input_schema", "is required"))?;
    if let SchemaRef::Inline(schema) = &input_schema {
        check_input_schema(schema).map_err(|problem| table.bad("input_schema", problem))?;
    }
    let effects = table
        .effects("effects")?
        .ok_or_else(|| table.bad("effects", "is required"))?;
    let approval = match table.string("approval")?.as_deref() {
        None | Some("none") => false,
        Some("required") => true,
        Some(_) => return Err(table.bad("approval", "must be \"none\" or \"required\"")),
    };
    let execution_time = table.string("execution_time")?;
    if let Some(time) = &execution_time
        && !["instant", "fast", "slow", "long-running"].contains(&time.as_str())
    {
        return Err(table.bad(
            "execution_time",
            "must be instant, fast, slow or long-running",
        ));
    }
    let version = table.string("version")?;
    if let Some(version) = &version
        && !is_semver(version)
    {
        return Err(table.bad("version", "must be a semantic version such as 1.0.0"));
    }
    let contexts = table.string_array("contexts")?.unwrap_or_default();
    for context in &contexts {
        if !is_context_name(context) {
            return Err(table.bad(
                "contexts",
                format!("`{context}` must be lowercase words joined by hyphens"),
            ));
        }
    }
    Ok(CommandDecl {
        name: command_name(table, plugin)?,
        description: table.text("description", 1, 500)?,
        effects,
        input_schema,
        returns: table.schema("returns")?,
        category: table.optional_text("category", 64)?,
        tags: table.string_array("tags")?.unwrap_or_default(),
        version,
        contexts,
        first_class: table.boolean("first_class")?.unwrap_or(false),
        confirm_prompt: table.optional_text("confirm_prompt", 500)?,
        destructive: table.boolean("destructive")?.unwrap_or(false),
        approval_required: approval,
        execution_time,
        expose: expose(table)?,
        examples: examples(table)?,
    })
}

fn expose(table: &Tbl<'_>) -> Result<Expose, PluginError> {
    let mut expose = Expose::default();
    if let Some(flags) = table.table("expose")? {
        flags.check_keys(EXPOSE_KEYS, &[])?;
        expose.mcp = flags.boolean("mcp")?.unwrap_or(expose.mcp);
        expose.agent = flags.boolean("agent")?.unwrap_or(expose.agent);
        expose.cli = flags.boolean("cli")?.unwrap_or(expose.cli);
        expose.palette = flags.boolean("palette")?.unwrap_or(expose.palette);
    }
    Ok(expose)
}

fn examples(table: &Tbl<'_>) -> Result<Vec<(String, Value)>, PluginError> {
    table
        .tables("examples")?
        .iter()
        .map(|example| {
            example.check_keys(&["title", "input"], &[])?;
            let input = example
                .table("input")?
                .ok_or_else(|| example.bad("input", "is required"))?;
            Ok((
                example.text("title", 1, 200)?,
                to_json(&Toml::Table(input.table.clone())),
            ))
        })
        .collect()
}

fn is_context_name(name: &str) -> bool {
    name.split('-').all(|word| {
        word.starts_with(|c: char| c.is_ascii_lowercase())
            && word
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    })
}

fn contexts(root: &Tbl<'_>, plugin: &PluginInfo) -> Result<Vec<ContextDecl>, PluginError> {
    let tables = root.tables("contexts")?;
    if !tables.is_empty() && plugin.kind == PluginKind::Pack {
        return Err(root.bad(
            "contexts",
            "is refused for a pack plugin: it has no commands",
        ));
    }
    tables
        .iter()
        .map(|table| {
            table.check_keys(CONTEXT_KEYS, &[])?;
            let name = table.required_string("name")?;
            let domain = name.split('-').next().unwrap_or_default();
            if !is_context_name(&name) || !plugin.domains.iter().any(|d| d == domain) {
                return Err(table.bad(
                    "name",
                    format!(
                        "`{name}` must be lowercase words joined by hyphens and start with one of the plugin's domains ({})",
                        plugin.domains.join(", ")
                    ),
                ));
            }
            let priority = match table.value("priority") {
                None => 0,
                Some(Toml::Integer(value)) => *value,
                Some(_) => return Err(table.bad("priority", "must be an integer")),
            };
            Ok(ContextDecl {
                name,
                description: table.text("description", 1, 500)?,
                triggers: table.string_array("triggers")?.unwrap_or_default(),
                priority,
            })
        })
        .collect()
}

fn pipelines(root: &Tbl<'_>, plugin: &PluginInfo) -> Result<Vec<PipelineDecl>, PluginError> {
    let tables = root.tables("pipelines")?;
    if !tables.is_empty() && plugin.kind == PluginKind::Pack {
        return Err(root.bad(
            "pipelines",
            "is refused for a pack plugin: it has no commands",
        ));
    }
    tables
        .iter()
        .map(|table| {
            table.check_keys(PIPELINE_KEYS, &[])?;
            let input_schema = table
                .schema("input_schema")?
                .ok_or_else(|| table.bad("input_schema", "is required"))?;
            if let SchemaRef::Inline(schema) = &input_schema {
                check_input_schema(schema).map_err(|problem| table.bad("input_schema", problem))?;
            }
            let steps = table.tables("steps")?;
            if steps.is_empty() {
                return Err(table.bad("steps", "must hold at least one step"));
            }
            let mut parsed: Vec<PipelineStep> = Vec::new();
            for step in &steps {
                // Parallel and streaming steps are refused, as the `afd` crate refuses them.
                step.check_keys(STEP_KEYS, &[])?;
                let command = step.required_string("command")?;
                afd::validate_command_name(&command)
                    .map_err(|problem| step.bad("command", problem))?;
                let alias = step.string("as")?;
                if let Some(alias) = &alias
                    && (!is_kebab_id(&alias.replace('_', "-"), 64)
                        || parsed.iter().any(|s| s.alias.as_ref() == Some(alias)))
                {
                    return Err(step.bad(
                        "as",
                        "must be a unique lowercase word, hyphens or underscores allowed",
                    ));
                }
                let input = match step.value("input") {
                    None => None,
                    Some(value @ Toml::Table(_)) => Some(to_json(value)),
                    Some(_) => return Err(step.bad("input", "must be a table")),
                };
                parsed.push(PipelineStep {
                    command,
                    input,
                    alias,
                });
            }
            Ok(PipelineDecl {
                name: command_name(table, plugin)?,
                description: table.text("description", 1, 500)?,
                effects: table
                    .effects("effects")?
                    .ok_or_else(|| table.bad("effects", "is required"))?,
                input_schema,
                steps: parsed,
            })
        })
        .collect()
}

fn packs(root: &Tbl<'_>) -> Result<Vec<PackDecl>, PluginError> {
    root.tables("packs")?
        .iter()
        .map(|table| {
            table.check_keys(PACK_KEYS, &[])?;
            let id = table.required_string("id")?;
            if !is_kebab_id(&id, 63) {
                return Err(table.bad("id", "must match ^[a-z][a-z0-9-]{0,62}$"));
            }
            Ok(PackDecl {
                id,
                path: table.rel_path("path", None)?,
            })
        })
        .collect()
}

fn skills(root: &Tbl<'_>, plugin: &PluginInfo) -> Result<Vec<SkillDecl>, PluginError> {
    root.tables("skills")?
        .iter()
        .map(|table| {
            table.check_keys(SKILL_KEYS, &[])?;
            let name = table.required_string("name")?;
            if !is_kebab_id(&name, 64) {
                return Err(table.bad("name", "must match ^[a-z][a-z0-9-]{0,63}$"));
            }
            let prefix = format!("{}-", plugin.id);
            if name != plugin.id && !name.starts_with(&prefix) {
                return Err(table.bad(
                    "name",
                    format!("`{name}` must equal the plugin id or start with `{prefix}`, so two plugins never ship one name"),
                ));
            }
            let path = table.rel_path("path", None)?;
            if path.trim_end_matches('/').rsplit('/').next() != Some(name.as_str()) {
                return Err(table.bad(
                    "path",
                    format!("`{path}` must end in the skill's name `{name}`"),
                ));
            }
            Ok(SkillDecl { name, path })
        })
        .collect()
}

fn config(root: &Tbl<'_>) -> Result<Option<ConfigDecl>, PluginError> {
    let Some(table) = root.table("config")? else {
        return Ok(None);
    };
    table.check_keys(CONFIG_KEYS, &[])?;
    let schema = table
        .schema("schema")?
        .ok_or_else(|| table.bad("schema", "is required"))?;
    if let SchemaRef::Inline(value) = &schema {
        check_config_schema(value).map_err(|problem| table.bad("schema", problem))?;
    }
    Ok(Some(ConfigDecl { schema }))
}

fn mount(root: &Tbl<'_>, plugin: &PluginInfo) -> Result<Option<MountDecl>, PluginError> {
    let table = root.table("mount")?;
    let Some(table) = table else {
        return if plugin.kind == PluginKind::Mounted {
            Err(root.bad("mount", "is required when plugin.kind = \"mounted\""))
        } else {
            Ok(None)
        };
    };
    if plugin.kind != PluginKind::Mounted {
        return Err(root.bad("mount", format!("is refused for a {} plugin", plugin.kind)));
    }
    table.check_keys(MOUNT_KEYS, MOUNT_DEPLOYER_KEYS)?;
    let prefix = table.required_string("prefix")?;
    if let Some(problem) = domain_problem(&prefix) {
        return Err(table.bad("prefix", problem));
    }
    if !plugin.domains.contains(&prefix) {
        return Err(table.bad("prefix", "must equal one of plugin.domains"));
    }
    let transport = match table.required_string("transport")?.as_str() {
        "stdio" => Transport::Stdio,
        "http" => Transport::Http,
        _ => return Err(table.bad("transport", "must be \"stdio\" or \"http\"")),
    };
    let only_stdio = |key: &str| -> Result<(), PluginError> {
        if table.value(key).is_some() && transport != Transport::Stdio {
            return Err(table.bad(key, "applies only to transport = \"stdio\""));
        }
        Ok(())
    };
    only_stdio("command")?;
    only_stdio("cwd")?;
    only_stdio("env")?;
    if table.value("bearer").is_some() && transport != Transport::Http {
        return Err(table.bad("bearer", "applies only to transport = \"http\""));
    }
    let command = table.string_array("command")?.unwrap_or_default();
    if transport == Transport::Stdio && command.is_empty() {
        return Err(table.bad(
            "command",
            "is required for stdio: the command line, first element the program",
        ));
    }
    let cwd = table.string("cwd")?;
    if let Some(cwd) = &cwd {
        table.check_rel_path("cwd", cwd, None)?;
    }
    let mut env = BTreeMap::new();
    if let Some(vars) = table.table("env")? {
        for (name, value) in vars.table {
            let Toml::String(value) = value else {
                return Err(vars.bad(name, "must be a string"));
            };
            if !is_env_name(name) || value.contains('\0') {
                return Err(vars.bad(name, "must be a variable name with a text value"));
            }
            env.insert(name.clone(), value.clone());
        }
    }
    let bearer = match table.string("bearer")?.as_deref() {
        None | Some("none") => Bearer::None,
        Some("optional") => Bearer::Optional,
        Some("required") => Bearer::Required,
        Some(_) => return Err(table.bad("bearer", "must be none, optional or required")),
    };
    let only = table.string_array("only")?;
    if let Some(only) = &only {
        for (index, tool) in only.iter().enumerate() {
            if only[..index].contains(tool) {
                return Err(table.bad("only", format!("names `{tool}` twice")));
            }
        }
    }
    let tools = mount_tools(&table, &prefix)?;
    Ok(Some(MountDecl {
        prefix,
        transport,
        command,
        cwd,
        env,
        bearer,
        only,
        tools,
    }))
}

fn mount_tools(table: &Tbl<'_>, prefix: &str) -> Result<Vec<MountTool>, PluginError> {
    let mut tools: Vec<MountTool> = Vec::new();
    for entry in table.tables("tools")? {
        entry.check_keys(MOUNT_TOOL_KEYS, &[])?;
        let tool = entry.required_string("tool")?;
        let name = entry.string("name")?;
        if let Some(name) = &name {
            afd::validate_command_name(&format!("{prefix}-{name}")).map_err(|problem| {
                entry.bad(
                    "name",
                    format!("`{name}` does not make a command name under `{prefix}`: {problem}"),
                )
            })?;
        }
        let approval = match entry.string("approval")?.as_deref() {
            None | Some("none") => false,
            Some("required") => true,
            Some(_) => return Err(entry.bad("approval", "must be \"none\" or \"required\"")),
        };
        if tools
            .iter()
            .any(|t| t.tool == tool || (name.is_some() && t.name == name))
        {
            return Err(entry.bad("tool", format!("`{tool}` or its name is declared twice")));
        }
        tools.push(MountTool {
            tool,
            name,
            effects: entry.effects("effects")?,
            bind_space: entry.boolean("bind_space")?.unwrap_or(false),
            confirm_prompt: entry.optional_text("confirm_prompt", 500)?,
            approval_required: approval,
            first_class: entry.boolean("first_class")?.unwrap_or(false),
        });
    }
    Ok(tools)
}

fn is_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// ── Schema checks ──────────────────────────────────────────────────────────────────────────────

struct Unused;

#[async_trait]
impl CommandHandler for Unused {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        afd::success(Value::Null)
    }
}

/// An input schema: `type: object`, and the `afd` crate's checker accepts it. The checker is
/// the registry's, so the schema is registered in a scratch registry; a keyword it does not
/// support (`pattern`, among others) is refused there.
pub(crate) fn check_input_schema(schema: &Value) -> Result<(), String> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("must be a JSON Schema with \"type\": \"object\"".to_owned());
    }
    CommandRegistry::new()
        .register_with_schema(
            CommandDefinition::new("schema-check", "Check a schema.", vec![], Unused),
            schema.clone(),
        )
        .map_err(|message| format!("is not a schema the host can check: {message}"))
}

/// A configuration schema: a JSON Schema 2020-12 object, closed at its root.
pub(crate) fn check_config_schema(schema: &Value) -> Result<(), String> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("must be a JSON Schema with \"type\": \"object\"".to_owned());
    }
    if schema.get("additionalProperties") != Some(&Value::Bool(false)) {
        return Err("must be closed: set \"additionalProperties\": false at its root".to_owned());
    }
    jsonschema::meta::validate(schema).map_err(|error| format!("is not valid JSON Schema: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL: &str = r#"
manifest_version = 1
protocol = 1
[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command."
kind = "compiled"
domains = ["hello"]
"#;

    #[test]
    fn the_minimal_manifest_parses() {
        let manifest = Manifest::parse(MINIMAL, "umbel-plugin.toml").unwrap();
        assert_eq!(manifest.plugin.id, "hello");
        assert_eq!(manifest.plugin.kind, PluginKind::Compiled);
        assert!(manifest.commands.is_empty());
    }

    #[test]
    fn effects_follow_the_catalog() {
        let table: Table = "e = [\"inspect\", \"external\"]".parse().unwrap();
        let tbl = Tbl::root(&table, "f");
        assert!(tbl.effects("e").is_err());
        let table: Table = "e = [\"external\", \"plugin-state\"]".parse().unwrap();
        let tbl = Tbl::root(&table, "f");
        assert_eq!(
            tbl.effects("e").unwrap().unwrap(),
            [Effect::External, Effect::PluginState]
        );
    }

    #[test]
    fn input_schemas_pass_the_afd_checker() {
        assert!(
            check_input_schema(&serde_json::json!({"type": "object", "properties": {}})).is_ok()
        );
        assert!(check_input_schema(&serde_json::json!({"type": "string"})).is_err());
        let with_pattern = serde_json::json!({
            "type": "object",
            "properties": { "a": { "type": "string", "pattern": "^a$" } }
        });
        assert!(check_input_schema(&with_pattern).is_err());
    }
}
