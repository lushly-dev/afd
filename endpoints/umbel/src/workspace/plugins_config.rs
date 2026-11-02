//! `[plugins]` of `umbel.toml`, configuration version 2 (phase 1 specification, section 9.1).
//!
//! Version 2 adds the plugin instances: `plugins.enabled` lists their ids in load order, and an
//! optional `[plugins.<id>]` table per instance holds its source, spaces, denied grants,
//! configuration and limits. Version 1 has no plugins: its `enabled` must stay empty.
//!
//! Everything here is a rule that needs no manifest. The rules that need the plugin's kind (a
//! limit on a mounted plugin, a `url` on a stdio mount) are checked where the manifest is read.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};

use serde_json::Value as Json;
use toml::{Table, Value};

use super::config::{ConfigFile, Reader};
use super::error::WorkspaceError;
use super::space::SpaceId;
use crate::plugins::{SourceSpec, domain_problem, is_kebab_id, is_known_grant, to_json};

/// The instance keys.
pub(super) const INSTANCE_KEYS: &[&str] = &[
    "source",
    "required",
    "spaces",
    "deny",
    "config",
    "limits",
    "prefix",
    "url",
    "bearer_env",
    "connect_timeout_ms",
    "timeout_ms",
    "max_result_bytes",
    "env",
];
/// The instance keys of configuration version 3, which adds `grants`.
pub(super) const INSTANCE_KEYS_V3: &[&str] = &[
    "source",
    "required",
    "spaces",
    "deny",
    "config",
    "limits",
    "prefix",
    "url",
    "bearer_env",
    "connect_timeout_ms",
    "timeout_ms",
    "max_result_bytes",
    "env",
    "grants",
];
/// `grants.<grant>.allow`: the per-instance allow-list of the write grants (D42). Named in
/// versions 1 and 2, where it is accepted and reported but means nothing; configuration version 3
/// reads it.
pub(super) const INSTANCE_RESERVED: &[&str] = &["grants"];
/// The keys of one `grants.<grant>` table.
pub(super) const GRANT_KEYS: &[&str] = &["allow"];
/// The component limits.
pub(super) const LIMITS_KEYS: &[&str] = &["fuel", "timeout_ms", "memory_bytes", "table_elements"];

/// The host caps on a component's per-call limits (specification section 6.2).
pub mod caps {
    /// `limits.fuel`.
    pub const FUEL: u64 = 20_000_000_000;
    /// `limits.timeout_ms`.
    pub const TIMEOUT_MS: u64 = 60_000;
    /// `limits.memory_bytes`.
    pub const MEMORY_BYTES: u64 = 1_073_741_824;
    /// `limits.table_elements`.
    pub const TABLE_ELEMENTS: u64 = 1_000_000;
    /// A mount's `connect_timeout_ms`.
    pub const CONNECT_TIMEOUT_MS: u64 = 60_000;
    /// A mount's `timeout_ms`.
    pub const CALL_TIMEOUT_MS: u64 = 300_000;
    /// A mount's `max_result_bytes`.
    pub const RESULT_BYTES: u64 = 16 * 1024 * 1024;
}

/// A component's per-call limits as the deployer set them; `None` means the host default.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct Limits {
    /// Instructions of fuel.
    pub fuel: Option<u64>,
    /// The epoch deadline.
    pub timeout_ms: Option<u64>,
    /// Bytes per linear memory.
    pub memory_bytes: Option<u64>,
    /// Elements per table.
    pub table_elements: Option<u64>,
}

/// One entry of `plugins.enabled`: a plugin, its source, its configuration and its spaces.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct PluginInstance {
    /// The instance id; the plugin id by default.
    pub id: String,
    /// `compiled:<id>` or a workspace directory; `None` is the default rule.
    pub source: Option<String>,
    /// Whether a failed load stops the host; `None` is the kind's default.
    pub required: Option<bool>,
    /// The spaces the instance is enabled for; `None` is every declared space.
    pub spaces: Option<Vec<SpaceId>>,
    /// Grants withheld.
    pub deny: Vec<String>,
    /// `[plugins.<id>.grants.<grant>] allow`, configuration version 3: what each write grant may
    /// reach. `content_write` and `documents_write` list `<space>/<collection>` or `<space>/*`;
    /// `records_write`, `index_write` and `graph_write` list `<space>` or `*`.
    pub allow: BTreeMap<String, Vec<String>>,
    /// The instance configuration, an object.
    pub config: Json,
    /// A component's limits.
    pub limits: Limits,
    /// A mounted instance's prefix, replacing the plugin's domain.
    pub prefix: Option<String>,
    /// An HTTP mount's URL: https, or http on a loopback address.
    pub url: Option<String>,
    /// The environment variable that holds an HTTP mount's bearer token.
    pub bearer_env: Option<String>,
    /// A mount's connection timeout.
    pub connect_timeout_ms: Option<u64>,
    /// A mount's call timeout.
    pub timeout_ms: Option<u64>,
    /// A mount's result cap.
    pub max_result_bytes: Option<u64>,
    /// A stdio mount's added environment.
    pub env: BTreeMap<String, String>,
}

