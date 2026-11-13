//! What configuration version 6 adds (records host specification, sections 3 and 9.2; D161,
//! D166): a space's `person`, `verified_admits` and `[spaces.<id>.meaning]`, a collection's `own`
//! and `speaker`, `[models]`, and the `records_write` grant table's `default_access`, which is
//! read with the rest of that table in `plugins_config.rs`.
//!
//! This module parses, validates and stores them, with every rule section 3 checks when the
//! configuration is read, each a `WORKSPACE_CONFIG_INVALID` naming the key. The record services
//! act on a space's `person` and `verified_admits`, a collection's `own` and `speaker`, and the
//! command-writable collections (`crate::plugins`' record and store services). Nothing acts on
//! `[spaces.<id>.meaning]` and `[models]` yet: matching by meaning and the models themselves
//! arrive in that specification's step B5.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::net::Ipv4Addr;
use std::path::{Component, Path, PathBuf};

use toml::{Table, Value};
use umbel_store::ContentHash;

use super::access::parse_principal;
use super::config::{
    CollectionConfig, ConfigFile, KeyScan, Reader, SpaceConfig, check_root, roots_overlap,
    scan_table,
};
use super::error::WorkspaceError;
use super::plugins_config::{PluginsConfig, RECORDS_WRITE_GRANT_KEYS_V6, is_env_name};
use super::space::SpaceId;
use crate::plugins::is_kebab_id;

/// The top-level table configuration version 6 adds.
pub(super) const TOP_KEYS_V6: &[&str] = &["models"];
/// A space's keys from version 6.
pub(super) const SPACE_KEYS_V6: &[&str] = &[
    "title",
    "readers",
    "collections",
    "person",
    "verified_admits",
    "meaning",
];
/// A collection's keys from version 6.
pub(super) const COLLECTION_KEYS_V6: &[&str] = &[
    "root",
    "kind",
    "include",
    "exclude",
    "access",
    "sensitivity",
    "default_type",
    "strict",
    "max_file_bytes",
    "own",
    "speaker",
];
/// What version 6 adds to a space and to a collection, for the message an older version gives.
const SPACE_ADDED_V6: &[&str] = &["person", "verified_admits", "meaning"];
const COLLECTION_ADDED_V6: &[&str] = &["own", "speaker"];
const MEANING_KEYS: &[&str] = &["model", "weight", "k"];
const MODEL_KEYS: &[&str] = &[
    "provider",
    "name",
    "dir",
    "files",
    "pooling",
    "max_length",
    "url",
    "dimensions",
    "version",
    "bearer_env",
    "timeout_ms",
];
/// The files of a `static` model, and of an `onnx` one (section 9.2).
const STATIC_FILES: &[&str] = &["model.safetensors", "tokenizer.json", "config.json"];
const ONNX_FILES: &[&str] = &[
    "model.onnx",
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];

/// The default `spaces.<id>.meaning.weight`: `w` of the fused score.
pub const DEFAULT_MEANING_WEIGHT: f64 = 0.5;
/// The default `spaces.<id>.meaning.k`.
pub const DEFAULT_MEANING_K: u64 = 5;
/// The default `models.<mid>.max_length` of an `onnx` model, in tokens.
pub const DEFAULT_MODEL_MAX_LENGTH: u64 = 512;
/// The default `models.<mid>.timeout_ms` of an `http` model.
pub const DEFAULT_MODEL_TIMEOUT_MS: u64 = 5_000;

/// What "verified content only" means in a space (`spaces.<id>.verified_admits`, section 6.6):
/// what a call that asks for it is given. No setting asks for every read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum VerifiedAdmits {
    /// Affirmed records only (the default).
    #[default]
    Affirmed,
    /// Affirmed and attested records.
    AffirmedAttested,
}

impl VerifiedAdmits {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Affirmed => "affirmed",
            Self::AffirmedAttested => "affirmed+attested",
        }
    }
}

/// `[spaces.<id>.meaning]`: the model a space's record lanes are matched by meaning with, once
/// its gate has passed (sections 8.3 and 10).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct MeaningConfig {
    /// A `[models]` id.
    pub model: String,
    /// `w` of the fused score, 0 to 1.
    pub weight: f64,
    /// The `k` within which the gate counts a probe's duplicate as found, 1 to 20.
    pub k: u64,
}

