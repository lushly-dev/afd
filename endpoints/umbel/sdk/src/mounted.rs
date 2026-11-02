//! `serve_mounted` (feature `mounted`): the plugin as a stdio MCP server.
//!
//! There is no host. The plugin's own manifest (`Plugin::manifest`, the compiled build's) names
//! the commands, their schemas and the default packs; each becomes one tool of an
//! `afd::server::McpServer` with the individual tool strategy, so the host's mounted loader sees
//! the manifest's command names. `Cx` answers from built-in defaults: `config` is the
//! configuration schema's defaults; `pack_read` and `pack_list` read the default packs in
//! `assets()`; `clock` and `random` come from the AFD command context; `log` writes to stderr;
//! `events` alone answers `NotGranted`. `call().space` is the input's `space` argument as given,
//! with no resolution.

use std::io;
use std::sync::Arc;

use afd::server::{McpServer, ToolStrategy};
use afd::{
    CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
    ExposeOptions,
};
use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::{Asset, CallContext, Cx, HostError, HostServices, Level, Plugin};

/// One manifest command, as the server needs it.
struct Spec {
    name: String,
    description: String,
    schema: Value,
    mutation: bool,
}

/// What the services of every call share.
struct Shared {
    config: Value,
    /// `(pack id, directory)`.
    packs: Vec<(String, String)>,
    assets: &'static [Asset],
}

/// Serve `plugin` as an MCP server on stdio until the client disconnects.
///
/// # Errors
/// An unreadable manifest, or the server failing to start or to serve.
pub async fn serve_mounted(plugin: impl Plugin) -> io::Result<()> {
    let server = mounted_server(plugin).map_err(io::Error::other)?;
    server.serve_stdio().await.map_err(io::Error::other)
}

/// The MCP server [`serve_mounted`] serves, for a host that wants another transport (the tests
/// serve it over Streamable HTTP).
///
/// # Errors
/// A manifest that cannot be read, a schema file it names that is not in `assets()`, or a
/// command the registry refuses.
pub fn mounted_server(plugin: impl Plugin) -> Result<McpServer, String> {
    let manifest: toml::Table = plugin
        .manifest()
        .parse()
        .map_err(|error: toml::de::Error| format!("the manifest is not valid TOML: {error}"))?;
    let assets = plugin.assets();
    let (title, version) = identity(&manifest);
    let shared = Arc::new(Shared {
        config: config_defaults(&manifest, assets)?,
        packs: packs(&manifest),
        assets,
    });
    let plugin = Arc::new(plugin);
    let registry = Arc::new(CommandRegistry::new());
    for spec in commands(&manifest, assets)? {
        let mut definition = CommandDefinition::new(
            &spec.name,
            &spec.description,
            vec![],
            Handler {
                plugin: Arc::clone(&plugin),
                name: spec.name.clone(),
                shared: Arc::clone(&shared),
            },
        )
        .with_expose(
            ExposeOptions::new()
                .with_palette(false)
                .with_mcp(true)
                .with_agent(true)
                .with_cli(true),
        );
        if spec.mutation {
            definition = definition.as_mutation();
        }
        registry.register_with_schema(definition, spec.schema)?;
    }
    Ok(McpServer::new(registry, title, version).with_tool_strategy(ToolStrategy::Individual))
}

fn identity(manifest: &toml::Table) -> (String, String) {
    let plugin = manifest.get("plugin").and_then(toml::Value::as_table);
    let text = |key: &str, default: &str| {
        plugin
            .and_then(|table| table.get(key))
            .and_then(toml::Value::as_str)
            .unwrap_or(default)
            .to_owned()
    };
    (text("id", "umbel-plugin"), text("version", "0.0.0"))
}

fn asset<'a>(assets: &'a [Asset], path: &str) -> Result<&'a [u8], String> {
    assets
        .iter()
        .find(|asset| asset.path == path)
        .map(|asset| asset.bytes)
        .ok_or_else(|| format!("the manifest names `{path}`, which the plugin does not embed"))
}

/// A schema given as a path into `assets()` or as an inline table.
fn schema(value: &toml::Value, assets: &[Asset]) -> Result<Value, String> {
    match value {
        toml::Value::String(path) => serde_json::from_slice(asset(assets, path)?)
            .map_err(|error| format!("`{path}` is not JSON: {error}")),
        table @ toml::Value::Table(_) => {
            serde_json::to_value(table).map_err(|error| format!("an inline schema: {error}"))
        }
        _ => Err("a schema must be a path or an inline table".to_owned()),
    }
}

