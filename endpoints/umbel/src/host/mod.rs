//! The host: one registry over one workspace.
//!
//! [`HostBuilder`] opens a workspace and collects commands; [`HostBuilder::seal`] registers the
//! built-in and bootstrap commands, installs the middleware, builds and validates the MCP
//! surface, and returns the [`Host`]. Commands cannot be added after `seal`, which keeps the
//! hybrid tool set fixed while serving (H2).

mod digest;
mod error;
mod space;

pub use error::HostError;
pub use space::SPACE_NOT_FOUND;

use crate::commands::{self, Builtin};
use crate::events::{EventsError, ProjectingSink, Projector, RepairReport};
use crate::middleware;
use crate::plugins::{self, Catalog, CompiledPlugin, LoadedPlugins, LoadedSkill};
use crate::principal::{Authentication, Principal, Transport};
use crate::store::{Hub, Stores};
use crate::surfaces;
use crate::workspace::{Workspace, codes};
use afd::server::{McpServer, SkillCatalog};
use afd::{
    Actor, ApprovalMiddlewareOptions, Clock, CommandContext, CommandDefinition, CommandInterface,
    CommandRegistry, DirectClient, JournalRecorder, create_approval_middleware,
    get_bootstrap_commands,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::{Arc, OnceLock};

/// The CLI verbs that are not commands, or that run a bootstrap command or a batch. A command
/// whose name starts with one of these could not be reached as `umbel <domain> <action>`, so
/// `seal` refuses it. `umbel call <command>` reaches any CLI-exposed command by its full name.
pub const RESERVED_VERBS: &[&str] = &["init", "serve", "help", "docs", "schema", "call", "batch"];

enum Pending {
    Plain(CommandDefinition),
    Schema(CommandDefinition, Value),
}

impl Pending {
    fn name(&self) -> &str {
        match self {
            Self::Plain(command) | Self::Schema(command, _) => &command.name,
        }
    }
}

/// Opens a workspace and collects the commands to register before sealing.
pub struct HostBuilder {
    workspace: Workspace,
    commands: Vec<Pending>,
    compiled: Vec<Arc<dyn CompiledPlugin>>,
    clock: Option<Arc<dyn Clock>>,
    mount_roots: Vec<Vec<u8>>,
    #[cfg(feature = "auth")]
    token_verifier: Option<Arc<dyn afd::server::auth::TokenVerifier>>,
}

impl HostBuilder {
    /// Open the workspace at `path` (see [`Workspace::open`]).
    ///
    /// # Errors
    /// The `WORKSPACE_*` codes of opening a workspace.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, HostError> {
        Ok(Self::from_workspace(Workspace::open(path)?))
    }

    /// Build over a workspace that was opened with overrides (the CLI's `--log` and
    /// `--bind`).
    pub fn from_workspace(workspace: Workspace) -> Self {
        Self {
            workspace,
            commands: Vec::new(),
            compiled: Vec::new(),
            clock: None,
            mount_roots: Vec::new(),
            #[cfg(feature = "auth")]
            token_verifier: None,
        }
    }

    /// Make a compiled plugin available as `compiled:<id>`, where `<id>` is the `plugin.id` of
    /// its manifest. It is loaded only when an instance in `plugins.enabled` names it. A binary
    /// built with compiled plugins calls this from the `configure` hook it passes to
    /// [`cli::run`](crate::cli::run).
    #[must_use]
    pub fn with_compiled(mut self, plugin: impl CompiledPlugin) -> Self {
        self.compiled.push(Arc::new(plugin));
        self
    }

    /// Trust one more root certificate (PEM) when an HTTP mount connects over HTTPS, beside the
    /// platform's own roots: for a server behind a private certificate authority.
    #[cfg(feature = "mounted")]
    #[must_use]
    pub fn with_mount_root_certificate(mut self, pem: impl Into<Vec<u8>>) -> Self {
        self.mount_roots.push(pem.into());
        self
    }

    /// The compiled plugins added so far, by id, each with its embedded manifest. The doctor
    /// resolves `compiled:` sources against it, even when `seal` fails.
    ///
    /// # Errors
    /// `PLUGIN_MANIFEST_INVALID` for an embedded manifest that has no readable `plugin.id`.
    pub fn compiled_catalog(&self) -> Result<plugins::CompiledCatalog, HostError> {
        Ok(Catalog::new(&self.compiled)?.manifests().clone())
    }

    /// Give every call of this host the clock `clock`, on every surface: the CLI, the library's
    /// [`Host::context`] and the MCP context hook. For tests and replays; a host has the system
    /// clock by default.
    #[must_use]
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }

    /// Fill the HTTP surface's token verifier slot (phase 5 section 3.3) with `verifier`, for the
    /// tests of the hosted listener. **Test seam** (`testkit` only): until phase 5 step 2b
    /// builds the verifier from `[auth.issuers]`, the slot is empty in a shipped build, and mode
    /// `oauth` refuses to start rather than serve requests it cannot verify. Even with a verifier,
    /// the context hook refuses every call until step 2b maps credentials to a principal.
    #[cfg(all(feature = "auth", feature = "testkit"))]
    #[must_use]
    pub fn with_token_verifier(
        mut self,
        verifier: impl afd::server::auth::TokenVerifier + 'static,
    ) -> Self {
        self.token_verifier = Some(Arc::new(verifier));
        self
    }

    /// Add a command. A registration problem (a reserved CLI verb, a name already taken) is
    /// reported by [`seal`](Self::seal), which is where every command is checked together.
    #[must_use]
    pub fn register(mut self, command: CommandDefinition) -> Self {
        self.commands.push(Pending::Plain(command));
        self
    }

    /// Add a command registered with its whole input JSON Schema.
    #[must_use]
    pub fn register_with_schema(mut self, command: CommandDefinition, schema: Value) -> Self {
        self.commands.push(Pending::Schema(command, schema));
        self
    }

    /// Register the built-in commands, then the added ones, then every plugin instance of
    /// `plugins.enabled` (the load sequence of the phase 1 specification, section 6), then AFD's
    /// bootstrap commands (with `cli: true`); install the middleware; build the MCP server and
    /// validate its surface.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` for a key under 32 bytes; `WORKSPACE_CONFIG_INVALID` naming
    /// `mcp.first_class_tools` for an invalid first-class set, or naming the command for a
    /// reserved CLI verb or a name collision; the `PLUGIN_*` code of the first required plugin
    /// instance that fails to load (an optional one is skipped and reported by `plugin-list`).
    pub fn seal(self) -> Result<Host, HostError> {
        let workspace = Arc::new(self.workspace);
        let registry = Arc::new(CommandRegistry::new());
        let first_class_cell = Arc::new(OnceLock::new());
        let plan_cell: Arc<OnceLock<surfaces::FirstClassPlan>> = Arc::new(OnceLock::new());
        let loaded_cell: Arc<OnceLock<Arc<LoadedPlugins>>> = Arc::new(OnceLock::new());
        let projector = Arc::new(Projector::new(Arc::clone(&workspace)));
        let stores: Hub = Arc::new(Stores::new(Arc::clone(&workspace)));
        let ledger = Arc::new(plugins::Ledger::default());
        let attestations = Arc::new(plugins::PipelineAttestations::default());
        let prompts: Arc<OnceLock<crate::authority::Prompts>> = Arc::new(OnceLock::new());
        let catalog = Catalog::new(&self.compiled)?;
        let compiled_catalog = Arc::new(catalog.manifests().clone());

        let builtins: Vec<Builtin> = vec![
            commands::workspace_show(
                Arc::clone(&workspace),
                Arc::clone(&first_class_cell),
                Arc::clone(&loaded_cell),
            ),
            commands::plugin_list(Arc::clone(&loaded_cell)),
            commands::plugin_show(Arc::clone(&loaded_cell)),
            commands::skill_list(Arc::clone(&loaded_cell)),
            commands::skill_export(Arc::clone(&loaded_cell)),
            commands::plugin_new(),
            commands::plugin_check(self.compiled.clone()),
            commands::event_list(Arc::clone(&workspace), Arc::clone(&projector)),
            commands::event_ack(Arc::clone(&workspace), Arc::clone(&projector)),
            commands::space_list(Arc::clone(&workspace), Arc::clone(&projector)),
            commands::workspace_doctor(
                Arc::clone(&workspace),
                Arc::downgrade(&registry),
                Arc::clone(&first_class_cell),
                Arc::clone(&plan_cell),
                Arc::clone(&loaded_cell),
                Arc::clone(&compiled_catalog),
                Arc::clone(&stores),
            ),
            commands::event_rebuild(Arc::clone(&workspace), Arc::clone(&projector)),
        ];
        #[cfg(feature = "store-embedded")]
        let builtins = {
            let mut builtins = builtins;
            builtins.push(commands::store_show(
                Arc::clone(&workspace),
                Arc::clone(&stores),
            ));
            builtins.push(commands::store_check(
                Arc::clone(&workspace),
                Arc::clone(&stores),
            ));
            builtins.push(commands::store_backup(
                Arc::clone(&workspace),
                Arc::clone(&stores),
            ));
            builtins
        };
        for Builtin { definition, schema } in builtins {
            register(&registry, Pending::Schema(definition, schema))?;
        }
        for pending in self.commands {
            if let Some(verb) = reserved_verb(pending.name()) {
                return Err(HostError::config_invalid(
                    &format!("Command `{}`", pending.name()),
                    &format!("starts with `{verb}`, a reserved CLI verb"),
                    &format!(
                        "Rename the command so that its first word is not one of: {}.",
                        RESERVED_VERBS.join(", ")
                    ),
                ));
            }
            register(&registry, pending)?;
        }
        let loaded = Arc::new(plugins::load(&plugins::Inputs {
            workspace: &workspace,
            projector: &projector,
            stores: &stores,
            ledger: &ledger,
            attestations: &attestations,
            registry: &registry,
            catalog: &catalog,
            mount_roots: &self.mount_roots,
            prompts: &prompts,
        })?);
        let _ = loaded_cell.set(Arc::clone(&loaded));
        let _ = prompts.set(terminal_prompts(&loaded));
        for command in get_bootstrap_commands(&registry) {
            let expose = command.expose.clone().with_cli(true);
            register(&registry, Pending::Plain(command.with_expose(expose)))?;
        }

        let plan = surfaces::first_class_plan(
            workspace.config().mcp.first_class_tools.as_deref(),
            &registry,
            &loaded.suggestions,
        );
        let first_class = plan.tools.clone();
        let _ = first_class_cell.set(first_class.clone());
        let _ = plan_cell.set(plan);

        // The server comes before the middleware: `with_contexts` registers `afd-context-*`
        // into the registry, and the middleware snapshots the registry (section 8.5).
        let server = surfaces::mcp::build_server(
            &registry,
            &workspace,
            &first_class,
            &loaded.contexts,
            self.clock.as_ref(),
        )?;
        let server = serve_skills(server, &loaded)?;
        install_middleware(&registry, &workspace, &loaded, &ledger)?;
        install_journal(&registry, &workspace, &projector, digest_commands(&loaded));

        // A marker left by a crash or a failed projection is repaired before anything else. A
        // stream too damaged to repair does not stop the open: `umbel event rebuild` needs the
        // host, and the doctor reports it.
        match projector.catch_up_if_pending() {
            Err(EventsError::Lock(error)) => return Err(error.into()),
            Err(error) => tracing::warn!("{error}"),
            Ok(()) => {}
        }

        Ok(Host {
            workspace,
            registry,
            first_class,
            projector,
            server,
            clock: self.clock,
            loaded,
            #[cfg(feature = "auth")]
            token_verifier: self.token_verifier,
        })
    }
}

