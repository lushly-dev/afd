//! Meaning lane runtime (records host specification, sections 9 and 10; D166, D167, D168):
//! loading configured `[models]` with SHA-256 file pinning and workspace confinement, evaluating
//! `evals/records/<space>/<plugin>.<kind>.json` gate reports, and deciding per
//! `(space, plugin, kind)` whether meaning is served.
//!
//! No model failure stops `HostBuilder::seal()`: an unloaded model leaves `meaning` `off` for its
//! spaces and fails the doctor's `records.meaning` check.
//!
//! The host never trusts `report.passed`: it recomputes the exact integer gate rule from the
//! report's counts (`n >= 50`, `leaks == 0`, `fused.k - words.k >= max(3, ceil(0.02 * n))`) and
//! binds the report to `declHash`, `normalisation`, `model`, `weight` and `k`.

use std::collections::BTreeMap;
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use umbel_store::lane::{NORMALISATION_VERSION, RecordDecl};
use umbel_store::{Embedder, ModelId};

use crate::plugins::{LoadedPlugins, Status};
use crate::workspace::{ModelConfig, ModelProvider, Workspace, effective_root};

/// Largest pinned model file read into memory (1 GiB).
const MAX_MODEL_FILE_BYTES: u64 = 1024 * 1024 * 1024;
/// Largest eval report file read from `evals/records/` (1 MiB).
const MAX_REPORT_BYTES: u64 = 1024 * 1024;
/// Most probes accepted by `store-records-eval` and valid in a `RecordEvalReport` (section 10).
pub(crate) const MAX_EVAL_PROBES: u64 = 5_000;

/// Failure from [`read_file_bounded`].
pub(crate) enum BoundedReadError {
    NotFound,
    NotRegularFile,
    TooLarge(u64),
    Io(std::io::Error),
}

/// Open `path` once, verify the opened handle is a regular file, and read at most `max_bytes`
/// via `Read::take(max_bytes + 1)` so a file growing concurrently cannot bypass the cap.
pub(crate) fn read_file_bounded(path: &Path, max_bytes: u64) -> Result<Vec<u8>, BoundedReadError> {
    let file = fs::File::open(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => BoundedReadError::NotFound,
        std::io::ErrorKind::IsADirectory => BoundedReadError::NotRegularFile,
        // On Windows, `File::open` on a directory fails with `PermissionDenied`
        // (`ERROR_ACCESS_DENIED`) rather than opening a directory handle (#2389).
        std::io::ErrorKind::PermissionDenied
            if fs::metadata(path).is_ok_and(|meta| !meta.is_file()) =>
        {
            BoundedReadError::NotRegularFile
        }
        _ => BoundedReadError::Io(err),
    })?;
    let meta = file.metadata().map_err(BoundedReadError::Io)?;
    if !meta.is_file() {
        return Err(BoundedReadError::NotRegularFile);
    }
    if meta.len() > max_bytes {
        return Err(BoundedReadError::TooLarge(max_bytes));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(meta.len().min(max_bytes)).unwrap_or(0));
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(BoundedReadError::Io)?;
    if bytes.len() as u64 > max_bytes {
        return Err(BoundedReadError::TooLarge(max_bytes));
    }
    Ok(bytes)
}

/// Whether `target` (already resolved) lies inside `workspace_root/state`, checking both the
/// direct `canonical_ws/state` path and the resolved symlink target of `state/`.
pub(crate) fn is_under_state(workspace_root: &Path, canonical_ws: &Path, target: &Path) -> bool {
    let direct = canonical_ws.join("state");
    if target == direct || target.starts_with(&direct) {
        return true;
    }
    let resolved = effective_root(workspace_root, "state");
    target == resolved || target.starts_with(&resolved)
}

