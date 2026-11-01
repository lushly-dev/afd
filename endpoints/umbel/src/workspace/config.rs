//! `umbel.toml`, version 1: defaults, key scan and validation (specification section 2).

use std::net::SocketAddr;
use std::path::Path;

use toml::{Table, Value};

use super::error::WorkspaceError;
use super::space::SpaceId;

/// The configuration version this build reads.
pub const CONFIG_VERSION: u32 = 1;

const TOP_KEYS: &[&str] = &[
    "config_version",
    "name",
    "default_space",
    "profile",
    "spaces",
    "plugins",
    "mcp",
    "http",
    "journal",
    "events",
    "log",
    "principal",
];
const SPACE_KEYS: &[&str] = &["title"];
const SPACE_RESERVED: &[&str] = &["content_roots", "backend"];
const PLUGINS_KEYS: &[&str] = &["enabled"];
const MCP_KEYS: &[&str] = &[
    "first_class_tools",
    "tools_list_ttl_ms",
    "confirmations",
    "instructions",
];
const HTTP_KEYS: &[&str] = &[
    "bind",
    "path",
    "allowed_hosts",
    "allowed_origins",
    "max_body_bytes",
];
const JOURNAL_KEYS: &[&str] = &["record_failures", "lock_timeout_ms"];
const EVENTS_KEYS: &[&str] = &[];
const EVENTS_RESERVED: &[&str] = &["retention"];
const LOG_KEYS: &[&str] = &["level", "format"];
const PRINCIPAL_KEYS: &[&str] = &["local_id", "on_behalf_of"];

/// How the MCP surface and the CLI treat `confirm_prompt` commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confirmations {
    /// Confirmations are enforced (the default).
    Enforce,
    /// Only a human at a terminal can confirm.
    RequireHuman,
    /// Nothing is asked.
    Off,
}

/// The log line format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// Human-readable lines (the default).
    Text,
    /// JSON lines.
    Json,
}

/// One declared space.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct SpaceConfig {
    /// The space id.
    pub id: SpaceId,
    /// The title; the id when the file gives none.
    pub title: String,
}

/// `[plugins]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PluginsConfig {
    /// Must be empty in phase 0.
    pub enabled: Vec<String>,
}

/// `[mcp]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct McpConfig {
    /// The explicit first-class tools, or `None` for the computed default.
    pub first_class_tools: Option<Vec<String>>,
    /// How long a client may cache `tools/list`.
    pub tools_list_ttl_ms: u64,
    /// Confirmation policy.
    pub confirmations: Confirmations,
    /// Replacement for AFD's default instructions; empty keeps them.
    pub instructions: String,
}

/// `[http]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct HttpConfig {
    /// A loopback socket address.
    pub bind: SocketAddr,
    /// The MCP endpoint path.
    pub path: String,
    /// Extra accepted `Host` values.
    pub allowed_hosts: Vec<String>,
    /// Exact accepted `Origin` values.
    pub allowed_origins: Vec<String>,
    /// Request body cap.
    pub max_body_bytes: u64,
}

/// `[journal]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct JournalConfig {
    /// Whether failed calls are journaled.
    pub record_failures: bool,
    /// How long an append waits for the workspace lock.
    pub lock_timeout_ms: u64,
}

/// `[log]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct LogConfig {
    /// `error`, `warn`, `info`, `debug` or `trace`.
    pub level: String,
    /// The line format.
    pub format: LogFormat,
    /// A `tracing` filter from `--log` or `UMBEL_LOG`; it wins over `level`.
    pub filter_override: Option<String>,
}

impl LogConfig {
    /// The `tracing` filter directive to install.
    pub fn filter(&self) -> &str {
        self.filter_override.as_deref().unwrap_or(&self.level)
    }
}

/// `[principal]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PrincipalConfig {
    /// The actor id of the local CLI and stdio callers.
    pub local_id: String,
    /// The person a local agent acts for.
    pub on_behalf_of: Option<String>,
}

/// A validated `umbel.toml` with every default filled in.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Config {
    /// The workspace name.
    pub name: String,
    /// The space used when a call names none.
    pub default_space: SpaceId,
    /// Only `team` in phase 0.
    pub profile: String,
    /// The spaces, in configuration order.
    pub spaces: Vec<SpaceConfig>,
    /// `[plugins]`.
    pub plugins: PluginsConfig,
    /// `[mcp]`.
    pub mcp: McpConfig,
    /// `[http]`.
    pub http: HttpConfig,
    /// `[journal]`.
    pub journal: JournalConfig,
    /// `[log]`.
    pub log: LogConfig,
    /// `[principal]`.
    pub principal: PrincipalConfig,
}