/// Serve the loaded plugins' skills on the Skills extension and as resources (specification
/// section 8.3). With no skill the server is unchanged: it declares neither.
fn serve_skills(server: McpServer, loaded: &LoadedPlugins) -> Result<McpServer, HostError> {
    if loaded.skills.is_empty() {
        return Ok(server);
    }
    let catalog = SkillCatalog::new(loaded.skills.iter().map(LoadedSkill::to_skill).collect())
        .map_err(|problem| HostError::from(plugins::PluginError::load_failed("skills", problem)))?;
    Ok(server.with_skills(catalog))
}

/// The reserved CLI verb a command name starts with, if any.
fn reserved_verb(name: &str) -> Option<&'static str> {
    let first = name.split('-').next().unwrap_or(name);
    RESERVED_VERBS.iter().copied().find(|verb| *verb == first)
}

fn register(registry: &CommandRegistry, pending: Pending) -> Result<(), HostError> {
    let name = pending.name().to_owned();
    let result = match pending {
        Pending::Plain(command) => registry.register(command),
        Pending::Schema(command, schema) => registry.register_with_schema(command, schema),
    };
    result.map_err(|message| {
        HostError::config_invalid(
            &format!("Command `{name}`"),
            &format!("cannot be registered: {message}"),
            "Give the command a unique domain-action name and a valid input schema.",
        )
    })
}

