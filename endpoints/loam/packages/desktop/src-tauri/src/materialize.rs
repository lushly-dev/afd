//! The headless deployment materializer (phase 5 no-terminal amendment, 9.2; D168): from the committed
//! `desktop-state.json` and the installed bundles it names, `loam-desktop` writes `<app data>/site/`
//! (`deployment.json` and each app's package), `mounts.json` and `models.json` in pure Rust, with no Node.js and no
//! window. What it writes is what `loam deployment write --host desktop` writes from the same input, byte for byte:
//! the projection's `generation` and `boot` records by `deployment.ts`'s own rules, and the same `frame-src`
//! (9.3, the golden fixture `desktop-projection-golden.json`). Only the credential differs: an engine's bearer is a
//! keychain reference and the engine's `proof_key`, never the bearer itself.
//!
//! Nothing of a port, a URL, a token, a key, an endpoint or a path reaches `deployment.json` (D63). The shell's own
//! files are not written: the signed shell is served from the binary in `managed` mode (D168, amended).
use crate::connection::{Unwritten, sync_directory, write_owner_only};
use crate::desktop_state::{self, DesktopState, INVALID, PERMISSIONS};
use crate::js_json::{self, Json};
use crate::models::{KeyRef, Kind, Provider};
use crate::mounts::read_owner_only;
use crate::plugin_manifest::{self, AuthMode};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Compile-time digest of the bundled shell (`../dist`), polyfill, and desktop build metadata
/// (`build.rs`), written to `<app data>/site/.loam-shell-build` so startup reconciles `site/`
/// across app upgrades (amendment 9.1 & 9.2).
pub const SHELL_BUILD_ID: &str = env!("LOAM_SHELL_BUILD_ID");

/// Writing the site or a file beside it failed partway: the previous site stays, and the state is not committed.
pub const FAILED: &str = "DESKTOP_MATERIALIZE_FAILED";
/// The default profile's keychain service for plugin mount bearers (5.3).
pub const MOUNT_KEYCHAIN: &str = "loam-plugin-mount";
/// The bound on a `plugin-manifest.json` (4.4).
const MANIFEST_MAX: usize = 1024 * 1024;
/// The bound on an `app-manifest.json`: the whole bundle's, as `loam plugin check` reads one (4.4).
const APP_MANIFEST_MAX: usize = 256 * 1024 * 1024;
/// The bounds on one package's files and bytes, a whole bundle's (4.4) as `loam plugin check` counts them, and on its
/// folders, which it does not count.
const PACKAGE_FILES_MAX: usize = 2000;
const PACKAGE_FOLDERS_MAX: usize = 2000;
const PACKAGE_BYTES_MAX: u64 = 256 * 1024 * 1024;
/// Instance ids the shell keeps (`read-deployment.ts`'s `reservedInstances`, 4.4's rule 2).
const RESERVED_INSTANCES: &[&str] = &["shell", "loam", "p", "afd"];
const PARTS: [&str; 3] = ["sidebar", "inspector", "panel"];
const DEFAULT_ICON: &str = "system/folder";
const DEFAULT_ORDER: i64 = 100;

/// What the files depend on beyond the state: the platform's sandbox origin and the profile's mount keychain
/// service (5.3 scopes it for a non-default `LOAM_DESKTOP_DATA_DIR`).
pub struct Profile<'a> {
    pub sandbox_origin: &'a str,
    pub mount_keychain: &'a str,
}

impl Profile<'static> {
    /// This platform's sandbox origin and the default profile's service.
    pub fn default_profile() -> Self {
        Self {
            sandbox_origin: crate::site::sandbox_origin(),
            mount_keychain: MOUNT_KEYCHAIN,
        }
    }
}

/// One app's package: its instance, the installed package's directory and its files, relative, `/`-separated.
struct Package {
    instance: String,
    root: PathBuf,
    files: Vec<String>,
}

/// The files the state materializes to, before any is written.
pub struct Materialized {
    pub generation: String,
    /// `site/deployment.json`'s bytes.
    pub deployment: String,
    /// `models.json`'s bytes.
    pub models: String,
    /// `mounts.json`'s bytes.
    pub mounts: String,
    /// The shell's `frame-src`: the sandbox origin when an app is a view, a mounted instance lets its views render
    /// (`views`, D169) or a provider is configured, else `'none'`.
    pub frame_src: String,
    /// Deterministic `<plugin-id> <bundleSha256>\n` lines written to `site/.loam-bundles` so
    /// startup reconciliation detects uncommitted app-only JS upgrades even when `deployment.json`,
    /// `generation`, and filenames are identical.
    bundles_marker: String,
    packages: Vec<Package>,
}

