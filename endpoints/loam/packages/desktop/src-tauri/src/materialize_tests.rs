//! P5-S9-6's Rust half (phase 5 no-terminal amendment, 9.3; D168): the materializer writes exactly the golden
//! projection's `deployment.json`, `models.json` and `frame-src`, and `mounts.json`'s shared fields, from the shared
//! fixture's input, as `@lushly-dev/loam-cli`'s `desktop-golden.test.ts` holds `loam deployment write` to the same
//! file. Then the staged write and what the materializer refuses.
use super::*;
use crate::desktop_state::{Copilot, EngineState, InstalledPlugin, Workspace};

const TOKEN_ID: &str = "golden-token";

fn proof_key() -> String {
    "ab".repeat(32)
}

fn fixture() -> Json {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../manifest/test/fixtures/desktop-projection-golden.json");
    Json::parse(&std::fs::read(path).expect("the golden fixture"))
        .expect("the golden fixture is JSON")
}

fn text(value: &Json) -> &str {
    value.as_str().expect("a string")
}

fn write(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// A bundle's directory name: any 64 lowercase hex characters, here the digest of the plugin's id.
fn bundle_of(plugin: &str) -> String {
    hex(&Sha256::digest(plugin.as_bytes()))
}

/// The fixture's input as the desktop holds it: each plugin's bundle installed under `data/plugins/`, and the state
/// that names them, with the engine's token slot and proof key.
fn install(data: &Path, golden: &Json) -> DesktopState {
    let Some(Json::Arr(apps)) = golden.get("apps") else {
        panic!("the fixture's apps")
    };
    let mut plugins: Vec<(String, Vec<&Json>)> = Vec::new();
    for app in apps {
        let plugin = text(app.get("plugin").unwrap()).to_owned();
        match plugins.iter_mut().find(|(id, _)| *id == plugin) {
            Some((_, members)) => members.push(app),
            None => plugins.push((plugin, vec![app])),
        }
    }
    let mut installed = Vec::new();
    for (plugin, members) in &plugins {
        let root = data.join("plugins").join(plugin).join(bundle_of(plugin));
        let mut manifest = vec![
            ("plugin_manifest_version".to_owned(), Json::Int(1)),
            (
                "plugin".to_owned(),
                Json::obj([
                    ("id", Json::str(plugin)),
                    ("title", Json::str("A plugin")),
                    ("version", Json::str("0.1.0")),
                    (
                        "description",
                        Json::str("A plugin, for the desktop's golden projection."),
                    ),
                ]),
            ),
        ];
        let mut refs = Vec::new();
        let mut engine = None;
        for app in members {
            let instance = text(app.get("instance").unwrap());
            let app_manifest = app.get("manifest").unwrap();
            write(
                &root.join("apps").join(instance).join("app-manifest.json"),
                js_json::pretty(app_manifest).as_bytes(),
            );
            if app_manifest
                .get("plugin")
                .unwrap()
                .get("kind")
                .and_then(Json::as_str)
                == Some("native")
            {
                write(
                    &root.join("apps").join(instance).join("dist/native.js"),
                    b"export default {};\n",
                );
            }
            refs.push(Json::obj([
                ("id", Json::str(instance)),
                ("path", Json::Str(format!("apps/{instance}"))),
            ]));
            if let Some(mount) = app.get("mount") {
                let auth = text(mount.get("auth").unwrap());
                let artifact = format!("engines/linux-x64/{plugin}-engine");
                write(&root.join(&artifact), b"\x7fELF");
                manifest.push((
                    "engine".to_owned(),
                    Json::obj([
                        ("id", Json::Str(format!("{plugin}-engine"))),
                        ("kind", Json::str("http-service")),
                        ("mount_app", Json::str(instance)),
                        ("service_mode", Json::str("login")),
                        (
                            "artifacts",
                            Json::obj([(
                                "linux-x64",
                                Json::obj([
                                    ("path", Json::Str(artifact)),
                                    ("sha256", Json::Str("0".repeat(64))),
                                ]),
                            )]),
                        ),
                        ("auth", Json::obj([("mode", Json::str(auth))])),
                        (
                            "mount",
                            Json::Obj(
                                [
                                    ("audience", Some(Json::str("person"))),
                                    ("labels", mount.get("labels").cloned()),
                                    ("approvals", mount.get("approvals").cloned()),
                                    // The deployer's opt-in (D169), as the plugin's mount policy states it.
                                    ("views", mount.get("views").cloned()),
                                    ("expose", mount.get("expose").cloned()),
                                    ("commands", mount.get("commands").cloned()),
                                ]
                                .into_iter()
                                .filter_map(|(key, value)| Some((key.to_owned(), value?)))
                                .collect(),
                            ),
                        ),
                    ]),
                ));
                let Some(Json::Int(port)) = mount.get("port") else {
                    panic!("a port")
                };
                engine = Some(EngineState {
                    port: u16::try_from(*port).unwrap(),
                    token_id: (auth != "none").then(|| TOKEN_ID.to_owned()),
                    proof_key: (auth != "none").then(proof_key),
                    file_fallback: false,
                });
            }
        }
        manifest.insert(2, ("apps".to_owned(), Json::Arr(refs)));
        write(
            &root.join("plugin-manifest.json"),
            js_json::pretty(&Json::Obj(manifest)).as_bytes(),
        );
        installed.push(InstalledPlugin {
            id: plugin.clone(),
            bundle_sha256: bundle_of(plugin),
            engine,
        });
    }
    let workspace = golden.get("workspace").unwrap();
    let copilot = golden.get("copilot").unwrap();
    let Some(Json::Bool(inbound)) = golden.get("inbound") else {
        panic!("the inbound switch")
    };
    DesktopState {
        desktop_state_version: 1,
        workspace: Workspace {
            id: text(workspace.get("id").unwrap()).to_owned(),
            name: text(workspace.get("name").unwrap()).to_owned(),
        },
        inbound: *inbound,
        copilot: Some(Copilot {
            default: copilot
                .get("default")
                .map(|default| text(default).to_owned()),
            providers: serde_json::from_str(&js_json::pretty(copilot.get("providers").unwrap()))
                .unwrap(),
        }),
        plugins: installed,
        pending_revocations: Vec::new(),
    }
}

/// The sandbox origin of the platform the fixture was written for (phase 6 specification, 10.2).
fn golden_profile(golden: &Json) -> Profile<'static> {
    Profile {
        sandbox_origin: if text(golden.get("platform").unwrap()) == "win32" {
            "http://loam-sandbox.localhost"
        } else {
            "loam-sandbox://localhost"
        },
        mount_keychain: MOUNT_KEYCHAIN,
    }
}

