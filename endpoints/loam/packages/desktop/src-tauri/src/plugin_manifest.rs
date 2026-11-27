//! An installed plugin's `plugin-manifest.json` (`loam-plugin.v1.json`; phase 5 no-terminal amendment, 4.2), read
//! by the headless materializer (9.2) from `<app data>/plugins/<id>/<bundleSha256>/`. The shape is the schema's,
//! closed at every depth, and the file is read twice: typed, so the shape is checked, and as [`Json`], so the mount
//! policy the projection repeats keeps the manifest's key order, as the CLI's does.
//!
//! This is the shape alone. The rules beyond it (4.4) are checked on staged bytes when a bundle is inspected (9c),
//! before anything is installed; the materializer checks only what it builds on.
use crate::js_json::Json;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    pub plugin_manifest_version: u32,
    pub plugin: PluginInfo,
    pub apps: Vec<AppRef>,
    pub engine: Option<Engine>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct PluginInfo {
    pub id: String,
    pub title: String,
    pub version: String,
    pub description: String,
    pub license: Option<String>,
    pub homepage: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct AppRef {
    pub id: String,
    pub path: String,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Engine {
    pub id: String,
    pub kind: EngineKind,
    pub mount_app: String,
    pub service_mode: ServiceMode,
    pub artifacts: BTreeMap<Target, Artifact>,
    pub auth: Auth,
    pub mount: Option<Mount>,
}

#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EngineKind {
    HttpService,
}

#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceMode {
    Login,
}

#[derive(Deserialize, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Target {
    #[serde(rename = "darwin-arm64")]
    DarwinArm64,
    #[serde(rename = "darwin-x64")]
    DarwinX64,
    #[serde(rename = "windows-x64")]
    WindowsX64,
    #[serde(rename = "windows-arm64")]
    WindowsArm64,
    #[serde(rename = "linux-x64")]
    LinuxX64,
    #[serde(rename = "linux-arm64")]
    LinuxArm64,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    pub path: String,
    pub sha256: String,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Auth {
    pub mode: AuthMode,
}

#[derive(Deserialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum AuthMode {
    Approver,
    Agent,
    None,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Mount {
    pub audience: Option<Audience>,
    pub labels: Option<Labels>,
    pub approvals: Option<Approvals>,
    pub expose: Option<MountExpose>,
    pub commands: Option<BTreeMap<String, CommandOverride>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Audience {
    Person,
}

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum Labels {
    Whole,
    PerPart,
}

impl Labels {
    pub fn as_str(self) -> &'static str {
        match self {
            Labels::Whole => "whole",
            Labels::PerPart => "per-part",
        }
    }
}

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum Approvals {
    None,
    Shell,
}

impl Approvals {
    pub fn as_str(self) -> &'static str {
        match self {
            Approvals::None => "none",
            Approvals::Shell => "shell",
        }
    }
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct MountExpose {
    pub agent: Option<bool>,
    pub palette: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct CommandOverride {
    pub expose: Option<CommandExpose>,
    pub effects: Option<Vec<Effect>>,
    pub destructive: Option<bool>,
    pub preview: Option<Preview>,
}

/// What a command may change (`plugin-manifest.core.v1.json`'s `effects`).
#[derive(Deserialize, Debug, PartialEq, Eq, Hash, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum Effect {
    Inspect,
    PluginState,
    External,
    StoreWrite,
    WorkspaceWrite,
}

/// The core schema's `effects` rules: at least one, none twice, and `inspect` alone.
fn effects_valid(effects: &[Effect]) -> bool {
    let unique: std::collections::HashSet<_> = effects.iter().collect();
    !effects.is_empty()
        && unique.len() == effects.len()
        && (!effects.contains(&Effect::Inspect) || effects.len() == 1)
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct CommandExpose {
    pub agent: Option<bool>,
    pub palette: Option<bool>,
    pub apps: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    pub command: String,
    pub input: Vec<String>,
}

/// `^[a-z][a-z0-9-]{0,31}$`: a plugin's or an engine's id.
pub fn plugin_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && value.len() <= 32
        && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

/// `^[a-z][a-z0-9]{0,31}$`: an app's id, its default instance id.
pub fn app_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && value.len() <= 32
        && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9'))
}

