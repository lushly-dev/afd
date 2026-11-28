//! Full section 4.4 validation for plugin manifests, bundle paths, app manifests, and canonical
//! bundle digests (phase 5 no-terminal amendment, 4.4 & 7.1; P5-S9-2).
//!
//! Matches `@lushly-dev/loam-manifest/plugin` (`read-plugin.ts`, `shell-name.ts`, `approvals-rules.ts`)
//! and `@lushly-dev/loam-cli` (`plugin-check.ts`) on every case in `loam-plugin-cases.json`.
//!
//! Unicode case mappings in [`fold_bundle_path`] use Rust `str::to_lowercase` / `str::to_uppercase`
//! (Unicode 18.0 in Rust 1.100.0, verified by `char::UNICODE_VERSION` in unit tests) together with
//! `icu_normalizer` NFC/NFKC and `icu_properties` GeneralCategory (`Cc`, `Cf`, `L`, `N`).
use crate::js_json::Json;
use crate::plugin_manifest::{Approvals, AuthMode, PluginManifest, app_id, holds_null};
use crate::plugin_schema::{
    format_key, valid_artifact_basename, valid_homepage, valid_semver, validate_schema_json,
};
use crate::plugins_error::{
    DEPLOYMENT_PREVIEW_INVALID, DEPLOYMENT_PREVIEW_REQUIRED, PLUGIN_MANIFEST_INVALID,
    PLUGIN_PATH_ESCAPE,
};
use icu_normalizer::ComposingNormalizer;
use icu_properties::CodePointMapData;
use icu_properties::props::{GeneralCategory, GeneralCategoryGroup};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

/// Maximum UTF-8 bytes in a single bundle path segment (APFS, ext4, NTFS).
pub const BUNDLE_SEGMENT_MAX_BYTES: usize = 255;
/// Maximum UTF-8 bytes in a full bundle-relative path (amendment 4.4, rule 3).
pub const BUNDLE_PATH_MAX_BYTES: usize = 768;
/// Maximum total files in a bundle (amendment 4.4, rule 3).
pub const BUNDLE_FILES_MAX: usize = 2_000;
/// Maximum uncompressed bytes in a bundle (256 MiB; amendment 4.4, rule 3).
pub const BUNDLE_BYTES_MAX: usize = 256 * 1024 * 1024;
/// Maximum size of `plugin-manifest.json` (1 MiB; amendment 4.4, rule 3).
pub const MANIFEST_MAX_BYTES: usize = 1024 * 1024;

/// Exact list from `@lushly-dev/loam-manifest`'s `SHELL_DOMAINS_V1` (`catalogs.ts`).
const SHELL_DOMAINS_V1: &[&str] = &[
    "shell",
    "app",
    "project",
    "scope",
    "document",
    "presence",
    "thread",
    "copilot",
    "run",
    "automation",
    "autonomy",
    "approval",
    "agent",
    "pack",
    "view-state",
    "layout",
    "toast",
    "dialog",
    "modal",
    "popover",
    "prompt",
    "overlay",
    "appearance",
    "palette",
    "status",
    "setting",
    "experiment",
    "notification",
    "limit",
    "keybinding",
    "event",
    "account",
    "persona",
    "session",
    "auth",
    "workspace",
    "section",
    "editor",
    "new",
    "member",
    "confirmation",
];

/// A single validation refusal carrying the exact section 11 `code`, manifest/file `key`, and
/// stable `reason` tag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationRefusal {
    pub code: &'static str,
    pub key: String,
    pub reason: &'static str,
    pub message: String,
}

impl ValidationRefusal {
    pub fn new(
        code: &'static str,
        key: impl Into<String>,
        reason: &'static str,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            key: key.into(),
            reason,
            message: message.into(),
        }
    }
}

/// Whether `id` is reserved by the shell or AFD (amendment 4.4, rule 2).
pub fn is_reserved_plugin_name(id: &str) -> bool {
    matches!(id, "shell" | "loam" | "p" | "afd") || SHELL_DOMAINS_V1.contains(&id)
}