/// `relative`'s `/`-separated segments under `base`, one by one: a canonical Windows path (`\\?\`) takes no `/`.
fn under(base: &Path, relative: &str) -> PathBuf {
    let mut path = base.to_path_buf();
    path.extend(relative.split('/'));
    path
}

/// The directory `segments` name under `base`, each one checked as a directory and not a link (a junction is one on
/// Windows), so nothing reached through it can lie outside the tree it was named in.
fn directory_under<'a>(
    base: &Path,
    segments: impl IntoIterator<Item = &'a str>,
) -> Result<PathBuf, &'static str> {
    let mut path = base.to_path_buf();
    for segment in segments {
        path.push(segment);
        if !std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir()) {
            return Err(INVALID);
        }
    }
    Ok(path)
}

/// A regular file opened without following a link, checked on its own handle, so what is read or copied is the
/// file that was checked: `O_NOFOLLOW` on POSIX (and `O_NONBLOCK`, so a FIFO is refused rather than waited on),
/// `FILE_FLAG_OPEN_REPARSE_POINT` on Windows, which opens a link itself and so fails the check.
fn open_regular(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT.
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)?;
    if file.metadata()?.is_file() {
        Ok(file)
    } else {
        Err(std::io::ErrorKind::InvalidData.into())
    }
}

/// A file the materializer reads from an installed bundle: a regular file, never a link, within its bound.
fn read_regular(path: &Path, max: usize) -> Result<Vec<u8>, &'static str> {
    use std::io::Read;
    let file = open_regular(path).map_err(|_| INVALID)?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| INVALID)?;
    (bytes.len() <= max).then_some(bytes).ok_or(INVALID)
}

/// Every file under a package's directory, relative: regular files and directories only, no link anywhere.
fn package_files(root: &Path) -> Result<Vec<String>, &'static str> {
    let mut files = Vec::new();
    let mut folders = 0usize;
    let mut bytes = 0u64;
    let mut pending = vec![(root.to_path_buf(), String::new())];
    while let Some((directory, prefix)) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|_| INVALID)? {
            let entry = entry.map_err(|_| INVALID)?;
            let name = entry.file_name().into_string().map_err(|_| INVALID)?;
            let relative = format!("{prefix}{name}");
            let kind = entry.file_type().map_err(|_| INVALID)?;
            if kind.is_dir() {
                folders += 1;
                pending.push((entry.path(), format!("{relative}/")));
            } else if kind.is_file() {
                bytes += entry.metadata().map_err(|_| INVALID)?.len();
                files.push(relative);
            } else {
                return Err(INVALID);
            }
            if files.len() > PACKAGE_FILES_MAX
                || folders > PACKAGE_FOLDERS_MAX
                || bytes > PACKAGE_BYTES_MAX
            {
                return Err(INVALID);
            }
        }
    }
    files.sort();
    Ok(files)
}

/// JavaScript's truthiness, for the boot record's `!rail` and `!surfaces.sidebar`.
fn truthy(value: Option<&Json>) -> bool {
    !matches!(
        value,
        None | Some(Json::Null | Json::Bool(false) | Json::Int(0))
    ) && value.and_then(Json::as_str) != Some("")
}

/// `${value}` for what an experiment id can be.
fn template(value: Option<&Json>) -> Option<String> {
    match value? {
        Json::Str(text) => Some(text.clone()),
        Json::Int(number) => Some(number.to_string()),
        Json::Num(number) => Some(js_json::js_number(*number)),
        Json::Bool(flag) => Some(flag.to_string()),
        Json::Null => Some("null".into()),
        _ => None,
    }
}

