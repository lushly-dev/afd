//! `plugin-new`: write a plugin skeleton from the templates embedded in the binary
//! (specification section 10.2).
//!
//! It refuses a directory that is not empty and writes nothing outside the directory it was
//! given. The files are the templates', never the workspace's.

use super::{Builtin, blocking, returns_object, validation_error};
use crate::plugins::{PluginKind, domain_problem};
use crate::templates::{self, Variables};
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const KINDS: &[&str] = &["compiled", "component", "mounted", "pack"];

struct Handler;

fn io_error(path: &Path, error: &std::io::Error) -> CommandError {
    CommandError::new(
        afd::error_codes::INTERNAL_ERROR,
        format!("cannot write {}: {error}", path.display()),
    )
    .with_suggestion("Check that the directory is writable and has room.")
    .with_retryable(false)
}

/// How a scaffolded crate depends on `umbel-sdk` and `umbel`: a path into a checkout when
/// `umbel_path` is given, else the repository.
fn dependencies(umbel_path: Option<&str>) -> (String, String) {
    let quoted = |text: String| toml::Value::String(text).to_string();
    match umbel_path {
        Some(path) => {
            let root = Path::new(path);
            (
                format!("{{ path = {} }}", quoted(root.join("sdk").display().to_string())),
                format!(
                    "{{ path = {}, default-features = false, features = [\"testkit\"] }}",
                    quoted(root.display().to_string())
                ),
            )
        }
        None => (
            "{ git = \"https://github.com/lushly-dev/afd\" }".to_owned(),
            "{ git = \"https://github.com/lushly-dev/afd\", default-features = false, features = [\"testkit\"] }"
                .to_owned(),
        ),
    }
}

/// Refuse a directory that exists and holds anything.
fn check_target(dir: &Path) -> Result<(), CommandError> {
    match fs::symlink_metadata(dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(dir, &error)),
        Ok(meta) if meta.is_dir() => {
            let mut entries = fs::read_dir(dir).map_err(|error| io_error(dir, &error))?;
            if entries.next().is_some() {
                return Err(CommandError::new(
                    afd::error_codes::ALREADY_EXISTS,
                    format!(
                        "{} is not empty; plugin-new writes only into a new or empty directory",
                        dir.display()
                    ),
                )
                .with_suggestion("Choose another dir, or empty this one first.")
                .with_retryable(false));
            }
            Ok(())
        }
        Ok(_) => Err(CommandError::new(
            afd::error_codes::ALREADY_EXISTS,
            format!("{} exists and is not a directory", dir.display()),
        )
        .with_suggestion("Choose another dir.")
        .with_retryable(false)),
    }
}

fn scaffold(
    kind: PluginKind,
    id: &str,
    dir: &Path,
    umbel_path: Option<&str>,
) -> Result<Vec<String>, CommandError> {
    check_target(dir)?;
    let (umbel_sdk, umbel) = dependencies(umbel_path);
    let files = templates::render(
        kind,
        &Variables {
            id: id.to_owned(),
            umbel_sdk,
            umbel,
        },
    );
    fs::create_dir_all(dir).map_err(|error| io_error(dir, &error))?;
    let mut written = Vec::new();
    for file in files {
        let path = dir.join(&file.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| io_error(parent, &error))?;
        }
        // `create_new` never writes through a file or a link that appeared meanwhile.
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| io_error(&path, &error))?;
        out.write_all(file.content.as_bytes())
            .map_err(|error| io_error(&path, &error))?;
        written.push(file.path);
    }
    Ok(written)
}

fn next_steps(kind: PluginKind, dir: &Path) -> Vec<String> {
    let at = dir.display();
    match kind {
        PluginKind::Compiled => vec![
            format!("cd {at} && cargo test"),
            format!("umbel plugin check path={at}"),
        ],
        PluginKind::Component => vec![
            format!("cd {at} && cargo test"),
            format!("cd {at} && cargo build --release --target wasm32-wasip2 --features component"),
            format!(
                "Copy target/wasm32-wasip2/release/<crate>.wasm to the file `component.path` names, then umbel plugin check path={at}"
            ),
        ],
        PluginKind::Mounted => vec![
            format!("Put your server's program where mount.command in {at}/umbel-plugin.toml says"),
            format!("umbel plugin check path={at} spawn=true"),
        ],
        PluginKind::Pack => vec![format!("umbel plugin check path={at}")],
    }
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let kind = input
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(kind) = PluginKind::parse(kind) else {
            return failure(validation_error(
                format!("kind must be one of {}", KINDS.join(", ")),
                "Pass kind=compiled, component, mounted or pack.",
            ));
        };
        let id = input.get("id").and_then(Value::as_str).unwrap_or_default();
        if let Some(problem) = domain_problem(id) {
            return failure(validation_error(
                format!("id `{id}` {problem}"),
                "Pass id=<name>: lowercase letters and digits, starting with a letter, 32 at most, and not a host domain or a CLI verb.",
            ));
        }
        if let Err(problem) = afd::validate_command_name(&format!("{id}-hello")) {
            return failure(validation_error(
                format!("id `{id}` does not make a command name: {problem}"),
                "Pass an id whose `<id>-hello` is a valid command name.",
            ));
        }
        let dir = input
            .get("dir")
            .and_then(Value::as_str)
            .filter(|dir| !dir.is_empty())
            .map_or_else(|| PathBuf::from(id), PathBuf::from);
        let umbel_path = input
            .get("umbel_path")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let id = id.to_owned();
        let target = dir.clone();
        match blocking(move || scaffold(kind, &id, &target, umbel_path.as_deref())).await {
            Ok(written) => success(json!({
                "kind": kind.as_str(),
                "id": input.get("id"),
                "dir": dir.display().to_string(),
                "files": written,
                "next": next_steps(kind, &dir),
            })),
            Err(error) => failure(error),
        }
    }
}

/// `plugin-new`: writes files, so only the CLI and trusted host code reach it.
pub(crate) fn plugin_new() -> Builtin {
    let mut definition = CommandDefinition::new(
        "plugin-new",
        "Write a plugin skeleton for a kind (compiled, component, mounted or pack) from the templates in this binary; refuses a directory that is not empty",
        vec![],
        Handler,
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "kind, id, dir, the files written (relative to dir) and the next steps",
    ))
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    definition.mutation = true;
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": KINDS,
                    "description": "How the plugin's code runs: compiled (a Rust crate linked into the host), component (a WebAssembly component), mounted (an external MCP server) or pack (content only)"
                },
                "id": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "The plugin id and its first command segment: lowercase letters and digits, starting with a letter (the handler enforces the pattern)"
                },
                "dir": {
                    "type": "string",
                    "description": "The directory to write; relative to the working directory; default: ./<id>"
                },
                "umbel_path": {
                    "type": "string",
                    "description": "A checkout of endpoints/umbel that a compiled or component crate depends on by path; default: the repository, by git"
                },
            },
            "required": ["kind", "id"],
            "additionalProperties": false,
        }),
    }
}