/// How an `onnx` model's token vectors become one (`models.<mid>.pooling`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Pooling {
    /// The mean of the token vectors (the default).
    #[default]
    Mean,
    /// The first token's vector.
    Cls,
}

impl Pooling {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mean => "mean",
            Self::Cls => "cls",
        }
    }
}

/// What runs a model (`models.<mid>.provider`), with the keys that provider reads (section 9.2).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ModelProvider {
    /// A token lookup table, averaged.
    Static {
        /// The model's directory, relative to the workspace.
        dir: String,
        /// Each file's name and its `sha256:<64 hex>`.
        files: BTreeMap<String, String>,
    },
    /// A transformer through ONNX Runtime.
    Onnx {
        /// The model's directory, relative to the workspace.
        dir: String,
        /// Each file's name and its `sha256:<64 hex>`.
        files: BTreeMap<String, String>,
        /// `mean` or `cls`.
        pooling: Pooling,
        /// The most tokens of a text the model reads, 16 to 8192.
        max_length: u64,
    },
    /// An embeddings endpoint. It sends record text off the machine.
    Http {
        /// An `https` URL, or an `http` URL to a literal loopback address.
        url: String,
        /// How many numbers a vector holds, 16 to 4096.
        dimensions: u64,
        /// The deployer's word for which model the endpoint serves.
        version: String,
        /// The environment variable that holds a bearer token.
        bearer_env: Option<String>,
        /// The request timeout, 100 to 60 000.
        timeout_ms: u64,
    },
}

impl ModelProvider {
    /// The configuration spelling.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Static { .. } => "static",
            Self::Onnx { .. } => "onnx",
            Self::Http { .. } => "http",
        }
    }
}

/// `[models.<mid>]`: one embedding model a space may name (section 9.2). None by default.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ModelConfig {
    /// The model's id in this configuration.
    pub id: String,
    /// The model's public name, for people and for the HTTP request.
    pub name: String,
    /// What runs it, with that provider's keys.
    pub provider: ModelProvider,
}

/// What version 6 adds to a space.
#[derive(Debug, Clone, Default, PartialEq)]
pub(super) struct SpaceStanding {
    pub(super) person: Option<String>,
    pub(super) verified_admits: VerifiedAdmits,
    pub(super) meaning: Option<MeaningConfig>,
}

/// `person`, `verified_admits` and `[meaning]` of the space table `entry`.
pub(super) fn space_standing(entry: &Table, key: &str) -> Result<SpaceStanding, WorkspaceError> {
    let reader = Reader::new(Some(entry), key);
    let at = |name: &str| format!("{key}.{name}");
    let person = reader.string("person")?;
    if let Some(person) = &person
        && !parse_principal(person).is_ok_and(|(kind, _)| kind == "human")
    {
        return Err(WorkspaceError::config_invalid(
            &at("person"),
            "must be a principal string human:<id>: the one person whose decisions give standing in the space",
        ));
    }
    let verified_admits = match reader.string("verified_admits")?.as_deref() {
        None | Some("affirmed") => VerifiedAdmits::Affirmed,
        Some("affirmed+attested") => VerifiedAdmits::AffirmedAttested,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("verified_admits"),
                "must be \"affirmed\" or \"affirmed+attested\"",
            ));
        }
    };
    let meaning = match entry.get("meaning") {
        None => None,
        Some(Value::Table(table)) => Some(meaning(table, &at("meaning"))?),
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("meaning"),
                "must be a table",
            ));
        }
    };
    Ok(SpaceStanding {
        person,
        verified_admits,
        meaning,
    })
}

fn meaning(table: &Table, key: &str) -> Result<MeaningConfig, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let at = |name: &str| format!("{key}.{name}");
    let model = reader.string("model")?.ok_or_else(|| {
        WorkspaceError::config_invalid(&at("model"), "is required: the id of a [models] table")
    })?;
    if !is_model_id(&model) {
        return Err(WorkspaceError::config_invalid(
            &at("model"),
            "must be the id of a [models] table, matching ^[a-z][a-z0-9-]{0,31}$",
        ));
    }
    let weight = match table.get("weight") {
        None => DEFAULT_MEANING_WEIGHT,
        Some(Value::Float(weight)) if (0.0..=1.0).contains(weight) => *weight,
        Some(Value::Integer(weight @ (0 | 1))) => {
            if *weight == 0 {
                0.0
            } else {
                1.0
            }
        }
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("weight"),
                "must be a number between 0 and 1",
            ));
        }
    };
    Ok(MeaningConfig {
        model,
        weight,
        k: reader.integer("k", 1, 20)?.unwrap_or(DEFAULT_MEANING_K),
    })
}

