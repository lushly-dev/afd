//! Declares Loam's six commands, the only ones the capability file can grant (phase 6 specification, 10.2, as
//! phase 5's step 2 amends it with `model_send` and `model_cancel`, and step 11b with 10.8's `inbound_reply`).
//! The bundled empty shell is `../dist`, written by `pnpm build:site`; without it, a page that says so stands
//! in, so `cargo test` and `cargo clippy` need no web build.
use std::path::Path;

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
        ]),
    ))
    .expect("desktop build metadata");
}
