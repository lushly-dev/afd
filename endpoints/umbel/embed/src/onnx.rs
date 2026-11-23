//! Local ONNX transformer embeddings via `fastembed` (records host specification, section 9.2).
//!
//! Loaded solely from pinned in-memory bytes with `hf-hub` compiled out. `fastembed`'s
//! `TextEmbedding::embed` takes `&mut self`, so the session sits behind a `Mutex`. At load time
//! it embeds the single literal `"dimensions"` once to establish the output dimension (16..=4096).

use std::sync::Mutex;

use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use umbel_store::{EmbedError, Embedder, ModelId};

use crate::{check_dimensions, check_vectors};

/// Pooling strategy for an ONNX model (`models.<mid>.pooling`, section 9.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnnxPooling {
    /// Mean of token vectors (default).
    Mean,
    /// First token (`CLS`) vector.
    Cls,
}

/// The five pinned files of an ONNX model, read into memory after SHA-256 verification.
#[derive(Debug, Clone)]
pub struct OnnxFiles {
    /// `model.onnx`.
    pub model: Vec<u8>,
    /// `tokenizer.json`.
    pub tokenizer: Vec<u8>,
    /// `config.json`.
    pub config: Vec<u8>,
    /// `special_tokens_map.json`.
    pub special_tokens_map: Vec<u8>,
    /// `tokenizer_config.json`.
    pub tokenizer_config: Vec<u8>,
}

/// A local ONNX transformer embedding model.
pub struct OnnxEmbedder {
    model: ModelId,
    dimensions: usize,
    inner: Mutex<TextEmbedding>,
}

impl OnnxEmbedder {
    /// Load an ONNX model from pinned bytes, probe its output dimension with `"dimensions"`, and
    /// refuse a dimension outside 16..=4096.
    ///
    /// # Errors
    /// [`EmbedError::Invalid`] when the bytes fail to load, the probe fails, or the resulting
    /// dimension is outside 16..=4096.
    pub fn from_bytes(
        model: ModelId,
        files: OnnxFiles,
        pooling: OnnxPooling,
        max_length: usize,
    ) -> Result<Self, EmbedError> {
        let tokenizer_files = TokenizerFiles {
            tokenizer_file: files.tokenizer,
            config_file: files.config,
            special_tokens_map_file: files.special_tokens_map,
            tokenizer_config_file: files.tokenizer_config,
        };
        let fastembed_pooling = match pooling {
            OnnxPooling::Mean => Pooling::Mean,
            OnnxPooling::Cls => Pooling::Cls,
        };
        let user_defined = UserDefinedEmbeddingModel::new(files.model, tokenizer_files)
            .with_pooling(fastembed_pooling);
        let options = InitOptionsUserDefined::new().with_max_length(max_length);
        let mut inner = TextEmbedding::try_new_from_user_defined(user_defined, options)
            .map_err(|err| EmbedError::Invalid(format!("failed to load onnx model: {err}")))?;
        let probe = inner
            .embed(vec!["dimensions"], None)
            .map_err(|err| EmbedError::Invalid(format!("onnx dimension probe failed: {err}")))?;
        let first = probe.first().ok_or_else(|| {
            EmbedError::Invalid("onnx dimension probe returned no vector".to_owned())
        })?;
        let dimensions = check_dimensions(first.len())?;
        check_vectors(probe, 1, dimensions)?;
        Ok(Self {
            model,
            dimensions,
            inner: Mutex::new(inner),
        })
    }
}

impl Embedder for OnnxEmbedder {
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
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| EmbedError::Unavailable("onnx session lock poisoned".to_owned()))?;
        let vectors = guard
            .embed(texts, None)
            .map_err(|_| EmbedError::Unavailable("onnx embedding call failed".to_owned()))?;
        check_vectors(vectors, texts.len(), self.dimensions)
    }
}
