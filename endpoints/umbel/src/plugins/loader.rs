//! The load sequence (specification section 6), for the kinds this build loads.
//!
//! Per instance, in `plugins.enabled` order: resolve the source, read and validate the manifest,
//! validate the configuration, decide the grants, check the spaces, prepare the kind, check
//! every name, and only then register. A failing instance never leaves part of itself in the
//! registry, because registration runs only after every earlier step succeeded for it.
//!
//! An instance that fails and is `required` (the default) fails `seal`; an optional one is
//! skipped and reported `failed` by `plugin-list`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

use afd::{
    ApprovalPolicy, CommandContext, CommandDefinition, CommandExample, CommandHandler,
    CommandRegistry, CommandResult, ContextConfig, ExecutionTime, ExposeOptions, JsonSchema,
    JsonSchemaType, is_afd_builtin_name,
};
use async_trait::async_trait;
use serde_json::Value;

use super::compiled::{CompiledPlugin, PluginCommand, has_space_property};
use super::config;
use super::files::{AssetFiles, DirFiles, PluginFiles};
use super::grants::{ALLOW_REQUIRED, Services, Shared, needs_allow};
use super::manifest::{CommandDecl, Effect, Manifest, PluginKind, Transport};
#[cfg(feature = "mounted")]
use super::mounted;
use super::packs::{PackSet, PackState};
use super::pipelines::{self, Known, PipelinePlan, PipelineState};
use super::skills::{LoadedSkill, read_skill};
use super::source::{CompiledCatalog, ResolvedSource, resolve_source};
use super::{GRANTS, HOST_DOMAINS, PluginError, RESERVED_GRANTS};
use crate::events::Projector;
use crate::workspace::{PluginInstance, SpaceId, Workspace};

/// Printed beside a compiled plugin's grants (owner decision 1 of 2026-11-01).
pub const TRUST_NOTE: &str = "trusted, not sandboxed";

/// What the host knows about one grant of one instance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GrantReport {
    pub name: String,
    pub required: bool,
    pub reason: String,
    /// Whether the plugin holds the grant.
    pub granted: bool,
    /// Why a grant is withheld.
    pub withheld: Option<String>,
}

/// How an instance ended up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Status {
    Loaded,
    Failed(PluginError),
}

/// What a mounted instance's server offered, and what became of it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MountReport {
    /// The prefix the tools are renamed under (the instance's, else the manifest's).
    pub prefix: String,
    pub transport: Transport,
    /// Whether a bearer token is configured (`bearer_env` is set and its variable was read). The
    /// value is never kept.
    pub bearer_configured: bool,
    /// The tools that became commands, in the server's order.
    pub tools: Vec<MountToolReport>,
    /// Tools the server listed that were not mounted.
    pub skipped: Vec<SkippedTool>,
    /// Descriptions the `description-injection` rule matched.
    pub warnings: Vec<ScanWarning>,
}

/// One mounted tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MountToolReport {
    /// The server's name for the tool.
    pub tool: String,
    /// The registered command name.
    pub command: String,
    pub description: String,
    pub effects: Vec<Effect>,
    pub mutation: bool,
    pub bind_space: bool,
    pub first_class: bool,
}

/// A tool the server listed that was not mounted: a diagnostic, not a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkippedTool {
    pub tool: String,
    /// `PLUGIN_TOOL_UNNAMEABLE` or `PLUGIN_TOOL_SCHEMA_UNSUPPORTED`.
    pub code: &'static str,
    pub message: String,
}

/// A description that matched a pattern of the `description-injection` rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScanWarning {
    pub tool: String,
    /// `description`, or the JSON pointer of the schema description (`inputSchema/properties/...`).
    pub location: String,
    pub pattern: String,
}

/// One instance of `plugins.enabled`, as `plugin-list`, `plugin-show` and the doctor report it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct InstanceReport {
    pub id: String,
    pub required: bool,
    /// The source as configured or defaulted, for display.
    pub source: String,
    /// The spaces the instance is enabled for.
    pub spaces: Vec<String>,
    /// The manifest, when it was read.
    pub manifest: Option<Manifest>,
    pub grants: Vec<GrantReport>,
    /// The commands registered, in manifest order.
    pub commands: Vec<String>,
    /// Each pack with how every one of the instance's spaces is served (D46).
    pub packs: Vec<(String, Vec<PackState>)>,
    /// The AFD contexts the instance contributed.
    pub contexts: Vec<String>,
    /// Each pipeline and whether it was registered (section 8.5).
    pub pipelines: Vec<PipelinePlan>,
    /// A mounted instance's tools, diagnostics and warnings.
    pub mount: Option<MountReport>,
    pub status: Status,
}

impl InstanceReport {
    pub(crate) fn kind(&self) -> Option<PluginKind> {
        self.manifest.as_ref().map(|manifest| manifest.plugin.kind)
    }
}