/// Whether the command's input schema has a property called `property`.
fn has_property(registry: &CommandRegistry, name: &str, property: &str) -> bool {
    registry
        .get_tool(name)
        .and_then(|tool| {
            tool.get("inputSchema")?
                .get("properties")?
                .get(property)
                .cloned()
        })
        .is_some()
}

/// Install the middleware, outermost first: the event stamp, the space check, the plugin gate,
/// approvals.
///
/// The set of space commands is the host's own knowledge: a built-in by its `space` property, a
/// plugin command by what its instance's load decided (a mounted tool's own `space` argument is
/// the server's, not Umbel's).
fn install_middleware(
    registry: &Arc<CommandRegistry>,
    workspace: &Arc<Workspace>,
    loaded: &LoadedPlugins,
    ledger: &Arc<plugins::Ledger>,
) -> Result<(), HostError> {
    let commands = registry.list();
    let with_space: Arc<HashSet<String>> = Arc::new(
        commands
            .iter()
            .filter(|command| match loaded.gate.get(&command.name) {
                Some(entry) => entry.space_command,
                None => has_property(registry, &command.name, "space"),
            })
            .map(|command| command.name.clone())
            .collect(),
    );
    // A `spaces` input is checked like `space` (phase 2 specification, section 3.3, rule 9).
    let with_spaces: Arc<HashSet<String>> = Arc::new(
        commands
            .iter()
            .filter(|command| match loaded.gate.get(&command.name) {
                Some(entry) => entry.spaces_command,
                None => has_property(registry, &command.name, "spaces"),
            })
            .map(|command| command.name.clone())
            .collect(),
    );
    // A pipeline's steps are journaled and projected as the calls they are, so the pipeline
    // itself is not projected as a second event.
    let mutations: HashSet<String> = commands
        .iter()
        .filter(|command| {
            command.mutation
                && !middleware::UNPROJECTED_MUTATIONS.contains(&command.name.as_str())
                && !loaded
                    .gate
                    .get(&command.name)
                    .is_some_and(|entry| entry.pipeline)
        })
        .map(|command| command.name.clone())
        .collect();

    registry.add_middleware(middleware::event_stamp(
        mutations,
        Arc::clone(&with_space),
        workspace.default_space().to_string(),
    ));
    let resolve: middleware::ResolveSpace = {
        let resolver = Arc::clone(workspace);
        Arc::new(move |input, context| {
            resolver
                .resolve_space(input, context)
                .map(|space| space.to_string())
        })
    };
    let resolve_many: middleware::ResolveSpaces = {
        let resolver = Arc::clone(workspace);
        Arc::new(move |input, context| {
            resolver
                .resolve_spaces(input, context)
                .map(|spaces| spaces.into_iter().map(|space| space.to_string()).collect())
        })
    };
    registry.add_middleware(middleware::space_check(
        with_space,
        with_spaces,
        Arc::clone(&resolve),
        Arc::clone(&resolve_many),
    ));
    let entries: BTreeMap<_, _> = loaded.gate.clone();
    registry.add_middleware(middleware::plugin_gate(
        Arc::new(entries),
        middleware::GateContext {
            workspace: Arc::clone(workspace),
            ledger: Arc::clone(ledger),
            resolve_many,
            default_space: workspace.default_space().to_string(),
        },
    ));

    let key = workspace.approval_key()?;
    let approval = create_approval_middleware(
        ApprovalMiddlewareOptions::new(key, commands.iter().map(|command| command.as_ref()))
            .with_include_token(false),
    )
    .map_err(|message| {
        HostError::new(
            codes::WORKSPACE_KEY_INVALID,
            format!(
                "{} is invalid: {message}",
                workspace.layout().approval_key().display()
            ),
            format!(
                "Delete {}; the next open creates a new key.",
                workspace.layout().approval_key().display()
            ),
        )
    })?;
    registry.add_middleware(approval);
    Ok(())
}