/// Values that override the file: flags first, then environment variables.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Overrides {
    /// `--bind` or `UMBEL_HTTP_BIND`; still loopback only.
    pub http_bind: Option<String>,
    /// `--log` or `UMBEL_LOG`, a `tracing` filter.
    pub log_filter: Option<String>,
}

impl Overrides {
    /// The environment variables `UMBEL_HTTP_BIND` and `UMBEL_LOG`; an empty one counts as unset.
    pub fn from_env() -> Self {
        let read = |name| std::env::var(name).ok().filter(|value| !value.is_empty());
        Self {
            http_bind: read("UMBEL_HTTP_BIND"),
            log_filter: read("UMBEL_LOG"),
        }
    }

    /// `self` where it has a value, else `lower`: `flags.or(Overrides::from_env())`.
    #[must_use]
    pub fn or(self, lower: Self) -> Self {
        Self {
            http_bind: self.http_bind.or(lower.http_bind),
            log_filter: self.log_filter.or(lower.log_filter),
        }
    }
}

/// Unknown and reserved keys found in a configuration file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KeyScan {
    /// Dotted paths of keys this version does not know.
    pub unknown: Vec<String>,
    /// Dotted paths of reserved keys that are set.
    pub reserved: Vec<String>,
}

/// A parsed `umbel.toml` whose syntax and `config_version` are right, before value validation.
#[derive(Debug, Clone)]
pub struct ConfigFile {
    table: Table,
}

impl ConfigFile {
    /// Parse `text`.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` for a syntax error or a missing or mistyped `config_version`;
    /// `WORKSPACE_CONFIG_UNSUPPORTED` for another version.
    pub fn parse(text: &str) -> Result<Self, WorkspaceError> {
        let table: Table = text.parse().map_err(|error: toml::de::Error| {
            let place = error.span().map(|span| {
                let line = text[..span.start.min(text.len())].matches('\n').count() + 1;
                format!(" (line {line})")
            });
            WorkspaceError::config_syntax(format!(
                "{}{}",
                error.message(),
                place.unwrap_or_default()
            ))
        })?;
        match table.get("config_version") {
            None => Err(WorkspaceError::config_invalid(
                "config_version",
                "is required; set config_version = 1",
            )),
            Some(Value::Integer(1)) => Ok(Self { table }),
            Some(Value::Integer(other)) => Err(WorkspaceError::config_unsupported(other)),
            Some(_) => Err(WorkspaceError::config_invalid(
                "config_version",
                "must be the integer 1",
            )),
        }
    }

    /// The unknown and reserved keys.
    pub fn scan_keys(&self) -> KeyScan {
        let mut scan = KeyScan::default();
        scan_table(&self.table, "", TOP_KEYS, &[], &mut scan);
        let sections: [(&str, &[&str], &[&str]); 7] = [
            ("plugins", PLUGINS_KEYS, &[]),
            ("mcp", MCP_KEYS, &[]),
            ("http", HTTP_KEYS, &[]),
            ("journal", JOURNAL_KEYS, &[]),
            ("events", EVENTS_KEYS, EVENTS_RESERVED),
            ("log", LOG_KEYS, &[]),
            ("principal", PRINCIPAL_KEYS, &[]),
        ];
        for (name, known, reserved) in sections {
            if let Some(Value::Table(table)) = self.table.get(name) {
                scan_table(table, name, known, reserved, &mut scan);
            }
        }
        if let Some(Value::Table(spaces)) = self.table.get("spaces") {
            for (id, value) in spaces {
                if let Value::Table(table) = value {
                    scan_table(
                        table,
                        &format!("spaces.{id}"),
                        SPACE_KEYS,
                        SPACE_RESERVED,
                        &mut scan,
                    );
                }
            }
        }
        scan
    }

    /// Validate every value and fill every default.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming the first key that breaks a rule.
    pub fn into_config(self, root: &Path) -> Result<Config, WorkspaceError> {
        if let Some(key) = self.scan_keys().unknown.into_iter().next() {
            return Err(WorkspaceError::config_invalid(&key, "is not a known key"));
        }
        let general = self.general(root)?;
        let (spaces, default_space) = self.spaces()?;
        let plugins = self.plugins()?;
        let rest = self.rest()?;
        let http = self.http()?;
        Ok(Config {
            name: general.0,
            profile: general.1,
            default_space,
            spaces,
            plugins,
            mcp: rest.mcp,
            http,
            journal: rest.journal,
            log: rest.log,
            principal: rest.principal,
        })
    }

