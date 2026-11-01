//! `umbel.toml`, versions 1, 2 and 3: defaults, key scan and validation (phase 0 specification
//! section 2; phase 1 section 9.1 adds the plugin instances of version 2; phase 2 section 4.1
//! adds the collections, readers, access groups and store of version 3).

use std::net::SocketAddr;
use std::path::Path;

use toml::{Table, Value};

use super::PluginsConfig;
use super::access::{AccessToken, ReaderEntry, check_member, is_group_id};
use super::error::WorkspaceError;
use super::plugins_config::{INSTANCE_KEYS, INSTANCE_RESERVED, LIMITS_KEYS};
use super::space::SpaceId;

/// The configuration version this build writes (`umbel init`). It also reads version 1, which
/// is version 2 with no plugins, and version 2, which is version 3 with no collections.
pub const CONFIG_VERSION: u32 = 3;

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
/// Top-level tables that exist only from version 3.
const TOP_KEYS_V3: &[&str] = &["access", "store"];
const SPACE_KEYS: &[&str] = &["title"];
const SPACE_KEYS_V3: &[&str] = &["title", "readers", "collections"];
const SPACE_RESERVED: &[&str] = &["content_roots", "backend"];
const SPACE_RESERVED_V3: &[&str] = &["backend"];
const COLLECTION_KEYS: &[&str] = &[
    "root",
    "kind",
    "include",
    "exclude",
    "access",
    "sensitivity",
    "default_type",
    "strict",
    "max_file_bytes",
];
const ACCESS_KEYS: &[&str] = &["groups"];
const GROUP_KEYS: &[&str] = &["members"];
const STORE_KEYS: &[&str] = &["lock_timeout_ms"];

/// A collection's default `max_file_bytes` (1 MiB) and its cap (16 MiB).
pub const DEFAULT_MAX_FILE_BYTES: u64 = 1_048_576;
const MAX_FILE_BYTES_CAP: u64 = 16_777_216;
/// The default `store.lock_timeout_ms`.
pub const DEFAULT_STORE_LOCK_TIMEOUT_MS: u64 = 5_000;
const MARKDOWN_INCLUDE: &[&str] = &["**/*.md"];
const CODE_INCLUDE: &[&str] = &[
    "**/*.rs", "**/*.py", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs",
];
const SENSITIVITIES: &[&str] = &["public", "internal", "confidential", "restricted"];
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

/// What a collection holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollectionKind {
    /// Markdown documents with frontmatter (the default).
    Markdown,
    /// Source files.
    Code,
}

impl CollectionKind {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Code => "code",
        }
    }
}

/// One collection of a space (`[spaces.<id>.collections.<cid>]`, D52): a content root and the
/// defaults of the documents under it.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct CollectionConfig {
    /// The collection id.
    pub id: String,
    /// The root as written: relative to the workspace, resolving inside it.
    pub root: String,
    /// Markdown or code.
    pub kind: CollectionKind,
    /// Globset patterns of the files to read; the kind's default when the file gives none.
    pub include: Vec<String>,
    /// Globset patterns of the files to skip.
    pub exclude: Vec<String>,
    /// The default access set of the collection's documents (tokens, section 6).
    pub access: Vec<String>,
    /// The default sensitivity of its documents.
    pub sensitivity: String,
    /// The type of a file without frontmatter or without `type`.
    pub default_type: String,
    /// Whether a file whose frontmatter fails the schema is skipped.
    pub strict: bool,
    /// The largest file read, in bytes.
    pub max_file_bytes: u64,
}

/// One declared space.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct SpaceConfig {
    /// The space id.
    pub id: SpaceId,
    /// The title; the id when the file gives none.
    pub title: String,
    /// Who may read the space: `*`, a principal string or `group:<id>`. `["*"]` by default.
    pub readers: Vec<String>,
    /// The space's collections, in configuration order; none in versions 1 and 2.
    pub collections: Vec<CollectionConfig>,
}

/// `[access.groups.<id>]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct AccessGroup {
    /// The group id.
    pub id: String,
    /// Principal strings, or `*`.
    pub members: Vec<String>,
}

/// `[access]`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct AccessConfig {
    /// The groups, in configuration order.
    pub groups: Vec<AccessGroup>,
}

