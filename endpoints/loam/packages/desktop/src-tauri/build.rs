//! Declares Loam's six commands, the only ones the capability file can grant (phase 6 specification, 10.2, as
//! phase 5's step 2 amends it with `model_send` and `model_cancel`, and step 11b with 10.8's `inbound_reply`).
//! The bundled empty shell is `../dist`, written by `pnpm build:site`; without it, a page that says so stands
//! in, so `cargo test` and `cargo clippy` need no web build.
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn collect_dist_files(root: &Path, current: &Path, out: &mut Vec<(String, PathBuf)>) {
    println!("cargo:rerun-if-changed={}", current.display());
    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_dist_files(root, &path, out);
        } else if file_type.is_file() {
            println!("cargo:rerun-if-changed={}", path.display());
            if let Ok(rel) = path.strip_prefix(root) {
                let normalized = rel.to_string_lossy().replace('\\', "/");
                out.push((normalized, path));
            }
        }
    }
}

fn compute_shell_build_id(dist: &Path, polyfill: &[u8]) -> String {
    let mut hasher = Sha256::new();
    let version = std::env::var("CARGO_PKG_VERSION").unwrap_or_default();
    hasher.update(b"loam-shell-build-v1\n");
    hasher.update(version.as_bytes());
    hasher.update(b"\n");

    let mut dist_files = Vec::new();
    collect_dist_files(dist, dist, &mut dist_files);
    dist_files.sort_by(|a, b| a.0.cmp(&b.0));
    for (rel, path) in dist_files {
        let bytes = std::fs::read(&path).expect("read dist file for shell_build_id");
        hasher.update(b"dist:");
        hasher.update(rel.as_bytes());
        hasher.update(b":");
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
        hasher.update(b"\n");
    }

    hasher.update(b"polyfill:");
    hasher.update((polyfill.len() as u64).to_le_bytes());
    hasher.update(polyfill);
    hasher.update(b"\n");

    for meta in [
        "tauri.conf.json",
        "capabilities/main.json",
        "capabilities/host-setup.json",
    ] {
        let path = Path::new(meta);
        println!("cargo:rerun-if-changed={meta}");
        if let Ok(bytes) = std::fs::read(path) {
            hasher.update(b"meta:");
            hasher.update(meta.as_bytes());
            hasher.update(b":");
            hasher.update((bytes.len() as u64).to_le_bytes());
            hasher.update(&bytes);
            hasher.update(b"\n");
        }
    }

    let host_setup_dir = Path::new("host-setup");
    if host_setup_dir.is_dir() {
        let mut setup_files = Vec::new();
        collect_dist_files(host_setup_dir, host_setup_dir, &mut setup_files);
        setup_files.sort_by(|a, b| a.0.cmp(&b.0));
        for (rel, path) in setup_files {
            if let Ok(bytes) = std::fs::read(&path) {
                hasher.update(b"host-setup:");
                hasher.update(rel.as_bytes());
                hasher.update(b":");
                hasher.update((bytes.len() as u64).to_le_bytes());
                hasher.update(&bytes);
                hasher.update(b"\n");
            }
        }
    }

    let fonts_dir = Path::new("../../theme/fonts");
    for font in [
        "inter-latin-400-normal.woff2",
        "inter-latin-500-normal.woff2",
        "inter-latin-600-normal.woff2",
        "space-grotesk-latin-600-normal.woff2",
        "ibm-plex-mono-latin-400-normal.woff2",
        "ibm-plex-mono-latin-500-normal.woff2",
    ] {
        let path = fonts_dir.join(font);
        println!("cargo:rerun-if-changed={}", path.display());
        if let Ok(bytes) = std::fs::read(&path) {
            hasher.update(b"font:");
            hasher.update(font.as_bytes());
            hasher.update(b":");
            hasher.update((bytes.len() as u64).to_le_bytes());
            hasher.update(&bytes);
            hasher.update(b"\n");
        }
    }

    let digest = hasher.finalize();
    let mut hex = String::with_capacity(7 + digest.len() * 2);
    hex.push_str("sha256-");
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    hex
}

fn main() {
    let dist = Path::new("../dist");
    if !dist.join("index.html").exists() {
        std::fs::create_dir_all(dist).expect("../dist");
        std::fs::write(
            dist.join("index.html"),
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"><title>Loam</title></head><body><p>This build has no shell: run <code>pnpm -F @lushly-dev/loam-desktop build:site</code> before building the app.</p></body></html>\n",
        )
        .expect("../dist/index.html");
    }
    println!("cargo:rerun-if-changed=../dist");
    // D34's polyfill, which the main window runs before any page script where the webview has no scoped custom
    // element registries (D174, #2793). From the pinned devDependency; without an install it is empty, so `cargo
    // test` needs no `pnpm install`, an app or installer build refuses, and `scoped.test.ts` fails on Linux.
    let polyfill = Path::new(
        "../node_modules/@webcomponents/scoped-custom-element-registry/scoped-custom-element-registry.min.js",
    );
    println!("cargo:rerun-if-changed={}", polyfill.display());
    // pnpm links the file with its store's older time, so an install alone would not rerun this: its own record
    // (rewritten by every install) and the pinned version do.
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=../../../../../node_modules/.modules.yaml");
    let source = match std::fs::read(polyfill) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // The app must have it: `build:app` turns on `custom-protocol`, and `tauri build` (the installers) builds
            // the release profile with Tauri's own feature, not this package's. A `cargo test` or `clippy` needs none.
            assert!(
                std::env::var_os("CARGO_FEATURE_CUSTOM_PROTOCOL").is_none()
                    && std::env::var("PROFILE").as_deref() != Ok("release"),
                "{} is missing: run `pnpm install` before building the app (#2793)",
                polyfill.display()
            );
            println!(
                "cargo:warning=no scoped-registry polyfill ({} missing): this build runs none (#2793)",
                polyfill.display()
            );
            Vec::new()
        }
        Err(error) => panic!("{}: {error}", polyfill.display()),
    };
    let shell_build_id = compute_shell_build_id(dist, &source);
    println!("cargo:rustc-env=LOAM_SHELL_BUILD_ID={shell_build_id}");
    let out =
        Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("scoped-registry-polyfill.js");
    std::fs::write(&out, source).expect("the polyfill's copy");
    println!("cargo:rerun-if-env-changed=LOAM_UPDATER_PUBKEY");
    println!("cargo:rerun-if-env-changed=LOAM_UPDATER_ENDPOINT");
    // A test binary that links Tauri's mock runtime needs Common Controls 6 on Windows, as the app has through
    // its own manifest; without it, the test exits with STATUS_ENTRYPOINT_NOT_FOUND before it runs.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "mount_open",
            "mount_send",
            "mount_close",
            "model_send",
            "model_cancel",
            "inbound_reply",
            "setup_open",
            "setup_state_get",
            "setup_plugin_pick",
            "setup_plugin_inspect_bundled",
            "setup_plugin_cancel",
            "setup_plugin_confirm",
            "setup_plugin_uninstall",
            "setup_plugin_retry_revocation",
            "setup_plugin_rotate_token",
            "setup_plugin_service_action",
            "setup_model_save",
            "setup_model_remove",
            "setup_model_set_default",
            "setup_apply_reload",
        ]),
    ))
    .expect("desktop build metadata");
}