/// What the plugin gate needs to know about one plugin command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GateEntry {
    pub instance: String,
    pub kind: PluginKind,
    /// The spaces the instance is enabled for.
    pub spaces: Vec<String>,
    /// Whether the command resolves a `space` input. The host builds its set of space commands
    /// from this knowledge, not from the schema alone (a mounted tool's own `space` argument is
    /// not Umbel's).
    pub space_command: bool,
    /// Whether the command is a pipeline. Its steps are journaled and projected as the calls
    /// they are, so the pipeline itself is not projected as a second event.
    pub pipeline: bool,
}

/// Every instance of the workspace and the plugin commands the host registered.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct LoadedPlugins {
    pub instances: Vec<InstanceReport>,
    pub gate: BTreeMap<String, GateEntry>,
    /// The AFD contexts the loaded instances contribute, in instance order (section 8.5).
    pub contexts: Vec<ContextConfig>,
    /// The commands whose manifest says `first_class = true` and that MCP exposes, in instance
    /// order and manifest order (section 8.4, D45).
    pub suggestions: Vec<String>,
    /// Every skill of every loaded instance, in `plugins.enabled` order and manifest order.
    pub skills: Vec<LoadedSkill>,
}

impl LoadedPlugins {
    pub(crate) fn instance(&self, id: &str) -> Option<&InstanceReport> {
        self.instances.iter().find(|instance| instance.id == id)
    }
}

/// The compiled plugins a binary was built with, by plugin id.
pub(crate) struct Catalog {
    plugins: BTreeMap<String, Arc<dyn CompiledPlugin>>,
    manifests: CompiledCatalog,
}

impl Catalog {
    pub(crate) fn new(plugins: &[Arc<dyn CompiledPlugin>]) -> Result<Self, PluginError> {
        let mut by_id = BTreeMap::new();
        let mut manifests = CompiledCatalog::new();
        for plugin in plugins {
            let id = embedded_id(plugin.manifest())?;
            manifests = manifests.with(id.clone(), plugin.manifest());
            by_id.insert(id, Arc::clone(plugin));
        }
        Ok(Self {
            plugins: by_id,
            manifests,
        })
    }

    pub(crate) fn manifests(&self) -> &CompiledCatalog {
        &self.manifests
    }
}

/// The `plugin.id` of an embedded manifest, read leniently: the catalog is keyed by it even
/// when the rest of the manifest is invalid, which loading an instance reports.
pub(crate) fn embedded_id(text: &str) -> Result<String, PluginError> {
    let table: toml::Table = text.parse().map_err(|error: toml::de::Error| {
        PluginError::manifest_invalid(
            "compiled plugin manifest",
            "umbel-plugin.toml",
            format!("is not valid TOML: {}", error.message()),
        )
    })?;
    table
        .get("plugin")
        .and_then(|plugin| plugin.get("id"))
        .and_then(toml::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            PluginError::manifest_invalid("compiled plugin manifest", "plugin.id", "is required")
        })
}

pub(crate) struct Inputs<'a> {
    pub workspace: &'a Arc<Workspace>,
    pub projector: &'a Arc<Projector>,
    pub registry: &'a Arc<CommandRegistry>,
    pub catalog: &'a Catalog,
    /// Extra trusted root certificates (PEM) for HTTPS mounts.
    #[cfg_attr(not(feature = "mounted"), allow(dead_code))]
    pub mount_roots: &'a [Vec<u8>],
}

/// An instance past steps 1 and 2.
struct Resolved {
    manifest: Manifest,
    files: Arc<dyn PluginFiles + Send + Sync>,
    compiled: Option<Arc<dyn CompiledPlugin>>,
    source: String,
    /// The plugin directory (canonical), for a directory source.
    #[cfg_attr(not(feature = "mounted"), allow(dead_code))]
    root: Option<PathBuf>,
}

/// An instance past step 7, ready to register once its pipelines are decided.
struct Prepared {
    report: InstanceReport,
    manifest: Manifest,
    commands: Vec<(CommandDefinition, Value)>,
    /// The schema a command advertises, where it differs from the one it validates with.
    advertised: BTreeMap<String, Value>,
    gate: Vec<(String, GateEntry)>,
    /// The input schema of each manifest pipeline, in manifest order.
    pipeline_schemas: Vec<Value>,
    contexts: Vec<ContextConfig>,
    suggestions: Vec<String>,
    spaces: Vec<String>,
    /// The instance's skills that no earlier instance of the same plugin already ships.
    skills: Vec<LoadedSkill>,
}

/// One instance in `plugins.enabled` order: failed, or prepared and waiting for its pipelines.
enum Slot {
    Failed(Box<InstanceReport>),
    Ready(Box<Prepared>),
}