/// `[store]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct StoreConfig {
    /// SQLite's busy timeout and the wait for tantivy's writer.
    pub lock_timeout_ms: u64,
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
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Config {
    /// The `config_version` the file declared: 1, 2 with plugin instances, or 3 with
    /// collections, access groups and a store.
    pub version: u32,
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
    /// `[access]`.
    pub access: AccessConfig,
    /// `[store]`.
    pub store: StoreConfig,
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
    version: u32,
}

impl ConfigFile {
    /// Parse `text`.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` for a syntax error or a missing or mistyped `config_version`;
    /// `WORKSPACE_CONFIG_UNSUPPORTED` for a version other than 1, 2 and 3.
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
                "is required; set config_version = 3",
            )),
            Some(Value::Integer(version @ (1..=3))) => {
                let version = u32::try_from(*version).unwrap_or(CONFIG_VERSION);
                Ok(Self { table, version })
            }
            Some(Value::Integer(other)) => Err(WorkspaceError::config_unsupported(other)),
            Some(_) => Err(WorkspaceError::config_invalid(
                "config_version",
                "must be the integer 1, 2 or 3",
            )),
        }
    }

    /// The `config_version` of the file: 1, 2 or 3.
    pub fn version(&self) -> u32 {
        self.version
    }

    /// The unknown and reserved keys.
    pub fn scan_keys(&self) -> KeyScan {
        let mut scan = KeyScan::default();
        let v3 = self.version == 3;
        let top: Vec<&str> = TOP_KEYS
            .iter()
            .chain(TOP_KEYS_V3.iter().filter(|_| v3))
            .copied()
            .collect();
        scan_table(&self.table, "", &top, &[], &mut scan);
        let mut sections: Vec<(&str, &[&str], &[&str])> = vec![
            ("mcp", MCP_KEYS, &[]),
            ("http", HTTP_KEYS, &[]),
            ("journal", JOURNAL_KEYS, &[]),
            ("events", EVENTS_KEYS, EVENTS_RESERVED),
            ("log", LOG_KEYS, &[]),
            ("principal", PRINCIPAL_KEYS, &[]),
        ];
        if v3 {
            sections.push(("access", ACCESS_KEYS, &[]));
            sections.push(("store", STORE_KEYS, &[]));
        }
        for (name, known, reserved) in sections {
            if let Some(Value::Table(table)) = self.table.get(name) {
                scan_table(table, name, known, reserved, &mut scan);
            }
        }
        if v3
            && let Some(Value::Table(access)) = self.table.get("access")
            && let Some(Value::Table(groups)) = access.get("groups")
        {
            for (id, value) in groups {
                if let Value::Table(table) = value {
                    scan_table(
                        table,
                        &format!("access.groups.{id}"),
                        GROUP_KEYS,
                        &[],
                        &mut scan,
                    );
                }
            }
        }
        if let Some(Value::Table(plugins)) = self.table.get("plugins") {
            self.scan_plugins(plugins, &mut scan);
        }
        if let Some(Value::Table(spaces)) = self.table.get("spaces") {
            let (known, reserved) = if v3 {
                (SPACE_KEYS_V3, SPACE_RESERVED_V3)
            } else {
                (SPACE_KEYS, SPACE_RESERVED)
            };
            for (id, value) in spaces {
                if let Value::Table(table) = value {
                    let prefix = format!("spaces.{id}");
                    scan_table(table, &prefix, known, reserved, &mut scan);
                    if v3 && let Some(Value::Table(collections)) = table.get("collections") {
                        for (cid, collection) in collections {
                            if let Value::Table(collection) = collection {
                                scan_table(
                                    collection,
                                    &format!("{prefix}.collections.{cid}"),
                                    COLLECTION_KEYS,
                                    &[],
                                    &mut scan,
                                );
                            }
                        }
                    }
                }
            }
        }
        scan
    }

    /// `[plugins]`: `enabled`, and in version 2 one table per instance. An instance's `config`
    /// and `env` hold the deployer's own keys; everything else is closed.
    fn scan_plugins(&self, plugins: &Table, scan: &mut KeyScan) {
        if self.version == 1 {
            scan_table(plugins, "plugins", PLUGINS_KEYS, &[], scan);
            return;
        }
        for (id, value) in plugins {
            if id == "enabled" {
                continue;
            }
            let Value::Table(instance) = value else {
                continue;
            };
            let prefix = format!("plugins.{id}");
            scan_table(instance, &prefix, INSTANCE_KEYS, INSTANCE_RESERVED, scan);
            if let Some(Value::Table(limits)) = instance.get("limits") {
                scan_table(limits, &format!("{prefix}.limits"), LIMITS_KEYS, &[], scan);
            }
        }
    }

    /// Validate every value and fill every default.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming the first key that breaks a rule.
    pub fn into_config(self, root: &Path) -> Result<Config, WorkspaceError> {
        if let Some(key) = self.scan_keys().unknown.into_iter().next() {
            return Err(WorkspaceError::config_invalid(
                &key,
                if self.version == 3 && key.ends_with(".content_roots") {
                    "was replaced by collections in configuration version 3; declare [spaces.<id>.collections.<cid>] with a root"
                } else {
                    "is not a known key"
                },
            ));
        }
        let general = self.general(root)?;
        let (spaces, default_space) = self.spaces()?;
        let plugins = self.plugins()?;
        let rest = self.rest()?;
        let http = self.http()?;
        check_declared_groups(&spaces, &rest.access)?;
        check_collection_roots(&spaces, root)?;
        Ok(Config {
            version: self.version,
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
            access: rest.access,
            store: rest.store,
        })
    }

    /// Every rule outside `[spaces]`, `[http]` and `[plugins]`, which the doctor checks apart.
    /// The groups that readers and access sets name are checked against `[access.groups]` when
    /// the spaces themselves are valid.
    pub(crate) fn validate_rest(&self, root: &Path) -> Result<(), WorkspaceError> {
        self.general(root)?;
        let rest = self.rest()?;
        if let Ok((spaces, _)) = self.spaces() {
            check_declared_groups(&spaces, &rest.access)?;
        }
        Ok(())
    }

    /// The collections of every space, in configuration order.
    pub(crate) fn collections(&self) -> Result<Vec<(SpaceId, CollectionConfig)>, WorkspaceError> {
        Ok(self
            .spaces()?
            .0
            .into_iter()
            .flat_map(|space| {
                let id = space.id;
                space
                    .collections
                    .into_iter()
                    .map(move |collection| (id.clone(), collection))
            })
            .collect())
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
                    let reader = Reader::new(Some(entry), &key);
                    let title = reader.string("title")?.unwrap_or_else(|| id.clone());
                    let readers = space_readers(&reader, &key)?;
                    let collections = self.space_collections(entry, &key)?;
                    spaces.push(SpaceConfig {
                        id: space_id,
                        title,
                        readers,
                        collections,
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
                readers: vec!["*".to_owned()],
                collections: Vec::new(),
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
        let store = Reader::new(self.section("store")?, "store");
        let store = StoreConfig {
            lock_timeout_ms: store
                .integer("lock_timeout_ms", 100, 600_000)?
                .unwrap_or(DEFAULT_STORE_LOCK_TIMEOUT_MS),
        };
        Ok(Rest {
            mcp,
            journal,
            log,
            principal: PrincipalConfig {
                local_id,
                on_behalf_of,
            },
            access: self.access()?,
            store,
        })
    }

    /// `[access.groups]`.
    fn access(&self) -> Result<AccessConfig, WorkspaceError> {
        let Some(access) = self.section("access")? else {
            return Ok(AccessConfig::default());
        };
        let groups = match access.get("groups") {
            None => return Ok(AccessConfig::default()),
            Some(Value::Table(groups)) => groups,
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    "access.groups",
                    "must be a table",
                ));
            }
        };
        let mut parsed = Vec::new();
        for (id, value) in groups {
            let key = format!("access.groups.{id}");
            if !is_group_id(id) {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "must have an id matching ^[a-z][a-z0-9-]{0,62}$",
                ));
            }
            let Value::Table(table) = value else {
                return Err(WorkspaceError::config_invalid(&key, "must be a table"));
            };
            let members = Reader::new(Some(table), &key)
                .string_array("members")?
                .ok_or_else(|| {
                    WorkspaceError::config_invalid(&format!("{key}.members"), "is required")
                })?;
            for member in &members {
                check_member(member).map_err(|problem| {
                    WorkspaceError::config_invalid(&format!("{key}.members"), problem)
                })?;
            }
            parsed.push(AccessGroup {
                id: id.clone(),
                members,
            });
        }
        Ok(AccessConfig { groups: parsed })
    }

    /// `[spaces.<id>.collections.<cid>]` of the space table `entry`.
    fn space_collections(
        &self,
        entry: &Table,
        space_key: &str,
    ) -> Result<Vec<CollectionConfig>, WorkspaceError> {
        let key = format!("{space_key}.collections");
        let table = match entry.get("collections") {
            None => return Ok(Vec::new()),
            Some(Value::Table(table)) if self.version == 3 => table,
            Some(Value::Table(_)) => {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "needs config_version = 3",
                ));
            }
            Some(_) => return Err(WorkspaceError::config_invalid(&key, "must be a table")),
        };
        let mut collections: Vec<CollectionConfig> = Vec::new();
        for (id, value) in table {
            let key = format!("{key}.{id}");
            if !is_group_id(id) {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "must have an id matching ^[a-z][a-z0-9-]{0,62}$",
                ));
            }
            let Value::Table(table) = value else {
                return Err(WorkspaceError::config_invalid(&key, "must be a table"));
            };
            let collection = collection(id, table, &key)?;
            for other in &collections {
                if roots_overlap(&other.root, &collection.root) {
                    return Err(WorkspaceError::config_invalid(
                        &format!("{key}.root"),
                        format!(
                            "`{}` overlaps the root `{}` of collection `{}`; roots of one space must not overlap",
                            collection.root, other.root, other.id
                        ),
                    ));
                }
            }
            collections.push(collection);
        }
        Ok(collections)
    }

    pub(super) fn section(&self, name: &str) -> Result<Option<&Table>, WorkspaceError> {
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
    access: AccessConfig,
    store: StoreConfig,
}

