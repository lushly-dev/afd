//! The `plugin-new` templates (specification section 10.2), embedded with `include_str!`.
//!
//! A template is a text file with `{{name}}` placeholders; [`render`] fills them for one plugin
//! and returns the files to write. Nothing here touches the disk.

use crate::plugins::PluginKind;

const BUILD_RS: &str = include_str!("shared/build.rs.tmpl");
const PACK_TOML: &str = include_str!("shared/pack.toml.tmpl");
const GREETING: &str = include_str!("shared/greeting.txt.tmpl");
const INPUT_SCHEMA: &str = include_str!("shared/hello.input.json.tmpl");
const OUTPUT_SCHEMA: &str = include_str!("shared/hello.output.json.tmpl");
const GITIGNORE: &str = include_str!("shared/gitignore.tmpl");
const TEST_RS: &str = include_str!("shared/test.rs.tmpl");
const COMMAND_SKILL: &str = include_str!("shared/skill-command.md.tmpl");
/// The host's own toolchain pin, so a scaffolded crate builds with the compiler the host does.
const HOST_TOOLCHAIN: &str = include_str!("../../rust-toolchain.toml");

const COMPILED_CARGO: &str = include_str!("compiled/Cargo.toml.tmpl");
const COMPILED_MANIFEST: &str = include_str!("compiled/manifest.toml.tmpl");
const COMPILED_LIB: &str = include_str!("compiled/lib.rs.tmpl");
const COMPILED_README: &str = include_str!("compiled/README.md.tmpl");

const COMPONENT_CARGO: &str = include_str!("component/Cargo.toml.tmpl");
const COMPONENT_MANIFEST: &str = include_str!("component/manifest.toml.tmpl");
const COMPONENT_LIB: &str = include_str!("component/lib.rs.tmpl");
const COMPONENT_README: &str = include_str!("component/README.md.tmpl");

const MOUNTED_MANIFEST: &str = include_str!("mounted/manifest.toml.tmpl");
const MOUNTED_README: &str = include_str!("mounted/README.md.tmpl");

const PACK_MANIFEST: &str = include_str!("pack/manifest.toml.tmpl");
const PACK_NOTES: &str = include_str!("pack/notes.txt.tmpl");
const PACK_SKILL: &str = include_str!("pack/skill.md.tmpl");
const PACK_README: &str = include_str!("pack/README.md.tmpl");

/// What a template fills in for one plugin.
pub(crate) struct Variables {
    /// The plugin id: `^[a-z][a-z0-9]{0,31}$`.
    pub id: String,
    /// How a crate depends on `umbel-sdk`: an inline TOML table.
    pub umbel_sdk: String,
    /// How a crate depends on `umbel` for its test kit: an inline TOML table.
    pub umbel: String,
}

/// A file to write, relative to the plugin directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct File {
    pub path: String,
    pub content: String,
}

fn capitalized(id: &str) -> String {
    let mut chars = id.chars();
    chars
        .next()
        .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
        .unwrap_or_default()
}

