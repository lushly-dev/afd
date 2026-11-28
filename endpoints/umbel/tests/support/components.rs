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

/// Search `candidates` in order for `relative`, deduplicating repeated directories. Returns the
/// first path that exists as a file, or the list of every path checked.
fn find_artifact_in(relative: &Path, candidates: Vec<PathBuf>) -> Result<PathBuf, Vec<PathBuf>> {
    let mut dirs = Vec::new();
    for dir in candidates {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    let mut searched = Vec::with_capacity(dirs.len());
    for dir in dirs {
        let candidate = dir.join(relative);
        if candidate.is_file() {
            return Ok(candidate);
        }
        searched.push(candidate);
    }
    Err(searched)
}

/// Candidate Cargo target directories for built artifacts, in search order (#1924):
/// 1. `CARGO_TARGET_DIR` (runtime, then compile-time),
/// 2. the parent of `CARGO_TARGET_TMPDIR` (default `target/` or a configured `build.target-dir`),
/// 3. `<workspace>/target` from `CARGO_MANIFEST_DIR` (where Cargo places final artifacts when
///    `build.build-dir` moves `CARGO_TARGET_TMPDIR` to a separate build directory; a custom
///    `.cargo/config.toml` `build.target-dir` outside `<workspace>/target` combined with a
///    separate `build-dir` still requires `CARGO_TARGET_DIR`).
pub fn find_target_artifact(relative: &Path) -> Result<PathBuf, Vec<PathBuf>> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("CARGO_TARGET_DIR").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(dir));
    }
    if let Some(dir) = option_env!("CARGO_TARGET_DIR").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(dir));
    }
    if let Some(dir) = Path::new(env!("CARGO_TARGET_TMPDIR")).parent() {
        candidates.push(dir.to_path_buf());
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("target"));
    find_artifact_in(relative, candidates)
}

/// `<target>/wasm32-wasip2/release/<name>.wasm`, built by `umbel.yml` (and by the command in the
/// failure message) before the tests. Searches `CARGO_TARGET_DIR`, the parent of
/// `CARGO_TARGET_TMPDIR`, and `<workspace>/target` so a configured Cargo `build.build-dir` still
/// finds the final artifacts (#1924).
pub fn wasm(name: &str) -> PathBuf {
    let relative = Path::new("wasm32-wasip2/release").join(format!("{name}.wasm"));
    find_target_artifact(&relative).unwrap_or_else(|searched| {
        let tried: Vec<String> = searched.iter().map(|p| p.display().to_string()).collect();
        panic!(
            "{} is missing (searched: {}): build the components first with `cargo build --locked --release --target wasm32-wasip2 -p umbel-plugin-hello -p umbel-plugin-components -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future -p umbel-fixture-budget --features umbel-plugin-hello/component,umbel-plugin-components/component,umbel-fixture-budget/component`",
            relative.display(),
            tried.join(", ")
        );
    })
}

pub fn hello_crate() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/hello")
}

pub fn copy_tree(from: &Path, to: &Path) {
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
pub fn component_dir(
    parent: &Path,
    name: &str,
    manifest: &str,
    wasm_name: &str,
    file: &str,
) -> PathBuf {
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
    let root = component_dir(
        parent,
        "hello",
        &manifest,
        "umbel_plugin_hello",
        "hello.wasm",
    );
    for tree in ["packs", "skills", "schemas"] {
        copy_tree(&hello_crate().join(tree), &root.join(tree));
    }
    root
}

pub fn components_crate() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/components")
}

/// The components plugin as a component (Component Briefs step D2): its committed
/// `manifests/component.toml`, the component as `components.wasm`, and the crate's packs, skills
/// and schemas.
pub fn components_dir(parent: &Path) -> PathBuf {
    let manifest =
        std::fs::read_to_string(components_crate().join("manifests/component.toml")).unwrap();
    let root = component_dir(
        parent,
        "components",
        &manifest,
        "umbel_plugin_components",
        "components.wasm",
    );
    for tree in ["packs", "skills", "schemas"] {
        copy_tree(&components_crate().join(tree), &root.join(tree));
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
pub fn fixture_manifest(
    id: &str,
    wasm_file: &str,
    grants: &[&str],
    commands: &[&str],
    extra: &str,
) -> String {
    let grants: String = grants
        .iter()
        .map(|name| {
            format!("[[grants]]\nname = \"{name}\"\nreason = \"the fixture uses {name}\"\n\n")
        })
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
    component_dir(
        parent,
        "probe",
        &manifest,
        "umbel_fixture_behaviors",
        "probe.wasm",
    )
}

#[cfg(test)]
mod tests {
    use super::find_artifact_in;
    use std::path::Path;

    #[test]
    fn find_artifact_falls_back_to_workspace_target_when_build_dir_is_separate() {
        let root = tempfile::tempdir().unwrap();
        let build_dir = root.path().join("cargo-build");
        let workspace_target = root.path().join("workspace-target");
        let rel = Path::new("wasm32-wasip2/release/example.wasm");
        let expected = workspace_target.join(rel);
        std::fs::create_dir_all(expected.parent().unwrap()).unwrap();
        std::fs::write(&expected, b"wasm").unwrap();

        let found = find_artifact_in(rel, vec![build_dir.clone(), workspace_target.clone()])
            .expect("should fall back to workspace target");
        assert_eq!(found, expected);

        let missing = find_artifact_in(
            Path::new("debug/missing"),
            vec![
                build_dir.clone(),
                build_dir.clone(),
                workspace_target.clone(),
            ],
        )
        .unwrap_err();
        assert_eq!(
            missing,
            vec![
                build_dir.join("debug/missing"),
                workspace_target.join("debug/missing"),
            ]
        );
    }
}