/// Whether `text` holds any Unicode `Cc` control char, `Cf` invisible format char, or line/paragraph
/// separator (`U+2028` / `U+2029`) (amendment 4.4, rule 2 & 3).
pub fn hides_text(text: &str) -> bool {
    let gc = CodePointMapData::<GeneralCategory>::new();
    text.chars().any(|ch| {
        matches!(ch, '\u{2028}' | '\u{2029}')
            || matches!(
                gc.get(ch),
                GeneralCategory::Control | GeneralCategory::Format
            )
    })
}

/// Whether `text` says "Loam" as a standalone word after NFKC, stripping `Cf`, turning `_` into
/// space, and lowercasing (`shell-name.ts` `saysShellName`).
pub fn says_shell_name(text: &str) -> bool {
    let nfkc = ComposingNormalizer::new_nfkc().normalize(text);
    let gc = CodePointMapData::<GeneralCategory>::new();
    let mut cleaned = String::with_capacity(nfkc.len());
    for ch in nfkc.chars() {
        if gc.get(ch) == GeneralCategory::Format {
            continue;
        }
        if ch == '_' {
            cleaned.push(' ');
        } else {
            cleaned.push(ch);
        }
    }
    let lower = cleaned.to_lowercase();
    let is_word = |ch: char| {
        let cat = gc.get(ch);
        GeneralCategoryGroup::Letter.contains(cat) || GeneralCategoryGroup::Number.contains(cat)
    };
    for (idx, _) in lower.match_indices("loam") {
        let before_ok = lower[..idx]
            .chars()
            .next_back()
            .is_none_or(|ch| !is_word(ch));
        let after_ok = lower[idx + 4..]
            .chars()
            .next()
            .is_none_or(|ch| !is_word(ch));
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// Case-insensitive bundle path fold matching `@lushly-dev/loam-manifest`'s `foldBundlePath`:
/// NFC -> `to_lowercase` -> `to_uppercase` -> `to_lowercase` -> NFC.
pub fn fold_bundle_path(path: &str) -> String {
    let nfc = ComposingNormalizer::new_nfc();
    let step1 = nfc.normalize(path);
    let step2 = step1.to_lowercase().to_uppercase().to_lowercase();
    nfc.normalize(&step2).into_owned()
}

/// Whether `path` is already in Unicode Normalization Form C (NFC).
pub fn is_nfc(path: &str) -> bool {
    ComposingNormalizer::new_nfc().is_normalized(path)
}

/// Windows reserved device name check matching `read-plugin.ts`'s `WINDOWS_RESERVED`:
/// `^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$` (ASCII case-insensitive).
fn is_windows_reserved_segment(segment: &str) -> bool {
    let stem = match segment.find('.') {
        Some(dot) => &segment[..dot],
        None => segment,
    };
    let stem = stem.trim_end_matches(' ');
    let lower = stem.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "con" | "prn" | "aux" | "nul" | "conin$" | "conout$"
    ) {
        return true;
    }
    if let Some(rest) = lower
        .strip_prefix("com")
        .or_else(|| lower.strip_prefix("lpt"))
    {
        let mut chars = rest.chars();
        if let (Some(ch), None) = (chars.next(), chars.next()) {
            return matches!(ch, '0'..='9' | '\u{00b9}' | '\u{00b2}' | '\u{00b3}');
        }
    }
    false
}

/// What is wrong with a bundle-relative path (amendment 4.4, rule 3), or `None`.
pub fn bundle_path_problem(path: &str) -> Option<&'static str> {
    if path.len() > BUNDLE_PATH_MAX_BYTES {
        return Some("is longer than 768 bytes of UTF-8");
    }
    if path.contains('\\') {
        return Some("uses `\\`; a bundle path uses `/` only");
    }
    if path.starts_with('/') {
        return Some("is absolute");
    }
    if path.contains([':', '\0']) {
        return Some("holds `:` or NUL");
    }
    if hides_text(path) {
        return Some("holds a control or invisible character");
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Some("has an empty, `.` or `..` segment");
        }
        if is_windows_reserved_segment(segment) {
            return Some("has a name Windows reserves");
        }
        if segment.contains(['<', '>', '"', '|', '?', '*']) {
            return Some("holds one of `<>\"|?*`, which a Windows name cannot");
        }
        if segment.ends_with('.') || segment.ends_with(' ') {
            return Some("has a segment ending in a dot or a space");
        }
        if segment.len() > BUNDLE_SEGMENT_MAX_BYTES {
            return Some("has a segment longer than 255 bytes of UTF-8");
        }
    }
    if !is_nfc(path) {
        return Some("is not in Unicode normalization form C");
    }
    None
}