/// An app's boot record, by `deployment.ts`'s `bootRecordOf`: what `app-list` will say of it. A desktop-managed
/// entry has no deployer `title`, `order` or `projects`, and no refusal: its packages were checked at inspect (9c).
fn boot_record(id: &str, manifest: &Json) -> Json {
    let empty = Json::Obj(Vec::new());
    let ui = manifest.get_present("ui");
    let surfaces = ui
        .and_then(|ui| ui.get_present("surfaces"))
        .unwrap_or(&empty);
    let rail = surfaces.get_present("rail");
    let documents = ui.and_then(|ui| ui.get("documents")).is_some();
    let plugin = manifest.get_present("plugin");
    let app = manifest.get_present("app");
    let title = rail
        .and_then(|rail| rail.get_present("label"))
        .or_else(|| plugin.and_then(|plugin| plugin.get_present("title")))
        .cloned()
        .unwrap_or_else(|| Json::str(id));
    let gate = app.and_then(|app| app.get("requires_experiment"));
    let graduated = |gate: &str| match ui.and_then(|ui| ui.get_present("experiments")) {
        Some(Json::Arr(experiments)) => experiments.iter().any(|experiment| {
            template(plugin.and_then(|plugin| plugin.get("id")))
                .zip(template(experiment.get("id")))
                .is_some_and(|(plugin, experiment)| format!("{plugin}.{experiment}") == gate)
                && experiment.get("stage").and_then(Json::as_str) == Some("graduated")
        }),
        _ => false,
    };
    let gated = matches!(gate, Some(Json::Str(gate)) if !graduated(gate));
    let mut record = vec![
        ("title".to_owned(), title),
        (
            "kind".to_owned(),
            plugin
                .and_then(|plugin| plugin.get_present("kind"))
                .cloned()
                .unwrap_or_else(|| Json::str("native")),
        ),
        (
            "icon".to_owned(),
            rail.and_then(|rail| rail.get_present("icon"))
                .cloned()
                .unwrap_or_else(|| Json::str(DEFAULT_ICON)),
        ),
        (
            "order".to_owned(),
            rail.and_then(|rail| rail.get_present("order"))
                .cloned()
                .unwrap_or(Json::Int(DEFAULT_ORDER)),
        ),
        (
            "scope_levels".to_owned(),
            app.and_then(|app| app.get_present("scope_levels"))
                .cloned()
                .unwrap_or_else(|| Json::Arr(vec![Json::str("workspace")])),
        ),
        (
            "rail".to_owned(),
            Json::Bool(
                !(documents
                    && !truthy(rail)
                    && !truthy(surfaces.get("sidebar"))
                    && !truthy(surfaces.get("main"))),
            ),
        ),
    ];
    if gated {
        record.push(("gated".to_owned(), Json::Bool(true)));
    }
    record.push((
        "parts".to_owned(),
        Json::Arr(
            PARTS
                .iter()
                .filter(|part| surfaces.get(part).is_some())
                .map(|part| Json::str(part))
                .collect(),
        ),
    ));
    record.push((
        "layout".to_owned(),
        ui.and_then(|ui| ui.get_present("layout"))
            .cloned()
            .unwrap_or(empty),
    ));
    record.push(("refusal".to_owned(), Json::Null));
    Json::Obj(record)
}

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Anthropic => "anthropic",
        Kind::Openai => "openai",
        Kind::OpenaiCompatible => "openai-compatible",
    }
}

/// `models.json`'s record of a provider: its kind, model, endpoint without a trailing `/`, and key reference.
fn model_access(provider: &Provider) -> Result<Json, &'static str> {
    let mut record = vec![
        ("id".to_owned(), Json::str(&provider.id)),
        ("kind".to_owned(), Json::str(kind_name(provider.kind))),
        ("model".to_owned(), Json::str(&provider.model)),
    ];
    if let Some(endpoint) = &provider.endpoint {
        record.push((
            "endpoint".to_owned(),
            Json::str(endpoint.trim_end_matches('/')),
        ));
    }
    match &provider.key {
        None => {}
        Some(KeyRef::Keychain(entry)) => record.push((
            "key".to_owned(),
            Json::obj([
                ("keychain", Json::str(&entry.keychain)),
                ("account", Json::str(&entry.account)),
            ]),
        )),
        Some(KeyRef::File(file)) => record.push((
            "key".to_owned(),
            Json::obj([("file", Json::str(file.file.to_str().ok_or(INVALID)?))]),
        )),
    }
    Ok(Json::Obj(record))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// One app as the state and its bundle make it.
struct Built {
    order: (String, String),
    entry: Vec<(String, Json)>,
    boot: Json,
    /// A view app, or a mounted instance with `views = true`: either needs the sandbox origin in `frame-src`.
    framed: bool,
    mount: Option<Json>,
    package: Package,
}

/// Validates that a D166 model key file path is `<data>/keys/<id>.key` or `<data>/keys/<id>.<8-hex>.key`.
pub(crate) fn is_valid_model_key_file(data: &Path, id: &str, path: &Path) -> bool {
    if path.parent() != Some(data.join("keys").as_path()) {
        return false;
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name == format!("{id}.key") {
        return true;
    }
    let prefix = format!("{id}.");
    name.strip_prefix(&prefix)
        .and_then(|rest| rest.strip_suffix(".key"))
        .is_some_and(|hex| {
            hex.len() == 8 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        })
}

/// Owner-only D166 per-token fallback file `<data>/keys/mount-<instance>.<tokenId>.key` so a crash
/// between overwriting `mounts.json` and committing `desktop-state.json` during rotation or
/// upgrade never loses the previously committed bearer token.
pub(crate) fn mount_fallback_key_path(data: &Path, instance: &str, token_id: &str) -> PathBuf {
    data.join("keys")
        .join(format!("mount-{instance}.{token_id}.key"))
}

pub(crate) fn write_mount_fallback_key(
    data: &Path,
    instance: &str,
    token_id: &str,
    bearer: &str,
) -> Result<(), &'static str> {
    crate::connection::ensure_dir_owner_only(&data.join("keys")).map_err(|_| FAILED)?;
    write_owner_only(
        &mount_fallback_key_path(data, instance, token_id),
        bearer.as_bytes(),
    )
    .map_err(unwritten)
}

