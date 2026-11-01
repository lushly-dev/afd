//! The plugin contract: the manifest, plugin sources, packs and the versions they carry, the
//! load sequence and compiled plugins (phase 1 specification, sections 2, 3, 6, 7, 8.2 and 9.1).
//!
//! The file-only half reads `umbel-plugin.toml`, `pack.toml` and the plugin directory and
//! registers nothing. The loader runs the load sequence of section 6, with compiled plugins
//! ([`CompiledPlugin`]) and the host services they are granted ([`Services`]); the component and
//! mounted kinds arrive in the steps that follow.

mod check;
mod compiled;
#[cfg(feature = "component")]
mod component;
mod config;
mod doctor;
mod error;
mod files;
mod grants;
mod loader;
mod manifest;
#[cfg(feature = "mounted")]
mod mounted;
mod packs;
mod pipelines;
mod skills;
mod source;

pub(crate) use check::run as check_plugin;
#[cfg(feature = "testkit")]
pub(crate) use check::single_plugin_config;
pub use compiled::{Asset, CompiledPlugin, PluginCommand, sdk};
pub(crate) use doctor::{
    checks as doctor_checks, first_class_check, loaded_check, pipelines_check,
};
pub use error::{PluginError, codes};
pub use files::{AssetFiles, DirFiles, PluginFiles};
pub use grants::{CallServices, MAX_LOG_BYTES, MAX_PACK_READ_BYTES, Services};
#[cfg(feature = "testkit")]
pub(crate) use loader::embedded_id;
pub(crate) use loader::{
    Catalog, GateEntry, GrantReport, Inputs, InstanceReport, LoadedPlugins, MountReport, Status,
    load,
};
pub use loader::{ORIGIN_KEY, TRUST_NOTE};
pub(crate) use manifest::to_json;
pub use manifest::{
    Bearer, CommandDecl, ComponentDecl, ConfigDecl, ContextDecl, Effect, Expose, GrantDecl,
    MAX_COMPONENT_BYTES, Manifest, MountDecl, MountTool, PackDecl, PipelineDecl, PipelineStep,
    PluginInfo, PluginKind, SchemaRef, SkillDecl, Transport,
};
#[cfg(feature = "mounted")]
pub use mounted::{InjectionHit, mount_command_name, scan_description, scan_schema_descriptions};
pub use packs::{MAX_PACK_BYTES, MAX_PACK_FILES, PackManifest, PackReport, check_pack};
pub(crate) use pipelines::PipelineState;
pub(crate) use skills::{LoadedSkill, ORIGIN_FILE, origin_file};
pub use skills::{MAX_SKILL_BYTES, MAX_SKILL_FILES, SkillReport, check_skill};
pub use source::{CompiledCatalog, ResolvedSource, SourceSpec, resolve_source};
pub use umbel_sdk::{HostError as ServiceError, HostServices, Level};

/// The manifest version this host reads (`manifest_version`).
pub const MANIFEST_VERSION: u32 = 1;
/// The plugin protocol version this host serves (`protocol`).
pub const PLUGIN_PROTOCOL_VERSION: u32 = 1;
/// The WIT world a component is built against.
pub const WIT_WORLD: &str = "umbel:plugin/plugin@1.0.0";
/// The pack manifest version (`pack_version`).
pub const PACK_VERSION: u32 = 1;

/// The file a plugin's manifest is read from, at the root of its source.
pub const MANIFEST_FILE: &str = "umbel-plugin.toml";

/// First name segments the host owns: no plugin command or prefix may use one.
pub const HOST_DOMAINS: &[&str] = &["workspace", "space", "event", "plugin", "skill", "afd"];

/// The grants phase 1 provides.
pub const GRANTS: &[&str] = &["config", "log", "packs", "events", "clock", "random"];

/// Grants the architecture names and this host refuses until their phase
/// (`PLUGIN_GRANT_UNAVAILABLE`), each with the phase that adds it.
pub const RESERVED_GRANTS: &[(&str, &str)] = &[
    ("documents", "phase 2"),
    ("index", "phase 2"),
    ("graph", "phase 2"),
    ("memory", "phase 3"),
    ("http", "the first plugin that needs outbound calls"),
    ("secrets", "the first plugin that needs secrets, by phase 5"),
];

/// Whether `name` is a grant of the catalog or one reserved for a later phase.
pub fn is_known_grant(name: &str) -> bool {
    GRANTS.contains(&name) || RESERVED_GRANTS.iter().any(|(grant, _)| *grant == name)
}

/// `^[a-z][a-z0-9]{0,31}$`: a plugin id, a domain, a mount prefix.
pub(crate) fn is_plugin_id(text: &str) -> bool {
    (1..=32).contains(&text.len())
        && text.starts_with(|c: char| c.is_ascii_lowercase())
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// `^[a-z][a-z0-9-]{0,max-1}$`: an instance id, a pack id, a skill name.
pub(crate) fn is_kebab_id(text: &str, max: usize) -> bool {
    (1..=max).contains(&text.len())
        && text.starts_with(|c: char| c.is_ascii_lowercase())
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Why `text` cannot be a domain or a mount prefix, if it cannot: the id rule, then the host's
/// own domains and the reserved CLI verbs.
pub(crate) fn domain_problem(text: &str) -> Option<String> {
    if !is_plugin_id(text) {
        return Some("must match ^[a-z][a-z0-9]{0,31}$".to_owned());
    }
    if HOST_DOMAINS.contains(&text) {
        return Some(format!("`{text}` is a host domain"));
    }
    if crate::RESERVED_VERBS.contains(&text) {
        return Some(format!("`{text}` is a reserved CLI verb"));
    }
    None
}

/// Whether `text` is a semantic version 2.0.0: `1.2.3`, with an optional `-pre` and `+build`.
pub(crate) fn is_semver(text: &str) -> bool {
    let (rest, build) = match text.split_once('+') {
        Some((rest, build)) => (rest, Some(build)),
        None => (text, None),
    };
    let (core, pre) = match rest.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (rest, None),
    };
    let numeric = |part: &str| {
        !part.is_empty()
            && part.chars().all(|c| c.is_ascii_digit())
            && (part == "0" || !part.starts_with('0'))
    };
    let identifier = |part: &str| {
        !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    };
    let core_ok = {
        let parts: Vec<&str> = core.split('.').collect();
        parts.len() == 3 && parts.iter().all(|part| numeric(part))
    };
    let pre_ok = pre.is_none_or(|pre| {
        pre.split('.').all(|part| {
            identifier(part) && (!part.chars().all(|c| c.is_ascii_digit()) || numeric(part))
        })
    });
    let build_ok = build.is_none_or(|build| build.split('.').all(identifier));
    core_ok && pre_ok && build_ok
}

#[cfg(test)]
mod tests {
    use super::is_semver;

    #[test]
    fn semantic_versions() {
        for ok in [
            "0.1.0",
            "1.2.3",
            "1.0.0-rc.1",
            "1.0.0+build.5",
            "1.0.0-a-b+c",
        ] {
            assert!(is_semver(ok), "{ok}");
        }
        for bad in [
            "1", "1.2", "01.2.3", "1.2.3.4", "1.2.3-", "1.2.3-01", "v1.2.3", "",
        ] {
            assert!(!is_semver(bad), "{bad}");
        }
    }
}