/// Validates a `plugin-manifest.json` buffer against `loam-plugin.v1.json` AND all section 4.4
/// manifest-alone rules (rules 1, 2, 3, and the manifest-only parts of rule 5).
pub fn validate_plugin_manifest(
    bytes: &[u8],
) -> Result<(PluginManifest, Json), Vec<ValidationRefusal>> {
    if bytes.len() > MANIFEST_MAX_BYTES {
        return Err(vec![ValidationRefusal::new(
            crate::plugins_error::PLUGIN_BUNDLE_TOO_LARGE,
            "plugin-manifest.json",
            "bundle",
            "plugin-manifest.json exceeds 1 MiB",
        )]);
    }
    if std::str::from_utf8(bytes).is_err() {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin-manifest.json",
            "bundle",
            "plugin-manifest.json is not valid UTF-8",
        )]);
    }
    let Some(ordered) = Json::parse(bytes) else {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin-manifest.json",
            "bundle",
            "plugin-manifest.json is not valid JSON",
        )]);
    };
    let schema_refusals = validate_schema_json(&ordered);
    if !schema_refusals.is_empty() {
        return Err(schema_refusals);
    }
    if holds_null(&ordered) {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin-manifest.json",
            "bundle",
            "manifest contains null",
        )]);
    }
    let manifest: PluginManifest = serde_json::from_slice(bytes).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin-manifest.json",
            "bundle",
            "manifest failed typed deserialization",
        )]
    })?;

    let mut refusals = Vec::new();
    // Rule 2: display-safe text & no "Loam" shell name.
    for (field, value) in [
        ("plugin.title", Some(manifest.plugin.title.as_str())),
        (
            "plugin.description",
            Some(manifest.plugin.description.as_str()),
        ),
        ("plugin.license", manifest.plugin.license.as_deref()),
        ("plugin.homepage", manifest.plugin.homepage.as_deref()),
    ] {
        if let Some(text) = value
            && hides_text(text)
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                field,
                "bundle",
                "contains control, format, or line-separator character",
            ));
        }
    }
    if let Some(hp) = manifest.plugin.homepage.as_deref()
        && !valid_homepage(hp)
    {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin.homepage",
            "bundle",
            "homepage is not a valid credential-free https URL",
        ));
    }
    if says_shell_name(&manifest.plugin.title) {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin.title",
            "bundle",
            "title says Loam",
        ));
    }

    // Rule 2 & 3: reserved names, duplicate app ids, bundle paths, path fold collisions.
    if is_reserved_plugin_name(&manifest.plugin.id) {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin.id",
            "bundle",
            "plugin id is reserved",
        ));
    }
    let mut seen_apps: HashSet<&str> = HashSet::new();
    let mut seen_paths: HashSet<String> = HashSet::new();
    for (idx, app) in manifest.apps.iter().enumerate() {
        if is_reserved_plugin_name(&app.id) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format!("apps[{idx}].id"),
                "bundle",
                "app id is reserved",
            ));
        }
        if !seen_apps.insert(app.id.as_str()) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format!("apps[{idx}].id"),
                "bundle",
                "duplicate app id",
            ));
        }
        if let Some(problem) = bundle_path_problem(&app.path) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                format!("apps[{idx}].path"),
                "bundle",
                problem,
            ));
        } else if !seen_paths.insert(fold_bundle_path(&app.path)) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format!("apps[{idx}].path"),
                "bundle",
                "app path collides with another app ignoring case",
            ));
        }
    }

    // Rule 3 & 5: engine artifacts, mount_app, approver bi-implication, previews.
    if let Some(engine) = &manifest.engine {
        for (&target, artifact) in &engine.artifacts {
            let key = format!("engine.artifacts[\"{}\"].path", target.as_str());
            if let Some(problem) = bundle_path_problem(&artifact.path) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    key,
                    "bundle",
                    problem,
                ));
                continue;
            }
            let prefix = format!("engines/{}/", target.as_str());
            let Some(name) = artifact.path.strip_prefix(&prefix) else {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key,
                    "bundle",
                    "artifact path must be directly under engines/<target>/",
                ));
                continue;
            };
            if name.contains('/') || !valid_artifact_basename(name, target.is_windows()) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key,
                    "bundle",
                    "artifact basename is invalid for target",
                ));
            }
        }
        if !manifest.apps.iter().any(|app| app.id == engine.mount_app) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "engine.mount_app",
                "bundle",
                "engine.mount_app is not in apps[]",
            ));
        }
        let approver = engine.auth.mode == AuthMode::Approver;
        let shell_approvals = engine
            .mount
            .as_ref()
            .and_then(|m| m.approvals)
            .is_some_and(|a| a == Approvals::Shell);
        if approver != shell_approvals {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                if shell_approvals {
                    "engine.mount.approvals"
                } else {
                    "engine.auth.mode"
                },
                "bundle",
                "approver auth mode bi-implicates shell approvals",
            ));
        }
        let commands = engine.mount.as_ref().and_then(|m| m.commands.as_ref());
        let previewed: Vec<(&str, &str)> = commands
            .into_iter()
            .flat_map(|map| map.iter())
            .filter_map(|(name, ov)| {
                ov.preview
                    .as_ref()
                    .map(|p| (name.as_str(), p.command.as_str()))
            })
            .collect();
        if shell_approvals && previewed.is_empty() {
            refusals.push(ValidationRefusal::new(
                DEPLOYMENT_PREVIEW_REQUIRED,
                "engine.mount.approvals",
                "bundle",
                "shell approvals requires at least one command preview",
            ));
        }
        for (cmd_name, preview_cmd) in previewed {
            let cmd_key = format_key("engine.mount.commands", cmd_name);
            if !shell_approvals {
                refusals.push(ValidationRefusal::new(
                    DEPLOYMENT_PREVIEW_INVALID,
                    format!("{cmd_key}.preview"),
                    "bundle",
                    "preview requires approvals = \"shell\"",
                ));
            } else if preview_cmd == cmd_name {
                refusals.push(ValidationRefusal::new(
                    DEPLOYMENT_PREVIEW_INVALID,
                    format!("{cmd_key}.preview.command"),
                    "bundle",
                    "preview cannot name the command itself",
                ));
            }
        }
    }

    if refusals.is_empty() {
        Ok((manifest, ordered))
    } else {
        Err(refusals)
    }
}

