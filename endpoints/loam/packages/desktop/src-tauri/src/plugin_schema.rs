//! Schema validation for `plugin-manifest.json` (`loam-plugin.v1.json`), split out of
//! `plugin_validate.rs` to keep both modules concise.
use crate::desktop_state::hex64;
use crate::js_json::Json;
use crate::plugin_manifest::{
    Effect, Target, app_id, command_name, effects_valid, input_name, plugin_id,
};
use crate::plugin_validate::ValidationRefusal;
use crate::plugins_error::PLUGIN_MANIFEST_INVALID;
use std::collections::HashSet;

/// Semver matching `spec/plugin-manifest.core.v1.json#/$defs/semver`:
/// `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`
pub(crate) fn valid_semver(value: &str) -> bool {
    let (without_build, build) = match value.split_once('+') {
        Some((head, b)) => (head, Some(b)),
        None => (value, None),
    };
    if let Some(b) = build
        && (b.is_empty()
            || !b
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-'))
    {
        return false;
    }
    let (core, pre) = match without_build.split_once('-') {
        Some((head, p)) => (head, Some(p)),
        None => (without_build, None),
    };
    if let Some(p) = pre
        && (p.is_empty()
            || !p
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-'))
    {
        return false;
    }
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.into_iter().all(|part| {
        if part == "0" {
            true
        } else {
            let mut bytes = part.bytes();
            matches!(bytes.next(), Some(b'1'..=b'9')) && bytes.all(|b| b.is_ascii_digit())
        }
    })
}

/// SPDX license expression matching `loam-plugin.v1.json`:
/// `^[A-Za-z0-9.+()-]+( (AND|OR|WITH) [A-Za-z0-9.+()-]+)*$`, `maxLength: 128`.
pub(crate) fn valid_license(value: &str) -> bool {
    if value.is_empty() || value.chars().count() > 128 {
        return false;
    }
    let is_token = |tok: &str| {
        !tok.is_empty()
            && tok
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".+()-".contains(&b))
    };
    let parts: Vec<&str> = value.split(' ').collect();
    if parts.len().is_multiple_of(2) {
        return false;
    }
    for (idx, part) in parts.iter().enumerate() {
        if idx.is_multiple_of(2) {
            if !is_token(part) {
                return false;
            }
        } else if !matches!(*part, "AND" | "OR" | "WITH") {
            return false;
        }
    }
    true
}

/// Display-only `https:` URL with a host and no credentials (`read-plugin.ts` `isDisplayUrl`).
pub(crate) fn valid_homepage(value: &str) -> bool {
    if value.chars().count() > 512
        || !value.starts_with("https://")
        || value.chars().any(char::is_whitespace)
    {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn valid_artifact_basename(name: &str, is_windows: bool) -> bool {
    if is_windows {
        let Some(stem) = name.strip_suffix(".exe") else {
            return false;
        };
        valid_artifact_stem(stem)
    } else {
        let lower = name.to_ascii_lowercase();
        let script = [".bat", ".cmd", ".com", ".ps1", ".vbs", ".sh"]
            .iter()
            .any(|ext| lower.ends_with(ext));
        !script && valid_artifact_stem(name)
    }
}

fn valid_artifact_stem(stem: &str) -> bool {
    let mut bytes = stem.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && stem.len() <= 64
        && bytes.all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-'))
}

pub(crate) fn format_key(base: &str, seg: &str) -> String {
    let simple = {
        let mut chars = seg.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    if simple {
        if base.is_empty() {
            seg.to_owned()
        } else {
            format!("{base}.{seg}")
        }
    } else {
        let escaped = serde_json::to_string(seg).expect("string escapes");
        format!("{base}[{escaped}]")
    }
}

fn check_allowed_keys(
    entries: &[(String, Json)],
    base: &str,
    allowed: &[&str],
    out: &mut Vec<ValidationRefusal>,
) {
    for (k, _) in entries {
        if !allowed.contains(&k.as_str()) {
            out.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format_key(base, k),
                "bundle",
                format!("unknown or forbidden key `{k}`"),
            ));
        }
    }
}

fn require_obj<'a>(
    entries: &'a [(String, Json)],
    key: &str,
    base: &str,
    out: &mut Vec<ValidationRefusal>,
) -> Option<&'a [(String, Json)]> {
    match entries.iter().find(|(k, _)| k == key).map(|(_, v)| v) {
        Some(Json::Obj(inner)) => Some(inner),
        Some(_) => {
            out.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format_key(base, key),
                "bundle",
                "expected object",
            ));
            None
        }
        None => {
            out.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format_key(base, key),
                "bundle",
                "required field missing",
            ));
            None
        }
    }
}