pub(crate) fn read_mount_fallback_key(
    data: &Path,
    instance: &str,
    token_id: &str,
) -> Option<String> {
    let bytes = read_owner_only(
        &mount_fallback_key_path(data, instance, token_id),
        16 * 1024,
    )
    .ok()?;
    let text = String::from_utf8(bytes).ok()?;
    let trimmed = text.trim_end_matches(['\r', '\n']);
    if crate::models::key_shaped(trimmed) {
        Some(trimmed.to_owned())
    } else {
        None
    }
}

pub(crate) fn delete_mount_fallback_key(data: &Path, instance: &str, token_id: &str) {
    let _ = std::fs::remove_file(mount_fallback_key_path(data, instance, token_id));
}

/// Reads any existing owner-only `mounts.json` plaintext bearers keyed by instance id so
/// D166 Linux file-fallback bearers survive reconciliation and unrelated plugin commits without
/// ever storing secrets in `desktop-state.json`.
pub(crate) fn read_existing_fallback_bearers(data: &Path) -> HashMap<String, String> {
    let Ok(bytes) = read_owner_only(&data.join("mounts.json"), 1024 * 1024) else {
        return HashMap::new();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    if let Some(mounts) = value.get("mounts").and_then(|v| v.as_array()) {
        for entry in mounts {
            if let (Some(instance), Some(bearer)) = (
                entry.get("instance").and_then(|v| v.as_str()),
                entry.get("bearer").and_then(|v| v.as_str()),
            ) {
                map.insert(instance.to_owned(), bearer.to_owned());
            }
        }
    }
    map
}

/// Loads D166 Linux file-fallback bearers by reading `mounts.json` first and then overlaying
/// per-token owner-only key files (`<data>/keys/mount-<instance>.<tokenId>.key`) for every
/// `file_fallback` engine in `state.plugins`. Because the per-token file wins over `mounts.json`,
/// rollback or crash recovery never lets a revoked bearer in `mounts.json` shadow the committed
/// token's bearer.
fn load_fallback_bearers(data: &Path, state: &DesktopState) -> HashMap<String, String> {
    let mut map = read_existing_fallback_bearers(data);
    for plugin in &state.plugins {
        if let Some(eng) = &plugin.engine
            && eng.file_fallback
            && let Some(tid) = &eng.token_id
            && let Ok(bytes) = std::fs::read(
                data.join("plugins")
                    .join(&plugin.id)
                    .join(&plugin.bundle_sha256)
                    .join("plugin-manifest.json"),
            )
            && let Some((manifest, _)) = crate::plugin_manifest::read(&bytes)
            && let Some(em) = manifest.engine
            && let Some(tok) = read_mount_fallback_key(data, &em.mount_app, tid)
        {
            map.insert(em.mount_app, tok);
        }
    }
    map
}

/// Like [`project_with_fallbacks`], reading D166 Linux file-fallback bearers from per-token
/// owner-only key files (`<data>/keys/mount-<instance>.<tokenId>.key`) with `mounts.json` fallback.
pub fn project(
    data: &Path,
    state: &DesktopState,
    profile: &Profile,
) -> Result<Materialized, &'static str> {
    let existing = load_fallback_bearers(data, state);
    project_with_fallbacks(data, state, profile, &existing)
}