impl PluginInstance {
    /// The spaces the instance is enabled for, given the declared ones.
    pub fn enabled_spaces<'a>(&'a self, declared: &'a [SpaceId]) -> &'a [SpaceId] {
        self.spaces.as_deref().unwrap_or(declared)
    }
}

/// `[plugins]`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct PluginsConfig {
    /// The instance ids, in load order.
    pub enabled: Vec<String>,
    /// The instances, in `enabled` order.
    pub instances: Vec<PluginInstance>,
}

impl ConfigFile {
    pub(crate) fn plugins(&self) -> Result<PluginsConfig, WorkspaceError> {
        let section = self.section("plugins")?;
        let enabled = Reader::new(section, "plugins")
            .string_array("enabled")?
            .unwrap_or_default();
        if self.version() == 1 {
            if !enabled.is_empty() {
                return Err(WorkspaceError::config_invalid(
                    "plugins.enabled",
                    "must be empty in configuration version 1; set config_version = 2 to enable plugins",
                ));
            }
            return Ok(PluginsConfig {
                enabled,
                instances: Vec::new(),
            });
        }
        // Spaces that do not validate are `spaces.valid`'s to report, not this check's.
        let declared: Option<Vec<SpaceId>> = self
            .spaces()
            .ok()
            .map(|(spaces, _)| spaces.into_iter().map(|space| space.id).collect());
        let empty = Table::new();
        let section = section.unwrap_or(&empty);
        for (index, id) in enabled.iter().enumerate() {
            let key = "plugins.enabled";
            if id == "enabled" {
                return Err(WorkspaceError::config_invalid(
                    key,
                    "must not name an instance `enabled`: [plugins.enabled] would collide with the list",
                ));
            }
            if !is_kebab_id(id, 32) {
                return Err(WorkspaceError::config_invalid(
                    key,
                    format!("entry `{id}` must match ^[a-z][a-z0-9-]{{0,31}}$"),
                ));
            }
            if enabled[..index].contains(id) {
                return Err(WorkspaceError::config_invalid(
                    key,
                    format!("names `{id}` twice"),
                ));
            }
        }
        for (id, value) in section {
            if id == "enabled" || enabled.contains(id) {
                continue;
            }
            let key = format!("plugins.{id}");
            return Err(WorkspaceError::config_invalid(
                &key,
                match value {
                    Value::Table(_) => "is configured but not listed in plugins.enabled",
                    _ => "is not a known key",
                },
            ));
        }
        if let Some(key) = self
            .scan_keys()
            .unknown
            .into_iter()
            .find(|key| key.starts_with("plugins."))
        {
            return Err(WorkspaceError::config_invalid(&key, "is not a known key"));
        }
        let instances = enabled
            .iter()
            .map(|id| instance(id, section.get(id), declared.as_deref(), self.version()))
            .collect::<Result<Vec<_>, _>>()?;
        for (index, instance) in instances.iter().enumerate() {
            if let Some(prefix) = &instance.prefix
                && instances[..index]
                    .iter()
                    .any(|other| other.prefix.as_ref() == Some(prefix))
            {
                return Err(WorkspaceError::config_invalid(
                    &format!("plugins.{}.prefix", instance.id),
                    format!("`{prefix}` is the prefix of another instance"),
                ));
            }
        }
        Ok(PluginsConfig { enabled, instances })
    }
}

