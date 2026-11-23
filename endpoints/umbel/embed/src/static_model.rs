//! Static token-lookup embeddings via `model2vec-rs` (records host specification, section 9.2).
//!
//! Loaded solely from pinned in-memory bytes (`model.safetensors`, `tokenizer.json`,
//! `config.json`) with the `local-only` feature enabled so no network download code is linked.

use std::panic::{AssertUnwindSafe, catch_unwind};

use model2vec_rs::model::StaticModel;
use umbel_store::{EmbedError, Embedder, ModelId};

use crate::{check_dimensions, check_vectors};

/// A static Model2Vec embedding model.
pub struct StaticEmbedder {
    model: ModelId,
    dimensions: usize,
    inner: StaticModel,
}

impl StaticEmbedder {
    /// Load a static model from pinned bytes: `tokenizer.json`, `model.safetensors` and
    /// `config.json`.
    ///
    /// # Errors
    /// [`EmbedError::Invalid`] when the bytes do not form a valid Model2Vec model or its
    /// dimensions lie outside 16..=4096.
    pub fn from_bytes(
        model: ModelId,
        tokenizer: &[u8],
        safetensors: &[u8],
        config: &[u8],
    ) -> Result<Self, EmbedError> {
        let inner = StaticModel::from_bytes(tokenizer, safetensors, config, None)
            .map_err(|err| EmbedError::Invalid(format!("failed to load static model: {err}")))?;
        let dimensions = check_dimensions(inner.dim())?;
        // Smoke-encode at load time inside `catch_unwind` so a corrupt or mismatched tokenizer
        // and embedding table fails closed here rather than panicking inside a request.
        let smoke = catch_unwind(AssertUnwindSafe(|| inner.encode(&["probe".to_owned()])))
            .map_err(|_| {
                EmbedError::Invalid(
                    "static model panicked during load probe (check tokenizer and embedding table match)".to_owned(),
                )
            })?;
        check_vectors(smoke, 1, dimensions)?;
        Ok(Self {
            model,
            dimensions,
            inner,
        })
    }
}

impl Embedder for StaticEmbedder {
    fn model(&self) -> &ModelId {
        &self.model
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }

    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let owned: Vec<String> = texts.iter().map(|t| (*t).to_owned()).collect();
        let vectors = catch_unwind(AssertUnwindSafe(|| self.inner.encode(&owned))).map_err(
            |_| {
                EmbedError::Invalid(
                    "static model panicked during encoding (check tokenizer and embedding table match)".to_owned(),
                )
            },
        )?;
        check_vectors(vectors, texts.len(), self.dimensions)
    }
}