/// `readers` of the space table behind `reader`: `["*"]` by default.
fn space_readers(reader: &Reader<'_>, key: &str) -> Result<Vec<String>, WorkspaceError> {
    let readers = reader
        .string_array("readers")?
        .unwrap_or_else(|| vec!["*".to_owned()]);
    let key = format!("{key}.readers");
    if readers.is_empty() {
        return Err(WorkspaceError::config_invalid(&key, "must not be empty"));
    }
    for entry in &readers {
        ReaderEntry::parse(entry)
            .map_err(|problem| WorkspaceError::config_invalid(&key, problem))?;
    }
    Ok(readers)
}

fn collection(id: &str, table: &Table, key: &str) -> Result<CollectionConfig, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let at = |name: &str| format!("{key}.{name}");
    let root = reader
        .string("root")?
        .ok_or_else(|| WorkspaceError::config_invalid(&at("root"), "is required"))?;
    check_root(&root).map_err(|problem| WorkspaceError::config_invalid(&at("root"), problem))?;
    let kind = match reader.string("kind")?.as_deref() {
        None | Some("markdown") => CollectionKind::Markdown,
        Some("code") => CollectionKind::Code,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("kind"),
                "must be \"markdown\" or \"code\"",
            ));
        }
    };
    let globs = |name: &str| -> Result<Option<Vec<String>>, WorkspaceError> {
        let Some(patterns) = reader.string_array(name)? else {
            return Ok(None);
        };
        for pattern in &patterns {
            check_glob(pattern)
                .map_err(|problem| WorkspaceError::config_invalid(&at(name), problem))?;
        }
        Ok(Some(patterns))
    };
    let include = match globs("include")? {
        Some(patterns) if patterns.is_empty() => {
            return Err(WorkspaceError::config_invalid(
                &at("include"),
                "must hold at least one pattern",
            ));
        }
        Some(patterns) => patterns,
        None => match kind {
            CollectionKind::Markdown => MARKDOWN_INCLUDE,
            CollectionKind::Code => CODE_INCLUDE,
        }
        .iter()
        .map(|pattern| (*pattern).to_owned())
        .collect(),
    };
    let exclude = globs("exclude")?.unwrap_or_default();
    let access = reader
        .string_array("access")?
        .unwrap_or_else(|| vec!["space".to_owned()]);
    if access.is_empty() {
        return Err(WorkspaceError::config_invalid(
            &at("access"),
            "must not be empty",
        ));
    }
    for token in &access {
        AccessToken::parse(token)
            .map_err(|problem| WorkspaceError::config_invalid(&at("access"), problem))?;
    }
    let sensitivity = reader
        .string("sensitivity")?
        .unwrap_or_else(|| "internal".to_owned());
    if !SENSITIVITIES.contains(&sensitivity.as_str()) {
        return Err(WorkspaceError::config_invalid(
            &at("sensitivity"),
            "must be \"public\", \"internal\", \"confidential\" or \"restricted\"",
        ));
    }
    let default_type = reader.string("default_type")?.unwrap_or_else(|| {
        match kind {
            CollectionKind::Markdown => "document",
            CollectionKind::Code => "code",
        }
        .to_owned()
    });
    if !(1..=128).contains(&default_type.chars().count())
        || default_type.chars().any(char::is_control)
    {
        return Err(WorkspaceError::config_invalid(
            &at("default_type"),
            "must be 1 to 128 characters without control characters",
        ));
    }
    Ok(CollectionConfig {
        id: id.to_owned(),
        root,
        kind,
        include,
        exclude,
        access,
        sensitivity,
        default_type,
        strict: reader.boolean("strict")?.unwrap_or(false),
        max_file_bytes: reader
            .integer(
                "max_file_bytes",
                1,
                i64::try_from(MAX_FILE_BYTES_CAP).unwrap_or(i64::MAX),
            )?
            .unwrap_or(DEFAULT_MAX_FILE_BYTES),
    })
}

