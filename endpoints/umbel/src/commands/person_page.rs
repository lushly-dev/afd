//! `person-page-serve`: serve the local person page until interrupted (the Ideas host-review
//! specification, section 6.2; D180).
//!
//! **What it serves.** The person page of a workspace in mode `none` with `[person.local]`
//! enabled, on `person.local.bind`, a loopback address, over plain HTTP, with section 6.3's rules
//! (`crate::person::page`): the list of the local person's pending decisions at `/d/`, each
//! decision's pages at `/d/<id>`, and their form. It prints the list's address on standard error
//! and, with `--open`, opens it in the browser; with `person.local.public_origin` set, that
//! address is at the public origin a proxy on this machine serves the page at (A48). Decisions
//! live in `state/shared/person.sqlite3`, which every process of the workspace shares, so the
//! stdio server that began a decision and this process need not be one.
//!
//! **Who runs it.** The operator, at the command line: it is registered for the CLI alone, it is
//! an `inspect` command, and any caller that is not the CLI's is refused. It needs a build with
//! the `auth` feature, as the person store does.
//!
//! **What it proves, and what it does not** (6.5). Anything on this machine that reaches the port
//! can fetch the page and post its form, an agent with a shell included: an agent can start this
//! command itself. A decision made here is recorded as `local`, never `verified`, and a request
//! for verified content leaves it out unless the space lists `local` in `verified_levels`.

use super::{Builtin, returns_object};
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

/// `person-page-serve` cannot bind its address (section 7): retryable.
#[cfg_attr(not(feature = "auth"), allow(dead_code))]
pub(crate) const PERSON_PAGE_BIND_FAILED: &str = "PERSON_PAGE_BIND_FAILED";

struct Handler {
    workspace: Arc<Workspace>,
    #[cfg(feature = "auth")]
    service: Arc<std::sync::OnceLock<Arc<crate::person::service::PersonService>>>,
}

/// `COMMAND_NOT_EXPOSED` for any caller but the operator at the command line.
fn operator_only() -> CommandError {
    CommandError::new(
        afd::error_codes::COMMAND_NOT_EXPOSED,
        "person-page-serve is the operator's, at the command line",
    )
    .with_suggestion("Run umbel person page-serve at this machine's terminal.")
    .with_retryable(false)
}

/// `WORKSPACE_CONFIG_INVALID` naming `person.local.enabled`.
fn not_enabled(problem: &str) -> CommandError {
    let mut details = std::collections::HashMap::new();
    details.insert("key".to_owned(), json!("person.local.enabled"));
    CommandError::new(
        crate::workspace::codes::WORKSPACE_CONFIG_INVALID,
        format!("person.local.enabled: {problem}"),
    )
    .with_suggestion(
        "Set [person.local] enabled = true in umbel.toml (configuration version 7, auth.mode = \"none\"), in a build with the auth feature such as umbel-first-party.",
    )
    .with_retryable(false)
    .with_details(details)
}

#[cfg(feature = "auth")]
fn bind_failed(bind: std::net::SocketAddr, error: &std::io::Error) -> CommandError {
    CommandError::new(
        PERSON_PAGE_BIND_FAILED,
        format!("The local person page cannot bind {bind}: {error}"),
    )
    .with_suggestion(format!(
        "Another person-page-serve may be running: open its list at http://{bind}/d/, or stop it."
    ))
    .with_retryable(true)
}

/// Open `url` in the person's browser, best effort.
#[cfg(feature = "auth")]
fn open_browser(url: &str) {
    let opener: &[&str] = if cfg!(target_os = "macos") {
        &["open"]
    } else if cfg!(windows) {
        &["cmd", "/C", "start", ""]
    } else {
        &["xdg-open"]
    };
    let mut command = std::process::Command::new(opener[0]);
    command
        .args(&opener[1..])
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Err(error) = command.spawn() {
        eprintln!("Could not open a browser ({error}); open {url} yourself.");
    }
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if !crate::access::is_operator(&context) {
            return afd::failure(operator_only());
        }
        let config = self.workspace.config();
        if !config.person.local.enabled {
            return afd::failure(not_enabled(
                "the local person page is not enabled in this workspace",
            ));
        }
        #[cfg(not(feature = "auth"))]
        {
            let _ = input;
            afd::failure(not_enabled(
                "the local person page needs a build with the auth feature, such as umbel-first-party",
            ))
        }
        #[cfg(feature = "auth")]
        {
            let Some(service) = self.service.get() else {
                return afd::failure(not_enabled(
                    "the local person page is served only in auth.mode = \"none\"",
                ));
            };
            let server = match crate::surfaces::http::local_person_server(&self.workspace, service)
            {
                Ok(server) => server,
                Err(error) => return afd::failure(error.to_command_error()),
            };
            let bind = config.person.local.bind;
            let listener = match tokio::net::TcpListener::bind(bind).await {
                Ok(listener) => listener,
                Err(error) => return afd::failure(bind_failed(bind, &error)),
            };
            // Behind a proxy on this machine, the list at its public origin (A48).
            let list = format!("{}/d/", service.links());
            if service.public_origin().is_some() {
                eprintln!(
                    "The local person page lists the requests waiting for you at {list}, served by a proxy on this machine from http://{bind}\nAnything on this machine, and anything that reaches that address, can open it. Stop it with Ctrl-C."
                );
            } else {
                eprintln!(
                    "The local person page lists the requests waiting for you at {list}\nAnything on this machine can open it. Stop it with Ctrl-C."
                );
            }
            if input.get("open").and_then(Value::as_bool) == Some(true) {
                open_browser(&list);
            }
            let shutdown = async {
                let _ = tokio::signal::ctrl_c().await;
            };
            if let Err(error) = server.serve(listener, shutdown).await {
                return afd::failure(bind_failed(bind, &error));
            }
            afd::success(json!({ "list": list, "bind": bind.to_string() }))
        }
    }
}

/// `person-page-serve`.
pub(crate) fn person_page_serve(
    workspace: Arc<Workspace>,
    #[cfg(feature = "auth")] service: Arc<
        std::sync::OnceLock<Arc<crate::person::service::PersonService>>,
    >,
) -> Builtin {
    let definition = CommandDefinition::new(
        "person-page-serve",
        "Serve the local person page on person.local.bind until interrupted, so a person confirms in a browser what an agent asks over stdio",
        vec![],
        Handler {
            workspace,
            #[cfg(feature = "auth")]
            service,
        },
    )
    .with_category("person")
    .with_returns(returns_object(
        "list (the address of the pending requests) and bind, once the page stops",
    ))
    .with_expose(
        afd::ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "open": {
                    "type": "boolean",
                    "description": "Open the list of pending requests in the browser"
                }
            },
            "additionalProperties": false
        }),
    }
}