/// Load every instance of `plugins.enabled` and register its commands.
///
/// Every instance is prepared first, then the pipelines are decided against every command that
/// will exist (section 8.5), and only then is anything registered.
///
/// # Errors
/// The error of the first required instance that fails; nothing of it is registered.
pub(crate) fn load(inputs: &Inputs<'_>) -> Result<LoadedPlugins, PluginError> {
    let mut taken: BTreeMap<String, String> = inputs
        .registry
        .list()
        .iter()
        .map(|command| (command.name.clone(), "the host".to_owned()))
        .collect();
    let mut contexts_taken: BTreeMap<String, String> = BTreeMap::new();
    let mut shipped: Vec<LoadedSkill> = Vec::new();
    let mut slots: Vec<Slot> = Vec::new();
    for instance in &inputs.workspace.config().plugins.instances {
        let resolved = match resolve(inputs, instance) {
            Ok(resolved) => resolved,
            Err((error, http_mount)) => {
                let required = instance.required.unwrap_or(!http_mount);
                slots.push(fail(instance, required, None, error)?);
                continue;
            }
        };
        let required = instance
            .required
            .unwrap_or(!resolved.manifest.is_http_mount());
        match prepare(
            inputs,
            instance,
            &resolved,
            required,
            &taken,
            &contexts_taken,
            &shipped,
        ) {
            Ok(prepared) => {
                let owner = format!("plugin instance `{}`", instance.id);
                for (definition, _) in &prepared.commands {
                    taken.insert(definition.name.clone(), owner.clone());
                }
                for pipeline in &prepared.manifest.pipelines {
                    taken.insert(pipeline.name.clone(), owner.clone());
                }
                for context in &prepared.contexts {
                    contexts_taken.insert(context.name.clone(), owner.clone());
                }
                shipped.extend(prepared.skills.iter().cloned());
                slots.push(Slot::Ready(Box::new(prepared)));
            }
            Err(error) => slots.push(fail(instance, required, Some(resolved.manifest), error)?),
        }
    }
    settle_pipelines(inputs, &mut slots)?;

    let mut loaded = LoadedPlugins::default();
    let weak = Arc::downgrade(inputs.registry);
    for slot in slots {
        let mut prepared = match slot {
            Slot::Failed(report) => {
                loaded.instances.push(*report);
                continue;
            }
            Slot::Ready(prepared) => *prepared,
        };
        let id = prepared.report.id.clone();
        let advertised = std::mem::take(&mut prepared.advertised);
        let register = |definition: CommandDefinition, schema: Value| {
            let name = definition.name.clone();
            match advertised.get(&name) {
                Some(shown) => {
                    inputs
                        .registry
                        .register_with_schemas(definition, schema, shown.clone())
                }
                None => inputs.registry.register_with_schema(definition, schema),
            }
            .map_err(|message| {
                PluginError::load_failed(&id, format!("cannot register `{name}`: {message}"))
            })
        };
        for (definition, schema) in std::mem::take(&mut prepared.commands) {
            register(definition, schema)?;
        }
        let kind = prepared.manifest.plugin.kind;
        for ((decl, plan), schema) in prepared
            .manifest
            .pipelines
            .iter()
            .zip(&prepared.report.pipelines)
            .zip(&prepared.pipeline_schemas)
        {
            if plan.state != PipelineState::Registered {
                continue;
            }
            register(
                pipelines::definition(decl, plan, weak.clone()),
                schema.clone(),
            )?;
            prepared.gate.push((
                decl.name.clone(),
                gate_entry(&id, kind, &prepared.spaces, schema, true),
            ));
        }
        loaded.gate.extend(prepared.gate);
        loaded.contexts.extend(prepared.contexts);
        loaded.suggestions.extend(prepared.suggestions);
        loaded.skills.extend(prepared.skills);
        loaded.instances.push(prepared.report);
    }
    Ok(loaded)
}

fn gate_entry(
    instance: &str,
    kind: PluginKind,
    spaces: &[String],
    schema: &Value,
    pipeline: bool,
) -> GateEntry {
    GateEntry {
        instance: instance.to_owned(),
        kind,
        spaces: spaces.to_vec(),
        space_command: has_space_property(schema),
        pipeline,
    }
}

/// Decide every pipeline against the commands that will exist (section 8.5). A pipeline whose
/// effects do not cover its steps' fails its instance; when that instance is optional it is
/// dropped and the rest are decided again, because the commands it held no longer exist.
fn settle_pipelines(inputs: &Inputs<'_>, slots: &mut [Slot]) -> Result<(), PluginError> {
    loop {
        let known = known_commands(inputs, slots);
        let mut dropped = false;
        for slot in slots.iter_mut() {
            let Slot::Ready(prepared) = slot else {
                continue;
            };
            match pipelines::plan(&prepared.manifest, &known) {
                Ok(plans) => prepared.report.pipelines = plans,
                Err(error) => {
                    if prepared.report.required {
                        return Err(error);
                    }
                    let report = failed_report(&prepared.report, prepared.manifest.clone(), error);
                    *slot = Slot::Failed(Box::new(report));
                    dropped = true;
                    break;
                }
            }
        }
        if !dropped {
            return Ok(());
        }
    }
}