fn instance(
    id: &str,
    value: Option<&Value>,
    declared: Option<&[SpaceId]>,
    version: u32,
) -> Result<PluginInstance, WorkspaceError> {
    let prefix_key = format!("plugins.{id}");
    let table = match value {
        None => None,
        Some(Value::Table(table)) => Some(table),
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &prefix_key,
                "must be a table",
            ));
        }
    };
    let reader = Reader::new(table, &prefix_key);
    let invalid = |key: &str, problem: &str| {
        WorkspaceError::config_invalid(&format!("{prefix_key}.{key}"), problem)
    };

    let source = reader.string("source")?;
    if let Some(source) = &source {
        SourceSpec::parse(source).map_err(|problem| invalid("source", &problem))?;
    }
    let spaces = reader.string_array("spaces")?;
    let spaces = match spaces {
        None => None,
        Some(names) => {
            if names.is_empty() {
                return Err(invalid("spaces", "must name at least one space"));
            }
            let mut ids: Vec<SpaceId> = Vec::new();
            for name in &names {
                let space = SpaceId::parse(name)
                    .map_err(|problem| invalid("spaces", &format!("entry `{name}` {problem}")))?;
                if ids.contains(&space) {
                    return Err(invalid("spaces", &format!("names `{name}` twice")));
                }
                if declared.is_some_and(|declared| !declared.contains(&space)) {
                    return Err(invalid(
                        "spaces",
                        &format!("names `{name}`, which no [spaces.{name}] table declares"),
                    ));
                }
                ids.push(space);
            }
            Some(ids)
        }
    };
    let deny = reader.string_array("deny")?.unwrap_or_default();
    for (index, grant) in deny.iter().enumerate() {
        if !is_known_grant(grant) {
            return Err(invalid("deny", &format!("entry `{grant}` is not a grant")));
        }
        if deny[..index].contains(grant) {
            return Err(invalid("deny", &format!("names `{grant}` twice")));
        }
    }
    let allow = if version >= 3 {
        allow_lists(table, &prefix_key, declared)?
    } else {
        BTreeMap::new()
    };
    let config = match table.and_then(|t| t.get("config")) {
        None => Json::Object(serde_json::Map::new()),
        Some(value @ Value::Table(_)) => to_json(value),
        Some(_) => return Err(invalid("config", "must be a table")),
    };
    let limits = limits(&reader, &prefix_key)?;
    let prefix = reader.string("prefix")?;
    if let Some(problem) = prefix.as_deref().and_then(domain_problem) {
        return Err(invalid("prefix", &problem));
    }
    let url = reader.string("url")?;
    if let Some(url) = &url {
        check_url(url).map_err(|problem| invalid("url", &problem))?;
    }
    let bearer_env = reader.string("bearer_env")?;
    if bearer_env.as_deref().is_some_and(|name| !is_env_name(name)) {
        return Err(invalid(
            "bearer_env",
            "must be an environment variable name such as TICKETS_TOKEN",
        ));
    }
    let mut env = BTreeMap::new();
    if let Some(vars) = table.and_then(|t| t.get("env")) {
        let Value::Table(vars) = vars else {
            return Err(invalid("env", "must be a table of strings"));
        };
        for (name, value) in vars {
            match value {
                Value::String(text) if is_env_name(name) && !text.contains('\0') => {
                    env.insert(name.clone(), text.clone());
                }
                _ => {
                    return Err(invalid(
                        "env",
                        &format!("`{name}` must be a variable name with a text value"),
                    ));
                }
            }
        }
    }
    Ok(PluginInstance {
        id: id.to_owned(),
        source,
        required: reader.boolean("required")?,
        spaces,
        deny,
        allow,
        config,
        limits,
        prefix,
        url,
        bearer_env,
        connect_timeout_ms: reader.integer(
            "connect_timeout_ms",
            1,
            to_i64(caps::CONNECT_TIMEOUT_MS),
        )?,
        timeout_ms: reader.integer("timeout_ms", 1, to_i64(caps::CALL_TIMEOUT_MS))?,
        max_result_bytes: reader.integer("max_result_bytes", 1, to_i64(caps::RESULT_BYTES))?,
        env,
    })
}

