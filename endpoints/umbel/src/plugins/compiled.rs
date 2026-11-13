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
use super::grants::{CallServices, Services};
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

    /// The plugin's own check of its pack `pack`, run by the doctor against a space override
    /// (D172, `plugins.pack_checks`). `services` are the instance's granted services for a call in
    /// the override's space, so the plugin reads the override as its commands would. `None`, the
    /// default, offers no check; otherwise an AFD `CommandResult` as JSON. See
    /// [`umbel_sdk::Plugin::check_pack`].
    fn check_pack(&self, pack: &str, services: CallServices) -> Option<Value> {
        let _ = (pack, services);
        None
    }
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

    fn check_pack(&self, pack: &str, services: CallServices) -> Option<Value> {
        (**self).check_pack(pack, services)
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

    fn check_pack(&self, pack: &str, services: CallServices) -> Option<Value> {
        let space = services.space().as_str().to_owned();
        let call = CallContext {
            command: String::new(),
            space: Some(space.clone()),
            spaces: vec![space],
            interface: "cli".to_owned(),
            ..CallContext::default()
        };
        let mut cx = Cx::new(call, services);
        self.plugin
            .check_pack(pack, &mut cx)
            .map(umbel_sdk::Outcome::into_value)
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

/// The call context a plugin receives (WIT `call-context`): the command, the trace id, the
/// resolved space for a command with a `space` input, a summary of the actor, the host's
/// pipeline attestation for a step (phase 4 section 10.1), whether the host counts the caller
/// as a person (phase 3 section 3.3), the caller's delegation chain, a person's decision on
/// the person page for this very call with the validated `input` (phase 5 step 6), and the page
/// of its preview the person page asks for (the Ideas host-review specification, section 2).
/// Never a credential or a token.
pub(super) fn call_context(
    name: &str,
    has_space: bool,
    services: &super::grants::CallServices,
    input: &Value,
    context: &CommandContext,
) -> CallContext {
    let actor = context.actor.clone();
    CallContext {
        command: name.to_owned(),
        trace_id: context.trace_id.clone().unwrap_or_default(),
        space: has_space.then(|| services.space().as_str().to_owned()),
        spaces: services
            .spaces()
            .iter()
            .map(|space| space.as_str().to_owned())
            .collect(),
        output_budget: context.output_budget(),
        actor_kind: actor
            .as_ref()
            .map(|actor| as_text(&actor.kind))
            .unwrap_or_default(),
        actor_id: actor.as_ref().and_then(|actor| actor.id.clone()),
        on_behalf_of: actor.and_then(|actor| actor.on_behalf_of),
        // The CLI interface only for the host's own command line (phase 5 step 10): a library
        // context that sets it without the seal is the library's, as a plugin sees it too.
        interface: context
            .interface
            .filter(|interface| {
                *interface != afd::CommandInterface::Cli || crate::authority::is_cli(context)
            })
            .map(|interface| interface.as_str().to_owned())
            .unwrap_or_default(),
        pipeline: services.pipeline(),
        person: services.person(),
        equivalents: services.equivalents(),
        sealed_positions: services.seals_positions(),
        delegation_chain: crate::principal::Principal::chain_of(context),
        person_decision: services.person_decision(input),
        person_check: services.person_check(),
        preview_page: services.preview_page(),
    }
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
        let services = self.services.call_command(&self.name, &input, &context);
        let call = call_context(&self.name, self.has_space, &services, &input, &context);
        let plugin = Arc::clone(&self.plugin);
        let name = self.name.clone();
        let revoked = services.revoked();
        let joined = tokio::task::spawn_blocking(move || {
            let mut cx = Cx::new(call, services);
            plugin.handle(&name, input, &mut cx)
        })
        .await;
        // A task whose space its caller can no longer read answers that, whatever the plugin made
        // of the refusal (phase 5 section 12.2).
        if revoked.load(std::sync::atomic::Ordering::SeqCst) {
            return afd::failure(space_unreadable());
        }
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

/// `TASK_SPACE_UNREADABLE` (phase 5 section 10.5): a batch of a running task found a space of the
/// call no longer readable by its caller, so it stopped. Not retryable.
pub(crate) fn space_unreadable() -> afd::CommandError {
    afd::CommandError::new(
        super::grants::TASK_SPACE_UNREADABLE,
        "The task stopped: a space it runs in is no longer readable by its caller",
    )
    .with_suggestion(
        "The command may have made part of its change: check its effect; ask the workspace owner for access before starting it again.",
    )
    .with_retryable(false)
}