/// Every command a pipeline step may name: the host's, and every prepared instance's.
fn known_commands(inputs: &Inputs<'_>, slots: &[Slot]) -> BTreeMap<String, Known> {
    let mut known: BTreeMap<String, Known> = inputs
        .registry
        .list()
        .iter()
        .map(|command| {
            (
                command.name.clone(),
                Known {
                    effects: (!command.mutation).then(|| vec![Effect::Inspect]),
                    confirm_prompt: command.confirm_prompt.clone(),
                    destructive: command.destructive.unwrap_or(false),
                    pipeline: false,
                },
            )
        })
        .collect();
    for slot in slots {
        let Slot::Ready(prepared) = slot else {
            continue;
        };
        for (definition, _) in &prepared.commands {
            let effects = prepared
                .manifest
                .commands
                .iter()
                .find(|command| command.name == definition.name)
                .map(|command| command.effects.clone());
            known.insert(
                definition.name.clone(),
                Known {
                    effects,
                    confirm_prompt: definition.confirm_prompt.clone(),
                    destructive: definition.destructive.unwrap_or(false),
                    pipeline: false,
                },
            );
        }
        for pipeline in &prepared.manifest.pipelines {
            known.insert(
                pipeline.name.clone(),
                Known {
                    effects: Some(pipeline.effects.clone()),
                    confirm_prompt: None,
                    destructive: false,
                    pipeline: true,
                },
            );
        }
    }
    known
}

/// A required instance's failure stops the host; an optional one is recorded and skipped.
fn fail(
    instance: &PluginInstance,
    required: bool,
    manifest: Option<Manifest>,
    error: PluginError,
) -> Result<Slot, PluginError> {
    if required {
        return Err(error);
    }
    Ok(Slot::Failed(Box::new(InstanceReport {
        id: instance.id.clone(),
        required,
        source: instance
            .source
            .clone()
            .unwrap_or_else(|| format!("compiled:{} or plugins/{}", instance.id, instance.id)),
        spaces: Vec::new(),
        manifest,
        grants: Vec::new(),
        commands: Vec::new(),
        packs: Vec::new(),
        contexts: Vec::new(),
        pipelines: Vec::new(),
        mount: None,
        status: Status::Failed(error),
    })))
}

/// The report of an instance that was prepared and then failed.
fn failed_report(
    prepared: &InstanceReport,
    manifest: Manifest,
    error: PluginError,
) -> InstanceReport {
    InstanceReport {
        id: prepared.id.clone(),
        required: prepared.required,
        source: prepared.source.clone(),
        spaces: Vec::new(),
        manifest: Some(manifest),
        grants: Vec::new(),
        commands: Vec::new(),
        packs: Vec::new(),
        contexts: Vec::new(),
        pipelines: Vec::new(),
        mount: prepared.mount.clone(),
        status: Status::Failed(error),
    }
}

/// Steps 1 and 2: resolve the source, read and validate the manifest and the instance's keys
/// against its kind. The error carries whether the manifest said this is an HTTP mount, which
/// makes the instance optional by default.
fn resolve(
    inputs: &Inputs<'_>,
    instance: &PluginInstance,
) -> Result<Resolved, (PluginError, bool)> {
    let root = inputs.workspace.root();
    let resolved = resolve_source(
        root,
        &instance.id,
        instance.source.as_deref(),
        Some(inputs.catalog.manifests()),
    )
    .map_err(|error| (error, false))?;
    let opened = match resolved {
        ResolvedSource::Unresolved { id } => {
            return Err((
                PluginError::not_found(&instance.id, format!("compiled:{id} cannot be resolved")),
                false,
            ));
        }
        ResolvedSource::Compiled { id, manifest } => {
            let plugin = inputs.catalog.plugins.get(&id).map(Arc::clone);
            let Some(plugin) = plugin else {
                return Err((
                    PluginError::not_found(
                        &instance.id,
                        format!("compiled:{id} is not a plugin this binary was built with"),
                    ),
                    false,
                ));
            };
            let manifest = Manifest::parse(&manifest, &format!("compiled:{id}"))
                .map_err(|error| (error, false))?;
            let files = AssetFiles::new(plugin.assets());
            manifest
                .validate_files(&files)
                .map_err(|error| (error, manifest.is_http_mount()))?;
            Resolved {
                manifest,
                files: Arc::new(files),
                compiled: Some(plugin),
                source: format!("compiled:{id}"),
                root: None,
            }
        }
        ResolvedSource::Directory { dir } => {
            let manifest = Manifest::load(&dir).map_err(|error| (error, false))?;
            let files = DirFiles::new(&dir).map_err(|error| {
                (
                    PluginError::not_found(&instance.id, error),
                    manifest.is_http_mount(),
                )
            })?;
            let relative = dir
                .strip_prefix(std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()))
                .map_or_else(
                    |_| dir.display().to_string(),
                    |path| path.display().to_string(),
                );
            Resolved {
                manifest,
                files: Arc::new(files),
                compiled: None,
                source: relative,
                root: Some(dir),
            }
        }
    };
    let http = opened.manifest.is_http_mount();
    super::doctor::fits(instance, &opened.manifest, opened.compiled.is_some())
        .map_err(|error| (error, http))?;
    let unavailable = match opened.manifest.plugin.kind {
        PluginKind::Component => true,
        PluginKind::Mounted => !cfg!(feature = "mounted"),
        _ => false,
    };
    if unavailable {
        return Err((
            PluginError::kind_unavailable(&instance.id, opened.manifest.plugin.kind),
            http,
        ));
    }
    Ok(opened)
}