    /// Every rule outside `[spaces]`, `[http]` and `[plugins]`, which the doctor checks apart.
    pub(crate) fn validate_rest(&self, root: &Path) -> Result<(), WorkspaceError> {
        self.general(root)?;
        self.rest()?;
        Ok(())
    }

    pub(crate) fn spaces(&self) -> Result<(Vec<SpaceConfig>, SpaceId), WorkspaceError> {
        let mut spaces = Vec::new();
        match self.table.get("spaces") {
            None => {}
            Some(Value::Table(table)) => {
                for (id, value) in table {
                    let key = format!("spaces.{id}");
                    let space_id = SpaceId::parse(id)
                        .map_err(|problem| WorkspaceError::config_invalid(&key, problem))?;
                    let Value::Table(entry) = value else {
                        return Err(WorkspaceError::config_invalid(&key, "must be a table"));
                    };
                    let title = Reader::new(Some(entry), &key)
                        .string("title")?
                        .unwrap_or_else(|| id.clone());
                    spaces.push(SpaceConfig {
                        id: space_id,
                        title,
                    });
                }
            }
            Some(_) => return Err(WorkspaceError::config_invalid("spaces", "must be a table")),
        }
        if spaces.is_empty() {
            spaces.push(SpaceConfig {
                id: SpaceId::parse(SpaceId::MAIN)
                    .map_err(|p| WorkspaceError::config_invalid("spaces", p))?,
                title: SpaceId::MAIN.to_owned(),
            });
        }
        let default_space = match Reader::new(Some(&self.table), "").string("default_space")? {
            Some(value) => {
                let id = SpaceId::parse(&value)
                    .map_err(|problem| WorkspaceError::config_invalid("default_space", problem))?;
                if !spaces.iter().any(|space| space.id == id) {
                    return Err(WorkspaceError::config_invalid(
                        "default_space",
                        format!("names `{id}`, which no [spaces.{id}] table declares"),
                    ));
                }
                id
            }
            None if spaces.len() == 1 => spaces[0].id.clone(),
            None => {
                return Err(WorkspaceError::config_invalid(
                    "default_space",
                    "is required when several spaces are declared",
                ));
            }
        };
        Ok((spaces, default_space))
    }

    pub(crate) fn plugins(&self) -> Result<PluginsConfig, WorkspaceError> {
        let enabled = Reader::new(self.section("plugins")?, "plugins")
            .string_array("enabled")?
            .unwrap_or_default();
        if !enabled.is_empty() {
            return Err(WorkspaceError::config_invalid(
                "plugins.enabled",
                "must be empty in phase 0; plugins arrive in phase 1",
            ));
        }
        Ok(PluginsConfig { enabled })
    }

    pub(crate) fn http(&self) -> Result<HttpConfig, WorkspaceError> {
        let reader = Reader::new(self.section("http")?, "http");
        let bind = reader
            .string("bind")?
            .unwrap_or_else(|| "127.0.0.1:7410".to_owned());
        let path = reader.string("path")?.unwrap_or_else(|| "/mcp".to_owned());
        let allowed_hosts = reader.string_array("allowed_hosts")?.unwrap_or_default();
        let allowed_origins = reader.string_array("allowed_origins")?.unwrap_or_default();
        let max_body_bytes = reader
            .integer("max_body_bytes", 1024, 16_777_216)?
            .unwrap_or(1_048_576);
        for host in &allowed_hosts {
            check_host(host)
                .map_err(|p| WorkspaceError::config_invalid("http.allowed_hosts", p))?;
        }
        for origin in &allowed_origins {
            check_origin(origin)
                .map_err(|p| WorkspaceError::config_invalid("http.allowed_origins", p))?;
        }
        check_path(&path).map_err(|p| WorkspaceError::config_invalid("http.path", p))?;
        Ok(HttpConfig {
            bind: parse_bind(&bind, "umbel.toml")?,
            path,
            allowed_hosts,
            allowed_origins,
            max_body_bytes,
        })
    }