/// Extracted view of a packed `app-manifest.json` needed for section 4.4 rules 4 & 5 and consent
/// summaries.
#[derive(Debug, Clone)]
pub struct PackedAppSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub domains: Vec<String>,
    pub grants: Vec<String>,
    pub mount_prefix: Option<String>,
    pub mount_transport: Option<String>,
    pub built_paths: Vec<String>,
}

/// Validates a packed `app-manifest.json` buffer against Loam's `app-manifest.v3.json` profile
/// (amendment 4.4, rule 4) and extracts the metadata required for cross-app coherence checks and
/// consent proposals.
pub fn parse_packed_app_manifest(bytes: &[u8]) -> Result<PackedAppSummary, &'static str> {
    if std::str::from_utf8(bytes).is_err() {
        return Err("app-manifest.json is not valid UTF-8");
    }
    let root = Json::parse(bytes).ok_or("app-manifest.json is not valid JSON")?;
    if !matches!(root, Json::Obj(_)) {
        return Err("app-manifest.json must be a JSON object");
    }
    let manifest_version = match root.get("manifest_version") {
        Some(Json::Int(v @ 1..=3)) => *v,
        _ => return Err("unsupported manifest_version"),
    };
    if root.get("protocol") != Some(&Json::Int(1)) {
        return Err("unsupported protocol version");
    }
    if root.get("pipelines").is_some() {
        return Err("pipelines is forbidden in Loam app manifests");
    }
    let plugin = root.get("plugin").ok_or("missing plugin table")?;
    let id = plugin
        .get("id")
        .and_then(Json::as_str)
        .filter(|s| app_id(s) && !is_reserved_plugin_name(s))
        .ok_or("invalid plugin.id")?
        .to_owned();
    let title = plugin
        .get("title")
        .and_then(Json::as_str)
        .filter(|s| (1..=80).contains(&s.chars().count()) && !hides_text(s) && !says_shell_name(s))
        .ok_or("invalid plugin.title")?
        .to_owned();
    let _version = plugin
        .get("version")
        .and_then(Json::as_str)
        .filter(|s| valid_semver(s))
        .ok_or("invalid plugin.version")?;
    let _desc = plugin
        .get("description")
        .and_then(Json::as_str)
        .filter(|s| (1..=500).contains(&s.chars().count()) && !hides_text(s))
        .ok_or("invalid plugin.description")?;
    let kind = plugin
        .get("kind")
        .and_then(Json::as_str)
        .filter(|s| matches!(*s, "native" | "view" | "mounted"))
        .ok_or("invalid plugin.kind")?
        .to_owned();
    let domains: Vec<String> = match plugin.get("domains") {
        Some(Json::Arr(arr)) if !arr.is_empty() => {
            let mut seen = HashSet::new();
            let mut out = Vec::with_capacity(arr.len());
            for v in arr {
                let Some(d) = v
                    .as_str()
                    .filter(|s| app_id(s) && !is_reserved_plugin_name(s))
                else {
                    return Err("invalid or reserved plugin.domains entry");
                };
                if !seen.insert(d) {
                    return Err("duplicate plugin.domains entry");
                }
                out.push(d.to_owned());
            }
            out
        }
        _ => return Err("missing plugin.domains"),
    };
    let grants: Vec<String> = match root.get("grants") {
        None => Vec::new(),
        Some(Json::Arr(arr)) => arr
            .iter()
            .filter_map(|item| item.get("name").and_then(Json::as_str).map(str::to_owned))
            .collect(),
        _ => return Err("invalid grants"),
    };
    // Refuse unpacked schema file references (`MANIFEST_NOT_PACKED`) and enforce versioned keys
    // (`commands[].confirm_prompt` >= v2, `commands[].expose.apps` >= v3).
    if let Some(Json::Arr(items)) = root.get("commands") {
        for item in items {
            if matches!(item.get("input_schema"), Some(Json::Str(_)))
                || matches!(item.get("returns"), Some(Json::Str(_)))
            {
                return Err("unpacked schema path in app-manifest.json");
            }
            if manifest_version < 2 && item.get("confirm_prompt").is_some() {
                return Err("confirm_prompt requires manifest_version >= 2");
            }
            if manifest_version < 3 && item.get("expose").and_then(|e| e.get("apps")).is_some() {
                return Err("commands[].expose.apps requires manifest_version = 3");
            }
        }
    }
    if let Some(cfg) = root.get("config")
        && matches!(cfg.get("schema"), Some(Json::Str(_)))
    {
        return Err("unpacked config.schema path");
    }
    if let Some(ui) = root.get("ui")
        && let Some(Json::Arr(docs)) = ui.get("documents")
        && docs
            .iter()
            .any(|d| matches!(d.get("content_schema"), Some(Json::Str(_))))
    {
        return Err("unpacked document content_schema path");
    }

    // Enforce kind-specific top-level tables (`app-manifest.v3.json` `allOf` conditionals).
    match kind.as_str() {
        "native" => {
            if root.get("native").is_none()
                || root.get("view").is_some()
                || root.get("mount").is_some()
            {
                return Err("native app requires `native` and forbids `view`/`mount`");
            }
        }
        "view" => {
            if root.get("native").is_some() || root.get("mount").is_some() {
                return Err("view app forbids `native`/`mount`");
            }
        }
        "mounted" => {
            if root.get("mount").is_none()
                || root.get("native").is_some()
                || root.get("view").is_some()
            {
                return Err("mounted app requires `mount` and forbids `native`/`view`");
            }
        }
        _ => return Err("invalid plugin.kind"),
    }

    let (mount_prefix, mount_transport) = match root.get("mount") {
        None => (None, None),
        Some(mount) => {
            if mount.get("url").is_some() || mount.get("bearer_env").is_some() {
                return Err("forbidden mount key");
            }
            let prefix = mount
                .get("prefix")
                .and_then(Json::as_str)
                .filter(|s| app_id(s) && !is_reserved_plugin_name(s))
                .ok_or("invalid or reserved mount.prefix")?
                .to_owned();
            let transport = mount
                .get("transport")
                .and_then(Json::as_str)
                .filter(|s| matches!(*s, "http" | "stdio"))
                .ok_or("invalid mount.transport")?
                .to_owned();
            if !domains.iter().any(|d| d == &prefix) {
                return Err("mount.prefix not listed in plugin.domains");
            }
            (Some(prefix), Some(transport))
        }
    };

    let mut built_paths = Vec::new();
    if let Some(native) = root.get("native") {
        let entry = native
            .get("entry")
            .and_then(Json::as_str)
            .filter(|p| {
                bundle_path_problem(p).is_none() && (p.ends_with(".js") || p.ends_with(".mjs"))
            })
            .ok_or("invalid native.entry")?;
        built_paths.push(normalize_package_path(entry));
    }
    if let Some(view) = root.get("view")
        && let Some(handlers_val) = view.get("handlers")
    {
        let handlers = handlers_val
            .as_str()
            .filter(|p| {
                bundle_path_problem(p).is_none() && (p.ends_with(".html") || p.ends_with(".htm"))
            })
            .ok_or("invalid view.handlers")?;
        built_paths.push(normalize_package_path(handlers));
    }
    if let Some(Json::Arr(resources)) = root.get("ui").and_then(|u| u.get("resources")) {
        if kind != "view" {
            return Err("ui.resources is only allowed on view apps");
        }
        for resource in resources {
            if let Some(p) = resource.get("path").and_then(Json::as_str) {
                if bundle_path_problem(p).is_some() {
                    return Err("invalid ui.resources[].path");
                }
                built_paths.push(normalize_package_path(p));
            }
        }
    }

    Ok(PackedAppSummary {
        id,
        title,
        kind,
        domains,
        grants,
        mount_prefix,
        mount_transport,
        built_paths,
    })
}