fn require_str<'a>(
    entries: &'a [(String, Json)],
    key: &str,
    base: &str,
    out: &mut Vec<ValidationRefusal>,
) -> Option<&'a str> {
    match entries.iter().find(|(k, _)| k == key).map(|(_, v)| v) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => {
            out.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format_key(base, key),
                "bundle",
                "expected string",
            ));
            None
        }
    }
}

fn optional_str<'a>(
    entries: &'a [(String, Json)],
    key: &str,
    base: &str,
    out: &mut Vec<ValidationRefusal>,
) -> Option<&'a str> {
    match entries.iter().find(|(k, _)| k == key).map(|(_, v)| v) {
        None => None,
        Some(Json::Str(s)) => Some(s.as_str()),
        Some(_) => {
            out.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format_key(base, key),
                "bundle",
                "expected string",
            ));
            None
        }
    }
}

fn optional_bool(
    entries: &[(String, Json)],
    key: &str,
    base: &str,
    out: &mut Vec<ValidationRefusal>,
) {
    if let Some((_, v)) = entries.iter().find(|(k, _)| k == key)
        && !matches!(v, Json::Bool(_))
    {
        out.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            format_key(base, key),
            "bundle",
            "expected boolean",
        ));
    }
}

/// Validates schema constraints of `loam-plugin.v1.json` directly on parsed [`Json`], collecting
/// exact `(code, key)` refusals matching `read-plugin.ts`'s AJV pass.
pub(crate) fn validate_schema_json(root: &Json) -> Vec<ValidationRefusal> {
    let mut refusals = Vec::new();
    let Json::Obj(top) = root else {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "(root)",
            "bundle",
            "manifest must be a JSON object",
        ));
        return refusals;
    };
    check_allowed_keys(
        top,
        "",
        &["plugin_manifest_version", "plugin", "apps", "engine"],
        &mut refusals,
    );
    match top
        .iter()
        .find(|(k, _)| k == "plugin_manifest_version")
        .map(|(_, v)| v)
    {
        Some(Json::Int(1)) => {}
        _ => refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin_manifest_version",
            "bundle",
            "`plugin_manifest_version` must be 1",
        )),
    }
    if let Some(plugin) = require_obj(top, "plugin", "", &mut refusals) {
        check_allowed_keys(
            plugin,
            "plugin",
            &[
                "id",
                "title",
                "version",
                "description",
                "license",
                "homepage",
            ],
            &mut refusals,
        );
        if let Some(id) = require_str(plugin, "id", "plugin", &mut refusals)
            && !plugin_id(id)
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "plugin.id",
                "bundle",
                "invalid plugin id",
            ));
        }
        if let Some(title) = require_str(plugin, "title", "plugin", &mut refusals)
            && !(1..=80).contains(&title.chars().count())
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "plugin.title",
                "bundle",
                "invalid plugin title length",
            ));
        }
        if let Some(version) = require_str(plugin, "version", "plugin", &mut refusals)
            && !valid_semver(version)
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "plugin.version",
                "bundle",
                "invalid semver",
            ));
        }
        if let Some(desc) = require_str(plugin, "description", "plugin", &mut refusals)
            && !(1..=500).contains(&desc.chars().count())
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "plugin.description",
                "bundle",
                "invalid description length",
            ));
        }
        if let Some(lic) = optional_str(plugin, "license", "plugin", &mut refusals)
            && !valid_license(lic)
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "plugin.license",
                "bundle",
                "invalid SPDX license",
            ));
        }
        if let Some(hp) = optional_str(plugin, "homepage", "plugin", &mut refusals)
            && (hp.chars().count() > 512
                || !hp.starts_with("https://")
                || hp.chars().any(char::is_whitespace))
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "plugin.homepage",
                "bundle",
                "invalid homepage URL pattern",
            ));
        }
    }
    match top.iter().find(|(k, _)| k == "apps").map(|(_, v)| v) {
        Some(Json::Arr(apps)) => {
            if !(1..=8).contains(&apps.len()) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    "apps",
                    "bundle",
                    "apps must hold 1 to 8 entries",
                ));
            }
            for (idx, item) in apps.iter().enumerate() {
                let base = format!("apps[{idx}]");
                let Json::Obj(obj) = item else {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_MANIFEST_INVALID,
                        base,
                        "bundle",
                        "app entry must be an object",
                    ));
                    continue;
                };
                check_allowed_keys(obj, &base, &["id", "path"], &mut refusals);
                if let Some(id) = require_str(obj, "id", &base, &mut refusals)
                    && !app_id(id)
                {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_MANIFEST_INVALID,
                        format!("{base}.id"),
                        "bundle",
                        "invalid app id",
                    ));
                }
                if let Some(path) = require_str(obj, "path", &base, &mut refusals)
                    && !(1..=512).contains(&path.chars().count())
                {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_MANIFEST_INVALID,
                        format!("{base}.path"),
                        "bundle",
                        "app path outside 1..=512 chars",
                    ));
                }
            }
        }
        _ => refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "apps",
            "bundle",
            "apps array is required",
        )),
    }
    if let Some((_, engine_val)) = top.iter().find(|(k, _)| k == "engine") {
        let Json::Obj(engine) = engine_val else {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine",
                "bundle",
                "engine must be an object",
            ));
            return refusals;
        };
        validate_engine_schema(engine, &mut refusals);
    }
    refusals
}