/// Like [`project`], with explicit D166 Linux file-fallback bearers keyed by mounted instance id.
pub fn project_with_fallbacks(
    data: &Path,
    state: &DesktopState,
    profile: &Profile,
    fallback_bearers: &HashMap<String, String>,
) -> Result<Materialized, &'static str> {
    if !state.valid() {
        return Err(INVALID);
    }
    // A key kept in a file is D166's fallback, `<app data>/keys/<id>.key` (or `<id>.<8-hex>.key`
    // during an atomic destination+key switch), and nowhere else: never inside a package the site
    // copies, nor the site the swap replaces.
    let keys_valid = state
        .copilot
        .iter()
        .flat_map(|copilot| &copilot.providers)
        .all(|provider| match &provider.key {
            Some(KeyRef::File(key)) => is_valid_model_key_file(data, &provider.id, &key.file),
            _ => true,
        });
    if !keys_valid {
        return Err(INVALID);
    }
    let mut built: Vec<Built> = Vec::new();
    let mut instances = HashSet::new();
    let mut domains = HashSet::new();
    for plugin in &state.plugins {
        let root = directory_under(data, ["plugins", &plugin.id, &plugin.bundle_sha256])?;
        let bytes = read_regular(&root.join("plugin-manifest.json"), MANIFEST_MAX)?;
        let (manifest, ordered) = plugin_manifest::read(&bytes).ok_or(INVALID)?;
        if manifest.plugin.id != plugin.id {
            return Err(INVALID);
        }
        // An engine record exactly when the manifest has an engine, and a token exactly when it authenticates.
        let engine = match (&manifest.engine, &plugin.engine) {
            (None, None) => None,
            (Some(engine), Some(record))
                if record.token_id.is_some() == (engine.auth.mode != AuthMode::None)
                    && manifest.apps.iter().any(|app| app.id == engine.mount_app) =>
            {
                Some((engine, record))
            }
            _ => return Err(INVALID),
        };
        // The policy as the manifest wrote it, so `expose` and `commands` keep its key order.
        let policy = ordered.get("engine").and_then(|engine| engine.get("mount"));
        for app in &manifest.apps {
            if !instances.insert(app.id.clone()) || RESERVED_INSTANCES.contains(&app.id.as_str()) {
                return Err(INVALID);
            }
            let directory = directory_under(&root, app.path.split('/'))?;
            let app_manifest = Json::parse(&read_regular(
                &directory.join("app-manifest.json"),
                APP_MANIFEST_MAX,
            )?)
            .ok_or(INVALID)?;
            let info = app_manifest.get("plugin").ok_or(INVALID)?;
            let name = info.get("id").and_then(Json::as_str).ok_or(INVALID)?;
            let kind = info.get("kind").and_then(Json::as_str).ok_or(INVALID)?;
            let mounted = match kind {
                "native" | "view" if name == app.id => false,
                "mounted" => true,
                _ => return Err(INVALID),
            };
            // The engine mounts exactly one app, and a mounted app is the engine's (4.4, rule 5).
            let mount_engine = engine.filter(|(engine, _)| engine.mount_app == app.id);
            if mounted != mount_engine.is_some() || (!mounted && !domains.insert(app.id.clone())) {
                return Err(INVALID);
            }
            let mut entry = vec![
                ("instance".to_owned(), Json::str(&app.id)),
                ("app".to_owned(), Json::str(name)),
                ("package".to_owned(), Json::Str(format!("apps/{}/", app.id))),
            ];
            let mut mount = None;
            let mut views = false;
            if let Some((engine, record)) = mount_engine {
                let declared = app_manifest.get("mount").ok_or(INVALID)?;
                let prefix = declared
                    .get("prefix")
                    .and_then(Json::as_str)
                    .ok_or(INVALID)?;
                // The prefix is one of the app's own domains (4.4, rule 5), and each instance has its own domain.
                let listed = matches!(info.get("domains"), Some(Json::Arr(domains))
                    if domains.iter().any(|domain| domain.as_str() == Some(prefix)));
                if declared.get("transport").and_then(Json::as_str) != Some("http")
                    || !listed
                    || !domains.insert(prefix.to_owned())
                {
                    return Err(INVALID);
                }
                entry.extend([
                    ("prefix".to_owned(), Json::str(prefix)),
                    ("audience".to_owned(), Json::str("person")),
                    ("transport".to_owned(), Json::str("http")),
                    (
                        "route".to_owned(),
                        Json::Str(format!("mounts/{}/mcp", app.id)),
                    ),
                ]);
                let typed = engine.mount.as_ref();
                if let Some(labels) = typed.and_then(|mount| mount.labels) {
                    entry.push(("labels".to_owned(), Json::str(labels.as_str())));
                }
                if let Some(approvals) = typed.and_then(|mount| mount.approvals) {
                    entry.push(("approvals".to_owned(), Json::str(approvals.as_str())));
                }
                // The opt-in that lets `shell-open` render the instance's `ui://` views (phase 5 specification, 9.3;
                // D169), written only when it is `true`, as `deployment.ts` writes it.
                views = typed.and_then(|mount| mount.views) == Some(true);
                if views {
                    entry.push(("views".to_owned(), Json::Bool(true)));
                }
                for key in ["expose", "commands"] {
                    if let Some(value) = policy.and_then(|policy| policy.get_present(key)) {
                        entry.push((key.to_owned(), value.clone()));
                    }
                }
                let mut access = vec![
                    ("instance".to_owned(), Json::str(&app.id)),
                    (
                        "url".to_owned(),
                        Json::Str(format!("http://127.0.0.1:{}/mcp", record.port)),
                    ),
                ];
                if let (Some(token), Some(proof)) = (&record.token_id, &record.proof_key) {
                    if record.file_fallback {
                        let bearer = fallback_bearers
                            .get(&app.id)
                            .cloned()
                            .or_else(|| read_mount_fallback_key(data, &app.id, token))
                            .ok_or(INVALID)?;
                        access.push(("bearer".to_owned(), Json::Str(bearer)));
                    } else {
                        access.push((
                            "bearer_keychain".to_owned(),
                            Json::obj([
                                ("keychain", Json::str(profile.mount_keychain)),
                                ("account", Json::Str(format!("{}.{token}", app.id))),
                            ]),
                        ));
                    }
                    access.push(("proof_key".to_owned(), Json::str(proof)));
                }
                mount = Some(Json::Obj(access));
            }
            built.push(Built {
                order: (plugin.id.clone(), app.id.clone()),
                entry,
                boot: boot_record(&app.id, &app_manifest),
                framed: kind == "view" || views,
                mount,
                package: Package {
                    instance: app.id.clone(),
                    files: package_files(&directory)?,
                    root: directory,
                },
            });
        }
    }
    built.sort_by(|a, b| a.order.cmp(&b.order));

    let workspace = Json::obj([
        ("id", Json::str(&state.workspace.id)),
        ("name", Json::str(&state.workspace.name)),
    ]);
    let host = Json::obj([("kind", Json::str("desktop"))]);
    // Each provider's id, kind and model, never its key or endpoint (phase 5 specification, 4.1).
    let copilot = state.copilot.as_ref().map(|copilot| {
        let default = copilot
            .default
            .clone()
            .unwrap_or_else(|| copilot.providers[0].id.clone());
        Json::obj([
            ("default", Json::Str(default)),
            (
                "providers",
                Json::Arr(
                    copilot
                        .providers
                        .iter()
                        .map(|provider| {
                            Json::obj([
                                ("id", Json::str(&provider.id)),
                                ("kind", Json::str(kind_name(provider.kind))),
                                ("model", Json::str(&provider.model)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ])
    });
    // `generationOf`: the digest of `{ workspace, apps, host, copilot }` with each `boot` left out.
    let mut digested = vec![
        ("workspace".to_owned(), workspace.clone()),
        (
            "apps".to_owned(),
            Json::Arr(
                built
                    .iter()
                    .map(|app| Json::Obj(app.entry.clone()))
                    .collect(),
            ),
        ),
        ("host".to_owned(), host.clone()),
    ];
    if let Some(copilot) = &copilot {
        digested.push(("copilot".to_owned(), copilot.clone()));
    }
    let digest = Sha256::digest(js_json::canonical(&Json::Obj(digested)).as_bytes());
    let generation = format!("sha256-{}", hex(&digest));

    let mut projection = vec![
        ("deployment_version".to_owned(), Json::Int(4)),
        ("generation".to_owned(), Json::str(&generation)),
        ("workspace".to_owned(), workspace),
        (
            "sandbox_origin".to_owned(),
            Json::str(profile.sandbox_origin),
        ),
        (
            "identity".to_owned(),
            Json::obj([("mode", Json::str("local"))]),
        ),
        ("host".to_owned(), host),
    ];
    if let Some(copilot) = &copilot {
        projection.push(("copilot".to_owned(), copilot.clone()));
    }
    projection.push((
        "apps".to_owned(),
        Json::Arr(
            built
                .iter()
                .map(|app| {
                    let mut entry = app.entry.clone();
                    entry.push(("boot".to_owned(), app.boot.clone()));
                    Json::Obj(entry)
                })
                .collect(),
        ),
    ));

    let providers = state
        .copilot
        .iter()
        .flat_map(|copilot| &copilot.providers)
        .map(model_access)
        .collect::<Result<Vec<_>, _>>()?;
    let models = Json::obj([("providers", Json::Arr(providers))]);
    let mounts = Json::obj([
        (
            "mounts",
            Json::Arr(built.iter().filter_map(|app| app.mount.clone()).collect()),
        ),
        ("inbound", Json::Bool(state.inbound)),
    ]);
    let frame_src = if built.iter().any(|app| app.framed) || copilot.is_some() {
        profile.sandbox_origin.to_owned()
    } else {
        "'none'".to_owned()
    };
    let mut plugin_digests: Vec<(&str, &str)> = state
        .plugins
        .iter()
        .map(|plugin| (plugin.id.as_str(), plugin.bundle_sha256.as_str()))
        .collect();
    plugin_digests.sort_unstable();
    let mut bundles_marker = String::new();
    for (id, sha) in plugin_digests {
        bundles_marker.push_str(id);
        bundles_marker.push(' ');
        bundles_marker.push_str(sha);
        bundles_marker.push('\n');
    }
    Ok(Materialized {
        generation,
        deployment: js_json::pretty(&Json::Obj(projection)),
        models: js_json::pretty(&models),
        mounts: js_json::pretty(&mounts),
        frame_src,
        bundles_marker,
        packages: built.into_iter().map(|app| app.package).collect(),
    })
}

/// [`PERMISSIONS`] only when the owner-only rule did not hold; any other failure is the retryable [`FAILED`].
fn unwritten(why: Unwritten) -> &'static str {
    match why {
        Unwritten::NotOwnerOnly => PERMISSIONS,
        Unwritten::Io => FAILED,
    }
}

fn remove_tree(path: &Path) -> std::io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// The site, staged whole beside the live one: `deployment.json`, each package under `apps/<instance>/`, and the
/// markers of the shell build and the generation it was written for.
fn stage(staging: &Path, built: &Materialized, shell_build: &str) -> std::io::Result<()> {
    remove_tree(staging)?;
    std::fs::create_dir_all(staging)?;
    write_synced(
        &staging.join("deployment.json"),
        built.deployment.as_bytes(),
    )?;
    for package in &built.packages {
        let target = staging.join("apps").join(&package.instance);
        for file in &package.files {
            let to = under(&target, file);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // Copied from the handle that was checked, so a file swapped for a link since listing is refused. A folder
            // on its path swapped for one is not: only a program running as the person can do that, and it can
            // already write the bundle (12's honest limits).
            let mut from = open_regular(&under(&package.root, file))?;
            let mut copy = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&to)?;
            std::io::copy(&mut from, &mut copy)?;
            copy.sync_all()?;
        }
    }
    write_synced(
        &staging.join(".loam-shell-build"),
        format!("{shell_build}\n").as_bytes(),
    )?;
    write_synced(
        &staging.join(".loam-generation"),
        format!("{}\n", built.generation).as_bytes(),
    )?;
    write_synced(
        &staging.join(".loam-bundles"),
        built.bundles_marker.as_bytes(),
    )?;
    sync_tree(staging)
}

/// A new file, written and flushed to the disk before the site that holds it is swapped in.
fn write_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Every directory of the staged site flushed where the volume allows it, so the names in it survive a power loss once it is swapped in.
fn sync_tree(root: &Path) -> std::io::Result<()> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                pending.push(entry.path());
            }
        }
        // Best effort, as `write_owner_only`'s own: some volumes refuse a folder's `fsync`.
        let _ = sync_directory(&directory);
    }
    Ok(())
}