/// Verify that an eval report path under `evals/records/` traverses no symbolic links, resolves
/// inside the workspace root (and not under `state/`), and does not overlap any command-writable
/// collection root across all spaces.
pub(crate) fn check_eval_report_path(
    workspace: &Workspace,
    path: &Path,
) -> Result<PathBuf, String> {
    let canonical_ws = fs::canonicalize(workspace.root())
        .map_err(|err| format!("workspace root cannot be resolved: {err}"))?;
    let rel = path
        .strip_prefix(workspace.root())
        .map_err(|_| "eval report path is outside the workspace root".to_owned())?;
    let mut cursor = workspace.root().to_path_buf();
    for component in rel.components() {
        cursor.push(component);
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("eval report path traverses a symbolic link".to_owned());
            }
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => break,
            Err(err) => return Err(format!("cannot inspect eval report path: {err}")),
        }
    }
    let rel_str = rel
        .to_str()
        .ok_or_else(|| "eval report path is not valid UTF-8".to_owned())?;
    let effective = effective_root(workspace.root(), rel_str);
    if !effective.starts_with(&canonical_ws) {
        return Err("eval report path resolves outside the workspace".to_owned());
    }
    if is_under_state(workspace.root(), &canonical_ws, &effective) {
        return Err("eval report path resolves inside state/".to_owned());
    }
    for space in workspace.spaces() {
        for collection in &space.collections {
            if workspace
                .config()
                .command_writable(space.id.as_str(), &collection.id)
            {
                let cw_root = effective_root(workspace.root(), &collection.root);
                if effective == cw_root
                    || effective.starts_with(&cw_root)
                    || cw_root.starts_with(&effective)
                {
                    return Err(format!(
                        "eval report path overlaps command-writable collection `{}/{}`",
                        space.id, collection.id
                    ));
                }
            }
        }
    }
    Ok(effective)
}

/// Why a configured model did not load.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ModelProblem {
    /// The model's directory is missing, not a directory, escapes the workspace, or lies under `state/`.
    BadDirectory(String),
    /// A pinned file is missing or cannot be read.
    MissingFile { file: String, detail: String },
    /// A pinned file's SHA-256 differs from `models.<mid>.files`.
    DigestMismatch { file: String },
    /// The build was not compiled with the Cargo feature for this provider.
    #[cfg_attr(
        all(
            feature = "embed-static",
            feature = "embed-onnx",
            feature = "embed-http"
        ),
        allow(dead_code)
    )]
    FeatureDisabled {
        provider: &'static str,
        feature: &'static str,
    },
    /// The provider failed to initialize (corrupt weights, bad URL, probe failed, etc.).
    LoadFailed(String),
}

impl std::fmt::Display for ModelProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadDirectory(detail) => write!(f, "model directory problem: {detail}"),
            Self::MissingFile { file, detail } => {
                write!(f, "pinned file `{file}` cannot be read: {detail}")
            }
            Self::DigestMismatch { file } => {
                write!(f, "pinned file `{file}` does not match its SHA-256 digest")
            }
            Self::FeatureDisabled { provider, feature } => write!(
                f,
                "provider `{provider}` is not compiled into this build (enable Cargo feature `{feature}`)"
            ),
            Self::LoadFailed(detail) => write!(f, "failed to load model: {detail}"),
        }
    }
}

/// What became of one configured `[models.<mid>]` at host start.
pub(crate) enum ModelState {
    Loaded(Arc<dyn Embedder>),
    Failed(ModelProblem),
}

/// One configured model's resolved metadata and load outcome.
#[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
pub(crate) struct ModelSlot {
    pub(crate) config: ModelConfig,
    pub(crate) model_id: ModelId,
    pub(crate) state: ModelState,
}

/// Hit counts at standard cutoffs plus the configured `k` (section 10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HitCounts {
    #[serde(rename = "1")]
    pub(crate) at_1: u64,
    #[serde(rename = "3")]
    pub(crate) at_3: u64,
    #[serde(rename = "5")]
    pub(crate) at_5: u64,
    #[serde(rename = "10")]
    pub(crate) at_10: u64,
    #[serde(rename = "20")]
    pub(crate) at_20: u64,
    pub(crate) k: u64,
}

/// Words vs fused hit counts in a `RecordEvalReport`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EvalHits {
    pub(crate) words: HitCounts,
    pub(crate) fused: HitCounts,
}

/// `evals/records/<space>/<plugin>.<kind>.json` (`schemas/record-eval-report.v1.json`, section 10).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecordEvalReport {
    pub(crate) version: u32,
    pub(crate) space: String,
    pub(crate) plugin: String,
    pub(crate) kind: String,
    pub(crate) decl_hash: String,
    pub(crate) normalisation: u32,
    pub(crate) model: String,
    pub(crate) weight: f64,
    pub(crate) k: u64,
    pub(crate) probes: u64,
    pub(crate) n: u64,
    pub(crate) hits: EvalHits,
    pub(crate) leaks: u64,
    pub(crate) records: u64,
    pub(crate) probes_digest: String,
    pub(crate) host_version: String,
    pub(crate) at: String,
    pub(crate) passed: bool,
}