#[test]
fn p5_s9_6_the_golden_projection_is_what_the_materializer_writes_byte_for_byte() {
    let golden = fixture();
    let expected = golden.get("expected").unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let built = project(data.path(), &state, &golden_profile(&golden)).unwrap();

    assert_eq!(
        built.deployment,
        js_json::pretty(expected.get("deployment").unwrap())
    );
    // And the CLI's own bytes, apart from this crate's printer: Node 26's SHA-256 of
    // `JSON.stringify(expected.deployment, null, '\t') + '\n'`, and of `expected.models` likewise. A fixture change
    // updates these with it.
    assert_eq!(
        hex(&Sha256::digest(built.deployment.as_bytes())),
        "2082e5e16379e6f25f2a02c5a73764522535be9e929da199428d3acc11604166"
    );
    assert_eq!(
        hex(&Sha256::digest(built.models.as_bytes())),
        "5893361da3b227624cb551b689db6b2d1a70264a36d9a5182b5678f175857251"
    );
    assert_eq!(
        built.models,
        js_json::pretty(expected.get("models").unwrap())
    );
    assert_eq!(built.frame_src, text(expected.get("frameSrc").unwrap()));
    assert_eq!(
        Some(&Json::str(&built.generation)),
        expected.get("deployment").unwrap().get("generation")
    );

    // The fields both write; the materializer's credential is a keychain slot and the proof key, never a bearer.
    let mounts = Json::parse(built.mounts.as_bytes()).unwrap();
    let shared = expected.get("mounts").unwrap();
    assert_eq!(mounts.get("inbound"), shared.get("inbound"));
    let (Some(Json::Arr(written)), Some(Json::Arr(wanted))) =
        (mounts.get("mounts"), shared.get("mounts"))
    else {
        panic!("both list mounts")
    };
    assert_eq!(written.len(), wanted.len());
    for (entry, wanted) in written.iter().zip(wanted) {
        assert_eq!(
            &entry.without("bearer_keychain").without("proof_key"),
            wanted
        );
        assert_eq!(entry.get("bearer"), None);
        let instance = text(entry.get("instance").unwrap());
        assert_eq!(
            entry.get("bearer_keychain"),
            Some(&Json::obj([
                ("keychain", Json::str(MOUNT_KEYCHAIN)),
                ("account", Json::Str(format!("{instance}.{TOKEN_ID}"))),
            ]))
        );
        assert_eq!(entry.get("proof_key"), Some(&Json::Str(proof_key())));
    }
}

#[test]
fn p5_s9_6_nothing_of_a_location_or_credential_is_served() {
    let golden = fixture();
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let built = project(data.path(), &state, &golden_profile(&golden)).unwrap();
    // Each failure names the value by its label, never the value itself.
    for (label, secret) in [
        ("the loopback address", "127.0.0.1"),
        ("the engine's port", "17400"),
        ("the word bearer", "bearer"),
        ("the word keychain", "keychain"),
        ("the word proof", "proof"),
        ("the token id", TOKEN_ID),
        ("the proof key", &proof_key()),
    ] {
        assert!(
            !built.deployment.contains(secret),
            "deployment.json holds {label}"
        );
    }
    // Nor is a provider's key reference or endpoint, which only `models.json` holds.
    assert!(!built.deployment.contains("loam-copilot"));
}