/// Stages `built` into `<data>/.site-staging` and atomically swaps it into `<data>/site/`.
fn swap_site(data: &Path, built: &Materialized, shell_build: &str) -> Result<(), &'static str> {
    // Fixed names, since commits and reconciliation run under `desktop-state.lock`: what a crash left is swept.
    let staging = data.join(".site-staging");
    let backup = data.join(".site-backup");
    let site = data.join("site");
    if stage(&staging, built, shell_build).is_err() || remove_tree(&backup).is_err() {
        let _ = remove_tree(&staging);
        return Err(FAILED);
    }
    let had_site = std::fs::symlink_metadata(&site).is_ok();
    if had_site && std::fs::rename(&site, &backup).is_err() {
        let _ = remove_tree(&staging);
        return Err(FAILED);
    }
    if std::fs::rename(&staging, &site).is_err() {
        if had_site {
            let _ = std::fs::rename(&backup, &site);
        }
        let _ = remove_tree(&staging);
        return Err(FAILED);
    }
    let _ = remove_tree(&backup);
    // Best effort, as `write_owner_only`'s own: some volumes refuse a folder's `fsync`.
    let _ = sync_directory(data);
    Ok(())
}

/// Checks whether `<data>/site/` matches `built` and `shell_build` with no missing/stale artifacts
/// and no planted shell files (`index.html`, `404.html`, `assets`, `sandbox`).
fn site_needs_reconcile(data: &Path, built: &Materialized, shell_build: &str) -> bool {
    let site = data.join("site");
    if !std::fs::symlink_metadata(&site).is_ok_and(|meta| meta.is_dir()) {
        return true;
    }
    let expected_build = format!("{shell_build}\n");
    if read_regular(&site.join(".loam-shell-build"), 1024)
        .ok()
        .as_deref()
        != Some(expected_build.as_bytes())
    {
        return true;
    }
    let expected_generation = format!("{}\n", built.generation);
    if read_regular(&site.join(".loam-generation"), 1024)
        .ok()
        .as_deref()
        != Some(expected_generation.as_bytes())
    {
        return true;
    }
    if read_regular(&site.join(".loam-bundles"), 1024 * 1024)
        .ok()
        .as_deref()
        != Some(built.bundles_marker.as_bytes())
    {
        return true;
    }
    if read_regular(&site.join("deployment.json"), 16 * 1024 * 1024)
        .ok()
        .as_deref()
        != Some(built.deployment.as_bytes())
    {
        return true;
    }
    for planted in ["index.html", "404.html", "assets", "sandbox"] {
        if std::fs::symlink_metadata(site.join(planted)).is_ok() {
            return true;
        }
    }
    let apps_dir = site.join("apps");
    if built.packages.is_empty() {
        if std::fs::symlink_metadata(&apps_dir).is_ok() {
            return true;
        }
        return false;
    }
    if !std::fs::symlink_metadata(&apps_dir).is_ok_and(|meta| meta.is_dir()) {
        return true;
    }
    let expected_instances: HashSet<&str> = built
        .packages
        .iter()
        .map(|package| package.instance.as_str())
        .collect();
    let Ok(entries) = std::fs::read_dir(&apps_dir) else {
        return true;
    };
    let mut found_instances = HashSet::new();
    for entry in entries {
        let Ok(entry) = entry else {
            return true;
        };
        let Ok(name) = entry.file_name().into_string() else {
            return true;
        };
        if !entry.file_type().is_ok_and(|kind| kind.is_dir())
            || !expected_instances.contains(name.as_str())
        {
            return true;
        }
        found_instances.insert(name);
    }
    if found_instances.len() != expected_instances.len() {
        return true;
    }
    for package in &built.packages {
        let target = apps_dir.join(&package.instance);
        for file in &package.files {
            if !std::fs::symlink_metadata(under(&target, file)).is_ok_and(|meta| meta.is_file()) {
                return true;
            }
        }
    }
    false
}