/// `apps[i]`'s packed `app-manifest.json` read as inspect reads it: a manifest it cannot read, one whose title or
/// description hides a character from the consent screen among them, is `PLUGIN_MANIFEST_INVALID` at `key`
/// (`apps[i].path`), as `read-plugin.ts`'s `pluginAppsRefusals` keys it.
pub fn read_packed_app(bytes: &[u8], key: &str) -> Result<PackedAppSummary, ValidationRefusal> {
    parse_packed_app_manifest(bytes)
        .map_err(|why| ValidationRefusal::new(PLUGIN_MANIFEST_INVALID, key, "bundle", why))
}

fn normalize_package_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if !parts.is_empty() && parts.last() != Some(&"..") {
                    parts.pop();
                } else {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// Cross-app & engine coherence checks matching `read-plugin.ts`'s `pluginAppsRefusals` (rules 4 & 5).
pub fn validate_plugin_apps(
    manifest: &PluginManifest,
    apps: &HashMap<String, PackedAppSummary>,
) -> Vec<ValidationRefusal> {
    let mut refusals = Vec::new();
    let mount_app = manifest.engine.as_ref().map(|e| e.mount_app.as_str());

    for (idx, entry) in manifest.apps.iter().enumerate() {
        let Some(app) = apps.get(&entry.id) else {
            continue;
        };
        if (app.kind == "native" || app.kind == "view") && app.id != entry.id {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format!("apps[{idx}].id"),
                "bundle",
                "native/view app id must match manifest plugin.id",
            ));
        }
        if app.kind == "mounted" && Some(entry.id.as_str()) != mount_app {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format!("apps[{idx}].id"),
                "bundle",
                "mounted app must match engine.mount_app",
            ));
        }
    }

    // One domain per instance (D66).
    let mut domains: HashMap<&str, usize> = HashMap::new();
    for (idx, entry) in manifest.apps.iter().enumerate() {
        let Some(app) = apps.get(&entry.id) else {
            continue;
        };
        let domain = if app.kind == "mounted" {
            app.mount_prefix.as_deref()
        } else {
            Some(app.id.as_str())
        };
        if let Some(domain) = domain
            && domains.insert(domain, idx).is_some()
        {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                format!("apps[{idx}].id"),
                "bundle",
                "two bundled apps share one domain",
            ));
        }
    }

    let Some(engine) = &manifest.engine else {
        return refusals;
    };
    let Some(app) = apps.get(&engine.mount_app) else {
        return refusals;
    };
    if app.kind != "mounted" || app.mount_transport.as_deref() != Some("http") {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.mount_app",
            "bundle",
            "engine.mount_app must be a mounted app over http",
        ));
        return refusals;
    }
    let Some(mount_prefix) = app.mount_prefix.as_deref() else {
        refusals.push(ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "engine.mount_app",
            "bundle",
            "mounted app lacks mount.prefix",
        ));
        return refusals;
    };
    let prefix = format!("{mount_prefix}-");
    if let Some(commands) = engine.mount.as_ref().and_then(|m| m.commands.as_ref()) {
        for (cmd_name, ov) in commands {
            let key = format_key("engine.mount.commands", cmd_name);
            if !cmd_name.starts_with(&prefix) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key.clone(),
                    "bundle",
                    "command does not belong to mount.prefix",
                ));
            }
            if let Some(preview) = &ov.preview
                && !preview.command.starts_with(&prefix)
            {
                refusals.push(ValidationRefusal::new(
                    DEPLOYMENT_PREVIEW_INVALID,
                    format!("{key}.preview.command"),
                    "bundle",
                    "preview command does not belong to mount.prefix",
                ));
            }
        }
    }

    refusals
}