/// Exact integer form of section 10's gate rule:
/// `n >= 50`, `leaks == 0`, and `hits.fused.k - hits.words.k >= max(3, ceil(0.02 * n))`.
/// `ceil(0.02 * n)` is `n.div_ceil(50)` with zero floating-point drift.
#[must_use]
pub(crate) fn rule_passes(n: u64, words_k: u64, fused_k: u64, leaks: u64) -> bool {
    if n < 50 || leaks != 0 {
        return false;
    }
    let needed = 3u64.max(n.div_ceil(50));
    fused_k
        .checked_sub(words_k)
        .is_some_and(|gain| gain >= needed)
}

/// What the host decided for one `(space, plugin, kind)` gate report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GateState {
    /// Report exists, matches every binding, and its counts satisfy the gate rule.
    Passed { records: u64 },
    /// No report file exists yet.
    Missing,
    /// Report file could not be read or parsed as `record-eval-report.v1.json`.
    Invalid(String),
    /// Report is bound to another declaration hash, normalisation, model, weight, or `k`.
    Unbound(String),
    /// Report is bound to this lane, but its counts do not satisfy the gate rule.
    Failed(String),
}

impl GateState {
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    #[must_use]
    pub(crate) fn is_passed(&self) -> bool {
        matches!(self, Self::Passed { .. })
    }
}

/// Validate `report` against the space's configuration, `decl`, and the host's own recomputed
/// gate rule (section 10). Never trusts `report.passed`.
#[must_use]
pub(crate) fn check_report(
    report: &RecordEvalReport,
    space: &str,
    plugin: &str,
    decl: &RecordDecl,
    expected_model: &ModelId,
    expected_weight: f64,
    expected_k: u64,
) -> GateState {
    if report.version != crate::versions::RECORD_EVAL_REPORT_VERSION {
        return GateState::Invalid(format!(
            "unsupported report version {} (expected {})",
            report.version,
            crate::versions::RECORD_EVAL_REPORT_VERSION
        ));
    }
    if report.space != space || report.plugin != plugin || report.kind != decl.kind {
        return GateState::Unbound(format!(
            "report names {}/{}.{}, not {space}/{plugin}.{}",
            report.space, report.plugin, report.kind, decl.kind
        ));
    }
    let expected_hash = decl.hash();
    if report.decl_hash != expected_hash.as_str() {
        return GateState::Unbound("declaration hash".to_owned());
    }
    if report.normalisation != NORMALISATION_VERSION {
        return GateState::Unbound(format!(
            "normalisation version {} (expected {NORMALISATION_VERSION})",
            report.normalisation
        ));
    }
    if report.model != expected_model.as_str() {
        return GateState::Unbound("model".to_owned());
    }
    if !report.weight.is_finite() || report.weight != expected_weight {
        return GateState::Unbound(format!(
            "weight {} (configured {expected_weight})",
            report.weight
        ));
    }
    if report.k != expected_k {
        return GateState::Unbound(format!("k {} (configured {expected_k})", report.k));
    }
    if report.probes > MAX_EVAL_PROBES {
        return GateState::Invalid(format!(
            "report probes {} exceeds maximum {MAX_EVAL_PROBES}",
            report.probes
        ));
    }
    if report.n > report.probes || report.hits.words.k > report.n || report.hits.fused.k > report.n
    {
        return GateState::Invalid(
            "report counts are inconsistent (n > probes or hits > n)".to_owned(),
        );
    }
    if report.leaks != 0 {
        return GateState::Failed(format!("leaks is {} (must be 0)", report.leaks));
    }
    if report.n < 50 {
        return GateState::Failed(format!(
            "only {} probes with duplicates (need at least 50)",
            report.n
        ));
    }
    let needed = 3u64.max(report.n.div_ceil(50));
    if !rule_passes(
        report.n,
        report.hits.words.k,
        report.hits.fused.k,
        report.leaks,
    ) {
        let diff = report.hits.fused.k as i128 - report.hits.words.k as i128;
        return GateState::Failed(format!(
            "fused hits at k={} ({}) over words ({}) is {diff}, below the required gain of {needed}",
            report.k, report.hits.fused.k, report.hits.words.k
        ));
    }
    GateState::Passed {
        records: report.records,
    }
}