/// The terminal prompts and pipeline steps of the loaded plugins (phase 3 section 3.3).
fn terminal_prompts(loaded: &LoadedPlugins) -> crate::authority::Prompts {
    let mut prompts = crate::authority::Prompts::default();
    for (name, entry) in &loaded.gate {
        if let Some(prompt) = &entry.authority_prompt {
            prompts.prompts.insert(name.clone(), prompt.clone());
        }
        if entry.pipeline {
            prompts
                .steps
                .insert(name.clone(), entry.steps.iter().cloned().collect());
        }
    }
    prompts
}

/// The digest commands and their kept keys, fixed at seal (phase 3 section 7.1).
fn digest_commands(loaded: &LoadedPlugins) -> digest::DigestCommands {
    loaded
        .gate
        .iter()
        .filter_map(|(name, entry)| entry.digest.clone().map(|keep| (name.clone(), keep)))
        .collect()
}

/// The journal recorder: the outermost layer, so the stamps are in the journaled result and the
/// journal alone is enough to rebuild every stream. Its redact step reduces the entry of every
/// digest command, on every route that records: a direct call, a batch item, a pipe or pipeline
/// step, each journaled under its own name.
fn install_journal(
    registry: &CommandRegistry,
    workspace: &Workspace,
    projector: &Arc<Projector>,
    digests: digest::DigestCommands,
) {
    registry.set_journal(
        JournalRecorder::new(Arc::new(ProjectingSink::new(Arc::clone(projector))))
            .with_record_failures(workspace.config().journal.record_failures)
            .with_redact(move |record| Some(digest::redact(&digests, record)))
            .with_on_error(|message| tracing::error!("journal: {message}")),
    );
}