    fn general(&self, root: &Path) -> Result<(String, String), WorkspaceError> {
        let reader = Reader::new(Some(&self.table), "");
        let name = match reader.string("name")? {
            Some(name) if name.is_empty() || name.chars().any(char::is_control) => {
                return Err(WorkspaceError::config_invalid(
                    "name",
                    "must be non-empty text without control characters",
                ));
            }
            Some(name) => name,
            None => root.file_name().map_or_else(
                || "umbel".to_owned(),
                |name| name.to_string_lossy().into_owned(),
            ),
        };
        let profile = reader
            .string("profile")?
            .unwrap_or_else(|| "team".to_owned());
        if profile != "team" {
            return Err(WorkspaceError::config_invalid(
                "profile",
                "must be \"team\" in phase 0",
            ));
        }
        Ok((name, profile))
    }

    fn rest(&self) -> Result<Rest, WorkspaceError> {
        let mcp = Reader::new(self.section("mcp")?, "mcp");
        let first_class_tools = mcp.string_array("first_class_tools")?;
        if let Some(tools) = &first_class_tools {
            if !(1..=8).contains(&tools.len()) {
                return Err(WorkspaceError::config_invalid(
                    "mcp.first_class_tools",
                    format!("must hold 1 to 8 command names, not {}", tools.len()),
                ));
            }
            for tool in tools {
                afd::validate_command_name(tool).map_err(|problem| {
                    WorkspaceError::config_invalid("mcp.first_class_tools", problem)
                })?;
            }
        }
        let confirmations = match mcp.string("confirmations")?.as_deref() {
            None | Some("enforce") => Confirmations::Enforce,
            Some("require-human") => Confirmations::RequireHuman,
            Some("off") => Confirmations::Off,
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    "mcp.confirmations",
                    "must be \"enforce\", \"require-human\" or \"off\"",
                ));
            }
        };
        let mcp = McpConfig {
            first_class_tools,
            tools_list_ttl_ms: mcp
                .integer("tools_list_ttl_ms", 0, i64::MAX)?
                .unwrap_or(300_000),
            confirmations,
            instructions: mcp.string("instructions")?.unwrap_or_default(),
        };

        let journal = Reader::new(self.section("journal")?, "journal");
        let journal = JournalConfig {
            record_failures: journal.boolean("record_failures")?.unwrap_or(true),
            lock_timeout_ms: journal
                .integer("lock_timeout_ms", 100, 600_000)?
                .unwrap_or(10_000),
        };

        let log = Reader::new(self.section("log")?, "log");
        let level = log.string("level")?.unwrap_or_else(|| "info".to_owned());
        if !["error", "warn", "info", "debug", "trace"].contains(&level.as_str()) {
            return Err(WorkspaceError::config_invalid(
                "log.level",
                "must be \"error\", \"warn\", \"info\", \"debug\" or \"trace\"",
            ));
        }
        let format = match log.string("format")?.as_deref() {
            None | Some("text") => LogFormat::Text,
            Some("json") => LogFormat::Json,
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    "log.format",
                    "must be \"text\" or \"json\"",
                ));
            }
        };
        let log = LogConfig {
            level,
            format,
            filter_override: None,
        };

        let principal = Reader::new(self.section("principal")?, "principal");
        let local_id = principal
            .string("local_id")?
            .unwrap_or_else(|| "local".to_owned());
        let length = local_id.chars().count();
        if !(1..=128).contains(&length) || local_id.chars().any(char::is_control) {
            return Err(WorkspaceError::config_invalid(
                "principal.local_id",
                "must be 1 to 128 printable characters",
            ));
        }
        let on_behalf_of = principal.string("on_behalf_of")?;
        if on_behalf_of.as_deref().is_some_and(str::is_empty) {
            return Err(WorkspaceError::config_invalid(
                "principal.on_behalf_of",
                "must not be empty",
            ));
        }
        Ok(Rest {
            mcp,
            journal,
            log,
            principal: PrincipalConfig {
                local_id,
                on_behalf_of,
            },
        })
    }

    fn section(&self, name: &str) -> Result<Option<&Table>, WorkspaceError> {
        match self.table.get(name) {
            None => Ok(None),
            Some(Value::Table(table)) => Ok(Some(table)),
            Some(_) => Err(WorkspaceError::config_invalid(name, "must be a table")),
        }
    }
}

struct Rest {
    mcp: McpConfig,
    journal: JournalConfig,
    log: LogConfig,
    principal: PrincipalConfig,
}