/// `^[a-z][a-z0-9-]{0,31}$`: a `[models]` id.
fn is_model_id(text: &str) -> bool {
    is_kebab_id(text, 32)
}

/// `own` and `speaker` of the collection table `table`. `person` says whether the collection's
/// space names one.
pub(super) fn collection_own(
    table: &Table,
    key: &str,
    person: bool,
) -> Result<(bool, Option<String>), WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let own = reader.boolean("own")?.unwrap_or(false);
    if own && !person {
        return Err(WorkspaceError::config_invalid(
            &format!("{key}.own"),
            "needs the space's person: a collection is named as the own of the one person the space is configured for",
        ));
    }
    let speaker = reader.string("speaker")?;
    if let Some(speaker) = &speaker {
        let key = format!("{key}.speaker");
        if !own {
            return Err(WorkspaceError::config_invalid(
                &key,
                "goes with own = true only: it names which part of each document is the person's",
            ));
        }
        if !(1..=128).contains(&speaker.chars().count()) || speaker.chars().any(char::is_control) {
            return Err(WorkspaceError::config_invalid(
                &key,
                "must be 1 to 128 characters without control characters",
            ));
        }
    }
    Ok((own, speaker))
}

impl ConfigFile {
    /// The key scan of what version 6 adds below the tables `config.rs` scans: each space's
    /// `[meaning]` and each `[models.<mid>]`. A model's `files` holds file names, which the
    /// model's own rule checks.
    pub(super) fn scan_v6(&self, table: &Table, scan: &mut KeyScan) {
        if let Some(Value::Table(spaces)) = table.get("spaces") {
            for (id, space) in spaces {
                if let Value::Table(space) = space
                    && let Some(Value::Table(meaning)) = space.get("meaning")
                {
                    let prefix = format!("spaces.{id}.meaning");
                    scan_table(meaning, &prefix, MEANING_KEYS, &[], scan);
                }
            }
        }
        if let Some(Value::Table(models)) = table.get("models") {
            for (id, model) in models {
                if let Value::Table(model) = model {
                    scan_table(model, &format!("models.{id}"), MODEL_KEYS, &[], scan);
                }
            }
        }
    }

    /// `[models]`, in configuration order; none before version 6.
    pub(crate) fn models(&self) -> Result<Vec<ModelConfig>, WorkspaceError> {
        if self.version() < 6 {
            return Ok(Vec::new());
        }
        let Some(models) = self.section("models")? else {
            return Ok(Vec::new());
        };
        let mut parsed = Vec::new();
        for (id, value) in models {
            let key = format!("models.{id}");
            if !is_model_id(id) {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "must have an id matching ^[a-z][a-z0-9-]{0,31}$",
                ));
            }
            let Value::Table(table) = value else {
                return Err(WorkspaceError::config_invalid(&key, "must be a table"));
            };
            parsed.push(model(id, table, &key)?);
        }
        Ok(parsed)
    }
}

/// Whether the dotted key `key` is one configuration version 6 adds, for the message an older
/// version gives it.
pub(super) fn is_v6_key(key: &str) -> bool {
    let parts: Vec<&str> = key.split('.').collect();
    match parts.as_slice() {
        [top, ..] if TOP_KEYS_V6.contains(top) => true,
        ["spaces", _, added] => SPACE_ADDED_V6.contains(added),
        ["spaces", _, "collections", _, added] => COLLECTION_ADDED_V6.contains(added),
        ["plugins", _, "grants", "records_write", added] => {
            *added != "allow" && RECORDS_WRITE_GRANT_KEYS_V6.contains(added)
        }
        _ => false,
    }
}