#[test]
fn a_bare_desktop_frames_nothing_and_digests_as_the_cli_does() {
    let data = tempfile::tempdir().unwrap();
    let root = data.path().join("plugins/notes").join(bundle_of("notes"));
    write(
        &root.join("plugin-manifest.json"),
        br#"{"plugin_manifest_version":1,"plugin":{"id":"notes","title":"Notes","version":"1.0.0","description":"Notes."},"apps":[{"id":"notes","path":"apps/notes"}]}"#,
    );
    write(
        &root.join("apps/notes/app-manifest.json"),
        br#"{"manifest_version":1,"protocol":1,"plugin":{"title":"Notes","version":"1.0.0","description":"Notes.","id":"notes","kind":"native","domains":["notes"]},"native":{"entry":"dist/native.js"}}"#,
    );
    write(&root.join("apps/notes/dist/native.js"), b"1;");
    let mut state = DesktopState::fresh();
    state.plugins.push(InstalledPlugin {
        id: "notes".into(),
        bundle_sha256: bundle_of("notes"),
        engine: None,
    });
    let built = project(data.path(), &state, &Profile::default_profile()).unwrap();
    assert_eq!(built.frame_src, "'none'");
    assert_eq!(built.models, "{\n\t\"providers\": []\n}\n");
    assert_eq!(
        built.mounts,
        "{\n\t\"mounts\": [],\n\t\"inbound\": true\n}\n"
    );
    // Node 26 with deployment.ts's `canonicalJson`:
    // sha256(canonicalJson({ workspace: { id: 'personal', name: 'Personal' },
    //   apps: [{ instance: 'notes', app: 'notes', package: 'apps/notes/' }], host: { kind: 'desktop' } }))
    assert_eq!(
        built.generation,
        "sha256-9f8e3376661857a156b33a9b6bc4a6c46ed82be16fdda7a8d3c4169965e964df"
    );
    assert!(!built.deployment.contains("\"copilot\""));
}

/// The golden fixture's mounted app alone, its mount's `views` set to `views` (left out for `None`).
fn mounted_only(views: Option<bool>) -> Json {
    let Json::Obj(top) = fixture() else {
        panic!("the fixture is an object")
    };
    Json::Obj(
        top.into_iter()
            .map(|(key, value)| {
                if key != "apps" {
                    return (key, value);
                }
                let Json::Arr(apps) = value else {
                    panic!("the fixture's apps")
                };
                let mail = apps
                    .into_iter()
                    .find(|app| app.get("instance") == Some(&Json::str("mail")))
                    .expect("the mounted app");
                let Json::Obj(entries) = mail else {
                    panic!("an app is an object")
                };
                let entries = entries
                    .into_iter()
                    .map(|(name, item)| {
                        if name != "mount" {
                            return (name, item);
                        }
                        let Json::Obj(mut mount) = item.without("views") else {
                            panic!("a mount is an object")
                        };
                        if let Some(views) = views {
                            mount.push(("views".to_owned(), Json::Bool(views)));
                        }
                        (name, Json::Obj(mount))
                    })
                    .collect();
                (key, Json::Arr(vec![Json::Obj(entries)]))
            })
            .collect(),
    )
}

#[test]
fn a_mounted_instance_that_lets_its_views_render_carries_views_and_frames_the_sandbox() {
    // D169 (phase 5 specification, 9.3): with no view app and no provider, only the mounted instance's opt-in puts
    // the sandbox origin in `frame-src`, as `deployment write` does; without it a managed desktop would refuse every
    // mounted view with `MOUNT_VIEWS_DISABLED`.
    for (views, carried, frame_src) in [
        (Some(true), true, "loam-sandbox://localhost"),
        (Some(false), false, "'none'"),
        (None, false, "'none'"),
    ] {
        let golden = mounted_only(views);
        let data = tempfile::tempdir().unwrap();
        let mut state = install(data.path(), &golden);
        state.copilot = None;
        let built = project(data.path(), &state, &golden_profile(&golden)).unwrap();
        let deployment = Json::parse(built.deployment.as_bytes()).unwrap();
        let Some(Json::Arr(apps)) = deployment.get("apps") else {
            panic!("the projection's apps")
        };
        assert_eq!(apps.len(), 1, "{views:?}");
        // Written only when `true`, after `approvals` and before `expose`, as `projectionOf` orders it.
        let keys: Vec<&str> = match &apps[0] {
            Json::Obj(entries) => entries.iter().map(|(key, _)| key.as_str()).collect(),
            _ => panic!("an app is an object"),
        };
        assert_eq!(
            apps[0].get("views"),
            carried.then_some(&Json::Bool(true)),
            "{views:?}"
        );
        if carried {
            let at = |key: &str| keys.iter().position(|name| *name == key).unwrap();
            assert_eq!(at("views"), at("approvals") + 1, "{keys:?}");
            assert_eq!(at("expose"), at("views") + 1, "{keys:?}");
        }
        assert_eq!(built.frame_src, frame_src, "{views:?}");
        assert!(!built.deployment.contains("\"copilot\""));
    }
}