/// Steps 3 to 7, and building every definition, without touching the registry.
fn prepare(
    inputs: &Inputs<'_>,
    instance: &PluginInstance,
    resolved: &Resolved,
    required: bool,
    taken: &BTreeMap<String, String>,
    contexts_taken: &BTreeMap<String, String>,
    shipped: &[LoadedSkill],
) -> Result<Prepared, PluginError> {
    let manifest = &resolved.manifest;
    let workspace = inputs.workspace;
    let files = resolved.files.as_ref() as &dyn PluginFiles;

    // 3. The instance configuration.
    let configuration = config::resolve(&instance.id, manifest, files, &instance.config)?;

    // 4. The grants.
    let (grants, granted) = decide_grants(instance, manifest)?;

    // 5. The spaces.
    let declared: Vec<SpaceId> = workspace
        .spaces()
        .iter()
        .map(|space| space.id.clone())
        .collect();
    let spaces: Vec<SpaceId> = instance.enabled_spaces(&declared).to_vec();
    let mut schemas: Vec<Value> = Vec::new();
    let mut returns: Vec<Option<Value>> = Vec::new();
    for (index, command) in manifest.commands.iter().enumerate() {
        returns.push(match &command.returns {
            Some(returns) => Some(returns.load(files).map_err(|problem| {
                PluginError::manifest_invalid(
                    &manifest.file,
                    &format!("commands[{index}].returns"),
                    problem,
                )
            })?),
            None => None,
        });
        let schema = command.input_schema.load(files).map_err(|problem| {
            PluginError::manifest_invalid(
                &manifest.file,
                &format!("commands[{index}].input_schema"),
                problem,
            )
        })?;
        if !has_space_property(&schema) && !spaces.contains(workspace.default_space()) {
            return Err(PluginError::config_invalid(
                &instance.id,
                "spaces",
                format!(
                    "must include the default space `{}`: the command `{}` has no space input",
                    workspace.default_space(),
                    command.name
                ),
            ));
        }
        schemas.push(schema);
    }
    let mut pipeline_schemas: Vec<Value> = Vec::new();
    for (index, pipeline) in manifest.pipelines.iter().enumerate() {
        let schema = pipeline.input_schema.load(files).map_err(|problem| {
            PluginError::manifest_invalid(
                &manifest.file,
                &format!("pipelines[{index}].input_schema"),
                problem,
            )
        })?;
        if !has_space_property(&schema) && !spaces.contains(workspace.default_space()) {
            return Err(PluginError::config_invalid(
                &instance.id,
                "spaces",
                format!(
                    "must include the default space `{}`: the pipeline `{}` has no space input",
                    workspace.default_space(),
                    pipeline.name
                ),
            ));
        }
        pipeline_schemas.push(schema);
    }

    // 5b. The packs: the plugin's defaults and the spaces' overrides, read now (D46).
    let packs = PackSet::load(
        &workspace.layout().spaces_dir(),
        &manifest.plugin.id,
        &manifest.packs,
        &resolved.files,
        &spaces,
    )?;
    let pack_states = packs.states();

    // The skills, read and checked before any plugin code runs (section 8.3).
    let skills = read_skills(instance, manifest, files)?;

    // 6 and 7 for a mounted plugin: connect, list the tools and name them.
    #[cfg(feature = "mounted")]
    if manifest.plugin.kind == PluginKind::Mounted {
        let enabled: Vec<String> = spaces
            .iter()
            .map(|space| space.as_str().to_owned())
            .collect();
        let built = mounted::build(&mounted::Request {
            instance,
            manifest,
            root: resolved.root.as_deref().unwrap_or_else(|| workspace.root()),
            workspace,
            spaces: &enabled,
            taken,
            roots: inputs.mount_roots,
        })?;
        // Pipelines and contexts are data in the manifest, so a mounted plugin may ship them; the
        // names they take must not collide with the tools just named.
        for pipeline in &manifest.pipelines {
            check_name(&pipeline.name, &instance.id, taken)?;
            if built.commands.iter().any(|(d, _)| d.name == pipeline.name) {
                return Err(PluginError::conflict(format!(
                    "plugin instance `{}` declares the pipeline `{}`, but a mounted tool already maps to that command",
                    instance.id, pipeline.name
                )));
            }
        }
        check_context_names(instance, manifest, contexts_taken)?;
        let skills = check_skill_names(instance, skills, shipped)?;
        let suggestions = built
            .report
            .tools
            .iter()
            .filter(|tool| tool.first_class)
            .map(|tool| tool.command.clone())
            .collect();
        return Ok(Prepared {
            report: InstanceReport {
                id: instance.id.clone(),
                required,
                source: resolved.source.clone(),
                spaces: enabled.clone(),
                manifest: Some(manifest.clone()),
                grants,
                commands: built
                    .report
                    .tools
                    .iter()
                    .map(|tool| tool.command.clone())
                    .collect(),
                packs: pack_states,
                contexts: manifest.contexts.iter().map(|c| c.name.clone()).collect(),
                pipelines: Vec::new(),
                mount: Some(built.report),
                status: Status::Loaded,
            },
            manifest: manifest.clone(),
            commands: built.commands,
            advertised: built.advertised,
            gate: built.gate,
            pipeline_schemas,
            contexts: context_configs(manifest),
            suggestions,
            spaces: enabled,
            skills,
        });
    }

    // 6. Prepare the kind: a compiled plugin builds its handlers; a pack plugin has no code.
    let services = Services::new(Shared {
        instance: instance.id.clone(),
        granted,
        config: configuration,
        spaces: spaces.clone(),
        packs,
        workspace: Arc::clone(workspace),
        projector: Arc::clone(inputs.projector),
    });
    let implementations = match &resolved.compiled {
        Some(plugin) => plugin.commands(services)?,
        None => Vec::new(),
    };

    // 7. Every name the instance would add, against every name already taken.
    for command in &manifest.commands {
        check_name(&command.name, &instance.id, taken)?;
    }
    for pipeline in &manifest.pipelines {
        check_name(&pipeline.name, &instance.id, taken)?;
    }
    check_context_names(instance, manifest, contexts_taken)?;

    let skills = check_skill_names(instance, skills, shipped)?;

    // 8 (prepared). The definitions; registration itself is the caller's.
    let definitions = definitions(&instance.id, manifest, &schemas, returns, implementations)?;
    let space_names: Vec<String> = spaces
        .iter()
        .map(|space| space.as_str().to_owned())
        .collect();
    let gate = manifest
        .commands
        .iter()
        .zip(&schemas)
        .map(|(command, schema)| {
            (
                command.name.clone(),
                gate_entry(
                    &instance.id,
                    manifest.plugin.kind,
                    &space_names,
                    schema,
                    false,
                ),
            )
        })
        .collect();
    let contexts = context_configs(manifest);
    let suggestions = manifest
        .commands
        .iter()
        .filter(|command| command.first_class && command.expose.mcp)
        .map(|command| command.name.clone())
        .collect();
    Ok(Prepared {
        report: InstanceReport {
            id: instance.id.clone(),
            required,
            source: resolved.source.clone(),
            spaces: space_names.clone(),
            manifest: Some(manifest.clone()),
            grants,
            commands: manifest.commands.iter().map(|c| c.name.clone()).collect(),
            packs: pack_states,
            contexts: manifest.contexts.iter().map(|c| c.name.clone()).collect(),
            pipelines: Vec::new(),
            mount: None,
            status: Status::Loaded,
        },
        manifest: manifest.clone(),
        commands: definitions,
        advertised: BTreeMap::new(),
        gate,
        pipeline_schemas,
        contexts,
        suggestions,
        spaces: space_names,
        skills,
    })
}