fn commands(manifest: &toml::Table, assets: &[Asset]) -> Result<Vec<Spec>, String> {
    let Some(entries) = manifest.get("commands").and_then(toml::Value::as_array) else {
        return Ok(Vec::new());
    };
    entries
        .iter()
        .map(|entry| {
            let table = entry
                .as_table()
                .ok_or_else(|| "a [[commands]] entry is not a table".to_owned())?;
            let text = |key: &str| {
                table
                    .get(key)
                    .and_then(toml::Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| format!("a [[commands]] entry has no `{key}`"))
            };
            let mutation = table
                .get("effects")
                .and_then(toml::Value::as_array)
                .is_some_and(|effects| effects.iter().any(|e| e.as_str() != Some("inspect")));
            Ok(Spec {
                name: text("name")?,
                description: text("description")?,
                schema: schema(
                    table
                        .get("input_schema")
                        .ok_or_else(|| "a [[commands]] entry has no `input_schema`".to_owned())?,
                    assets,
                )?,
                mutation,
            })
        })
        .collect()
}

/// The configuration schema's defaults: each top-level property's `default`.
fn config_defaults(manifest: &toml::Table, assets: &[Asset]) -> Result<Value, String> {
    let Some(path) = manifest
        .get("config")
        .and_then(toml::Value::as_table)
        .and_then(|table| table.get("schema"))
    else {
        return Ok(Value::Object(Map::new()));
    };
    let schema = schema(path, assets)?;
    let defaults: Map<String, Value> = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            properties
                .iter()
                .filter_map(|(name, property)| {
                    property
                        .get("default")
                        .map(|default| (name.clone(), default.clone()))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Value::Object(defaults))
}

fn packs(manifest: &toml::Table) -> Vec<(String, String)> {
    manifest
        .get("packs")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let table = entry.as_table()?;
            Some((
                table.get("id")?.as_str()?.to_owned(),
                table
                    .get("path")?
                    .as_str()?
                    .trim_end_matches('/')
                    .to_owned(),
            ))
        })
        .collect()
}

struct Services {
    shared: Arc<Shared>,
    context: CommandContext,
}

fn not_granted<T>(grant: &str) -> Result<T, HostError> {
    Err(HostError::NotGranted(format!(
        "the grant `{grant}` is not available to a plugin built as a mounted server"
    )))
}

impl Services {
    fn pack_directory(&self, pack: &str) -> Result<&str, HostError> {
        self.shared
            .packs
            .iter()
            .find(|(id, _)| id == pack)
            .map(|(_, directory)| directory.as_str())
            .ok_or_else(|| HostError::NotFound(format!("no pack `{pack}`")))
    }
}

impl HostServices for Services {
    fn config(&self) -> Result<Value, HostError> {
        Ok(self.shared.config.clone())
    }

    fn log(&self, level: Level, message: &str) {
        eprintln!("[{level:?}] {message}");
    }

    fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError> {
        let directory = format!("{}/", self.pack_directory(pack)?);
        Ok(self
            .shared
            .assets
            .iter()
            .filter_map(|asset| asset.path.strip_prefix(&directory).map(str::to_owned))
            .collect())
    }

    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        if path.is_empty() || path.starts_with('/') || path.split('/').any(|part| part == "..") {
            return Err(HostError::Invalid(format!(
                "`{path}` is not a path inside the pack"
            )));
        }
        let full = format!("{}/{path}", self.pack_directory(pack)?);
        asset(self.shared.assets, &full)
            .map(<[u8]>::to_vec)
            .map_err(|_| HostError::NotFound(format!("the pack `{pack}` has no file `{path}`")))
    }

    fn events(
        &self,
        _space: Option<&str>,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Value, HostError> {
        not_granted("events")
    }

    fn now_ms(&self) -> Result<i64, HostError> {
        Ok(self.context.clock().now())
    }

    fn random(&self) -> Result<f64, HostError> {
        Ok(self.context.random().next())
    }
}

struct Handler<P: Plugin> {
    plugin: Arc<P>,
    name: String,
    shared: Arc<Shared>,
}

#[async_trait]
impl<P: Plugin> CommandHandler for Handler<P> {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let call = CallContext {
            command: self.name.clone(),
            trace_id: context.trace_id.clone().unwrap_or_default(),
            // The argument as given: a mounted server has no host to resolve it.
            space: input
                .get("space")
                .and_then(Value::as_str)
                .map(str::to_owned),
            spaces: Vec::new(),
            output_budget: None,
            actor_kind: String::new(),
            actor_id: None,
            on_behalf_of: None,
            interface: "mcp".to_owned(),
        };
        let services = Services {
            shared: Arc::clone(&self.shared),
            context,
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
                            "PLUGIN_RESULT_INVALID",
                            format!(
                                "the plugin returned something that is not a CommandResult: {error}"
                            ),
                        )
                        .with_suggestion("The plugin failed; report it to its author.")
                        .with_retryable(false),
                    )
                }),
            Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
            Err(error) => afd::failure(
                afd::CommandError::new(
                    afd::error_codes::INTERNAL_ERROR,
                    format!("the plugin command `{}` was cancelled: {error}", self.name),
                )
                .with_suggestion("Retry the command.")
                .with_retryable(true),
            ),
        }
    }
}