/// The toolchain channel of the host's `rust-toolchain.toml`.
fn host_channel() -> String {
    HOST_TOOLCHAIN
        .parse::<toml::Table>()
        .ok()
        .and_then(|table| {
            table
                .get("toolchain")?
                .get("channel")?
                .as_str()
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "stable".to_owned())
}

fn toolchain_file(component: bool) -> String {
    let mut text = format!(
        "[toolchain]\nchannel = \"{}\"\ncomponents = [\"clippy\", \"rustfmt\"]\nprofile = \"minimal\"\n",
        host_channel()
    );
    if component {
        text.push_str("targets = [\"wasm32-wasip2\"]\n");
    }
    text
}

fn fill(template: &str, variables: &Variables, pack_description: &str) -> String {
    let id = variables.id.as_str();
    let title = capitalized(id);
    let replacements = [
        ("{{id}}", id.to_owned()),
        ("{{title}}", title.clone()),
        ("{{crate}}", format!("umbel-plugin-{id}")),
        ("{{lib}}", format!("umbel_plugin_{id}")),
        ("{{type}}", format!("{title}Plugin")),
        ("{{upper}}", id.to_ascii_uppercase()),
        ("{{umbel_sdk}}", variables.umbel_sdk.clone()),
        ("{{umbel}}", variables.umbel.clone()),
        ("{{pack_description}}", pack_description.to_owned()),
    ];
    let mut text = template.to_owned();
    for (placeholder, value) in replacements {
        text = text.replace(placeholder, &value);
    }
    text
}

/// The files of a new plugin of `kind`, in the order they are written.
pub(crate) fn render(kind: PluginKind, variables: &Variables) -> Vec<File> {
    let id = variables.id.as_str();
    let command_pack = format!("Salutations {id}-hello uses.");
    let content_pack = "Starter content: replace it with your own.";
    let mut files: Vec<(String, String)> = Vec::new();
    let mut add = |path: String, template: &str, pack_description: &str| {
        files.push((path, fill(template, variables, pack_description)));
    };
    match kind {
        PluginKind::Compiled | PluginKind::Component => {
            let component = kind == PluginKind::Component;
            add(
                "Cargo.toml".into(),
                if component {
                    COMPONENT_CARGO
                } else {
                    COMPILED_CARGO
                },
                &command_pack,
            );
            add(
                "umbel-plugin.toml".into(),
                if component {
                    COMPONENT_MANIFEST
                } else {
                    COMPILED_MANIFEST
                },
                &command_pack,
            );
            if component {
                add(
                    "manifests/compiled.toml".into(),
                    COMPILED_MANIFEST,
                    &command_pack,
                );
            }
            add("build.rs".into(), BUILD_RS, &command_pack);
            add(
                "src/lib.rs".into(),
                if component {
                    COMPONENT_LIB
                } else {
                    COMPILED_LIB
                },
                &command_pack,
            );
            add("tests/plugin.rs".into(), TEST_RS, &command_pack);
            add("packs/starter/pack.toml".into(), PACK_TOML, &command_pack);
            add(
                "packs/starter/data/greeting.txt".into(),
                GREETING,
                &command_pack,
            );
            add(
                format!("skills/{id}-guide/SKILL.md"),
                COMMAND_SKILL,
                &command_pack,
            );
            add(
                format!("schemas/{id}-hello.input.json"),
                INPUT_SCHEMA,
                &command_pack,
            );
            add(
                format!("schemas/{id}-hello.output.json"),
                OUTPUT_SCHEMA,
                &command_pack,
            );
            add(
                "README.md".into(),
                if component {
                    COMPONENT_README
                } else {
                    COMPILED_README
                },
                &command_pack,
            );
            add(".gitignore".into(), GITIGNORE, &command_pack);
            files.push(("rust-toolchain.toml".into(), toolchain_file(component)));
        }
        PluginKind::Mounted => {
            add("umbel-plugin.toml".into(), MOUNTED_MANIFEST, content_pack);
            add("README.md".into(), MOUNTED_README, content_pack);
        }
        PluginKind::Pack => {
            add("umbel-plugin.toml".into(), PACK_MANIFEST, content_pack);
            add("packs/starter/pack.toml".into(), PACK_TOML, content_pack);
            add(
                "packs/starter/data/notes.txt".into(),
                PACK_NOTES,
                content_pack,
            );
            add(
                format!("skills/{id}-guide/SKILL.md"),
                PACK_SKILL,
                content_pack,
            );
            add("README.md".into(), PACK_README, content_pack);
        }
    }
    files
        .into_iter()
        .map(|(path, content)| File { path, content })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::Manifest;

    fn variables() -> Variables {
        Variables {
            id: "notes".to_owned(),
            umbel_sdk: "{ path = \"/x/sdk\" }".to_owned(),
            umbel: "{ path = \"/x\" }".to_owned(),
        }
    }

    #[test]
    fn no_placeholder_survives_and_every_manifest_parses() {
        for kind in [
            PluginKind::Compiled,
            PluginKind::Component,
            PluginKind::Mounted,
            PluginKind::Pack,
        ] {
            let files = render(kind, &variables());
            for file in &files {
                assert!(
                    !file.content.contains("{{"),
                    "{kind}: {} has an unfilled placeholder",
                    file.path
                );
            }
            let manifest = files
                .iter()
                .find(|file| file.path == "umbel-plugin.toml")
                .expect("every kind writes a manifest");
            let parsed = Manifest::parse(&manifest.content, "umbel-plugin.toml")
                .unwrap_or_else(|error| panic!("{kind}: {}", error.message()));
            assert_eq!(parsed.plugin.kind, kind);
            assert_eq!(parsed.plugin.id, "notes");
        }
    }

    #[test]
    fn the_component_template_carries_a_compiled_manifest_for_its_tests() {
        let files = render(PluginKind::Component, &variables());
        let compiled = files
            .iter()
            .find(|file| file.path == "manifests/compiled.toml")
            .expect("the component template writes the compiled manifest");
        let parsed = Manifest::parse(&compiled.content, "manifests/compiled.toml").unwrap();
        assert_eq!(parsed.plugin.kind, PluginKind::Compiled);
    }

    #[test]
    fn the_toolchain_is_the_hosts() {
        assert!(
            host_channel()
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit())
        );
        assert!(toolchain_file(true).contains("wasm32-wasip2"));
        assert!(!toolchain_file(false).contains("wasm32-wasip2"));
    }
}