/// A context the instance declares must not already be taken by another instance.
fn check_context_names(
    instance: &PluginInstance,
    manifest: &Manifest,
    contexts_taken: &BTreeMap<String, String>,
) -> Result<(), PluginError> {
    for context in &manifest.contexts {
        if let Some(owner) = contexts_taken.get(&context.name) {
            return Err(PluginError::conflict(format!(
                "plugin instance `{}` declares the context `{}`, but it is already taken by {owner}",
                instance.id, context.name
            )));
        }
    }
    Ok(())
}

/// The AFD contexts a manifest contributes.
fn context_configs(manifest: &Manifest) -> Vec<ContextConfig> {
    manifest
        .contexts
        .iter()
        .map(|context| {
            let mut config = ContextConfig::new(&context.name)
                .with_description(&context.description)
                .with_priority(context.priority);
            if !context.triggers.is_empty() {
                config = config.with_triggers(context.triggers.clone());
            }
            config
        })
        .collect()
}

/// Read and validate every skill the manifest declares (`SKILL_INVALID`).
fn read_skills(
    instance: &PluginInstance,
    manifest: &Manifest,
    files: &dyn PluginFiles,
) -> Result<Vec<LoadedSkill>, PluginError> {
    manifest
        .skills
        .iter()
        .map(|decl| {
            let (loaded, entry) = read_skill(files, &decl.name, &decl.path)
                .map_err(|problem| PluginError::skill_invalid(&decl.path, problem))?;
            Ok(LoadedSkill {
                name: decl.name.clone(),
                instance: instance.id.clone(),
                plugin: manifest.plugin.id.clone(),
                version: manifest.plugin.version.clone(),
                files: loaded,
                entry,
            })
        })
        .collect()
}