/// Resolve a relative model directory inside `workspace_root`, refusing anything missing,
/// non-directory, outside `workspace_root`, or inside `workspace_root/state`.
fn resolve_model_dir(workspace_root: &Path, dir: &str) -> Result<PathBuf, ModelProblem> {
    let canonical_ws = fs::canonicalize(workspace_root).map_err(|err| {
        ModelProblem::BadDirectory(format!("workspace root cannot be resolved: {err}"))
    })?;
    let candidate = workspace_root.join(dir);
    let canonical_dir = fs::canonicalize(&candidate)
        .map_err(|err| ModelProblem::BadDirectory(format!("`{dir}` cannot be resolved: {err}")))?;
    if !canonical_dir.is_dir() {
        return Err(ModelProblem::BadDirectory(format!(
            "`{dir}` is not a directory"
        )));
    }
    if !canonical_dir.starts_with(&canonical_ws) {
        return Err(ModelProblem::BadDirectory(format!(
            "`{dir}` resolves outside the workspace"
        )));
    }
    if is_under_state(workspace_root, &canonical_ws, &canonical_dir) {
        return Err(ModelProblem::BadDirectory(format!(
            "`{dir}` resolves inside state/"
        )));
    }
    Ok(canonical_dir)
}

/// Read all pinned files of a local model, verifying each stays inside `canonical_ws` (and not
/// under `state/`) and matches its configured `sha256:<64 hex>`.
fn read_pinned_files(
    workspace_root: &Path,
    dir: &str,
    files: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, Vec<u8>>, ModelProblem> {
    let canonical_ws = fs::canonicalize(workspace_root).map_err(|err| {
        ModelProblem::BadDirectory(format!("workspace root cannot be resolved: {err}"))
    })?;
    let canonical_dir = resolve_model_dir(workspace_root, dir)?;
    let mut loaded = BTreeMap::new();
    for (name, expected_digest) in files {
        let path = canonical_dir.join(name);
        let canonical_file = fs::canonicalize(&path).map_err(|err| ModelProblem::MissingFile {
            file: name.clone(),
            detail: err.to_string(),
        })?;
        if !canonical_file.starts_with(&canonical_ws)
            || is_under_state(workspace_root, &canonical_ws, &canonical_file)
        {
            return Err(ModelProblem::BadDirectory(format!(
                "file `{name}` resolves outside the workspace or inside state/"
            )));
        }
        let bytes =
            read_file_bounded(&canonical_file, MAX_MODEL_FILE_BYTES).map_err(|err| match err {
                BoundedReadError::NotFound => ModelProblem::MissingFile {
                    file: name.clone(),
                    detail: "file not found".to_owned(),
                },
                BoundedReadError::NotRegularFile => ModelProblem::MissingFile {
                    file: name.clone(),
                    detail: "not a regular file".to_owned(),
                },
                BoundedReadError::TooLarge(cap) => {
                    ModelProblem::LoadFailed(format!("file `{name}` exceeds {cap} bytes"))
                }
                BoundedReadError::Io(io) => ModelProblem::MissingFile {
                    file: name.clone(),
                    detail: io.to_string(),
                },
            })?;
        let digest = Sha256::digest(&bytes);
        let mut actual = String::from("sha256:");
        for byte in &digest {
            use std::fmt::Write as _;
            let _ = write!(actual, "{byte:02x}");
        }
        if actual != *expected_digest {
            return Err(ModelProblem::DigestMismatch { file: name.clone() });
        }
        loaded.insert(name.clone(), bytes);
    }
    Ok(loaded)
}

fn load_model(workspace_root: &Path, config: &ModelConfig, model_id: ModelId) -> ModelState {
    match &config.provider {
        ModelProvider::Static { dir, files } => {
            let bytes = match read_pinned_files(workspace_root, dir, files) {
                Ok(bytes) => bytes,
                Err(problem) => return ModelState::Failed(problem),
            };
            #[cfg(feature = "embed-static")]
            {
                let Some(model) = bytes.get("model.safetensors") else {
                    return ModelState::Failed(ModelProblem::MissingFile {
                        file: "model.safetensors".to_owned(),
                        detail: "missing from pinned files".to_owned(),
                    });
                };
                let Some(tokenizer) = bytes.get("tokenizer.json") else {
                    return ModelState::Failed(ModelProblem::MissingFile {
                        file: "tokenizer.json".to_owned(),
                        detail: "missing from pinned files".to_owned(),
                    });
                };
                let Some(cfg) = bytes.get("config.json") else {
                    return ModelState::Failed(ModelProblem::MissingFile {
                        file: "config.json".to_owned(),
                        detail: "missing from pinned files".to_owned(),
                    });
                };
                match umbel_embed::StaticEmbedder::from_bytes(model_id, tokenizer, model, cfg) {
                    Ok(embedder) => ModelState::Loaded(Arc::new(embedder)),
                    Err(err) => ModelState::Failed(ModelProblem::LoadFailed(err.to_string())),
                }
            }
            #[cfg(not(feature = "embed-static"))]
            {
                let _ = (bytes, model_id);
                ModelState::Failed(ModelProblem::FeatureDisabled {
                    provider: "static",
                    feature: "embed-static",
                })
            }
        }
        ModelProvider::Onnx {
            dir,
            files,
            pooling,
            max_length,
        } => {
            let bytes = match read_pinned_files(workspace_root, dir, files) {
                Ok(bytes) => bytes,
                Err(problem) => return ModelState::Failed(problem),
            };
            #[cfg(feature = "embed-onnx")]
            {
                let mut map = bytes;
                let take = |map: &mut BTreeMap<String, Vec<u8>>, name: &str| {
                    map.remove(name).ok_or_else(|| ModelProblem::MissingFile {
                        file: name.to_owned(),
                        detail: "missing from pinned files".to_owned(),
                    })
                };
                let onnx_files = (|| -> Result<umbel_embed::OnnxFiles, ModelProblem> {
                    Ok(umbel_embed::OnnxFiles {
                        model: take(&mut map, "model.onnx")?,
                        tokenizer: take(&mut map, "tokenizer.json")?,
                        config: take(&mut map, "config.json")?,
                        special_tokens_map: take(&mut map, "special_tokens_map.json")?,
                        tokenizer_config: take(&mut map, "tokenizer_config.json")?,
                    })
                })();
                let onnx_files = match onnx_files {
                    Ok(f) => f,
                    Err(problem) => return ModelState::Failed(problem),
                };
                let onnx_pooling = match pooling {
                    crate::workspace::Pooling::Mean => umbel_embed::OnnxPooling::Mean,
                    crate::workspace::Pooling::Cls => umbel_embed::OnnxPooling::Cls,
                };
                let max_len = usize::try_from(*max_length).unwrap_or(512);
                match umbel_embed::OnnxEmbedder::from_bytes(
                    model_id,
                    onnx_files,
                    onnx_pooling,
                    max_len,
                ) {
                    Ok(embedder) => ModelState::Loaded(Arc::new(embedder)),
                    Err(err) => ModelState::Failed(ModelProblem::LoadFailed(err.to_string())),
                }
            }
            #[cfg(not(feature = "embed-onnx"))]
            {
                let _ = (bytes, model_id, pooling, max_length);
                ModelState::Failed(ModelProblem::FeatureDisabled {
                    provider: "onnx",
                    feature: "embed-onnx",
                })
            }
        }
        ModelProvider::Http {
            url,
            dimensions,
            bearer_env,
            timeout_ms,
            ..
        } => {
            #[cfg(feature = "embed-http")]
            {
                let bearer = match bearer_env {
                    Some(var) => match std::env::var(var) {
                        Ok(val) if !val.is_empty() => Some(val),
                        Ok(_) => {
                            return ModelState::Failed(ModelProblem::LoadFailed(format!(
                                "environment variable `{var}` is empty"
                            )));
                        }
                        Err(_) => {
                            return ModelState::Failed(ModelProblem::LoadFailed(format!(
                                "environment variable `{var}` is not set"
                            )));
                        }
                    },
                    None => None,
                };
                let cfg = umbel_embed::HttpConfig {
                    url: url.clone(),
                    name: config.name.clone(),
                    dimensions: usize::try_from(*dimensions).unwrap_or(0),
                    bearer,
                    timeout: std::time::Duration::from_millis(*timeout_ms),
                };
                match umbel_embed::HttpEmbedder::new(model_id, cfg) {
                    Ok(embedder) => ModelState::Loaded(Arc::new(embedder)),
                    Err(err) => ModelState::Failed(ModelProblem::LoadFailed(err.to_string())),
                }
            }
            #[cfg(not(feature = "embed-http"))]
            {
                let _ = (url, dimensions, bearer_env, timeout_ms, model_id);
                ModelState::Failed(ModelProblem::FeatureDisabled {
                    provider: "http",
                    feature: "embed-http",
                })
            }
        }
    }
}

/// Shared meaning runtime owned by a sealed host: loaded models and per-`(space, plugin, kind)`
/// gate status.
pub(crate) struct MeaningHub {
    workspace: Arc<Workspace>,
    models: BTreeMap<String, ModelSlot>,
    gates: RwLock<BTreeMap<(String, String, String), GateState>>,
}

impl MeaningHub {
    /// Load every model declared in `[models]` (using `overrides` in `testkit` builds when a test
    /// supplies a stub `Embedder` for a model id). Never fails host startup.
    pub(crate) fn load(
        workspace: Arc<Workspace>,
        overrides: BTreeMap<String, Arc<dyn Embedder>>,
    ) -> Self {
        let mut models = BTreeMap::new();
        for config in &workspace.config().models {
            let model_id = config.model_id();
            let state = if let Some(stub) = overrides.get(&config.id) {
                ModelState::Loaded(Arc::clone(stub))
            } else {
                load_model(workspace.root(), config, model_id.clone())
            };
            if let ModelState::Failed(problem) = &state {
                tracing::warn!(
                    model = %config.id,
                    "configured embedding model did not load; meaning stays off: {problem}"
                );
            }
            models.insert(
                config.id.clone(),
                ModelSlot {
                    config: config.clone(),
                    model_id,
                    state,
                },
            );
        }
        Self {
            workspace,
            models,
            gates: RwLock::new(BTreeMap::new()),
        }
    }

    /// Evaluate and cache the gate report for every loaded plugin instance's matched declared
    /// kinds in every space that configures `[spaces.<id>.meaning]` (section 10).
    pub(crate) fn populate_gates(&self, loaded: &LoadedPlugins) {
        for space in self.workspace.spaces() {
            if space.meaning.is_none() {
                continue;
            }
            let space_id = space.id.as_str();
            for instance in &loaded.instances {
                if instance.status != Status::Loaded
                    || !instance.spaces.iter().any(|s| s == space_id)
                {
                    continue;
                }
                let Some(manifest) = &instance.manifest else {
                    continue;
                };
                for decl in &manifest.records {
                    if decl.matched.is_some() {
                        let _ = self.refresh_gate(space_id, &instance.id, decl);
                    }
                }
            }
        }
    }

    /// The configured model slot for `space`, if `[spaces.<id>.meaning]` is configured.
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) fn space_model(&self, space: &str) -> Option<&ModelSlot> {
        let meaning = self
            .workspace
            .spaces()
            .iter()
            .find(|s| s.id.as_str() == space)?
            .meaning
            .as_ref()?;
        self.models.get(&meaning.model)
    }

    /// All configured models, by id.
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) fn models(&self) -> &BTreeMap<String, ModelSlot> {
        &self.models
    }

    /// The loaded `Embedder` for `space`, if `[spaces.<id>.meaning]` is configured and loaded.
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) fn space_embedder(&self, space: &str) -> Option<Arc<dyn Embedder>> {
        match &self.space_model(space)?.state {
            ModelState::Loaded(embedder) => Some(Arc::clone(embedder)),
            ModelState::Failed(_) => None,
        }
    }

    /// Whether `space` has a configured model that failed to load.
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) fn space_model_failed(&self, space: &str) -> Option<&ModelProblem> {
        match &self.space_model(space)?.state {
            ModelState::Failed(problem) => Some(problem),
            ModelState::Loaded(_) => None,
        }
    }

    /// The loaded `Embedder` and configured weight if meaning is currently served for
    /// `(space, plugin, kind)` (model loaded AND cached gate report passed).
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) fn serving(
        &self,
        space: &str,
        plugin: &str,
        kind: &str,
    ) -> Option<(Arc<dyn Embedder>, f64)> {
        let meaning = self
            .workspace
            .spaces()
            .iter()
            .find(|s| s.id.as_str() == space)?
            .meaning
            .as_ref()?;
        let embedder = self.space_embedder(space)?;
        let passed = self
            .gates
            .read()
            .ok()?
            .get(&(space.to_owned(), plugin.to_owned(), kind.to_owned()))
            .is_some_and(GateState::is_passed);
        passed.then_some((embedder, meaning.weight))
    }

    /// Whether meaning is currently served for `(space, plugin, kind)`.
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    #[must_use]
    pub(crate) fn is_served(&self, space: &str, plugin: &str, kind: &str) -> bool {
        self.serving(space, plugin, kind).is_some()
    }

    /// Read and validate `evals/records/<space>/<plugin>.<kind>.json` from disk right now
    /// (without mutating the serving cache). Used by `workspace-doctor` and `refresh_gate`.
    pub(crate) fn evaluate_gate(&self, space: &str, plugin: &str, decl: &RecordDecl) -> GateState {
        let Some(meaning) = self
            .workspace
            .spaces()
            .iter()
            .find(|s| s.id.as_str() == space)
            .and_then(|s| s.meaning.as_ref())
        else {
            return GateState::Missing;
        };
        let Some(slot) = self.models.get(&meaning.model) else {
            return GateState::Missing;
        };
        // Use the loaded embedder's own model id when loaded (matches `slot.model_id` for all
        // real providers and also respects a testkit stub embedder's model id).
        let expected_model = match &slot.state {
            ModelState::Loaded(embedder) => embedder.model().clone(),
            ModelState::Failed(_) => slot.model_id.clone(),
        };
        let path = self
            .workspace
            .layout()
            .record_eval_report(space, plugin, &decl.kind);
        if let Err(why) = check_eval_report_path(self.workspace.as_ref(), &path) {
            return GateState::Invalid(why);
        }
        let bytes = match read_file_bounded(&path, MAX_REPORT_BYTES) {
            Ok(bytes) => bytes,
            Err(BoundedReadError::NotFound) => return GateState::Missing,
            Err(BoundedReadError::NotRegularFile) => {
                return GateState::Invalid("report file is not a regular file".to_owned());
            }
            Err(BoundedReadError::TooLarge(cap)) => {
                return GateState::Invalid(format!("report file exceeds {cap} bytes"));
            }
            Err(BoundedReadError::Io(err)) => {
                return GateState::Invalid(format!("cannot read report file: {err}"));
            }
        };
        let report: RecordEvalReport = match serde_json::from_slice(&bytes) {
            Ok(report) => report,
            Err(err) => return GateState::Invalid(format!("invalid report JSON: {err}")),
        };
        check_report(
            &report,
            space,
            plugin,
            decl,
            &expected_model,
            meaning.weight,
            meaning.k,
        )
    }

    /// Re-read the gate report for `(space, plugin, kind)` and update the serving cache.
    pub(crate) fn refresh_gate(&self, space: &str, plugin: &str, decl: &RecordDecl) -> GateState {
        let state = self.evaluate_gate(space, plugin, decl);
        if let Ok(mut gates) = self.gates.write() {
            gates.insert(
                (space.to_owned(), plugin.to_owned(), decl.kind.clone()),
                state.clone(),
            );
        }
        state
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use umbel_store::lane::Pointer;

    fn decl() -> RecordDecl {
        RecordDecl {
            kind: "note".to_owned(),
            standing: true,
            text: vec![Pointer::parse("/statement").unwrap()],
            keys: vec![Pointer::parse("/bed").unwrap()],
            matched: Some(0),
        }
    }

    fn passing_report(decl: &RecordDecl, model: &ModelId) -> RecordEvalReport {
        RecordEvalReport {
            version: 1,
            space: "garden".to_owned(),
            plugin: "notes".to_owned(),
            kind: "note".to_owned(),
            decl_hash: decl.hash().as_str().to_owned(),
            normalisation: NORMALISATION_VERSION,
            model: model.as_str().to_owned(),
            weight: 0.5,
            k: 5,
            probes: 60,
            n: 50,
            hits: EvalHits {
                words: HitCounts {
                    at_1: 20,
                    at_3: 30,
                    at_5: 35,
                    at_10: 40,
                    at_20: 42,
                    k: 35,
                },
                fused: HitCounts {
                    at_1: 24,
                    at_3: 34,
                    at_5: 38,
                    at_10: 43,
                    at_20: 45,
                    k: 38,
                },
            },
            leaks: 0,
            records: 100,
            probes_digest: format!("sha256:{}", "a".repeat(64)),
            host_version: env!("CARGO_PKG_VERSION").to_owned(),
            at: "2026-11-22T12:00:00.000Z".to_owned(),
            passed: true,
        }
    }

    #[test]
    fn rule_passes_holds_on_each_side_of_every_threshold() {
        assert!(!rule_passes(49, 10, 49, 0));
        assert!(!rule_passes(50, 10, 12, 0));
        assert!(rule_passes(50, 10, 13, 0));
        assert!(!rule_passes(50, 10, 13, 1));
        assert!(!rule_passes(200, 100, 103, 0));
        assert!(rule_passes(200, 100, 104, 0));
        assert!(rule_passes(150, 100, 103, 0));
        assert!(!rule_passes(151, 100, 103, 0));
        assert!(rule_passes(151, 100, 104, 0));
        assert!(!rule_passes(500, 400, 409, 0));
        assert!(rule_passes(500, 400, 410, 0));
        // Overflow guard: zero gain at u64::MAX must never pass via saturating_add wraparound.
        assert!(!rule_passes(u64::MAX, u64::MAX, u64::MAX, 0));
        assert!(!rule_passes(u64::MAX, u64::MAX - 1, u64::MAX, 0));
    }

    #[test]
    fn check_report_recomputes_rule_ignoring_passed_and_enforces_every_binding() {
        let decl = decl();
        let model = ModelId::parse("potion@0123456789abcdef").unwrap();
        let base = passing_report(&decl, &model);
        assert_eq!(
            check_report(&base, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Passed { records: 100 }
        );
        // Tampered `passed: true` with failing counts is rejected.
        let mut tampered = base.clone();
        tampered.hits.fused.k = 37; // only +2 at n=50
        tampered.passed = true;
        assert!(matches!(
            check_report(&tampered, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Failed(_)
        ));
        // Even `passed: false` passes if the counts and bindings pass (host recomputes!).
        let mut false_flag = base.clone();
        false_flag.passed = false;
        assert_eq!(
            check_report(&false_flag, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Passed { records: 100 }
        );
        // Each binding mismatch returns Unbound naming the mismatched binding.
        let mut bad_decl = base.clone();
        bad_decl.decl_hash = format!("sha256:{}", "0".repeat(64));
        assert!(matches!(
            check_report(&bad_decl, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Unbound(why) if why.contains("declaration")
        ));
        let mut bad_norm = base.clone();
        bad_norm.normalisation = NORMALISATION_VERSION + 1;
        assert!(matches!(
            check_report(&bad_norm, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Unbound(why) if why.contains("normalisation")
        ));
        let mut bad_model = base.clone();
        bad_model.model = "potion@fedcba9876543210".to_owned();
        assert!(matches!(
            check_report(&bad_model, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Unbound(why) if why.contains("model")
        ));
        assert!(matches!(
            check_report(&base, "garden", "notes", &decl, &model, 0.6, 5),
            GateState::Unbound(why) if why.contains("weight")
        ));
        assert!(matches!(
            check_report(&base, "garden", "notes", &decl, &model, 0.5, 10),
            GateState::Unbound(why) if why.contains("k")
        ));
        let mut too_many_probes = base;
        too_many_probes.probes = MAX_EVAL_PROBES + 1;
        assert!(matches!(
            check_report(&too_many_probes, "garden", "notes", &decl, &model, 0.5, 5),
            GateState::Invalid(why) if why.contains("exceeds maximum")
        ));
    }

    #[test]
    fn read_file_bounded_enforces_cap_and_is_under_state_follows_symlinked_state() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.bin");
        fs::write(&file, b"0123456789").unwrap();
        assert_eq!(read_file_bounded(&file, 10).ok().unwrap().len(), 10);
        assert!(matches!(
            read_file_bounded(&file, 9),
            Err(BoundedReadError::TooLarge(9))
        ));
        assert!(matches!(
            read_file_bounded(&dir.path().join("missing"), 10),
            Err(BoundedReadError::NotFound)
        ));
        assert!(matches!(
            read_file_bounded(dir.path(), 10),
            Err(BoundedReadError::NotRegularFile)
        ));

        #[cfg(unix)]
        {
            let real_state = dir.path().join("real-state");
            fs::create_dir(&real_state).unwrap();
            std::os::unix::fs::symlink(&real_state, dir.path().join("state")).unwrap();
            let canonical_ws = fs::canonicalize(dir.path()).unwrap();
            let inside_real = fs::canonicalize(&real_state).unwrap().join("secret.bin");
            assert!(is_under_state(dir.path(), &canonical_ws, &inside_real));
        }
    }
}