impl Config {
    /// Apply flag and environment overrides.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` when the bind override is not a loopback socket address.
    pub fn with_overrides(mut self, overrides: &Overrides) -> Result<Self, WorkspaceError> {
        if let Some(bind) = &overrides.http_bind {
            self.http.bind = parse_bind(bind, "--bind or UMBEL_HTTP_BIND")?;
        }
        if let Some(filter) = &overrides.log_filter {
            self.log.filter_override = Some(filter.clone());
        }
        Ok(self)
    }
}

fn parse_bind(value: &str, source: &str) -> Result<SocketAddr, WorkspaceError> {
    let address: SocketAddr = value.parse().map_err(|_| {
        WorkspaceError::config_invalid(
            "http.bind",
            format!(
                "must be a socket address such as 127.0.0.1:7410, not `{value}` (from {source})"
            ),
        )
    })?;
    if address.ip().is_loopback() {
        Ok(address)
    } else {
        Err(WorkspaceError::config_invalid(
            "http.bind",
            format!(
                "must be a loopback address (127.0.0.0/8 or ::1), not `{value}` (from {source}); non-loopback HTTP arrives with phase 5"
            ),
        ))
    }
}

fn check_path(path: &str) -> Result<(), String> {
    if !path.starts_with('/') || path == "/" || path == "/health" {
        return Err("must start with \"/\" and be neither \"/\" nor \"/health\"".to_owned());
    }
    if path.contains(['?', '#']) || path.split('/').any(|segment| segment == "..") {
        return Err("must not hold a query, a fragment or a \"..\" segment".to_owned());
    }
    Ok(())
}

/// A host name or IP literal, optionally with a port; an IPv6 literal is bracketed.
fn check_host(entry: &str) -> Result<(), String> {
    let bad = |why: &str| Err(format!("entry `{entry}` {why}"));
    if entry.contains('*') {
        return bad("holds a wildcard, which is refused");
    }
    let (host, port) = if let Some(rest) = entry.strip_prefix('[') {
        match rest.split_once(']') {
            Some((ip, tail)) if ip.parse::<std::net::Ipv6Addr>().is_ok() => (
                ip,
                tail.strip_prefix(':')
                    .or_else(|| tail.is_empty().then_some("")),
            ),
            _ => return bad("is not a bracketed IPv6 literal"),
        }
    } else {
        match entry.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (entry, Some("")),
        }
    };
    let Some(port) = port else {
        return bad("is not host, host:port or [ipv6]:port");
    };
    let host_ok = !host.is_empty()
        && (host.parse::<std::net::Ipv6Addr>().is_ok()
            || host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'));
    if !host_ok || !(port.is_empty() || port.parse::<u16>().is_ok()) {
        return bad("is not a host name or IP literal with an optional port");
    }
    Ok(())
}

/// An exact `http` or `https` origin: scheme, host and optional port, nothing else.
fn check_origin(entry: &str) -> Result<(), String> {
    if entry == "*" || entry == "null" {
        return Err(format!("entry `{entry}` is refused"));
    }
    let authority = entry
        .strip_prefix("http://")
        .or_else(|| entry.strip_prefix("https://"))
        .ok_or_else(|| format!("entry `{entry}` must be an exact http or https origin"))?;
    if authority.contains(['/', '?', '#', '@']) {
        return Err(format!(
            "entry `{entry}` must hold only a scheme, a host and an optional port"
        ));
    }
    check_host(authority)
        .map_err(|_| format!("entry `{entry}` must be an exact http or https origin"))
}

fn scan_table(table: &Table, prefix: &str, known: &[&str], reserved: &[&str], scan: &mut KeyScan) {
    for key in table.keys() {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        if reserved.contains(&key.as_str()) {
            scan.reserved.push(path);
        } else if !known.contains(&key.as_str()) {
            scan.unknown.push(path);
        }
    }
}

/// Typed access to one table, naming the dotted key in every error.
struct Reader<'a> {
    table: Option<&'a Table>,
    prefix: &'a str,
}

impl<'a> Reader<'a> {
    fn new(table: Option<&'a Table>, prefix: &'a str) -> Self {
        Self { table, prefix }
    }

    fn path(&self, key: &str) -> String {
        if self.prefix.is_empty() {
            key.to_owned()
        } else {
            format!("{}.{key}", self.prefix)
        }
    }

