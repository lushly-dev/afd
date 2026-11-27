//! Post-install lifecycle operations split out of `plugins.rs`: uninstall, retryable
//! `pendingRevocations`, safe token rotation, fixed service actions, and sanitized listing.
use crate::connection::write_owner_only;
use crate::desktop_state::{self, DesktopState, EngineState, PendingRevocation, StateLock};
use crate::keychain::{self, KeychainError};
use crate::materialize::{self, Profile};
use crate::plugin_manifest::{AuthMode, Target};
use crate::plugins::{
    InstalledPluginSummaryV1, PendingRevocationSummaryV1, PluginHost, RotateTokenResult,
    ServiceAction, ServiceActionResult, UninstallResult, installed_plugin_manifest,
    read_managed_state, read_mounts_bearer, resolve_binary_path, utc_timestamp_now,
};
use crate::plugins_engine::{
    ProbeOutcome, pair_engine, poll_engine_health_blocking, probe_error, unpair_engine,
};
use crate::plugins_error::{
    DESKTOP_MATERIALIZE_FAILED, DESKTOP_STATE_INVALID, PLUGIN_KEY_TOO_LONG,
    PLUGIN_KEYCHAIN_UNAVAILABLE, PLUGIN_NOT_FOUND, PLUGIN_PAIR_FAILED, PLUGIN_TARGET_UNSUPPORTED,
    PluginError,
};
use crate::service::{self, ServiceSpec};
use crate::site;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// Uninstalls an installed plugin, preserving its user data directory and recording a retryable
/// `pendingRevocations` entry if `unpair` fails or times out (amendment 7.4).
///
/// Ordering: commits `desktop-state.json` (with any pending revocation recorded up front) BEFORE
/// irreversible service unregistration, keychain deletion, `unpair`, or bundle directory removal,
/// so a failed commit leaves the installed plugin intact and a crash never loses a revocation.
pub fn uninstall(host: &PluginHost<'_>, plugin_id: &str) -> Result<UninstallResult, PluginError> {
    let _lock = StateLock::acquire(host.data).map_err(PluginError::from_code)?;
    let mut state = read_managed_state(host.data)?;
    let Some(pos) = state.plugins.iter().position(|p| p.id == plugin_id) else {
        return Err(PluginError::from_code(PLUGIN_NOT_FOUND));
    };
    let installed = state.plugins[pos].clone();
    let plugin_parent = host.data.join("plugins").join(plugin_id);
    let bundle_dir = plugin_parent.join(&installed.bundle_sha256);

    let manifest_opt = installed_plugin_manifest(host.data, &installed)
        .ok()
        .map(|(m, _, _)| m);
    let mount_app = manifest_opt
        .as_ref()
        .and_then(|m| m.engine.as_ref().map(|e| e.mount_app.clone()));
    let binary_opt = manifest_opt
        .as_ref()
        .and_then(|m| Target::current().and_then(|t| resolve_binary_path(&bundle_dir, m, t)));

    // Record the revocation obligation BEFORE committing so an interrupted uninstall or failed
    // `unpair` never leaves an orphaned live token without a retryable entry.
    let mut pending_rev_token: Option<(String, Option<std::path::PathBuf>, bool)> = None;
    if let Some(eng_state) = &installed.engine
        && let Some(tok_id) = &eng_state.token_id
    {
        if let Some(binary) = &binary_opt {
            state.pending_revocations.push(PendingRevocation {
                plugin_id: plugin_id.to_owned(),
                token_id: tok_id.clone(),
                binary_path: binary.clone(),
                failed_at: utc_timestamp_now(),
            });
        }
        pending_rev_token = Some((tok_id.clone(), binary_opt.clone(), eng_state.file_fallback));
    }

    state.plugins.remove(pos);
    let kc_service = host.mount_keychain_service();
    let profile = Profile {
        sandbox_origin: site::sandbox_origin(),
        mount_keychain: &kc_service,
    };
    let built = materialize::commit(host.data, &state, &profile, host.shell_build)
        .map_err(PluginError::from_code)?;

    // Durable commit point passed: now close live mounts, unregister the login service, revoke
    // the token, and delete credentials.
    if let Some(app) = &mount_app {
        host.close_live_instance(app);
    }
    if installed.engine.is_some() {
        let _ = service::unregister_service(host.data, host.custom_data_dir, plugin_id);
    }
    host.refresh_live(&built.frame_src);

    let mut token_revoked = true;
    if let Some((tok_id, binary_opt, file_fallback)) = pending_rev_token {
        if let Some(app) = &mount_app {
            if file_fallback {
                materialize::delete_mount_fallback_key(host.data, app, &tok_id);
            } else {
                let _ = (host.keychain.delete)(&kc_service, &format!("{app}.{tok_id}"));
            }
        }
        if let Some(binary) = binary_opt {
            if unpair_engine(&binary, &tok_id).is_ok() {
                state
                    .pending_revocations
                    .retain(|r| !(r.plugin_id == plugin_id && r.token_id == tok_id));
                if write_owner_only(
                    &host.data.join(desktop_state::FILE),
                    &desktop_state::bytes(&state),
                )
                .is_err()
                {
                    // Keep the binary intact if clearing the persisted revocation entry failed.
                    token_revoked = false;
                }
            } else {
                token_revoked = false;
            }
        } else {
            token_revoked = false;
        }
    }

    // Delete `<data>/plugins/<plugin-id>/` ONLY when durable state has no remaining
    // pendingRevocations referencing it.
    let canonical_parent = std::fs::canonicalize(&plugin_parent).ok();
    let still_referenced = state.pending_revocations.iter().any(|r| {
        if let Some(cp) = &canonical_parent {
            std::fs::canonicalize(&r.binary_path)
                .map(|cb| cb.starts_with(cp))
                .unwrap_or_else(|_| r.binary_path.starts_with(&plugin_parent))
        } else {
            r.binary_path.starts_with(&plugin_parent)
        }
    });
    if !still_referenced && token_revoked {
        let _ = std::fs::remove_dir_all(&plugin_parent);
    }

    Ok(UninstallResult {
        uninstalled: true,
        data_preserved: true,
        token_revoked,
        reload_required: true,
    })
}