fn model(id: &str, table: &Table, key: &str) -> Result<ModelConfig, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let at = |name: &str| format!("{key}.{name}");
    let invalid = |name: &str, problem: &str| WorkspaceError::config_invalid(&at(name), problem);
    let provider = reader
        .string("provider")?
        .ok_or_else(|| invalid("provider", "is required: \"static\", \"onnx\" or \"http\""))?;
    let own_keys: &[&str] = match provider.as_str() {
        "static" => &["dir", "files"],
        "onnx" => &["dir", "files", "pooling", "max_length"],
        "http" => &["url", "dimensions", "version", "bearer_env", "timeout_ms"],
        _ => {
            return Err(invalid(
                "provider",
                "must be \"static\", \"onnx\" or \"http\"",
            ));
        }
    };
    if let Some(other) = table.keys().map(String::as_str).find(|name| {
        MODEL_KEYS.contains(name)
            && !["provider", "name"].contains(name)
            && !own_keys.contains(name)
    }) {
        return Err(WorkspaceError::config_invalid(
            &at(other),
            format!(
                "is not a key of provider \"{provider}\", which reads {}",
                own_keys.join(", ")
            ),
        ));
    }
    let name = reader
        .string("name")?
        .ok_or_else(|| invalid("name", "is required: the model's public name"))?;
    if !(1..=128).contains(&name.chars().count()) || name.chars().any(char::is_control) {
        return Err(invalid(
            "name",
            "must be 1 to 128 characters without control characters",
        ));
    }
    let local = |names: &[&str]| -> Result<(String, BTreeMap<String, String>), WorkspaceError> {
        let dir = reader.string("dir")?.ok_or_else(|| {
            invalid(
                "dir",
                "is required: the model's directory, relative to the workspace",
            )
        })?;
        check_root(&dir).map_err(|problem| WorkspaceError::config_invalid(&at("dir"), problem))?;
        Ok((dir, model_files(table, &at("files"), names)?))
    };
    let provider = match provider.as_str() {
        "static" => {
            let (dir, files) = local(STATIC_FILES)?;
            ModelProvider::Static { dir, files }
        }
        "onnx" => {
            let (dir, files) = local(ONNX_FILES)?;
            let pooling = match reader.string("pooling")?.as_deref() {
                None | Some("mean") => Pooling::Mean,
                Some("cls") => Pooling::Cls,
                Some(_) => return Err(invalid("pooling", "must be \"mean\" or \"cls\"")),
            };
            ModelProvider::Onnx {
                dir,
                files,
                pooling,
                max_length: reader
                    .integer("max_length", 16, 8192)?
                    .unwrap_or(DEFAULT_MODEL_MAX_LENGTH),
            }
        }
        _ => {
            let url = reader.string("url")?.ok_or_else(|| {
                invalid(
                    "url",
                    "is required: the embeddings endpoint, an https URL or an http URL to a literal loopback address",
                )
            })?;
            check_model_url(&url)
                .map_err(|problem| WorkspaceError::config_invalid(&at("url"), problem))?;
            let dimensions = reader.integer("dimensions", 16, 4096)?.ok_or_else(|| {
                invalid(
                    "dimensions",
                    "is required: how many numbers a vector of the endpoint holds",
                )
            })?;
            let version = reader.string("version")?.ok_or_else(|| {
                invalid(
                    "version",
                    "is required: your word for which model the endpoint serves",
                )
            })?;
            if !(1..=64).contains(&version.chars().count()) || version.chars().any(char::is_control)
            {
                return Err(invalid(
                    "version",
                    "must be 1 to 64 characters without control characters",
                ));
            }
            let bearer_env = reader.string("bearer_env")?;
            if bearer_env.as_deref().is_some_and(|name| !is_env_name(name)) {
                return Err(invalid(
                    "bearer_env",
                    "must be an environment variable name such as EMBEDDINGS_TOKEN",
                ));
            }
            ModelProvider::Http {
                url,
                dimensions,
                version,
                bearer_env,
                timeout_ms: reader
                    .integer("timeout_ms", 100, 60_000)?
                    .unwrap_or(DEFAULT_MODEL_TIMEOUT_MS),
            }
        }
    };
    Ok(ModelConfig {
        id: id.to_owned(),
        name,
        provider,
    })
}