    fn value(&self, key: &str) -> Option<&'a Value> {
        self.table.and_then(|table| table.get(key))
    }

    fn string(&self, key: &str) -> Result<Option<String>, WorkspaceError> {
        match self.value(key) {
            None => Ok(None),
            Some(Value::String(value)) => Ok(Some(value.clone())),
            Some(_) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                "must be a string",
            )),
        }
    }

    fn boolean(&self, key: &str) -> Result<Option<bool>, WorkspaceError> {
        match self.value(key) {
            None => Ok(None),
            Some(Value::Boolean(value)) => Ok(Some(*value)),
            Some(_) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                "must be true or false",
            )),
        }
    }

    fn integer(&self, key: &str, min: i64, max: i64) -> Result<Option<u64>, WorkspaceError> {
        match self.value(key) {
            None => Ok(None),
            Some(Value::Integer(value)) if (min..=max).contains(value) => {
                Ok(Some(u64::try_from(*value).unwrap_or_default()))
            }
            Some(Value::Integer(_)) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                format!("must be between {min} and {max}"),
            )),
            Some(_) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                "must be an integer",
            )),
        }
    }

    fn string_array(&self, key: &str) -> Result<Option<Vec<String>>, WorkspaceError> {
        match self.value(key) {
            None => Ok(None),
            Some(Value::Array(items)) => items
                .iter()
                .map(|item| match item {
                    Value::String(value) => Ok(value.clone()),
                    _ => Err(WorkspaceError::config_invalid(
                        &self.path(key),
                        "must hold only strings",
                    )),
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some),
            Some(_) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                "must be an array of strings",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(text: &str) -> Result<Config, WorkspaceError> {
        ConfigFile::parse(text)?.into_config(Path::new("/w/my-team"))
    }

    #[test]
    fn the_minimal_file_is_a_complete_workspace() {
        let config = config("config_version = 1").unwrap();
        assert_eq!(config.name, "my-team");
        assert_eq!(config.default_space.as_str(), "main");
        assert_eq!(config.spaces.len(), 1);
        assert_eq!(config.spaces[0].title, "main");
        assert_eq!(config.http.bind.to_string(), "127.0.0.1:7410");
        assert_eq!(config.http.path, "/mcp");
        assert_eq!(config.mcp.tools_list_ttl_ms, 300_000);
        assert_eq!(config.mcp.confirmations, Confirmations::Enforce);
        assert_eq!(config.journal.lock_timeout_ms, 10_000);
        assert_eq!(config.principal.local_id, "local");
        assert_eq!(config.log.filter(), "info");
    }

    #[test]
    fn spaces_keep_the_files_order_and_the_only_space_is_the_default() {
        let several =
            config("config_version = 1\ndefault_space = \"b\"\n[spaces.z]\n[spaces.b]\n[spaces.a]")
                .unwrap();
        let ids: Vec<_> = several.spaces.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["z", "b", "a"]);
        let only = config("config_version = 1\n[spaces.solo]\ntitle = \"Solo\"").unwrap();
        assert_eq!(only.default_space.as_str(), "solo");
        assert_eq!(only.spaces[0].title, "Solo");
    }

    #[test]
    fn overrides_prefer_the_flag_over_the_environment() {
        let flags = Overrides {
            http_bind: Some("127.0.0.1:1".into()),
            log_filter: None,
        };
        let env = Overrides {
            http_bind: Some("127.0.0.1:2".into()),
            log_filter: Some("debug".into()),
        };
        let merged = flags.or(env);
        assert_eq!(merged.http_bind.as_deref(), Some("127.0.0.1:1"));
        assert_eq!(merged.log_filter.as_deref(), Some("debug"));
    }

    #[test]
    fn host_and_origin_entries() {
        for ok in [
            "localhost",
            "umbel.local:7410",
            "127.0.0.2",
            "[::1]",
            "[::1]:7410",
        ] {
            assert!(check_host(ok).is_ok(), "{ok}");
        }
        for bad in [
            "*",
            "*.example.test",
            "",
            "a b",
            "[::1",
            "host:port",
            "::1",
            "a/b",
        ] {
            assert!(check_host(bad).is_err(), "{bad}");
        }
        for ok in ["http://localhost:3000", "https://example.test"] {
            assert!(check_origin(ok).is_ok(), "{ok}");
        }
        for bad in [
            "*",
            "null",
            "ftp://x",
            "https://x/",
            "https://x/path",
            "example.test",
        ] {
            assert!(check_origin(bad).is_err(), "{bad}");
        }
    }
}