/// Retries `unpair --token-id <tokenId>` for a `pendingRevocations` entry; once `unpair` exits 0
/// and `desktop-state.json` durably persists removal, cleans up any unreferenced version/plugin
/// directory (amendment 3.3 & 7.4).
pub fn retry_revocation(host: &PluginHost<'_>, tok_id: &str) -> Result<(), PluginError> {
    let _lock = StateLock::acquire(host.data).map_err(PluginError::from_code)?;
    let mut state = read_managed_state(host.data)?;
    let Some(pos) = state
        .pending_revocations
        .iter()
        .position(|r| r.token_id == tok_id)
    else {
        return Err(PluginError::from_code(PLUGIN_NOT_FOUND));
    };
    let entry = state.pending_revocations[pos].clone();
    let cleanup = verify_and_unpair_revocation(host.data, &mut state, pos, &entry)?;
    write_owner_only(
        &host.data.join(desktop_state::FILE),
        &desktop_state::bytes(&state),
    )
    .map_err(|_| PluginError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
    cleanup_after_revocation(&state, &entry.plugin_id, cleanup);
    Ok(())
}

/// Called during managed startup under `StateLock` to automatically retry every pending revocation.
pub(crate) fn retry_pending_revocations_under_lock(data: &Path, state: &mut DesktopState) {
    let mut cleanups = Vec::new();
    let mut idx = 0;
    while idx < state.pending_revocations.len() {
        let entry = state.pending_revocations[idx].clone();
        if let Ok(cleanup) = verify_and_unpair_revocation(data, state, idx, &entry) {
            cleanups.push((entry.plugin_id, cleanup));
        } else {
            idx += 1;
        }
    }
    if !cleanups.is_empty()
        && write_owner_only(
            &data.join(desktop_state::FILE),
            &desktop_state::bytes(state),
        )
        .is_ok()
    {
        for (plugin_id, cleanup) in cleanups {
            cleanup_after_revocation(state, &plugin_id, cleanup);
        }
    }
}

struct RevocationCleanup {
    canonical_parent: std::path::PathBuf,
    version_dir: Option<std::path::PathBuf>,
}

fn verify_and_unpair_revocation(
    data: &Path,
    state: &mut DesktopState,
    pos: usize,
    entry: &PendingRevocation,
) -> Result<RevocationCleanup, PluginError> {
    let plugins_root = data.join("plugins").join(&entry.plugin_id);
    let canonical_parent = std::fs::canonicalize(&plugins_root)
        .map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    let meta = std::fs::symlink_metadata(&entry.binary_path)
        .map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    let canonical_bin = std::fs::canonicalize(&entry.binary_path)
        .map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    if !canonical_bin.starts_with(&canonical_parent) {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }

    unpair_engine(&entry.binary_path, &entry.token_id)?;
    state.pending_revocations.remove(pos);

    let version_dir = canonical_bin
        .strip_prefix(&canonical_parent)
        .ok()
        .and_then(|rel| rel.components().next())
        .map(|comp| canonical_parent.join(comp.as_os_str()));

    Ok(RevocationCleanup {
        canonical_parent,
        version_dir,
    })
}

fn cleanup_after_revocation(state: &DesktopState, plugin_id: &str, cleanup: RevocationCleanup) {
    if let Some(vdir) = cleanup.version_dir {
        let vdir_name = vdir.file_name().and_then(|n| n.to_str());
        let used_by_installed = state
            .plugins
            .iter()
            .any(|p| p.id == plugin_id && Some(p.bundle_sha256.as_str()) == vdir_name);
        let used_by_pending = state.pending_revocations.iter().any(|r| {
            std::fs::canonicalize(&r.binary_path)
                .map(|cb| cb.starts_with(&vdir))
                .unwrap_or_else(|_| r.binary_path.starts_with(&vdir))
        });
        if !used_by_installed && !used_by_pending {
            let _ = std::fs::remove_dir_all(&vdir);
        }
    }

    let plugin_installed = state.plugins.iter().any(|p| p.id == plugin_id);
    let plugin_pending = state.pending_revocations.iter().any(|r| {
        std::fs::canonicalize(&r.binary_path)
            .map(|cb| cb.starts_with(&cleanup.canonical_parent))
            .unwrap_or_else(|_| r.binary_path.starts_with(&cleanup.canonical_parent))
    });
    if !plugin_installed && !plugin_pending {
        let _ = std::fs::remove_dir_all(&cleanup.canonical_parent);
    }
}

/// Safe token rotation (amendment 7.4): pairs a new token with a unique `--name`, verifies the
/// persistent `proofKey` and new token in memory BEFORE writing `<instance>.<newTokenId>` or
/// committing `desktop-state.json`, refreshes live `Mounts` in-place (`reloadRequired: false`),
/// deletes `<instance>.<oldTokenId>`, and revokes `oldTokenId` (or records in `pendingRevocations`).
pub fn rotate_token(
    host: &PluginHost<'_>,
    plugin_id: &str,
) -> Result<RotateTokenResult, PluginError> {
    let _lock = StateLock::acquire(host.data).map_err(PluginError::from_code)?;
    let mut state = read_managed_state(host.data)?;
    let Some(pos) = state.plugins.iter().position(|p| p.id == plugin_id) else {
        return Err(PluginError::from_code(PLUGIN_NOT_FOUND));
    };
    let installed = state.plugins[pos].clone();
    let Some(eng_state) = installed.engine.clone() else {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    };
    let (Some(old_token_id), Some(existing_proof_key)) =
        (eng_state.token_id.clone(), eng_state.proof_key.clone())
    else {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    };
    let (manifest, _, _) = installed_plugin_manifest(host.data, &installed)?;
    let Some(eng_manifest) = manifest.engine.as_ref() else {
        return Err(PluginError::from_code(DESKTOP_STATE_INVALID));
    };
    if eng_manifest.auth.mode == AuthMode::None {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    let target =
        Target::current().ok_or_else(|| PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED))?;
    let bundle_dir = host
        .data
        .join("plugins")
        .join(plugin_id)
        .join(&installed.bundle_sha256);
    let binary_path = resolve_binary_path(&bundle_dir, &manifest, target)
        .ok_or_else(|| PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED))?;

    // 1. Pair new token with unique name.
    let paired = pair_engine(&binary_path, eng_manifest.auth.mode)?;
    // Reject colliding active or pending token IDs WITHOUT calling `unpair` on them!
    if paired.token_id == old_token_id
        || state
            .pending_revocations
            .iter()
            .any(|r| r.token_id == paired.token_id)
    {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    if paired.proof_key != existing_proof_key {
        let _ = unpair_engine(&binary_path, &paired.token_id);
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    if cfg!(windows) && keychain::exceeds_windows_blob_limit(&paired.token) {
        let _ = unpair_engine(&binary_path, &paired.token_id);
        return Err(PluginError::from_code(PLUGIN_KEY_TOO_LONG));
    }

    // 2. Verify new token + persistent proofKey in memory BEFORE writing keychain or committing!
    let probe = poll_engine_health_blocking(
        eng_state.port,
        Some(&paired.proof_key),
        Some(&paired.token),
        Duration::from_secs(5),
    );
    if probe != ProbeOutcome::Ok {
        let _ = unpair_engine(&binary_path, &paired.token_id);
        return Err(probe_error(probe));
    }

    // 3. Write new token to its fresh per-token slot `<instance>.<newTokenId>` (or D166 per-token
    // fallback key file, keeping `<instance>.<oldTokenId>.key` intact for crash/rollback recovery).
    let kc_service = host.mount_keychain_service();
    let new_account = format!("{}.{}", eng_manifest.mount_app, paired.token_id);
    if eng_state.file_fallback {
        if materialize::write_mount_fallback_key(
            host.data,
            &eng_manifest.mount_app,
            &paired.token_id,
            &paired.token,
        )
        .is_err()
        {
            let _ = unpair_engine(&binary_path, &paired.token_id);
            return Err(PluginError::from_code(DESKTOP_MATERIALIZE_FAILED));
        }
    } else {
        match (host.keychain.write)(&kc_service, &new_account, &paired.token) {
            Ok(()) => {}
            Err(KeychainError::TooLong) => {
                let _ = unpair_engine(&binary_path, &paired.token_id);
                return Err(PluginError::from_code(PLUGIN_KEY_TOO_LONG));
            }
            Err(_) => {
                let _ = unpair_engine(&binary_path, &paired.token_id);
                return Err(PluginError::from_code(PLUGIN_KEYCHAIN_UNAVAILABLE));
            }
        }
    }

    // 4. Re-materialize `mounts.json` and commit `tokenId: newTokenId` in `desktop-state.json`.
    let previous_state = state.clone();
    state.plugins[pos].engine = Some(EngineState {
        port: eng_state.port,
        token_id: Some(paired.token_id.clone()),
        proof_key: Some(existing_proof_key),
        file_fallback: eng_state.file_fallback,
    });
    let profile = Profile {
        sandbox_origin: site::sandbox_origin(),
        mount_keychain: &kc_service,
    };
    let mut fallback_overrides = HashMap::new();
    if eng_state.file_fallback {
        fallback_overrides.insert(eng_manifest.mount_app.clone(), paired.token.clone());
    }
    if let Err(code) = materialize::commit_with_fallbacks(
        host.data,
        &state,
        &profile,
        host.shell_build,
        &fallback_overrides,
    ) {
        if eng_state.file_fallback {
            materialize::delete_mount_fallback_key(
                host.data,
                &eng_manifest.mount_app,
                &paired.token_id,
            );
            // Restore `mounts.json` back to the untouched `<instance>.<oldTokenId>.key` bearer.
            let _ = materialize::reconcile(host.data, &previous_state, &profile, host.shell_build);
        } else {
            let _ = (host.keychain.delete)(&kc_service, &new_account);
        }
        let _ = unpair_engine(&binary_path, &paired.token_id);
        return Err(PluginError::from_code(code));
    }

    // Refresh live `Mounts` in-place with `reloadRequired: false` (§7.4).
    if let Some(live) = &host.live {
        let deployed =
            crate::mounts::read_deployed(&host.data.join("mounts.json")).map(|d| d.mounts);
        live.mounts.update_entries(deployed);
        live.mounts
            .refresh_bearer(&eng_manifest.mount_app, Some(paired.token));
    }

    // 5. Delete old credential slot and revoke old tokenId (recording pendingRevocations on failure,
    // never deleting `binary_path` while the plugin stays installed).
    if eng_state.file_fallback {
        materialize::delete_mount_fallback_key(host.data, &eng_manifest.mount_app, &old_token_id);
    } else {
        let old_account = format!("{}.{}", eng_manifest.mount_app, old_token_id);
        let _ = (host.keychain.delete)(&kc_service, &old_account);
    }
    if unpair_engine(&binary_path, &old_token_id).is_err() {
        state.pending_revocations.push(PendingRevocation {
            plugin_id: plugin_id.to_owned(),
            token_id: old_token_id,
            binary_path,
            failed_at: utc_timestamp_now(),
        });
        let _ = write_owner_only(
            &host.data.join(desktop_state::FILE),
            &desktop_state::bytes(&state),
        );
    }

    Ok(RotateTokenResult {
        rotated: true,
        token_id: paired.token_id,
        reload_required: false,
    })
}

/// Runs a fixed service action (`start | stop | restart | status`) for an installed engine-backed
/// plugin (amendment 3.3).
pub fn service_action(
    host: &PluginHost<'_>,
    plugin_id: &str,
    action: ServiceAction,
) -> Result<ServiceActionResult, PluginError> {
    let _lock = StateLock::acquire(host.data).map_err(PluginError::from_code)?;
    let state = read_managed_state(host.data)?;
    let Some(installed) = state.plugins.iter().find(|p| p.id == plugin_id) else {
        return Err(PluginError::from_code(PLUGIN_NOT_FOUND));
    };
    let Some(eng_state) = &installed.engine else {
        return Err(PluginError::from_code(PLUGIN_NOT_FOUND));
    };
    let (manifest, _, _) = installed_plugin_manifest(host.data, installed)?;
    let target =
        Target::current().ok_or_else(|| PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED))?;
    let bundle_dir = host
        .data
        .join("plugins")
        .join(plugin_id)
        .join(&installed.bundle_sha256);
    let binary_path = resolve_binary_path(&bundle_dir, &manifest, target)
        .ok_or_else(|| PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED))?;
    let spec = ServiceSpec {
        data: host.data,
        custom_data_dir: host.custom_data_dir,
        plugin_id,
        title: &manifest.plugin.title,
        bundle_sha256: &installed.bundle_sha256,
        binary_path: &binary_path,
        port: eng_state.port,
        supervisor_exe: host.supervisor_exe,
    };

    match action {
        ServiceAction::Start => service::register_and_start(&spec)?,
        ServiceAction::Stop => {
            if let Some(eng) = &manifest.engine {
                host.close_live_instance(&eng.mount_app);
            }
            service::stop_service(host.data, host.custom_data_dir, plugin_id)?;
            return Ok(ServiceActionResult {
                state: "stopped",
                port: eng_state.port,
            });
        }
        ServiceAction::Restart => {
            if let Some(eng) = &manifest.engine {
                host.close_live_instance(&eng.mount_app);
            }
            service::stop_service(host.data, host.custom_data_dir, plugin_id)?;
            service::register_and_start(&spec)?;
        }
        ServiceAction::Status => {}
    }

    let kc_service = host.mount_keychain_service();
    let bearer = match (&eng_state.token_id, manifest.engine.as_ref()) {
        (Some(tid), Some(em)) => {
            if eng_state.file_fallback {
                read_mounts_bearer(host.data, &em.mount_app)
            } else {
                (host.keychain.read)(&kc_service, &format!("{}.{tid}", em.mount_app))
            }
        }
        _ => None,
    };
    let timeout = if action == ServiceAction::Status {
        Duration::from_secs(2)
    } else {
        host.health_timeout
    };
    let probe = poll_engine_health_blocking(
        eng_state.port,
        eng_state.proof_key.as_deref(),
        bearer.as_deref(),
        timeout,
    );
    let status = match probe {
        ProbeOutcome::Ok => "running",
        ProbeOutcome::PortConflict | ProbeOutcome::Unauthorized | ProbeOutcome::Timeout => {
            if std::net::TcpStream::connect(("127.0.0.1", eng_state.port)).is_err() {
                "stopped"
            } else {
                "unreachable"
            }
        }
    };
    Ok(ServiceActionResult {
        state: status,
        port: eng_state.port,
    })
}

