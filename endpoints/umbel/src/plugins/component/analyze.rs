//! What a compiled component imports and exports, read from its type before anything runs
//! (specification section 4): the world is identified by the versions of its
//! `umbel:plugin/command` export and its `umbel:plugin/*` imports, never by a recorded name, and
//! every import is checked against the grants the instance holds.

use wasmtime::Engine;
use wasmtime::component::Component;

use super::super::PluginError;

/// The newest `umbel:plugin` minor version this host provides (the world is 1.0.0).
const KNOWN_MINOR: u64 = 0;
/// The host serves this major version of `umbel:plugin` and of the WASI interfaces below 0.3.
const MAJOR: u64 = 1;

/// What the check learned.
#[derive(Debug)]
pub(super) struct Analysis {
    /// The name of the component's `umbel:plugin/command` export, with its version.
    pub(super) command_export: String,
    /// Whether the component imports `wasi:random/insecure-seed`, which the host can only answer
    /// from a value drawn when the call starts.
    pub(super) seeds: bool,
}

/// An interface name `namespace:package/interface@version`, taken apart.
struct Name<'a> {
    package: &'a str,
    interface: &'a str,
    version: Option<&'a str>,
}

fn split(name: &str) -> Option<Name<'_>> {
    let (path, version) = match name.split_once('@') {
        Some((path, version)) => (path, Some(version)),
        None => (name, None),
    };
    let (package, interface) = path.split_once('/')?;
    Some(Name {
        package,
        interface,
        version,
    })
}

/// `major.minor` of a semantic version.
fn major_minor(version: &str) -> Option<(u64, u64)> {
    let mut parts = version.split(['.', '-', '+']);
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

/// The grant a `umbel:plugin` interface needs; `Some(None)` is an interface that needs none.
fn umbel_grant(interface: &str) -> Option<Option<&'static str>> {
    match interface {
        "types" => Some(None),
        "config" => Some(Some("config")),
        "log" => Some(Some("log")),
        "packs" => Some(Some("packs")),
        "events" => Some(Some("events")),
        "clock" => Some(Some("clock")),
        "random" => Some(Some("random")),
        _ => None,
    }
}

/// The WASI 0.2 interfaces the host links, and the grant each needs. Sockets, HTTP and any
/// other interface are not here, so a component that imports one is refused.
fn wasi_grant(package: &str, interface: &str) -> Option<Option<&'static str>> {
    match (package, interface) {
        ("wasi:clocks", "wall-clock" | "monotonic-clock") => Some(Some("clock")),
        ("wasi:random", "random" | "insecure" | "insecure-seed") => Some(Some("random")),
        (
            "wasi:cli",
            "stdout" | "stderr" | "stdin" | "environment" | "exit" | "terminal-input"
            | "terminal-output" | "terminal-stdin" | "terminal-stdout" | "terminal-stderr",
        )
        | ("wasi:io", "error" | "poll" | "streams")
        | ("wasi:filesystem", "preopens" | "types") => Some(None),
        _ => None,
    }
}

/// Check `component` for instance `instance`; `holds` says which grants the instance holds.
pub(super) fn check(
    instance: &str,
    engine: &Engine,
    component: &Component,
    holds: impl Fn(&str) -> bool,
) -> Result<Analysis, PluginError> {
    let ty = component.component_type();
    let mut command_export = None;
    for (name, _) in ty.exports(engine) {
        let Some(parts) = split(name) else { continue };
        if parts.package != "umbel:plugin" || parts.interface != "command" {
            continue;
        }
        let (major, _) = parts.version.and_then(major_minor).ok_or_else(|| {
            PluginError::world_unsupported(
                instance,
                format!("the component exports `{name}`, which has no usable version"),
            )
        })?;
        if major != MAJOR {
            return Err(PluginError::world_unsupported(
                instance,
                format!(
                    "the component exports `{name}`; this host serves umbel:plugin@1.x (WIT_WORLD umbel:plugin/plugin@1.0.0)"
                ),
            ));
        }
        command_export = Some(name.to_owned());
    }
    let Some(command_export) = command_export else {
        return Err(PluginError::load_failed(
            instance,
            "the component has no `umbel:plugin/command` export: build it against umbel:plugin/plugin@1.0.0 (umbel-sdk's export_component!)",
        ));
    };

    let mut seeds = false;
    for (name, _) in ty.imports(engine) {
        let Some(parts) = split(name) else {
            return Err(PluginError::import_denied(instance, name, None));
        };
        let needs = match parts.package {
            "umbel:plugin" => {
                let (major, minor) = parts.version.and_then(major_minor).ok_or_else(|| {
                    PluginError::world_unsupported(
                        instance,
                        format!("the component imports `{name}`, which has no usable version"),
                    )
                })?;
                if major != MAJOR || minor > KNOWN_MINOR {
                    return Err(PluginError::world_unsupported(
                        instance,
                        format!(
                            "the component imports `{name}`; this host provides umbel:plugin@{MAJOR}.{KNOWN_MINOR} and nothing newer"
                        ),
                    ));
                }
                umbel_grant(parts.interface)
            }
            package if package.starts_with("wasi:") => {
                // WASI 0.2 only: a 0.3 component needs the async component model (D38).
                let zero_two = parts
                    .version
                    .and_then(major_minor)
                    .is_some_and(|version| version == (0, 2));
                if !zero_two {
                    return Err(PluginError::world_unsupported(
                        instance,
                        format!(
                            "the component imports `{name}`; this host links WASI 0.2 only (WASI 0.3 waits for world 2.0.0)"
                        ),
                    ));
                }
                seeds |= package == "wasi:random" && parts.interface == "insecure-seed";
                wasi_grant(package, parts.interface)
            }
            _ => None,
        };
        match needs {
            None => return Err(PluginError::import_denied(instance, name, None)),
            Some(Some(grant)) if !holds(grant) => {
                return Err(PluginError::import_denied(instance, name, Some(grant)));
            }
            Some(_) => {}
        }
    }
    Ok(Analysis {
        command_export,
        seeds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interface_names_split() {
        let name = split("wasi:cli/stdout@0.2.9").unwrap();
        assert_eq!(
            (name.package, name.interface, name.version),
            ("wasi:cli", "stdout", Some("0.2.9"))
        );
        assert!(split("plain-function").is_none());
        assert_eq!(major_minor("1.0.0"), Some((1, 0)));
        assert_eq!(major_minor("0.2.9"), Some((0, 2)));
        assert_eq!(major_minor("2.0.0-rc.1"), Some((2, 0)));
        assert_eq!(major_minor("1"), None);
    }

    #[test]
    fn only_the_listed_wasi_interfaces_are_provided() {
        assert_eq!(wasi_grant("wasi:clocks", "wall-clock"), Some(Some("clock")));
        assert_eq!(
            wasi_grant("wasi:random", "insecure-seed"),
            Some(Some("random"))
        );
        assert_eq!(wasi_grant("wasi:cli", "stderr"), Some(None));
        assert_eq!(wasi_grant("wasi:sockets", "tcp"), None);
        assert_eq!(wasi_grant("wasi:http", "outgoing-handler"), None);
        assert_eq!(umbel_grant("events"), Some(Some("events")));
        assert_eq!(umbel_grant("command"), None);
    }
}