/// `files` of a local model: exactly `names`, each with its `sha256:<64 hex>`.
fn model_files(
    table: &Table,
    key: &str,
    names: &[&str],
) -> Result<BTreeMap<String, String>, WorkspaceError> {
    let exactly = || format!("must name exactly {}", names.join(", "));
    let files = match table.get("files") {
        Some(Value::Table(files)) => files,
        None => {
            return Err(WorkspaceError::config_invalid(
                key,
                format!(
                    "is required: each file's name and its sha256:<64 hex>; it {}",
                    exactly()
                ),
            ));
        }
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                key,
                "must be a table of file name to sha256:<64 hex>",
            ));
        }
    };
    if files.len() != names.len() || names.iter().any(|name| !files.contains_key(*name)) {
        return Err(WorkspaceError::config_invalid(key, exactly()));
    }
    let mut pinned = BTreeMap::new();
    for (name, digest) in files {
        match digest {
            Value::String(digest) if ContentHash::parse(digest).is_ok() => {
                pinned.insert(name.clone(), digest.clone());
            }
            _ => {
                return Err(WorkspaceError::config_invalid(
                    &format!("{key}.\"{name}\""),
                    "must be sha256:<64 lowercase hex>, the file's digest",
                ));
            }
        }
    }
    Ok(pinned)
}

/// An `http` model's URL, which `schemas/workspace-config.v6.json` states as one pattern:
/// `https://` and a host name of letters, digits, dots and hyphens or a bracketed IPv6 address,
/// or `http://` and a literal loopback address, `127.0.0.0/8` or `[::1]` as written, never a
/// name: a model server on the same machine. Then an optional port of 1 to 65535 without a
/// leading zero, and an optional path, query or fragment of printable ASCII. No credentials.
fn check_model_url(url: &str) -> Result<(), String> {
    const SHAPE: &str = "must be an https URL, or an http URL to a literal loopback address (127.0.0.0/8 or [::1]), never a name";
    let (https, rest) = match (url.strip_prefix("https://"), url.strip_prefix("http://")) {
        (Some(rest), _) => (true, rest),
        (_, Some(rest)) => (false, rest),
        _ => return Err(SHAPE.to_owned()),
    };
    let (authority, tail) = rest.split_at(rest.find(['/', '?', '#']).unwrap_or(rest.len()));
    if !tail.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err(format!(
            "{SHAPE}; after the host it holds only printable ASCII, with no whitespace"
        ));
    }
    let (host, bracketed, port) = match authority.strip_prefix('[') {
        Some(inner) => match inner.split_once(']') {
            Some((address, "")) => (address, true, None),
            Some((address, after)) if after.starts_with(':') => (address, true, Some(&after[1..])),
            _ => return Err(format!("{SHAPE}; its IPv6 address is not closed with ]")),
        },
        None => match authority.split_once(':') {
            Some((host, port)) => (host, false, Some(port)),
            None => (authority, false, None),
        },
    };
    if let Some(port) = port {
        let digits = (1..=5).contains(&port.len())
            && port.bytes().all(|byte| byte.is_ascii_digit())
            && !port.starts_with('0');
        if !digits || port.parse::<u16>().is_err() {
            return Err(format!(
                "{SHAPE}; its port is 1 to 65535, in digits without a leading zero"
            ));
        }
    }
    let named = match (https, bracketed) {
        (true, false) => {
            !host.is_empty()
                && host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        }
        (true, true) => {
            !host.is_empty()
                && host
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.')
        }
        (false, false) => host
            .parse::<Ipv4Addr>()
            .is_ok_and(|address| address.octets()[0] == 127),
        (false, true) => host == "::1",
    };
    if named {
        Ok(())
    } else if https {
        Err(format!(
            "{SHAPE}; its host is a name of letters, digits, dots and hyphens, or a bracketed IPv6 address, with no credentials"
        ))
    } else {
        Err(format!("{SHAPE}; `{host}` is not one"))
    }
}

/// Every `[spaces.<id>.meaning]` names a declared model.
pub(super) fn check_meaning_models(
    spaces: &[SpaceConfig],
    models: &[ModelConfig],
) -> Result<(), WorkspaceError> {
    for space in spaces {
        if let Some(meaning) = &space.meaning
            && !models.iter().any(|model| model.id == meaning.model)
        {
            return Err(WorkspaceError::config_invalid(
                &format!("spaces.{}.meaning.model", space.id),
                format!(
                    "names `{0}`, which no [models.{0}] table declares",
                    meaning.model
                ),
            ));
        }
    }
    Ok(())
}

