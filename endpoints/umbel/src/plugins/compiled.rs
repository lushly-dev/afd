//! Compiled plugins (specification section 6.1): Rust code linked into a host binary.
//!
//! A deployer who builds a binary with a compiled plugin trusts it as much as the host (D42), so
//! the grant gates of [`Services`] are API discipline and a declaration, not a sandbox. The stock
//! `umbel` binary compiles in no plugin; a deployer's `main` calls
//! [`cli::run`](crate::cli::run) with a `configure` hook that calls
//! [`HostBuilder::with_compiled`](crate::HostBuilder::with_compiled).

use std::sync::Arc;

use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult};
use async_trait::async_trait;
use serde_json::Value;
use umbel_sdk::{CallContext, Cx};

use super::PluginError;
use super::files::{AssetFiles, PluginFiles};
use super::grants::Services;
use super::manifest::Manifest;

pub use umbel_sdk::Asset;

/// A plugin linked into the host binary.
pub trait CompiledPlugin: Send + Sync + 'static {
    /// The manifest text.
    fn manifest(&self) -> &str;

    /// The plugin's files (packs, skills, schemas the manifest names), embedded.
    fn assets(&self) -> &'static [Asset] {
        &[]
    }

    /// Build the command handlers, given the instance's granted services. Called once at seal.
    ///
    /// # Errors
    /// A [`PluginError`], which fails the instance's load.
    fn commands(&self, services: Services) -> Result<Vec<PluginCommand>, PluginError>;
}

impl<T: CompiledPlugin + ?Sized> CompiledPlugin for Arc<T> {
    fn manifest(&self) -> &str {
        (**self).manifest()
    }

    fn assets(&self) -> &'static [Asset] {
        (**self).assets()
    }

    fn commands(&self, services: Services) -> Result<Vec<PluginCommand>, PluginError> {
        (**self).commands(services)
    }
}

/// One manifest command's implementation.
pub enum PluginCommand {
    /// A handler; the host builds the `CommandDefinition` from the manifest entry, so the plugin
    /// cannot set metadata the manifest does not declare.
    Handler {
        /// The registered command name.
        name: String,
        /// What runs.
        handler: Arc<dyn CommandHandler>,
    },
    /// A finished AFD definition and its input schema, for code that already builds them (the
    /// todo backend). The host checks it against the manifest entry (name, description, schema,
    /// `mutation` against the effects, `confirm_prompt`, `approval`, `contexts`) and refuses a
    /// mismatch with `PLUGIN_MANIFEST_INVALID`, then sets the expose flags itself.
    Definition {
        /// The definition.
        definition: Box<CommandDefinition>,
        /// Its whole input schema.
        schema: Value,
    },
}

impl PluginCommand {
    /// A handler for the manifest command `name`.
    pub fn handler(name: impl Into<String>, handler: impl CommandHandler + 'static) -> Self {
        Self::Handler {
            name: name.into(),
            handler: Arc::new(handler),
        }
    }

    /// A finished definition with its whole input schema.
    pub fn definition(definition: CommandDefinition, schema: Value) -> Self {
        Self::Definition {
            definition: Box::new(definition),
            schema,
        }
    }

    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Handler { name, .. } => name,
            Self::Definition { definition, .. } => &definition.name,
        }
    }
}

/// Turn an SDK plugin into a [`CompiledPlugin`], passing its manifest and `assets()` through.
/// Each manifest command is routed to [`umbel_sdk::Plugin::handle`], called on a blocking thread
/// with a [`Cx`] over the call's granted services.
pub fn sdk(plugin: impl umbel_sdk::Plugin) -> impl CompiledPlugin {
    SdkPlugin {
        plugin: Arc::new(plugin),
    }
}

struct SdkPlugin<P: umbel_sdk::Plugin> {
    plugin: Arc<P>,
}

impl<P: umbel_sdk::Plugin> CompiledPlugin for SdkPlugin<P> {
    fn manifest(&self) -> &str {
        self.plugin.manifest()
    }

    fn assets(&self) -> &'static [Asset] {
        self.plugin.assets()
    }

    fn commands(&self, services: Services) -> Result<Vec<PluginCommand>, PluginError> {
        let manifest = Manifest::parse(self.plugin.manifest(), "compiled plugin manifest")?;
        let files = AssetFiles::new(self.plugin.assets());
        manifest
            .commands
            .iter()
            .map(|command| {
                let has_space = command
                    .input_schema
                    .load(&files as &dyn PluginFiles)
                    .map(|schema| has_space_property(&schema))
                    .map_err(|problem| {
                        PluginError::load_failed(
                            services.instance(),
                            format!("the schema of `{}` {problem}", command.name),
                        )
                    })?;
                Ok(PluginCommand::handler(
                    command.name.clone(),
                    SdkHandler {
                        plugin: Arc::clone(&self.plugin),
                        name: command.name.clone(),
                        has_space,
                        services: services.clone(),
                    },
                ))
            })
            .collect()
    }
}

/// Whether an input schema has a `space` property.
pub(crate) fn has_space_property(schema: &Value) -> bool {
    schema
        .get("properties")
        .and_then(|properties| properties.get("space"))
        .is_some()
}

struct SdkHandler<P: umbel_sdk::Plugin> {
    plugin: Arc<P>,
    name: String,
    has_space: bool,
    services: Services,
}

fn as_text<T: serde::Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(Value::String(text)) => text,
        _ => String::new(),
    }
}

#[async_trait]
impl<P: umbel_sdk::Plugin> CommandHandler for SdkHandler<P> {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let services = self.services.call(&input, &context);
        let actor = context.actor.clone();
        let call = CallContext {
            command: self.name.clone(),
            trace_id: context.trace_id.clone().unwrap_or_default(),
            space: self.has_space.then(|| services.space().as_str().to_owned()),
            actor_kind: actor
                .as_ref()
                .map(|actor| as_text(&actor.kind))
                .unwrap_or_default(),
            actor_id: actor.as_ref().and_then(|actor| actor.id.clone()),
            on_behalf_of: actor.and_then(|actor| actor.on_behalf_of),
            interface: context
                .interface
                .map(|interface| interface.as_str().to_owned())
                .unwrap_or_default(),
        };
        let plugin = Arc::clone(&self.plugin);
        let name = self.name.clone();
        let joined = tokio::task::spawn_blocking(move || {
            let mut cx = Cx::new(call, services);
            plugin.handle(&name, input, &mut cx)
        })
        .await;
        match joined {
            Ok(outcome) => serde_json::from_value::<CommandResult<Value>>(outcome.into_value())
                .unwrap_or_else(|error| {
                    afd::failure(
                        afd::CommandError::new(
                            super::codes::PLUGIN_RESULT_INVALID,
                            format!(
                                "plugin command `{}` returned something that is not a CommandResult: {error}",
                                self.name
                            ),
                        )
                        .with_suggestion("The plugin failed; report it to its author with the trace id.")
                        .with_retryable(false),
                    )
                }),
            // A panic is AFD's COMMAND_EXECUTION_ERROR, as for any handler: let the registry
            // catch it, and the next call works.
            Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
            Err(error) => afd::failure(
                afd::CommandError::new(
                    afd::error_codes::INTERNAL_ERROR,
                    format!("plugin command `{}` was cancelled: {error}", self.name),
                )
                .with_suggestion("Retry the command.")
                .with_retryable(true),
            ),
        }
    }
}