fn validate_engine_schema(engine: &[(String, Json)], refusals: &mut Vec<ValidationRefusal>) {
    check_allowed_keys(
        engine,
        "engine",
        &[
            "id",
            "kind",
            "mount_app",
            "service_mode",
            "artifacts",
            "auth",
            "mount",
        ],
        refusals,
    );
    if let Some(id) = require_str(engine, "id", "engine", refusals)
        && !plugin_id(id)
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.id",
            "bundle",
            "invalid engine id",
        ));
    }
    if let Some(kind) = require_str(engine, "kind", "engine", refusals)
        && kind != "http-service"
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.kind",
            "bundle",
            "engine.kind must be `http-service`",
        ));
    }
    if let Some(mount_app) = require_str(engine, "mount_app", "engine", refusals)
        && !app_id(mount_app)
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.mount_app",
            "bundle",
            "invalid mount_app id",
        ));
    }
    if let Some(mode) = require_str(engine, "service_mode", "engine", refusals)
        && mode != "login"
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.service_mode",
            "bundle",
            "engine.service_mode must be `login`",
        ));
    }
    if let Some(artifacts) = require_obj(engine, "artifacts", "engine", refusals) {
        if artifacts.is_empty() {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.artifacts",
                "bundle",
                "at least one target artifact is required",
            ));
        }
        for (target_key, val) in artifacts {
            let key_base = format_key("engine.artifacts", target_key);
            if Target::from_str_exact(target_key).is_none() {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key_base,
                    "bundle",
                    "unknown target",
                ));
                continue;
            }
            let Json::Obj(art) = val else {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key_base,
                    "bundle",
                    "artifact must be an object",
                ));
                continue;
            };
            check_allowed_keys(art, &key_base, &["path", "sha256"], refusals);
            if let Some(path) = require_str(art, "path", &key_base, refusals)
                && !(1..=512).contains(&path.chars().count())
            {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    format!("{key_base}.path"),
                    "bundle",
                    "artifact path outside 1..=512 chars",
                ));
            }
            if let Some(sha) = require_str(art, "sha256", &key_base, refusals)
                && !hex64(sha)
            {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    format!("{key_base}.sha256"),
                    "bundle",
                    "sha256 must be 64 lowercase hex characters",
                ));
            }
        }
    }
    if let Some(auth) = require_obj(engine, "auth", "engine", refusals) {
        check_allowed_keys(auth, "engine.auth", &["mode"], refusals);
        if let Some(mode) = require_str(auth, "mode", "engine.auth", refusals)
            && !matches!(mode, "approver" | "agent" | "none")
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.auth.mode",
                "bundle",
                "invalid auth mode",
            ));
        }
    }
    if let Some((_, mount_val)) = engine.iter().find(|(k, _)| k == "mount") {
        let Json::Obj(mount) = mount_val else {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.mount",
                "bundle",
                "mount must be an object",
            ));
            return;
        };
        validate_mount_schema(mount, refusals);
    }
}