/// Why a collection is command-writable (section 3): the instance whose `content_write` allow
/// covers `covered`, which is the collection itself or one whose root overlaps its root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Writable {
    pub(super) space: SpaceId,
    pub(super) collection: String,
    /// The instance whose `grants.content_write.allow` covers `covered`.
    instance: String,
    /// `<space>/<collection>` of the covered collection.
    covered: String,
    /// Whether the covered collection is another one, whose root overlaps this one's.
    overlaps: bool,
}

/// The most symbolic links one root is followed through; past it the rest is taken as written.
const MAX_ROOT_LINKS: usize = 40;

/// Where the files of the root `root` are, or would be once written: `workspace/root` with every
/// symbolic link on the way followed, whether or not the path exists. A content write creates
/// the directories its path lacks, so a root that does not exist yet is still a place a command
/// can write to. The part that exists is resolved as the file system resolves it; a link whose
/// target is missing is followed to where the target would be; and the segments after the last
/// one that exists are taken as written.
fn effective_root(workspace: &Path, root: &str) -> PathBuf {
    let mut pending: Vec<OsString> = workspace
        .join(root)
        .components()
        .rev()
        .map(|component| component.as_os_str().to_owned())
        .collect();
    let mut resolved = PathBuf::new();
    let mut links = 0;
    while let Some(part) = pending.pop() {
        match Path::new(&part).components().next() {
            None | Some(Component::CurDir) => {}
            Some(Component::ParentDir) => {
                resolved.pop();
            }
            Some(Component::Prefix(_) | Component::RootDir) => resolved.push(&part),
            Some(Component::Normal(name)) => {
                let candidate = resolved.join(name);
                match std::fs::read_link(&candidate) {
                    Ok(target) if links < MAX_ROOT_LINKS => {
                        links += 1;
                        // A relative target is read from the link's directory, which
                        // `resolved` is; an absolute one starts again.
                        if target.is_absolute() {
                            resolved = PathBuf::new();
                        }
                        pending.extend(
                            target
                                .components()
                                .rev()
                                .map(|component| component.as_os_str().to_owned()),
                        );
                    }
                    _ => resolved = candidate,
                }
            }
        }
    }
    // The part that exists, as the file system names it (its own spelling of a name's case).
    let mut head = resolved.clone();
    let mut tail: Vec<OsString> = Vec::new();
    loop {
        if let Ok(mut canonical) = head.canonicalize() {
            canonical.extend(tail.iter().rev());
            return canonical;
        }
        match head.file_name() {
            Some(name) => tail.push(name.to_owned()),
            None => return resolved,
        }
        head.pop();
    }
}

/// The command-writable collections of every space (section 3): those some enabled instance's
/// `grants.content_write.allow` covers, and those whose root overlaps a covered collection's, in
/// any space. Two roots overlap when they are equal or one contains the other, as written or
/// once resolved under `workspace` ([`effective_root`]), so a symbolic link shares its target
/// and a root that does not exist yet counts where it would be created.
pub(super) fn command_writable(
    spaces: &[SpaceConfig],
    plugins: &PluginsConfig,
    workspace: &Path,
) -> Vec<Writable> {
    struct Covered<'a> {
        space: &'a SpaceId,
        collection: &'a CollectionConfig,
        instance: &'a str,
        resolved: PathBuf,
    }
    let every = || {
        spaces.iter().flat_map(|space| {
            space
                .collections
                .iter()
                .map(move |collection| (&space.id, collection))
        })
    };
    let mut covered: Vec<Covered<'_>> = Vec::new();
    for (space, collection) in every() {
        let exact = format!("{space}/{}", collection.id);
        let whole = format!("{space}/*");
        let instance = plugins.instances.iter().find(|instance| {
            instance
                .allow
                .get("content_write")
                .is_some_and(|allow| allow.iter().any(|entry| *entry == exact || *entry == whole))
        });
        if let Some(instance) = instance {
            covered.push(Covered {
                space,
                collection,
                instance: &instance.id,
                resolved: effective_root(workspace, &collection.root),
            });
        }
    }
    let mut writable = Vec::new();
    for (space, collection) in every() {
        let itself =
            |other: &Covered<'_>| other.space == space && other.collection.id == collection.id;
        let resolved = effective_root(workspace, &collection.root);
        let reached = covered.iter().find(|other| itself(other)).or_else(|| {
            covered.iter().find(|other| {
                roots_overlap(&other.collection.root, &collection.root)
                    || other.resolved.starts_with(&resolved)
                    || resolved.starts_with(&other.resolved)
            })
        });
        if let Some(other) = reached {
            writable.push(Writable {
                space: space.clone(),
                collection: collection.id.clone(),
                instance: other.instance.to_owned(),
                covered: format!("{}/{}", other.space, other.collection.id),
                overlaps: !itself(other),
            });
        }
    }
    writable
}