/// Checks case-insensitive / fold path collisions across a set of bundle-relative file paths
/// (matching `plugin-archive.ts` `entryRefusals` and `plugin-check.ts` `collisionRefusals`).
pub fn check_path_collisions(paths: &[String]) -> Vec<ValidationRefusal> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum EntryKind {
        File,
        Directory,
    }
    let mut refusals = Vec::new();
    let mut claimed: HashMap<String, (String, EntryKind)> = HashMap::new();
    let claim = |claimed: &mut HashMap<String, (String, EntryKind)>,
                 refusals: &mut Vec<ValidationRefusal>,
                 spelled: &str,
                 kind: EntryKind,
                 full_path: &str|
     -> bool {
        let folded = fold_bundle_path(spelled);
        match claimed.get(&folded) {
            None => {
                claimed.insert(folded, (spelled.to_owned(), kind));
                true
            }
            Some((held_spelled, held_kind)) => {
                if *held_kind != kind {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_PATH_ESCAPE,
                        full_path,
                        "file-in-file",
                        "entry collides with a file as a parent directory",
                    ));
                    false
                } else if held_spelled != spelled {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_PATH_ESCAPE,
                        full_path,
                        "fold",
                        "two paths fold to one name on a case-insensitive filesystem",
                    ));
                    false
                } else if kind == EntryKind::File {
                    refusals.push(ValidationRefusal::new(
                        PLUGIN_PATH_ESCAPE,
                        full_path,
                        "duplicate",
                        "duplicate path entry",
                    ));
                    false
                } else {
                    true
                }
            }
        }
    };

    for path in paths {
        if let Some(problem) = bundle_path_problem(path) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                path,
                "path",
                problem,
            ));
            continue;
        }
        let segments: Vec<&str> = path.split('/').collect();
        let mut ok = true;
        for end in 1..segments.len() {
            let prefix = segments[..end].join("/");
            if !claim(
                &mut claimed,
                &mut refusals,
                &prefix,
                EntryKind::Directory,
                path,
            ) {
                ok = false;
                break;
            }
        }
        if ok {
            claim(&mut claimed, &mut refusals, path, EntryKind::File, path);
        }
    }
    refusals
}

/// Computes the canonical section 7.1 `bundleSha256` digest over `(relative_path, file_sha256)`
/// pairs, sorted by `relative_path.as_bytes()`.
pub fn bundle_digest(files: &[(String, String)]) -> String {
    let mut sorted: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, h)| (p.as_str(), h.as_str()))
        .collect();
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut hasher = Sha256::new();
    for (path, digest) in sorted {
        hasher.update(digest.as_bytes());
        hasher.update(b"  ");
        hasher.update(path.as_bytes());
        hasher.update(b"\n");
    }
    encode_hex_lower(&hasher.finalize())
}

/// Computes lowercase hex SHA-256 of a byte slice.
pub fn sha256_hex(bytes: &[u8]) -> String {
    encode_hex_lower(&Sha256::digest(bytes))
}

fn encode_hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}