/// A sealed host: the registry, the workspace, and the surfaces built over them.
pub struct Host {
    workspace: Arc<Workspace>,
    registry: Arc<CommandRegistry>,
    first_class: Vec<String>,
    projector: Arc<Projector>,
    server: McpServer,
    clock: Option<Arc<dyn Clock>>,
    loaded: Arc<LoadedPlugins>,
    #[cfg(feature = "auth")]
    token_verifier: Option<Arc<dyn afd::server::auth::TokenVerifier>>,
}

impl Host {
    /// The one registry. A bare `registry.execute` carries no principal: a command that needs
    /// one answers `UNAUTHORIZED`. Use [`Host::context`] for a library call.
    pub fn registry(&self) -> Arc<CommandRegistry> {
        Arc::clone(&self.registry)
    }

    /// The workspace.
    pub fn workspace(&self) -> &Workspace {
        &self.workspace
    }

    /// Whether `command` is a plugin command with `confirm = "require-human"`: only a person at a
    /// terminal confirms it, and the CLI refuses `--yes` and `--approve` for it.
    #[cfg(feature = "cli")]
    pub(crate) fn requires_human(&self, command: &str) -> bool {
        self.loaded
            .gate
            .get(command)
            .is_some_and(|entry| entry.require_human)
    }

    /// The `confirm_preview` of `command` (manifest version 4, phase 4 section 8.1): the
    /// command of the same plugin the CLI runs, and shows, before its confirmation prompt.
    #[cfg(feature = "cli")]
    pub(crate) fn confirm_preview(&self, command: &str) -> Option<String> {
        let entry = self.loaded.gate.get(command)?;
        self.loaded
            .instance(&entry.instance)?
            .manifest
            .as_ref()?
            .commands
            .iter()
            .find(|decl| decl.name == command)?
            .confirm_preview
            .clone()
    }

    /// The `authority_prompt` the CLI asks before `command` (phase 3 section 3.3): the command's
    /// own, or a pipeline's union of its steps'.
    #[cfg(feature = "cli")]
    pub(crate) fn authority_prompt(&self, command: &str) -> Option<String> {
        self.loaded
            .gate
            .get(command)
            .and_then(|entry| entry.authority_prompt.clone())
    }

    /// What the load sequence decided for every plugin instance, for `plugin-check`'s `boot`.
    pub(crate) fn loaded(&self) -> &LoadedPlugins {
        &self.loaded
    }

    /// Catch every event stream up with the journal under the workspace lock, whether or not
    /// `projection.pending` is there, so a stream damaged by hand is repaired too. `umbel serve`
    /// calls it at start. Blocks while it waits for the lock (up to `journal.lock_timeout_ms`);
    /// an async caller should run it with `spawn_blocking`.
    ///
    /// # Errors
    /// `WORKSPACE_LOCK_TIMEOUT` when the lock is not taken in time; `WORKSPACE_UNHEALTHY` when a
    /// stream or the journal is too damaged to repair (run `umbel event rebuild`).
    pub fn repair_events(&self) -> Result<RepairReport, HostError> {
        self.projector
            .repair()
            .map_err(EventsError::into_host_error)
    }

    /// The first-class tools of the hybrid MCP surface, in list order.
    pub fn first_class_tools(&self) -> &[String] {
        &self.first_class
    }