/// Section 3's first rule: no command writes files into an own collection. A collection with
/// `own = true` that is command-writable is refused at its `own`.
pub(super) fn check_own_collections(
    spaces: &[SpaceConfig],
    writable: &[Writable],
) -> Result<(), WorkspaceError> {
    for space in spaces {
        for collection in space.collections.iter().filter(|collection| collection.own) {
            let Some(why) = writable
                .iter()
                .find(|entry| entry.space == space.id && entry.collection == collection.id)
            else {
                continue;
            };
            return Err(WorkspaceError::config_invalid(
                &format!("spaces.{}.collections.{}.own", space.id, collection.id),
                format!(
                    "a collection named as the person's own may not be written through content_write (plugins.{}.grants.content_write covers `{}`{}): a command's input would become a file there",
                    why.instance,
                    why.covered,
                    if why.overlaps {
                        ", whose root overlaps it"
                    } else {
                        ""
                    }
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_6_keys_are_named_for_an_older_file() {
        for key in [
            "models",
            "spaces.garden.person",
            "spaces.garden.verified_admits",
            "spaces.garden.meaning",
            "spaces.garden.collections.journal.own",
            "spaces.garden.collections.journal.speaker",
            "plugins.notes.grants.records_write.default_access",
        ] {
            assert!(is_v6_key(key), "{key}");
        }
        for key in [
            "model",
            "spaces.garden.title",
            "spaces.garden.owner",
            "spaces.garden.collections.journal.root",
            "spaces.garden.collections.journal.owner",
            "plugins.notes.grants.records_write.allow",
            "plugins.notes.grants.memory_write.default_access",
            "plugins.notes.grants.records_write.bogus",
            "auth",
        ] {
            assert!(!is_v6_key(key), "{key}");
        }
    }

    #[test]
    fn a_model_url_is_https_or_http_to_a_literal_loopback_address() {
        for ok in [
            "https://embeddings.example.com/v1/embeddings",
            "https://localhost:8443/v1/embeddings",
            "https://embeddings.example.com",
            "https://embeddings.example.com:65535/v1?model=small#top",
            "https://[2001:db8::1]:8443/embed",
            "http://127.0.0.1:8080/v1/embeddings",
            "http://127.4.5.6/embed",
            "http://127.255.255.255:1",
            "http://[::1]:8080/v1/embeddings",
            "http://[::1]",
        ] {
            assert!(check_model_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://localhost:8080/v1/embeddings",
            "http://embeddings.example.com/v1/embeddings",
            "http://10.0.0.5/embed",
            "http://[::2]/embed",
            "ftp://127.0.0.1/embed",
            "https://user:pw@embeddings.example.com/",
            "embeddings.example.com",
            // What the schema's pattern refuses, the host refuses, and the other way about.
            "http://127.999.0.1/x",
            "http://127.01.0.1/x",
            "http://127.1/x",
            "http://[0:0:0:0:0:0:0:1]/x",
            "http://[::1/x",
            "http://[::1]8080/x",
            "https://a_b.example/",
            "https://embeddings.example.com:99999/",
            "https://embeddings.example.com:0/",
            "https://embeddings.example.com:080/",
            "https://embeddings.example.com:+80/",
            "https://embeddings.example.com:/",
            "https://embeddings.example.com/v1 /embed",
            "https://embeddings.example.com/caf\u{e9}",
            "https:///embed",
            "https://[]/embed",
        ] {
            assert!(check_model_url(bad).is_err(), "{bad}");
        }
    }
}