/// Step 7 for skills. A name is served once: a second instance of one plugin shipping the same
/// bytes adds nothing, and any other repeat of a name is a conflict naming both owners.
fn check_skill_names(
    instance: &PluginInstance,
    skills: Vec<LoadedSkill>,
    shipped: &[LoadedSkill],
) -> Result<Vec<LoadedSkill>, PluginError> {
    let mut added = Vec::new();
    for skill in skills {
        match shipped.iter().find(|other| other.name == skill.name) {
            None => added.push(skill),
            Some(other) if other.plugin == skill.plugin && other.same_content(&skill) => {}
            Some(other) => {
                return Err(PluginError::conflict(format!(
                    "plugin instance `{}` ships the skill `{}`, but plugin instance `{}` already ships a skill of that name{}",
                    instance.id,
                    skill.name,
                    other.instance,
                    if other.plugin == skill.plugin {
                        " with other content"
                    } else {
                        ""
                    },
                )));
            }
        }
    }
    Ok(added)
}

/// Step 4 (section 7.2): each declared grant is granted, withheld, or fails the load.
fn decide_grants(
    instance: &PluginInstance,
    manifest: &Manifest,
) -> Result<(Vec<GrantReport>, BTreeSet<String>), PluginError> {
    let mut reports = Vec::new();
    let mut granted = BTreeSet::new();
    for grant in &manifest.grants {
        let name = grant.name.as_str();
        let mut report = GrantReport {
            name: grant.name.clone(),
            required: grant.required,
            reason: grant.reason.clone(),
            granted: false,
            withheld: None,
        };
        if !GRANTS.contains(&name) {
            let phase = RESERVED_GRANTS
                .iter()
                .find(|(reserved, _)| *reserved == name)
                .map_or_else(
                    || "is not in this host's catalog".to_owned(),
                    |(_, phase)| format!("arrives with {phase}"),
                );
            let error = PluginError::grant_unavailable(&instance.id, name, &phase);
            if grant.required {
                return Err(error);
            }
            report.withheld = Some(format!("unavailable: {phase}"));
        } else if instance.deny.iter().any(|denied| denied == name) {
            if grant.required {
                return Err(PluginError::grant_denied(&instance.id, name));
            }
            report.withheld = Some("denied by plugins.<id>.deny".to_owned());
        } else if needs_allow(name, ALLOW_REQUIRED) {
            // No grant of phase 1 needs an allow list, and the instance has no `allow` key yet
            // (it is reserved): a declared grant that does is denied until the instance lists
            // what it allows.
            if grant.required {
                return Err(PluginError::grant_denied(&instance.id, name));
            }
            report.withheld = Some("needs an allow list the instance does not give".to_owned());
        } else {
            report.granted = true;
            granted.insert(name.to_owned());
        }
        reports.push(report);
    }
    Ok((reports, granted))
}

/// Step 7 for one name.
pub(super) fn check_name(
    name: &str,
    instance: &str,
    taken: &BTreeMap<String, String>,
) -> Result<(), PluginError> {
    let first = name.split('-').next().unwrap_or(name);
    let collision = if let Some(owner) = taken.get(name) {
        Some(format!("it is already taken by {owner}"))
    } else if is_afd_builtin_name(name) {
        Some("it is one of AFD's built-in command names".to_owned())
    } else if HOST_DOMAINS.contains(&first) {
        Some(format!("`{first}` is a host domain"))
    } else if crate::RESERVED_VERBS.contains(&first) {
        Some(format!("`{first}` is a reserved CLI verb"))
    } else {
        None
    };
    match collision {
        Some(why) => Err(PluginError::conflict(format!(
            "plugin instance `{instance}` declares the command `{name}`, but {why}"
        ))),
        None => Ok(()),
    }
}

/// A shared handler, so a definition can wrap a plugin's `Arc`.
struct Shared2(Arc<dyn CommandHandler>);

#[async_trait]
impl CommandHandler for Shared2 {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0.execute(input, context).await
    }
}

/// The key of a plugin tool's origin in the tool's `_meta` (section 8.1).
pub const ORIGIN_KEY: &str = "dev.umbel/origin";

/// `{ plugin, kind, version, effects }`: where a plugin tool comes from. The host sets it from
/// the manifest; a plugin's own finished definition cannot keep a value of its own for the key.
fn origin(instance: &str, manifest: &Manifest, command: &CommandDecl) -> Value {
    serde_json::json!({
        "plugin": instance,
        "kind": manifest.plugin.kind.as_str(),
        "version": manifest.plugin.version,
        "effects": command.effects.iter().map(|effect| effect.as_str()).collect::<Vec<_>>(),
    })
}

fn expose(command: &CommandDecl) -> ExposeOptions {
    ExposeOptions::new()
        .with_palette(command.expose.palette)
        .with_mcp(command.expose.mcp)
        .with_agent(command.expose.agent)
        .with_cli(command.expose.cli)
}

