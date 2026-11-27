//! `loam-desktop plugin <inspect|install|list|status|upgrade|uninstall|rotate-token|retry-revocation>`
//! CLI parity surface (phase 5 no-terminal amendment, section 10).
//!
//! Dispatched from `main.rs` before Tauri/single-instance starts (with `attach_console()` on
//! Windows), driving the exact same Rust core in [`crate::plugins`] that step 9d's `host-setup`
//! IPC commands call.
use crate::connection;
use crate::keychain;
use crate::materialize::SHELL_BUILD_ID;
use crate::plugins::{
    PendingInstallStore, PluginHost, PluginInstallProposalV1, ServiceAction, cancel, confirm,
    inspect, list_installed, retry_revocation, rotate_token, service_action, uninstall,
};
use crate::plugins_error::PluginError;
use serde_json::json;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

/// Entry point for `loam-desktop plugin ...`. Returns the process exit code.
pub fn run(args: &[String]) -> i32 {
    let Some(data) = connection::data_directory() else {
        eprintln!("loam-desktop plugin: could not resolve Loam app data directory");
        return 1;
    };
    let custom = keychain::custom_data_dir();
    let host = PluginHost::new(&data, custom.as_deref(), SHELL_BUILD_ID);
    run_with_host(&host, args)
}

/// Testable entry point executing `loam-desktop plugin <args>` against an explicit [`PluginHost`].
pub fn run_with_host(host: &PluginHost<'_>, args: &[String]) -> i32 {
    let mut json_out = false;
    let mut yes = false;
    let mut allow_file_fallback = false;
    let mut positional: Vec<&str> = Vec::new();
    for arg in args {
        match arg.as_str() {
            "--json" => json_out = true,
            "--yes" | "-y" => yes = true,
            "--allow-file-fallback" => allow_file_fallback = true,
            other if other.starts_with('-') => {
                eprintln!("loam-desktop plugin: unknown option `{other}`");
                print_usage();
                return 2;
            }
            other => positional.push(other),
        }
    }

    match positional.as_slice() {
        ["inspect", bundle] => cmd_inspect(host, Path::new(bundle), json_out),
        ["install", bundle] => cmd_install(
            host,
            Path::new(bundle),
            false,
            yes,
            allow_file_fallback,
            json_out,
        ),
        ["upgrade", bundle] => cmd_install(
            host,
            Path::new(bundle),
            true,
            yes,
            allow_file_fallback,
            json_out,
        ),
        ["list"] => cmd_list(host, json_out),
        ["status"] => cmd_list(host, json_out),
        ["status", id] => cmd_status_one(host, id, json_out),
        ["uninstall", id] => cmd_uninstall(host, id, yes, json_out),
        ["rotate-token", id] => cmd_rotate_token(host, id, json_out),
        ["retry-revocation", token_id] => cmd_retry_revocation(host, token_id, json_out),
        _ => {
            print_usage();
            2
        }
    }
}

fn print_usage() {
    eprintln!(
        "Usage: loam-desktop plugin <subcommand> [options]\n\
         Subcommands:\n\
           inspect <bundle> [--json]\n\
           install <bundle> [--yes] [--allow-file-fallback] [--json]\n\
           upgrade <bundle> [--yes] [--allow-file-fallback] [--json]\n\
           list [--json]\n\
           status [<id>] [--json]\n\
           uninstall <id> [--yes] [--json]\n\
           rotate-token <id> [--json]\n\
           retry-revocation <token-id> [--json]"
    );
}

fn emit_error(err: &PluginError, json_out: bool) -> i32 {
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({ "ok": false, "error": err }))
                .expect("error serializes")
        );
    } else {
        eprintln!("loam-desktop plugin: {err}");
    }
    1
}

