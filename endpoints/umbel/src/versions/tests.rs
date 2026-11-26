//! `architecture.json`'s schema-version surfaces for Umbel, generated from [`SCHEMA_SURFACES`]
//! (D213). The `endpoints/umbel/Cargo.toml` unit's `publicSurfaces` hold the hand-written
//! surfaces (the library, binaries, commands, the plugin protocol and the WIT worlds) first, in
//! their own order, and then one `<stem>-<version>` entry per schema version, in the table's
//! order. `UMBEL_UPDATE_SURFACES=1 cargo test -p umbel --lib versions::` rewrites that list in
//! place and touches nothing else in the file.

use std::path::{Path, PathBuf};

use std::collections::BTreeSet;

use super::{NOT_SURFACES, SCHEMA_SURFACES};

const UNIT: &str = "endpoints/umbel/Cargo.toml";

/// Stems of hand-written surfaces whose names end in a version, as a schema surface's do. A new
/// one is added here, and to `handWritten` in `scripts/repository-contract.test.mjs`, or the check
/// takes it for a stale schema surface.
const HAND_WRITTEN_VERSIONED: &[&str] = &["plugin-protocol"];

fn architecture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../architecture.json")
}

/// One surface per schema version, `<stem>-<version>`.
fn generated() -> Vec<String> {
    SCHEMA_SURFACES
        .iter()
        .flat_map(|(stem, versions)| versions.iter().map(move |v| format!("{stem}-{v}")))
        .collect()
}

/// Whether `surface` names a schema version: `<lowercase-words>-<digits>`, other than the
/// hand-written ones in [`HAND_WRITTEN_VERSIONED`].
fn is_schema(surface: &str) -> bool {
    let Some((stem, version)) = surface.rsplit_once('-') else {
        return false;
    };
    !HAND_WRITTEN_VERSIONED.contains(&stem)
        && stem.starts_with(|c: char| c.is_ascii_lowercase())
        && stem.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
        && !version.is_empty()
        && version.bytes().all(|b| b.is_ascii_digit())
}

/// The list the unit should hold: its hand-written surfaces, then the generated ones.
fn expected(current: &[String]) -> Vec<String> {
    current
        .iter()
        .filter(|surface| !is_schema(surface))
        .cloned()
        .chain(generated())
        .collect()
}

fn current(text: &str) -> Vec<String> {
    let architecture: serde_json::Value = serde_json::from_str(text).expect("architecture.json");
    let unit = architecture["units"]
        .as_array()
        .expect("units")
        .iter()
        .find(|unit| unit["manifest"] == UNIT)
        .expect("the endpoints/umbel/Cargo.toml unit");
    unit["publicSurfaces"]
        .as_array()
        .expect("publicSurfaces")
        .iter()
        .map(|surface| surface.as_str().expect("a surface name").to_owned())
        .collect()
}

/// `text` with the unit's `publicSurfaces` array replaced by `surfaces`, one per line at the
/// array's own indentation plus a tab, as Biome formats a list too long for one line.
fn rewritten(text: &str, surfaces: &[String]) -> String {
    let unit = text
        .find(&format!("\"manifest\": \"{UNIT}\""))
        .expect("the unit's manifest line");
    let end = unit + text[unit..].find('}').expect("the unit's closing brace");
    let key = unit
        + text[unit..end]
            .find("\"publicSurfaces\": [")
            .expect("its publicSurfaces, inside the unit");
    let open = key + text[key..].find('[').expect("[");
    let close = open + text[open..].find(']').expect("]");
    let line_start = text[..key].rfind('\n').map_or(0, |i| i + 1);
    let indent = &text[line_start..key];
    let items: Vec<String> = surfaces
        .iter()
        .map(|surface| {
            format!(
                "{indent}\t{}",
                serde_json::to_string(surface).expect("a name")
            )
        })
        .collect();
    format!(
        "{}[\n{}\n{indent}]{}",
        &text[..open],
        items.join(",\n"),
        &text[close + 1..]
    )
}

#[test]
fn every_schema_surface_names_a_schema_file() {
    let schemas = Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas");
    for (stem, versions) in SCHEMA_SURFACES {
        assert!(!versions.is_empty(), "{stem} has no version");
        for version in *versions {
            let file = schemas.join(format!("{stem}.v{version}.json"));
            assert!(file.is_file(), "{} is missing", file.display());
        }
    }
    let mut seen = BTreeSet::new();
    for surface in generated() {
        assert!(
            is_schema(&surface),
            "{surface} would not be recognised as generated"
        );
        assert!(seen.insert(surface.clone()), "{surface} is listed twice");
    }
}