#[test]
fn boot_records_follow_boot_record_of() {
    let manifest = Json::parse(
        br#"{"plugin":{"id":"docs","title":"Docs","kind":"view"},"app":{"scope_levels":["project"],"requires_experiment":"docs.beta"},
            "ui":{"documents":{},"surfaces":{"inspector":{},"panel":{}},"layout":{"panel":{"open":true,"height":240}},
            "experiments":[{"id":"beta","stage":"trial"}]}}"#,
    )
    .unwrap();
    assert_eq!(
        js_json::pretty(&boot_record("docs", &manifest)),
        js_json::pretty(
            &Json::parse(
                br#"{"title":"Docs","kind":"view","icon":"system/folder","order":100,"scope_levels":["project"],
                    "rail":false,"gated":true,"parts":["inspector","panel"],"layout":{"panel":{"open":true,"height":240}},"refusal":null}"#
            )
            .unwrap()
        )
    );
    // A rail's label, icon and order win; a graduated experiment is not gated; a rail keeps a documents app on it.
    let manifest = Json::parse(
        br#"{"plugin":{"id":"docs","title":"Docs","kind":"native"},"app":{"requires_experiment":"docs.beta"},
            "ui":{"documents":{},"surfaces":{"rail":{"label":"Pages","icon":"system/document","order":7}},
            "experiments":[{"id":"beta","stage":"graduated"}]}}"#,
    )
    .unwrap();
    assert_eq!(
        js_json::pretty(&boot_record("docs", &manifest)),
        js_json::pretty(
            &Json::parse(
                br#"{"title":"Pages","kind":"native","icon":"system/document","order":7,"scope_levels":["workspace"],
                    "rail":true,"parts":[],"layout":{},"refusal":null}"#
            )
            .unwrap()
        )
    );
}

#[test]
fn commit_swaps_the_site_whole_and_writes_the_state_last() {
    let golden = fixture();
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    // A deployer's or an attacker's shell planted in `site/` does not survive: a managed site holds no shell file.
    write(
        &data.path().join("site/index.html"),
        b"<!doctype html>planted",
    );
    write(&data.path().join("site/assets/app.js"), b"planted");

    let built = commit(data.path(), &state, &golden_profile(&golden), "build-1").unwrap();
    let site = data.path().join("site");
    assert_eq!(
        std::fs::read_to_string(site.join("deployment.json")).unwrap(),
        built.deployment
    );
    assert!(!site.join("index.html").exists() && !site.join("assets").exists());
    assert_eq!(
        std::fs::read(site.join("apps/mailapp/dist/native.js")).unwrap(),
        b"export default {};\n"
    );
    assert!(site.join("apps/board/app-manifest.json").is_file());
    assert_eq!(
        std::fs::read_to_string(site.join(".loam-shell-build")).unwrap(),
        "build-1\n"
    );
    assert_eq!(
        std::fs::read_to_string(site.join(".loam-generation")).unwrap(),
        format!("{}\n", built.generation)
    );
    assert_eq!(
        std::fs::read_to_string(data.path().join("mounts.json")).unwrap(),
        built.mounts
    );
    assert_eq!(
        std::fs::read_to_string(data.path().join("models.json")).unwrap(),
        built.models
    );
    assert_eq!(desktop_state::read(data.path()), Ok(Some(state.clone())));
    assert_eq!(
        desktop_state::mode(data.path()),
        Ok(desktop_state::Mode::Managed(Some(state.clone())))
    );
    // Owner-only: what `models.rs`, `mounts.rs` and the state's reader accept.
    for name in ["mounts.json", "models.json", desktop_state::FILE] {
        assert!(crate::mounts::owner_only(&data.path().join(name)), "{name}");
    }
    assert_eq!(
        crate::models::read(&data.path().join("models.json"))
            .unwrap()
            .len(),
        1
    );
    // Nothing under the served site holds a location or a credential, whatever file it is.
    let mut pending = vec![site.clone()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let text = String::from_utf8_lossy(&std::fs::read(&path).unwrap()).into_owned();
            for (label, secret) in [
                ("the loopback address", "127.0.0.1"),
                ("the engine's port", "17400"),
                ("the token id", TOKEN_ID),
                ("the proof key", &proof_key()),
                ("the copilot's keychain service", "loam-copilot"),
                ("the mount keychain service", MOUNT_KEYCHAIN),
            ] {
                assert!(!text.contains(secret), "{} holds {label}", path.display());
            }
        }
    }
    // Nothing staged is left behind.
    let left: Vec<String> = std::fs::read_dir(data.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with('.') || name.ends_with(".tmp"))
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[test]
fn a_refused_state_changes_nothing() {
    let golden = fixture();
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    commit(data.path(), &state, &golden_profile(&golden), "build-1").unwrap();
    let before = |name: &str| std::fs::read(data.path().join(name)).unwrap();
    let files = [
        "site/deployment.json",
        "mounts.json",
        "models.json",
        desktop_state::FILE,
    ];
    let kept: Vec<Vec<u8>> = files.iter().map(|name| before(name)).collect();

    let mut missing = state.clone();
    missing.plugins[0].bundle_sha256 = "c".repeat(64);
    assert_eq!(
        commit(data.path(), &missing, &golden_profile(&golden), "build-2").err(),
        Some(INVALID)
    );
    for (name, bytes) in files.iter().zip(&kept) {
        assert_eq!(&before(name), bytes, "{name}");
    }
}