fn emit_cancelled(json_out: bool, detail: &str) -> i32 {
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "ok": false,
                "error": {
                    "code": "PLUGIN_CANCELLED",
                    "suggestion": detail,
                }
            }))
            .expect("cancel error serializes")
        );
    } else {
        eprintln!("loam-desktop plugin: cancelled ({detail})");
    }
    1
}

fn emit_ok<T: serde::Serialize>(data: &T, json_out: bool, human: impl FnOnce()) -> i32 {
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({ "ok": true, "data": data }))
                .expect("result serializes")
        );
    } else {
        human();
    }
    0
}

fn print_proposal(proposal: &PluginInstallProposalV1) {
    println!(
        "Plugin: {} ({}) v{} [{}]",
        proposal.title, proposal.plugin_id, proposal.version, proposal.kind
    );
    println!("Description: {}", proposal.description);
    if let Some(license) = &proposal.license {
        println!("License: {license}");
    }
    if let Some(homepage) = &proposal.homepage {
        println!("Homepage: {homepage}");
    }
    println!("Bundle SHA-256: {}", proposal.bundle_sha256);
    if let Some(prev) = &proposal.previous {
        println!("Upgrading from: v{} ({})", prev.version, prev.bundle_sha256);
    }
    for app in &proposal.apps {
        let grants = if app.grants.is_empty() {
            "none".to_owned()
        } else {
            app.grants.join(", ")
        };
        println!(
            "  App: {} ({}) [{}] — grants: {}",
            app.title, app.id, app.kind, grants
        );
        if app.is_native {
            println!("    WARNING: Native app runs with full shell trust — not sandboxed.");
        }
    }
    if let Some(engine) = &proposal.engine {
        println!(
            "  Engine: {} ({}, target {})",
            engine.id, engine.artifact_name, engine.target
        );
        println!("  Engine SHA-256: {}", engine.engine_sha256);
        println!(
            "  Launch: {} serve --port <chosen at install> (login auto-start)",
            engine.artifact_name
        );
        println!(
            "  Policy: auth={}, labels={}, approvals={}",
            engine.auth_mode, engine.labels, engine.approvals
        );
        if !engine.exposed_commands.is_empty() {
            println!("  Exposed commands: {}", engine.exposed_commands.join(", "));
        }
        for p in &engine.previews {
            println!(
                "    Approval preview: {} -> {} ({})",
                p.command,
                p.preview_command,
                p.input.join(", ")
            );
        }
    }
}

fn prompt_yes(question: &str) -> bool {
    if !std::io::stdin().is_terminal() {
        return false;
    }
    eprint!("{question} [y/N]: ");
    let _ = std::io::stderr().flush();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return false;
    }
    matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes")
}

fn resolve_bundle_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

fn cmd_inspect(host: &PluginHost<'_>, bundle: &Path, json_out: bool) -> i32 {
    let store = PendingInstallStore::new();
    let resolved = resolve_bundle_path(bundle);
    match inspect(host, &resolved, &store) {
        Ok(proposal) => {
            // Inspect-only command: clean up staging immediately before exiting.
            let _ = cancel(&proposal.proposal_id, &store);
            emit_ok(&proposal, json_out, || print_proposal(&proposal))
        }
        Err(err) => emit_error(&err, json_out),
    }
}