fn validate_mount_schema(mount: &[(String, Json)], refusals: &mut Vec<ValidationRefusal>) {
    check_allowed_keys(
        mount,
        "engine.mount",
        &["audience", "labels", "approvals", "expose", "commands"],
        refusals,
    );
    if let Some(aud) = optional_str(mount, "audience", "engine.mount", refusals)
        && aud != "person"
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.mount.audience",
            "bundle",
            "audience must be `person`",
        ));
    }
    if let Some(labels) = optional_str(mount, "labels", "engine.mount", refusals)
        && !matches!(labels, "whole" | "per-part")
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.mount.labels",
            "bundle",
            "invalid labels",
        ));
    }
    if let Some(approvals) = optional_str(mount, "approvals", "engine.mount", refusals)
        && !matches!(approvals, "none" | "shell")
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.mount.approvals",
            "bundle",
            "invalid approvals",
        ));
    }
    if let Some((_, expose_val)) = mount.iter().find(|(k, _)| k == "expose") {
        let Json::Obj(expose) = expose_val else {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.mount.expose",
                "bundle",
                "expose must be an object",
            ));
            return;
        };
        check_allowed_keys(
            expose,
            "engine.mount.expose",
            &["agent", "palette"],
            refusals,
        );
        optional_bool(expose, "agent", "engine.mount.expose", refusals);
        optional_bool(expose, "palette", "engine.mount.expose", refusals);
    }
    if let Some((_, cmds_val)) = mount.iter().find(|(k, _)| k == "commands") {
        let Json::Obj(cmds) = cmds_val else {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.mount.commands",
                "bundle",
                "commands must be an object",
            ));
            return;
        };
        if cmds.len() > 256 {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.mount.commands",
                "bundle",
                "at most 256 command overrides",
            ));
        }
        for (cmd_name, cmd_val) in cmds {
            let cmd_base = format_key("engine.mount.commands", cmd_name);
            if !command_name(cmd_name) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    cmd_base.clone(),
                    "bundle",
                    "invalid command name",
                ));
            }
            let Json::Obj(cmd) = cmd_val else {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    cmd_base,
                    "bundle",
                    "command override must be an object",
                ));
                continue;
            };
            check_allowed_keys(
                cmd,
                &cmd_base,
                &["expose", "effects", "destructive", "preview"],
                refusals,
            );
            optional_bool(cmd, "destructive", &cmd_base, refusals);
            if let Some((_, ex_val)) = cmd.iter().find(|(k, _)| k == "expose") {
                let ex_base = format!("{cmd_base}.expose");
                if let Json::Obj(ex) = ex_val {
                    check_allowed_keys(ex, &ex_base, &["agent", "palette", "apps"], refusals);
                    optional_bool(ex, "agent", &ex_base, refusals);
                    optional_bool(ex, "palette", &ex_base, refusals);
                    optional_bool(ex, "apps", &ex_base, refusals);
                } else {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_MANIFEST_INVALID,
                        ex_base,
                        "bundle",
                        "expose must be an object",
                    ));
                }
            }
            if let Some((_, eff_val)) = cmd.iter().find(|(k, _)| k == "effects") {
                let eff_base = format!("{cmd_base}.effects");
                let ok = match eff_val {
                    Json::Arr(items) => {
                        let parsed: Option<Vec<Effect>> = items
                            .iter()
                            .map(|item| match item.as_str()? {
                                "inspect" => Some(Effect::Inspect),
                                "plugin-state" => Some(Effect::PluginState),
                                "external" => Some(Effect::External),
                                "store-write" => Some(Effect::StoreWrite),
                                "workspace-write" => Some(Effect::WorkspaceWrite),
                                _ => None,
                            })
                            .collect();
                        parsed.is_some_and(|list| effects_valid(&list))
                    }
                    _ => false,
                };
                if !ok {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_MANIFEST_INVALID,
                        eff_base,
                        "bundle",
                        "invalid effects array",
                    ));
                }
            }
            if let Some((_, prev_val)) = cmd.iter().find(|(k, _)| k == "preview") {
                let prev_base = format!("{cmd_base}.preview");
                if let Json::Obj(prev) = prev_val {
                    check_allowed_keys(prev, &prev_base, &["command", "input"], refusals);
                    if let Some(p_cmd) = require_str(prev, "command", &prev_base, refusals)
                        && !command_name(p_cmd)
                    {
                        refusals.push(ValidationRefusal::new(
                            PLUGIN_MANIFEST_INVALID,
                            format!("{prev_base}.command"),
                            "bundle",
                            "invalid preview command name",
                        ));
                    }
                    match prev.iter().find(|(k, _)| k == "input").map(|(_, v)| v) {
                        Some(Json::Arr(inputs)) => {
                            let mut seen = HashSet::new();
                            let valid = (1..=16).contains(&inputs.len())
                                && inputs.iter().all(|v| {
                                    v.as_str().is_some_and(|s| input_name(s) && seen.insert(s))
                                });
                            if !valid {
                                refusals.push(ValidationRefusal::new(
                                    PLUGIN_MANIFEST_INVALID,
                                    format!("{prev_base}.input"),
                                    "bundle",
                                    "invalid preview input list",
                                ));
                            }
                        }
                        _ => refusals.push(ValidationRefusal::new(
                            PLUGIN_MANIFEST_INVALID,
                            format!("{prev_base}.input"),
                            "bundle",
                            "preview.input is required",
                        )),
                    }
                } else {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_MANIFEST_INVALID,
                        prev_base,
                        "bundle",
                        "preview must be an object",
                    ));
                }
            }
        }
    }
}