#[test]
fn refuses_a_state_its_bundles_do_not_match() {
    let golden = fixture();
    let profile = golden_profile(&golden);
    let mail = |state: &mut DesktopState| {
        state
            .plugins
            .iter_mut()
            .find(|plugin| plugin.id == "mail")
            .unwrap()
            .clone()
    };
    type Change = Box<dyn Fn(&Path, &mut DesktopState)>;
    let cases: Vec<(&str, Change)> = vec![
        (
            "an engine with no record",
            Box::new(|_, state| {
                state
                    .plugins
                    .iter_mut()
                    .for_each(|plugin| plugin.engine = None);
            }),
        ),
        (
            "a record with no engine",
            Box::new(|_, state| {
                state.plugins[0].engine = Some(EngineState {
                    port: 17401,
                    token_id: None,
                    proof_key: None,
                    file_fallback: false,
                });
            }),
        ),
        (
            "an authenticated engine with no token",
            Box::new(|_, state| {
                let index = state
                    .plugins
                    .iter()
                    .position(|plugin| plugin.id == "mail")
                    .unwrap();
                let engine = state.plugins[index].engine.as_mut().unwrap();
                engine.token_id = None;
                engine.proof_key = None;
            }),
        ),
        (
            "a plugin id its manifest does not say",
            Box::new(move |data, state| {
                let mut renamed = mail(state);
                renamed.id = "post".into();
                std::fs::rename(data.join("plugins/mail"), data.join("plugins/post")).unwrap();
                state.plugins.retain(|plugin| plugin.id != "mail");
                state.plugins.push(renamed);
            }),
        ),
        (
            "an app's manifest that is not JSON",
            Box::new(|data, _| {
                write(
                    &data
                        .join("plugins/board")
                        .join(bundle_of("board"))
                        .join("apps/board/app-manifest.json"),
                    b"{",
                );
            }),
        ),
        (
            "a view whose id is not its instance's",
            Box::new(|data, _| {
                let path = data
                    .join("plugins/board")
                    .join(bundle_of("board"))
                    .join("apps/board/app-manifest.json");
                let changed = std::fs::read_to_string(&path)
                    .unwrap()
                    .replace("\"id\": \"board\"", "\"id\": \"other\"");
                write(&path, changed.as_bytes());
            }),
        ),
        (
            "a mounted app the engine does not mount",
            Box::new(|data, _| {
                let path = data
                    .join("plugins/mail")
                    .join(bundle_of("mail"))
                    .join("apps/mailapp/app-manifest.json");
                let changed = std::fs::read_to_string(&path)
                    .unwrap()
                    .replace("\"native\"", "\"mounted\"");
                write(&path, changed.as_bytes());
            }),
        ),
        (
            "a mounted app over stdio",
            Box::new(|data, _| {
                let path = data
                    .join("plugins/mail")
                    .join(bundle_of("mail"))
                    .join("apps/mail/app-manifest.json");
                let changed = std::fs::read_to_string(&path)
                    .unwrap()
                    .replace("\"transport\": \"http\"", "\"transport\": \"stdio\"");
                write(&path, changed.as_bytes());
            }),
        ),
        (
            "a mount prefix that is not one of the app's domains",
            Box::new(|data, _| {
                let path = data
                    .join("plugins/mail")
                    .join(bundle_of("mail"))
                    .join("apps/mail/app-manifest.json");
                let changed = std::fs::read_to_string(&path)
                    .unwrap()
                    .replace("\"prefix\": \"mail\"", "\"prefix\": \"post\"");
                write(&path, changed.as_bytes());
            }),
        ),
        (
            "two instances with one domain",
            Box::new(|data, _| {
                let path = data
                    .join("plugins/mail")
                    .join(bundle_of("mail"))
                    .join("apps/mail/app-manifest.json");
                let changed = std::fs::read_to_string(&path)
                    .unwrap()
                    .replace("\"prefix\": \"mail\"", "\"prefix\": \"board\"")
                    .replace(
                        "\"domains\": [\n\t\t\t\"mail\"\n\t\t]",
                        "\"domains\": [\n\t\t\t\"board\"\n\t\t]",
                    );
                assert!(changed.contains("\"board\"\n\t\t]"), "the fixture's layout");
                write(&path, changed.as_bytes());
            }),
        ),
        (
            "a manifest key the schema does not name",
            Box::new(|data, _| {
                let path = data
                    .join("plugins/board")
                    .join(bundle_of("board"))
                    .join("plugin-manifest.json");
                let changed = std::fs::read_to_string(&path).unwrap().replacen(
                    '{',
                    "{\"url\": \"http://x\",",
                    1,
                );
                write(&path, changed.as_bytes());
            }),
        ),
    ];
    for (name, change) in cases {
        let data = tempfile::tempdir().unwrap();
        let mut state = install(data.path(), &golden);
        assert!(
            project(data.path(), &state, &profile).is_ok(),
            "{name}: the control"
        );
        change(data.path(), &mut state);
        assert_eq!(
            project(data.path(), &state, &profile).err(),
            Some(INVALID),
            "{name}"
        );
    }
}