/// A collection root, lexically: relative, with `/` separators, no `..`, and below the workspace
/// root and outside `state/`.
fn check_root(root: &str) -> Result<(), String> {
    if root.is_empty() || root.chars().any(char::is_control) {
        return Err("must be a non-empty path without control characters".to_owned());
    }
    if root.starts_with('/')
        || root.contains('\\')
        || Path::new(root).is_absolute()
        || root.contains(':')
    {
        return Err(format!(
            "`{root}` must be relative to the workspace and use / separators"
        ));
    }
    if root.split('/').any(|segment| segment == "..") {
        return Err(format!("`{root}` must not hold a .. segment"));
    }
    let parts = root_parts(root);
    match parts.first() {
        None => Err(format!(
            "`{root}` is the workspace itself; name a directory below it"
        )),
        Some(&"state") => Err(format!("`{root}` is under state/, which the host owns")),
        Some(_) => Ok(()),
    }
}

/// The path segments of a root without `.` and empty ones.
fn root_parts(root: &str) -> Vec<&str> {
    root.split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect()
}

/// Whether one root is, or is inside, the other, compared by segment.
fn roots_overlap(a: &str, b: &str) -> bool {
    let (a, b) = (root_parts(a), root_parts(b));
    let shorter = a.len().min(b.len());
    a[..shorter] == b[..shorter]
}