fn returns_schema(value: Value) -> JsonSchema {
    serde_json::from_value::<JsonSchema>(value).unwrap_or_else(|_| JsonSchema {
        schema_type: Some(JsonSchemaType::Object),
        ..JsonSchema::default()
    })
}

/// Match each manifest command with the plugin's implementation of it and build the definition
/// the registry gets (specification section 6.1).
fn definitions(
    instance: &str,
    manifest: &Manifest,
    schemas: &[Value],
    returns: Vec<Option<Value>>,
    implementations: Vec<PluginCommand>,
) -> Result<Vec<(CommandDefinition, Value)>, PluginError> {
    let bad =
        |key: String, problem: String| PluginError::manifest_invalid(&manifest.file, &key, problem);
    let mut remaining: Vec<Option<PluginCommand>> = implementations.into_iter().map(Some).collect();
    for implementation in remaining.iter().flatten() {
        if !manifest
            .commands
            .iter()
            .any(|command| command.name == implementation.name())
        {
            return Err(bad(
                "commands".to_owned(),
                format!(
                    "the plugin implements `{}`, which the manifest does not declare",
                    implementation.name()
                ),
            ));
        }
    }
    let mut built = Vec::new();
    for (index, ((command, schema), returns)) in manifest
        .commands
        .iter()
        .zip(schemas)
        .zip(returns)
        .enumerate()
    {
        let key = format!("commands[{index}]");
        let slot = remaining
            .iter_mut()
            .find(|slot| slot.as_ref().is_some_and(|c| c.name() == command.name))
            .and_then(Option::take);
        let Some(implementation) = slot else {
            return Err(bad(
                key,
                format!("`{}` has no implementation in the plugin", command.name),
            ));
        };
        let definition = match implementation {
            PluginCommand::Handler { handler, .. } => {
                let mut definition = CommandDefinition::new(
                    &command.name,
                    &command.description,
                    vec![],
                    Shared2(handler),
                );
                if let Some(category) = &command.category {
                    definition = definition.with_category(category);
                }
                if !command.tags.is_empty() {
                    definition = definition.with_tags(command.tags.clone());
                }
                if let Some(version) = &command.version {
                    definition = definition.with_version(version);
                }
                if !command.contexts.is_empty() {
                    definition = definition.with_contexts(command.contexts.clone());
                }
                if let Some(prompt) = &command.confirm_prompt {
                    definition = definition.with_confirm_prompt(prompt);
                }
                if command.destructive {
                    definition = definition.with_destructive(true);
                }
                if command.approval_required {
                    definition = definition.with_approval(ApprovalPolicy::Required);
                }
                if let Some(time) = &command.execution_time
                    && let Ok(time) =
                        serde_json::from_value::<ExecutionTime>(Value::String(time.clone()))
                {
                    definition = definition.with_execution_time(time);
                }
                if !command.examples.is_empty() {
                    definition = definition.with_examples(
                        command
                            .examples
                            .iter()
                            .map(|(title, input)| CommandExample::new(title, input.clone()))
                            .collect(),
                    );
                }
                if let Some(returns) = returns {
                    definition = definition.with_returns(returns_schema(returns));
                }
                if command.mutation() {
                    definition = definition.as_mutation();
                }
                definition
            }
            PluginCommand::Definition {
                definition,
                schema: given,
            } => {
                if let Some(problem) = mismatch(command, &definition, &given, schema) {
                    return Err(bad(key, problem));
                }
                *definition
            }
        };
        let definition = definition
            .with_expose(expose(command))
            .with_tool_meta(ORIGIN_KEY, origin(instance, manifest, command));
        built.push((definition, schema.clone()));
    }
    Ok(built)
}

/// How a finished definition differs from its manifest entry, if it does.
fn mismatch(
    command: &CommandDecl,
    definition: &CommandDefinition,
    given: &Value,
    declared: &Value,
) -> Option<String> {
    let name = &command.name;
    if definition.description != command.description {
        return Some(format!(
            "`{name}`: the definition's description differs from the manifest's"
        ));
    }
    if given != declared {
        return Some(format!(
            "`{name}`: the definition's input schema differs from the manifest's"
        ));
    }
    if definition.mutation != command.mutation() {
        return Some(format!(
            "`{name}`: the definition's `mutation` ({}) disagrees with the manifest's effects",
            definition.mutation
        ));
    }
    if definition.confirm_prompt != command.confirm_prompt {
        return Some(format!(
            "`{name}`: the definition's confirm_prompt differs from the manifest's"
        ));
    }
    let approval_required = matches!(definition.approval, Some(ApprovalPolicy::Required));
    let approval_other = matches!(definition.approval, Some(ApprovalPolicy::Conditional(_)));
    if approval_other || approval_required != command.approval_required {
        return Some(format!(
            "`{name}`: the definition's approval differs from the manifest's"
        ));
    }
    let contexts = definition.contexts.clone().unwrap_or_default();
    if contexts != command.contexts {
        return Some(format!(
            "`{name}`: the definition's contexts differ from the manifest's"
        ));
    }
    None
}