#[cfg(unix)]
#[test]
fn a_link_in_a_package_or_for_its_directory_is_refused() {
    let golden = fixture();
    let profile = golden_profile(&golden);
    let outside = tempfile::tempdir().unwrap();
    write(&outside.path().join("secret"), b"not the plugin's");

    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let package = data
        .path()
        .join("plugins/board")
        .join(bundle_of("board"))
        .join("apps/board");
    std::os::unix::fs::symlink(outside.path().join("secret"), package.join("leak")).unwrap();
    assert_eq!(project(data.path(), &state, &profile).err(), Some(INVALID));

    // An app directory that is a link out of its bundle.
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let package = data
        .path()
        .join("plugins/board")
        .join(bundle_of("board"))
        .join("apps/board");
    let moved = outside.path().join("board");
    std::fs::rename(&package, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &package).unwrap();
    assert_eq!(project(data.path(), &state, &profile).err(), Some(INVALID));
}

#[test]
fn models_json_holds_each_providers_access_as_the_cli_writes_it() {
    let data = tempfile::tempdir().unwrap();
    let key_file = data.path().join("keys/openai.key");
    let mut state = DesktopState::fresh();
    state.copilot = Some(Copilot {
        default: None,
        providers: serde_json::from_value(serde_json::json!([
            { "id": "local", "kind": "openai-compatible", "model": "llama3.1:8b", "endpoint": "http://127.0.0.1:11434/v1//" },
            { "id": "openai", "kind": "openai", "model": "gpt-5", "key": { "file": key_file } }
        ]))
        .unwrap(),
    });
    let built = project(data.path(), &state, &Profile::default_profile()).unwrap();
    // `analyzeDeployment`'s model access: the endpoint without its trailing `/`, the key's reference as given.
    assert_eq!(
        built.models,
        format!(
            "{{\n\t\"providers\": [\n\t\t{{\n\t\t\t\"id\": \"local\",\n\t\t\t\"kind\": \"openai-compatible\",\n\t\t\t\"model\": \"llama3.1:8b\",\n\t\t\t\"endpoint\": \"http://127.0.0.1:11434/v1\"\n\t\t}},\n\t\t{{\n\t\t\t\"id\": \"openai\",\n\t\t\t\"kind\": \"openai\",\n\t\t\t\"model\": \"gpt-5\",\n\t\t\t\"key\": {{\n\t\t\t\t\"file\": {}\n\t\t\t}}\n\t\t}}\n\t]\n}}\n",
            serde_json::to_string(key_file.to_str().unwrap()).unwrap()
        )
    );
    // A provider frames the copilot's runtime, the first is the default, and no endpoint or key is served.
    assert_eq!(built.frame_src, crate::site::sandbox_origin());
    let deployment = Json::parse(built.deployment.as_bytes()).unwrap();
    assert_eq!(
        deployment
            .get("copilot")
            .and_then(|copilot| copilot.get("default")),
        Some(&Json::str("local"))
    );
    assert!(!built.deployment.contains("11434") && !built.deployment.contains("key"));
}

#[test]
fn a_key_file_is_only_the_fallbacks_own_place() {
    let golden = fixture();
    let profile = golden_profile(&golden);
    let data = tempfile::tempdir().unwrap();
    let mut state = install(data.path(), &golden);
    // A key file inside a package would be copied into the served site; one in `site/` would be swapped away.
    let package_key = data
        .path()
        .join("plugins/board")
        .join(bundle_of("board"))
        .join("apps/board/claude.key");
    write(&package_key, b"sk-ant-sentinel-0123456789");
    for file in [
        package_key,
        data.path().join("site/claude.key"),
        data.path().join("keys/other.key"),
    ] {
        state.copilot.as_mut().unwrap().providers[0].key =
            Some(KeyRef::File(crate::models::FileRef { file }));
        assert_eq!(project(data.path(), &state, &profile).err(), Some(INVALID));
    }
    let own = data.path().join("keys/claude.key");
    state.copilot.as_mut().unwrap().providers[0].key =
        Some(KeyRef::File(crate::models::FileRef { file: own }));
    assert!(project(data.path(), &state, &profile).is_ok());
}

