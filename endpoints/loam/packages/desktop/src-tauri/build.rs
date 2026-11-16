//! Declares Loam's three commands, the only ones the capability file can grant (phase 6 specification, 10.2).
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
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["mount_open", "mount_send", "mount_close"]),
    ))
    .expect("desktop build metadata");
}