/// A bundle path the materializer may join to the bundle's directory: `/`-separated normal segments only, never
/// empty, `.`, `..`, absolute, or holding a backslash, a colon or a NUL (4.4's rule 3 is wider, at inspect). At most
/// 512 characters, as the schema's `maxLength` counts them.
pub fn bundle_path(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 512
        && !value.contains(['\\', ':', '\0'])
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$`: AFD's domain-action command name, at least two segments.
fn command_name(value: &str) -> bool {
    let segments: Vec<&str> = value.split('-').collect();
    segments.len() >= 2
        && segments.iter().all(|segment| {
            let mut bytes = segment.bytes();
            matches!(bytes.next(), Some(b'a'..=b'z'))
                && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9'))
        })
}

fn holds_null(value: &Json) -> bool {
    match value {
        Json::Null => true,
        Json::Arr(items) => items.iter().any(holds_null),
        Json::Obj(entries) => entries.iter().any(|(_, item)| holds_null(item)),
        _ => false,
    }
}

/// `^[A-Za-z_][A-Za-z0-9_]{0,63}$`: a preview's input field.
fn input_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(byte) if byte.is_ascii_alphabetic() || byte == b'_')
        && value.len() <= 64
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// The manifest, typed and as read, or `None` when it is not version 1's shape or names an id or path the
/// materializer cannot build on.
pub fn read(bytes: &[u8]) -> Option<(PluginManifest, Json)> {
    let ordered = Json::parse(bytes)?;
    // The schema has no `null` anywhere; an `Option` field would read one as absent.
    if holds_null(&ordered) {
        return None;
    }
    let manifest: PluginManifest = serde_json::from_slice(bytes).ok()?;
    let apps_valid = (1..=8).contains(&manifest.apps.len())
        && manifest
            .apps
            .iter()
            .all(|app| app_id(&app.id) && bundle_path(&app.path));
    // The policy the projection repeats is closed here as the schema closes it, so nothing else reaches
    // `deployment.json`: each command override's `effects` and `preview` as well as its shape.
    let commands_valid = |commands: &BTreeMap<String, CommandOverride>| {
        commands.len() <= 256
            && commands.iter().all(|(name, command)| {
                command_name(name)
                    && command.effects.as_deref().is_none_or(effects_valid)
                    && command.preview.as_ref().is_none_or(|preview| {
                        command_name(&preview.command) && {
                            let unique: std::collections::HashSet<_> =
                                preview.input.iter().collect();
                            (1..=16).contains(&preview.input.len())
                                && unique.len() == preview.input.len()
                                && preview.input.iter().all(|input| input_name(input))
                        }
                    })
            })
    };
    let engine_valid = manifest.engine.as_ref().is_none_or(|engine| {
        plugin_id(&engine.id)
            && !engine.artifacts.is_empty()
            && engine
                .mount
                .as_ref()
                .and_then(|mount| mount.commands.as_ref())
                .is_none_or(commands_valid)
    });
    (manifest.plugin_manifest_version == 1
        && plugin_id(&manifest.plugin.id)
        && apps_valid
        && engine_valid)
        .then_some((manifest, ordered))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL: &str = r#"{"plugin_manifest_version":1,"plugin":{"id":"board","title":"Board","version":"0.1.0","description":"A board."},"apps":[{"id":"board","path":"apps/board"}]}"#;

    #[test]
    fn reads_the_schema_shape_and_nothing_else() {
        let (manifest, ordered) = read(MINIMAL.as_bytes()).unwrap();
        assert_eq!(manifest.plugin.id, "board");
        assert!(manifest.engine.is_none());
        assert_eq!(ordered.get("plugin_manifest_version"), Some(&Json::Int(1)));

        // A key the schema does not name, at any depth, as `loam-plugin.v1.json` refuses one.
        for refused in [
            MINIMAL.replace(r#""apps":["#, r#""command":"x","apps":["#),
            MINIMAL.replace(r#""path":"apps/board""#, r#""path":"apps/board","url":"x""#),
            MINIMAL.replace(
                r#""plugin_manifest_version":1"#,
                r#""plugin_manifest_version":2"#,
            ),
            MINIMAL.replace(r#""id":"board","path""#, r#""id":"Board","path""#),
            MINIMAL.replace("apps/board", "apps/../board"),
            MINIMAL.replace("apps/board", "/apps/board"),
            MINIMAL.replace("apps/board", "apps\\\\board"),
            MINIMAL.replace(r#""title":"Board""#, r#""title":"Board","title":"Again""#),
            ENGINE.replace(r#"["inspect"]"#, r#"{"nested":"anything"}"#),
            ENGINE.replace(r#"["inspect"]"#, "[]"),
            ENGINE.replace(r#"["inspect"]"#, r#"["inspect","external"]"#),
            ENGINE.replace(r#"["inspect"]"#, r#"["external","external"]"#),
            ENGINE.replace(r#"["inspect"]"#, r#"["delete-everything"]"#),
            ENGINE.replace(r#"["draft"]"#, r#"["draft","draft"]"#),
            ENGINE.replace(r#"["draft"]"#, r#"["1draft"]"#),
            ENGINE.replace(r#""mail-draft-send":"#, r#""Mail-Send":"#),
            MINIMAL.replace(
                r#""description":"A board.""#,
                r#""description":"A board.","license":null"#,
            ),
            ENGINE.replace(r#""command":"mail-draft-show""#, r#""command":"show""#),
        ] {
            assert!(read(refused.as_bytes()).is_none(), "{refused}");
        }
    }

    const ENGINE: &str = r#"{"plugin_manifest_version":1,"plugin":{"id":"mail","title":"Mail","version":"0.1.0","description":"Mail."},"apps":[{"id":"mail","path":"apps/mail"}],"engine":{"id":"loam-mail","kind":"http-service","mount_app":"mail","service_mode":"login","artifacts":{"linux-x64":{"path":"engines/linux-x64/loam-mail","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}},"auth":{"mode":"approver"},"mount":{"approvals":"shell","commands":{"mail-draft-show":{"effects":["inspect"]},"mail-draft-send":{"preview":{"command":"mail-draft-show","input":["draft"]}}}}}}"#;

    #[test]
    fn reads_an_engine_and_closes_its_policy() {
        let (manifest, _) = read(ENGINE.as_bytes()).unwrap();
        let commands = manifest.engine.unwrap().mount.unwrap().commands.unwrap();
        assert_eq!(
            commands["mail-draft-show"].effects,
            Some(vec![Effect::Inspect])
        );
    }

    #[test]
    fn ids_and_paths() {
        // The schema's `maxLength` counts characters, as the CLI's reader does: 272 of them in 542 bytes pass.
        let long = format!("apps/{}", "é".repeat(267));
        assert!(long.len() > 512 && bundle_path(&long));
        assert!(!bundle_path(&format!("apps/{}", "é".repeat(508))));
        assert!(
            plugin_id("loam-mail")
                && !plugin_id("Mail")
                && !plugin_id("-mail")
                && !plugin_id(&"a".repeat(33))
        );
        assert!(app_id("mailapp") && !app_id("mail-app") && !app_id("1mail"));
        assert!(
            bundle_path("apps/mail")
                && !bundle_path("apps//mail")
                && !bundle_path("apps/./mail")
                && !bundle_path("c:/x")
        );
    }
}
