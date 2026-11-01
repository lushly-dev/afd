//! The host: one registry over one workspace.
//!
//! [`HostBuilder`] opens a workspace and collects commands; [`HostBuilder::seal`] registers the
//! built-in and bootstrap commands, installs the middleware, builds and validates the MCP
//! surface, and returns the [`Host`]. Commands cannot be added after `seal`, which keeps the
//! hybrid tool set fixed while serving (H2).

mod error;
mod space;

pub use error::HostError;
pub use space::SPACE_NOT_FOUND;

use crate::commands::{self, Builtin};
use crate::events::{EventsError, ProjectingSink, Projector, RepairReport};
use crate::middleware;
use crate::principal::{Authentication, Principal, Transport};
use crate::surfaces;
use crate::workspace::{Workspace, codes};
use afd::server::McpServer;
use afd::{
    Actor, ApprovalMiddlewareOptions, CommandContext, CommandDefinition, CommandInterface,
    CommandRegistry, DirectClient, JournalRecorder, create_approval_middleware,
    get_bootstrap_commands,
};
use serde_json::Value;
use std::collections::HashSet;
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
        }
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

    /// Register the built-in commands, then the added ones, then AFD's bootstrap commands
    /// (with `cli: true`); install the middleware; build the MCP server and validate its
    /// surface.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` for a key under 32 bytes; `WORKSPACE_CONFIG_INVALID` naming
    /// `mcp.first_class_tools` for an invalid first-class set, or naming the command for a
    /// reserved CLI verb or a name collision.
    pub fn seal(self) -> Result<Host, HostError> {
        let workspace = Arc::new(self.workspace);
        let registry = Arc::new(CommandRegistry::new());
        let first_class_cell = Arc::new(OnceLock::new());
        let projector = Arc::new(Projector::new(Arc::clone(&workspace)));

        let builtins: Vec<Builtin> = vec![
            commands::workspace_show(Arc::clone(&workspace), Arc::clone(&first_class_cell)),
            commands::event_list(Arc::clone(&workspace), Arc::clone(&projector)),
            commands::event_ack(Arc::clone(&workspace), Arc::clone(&projector)),
            commands::space_list(Arc::clone(&workspace), Arc::clone(&projector)),
            commands::workspace_doctor(
                Arc::clone(&workspace),
                Arc::downgrade(&registry),
                Arc::clone(&first_class_cell),
            ),
            commands::event_rebuild(Arc::clone(&workspace), Arc::clone(&projector)),
        ];
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
        for command in get_bootstrap_commands(&registry) {
            let expose = command.expose.clone().with_cli(true);
            register(&registry, Pending::Plain(command.with_expose(expose)))?;
        }

        let first_class = workspace
            .config()
            .mcp
            .first_class_tools
            .clone()
            .unwrap_or_else(|| surfaces::default_first_class_tools(&registry));
        let _ = first_class_cell.set(first_class.clone());

        install_middleware(&registry, &workspace)?;
        let server = surfaces::mcp::build_server(&registry, &workspace, &first_class)?;
        install_journal(&registry, &workspace, &projector);

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
        })
    }
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

/// Whether the command's input schema has a `space` property.
fn has_space_property(registry: &CommandRegistry, name: &str) -> bool {
    registry
        .get_tool(name)
        .and_then(|tool| {
            tool.get("inputSchema")?
                .get("properties")?
                .get("space")
                .cloned()
        })
        .is_some()
}

/// Install the middleware, outermost first: the event stamp, the space check, approvals.
fn install_middleware(
    registry: &Arc<CommandRegistry>,
    workspace: &Arc<Workspace>,
) -> Result<(), HostError> {
    let commands = registry.list();
    let with_space: Arc<HashSet<String>> = Arc::new(
        commands
            .iter()
            .filter(|command| has_space_property(registry, &command.name))
            .map(|command| command.name.clone())
            .collect(),
    );
    let mutations: HashSet<String> = commands
        .iter()
        .filter(|command| {
            command.mutation && !middleware::UNPROJECTED_MUTATIONS.contains(&command.name.as_str())
        })
        .map(|command| command.name.clone())
        .collect();

    registry.add_middleware(middleware::event_stamp(
        mutations,
        Arc::clone(&with_space),
        workspace.default_space().to_string(),
    ));
    let resolver = Arc::clone(workspace);
    registry.add_middleware(middleware::space_check(
        with_space,
        Arc::new(move |input, context| {
            resolver
                .resolve_space(input, context)
                .map(|space| space.to_string())
        }),
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

/// The journal recorder: the outermost layer, so the stamps are in the journaled result and the
/// journal alone is enough to rebuild every stream.
fn install_journal(registry: &CommandRegistry, workspace: &Workspace, projector: &Arc<Projector>) {
    registry.set_journal(
        JournalRecorder::new(Arc::new(ProjectingSink::new(Arc::clone(projector))))
            .with_record_failures(workspace.config().journal.record_failures)
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
    /// with the workspace's shared key, the context hook of version 0). It serves stdio and
    /// Streamable HTTP; the hook tells them apart by whether the request has HTTP parts.
    /// Cloning is cheap, but a stdio connection needs a server of its own
    /// ([`McpServer::serve_stdio`] makes one).
    pub fn mcp_server(&self) -> McpServer {
        self.server.clone()
    }

    /// The HTTP router: the MCP endpoint at `http.path` and `GET /health`, every request behind
    /// the bearer layer. The token is read from `state/keys/http.token`, created race-safe with
    /// mode 0600 when missing; to rotate it, delete the file and build a new router.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` for a malformed token, `WORKSPACE_STATE_UNWRITABLE` when it
    /// cannot be created.
    pub fn http_router(&self) -> Result<axum::Router, HostError> {
        surfaces::http::router(&self.server, &self.workspace)
    }

    /// A context for a library call: `actor`, a new trace id, and the principal under
    /// `extra["dev.umbel/principal"]` with transport `library` and authentication `embedder`.
    pub fn context(&self, actor: Actor) -> CommandContext {
        let mut context = CommandContext::new().with_trace_id(new_trace_id());
        Principal::new(actor, Transport::Library, Authentication::Embedder).apply(&mut context);
        context
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
        context
    }
}

/// A new trace id: 16 random bytes as lowercase hex.
pub(crate) fn new_trace_id() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        bytes = nanos.to_be_bytes();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