/// A glob pattern, structurally: syntax is the plugin's (globset) to judge.
fn check_glob(pattern: &str) -> Result<(), String> {
    if pattern.is_empty() || pattern.chars().count() > 512 || pattern.chars().any(char::is_control)
    {
        return Err("entries must be 1 to 512 characters without control characters".to_owned());
    }
    if pattern.starts_with('/') || pattern.split('/').any(|segment| segment == "..") {
        return Err(format!(
            "entry `{pattern}` must be relative to the collection root and hold no .. segment"
        ));
    }
    Ok(())
}

/// Every group that `readers` or a collection's access set names must be declared.
fn check_declared_groups(
    spaces: &[SpaceConfig],
    access: &AccessConfig,
) -> Result<(), WorkspaceError> {
    let declared = |id: &str| access.groups.iter().any(|group| group.id == id);
    for space in spaces {
        let key = format!("spaces.{}", space.id);
        for entry in &space.readers {
            if let Ok(ReaderEntry::Group(id)) = ReaderEntry::parse(entry)
                && !declared(&id)
            {
                return Err(WorkspaceError::config_invalid(
                    &format!("{key}.readers"),
                    format!("names group `{id}`, which no [access.groups.{id}] table declares"),
                ));
            }
        }
        for collection in &space.collections {
            for token in &collection.access {
                if let Ok(AccessToken::Group(id)) = AccessToken::parse(token)
                    && !declared(&id)
                {
                    return Err(WorkspaceError::config_invalid(
                        &format!("{key}.collections.{}.access", collection.id),
                        format!("names group `{id}`, which no [access.groups.{id}] table declares"),
                    ));
                }
            }
        }
    }
    Ok(())
}