/// Checks whether a private owner-only file (`mounts.json`, `models.json`) is missing, has
/// non-owner-only permissions, or differs from `expected`.
fn private_file_needs_reconcile(path: &Path, expected: &[u8]) -> bool {
    let max = expected.len().max(1024 * 1024);
    read_owner_only(path, max).ok().as_deref() != Some(expected)
}

/// Reconciles `<data>/site/`, `mounts.json`, and `models.json` against committed `state` whenever
/// any generated artifact is missing, has wrong permissions, lags `state`'s generation/content, or
/// `shell_build` changed on app upgrade (amendment 9.1 & 9.2). Must run under `desktop-state.lock`.
/// Does not rewrite `desktop-state.json`. Returns `(materialized, rewrote_any)`.
pub fn reconcile(
    data: &Path,
    state: &DesktopState,
    profile: &Profile,
    shell_build: &str,
) -> Result<(Materialized, bool), &'static str> {
    let built = project(data, state, profile)?;
    let mut rewrote = false;
    if site_needs_reconcile(data, &built, shell_build) {
        swap_site(data, &built, shell_build)?;
        rewrote = true;
    }
    for (name, bytes) in [
        ("mounts.json", built.mounts.as_bytes()),
        ("models.json", built.models.as_bytes()),
    ] {
        let path = data.join(name);
        if private_file_needs_reconcile(&path, bytes) {
            write_owner_only(&path, bytes).map_err(unwritten)?;
            rewrote = true;
        }
    }
    Ok((built, rewrote))
}

