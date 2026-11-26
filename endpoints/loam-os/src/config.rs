//! The operator's configuration (`[plugins.loamos.config]` in `umbel.toml`) and the semantic rules
//! its JSON Schema cannot state.
//!
//! Umbel checks the shape against `schemas/config.schema.json` when the workspace opens. What is
//! left is here: an image is pinned by digest, a repository names an image and a size that exist,
//! and the configured disk can hold the most machines of the largest size. The doctor runs these
//! through the plugin's `check_config` (`plugins.config_checks`, Umbel D206), and `host-status`
//! refuses nothing on their account, so a host with a bad file still says what it has.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

/// The whole configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// The container runtime.
    pub runtime: RuntimeConfig,
    /// Session images by name.
    pub images: BTreeMap<String, Image>,
    /// Machine sizes by name.
    pub sizes: BTreeMap<String, Size>,
    /// Network policies by name.
    pub policies: BTreeMap<String, Policy>,
    /// Repositories by name.
    pub repositories: BTreeMap<String, Repository>,
    /// How many machines and how much disk.
    pub capacity: Capacity,
    /// How long records and logs are kept.
    pub retention: Retention,
}

/// Which container runtime, and how to reach it.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RuntimeConfig {
    /// `docker` or `podman`.
    pub kind: RuntimeKind,
    /// The program; the kind's name when absent.
    pub command: Option<String>,
    /// How long one call may take.
    pub timeout_ms: u64,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            kind: RuntimeKind::Docker,
            command: None,
            timeout_ms: 5000,
        }
    }
}

impl RuntimeConfig {
    /// The program to run.
    pub fn program(&self) -> &str {
        self.command.as_deref().unwrap_or(self.kind.as_str())
    }
}

/// The runtimes whose command line the host speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeKind {
    /// Docker Engine or Docker Desktop.
    Docker,
    /// Podman.
    Podman,
}

impl RuntimeKind {
    /// The kind's name, which is also its program's.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Podman => "podman",
        }
    }
}

/// A session image.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Image {
    /// `<name>@sha256:<64 hex>`.
    pub reference: String,
    /// Tool versions by tool.
    #[serde(default)]
    pub toolchain: BTreeMap<String, String>,
}

impl Image {
    /// The digest part of the reference, when it is `<name>@sha256:<64 lowercase hex>` with a
    /// name that is not empty and holds no whitespace.
    pub fn digest(&self) -> Option<&str> {
        let (name, digest) = self.reference.split_once('@')?;
        if name.is_empty() || name.chars().any(char::is_whitespace) {
            return None;
        }
        let hex = digest.strip_prefix("sha256:")?;
        (hex.len() == 64
            && hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
        .then_some(digest)
    }
}

/// A machine size.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    /// Processors.
    pub cpus: f64,
    /// Memory.
    pub memory_gb: f64,
    /// Disk.
    pub disk_gb: f64,
}

/// A network policy.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Policy {
    /// The hosts it allows.
    pub hosts: Vec<String>,
}

/// A repository.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Repository {
    /// Where commits come from.
    pub source: String,
    /// The base branch.
    #[serde(default = "main")]
    pub base: String,
    /// An image name.
    pub image: String,
    /// A size name.
    pub size: String,
    /// The steps a checkpoint is made from (M2).
    #[serde(default)]
    pub checkpoint_steps: Option<Vec<String>>,
}

fn main() -> String {
    "main".to_owned()
}

/// Capacity.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Capacity {
    /// The most machines at once.
    pub machines: u32,
    /// The disk all machines may use.
    pub disk_gb: Option<f64>,
    /// The free disk below which a machine is refused.
    pub min_free_disk_gb: f64,
}

impl Default for Capacity {
    fn default() -> Self {
        Self {
            machines: 1,
            disk_gb: None,
            min_free_disk_gb: 20.0,
        }
    }
}

/// Retention.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Retention {
    /// Days a run's or a machine's record is kept.
    pub records_days: u32,
    /// Days a run's log is kept.
    pub logs_days: u32,
}

impl Default for Retention {
    fn default() -> Self {
        Self {
            records_days: 30,
            logs_days: 7,
        }
    }
}

/// One semantic problem: a code and a JSON pointer into the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    /// The problem's code.
    pub code: &'static str,
    /// A JSON pointer into the configuration.
    pub at: String,
    /// What is wrong, in a sentence.
    pub message: String,
}

impl Problem {
    fn new(code: &'static str, at: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            at: at.into(),
            message: message.into(),
        }
    }

    /// As `details.problems` carries it.
    pub fn to_value(&self) -> Value {
        json!({ "code": self.code, "at": self.at, "message": self.message })
    }
}