    /// The configured MCP server (hybrid strategy, the first-class tools, confirmations signed
    /// with the workspace's shared key, the context hook of phase 5 section 4.2). It serves stdio and
    /// Streamable HTTP; the hook tells them apart by whether the request has HTTP parts. In a hosted
    /// mode it carries an authorization that admits no HTTP caller (phase 5 section 6.3): serve
    /// HTTP with [`Self::http_server`], stdio with `serve_stdio`, and mark any other transport
    /// trusted (`with_trusted_transport`) only when the process boundary vouches for its peer.
    /// Cloning is cheap, but a stdio connection needs a server of its own
    /// ([`McpServer::serve_stdio`] makes one).
    pub fn mcp_server(&self) -> McpServer {
        self.server.clone()
    }

    /// The HTTP router of mode `none` without TLS: the MCP endpoint at `http.path` and
    /// `GET /health`, every request behind the bearer layer, behind the body size limit. The
    /// token is read from `state/keys/http.token`, created race-safe with mode 0600 when missing;
    /// to rotate it, delete the file and build a new router. For an embedder serving it its own
    /// way, and for in-process drivers; `umbel serve --http` uses [`Self::http_server`].
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming `auth.mode` or `http.tls` for a hosted mode or
    /// `[http.tls]`, which only [`Self::http_server`]'s listener serves; `WORKSPACE_KEY_INVALID`
    /// for a malformed token, `WORKSPACE_STATE_UNWRITABLE` when it cannot be created.
    pub fn http_router(&self) -> Result<axum::Router, HostError> {
        surfaces::http::plain_router(&self.server, &self.workspace)
    }

    /// The HTTP surface `umbel.toml` configures, ready to serve on a listener
    /// ([`HttpServer::serve`](crate::HttpServer::serve)): TLS per `[http.tls]`, and the layers of
    /// phase 5 section 6.3 in order. Mode `none` serves phase 0's token layer. Mode `oauth` serves
    /// the body limit, the per-IP limit, `/health` and the protected-resource metadata in public,
    /// and AFD's bearer layer around the MCP service; until phase 5 step 2b it refuses to start
    /// without a token verifier. Mode `gateway` refuses to start until phase 5 step 4.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming `auth.mode` for a mode this build does not serve, or the
    /// `[http.tls]` key whose file is missing or invalid; the errors of [`Self::http_router`]
    /// in mode `none`; `WORKSPACE_STATE_UNWRITABLE` when `state/shared/limits.sqlite3` cannot be
    /// opened.
    pub fn http_server(&self) -> Result<crate::HttpServer, HostError> {
        surfaces::http::server(
            &self.server,
            &self.workspace,
            #[cfg(feature = "auth")]
            self.token_verifier.clone(),
        )
    }

    /// A context for a library call: `actor`, a new trace id, and the principal under
    /// `extra["dev.umbel/principal"]` with transport `library` and authentication `embedder`.
    pub fn context(&self, actor: Actor) -> CommandContext {
        let mut context = CommandContext::new().with_trace_id(new_trace_id());
        Principal::new(actor, Transport::Library, Authentication::Embedder).apply(&mut context);
        self.apply_clock(&mut context);
        context
    }

    fn apply_clock(&self, context: &mut CommandContext) {
        if let Some(clock) = &self.clock {
            context.clock = Some(Arc::clone(clock));
        }
    }

    /// What the CLI projection calls through: a [`DirectClient`] with the CLI interface, so the
    /// registry enforces `expose.cli`. Add the approval hook with `with_on_approval_needed`.
    pub fn cli_client(&self) -> DirectClient {
        DirectClient::new(self.registry()).with_interface(CommandInterface::Cli)
    }

    /// The context of a CLI call: a human, `principal.local_id`, transport `cli`, authentication
    /// `process`.
    #[cfg(feature = "cli")]
    pub(crate) fn cli_context(&self) -> CommandContext {
        let actor =
            Actor::new(afd::ActorKind::Human).with_id(&self.workspace.config().principal.local_id);
        let mut context = CommandContext::new().with_trace_id(new_trace_id());
        Principal::new(actor, Transport::Cli, Authentication::Process).apply(&mut context);
        self.apply_clock(&mut context);
        context
    }
}

/// A new trace id: 16 random bytes as lowercase hex, or the clock's nanoseconds when the
/// operating system's random source fails.
pub(crate) fn new_trace_id() -> String {
    random_trace_id().unwrap_or_else(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        hex(&nanos.to_be_bytes())
    })
}

/// A new trace id from the operating system's random source alone: 16 random bytes as
/// lowercase hex, `None` when the source fails. A pipeline step's trace id, which keys its
/// attestation (phase 4 section 10.1), is never drawn from the clock.
pub(crate) fn random_trace_id() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