/// Materializes `state` into `data` and commits it (9.2, steps 1 to 4): the site staged whole and swapped into
/// `site/`, then `mounts.json` and `models.json` written owner-only, then `desktop-state.json` last, the durable
/// commit point. A failure before the swap leaves every file as it was; a failure after it leaves the state
/// uncommitted, so startup reconciles the files from the state still committed. Only for `managed` mode, under
/// `desktop-state.lock`: it replaces `site/` whole.
pub fn commit(
    data: &Path,
    state: &DesktopState,
    profile: &Profile,
    shell_build: &str,
) -> Result<Materialized, &'static str> {
    commit_with_fallbacks(data, state, profile, shell_build, &HashMap::new())
}

/// Like [`commit`], supplying explicit D166 Linux file-fallback bearers (merged over per-token
/// owner-only key files and any existing `mounts.json` bearers for other installed plugins).
pub fn commit_with_fallbacks(
    data: &Path,
    state: &DesktopState,
    profile: &Profile,
    shell_build: &str,
    fallback_overrides: &HashMap<String, String>,
) -> Result<Materialized, &'static str> {
    let mut fallbacks = load_fallback_bearers(data, state);
    for (k, v) in fallback_overrides {
        fallbacks.insert(k.clone(), v.clone());
    }
    let built = project_with_fallbacks(data, state, profile, &fallbacks)?;
    // Refused now, not at the next start: a state its own reader would refuse is never committed.
    let state_bytes = desktop_state::bytes(state);
    if state_bytes.len() > desktop_state::FILE_MAX {
        return Err(INVALID);
    }
    swap_site(data, &built, shell_build)?;
    for (name, bytes) in [
        ("mounts.json", built.mounts.as_bytes()),
        ("models.json", built.models.as_bytes()),
    ] {
        write_owner_only(&data.join(name), bytes).map_err(unwritten)?;
    }
    write_owner_only(&data.join(desktop_state::FILE), &state_bytes).map_err(unwritten)?;
    Ok(built)
}

#[cfg(test)]
#[path = "materialize_tests.rs"]
mod tests;