/// Lists all installed plugins and pending revocations (sanitized; never returns secrets).
pub fn list_installed(
    host: &PluginHost<'_>,
) -> Result<
    (
        Vec<InstalledPluginSummaryV1>,
        Vec<PendingRevocationSummaryV1>,
    ),
    PluginError,
> {
    let state = read_managed_state(host.data)?;
    let mut plugins = Vec::with_capacity(state.plugins.len());
    for installed in &state.plugins {
        let (title, version, apps) = match installed_plugin_manifest(host.data, installed) {
            Ok((m, _, _)) => (
                m.plugin.title,
                m.plugin.version,
                m.apps.into_iter().map(|a| a.id).collect(),
            ),
            Err(_) => (installed.id.clone(), String::new(), Vec::new()),
        };
        plugins.push(InstalledPluginSummaryV1 {
            id: installed.id.clone(),
            title,
            version,
            bundle_sha256: installed.bundle_sha256.clone(),
            apps,
            engine_port: installed.engine.as_ref().map(|e| e.port),
            token_id: installed.engine.as_ref().and_then(|e| e.token_id.clone()),
            has_engine: installed.engine.is_some(),
        });
    }
    let revocations = state
        .pending_revocations
        .into_iter()
        .map(|r| PendingRevocationSummaryV1 {
            plugin_id: r.plugin_id,
            token_id: r.token_id,
            failed_at: r.failed_at,
        })
        .collect();
    Ok((plugins, revocations))
}