/// `grants.<grant>.allow` of one instance (configuration version 3).
fn allow_lists(
    table: Option<&Table>,
    prefix_key: &str,
    declared: Option<&[SpaceId]>,
) -> Result<BTreeMap<String, Vec<String>>, WorkspaceError> {
    let key = format!("{prefix_key}.grants");
    let grants = match table.and_then(|t| t.get("grants")) {
        None => return Ok(BTreeMap::new()),
        Some(Value::Table(grants)) => grants,
        Some(_) => return Err(WorkspaceError::config_invalid(&key, "must be a table")),
    };
    let mut lists = BTreeMap::new();
    for (grant, value) in grants {
        let grant_key = format!("{key}.{grant}");
        if !crate::plugins::needs_allow_list(grant) {
            return Err(WorkspaceError::config_invalid(
                &grant_key,
                format!(
                    "takes no allow list: only {} do",
                    crate::plugins::ALLOW_REQUIRED_GRANTS.join(", ")
                ),
            ));
        }
        let Value::Table(entry) = value else {
            return Err(WorkspaceError::config_invalid(
                &grant_key,
                "must be a table with an allow list",
            ));
        };
        if let Some(unknown) = entry.keys().find(|k| !GRANT_KEYS.contains(&k.as_str())) {
            return Err(WorkspaceError::config_invalid(
                &format!("{grant_key}.{unknown}"),
                "is not a known key; a grant table holds only `allow`",
            ));
        }
        let allow_key = format!("{grant_key}.allow");
        let entries = Reader::new(Some(entry), &grant_key)
            .string_array("allow")?
            .ok_or_else(|| {
                WorkspaceError::config_invalid(
                    &allow_key,
                    "is required: list what the grant may reach",
                )
            })?;
        if entries.is_empty() {
            return Err(WorkspaceError::config_invalid(
                &allow_key,
                "must name at least one entry",
            ));
        }
        for (index, text) in entries.iter().enumerate() {
            if entries[..index].contains(text) {
                return Err(WorkspaceError::config_invalid(
                    &allow_key,
                    format!("names `{text}` twice"),
                ));
            }
            let collection_level = matches!(grant.as_str(), "content_write" | "documents_write");
            let space = if collection_level {
                match text.split_once('/') {
                    Some((space, "*")) => space,
                    Some((space, collection)) if SpaceId::is_valid(collection) => space,
                    _ => {
                        return Err(WorkspaceError::config_invalid(
                            &allow_key,
                            format!("entry `{text}` must be <space>/<collection> or <space>/*"),
                        ));
                    }
                }
            } else if text == "*" {
                continue;
            } else {
                text.as_str()
            };
            if !SpaceId::is_valid(space) {
                return Err(WorkspaceError::config_invalid(
                    &allow_key,
                    if collection_level {
                        format!("entry `{text}` must be <space>/<collection> or <space>/*")
                    } else {
                        format!("entry `{text}` must be a space id or *")
                    },
                ));
            }
            if declared.is_some_and(|declared| !declared.iter().any(|d| d.as_str() == space)) {
                return Err(WorkspaceError::config_invalid(
                    &allow_key,
                    format!(
                        "entry `{text}` names `{space}`, which no [spaces.{space}] table declares"
                    ),
                ));
            }
        }
        lists.insert(grant.clone(), entries);
    }
    Ok(lists)
}

fn to_i64(cap: u64) -> i64 {
    i64::try_from(cap).unwrap_or(i64::MAX)
}

fn limits(instance: &Reader<'_>, prefix_key: &str) -> Result<Limits, WorkspaceError> {
    let key = format!("{prefix_key}.limits");
    let table = match instance.table_value("limits") {
        None => None,
        Some(Value::Table(table)) => Some(table),
        Some(_) => return Err(WorkspaceError::config_invalid(&key, "must be a table")),
    };
    let reader = Reader::new(table, &key);
    Ok(Limits {
        fuel: reader.integer("fuel", 1, to_i64(caps::FUEL))?,
        timeout_ms: reader.integer("timeout_ms", 1, to_i64(caps::TIMEOUT_MS))?,
        // One 64 KiB WebAssembly page is the smallest memory a component can have.
        memory_bytes: reader.integer("memory_bytes", 65_536, to_i64(caps::MEMORY_BYTES))?,
        table_elements: reader.integer("table_elements", 1, to_i64(caps::TABLE_ELEMENTS))?,
    })
}

fn is_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// An HTTP mount's URL: https, or http on a loopback address; no credentials in it.
fn check_url(url: &str) -> Result<(), String> {
    const SHAPE: &str = "must be an https URL, or an http URL on a loopback address";
    let (https, rest) = match (url.strip_prefix("https://"), url.strip_prefix("http://")) {
        (Some(rest), _) => (true, rest),
        (_, Some(rest)) => (false, rest),
        _ => return Err(SHAPE.to_owned()),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty()
        || authority.contains('@')
        || url.contains(char::is_whitespace)
        || url.contains('\0')
    {
        return Err("must hold a host, no credentials and no whitespace".to_owned());
    }
    let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
        let (ip, tail) = bracketed
            .split_once(']')
            .ok_or("holds an IPv6 literal that is not closed with ]")?;
        (ip, tail.strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    if port.is_some_and(|port| port.parse::<u16>().is_err()) {
        return Err("holds a port that is not a number up to 65535".to_owned());
    }
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c))
    {
        return Err("holds a host that is not a name or an IP literal".to_owned());
    }
    if https {
        return Ok(());
    }
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip == IpAddr::V4(Ipv4Addr::LOCALHOST));
    if loopback {
        Ok(())
    } else {
        Err(format!("{SHAPE}; `{host}` is not loopback"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_https_or_loopback_http() {
        for ok in [
            "https://tickets.example.com/mcp",
            "https://example.com:8443/mcp?x=1",
            "http://127.0.0.1:9000/mcp",
            "http://localhost/mcp",
            "http://[::1]:9000/mcp",
        ] {
            assert!(check_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://example.com/mcp",
            "ftp://x",
            "https://",
            "https://user:pw@example.com/",
            "https://example.com:99999/",
            "example.com/mcp",
            "http://[::1/mcp",
            "https://exa mple.com/",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }
}
