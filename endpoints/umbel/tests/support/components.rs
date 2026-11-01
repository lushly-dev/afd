//! Helpers for the component-loader tests: the built `.wasm` files, plugin directories for hello
//! and for the fixture components, and the manifests of the fixtures.
#![allow(
    dead_code,
    unreachable_pub,
    clippy::unwrap_used,
    clippy::expect_used,
    missing_docs
)]

use std::path::{Path, PathBuf};

/// `<target>/wasm32-wasip2/release/<name>.wasm`, built by `umbel.yml` (and by the command in the
/// failure message) before the tests. The path comes from the test binary's own location, so it
/// follows `CARGO_TARGET_DIR`.
pub fn wasm(name: &str) -> PathBuf {
    let exe = std::env::current_exe().unwrap();
    let target = exe
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap();
    let path = target.join("wasm32-wasip2/release").join(format!("{name}.wasm"));
    assert!(
        path.is_file(),
        "{} is missing: build the components first with `cargo build --locked --release --target wasm32-wasip2 -p umbel-plugin-hello --features component -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future`",
        path.display()
    );
    path
}

pub fn hello_crate() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/hello")
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// A plugin directory under `parent`: `manifest` as `umbel-plugin.toml` and the component as
/// `<file>`.
pub fn component_dir(parent: &Path, name: &str, manifest: &str, wasm_name: &str, file: &str) -> PathBuf {
    let root = parent.join(name);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("umbel-plugin.toml"), manifest).unwrap();
    std::fs::copy(wasm(wasm_name), root.join(file)).unwrap();
    root
}

/// hello as a component, laid out as the exit run does (specification section 10.5): its
/// committed `manifests/component.toml`, the component as `hello.wasm`, and the crate's packs,
/// skills and schemas.
pub fn hello_dir(parent: &Path) -> PathBuf {
    let manifest = std::fs::read_to_string(hello_crate().join("manifests/component.toml")).unwrap();
    let root = component_dir(parent, "hello", &manifest, "umbel_plugin_hello", "hello.wasm");
    for tree in ["packs", "skills", "schemas"] {
        copy_tree(&hello_crate().join(tree), &root.join(tree));
    }
    root
}

/// The commands of `umbel-fixture-behaviors`, all in the domain `probe`.
pub const BEHAVIORS: &[&str] = &[
    "echo",
    "trap",
    "panic",
    "exit",
    "loop",
    "alloc",
    "output",
    "sleep",
    "clock",
    "clock-loop",
    "random",
    "env",
    "fs",
    "bad",
    "big",
    "forge",
];

const OPEN_INPUT: &str = "{ type = \"object\", properties = { mib = { type = \"integer\" }, bytes = { type = \"integer\" }, secs = { type = \"integer\" }, reads = { type = \"integer\" } }, additionalProperties = true }";

/// The manifest of a plugin built from a fixture crate. `commands` are the names after
/// `<domain>-`, each declared `inspect`; `grants` are declared required; `extra` is appended.
pub fn fixture_manifest(id: &str, wasm_file: &str, grants: &[&str], commands: &[&str], extra: &str) -> String {
    let grants: String = grants
        .iter()
        .map(|name| format!("[[grants]]\nname = \"{name}\"\nreason = \"the fixture uses {name}\"\n\n"))
        .collect();
    let commands: String = commands
        .iter()
        .map(|name| {
            format!(
                "[[commands]]\nname = \"{id}-{name}\"\ndescription = \"The {name} behaviour.\"\neffects = [\"inspect\"]\ninput_schema = {OPEN_INPUT}\n\n"
            )
        })
        .collect();
    format!(
        "manifest_version = 1\nprotocol = 1\n\n[plugin]\nid = \"{id}\"\ntitle = \"Fixture\"\nversion = \"0.1.0\"\ndescription = \"A test component.\"\nkind = \"component\"\ndomains = [\"{id}\"]\n\n[component]\npath = \"{wasm_file}\"\n\n{grants}{commands}{extra}"
    )
}

/// The behaviors fixture as a plugin directory, with the grants its standard library's WASI
/// imports need (`clock`, `random`) unless `grants` says otherwise.
pub fn behaviors_dir(parent: &Path, grants: &[&str]) -> PathBuf {
    let manifest = fixture_manifest("probe", "probe.wasm", grants, BEHAVIORS, "");
    component_dir(parent, "probe", &manifest, "umbel_fixture_behaviors", "probe.wasm")
}