#[test]
fn every_schema_file_is_a_surface_or_says_why_not() {
    let listed: BTreeSet<String> = SCHEMA_SURFACES
        .iter()
        .flat_map(|(stem, versions)| versions.iter().map(move |v| format!("{stem}.v{v}.json")))
        .collect();
    let excluded: BTreeSet<&str> = NOT_SURFACES.iter().map(|(file, _)| *file).collect();
    let schemas = Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas");
    let mut files = BTreeSet::new();
    for entry in std::fs::read_dir(&schemas).expect("read schemas/") {
        let name = entry
            .expect("an entry")
            .file_name()
            .into_string()
            .expect("a UTF-8 name");
        if name.ends_with(".json") {
            files.insert(name);
        }
    }
    for file in &files {
        assert!(
            listed.contains(file) || excluded.contains(file.as_str()),
            "schemas/{file} is neither a version SCHEMA_SURFACES lists nor in NOT_SURFACES \
             (src/versions.rs): list the version it is, or say why it is not a surface"
        );
        assert!(
            !(listed.contains(file) && excluded.contains(file.as_str())),
            "schemas/{file} is both listed and excluded"
        );
    }
    for file in &excluded {
        assert!(
            files.contains(*file),
            "NOT_SURFACES names schemas/{file}, which is gone"
        );
    }
}

#[test]
fn architecture_surfaces_match_versions_rs() {
    let path = architecture_path();
    let text = std::fs::read_to_string(&path).expect("read architecture.json");
    let current = current(&text);
    let expected = expected(&current);
    if current == expected {
        return;
    }
    if std::env::var_os("UMBEL_UPDATE_SURFACES").is_some_and(|v| v == "1") {
        let updated = rewritten(&text, &expected);
        assert_eq!(
            self::current(&updated),
            expected,
            "the rewrite must parse back"
        );
        std::fs::write(&path, updated).expect("write architecture.json");
        return;
    }
    let missing: Vec<_> = expected.iter().filter(|s| !current.contains(s)).collect();
    let extra: Vec<_> = current.iter().filter(|s| !expected.contains(s)).collect();
    panic!(
        "architecture.json's surfaces for {UNIT} differ from src/versions.rs (D213): missing \
         {missing:?}, not read by this host {extra:?}{}. A hand-written surface named \
         `<words>-<n>` belongs in HAND_WRITTEN_VERSIONED (src/versions/tests.rs). Regenerate with \
         `UMBEL_UPDATE_SURFACES=1 cargo test -p umbel --lib versions::` and commit \
         architecture.json",
        if missing.is_empty() && extra.is_empty() {
            ", or out of order"
        } else {
            ""
        }
    );
}

#[test]
fn rewrite_replaces_only_the_umbel_list() {
    let text = "{\n\t\"units\": [\n\t\t{\n\t\t\t\"manifest\": \"other/Cargo.toml\",\n\t\t\t\
                \"publicSurfaces\": [\"event-0\"]\n\t\t},\n\t\t{\n\t\t\t\"manifest\": \
                \"endpoints/umbel/Cargo.toml\",\n\t\t\t\"publicSurfaces\": [\"rust-library\", \
                \"event-0\", \"plugin-protocol-1\"]\n\t\t}\n\t]\n}\n";
    let surfaces = expected(&current(text));
    assert_eq!(surfaces[..2], ["rust-library", "plugin-protocol-1"]);
    let updated = rewritten(text, &surfaces);
    assert_eq!(current(&updated), surfaces);
    assert!(updated.contains("\"publicSurfaces\": [\"event-0\"]"));
    assert!(updated.contains("\n\t\t\t\t\"rust-library\",\n"));
    assert!(updated.ends_with("\n\t\t\t]\n\t\t}\n\t]\n}\n"));
}

#[test]
fn a_drifted_list_is_caught() {
    let mut drifted = expected(&["rust-library".to_owned()]);
    drifted.retain(|surface| surface != "event-0");
    drifted.push("workspace-config-99".to_owned());
    assert_ne!(expected(&drifted), drifted);
    assert!(!is_schema("wit:umbel:plugin@1.1.0"));
    assert!(!is_schema("umbel serve --stdio"));
    assert!(!is_schema("bin:umbel"));
    assert!(is_schema("workspace-config-7"));
    assert!(!is_schema("plugin-protocol-1"));
    assert!(!is_schema("--1"));
}
