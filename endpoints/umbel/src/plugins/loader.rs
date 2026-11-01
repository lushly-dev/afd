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
use std::sync::Arc;

use afd::{
    ApprovalPolicy, CommandContext, CommandDefinition, CommandExample, CommandHandler,
    CommandRegistry, CommandResult, ExecutionTime, ExposeOptions, JsonSchema, JsonSchemaType,
    is_afd_builtin_name,
};
use async_trait::async_trait;
use serde_json::Value;

use super::compiled::{CompiledPlugin, PluginCommand, has_space_property};
use super::config;
use super::files::{AssetFiles, DirFiles, PluginFiles};
use super::grants::{ALLOW_REQUIRED, Services, Shared, needs_allow};
use super::manifest::{CommandDecl, Manifest, PluginKind};
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
}

/// Every instance of the workspace and the plugin commands the host registered.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct LoadedPlugins {
    pub instances: Vec<InstanceReport>,
    pub gate: BTreeMap<String, GateEntry>,
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
    pub registry: &'a CommandRegistry,
    pub catalog: &'a Catalog,
}

/// An instance past steps 1 and 2.
struct Resolved {
    manifest: Manifest,
    files: Arc<dyn PluginFiles + Send + Sync>,
    compiled: Option<Arc<dyn CompiledPlugin>>,
    source: String,
}

/// An instance past step 7, ready to register.
struct Prepared {
    report: InstanceReport,
    commands: Vec<(CommandDefinition, Value)>,
    gate: Vec<(String, GateEntry)>,
}

/// Load every instance of `plugins.enabled` and register its commands.
///
/// # Errors
/// The error of the first required instance that fails; nothing of it is registered.
pub(crate) fn load(inputs: &Inputs<'_>) -> Result<LoadedPlugins, PluginError> {
    let mut loaded = LoadedPlugins::default();
    let mut taken: BTreeMap<String, String> = inputs
        .registry
        .list()
        .iter()
        .map(|command| (command.name.clone(), "the host".to_owned()))
        .collect();
    for instance in &inputs.workspace.config().plugins.instances {
        let resolved = match resolve(inputs, instance) {
            Ok(resolved) => resolved,
            Err((error, http_mount)) => {
                let required = instance.required.unwrap_or(!http_mount);
                fail(&mut loaded, instance, required, None, error)?;
                continue;
            }
        };
        let required = instance
            .required
            .unwrap_or(!resolved.manifest.is_http_mount());
        match prepare(inputs, instance, &resolved, required, &taken) {
            Ok(prepared) => {
                for (definition, schema) in prepared.commands {
                    let name = definition.name.clone();
                    inputs
                        .registry
                        .register_with_schema(definition, schema)
                        .map_err(|message| {
                            PluginError::load_failed(
                                &instance.id,
                                format!("cannot register `{name}`: {message}"),
                            )
                        })?;
                    taken.insert(name, format!("plugin instance `{}`", instance.id));
                }
                loaded.gate.extend(prepared.gate);
                loaded.instances.push(prepared.report);
            }
            Err(error) => fail(
                &mut loaded,
                instance,
                required,
                Some(resolved.manifest),
                error,
            )?,
        }
    }
    Ok(loaded)
}

/// A required instance's failure stops the host; an optional one is recorded and skipped.
fn fail(
    loaded: &mut LoadedPlugins,
    instance: &PluginInstance,
    required: bool,
    manifest: Option<Manifest>,
    error: PluginError,
) -> Result<(), PluginError> {
    if required {
        return Err(error);
    }
    loaded.instances.push(InstanceReport {
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
        status: Status::Failed(error),
    });
    Ok(())
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
            }
        }
    };
    let http = opened.manifest.is_http_mount();
    super::doctor::fits(instance, &opened.manifest, opened.compiled.is_some())
        .map_err(|error| (error, http))?;
    if matches!(
        opened.manifest.plugin.kind,
        PluginKind::Component | PluginKind::Mounted
    ) {
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

    // 6. Prepare the kind: a compiled plugin builds its handlers; a pack plugin has no code.
    let services = Services::new(Shared {
        instance: instance.id.clone(),
        granted,
        config: configuration,
        spaces: spaces.clone(),
        packs: manifest.packs.clone(),
        files: Arc::clone(&resolved.files),
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

    // 8 (prepared). The definitions; registration itself is the caller's.
    let definitions = definitions(manifest, &schemas, returns, implementations)?;
    let mut gate = Vec::new();
    for (command, schema) in manifest.commands.iter().zip(&schemas) {
        gate.push((
            command.name.clone(),
            GateEntry {
                instance: instance.id.clone(),
                kind: manifest.plugin.kind,
                spaces: spaces
                    .iter()
                    .map(|space| space.as_str().to_owned())
                    .collect(),
                space_command: has_space_property(schema),
            },
        ));
    }
    Ok(Prepared {
        report: InstanceReport {
            id: instance.id.clone(),
            required,
            source: resolved.source.clone(),
            spaces: spaces
                .iter()
                .map(|space| space.as_str().to_owned())
                .collect(),
            manifest: Some(manifest.clone()),
            grants,
            commands: manifest.commands.iter().map(|c| c.name.clone()).collect(),
            status: Status::Loaded,
        },
        commands: definitions,
        gate,
    })
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
fn check_name(
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
        let definition = definition.with_expose(expose(command));
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