/// Escape a name for a JSON pointer (RFC 6901).
fn pointer(name: &str) -> String {
    name.replace('~', "~0").replace('/', "~1")
}

impl Config {
    /// Read the configuration as Umbel hands it over, defaults applied.
    ///
    /// # Errors
    /// The deserializer's message when the value does not have the schema's shape, which Umbel
    /// has already checked, so only a schema and this type disagreeing reaches it.
    pub fn from_value(value: Value) -> Result<Self, String> {
        let value = if value.is_null() { json!({}) } else { value };
        serde_json::from_value(value).map_err(|error| error.to_string())
    }

    /// Every semantic problem, in a stable order: images, repositories, then capacity.
    pub fn problems(&self) -> Vec<Problem> {
        let mut problems = Vec::new();
        for (name, image) in &self.images {
            if image.digest().is_none() {
                problems.push(Problem::new(
                    "IMAGE_NOT_PINNED",
                    format!("/images/{}/reference", pointer(name)),
                    format!(
                        "image `{name}` is `{}`, which is not pinned by digest (<name>@sha256:<64 lowercase hex>)",
                        image.reference
                    ),
                ));
            }
        }
        for (name, repository) in &self.repositories {
            if !self.images.contains_key(&repository.image) {
                problems.push(Problem::new(
                    "IMAGE_UNKNOWN",
                    format!("/repositories/{}/image", pointer(name)),
                    format!(
                        "repository `{name}` names image `{}`, which is not under images",
                        repository.image
                    ),
                ));
            }
            if !self.sizes.contains_key(&repository.size) {
                problems.push(Problem::new(
                    "SIZE_UNKNOWN",
                    format!("/repositories/{}/size", pointer(name)),
                    format!(
                        "repository `{name}` names size `{}`, which is not under sizes",
                        repository.size
                    ),
                ));
            }
        }
        let largest = self
            .sizes
            .iter()
            .max_by(|a, b| a.1.disk_gb.total_cmp(&b.1.disk_gb));
        if let (Some(disk), Some((name, size))) = (self.capacity.disk_gb, largest) {
            let needed = size.disk_gb * f64::from(self.capacity.machines);
            if needed > disk {
                problems.push(Problem::new(
                    "CAPACITY_TOO_SMALL",
                    "/capacity/disk_gb",
                    format!(
                        "{} machine(s) of size `{name}` need {needed} GB, more than capacity.disk_gb ({disk} GB)",
                        self.capacity.machines
                    ),
                ));
            }
        }
        problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(reference: &str) -> Image {
        Image {
            reference: reference.to_owned(),
            toolchain: BTreeMap::new(),
        }
    }

    #[test]
    fn only_a_full_lowercase_sha256_digest_pins_an_image() {
        let hex = "a".repeat(64);
        assert_eq!(
            image(&format!("ghcr.io/x/session@sha256:{hex}")).digest(),
            Some(format!("sha256:{hex}").as_str())
        );
        for bad in [
            "session:latest".to_owned(),
            format!("session@sha256:{}", "a".repeat(63)),
            format!("session@sha256:{}", "A".repeat(64)),
            format!("session@sha512:{hex}"),
            format!("session@sha256:{}g", "a".repeat(63)),
            format!("@sha256:{hex}"),
            format!("  @sha256:{hex}"),
            format!("bad ref@sha256:{hex}"),
            format!("a@b@sha256:{hex}"),
        ] {
            assert_eq!(image(&bad).digest(), None, "{bad}");
        }
    }

    #[test]
    fn a_pointer_escapes_slashes_and_tildes() {
        assert_eq!(pointer("a/b~c"), "a~1b~0c");
    }

    #[test]
    fn capacity_is_checked_against_the_largest_size() {
        let mut config = Config::default();
        config.sizes.insert(
            "small".to_owned(),
            Size {
                cpus: 1.0,
                memory_gb: 1.0,
                disk_gb: 10.0,
            },
        );
        config.sizes.insert(
            "big".to_owned(),
            Size {
                cpus: 1.0,
                memory_gb: 1.0,
                disk_gb: 50.0,
            },
        );
        config.capacity.machines = 2;
        config.capacity.disk_gb = Some(100.0);
        assert!(config.problems().is_empty());
        config.capacity.disk_gb = Some(99.0);
        let problems = config.problems();
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].code, "CAPACITY_TOO_SMALL");
        assert!(
            problems[0].message.contains("size `big`"),
            "{}",
            problems[0].message
        );
    }
}