#[test]
fn an_app_manifest_with_fractions_is_read_as_the_cli_reads_it() {
    // `profile-cases.json`'s `ui-settings-shapes-accepted` holds `1.5` and `0.5`, which `readManifest` accepts.
    let golden = fixture();
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let path = data
        .path()
        .join("plugins/board")
        .join(bundle_of("board"))
        .join("apps/board/app-manifest.json");
    let changed = std::fs::read_to_string(&path)
        .unwrap()
        .replacen('{', r#"{"settings": {"zoom": {"type": "number", "minimum": 0.5, "maximum": 1.5, "default": 1.0}},"#, 1);
    write(&path, changed.as_bytes());
    assert!(project(data.path(), &state, &golden_profile(&golden)).is_ok());
}

#[test]
fn a_state_its_reader_would_refuse_is_never_committed() {
    let golden = fixture();
    let data = tempfile::tempdir().unwrap();
    let mut state = install(data.path(), &golden);
    let revocation = crate::desktop_state::PendingRevocation {
        plugin_id: "mail".into(),
        token_id: "t".repeat(31),
        binary_path: data
            .path()
            .join("plugins/mail/old/engines/linux-x64/mail-engine"),
        failed_at: "2026-11-26T00:00:00.000Z".into(),
    };
    state.pending_revocations = vec![revocation; 8000];
    assert!(state.valid() && desktop_state::bytes(&state).len() > desktop_state::FILE_MAX);
    assert_eq!(
        commit(data.path(), &state, &golden_profile(&golden), "build-1").err(),
        Some(INVALID)
    );
    assert!(!data.path().join("site").exists() && !data.path().join(desktop_state::FILE).exists());
}

#[test]
fn a_failed_private_write_after_the_swap_leaves_the_committed_state() {
    let golden = fixture();
    let profile = golden_profile(&golden);
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    commit(data.path(), &state, &profile, "build-1").unwrap();
    let committed = std::fs::read(data.path().join(desktop_state::FILE)).unwrap();

    // `models.json` cannot be replaced (a directory is in its place): the new site is live, but the state is not
    // committed, so startup reconciles from the state still committed (9b3).
    let mut next = state.clone();
    next.inbound = false;
    std::fs::remove_file(data.path().join("models.json")).unwrap();
    std::fs::create_dir(data.path().join("models.json")).unwrap();
    // Not the owner-only rule, so not its code: the retryable failure.
    assert_eq!(
        commit(data.path(), &next, &profile, "build-2").err(),
        Some(FAILED)
    );
    assert_eq!(
        std::fs::read(data.path().join(desktop_state::FILE)).unwrap(),
        committed
    );
    assert_eq!(desktop_state::read(data.path()), Ok(Some(state)));
    assert_eq!(
        std::fs::read_to_string(data.path().join("site/.loam-shell-build")).unwrap(),
        "build-2\n"
    );
}

#[cfg(unix)]
#[test]
fn a_linked_bundle_or_a_link_inside_it_is_refused() {
    let golden = fixture();
    let profile = golden_profile(&golden);
    let outside = tempfile::tempdir().unwrap();

    // The bundle's directory itself a link to a copy elsewhere.
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let bundle = data.path().join("plugins/board").join(bundle_of("board"));
    let moved = outside.path().join("bundle");
    std::fs::rename(&bundle, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &bundle).unwrap();
    assert_eq!(project(data.path(), &state, &profile).err(), Some(INVALID));

    // An app's directory a link to a sibling inside the same bundle.
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let root = data.path().join("plugins/mail").join(bundle_of("mail"));
    std::fs::remove_dir_all(root.join("apps/mailapp")).unwrap();
    std::os::unix::fs::symlink(root.join("apps/mail"), root.join("apps/mailapp")).unwrap();
    assert_eq!(project(data.path(), &state, &profile).err(), Some(INVALID));

    // A manifest that is a link.
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let manifest = data
        .path()
        .join("plugins/board")
        .join(bundle_of("board"))
        .join("plugin-manifest.json");
    let target = outside.path().join("plugin-manifest.json");
    std::fs::rename(&manifest, &target).unwrap();
    std::os::unix::fs::symlink(&target, &manifest).unwrap();
    assert_eq!(project(data.path(), &state, &profile).err(), Some(INVALID));
}

#[test]
fn a_reserved_instance_is_refused() {
    let data = tempfile::tempdir().unwrap();
    let root = data
        .path()
        .join("plugins/shellish")
        .join(bundle_of("shellish"));
    write(
        &root.join("plugin-manifest.json"),
        br#"{"plugin_manifest_version":1,"plugin":{"id":"shellish","title":"S","version":"1.0.0","description":"S."},"apps":[{"id":"loam","path":"apps/loam"}]}"#,
    );
    write(
        &root.join("apps/loam/app-manifest.json"),
        br#"{"manifest_version":1,"protocol":1,"plugin":{"title":"S","version":"1.0.0","description":"S.","id":"loam","kind":"view","domains":["loam"]},"view":{}}"#,
    );
    let mut state = DesktopState::fresh();
    state.plugins.push(InstalledPlugin {
        id: "shellish".into(),
        bundle_sha256: bundle_of("shellish"),
        engine: None,
    });
    assert_eq!(
        project(data.path(), &state, &Profile::default_profile()).err(),
        Some(INVALID)
    );
    // The same bundle as `looms` is read: the refusal is the id, not the bundle.
    let text = std::fs::read_to_string(root.join("apps/loam/app-manifest.json"))
        .unwrap()
        .replace("\"loam\"", "\"looms\"");
    write(&root.join("apps/loam/app-manifest.json"), text.as_bytes());
    let text = std::fs::read_to_string(root.join("plugin-manifest.json"))
        .unwrap()
        .replace("\"id\":\"loam\"", "\"id\":\"looms\"");
    write(&root.join("plugin-manifest.json"), text.as_bytes());
    assert!(project(data.path(), &state, &Profile::default_profile()).is_ok());
}

#[test]
fn p5_s9_6_reconcile_is_noop_when_current_and_repairs_missing_stale_or_upgraded_artifacts() {
    let golden = fixture();
    let profile = golden_profile(&golden);
    let data = tempfile::tempdir().unwrap();
    let state = install(data.path(), &golden);
    let initial = commit(data.path(), &state, &profile, "build-1").unwrap();

    // Up-to-date artifacts require no rewrite.
    let (built, rewrote) = reconcile(data.path(), &state, &profile, "build-1").unwrap();
    assert!(!rewrote);
    assert_eq!(built.generation, initial.generation);
    assert_eq!(built.frame_src, initial.frame_src);

    // Changing `shell_build_id` (app upgrade) triggers reconciliation and updates `.loam-shell-build`.
    let (_, rewrote) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(rewrote);
    assert_eq!(
        std::fs::read_to_string(data.path().join("site/.loam-shell-build")).unwrap(),
        "build-2\n"
    );
    let (_, rewrote_again) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(!rewrote_again);

    // Missing `site/` triggers reconciliation.
    std::fs::remove_dir_all(data.path().join("site")).unwrap();
    let (_, rewrote) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(rewrote);
    assert_eq!(
        std::fs::read_to_string(data.path().join("site/deployment.json")).unwrap(),
        initial.deployment
    );

    // Lagging `.loam-generation` triggers reconciliation.
    std::fs::write(data.path().join("site/.loam-generation"), "sha256-stale\n").unwrap();
    let (_, rewrote) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(rewrote);
    assert_eq!(
        std::fs::read_to_string(data.path().join("site/.loam-generation")).unwrap(),
        format!("{}\n", initial.generation)
    );

    // Missing app package file triggers reconciliation.
    std::fs::remove_file(data.path().join("site/apps/mailapp/dist/native.js")).unwrap();
    let (_, rewrote) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(rewrote);
    assert!(
        data.path()
            .join("site/apps/mailapp/dist/native.js")
            .is_file()
    );

    // Missing or stale `mounts.json` and `models.json` trigger reconciliation and restore owner-only files.
    std::fs::remove_file(data.path().join("mounts.json")).unwrap();
    let (_, rewrote) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(rewrote);
    assert_eq!(
        std::fs::read_to_string(data.path().join("mounts.json")).unwrap(),
        initial.mounts
    );
    assert!(crate::mounts::owner_only(&data.path().join("mounts.json")));

    std::fs::write(data.path().join("models.json"), "{\"providers\":[]}\n").unwrap();
    let (_, rewrote) = reconcile(data.path(), &state, &profile, "build-2").unwrap();
    assert!(rewrote);
    assert_eq!(
        std::fs::read_to_string(data.path().join("models.json")).unwrap(),
        initial.models
    );
    assert!(crate::mounts::owner_only(&data.path().join("models.json")));
}

#[test]
fn p5_s9_6_reconcile_recovers_interrupted_app_only_js_upgrade_with_identical_generation() {
    let data = tempfile::tempdir().unwrap();
    let profile = Profile::default_profile();
    let old_sha = "1".repeat(64);
    let new_sha = "2".repeat(64);
    for (sha, js) in [
        (&old_sha, b"export const v = 'committed-v1';\n".as_slice()),
        (&new_sha, b"export const v = 'uncommitted-v2';\n".as_slice()),
    ] {
        let root = data.path().join("plugins/notes").join(sha);
        write(
            &root.join("plugin-manifest.json"),
            br#"{"plugin_manifest_version":1,"plugin":{"id":"notes","title":"Notes","version":"1.0.0","description":"Notes."},"apps":[{"id":"notes","path":"apps/notes"}]}"#,
        );
        write(
            &root.join("apps/notes/app-manifest.json"),
            br#"{"manifest_version":1,"protocol":1,"plugin":{"title":"Notes","version":"1.0.0","description":"Notes.","id":"notes","kind":"native","domains":["notes"]},"native":{"entry":"dist/native.js"}}"#,
        );
        write(&root.join("apps/notes/dist/native.js"), js);
    }

    let mut committed_state = DesktopState::fresh();
    committed_state.plugins.push(InstalledPlugin {
        id: "notes".into(),
        bundle_sha256: old_sha.clone(),
        engine: None,
    });
    let old_built = commit(data.path(), &committed_state, &profile, "build-1").unwrap();

    // Simulate a crash after swapping `site/` for `new_sha` BEFORE committing `desktop-state.json`:
    // both bundles yield identical `deployment.json`, `generation`, and filenames, differing ONLY
    // in `bundle_sha256` and `dist/native.js` bytes.
    let mut uncommitted_state = committed_state.clone();
    uncommitted_state.plugins[0].bundle_sha256 = new_sha;
    let new_built = project(data.path(), &uncommitted_state, &profile).unwrap();
    assert_eq!(new_built.generation, old_built.generation);
    assert_eq!(new_built.deployment, old_built.deployment);
    swap_site(data.path(), &new_built, "build-1").unwrap();
    assert_eq!(
        std::fs::read(data.path().join("site/apps/notes/dist/native.js")).unwrap(),
        b"export const v = 'uncommitted-v2';\n"
    );

    // Startup reconciliation against committed `desktop-state.json` detects `.loam-bundles`
    // divergence and restores the committed bundle's JS bytes.
    let (_, rewrote) = reconcile(data.path(), &committed_state, &profile, "build-1").unwrap();
    assert!(rewrote);
    assert_eq!(
        std::fs::read(data.path().join("site/apps/notes/dist/native.js")).unwrap(),
        b"export const v = 'committed-v1';\n"
    );
    assert_eq!(
        std::fs::read_to_string(data.path().join("site/.loam-bundles")).unwrap(),
        format!("notes {old_sha}\n")
    );
}