/// What is wrong with a collection root on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RootProblem {
    /// The path does not exist or cannot be resolved.
    Missing,
    /// It resolves to something that is not a directory.
    NotADirectory,
    /// It resolves outside the workspace.
    Outside,
}

/// Resolve `root` under the workspace `workspace` and check it: it exists, is a directory, and
/// its canonical path is inside the canonical workspace. The root itself may be a symbolic link
/// to a directory inside the workspace. Returns the canonical path.
pub(crate) fn resolve_root(
    workspace: &Path,
    root: &str,
) -> Result<std::path::PathBuf, RootProblem> {
    let Ok(base) = workspace.canonicalize() else {
        return Err(RootProblem::Missing);
    };
    let resolved = workspace
        .join(root)
        .canonicalize()
        .map_err(|_| RootProblem::Missing)?;
    if !resolved.starts_with(&base) || resolved == base {
        return Err(RootProblem::Outside);
    }
    if !resolved.is_dir() {
        return Err(RootProblem::NotADirectory);
    }
    Ok(resolved)
}

/// At open: a root that exists must resolve inside the workspace (a symbolic link must not lead
/// out of it) and must not overlap another root of its space once resolved. A root that does not
/// exist yet is the doctor's to report (`collections.roots`).
fn check_collection_roots(spaces: &[SpaceConfig], workspace: &Path) -> Result<(), WorkspaceError> {
    for space in spaces {
        let mut resolved: Vec<(&str, std::path::PathBuf)> = Vec::new();
        for collection in &space.collections {
            let key = format!("spaces.{}.collections.{}.root", space.id, collection.id);
            match resolve_root(workspace, &collection.root) {
                Ok(path) => {
                    if let Some((other, _)) = resolved
                        .iter()
                        .find(|(_, other)| path.starts_with(other) || other.starts_with(&path))
                    {
                        return Err(WorkspaceError::config_invalid(
                            &key,
                            format!(
                                "`{}` resolves to a directory that overlaps collection `{other}`; roots of one space must not overlap",
                                collection.root
                            ),
                        ));
                    }
                    resolved.push((&collection.id, path));
                }
                Err(RootProblem::Outside) => {
                    return Err(WorkspaceError::config_invalid(
                        &key,
                        format!(
                            "`{}` resolves outside the workspace; a root, and the symbolic links on its way, must stay inside it",
                            collection.root
                        ),
                    ));
                }
                Err(RootProblem::Missing | RootProblem::NotADirectory) => {}
            }
        }
    }
    Ok(())
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
pub(super) struct Reader<'a> {
    table: Option<&'a Table>,
    prefix: &'a str,
}

impl<'a> Reader<'a> {
    pub(super) fn new(table: Option<&'a Table>, prefix: &'a str) -> Self {
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

    pub(super) fn table_value(&self, key: &str) -> Option<&'a Value> {
        self.value(key)
    }

    pub(super) fn string(&self, key: &str) -> Result<Option<String>, WorkspaceError> {
        match self.value(key) {
            None => Ok(None),
            Some(Value::String(value)) => Ok(Some(value.clone())),
            Some(_) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                "must be a string",
            )),
        }
    }

    pub(super) fn boolean(&self, key: &str) -> Result<Option<bool>, WorkspaceError> {
        match self.value(key) {
            None => Ok(None),
            Some(Value::Boolean(value)) => Ok(Some(*value)),
            Some(_) => Err(WorkspaceError::config_invalid(
                &self.path(key),
                "must be true or false",
            )),
        }
    }

    pub(super) fn integer(
        &self,
        key: &str,
        min: i64,
        max: i64,
    ) -> Result<Option<u64>, WorkspaceError> {
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

    pub(super) fn string_array(&self, key: &str) -> Result<Option<Vec<String>>, WorkspaceError> {
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