fn cmd_install(
    host: &PluginHost<'_>,
    bundle: &Path,
    require_upgrade: bool,
    yes: bool,
    allow_file_fallback: bool,
    json_out: bool,
) -> i32 {
    let store = PendingInstallStore::new();
    let resolved = resolve_bundle_path(bundle);
    let proposal = match inspect(host, &resolved, &store) {
        Ok(p) => p,
        Err(err) => return emit_error(&err, json_out),
    };
    if require_upgrade && proposal.kind != "upgrade" {
        let _ = cancel(&proposal.proposal_id, &store);
        return emit_error(
            &PluginError::from_code(crate::plugins_error::PLUGIN_NOT_FOUND),
            json_out,
        );
    }
    if !yes {
        if json_out {
            let _ = cancel(&proposal.proposal_id, &store);
            return emit_cancelled(true, "pass --yes with --json for non-interactive consent");
        }
        print_proposal(&proposal);
        if !prompt_yes(&format!(
            "Proceed to {} `{}`?",
            proposal.kind, proposal.plugin_id
        )) {
            let _ = cancel(&proposal.proposal_id, &store);
            return emit_cancelled(false, "pass --yes for non-interactive consent");
        }
    }
    match confirm(
        host,
        &proposal.proposal_id,
        &proposal.bundle_sha256,
        allow_file_fallback,
        &store,
    ) {
        Ok(installed) => emit_ok(&installed, json_out, || {
            println!(
                "Installed {} v{} ({})",
                installed.id, installed.version, installed.bundle_sha256
            );
        }),
        Err(err) => emit_error(&err, json_out),
    }
}

fn cmd_list(host: &PluginHost<'_>, json_out: bool) -> i32 {
    match list_installed(host) {
        Ok((plugins, pending_revocations)) => emit_ok(
            &json!({ "plugins": plugins, "pendingRevocations": pending_revocations }),
            json_out,
            || {
                if plugins.is_empty() {
                    println!("No plugins installed.");
                } else {
                    for p in &plugins {
                        match p.engine_port {
                            Some(port) => println!(
                                "{} v{} (port {}, bundle {})",
                                p.id, p.version, port, p.bundle_sha256
                            ),
                            None => {
                                println!(
                                    "{} v{} (pure-app, bundle {})",
                                    p.id, p.version, p.bundle_sha256
                                )
                            }
                        }
                    }
                }
                if !pending_revocations.is_empty() {
                    println!("Pending token revocations:");
                    for r in &pending_revocations {
                        println!(
                            "  {} token={} failed_at={}",
                            r.plugin_id, r.token_id, r.failed_at
                        );
                    }
                }
            },
        ),
        Err(err) => emit_error(&err, json_out),
    }
}

fn cmd_status_one(host: &PluginHost<'_>, id: &str, json_out: bool) -> i32 {
    match service_action(host, id, ServiceAction::Status) {
        Ok(status) => emit_ok(&status, json_out, || {
            println!("{id}: {} (port {})", status.state, status.port);
        }),
        Err(err) => emit_error(&err, json_out),
    }
}

fn cmd_uninstall(host: &PluginHost<'_>, id: &str, yes: bool, json_out: bool) -> i32 {
    if !yes {
        if json_out {
            return emit_cancelled(true, "pass --yes with --json for non-interactive uninstall");
        }
        if !prompt_yes(&format!(
            "Uninstall plugin `{id}`? (Your plugin data directory will be preserved)"
        )) {
            return emit_cancelled(false, "pass --yes for non-interactive uninstall");
        }
    }
    match uninstall(host, id) {
        Ok(res) => emit_ok(&res, json_out, || {
            println!(
                "Uninstalled `{id}` (data preserved: {}, token revoked: {}).",
                res.data_preserved, res.token_revoked
            );
        }),
        Err(err) => emit_error(&err, json_out),
    }
}

fn cmd_rotate_token(host: &PluginHost<'_>, id: &str, json_out: bool) -> i32 {
    match rotate_token(host, id) {
        Ok(res) => emit_ok(&res, json_out, || {
            println!("Rotated token for `{id}` -> new tokenId {}", res.token_id);
        }),
        Err(err) => emit_error(&err, json_out),
    }
}

fn cmd_retry_revocation(host: &PluginHost<'_>, token_id: &str, json_out: bool) -> i32 {
    match retry_revocation(host, token_id) {
        Ok(()) => emit_ok(
            &json!({ "revoked": true, "tokenId": token_id }),
            json_out,
            || {
                println!("Revoked pending token `{token_id}`.");
            },
        ),
        Err(err) => emit_error(&err, json_out),
    }
}
